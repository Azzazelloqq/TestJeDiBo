import { createCreature } from './battle';
import type { BattleState, Cell, Creature, CreatureKind, Side } from './types';

/** Пустая арена (vestibule) с заданными существами — база для тестов 14.1. */
export function makeState(creatures: Creature[], overrides: Partial<BattleState> = {}): BattleState {
  return {
    arena: 'vestibule',
    turn: 'player',
    ap: 5,
    creatures,
    graveyard: { player: [], enemy: [] },
    playerTurnNumber: 1,
    enemyTurnNumber: 0,
    actionsTaken: 0,
    winner: null,
    cocoons: [],
    ember: { armed: null },
    pool: [],
    relics: [],
    karma: { pendingCard: null, blitzkrieg: null, depressionTurns: 0, discardMessage: null },
    bossPhase: 1,
    bossPhase2BaseTurn: null,
    firstBloodUsed: false,
    firstTurnApBonus: 0,
    spawnCounter: 0,
    lastDepressionTurn: 0,
    killStreak: 0,
    feast: null,
    extraBlocked: [],
    gestureDone: false,
    ...overrides,
  };
}

let counter = 0;

export function c(side: Side, kind: CreatureKind, x: number, y: number, marks = 0): Creature {
  counter += 1;
  return createCreature(`${side[0]}t${counter}`, side, kind, { x, y }, marks);
}

export function has(cells: Cell[], x: number, y: number): boolean {
  return cells.some((cell) => cell.x === x && cell.y === y);
}

/** Детерминированный rng: выдаёт значения по кругу. */
export function seqRng(values: number[]): () => number {
  let i = 0;
  return () => values[i++ % values.length];
}
