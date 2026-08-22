import { ARENAS } from './arenas';
import { RANK_OF } from './creatures';
import { BOARD_SIZE, type BattleState, type Cell, type CellKey, type Creature, type Id, type Rank, type Side } from './types';

export function inBounds(cell: Cell): boolean {
  return cell.x >= 0 && cell.x < BOARD_SIZE && cell.y >= 0 && cell.y < BOARD_SIZE;
}

export function cellEquals(a: Cell, b: Cell): boolean {
  return a.x === b.x && a.y === b.y;
}

export function cellKey(cell: Cell): CellKey {
  return `${cell.x},${cell.y}`;
}

/** «Вперёд» (6.1): орден к y=0, твари к y=7. */
export function forwardDy(side: Side): 1 | -1 {
  return side === 'player' ? -1 : 1;
}

export function ordinationRow(side: Side): number {
  return side === 'player' ? 0 : 7;
}

/** Ряды размещения при посвящении/воскрешении (6.7): зона + резерв. */
export function placementRows(side: Side): number[] {
  return side === 'player' ? [7, 6, 5] : [0, 1, 2];
}

export function getCreatureAt(creatures: Creature[], cell: Cell): Creature | undefined {
  return creatures.find((c) => cellEquals(c.cell, cell));
}

export function getCreatureById(creatures: Creature[], id: Id): Creature | undefined {
  return creatures.find((c) => c.id === id);
}

/** Единый механизм непроходимых клеток (6.5): клетки арены + коконы. */
export function blockedCells(state: BattleState): Set<CellKey> {
  const set = new Set<CellKey>();
  for (const cell of ARENAS[state.arena].blocked) set.add(cellKey(cell));
  for (const cocoon of state.cocoons) set.add(cellKey(cocoon.cell));
  return set;
}

/**
 * Направления движения/атаки ранга (6.5): у Треугольника движение — только
 * вперёд, атака — вперёд и вперёд по диагонали. Квадрат — 5 направлений,
 * Круг — все 8, для обоих режимы совпадают.
 */
export function directionsFor(rank: Rank, side: Side, mode: 'move' | 'attack'): Cell[] {
  const f = forwardDy(side);
  switch (rank) {
    case 'triangle':
      if (mode === 'move') return [{ x: 0, y: f }];
      return [
        { x: 0, y: f },
        { x: -1, y: f },
        { x: 1, y: f },
      ];
    case 'square':
      return [
        { x: 0, y: f },
        { x: -1, y: f },
        { x: 1, y: f },
        { x: -1, y: 0 },
        { x: 1, y: 0 },
      ];
    case 'circle':
      return [
        { x: 0, y: f },
        { x: -1, y: f },
        { x: 1, y: f },
        { x: -1, y: 0 },
        { x: 1, y: 0 },
        { x: -1, y: -f },
        { x: 1, y: -f },
        { x: 0, y: -f },
      ];
  }
}

export interface WalkOptions {
  blocked: Set<CellKey>;
  max: number;
}

/**
 * Идёт по прямой от `from`, останавливаясь на первом препятствии (6.5).
 * Возвращает пустые проходимые клетки (цели движения) и первую занятую
 * существом клетку (цель атаки). Непроходимая клетка обрывает луч для обоих
 * режимов: через неё нельзя ни пройти, ни атаковать.
 */
export function walkDirection(
  creatures: Creature[],
  from: Cell,
  dir: Cell,
  opts: WalkOptions
): { emptyCells: Cell[]; firstOccupied: Cell | null } {
  const emptyCells: Cell[] = [];
  let firstOccupied: Cell | null = null;
  for (let step = 1; step <= opts.max; step++) {
    const cell: Cell = { x: from.x + dir.x * step, y: from.y + dir.y * step };
    if (!inBounds(cell)) break;
    if (opts.blocked.has(cellKey(cell))) break;
    const occupant = getCreatureAt(creatures, cell);
    if (occupant) {
      firstOccupied = cell;
      break;
    }
    emptyCells.push(cell);
  }
  return { emptyCells, firstOccupied };
}

/**
 * Обход восьми соседей (7.3): вверх, вправо-вверх, вправо, вправо-вниз,
 * вниз, влево-вниз, влево, влево-вверх.
 */
export const NEIGHBOR_ORDER: Cell[] = [
  { x: 0, y: -1 },
  { x: 1, y: -1 },
  { x: 1, y: 0 },
  { x: 1, y: 1 },
  { x: 0, y: 1 },
  { x: -1, y: 1 },
  { x: -1, y: 0 },
  { x: -1, y: -1 },
];

/** Первая свободная соседняя клетка по обходу 7.3 (или null). */
export function firstFreeNeighbor(state: BattleState, around: Cell): Cell | null {
  const blocked = blockedCells(state);
  for (const d of NEIGHBOR_ORDER) {
    const cell = { x: around.x + d.x, y: around.y + d.y };
    if (!inBounds(cell)) continue;
    if (blocked.has(cellKey(cell))) continue;
    if (getCreatureAt(state.creatures, cell)) continue;
    return cell;
  }
  return null;
}

/**
 * Первая свободная клетка размещения (6.7): y=7 слева направо, затем y=6,
 * затем y=5 (для тварей зеркально). Непроходимые клетки пропускаются.
 */
export function findPlacementSlot(state: BattleState, side: Side): Cell | null {
  const blocked = blockedCells(state);
  for (const y of placementRows(side)) {
    for (let x = 0; x < BOARD_SIZE; x++) {
      const cell = { x, y };
      if (blocked.has(cellKey(cell))) continue;
      if (getCreatureAt(state.creatures, cell)) continue;
      return cell;
    }
  }
  return null;
}

/** Порядок массовой гибели (7.3): по возрастанию x, при равенстве — y. */
export function sortForMassDeath(creatures: Creature[]): Creature[] {
  return [...creatures].sort((a, b) => a.cell.x - b.cell.x || a.cell.y - b.cell.y);
}

export function manhattan(a: Cell, b: Cell): number {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}

export { RANK_OF };
