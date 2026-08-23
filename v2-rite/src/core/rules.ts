import { blockedCells, directionsFor, getCreatureAt, getCreatureById, walkDirection } from './board';
import { RANK_OF } from './creatures';
import { acolyteMoveRange, wardenMoveRange } from './relics';
import type { BattleState, Cell, CellKey, Creature, Id, Side } from './types';

export function canCreatureAct(state: BattleState, creature: Creature): boolean {
  if (state.winner !== null || state.turn !== creature.side) return false;
  if (state.feast?.creatureId === creature.id && creature.side === 'player') return true;
  if (state.ap < 1) return false;
  if (!creature.acted) return true;
  // Блицкриг (9.2): зафиксированное существо действует до 5 раз.
  const blitz = state.karma.blitzkrieg;
  return creature.side === 'player' && blitz !== null && blitz.creatureId === creature.id && blitz.actionsLeft > 0;
}

/** Депрессия (7.5): дальность Стражей и Иерофантов игрока = 1. */
function isDepressed(state: BattleState, creature: Creature): boolean {
  return creature.side === 'player' && state.karma.depressionTurns > 0 && RANK_OF[creature.kind] !== 'triangle';
}

function rangeFor(state: BattleState, creature: Creature, mode: 'move' | 'attack'): number {
  if (isDepressed(state, creature)) return 1;
  const rank = RANK_OF[creature.kind];
  if (rank === 'triangle') {
    return mode === 'move' && creature.kind === 'acolyte' ? acolyteMoveRange(state.relics) : 1;
  }
  if (rank === 'square') {
    return mode === 'move' && creature.kind === 'warden' ? wardenMoveRange(state.relics) : 3;
  }
  return 5;
}

/**
 * Панцирь: бронированный квадрат. Бьёт только круг (Иерофант, Круг, босс).
 * Черта сохраняется при смене стороны.
 */
function canBeAttackedBy(target: Creature, attacker: Creature): boolean {
  if (target.kind === 'shell' && RANK_OF[attacker.kind] !== 'circle') return false;
  return true;
}

/**
 * Чистая геометрия досягаемости без проверки очереди/ОД — нужна ИИ для
 * гипотетических позиций. `creatures` может быть изменённым списком.
 */
export function reachableCells(
  state: BattleState,
  creatures: Creature[],
  creature: Creature,
  mode: 'move' | 'attack'
): Cell[] {
  const blocked = blockedCells(state);
  const max = rangeFor(state, creature, mode);
  const cells: Cell[] = [];
  for (const dir of directionsFor(RANK_OF[creature.kind], creature.side, mode)) {
    const { emptyCells, firstOccupied } = walkDirection(creatures, creature.cell, dir, { blocked, max });
    if (mode === 'move') {
      cells.push(...emptyCells);
    } else if (firstOccupied) {
      const target = getCreatureAt(creatures, firstOccupied);
      if (target && target.side !== creature.side && canBeAttackedBy(target, creature)) cells.push(firstOccupied);
    }
  }
  return cells;
}

export function getLegalMoves(state: BattleState, id: Id): Cell[] {
  const creature = getCreatureById(state.creatures, id);
  if (!creature || !canCreatureAct(state, creature)) return [];
  if (state.feast?.creatureId === id) return [];
  return reachableCells(state, state.creatures, creature, 'move');
}

export function getLegalAttacks(state: BattleState, id: Id): Cell[] {
  const creature = getCreatureById(state.creatures, id);
  if (!creature || !canCreatureAct(state, creature)) return [];
  return reachableCells(state, state.creatures, creature, 'attack');
}

/** Клетки под ударом стороны (11.4) — без учёта очереди и «уже действовал». */
export function getThreatenedCells(state: BattleState, side: Side, creatures: Creature[] = state.creatures): Set<CellKey> {
  const threatened = new Set<CellKey>();
  for (const creature of creatures) {
    if (creature.side !== side) continue;
    for (const cell of reachableCells(state, creatures, creature, 'attack')) {
      threatened.add(`${cell.x},${cell.y}`);
    }
  }
  return threatened;
}

export function hasAnyLegalAction(state: BattleState, side: Side): boolean {
  if (state.ap < 1 && !state.feast) return false;
  for (const creature of state.creatures) {
    if (creature.side !== side) continue;
    if (!canCreatureAct(state, creature)) continue;
    if (reachableCells(state, state.creatures, creature, 'move').length > 0) return true;
    if (reachableCells(state, state.creatures, creature, 'attack').length > 0) return true;
  }
  return false;
}
