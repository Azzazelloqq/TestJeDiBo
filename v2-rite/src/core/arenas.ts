import type { ArenaId, Cell, EnemyKind } from './types';

export interface ArenaDef {
  id: ArenaId;
  name: string;
  /** Непроходимые клетки арены (8). */
  blocked: Cell[];
  /** Цвет освещения — радиальный градиент от центра (11.3). */
  light: string;
  /** Клетки Жаровни (8.1) — только у арены brazier. */
  emberCells: Cell[];
}

const c = (x: number, y: number): Cell => ({ x, y });

export const ARENAS: Record<ArenaId, ArenaDef> = {
  vestibule: { id: 'vestibule', name: 'Преддверие', blocked: [], light: 'rgba(255,240,220,0.06)', emberCells: [] },
  well: { id: 'well', name: 'Колодец', blocked: [c(3, 3), c(4, 4)], light: 'rgba(255,240,220,0.05)', emberCells: [] },
  brazier: {
    id: 'brazier',
    name: 'Жаровня',
    blocked: [],
    light: 'rgba(255,200,150,0.07)',
    emberCells: [c(2, 2), c(5, 2), c(2, 5), c(5, 5), c(3, 3), c(4, 4)],
  },
  rift: { id: 'rift', name: 'Провал', blocked: [c(3, 3), c(4, 3), c(3, 4), c(4, 4)], light: 'rgba(200,220,255,0.05)', emberCells: [] },
  gallery: { id: 'gallery', name: 'Галерея', blocked: [c(0, 3), c(7, 3), c(0, 4), c(7, 4)], light: 'rgba(220,220,240,0.05)', emberCells: [] },
  choir: { id: 'choir', name: 'Хор', blocked: [c(2, 2), c(5, 2), c(2, 5), c(5, 5)], light: 'rgba(230,220,255,0.06)', emberCells: [] },
  altar: { id: 'altar', name: 'Алтарь', blocked: [c(0, 0), c(7, 0)], light: 'rgba(255,240,220,0.06)', emberCells: [] },
};

/** Свет арены после фазы II босса (8, 7.5). */
export const BOSS_PHASE2_LIGHT = 'rgba(140,28,19,0.10)';

export interface EnemySpawn {
  kind: EnemyKind;
  cell: Cell;
}

export type BattleId = 'L1' | 'L2B' | 'L3' | 'L4A' | 'L6A' | 'doors' | 'L8' | 'L9';

export interface BattleDef {
  id: BattleId;
  arena: ArenaId;
  enemies: EnemySpawn[];
  elite: boolean;
  boss: boolean;
  /** Бой из события «Три двери» — без награды. */
  noReward: boolean;
}

const spawn = (kind: EnemyKind, x: number, y: number): EnemySpawn => ({ kind, cell: c(x, y) });

/** Составы боёв: только квадрат, панцирь, круг и босс. */
export const BATTLES: Record<BattleId, BattleDef> = {
  L1: {
    id: 'L1',
    arena: 'vestibule',
    enemies: [spawn('brute', 2, 1), spawn('brute', 3, 1), spawn('brute', 5, 1)],
    elite: false,
    boss: false,
    noReward: false,
  },
  L2B: {
    id: 'L2B',
    arena: 'well',
    enemies: [spawn('brute', 1, 1), spawn('brute', 6, 1), spawn('shell', 3, 0)],
    elite: false,
    boss: false,
    noReward: false,
  },
  L3: {
    id: 'L3',
    arena: 'brazier',
    enemies: [spawn('brute', 1, 1), spawn('brute', 6, 1), spawn('shell', 3, 0), spawn('eye', 4, 0)],
    elite: false,
    boss: false,
    noReward: false,
  },
  L4A: {
    id: 'L4A',
    arena: 'rift',
    enemies: [spawn('brute', 1, 1), spawn('brute', 6, 1), spawn('shell', 2, 0), spawn('shell', 5, 0), spawn('eye', 4, 0)],
    elite: true,
    boss: false,
    noReward: false,
  },
  L6A: {
    id: 'L6A',
    arena: 'gallery',
    enemies: [spawn('brute', 2, 1), spawn('brute', 5, 1), spawn('shell', 3, 0), spawn('eye', 4, 0)],
    elite: false,
    boss: false,
    noReward: false,
  },
  doors: {
    id: 'doors',
    arena: 'gallery',
    enemies: [spawn('brute', 2, 1), spawn('brute', 5, 1), spawn('shell', 4, 0)],
    elite: false,
    boss: false,
    noReward: true,
  },
  L8: {
    id: 'L8',
    arena: 'choir',
    enemies: [spawn('brute', 1, 1), spawn('brute', 6, 1), spawn('shell', 3, 0), spawn('shell', 4, 0), spawn('eye', 2, 0), spawn('eye', 5, 0)],
    elite: false,
    boss: false,
    noReward: false,
  },
  L9: {
    id: 'L9',
    arena: 'altar',
    enemies: [spawn('brute', 1, 1), spawn('brute', 6, 1), spawn('shell', 2, 0), spawn('shell', 5, 0), spawn('preacher', 3, 0)],
    elite: false,
    boss: true,
    noReward: false,
  },
};
