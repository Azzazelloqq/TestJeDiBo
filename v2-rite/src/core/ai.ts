import { isDepressionTurn, isEyePushTurn, isSummonTurn, pickEyePushTarget } from './battle';
import { getCreatureAt } from './board';
import { creatureValue } from './creatures';
import { canCreatureAct, reachableCells, getThreatenedCells } from './rules';
import { randInt, type BattleState, type Cell, type Creature, type Id } from './types';

export type AiDecision =
  | { kind: 'depression' }
  | { kind: 'push'; id: Id }
  | { kind: 'summon' }
  | { kind: 'attack'; id: Id; to: Cell }
  | { kind: 'move'; id: Id; to: Cell };

/** Оценка позиционного хода (10.2, шаг 3). Проверки «под атакой» — по состоянию после хода. */
function scoreMove(state: BattleState, creature: Creature, to: Cell, rng: (() => number) | null): number {
  const sim = state.creatures.map((c) => (c.id === creature.id ? { ...c, cell: { ...to } } : c));
  const moved = sim.find((c) => c.id === creature.id)!;

  const underAttackFrom = reachableCells(state, sim, moved, 'attack').length;
  const canReachRow7 = reachableCells(state, sim, moved, 'move').some((c) => c.y === 7);
  const playerThreat = getThreatenedCells(state, 'player', sim);
  const underPlayerAttack = playerThreat.has(`${to.x},${to.y}`);
  const attackerCount = underPlayerAttack ? countPlayerAttackersOf(state, sim, to) : 0;

  return (
    12 * (to.y - creature.cell.y) +
    30 * underAttackFrom +
    20 * (canReachRow7 ? 1 : 0) -
    25 * (underPlayerAttack ? creatureValue(creature.kind) / 10 : 0) -
    8 * (attackerCount >= 2 ? 1 : 0) +
    (rng ? randInt(0, 3, rng) : 0)
  );
}

function countPlayerAttackersOf(state: BattleState, creatures: Creature[], cell: Cell): number {
  let count = 0;
  for (const c of creatures) {
    if (c.side !== 'player') continue;
    if (reachableCells(state, creatures, c, 'attack').some((a) => a.x === cell.x && a.y === cell.y)) count += 1;
  }
  return count;
}

/**
 * Одно решение тварей за вызов (10.2): Депрессия/способности → убийство →
 * посвящение → позиционный ход. null — легальных действий нет.
 */
export function decideAiAction(state: BattleState, rng: () => number = Math.random): AiDecision | null {
  if (state.turn !== 'enemy' || state.winner !== null) return null;

  // Депрессия — до шага 1, не расходует ОД (10.3).
  if (isDepressionTurn(state) && state.lastDepressionTurn !== state.enemyTurnNumber) {
    return { kind: 'depression' };
  }

  if (state.ap < 1) return null;

  // Око: на каждом 3-м ходу толчок вместо шагов 1–3; невозможен — обычный алгоритм (10.3).
  const pushEye = isEyePushTurn(state)
    ? state.creatures.find((c) => c.side === 'enemy' && c.kind === 'eye' && !c.acted && pickEyePushTarget(state, c) !== null)
    : undefined;
  if (pushEye) return { kind: 'push', id: pushEye.id };

  // Проповедник (фаза II): каждый 2-й ход призывает вместо шагов 1–3 (7.5).
  if (isSummonTurn(state)) {
    const preacher = state.creatures.find((c) => c.side === 'enemy' && c.kind === 'preacher' && !c.acted);
    if (preacher) return { kind: 'summon' };
  }

  const actors = state.creatures.filter((c) => c.side === 'enemy' && canCreatureAct(state, c));

  // Шаг 1: убийство с максимальной ценностью; при равенстве — цель с наименьшим y.
  let bestAttack: { id: Id; to: Cell; value: number } | null = null;
  for (const c of actors) {
    for (const to of reachableCells(state, state.creatures, c, 'attack')) {
      const target = getCreatureAt(state.creatures, to);
      if (!target) continue;
      const value = creatureValue(target.kind);
      if (!bestAttack || value > bestAttack.value || (value === bestAttack.value && to.y < bestAttack.to.y)) {
        bestAttack = { id: c.id, to, value };
      }
    }
  }
  if (bestAttack) return { kind: 'attack', id: bestAttack.id, to: bestAttack.to };

  // Шаг 2: посвящение — одно движение до y=7.
  for (const c of actors) {
    for (const to of reachableCells(state, state.creatures, c, 'move')) {
      if (to.y === 7) return { kind: 'move', id: c.id, to };
    }
  }

  // Шаг 3: лучший позиционный ход.
  let best: { id: Id; to: Cell; score: number } | null = null;
  for (const c of actors) {
    for (const to of reachableCells(state, state.creatures, c, 'move')) {
      const score = scoreMove(state, c, to, rng);
      if (!best || score > best.score) best = { id: c.id, to, score };
    }
  }
  if (best) return { kind: 'move', id: best.id, to: best.to };

  return null;
}

// ---------- Намерения (10.4) ----------

export type Intent =
  | { kind: 'attack'; target: Cell }
  | { kind: 'move'; to: Cell }
  | { kind: 'ability' }
  | { kind: 'none' };

/**
 * Первое действие каждой конкретной твари по алгоритму 10.2 на текущем
 * состоянии. Пересчитывается после каждого действия игрока.
 */
export function computeIntents(state: BattleState): Map<Id, Intent> {
  const intents = new Map<Id, Intent>();
  if (state.winner !== null) return intents;

  // Намерения показываются на ход тварей, который наступит следующим.
  const nextEnemyTurn = state.turn === 'player' ? state.enemyTurnNumber + 1 : state.enemyTurnNumber;
  const probe: BattleState = { ...state, enemyTurnNumber: nextEnemyTurn };

  for (const c of state.creatures) {
    if (c.side !== 'enemy') continue;

    if (c.kind === 'eye' && isEyePushTurn(probe) && pickEyePushTarget(state, c) !== null) {
      intents.set(c.id, { kind: 'ability' });
      continue;
    }
    if (c.kind === 'preacher' && (isDepressionTurn(probe) || isSummonTurn(probe))) {
      intents.set(c.id, { kind: 'ability' });
      continue;
    }

    // Атака: своя лучшая цель.
    let bestAttack: { to: Cell; value: number } | null = null;
    for (const to of reachableCells(state, state.creatures, c, 'attack')) {
      const target = getCreatureAt(state.creatures, to);
      if (!target) continue;
      const value = creatureValue(target.kind);
      if (!bestAttack || value > bestAttack.value || (value === bestAttack.value && to.y < bestAttack.to.y)) {
        bestAttack = { to, value };
      }
    }
    if (bestAttack) {
      intents.set(c.id, { kind: 'attack', target: bestAttack.to });
      continue;
    }

    const moves = reachableCells(state, state.creatures, c, 'move');
    const toRow7 = moves.find((m) => m.y === 7);
    if (toRow7) {
      intents.set(c.id, { kind: 'move', to: toRow7 });
      continue;
    }

    let best: { to: Cell; score: number } | null = null;
    for (const to of moves) {
      const score = scoreMove(state, c, to, null); // без случайности — намерение стабильно
      if (!best || score > best.score) best = { to, score };
    }
    intents.set(c.id, best ? { kind: 'move', to: best.to } : { kind: 'none' });
  }
  return intents;
}
