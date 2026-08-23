export type Side = 'player' | 'enemy';

/** Внутренние имена рангов. В интерфейсе они никогда не показываются (1.1). */
export type Rank = 'triangle' | 'square' | 'circle';

export type PlayerKind = 'warden' | 'hierophant';
export type EnemyKind = 'brute' | 'shell' | 'eye' | 'preacher';
export type CreatureKind = PlayerKind | EnemyKind;

export interface Cell {
  x: number;
  y: number;
}

export type Id = string;
export type CellKey = string;

export interface Creature {
  id: Id;
  side: Side;
  kind: CreatureKind;
  cell: Cell;
  acted: boolean;
  /** Метки за пережитые бои (7.1), максимум 5. Только у ордена. */
  marks: number;
}

export type CardId = 'deathline' | 'barrage' | 'spy' | 'blitzkrieg' | 'resurrection';
export const ALL_CARD_IDS: CardId[] = ['deathline', 'barrage', 'spy', 'blitzkrieg', 'resurrection'];

export type RelicId =
  | 'boneKey' // Костяной ключ
  | 'pilgrimSandals' // Сандалии пилигрима
  | 'firstBlood' // Первая кровь
  | 'reliquary' // Реликварий
  | 'ashenCrown' // Пепельный венец
  | 'thornRim' // Терновый обод
  | 'vigilCandle' // Свеча бдения
  | 'returnSeal'; // Печать возврата

export const ALL_RELIC_IDS: RelicId[] = [
  'boneKey',
  'pilgrimSandals',
  'firstBlood',
  'reliquary',
  'ashenCrown',
  'thornRim',
  'vigilCandle',
  'returnSeal',
];

export type ArenaId = 'vestibule' | 'well' | 'brazier' | 'rift' | 'gallery' | 'choir' | 'altar';

export interface Cocoon {
  cell: Cell;
  /** Кокон снимается в начале этого хода игрока (7.3: живёт 3 хода игрока). */
  expiresOnPlayerTurn: number;
}

/** Окно Блицкрига (9.2). Живёт до конца хода игрока, в который разыграно. */
export interface BlitzkriegWindow {
  /** Существо, на котором эффект зафиксировался; null, пока игрок не начал действовать. */
  creatureId: Id | null;
  actionsLeft: number;
}

export interface KarmaState {
  pendingCard: CardId | null;
  blitzkrieg: BlitzkriegWindow | null;
  /** Депрессия босса (7.5): дальность Стражей и Иерофантов игрока = 1, осталось ходов игрока. */
  depressionTurns: number;
  discardMessage: string | null;
}

export interface EmberState {
  /** Помеченная к вспышке клетка Жаровни (8.1); вспыхнет в начале следующего хода игрока. */
  armed: Cell | null;
}

export type Winner = Side | null;

export interface BattleState {
  arena: ArenaId;
  turn: Side;
  ap: number;
  creatures: Creature[];
  graveyard: { player: Creature[]; enemy: Creature[] };
  playerTurnNumber: number;
  enemyTurnNumber: number;
  actionsTaken: number;
  winner: Winner;
  cocoons: Cocoon[];
  ember: EmberState;
  /** Пул Карт Кармы в этом бою (пул рана + временные от Реликвария). */
  pool: CardId[];
  relics: RelicId[];
  karma: KarmaState;
  bossPhase: 1 | 2;
  /** Номер хода тварей, в который произошёл переход в фазу II. */
  bossPhase2BaseTurn: number | null;
  /** Первая кровь уже использована в этом бою. */
  firstBloodUsed: boolean;
  /** Бонус ОД первого хода игрока (Хор в стене: +2). */
  firstTurnApBonus: number;
  /** Счётчик id для призванных существ. */
  spawnCounter: number;
  /** Ход тварей, в который Проповедник уже разыграл Депрессию. */
  lastDepressionTurn: number;
  /** Убийства тварей за текущий ход игрока (комбо). */
  killStreak: number;
}

export type BattleEvent =
  | { t: 'moved'; id: Id; from: Cell; to: Cell }
  | { t: 'killed'; id: Id; at: Cell; kind: CreatureKind; side: Side }
  | { t: 'attacked'; id: Id; from: Cell; to: Cell }
  | { t: 'ordained'; id: Id; from: Rank; to: Rank; at: Cell; placedAt: Cell }
  | { t: 'ordainCancelled'; id: Id; at: Cell }
  | { t: 'apSpent'; left: number }
  | { t: 'cardDrawn'; card: CardId }
  | { t: 'cardPlayed'; card: CardId | 'depression'; payload?: unknown }
  | { t: 'cardDiscarded'; card: CardId }
  | { t: 'captured'; id: Id; at: Cell }
  | { t: 'spawned'; id: Id; kind: CreatureKind; at: Cell }
  | { t: 'blocked'; at: Cell; source: 'cocoon' | 'arena'; turns?: number }
  | { t: 'unblocked'; at: Cell }
  | { t: 'pushed'; id: Id; from: Cell; to: Cell }
  | { t: 'stunned'; id: Id; at: Cell }
  | { t: 'combo'; count: number }
  | { t: 'finisher'; at: Cell; kind: CreatureKind }
  | { t: 'emberArmed'; at: Cell }
  | { t: 'emberFired'; at: Cell }
  | { t: 'bossPhase'; phase: 2 }
  | { t: 'relicFired'; relic: RelicId }
  | { t: 'turnEnded'; side: Side }
  | { t: 'battleWon' }
  | { t: 'battleLost' };

export const BOARD_SIZE = 8;
export const BASE_AP = 5;

export function randInt(a: number, b: number, rng: () => number = Math.random): number {
  return a + Math.floor(rng() * (b - a + 1));
}
