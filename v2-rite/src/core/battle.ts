import { ARENAS, type BattleDef } from './arenas';
import {
  blockedCells,
  cellEquals,
  cellKey,
  findPlacementSlot,
  firstFreeNeighbor,
  getCreatureAt,
  getCreatureById,
  manhattan,
  ordinationRow,
  sortForMassDeath,
} from './board';
import { RANK_OF, creatureValue, ordainedEnemyKind, ordainedPlayerKind } from './creatures';
import { apPerTurn, karmaPeriod } from './relics';
import { getLegalAttacks, getLegalMoves, hasAnyLegalAction } from './rules';
import {
  ALL_CARD_IDS,
  randInt,
  type BattleEvent,
  type BattleState,
  type CardId,
  type Cell,
  type Creature,
  type CreatureKind,
  type Id,
  type RelicId,
  type Side,
} from './types';

export interface Result {
  state: BattleState;
  events: BattleEvent[];
}

export function createCreature(id: Id, side: Side, kind: CreatureKind, cell: Cell, marks = 0): Creature {
  return { id, side, kind, cell: { ...cell }, acted: false, marks };
}

/** Слоты расстановки ордена (6.2), одна очередь. */
const PLAYER_SLOTS: Cell[] = [
  ...[2, 5, 3, 4, 1, 6, 0, 7].map((x) => ({ x, y: 7 })),
  ...[2, 3, 4, 5, 1, 6, 0, 7].map((x) => ({ x, y: 6 })),
  ...[2, 3, 4, 5, 1, 6, 0, 7].map((x) => ({ x, y: 5 })),
];

const RANK_ORDER: Record<string, number> = { circle: 3, square: 2, triangle: 1 };

export interface OrderMember {
  id: Id;
  kind: CreatureKind;
  marks: number;
}

/** Расстановка ордена (6.2): сортировка по убыванию ранга, слоты по очереди, непроходимые пропускаются. */
export function placeOrder(order: OrderMember[], blockedSet: Set<string>): Creature[] {
  const sorted = [...order].sort((a, b) => RANK_ORDER[RANK_OF[b.kind]] - RANK_ORDER[RANK_OF[a.kind]]);
  const result: Creature[] = [];
  let slotIdx = 0;
  for (const member of sorted) {
    while (slotIdx < PLAYER_SLOTS.length && blockedSet.has(cellKey(PLAYER_SLOTS[slotIdx]))) slotIdx++;
    if (slotIdx >= PLAYER_SLOTS.length) break;
    result.push(createCreature(member.id, 'player', member.kind, PLAYER_SLOTS[slotIdx], member.marks));
    slotIdx++;
  }
  return result;
}

export function createBattle(
  order: OrderMember[],
  def: BattleDef,
  relics: RelicId[],
  pool: CardId[],
  firstTurnApBonus: number,
  rng: () => number = Math.random
): Result {
  const arena = ARENAS[def.arena];
  const blockedSet = new Set(arena.blocked.map(cellKey));
  const players = placeOrder(order, blockedSet);

  let spawns = def.enemies;
  const events: BattleEvent[] = [];
  // Пепельный венец (5): одна случайная Личинка врага не появляется.
  if (relics.includes('ashenCrown')) {
    const larvaIdxs = spawns.map((s, i) => (s.kind === 'larva' ? i : -1)).filter((i) => i >= 0);
    if (larvaIdxs.length > 0) {
      const skip = larvaIdxs[randInt(0, larvaIdxs.length - 1, rng)];
      spawns = spawns.filter((_, i) => i !== skip);
      events.push({ t: 'relicFired', relic: 'ashenCrown' });
    }
  }
  const enemies = spawns.map((s, i) => createCreature(`e${i + 1}`, 'enemy', s.kind, s.cell));

  const state: BattleState = {
    arena: def.arena,
    turn: 'player',
    ap: apPerTurn(relics) + firstTurnApBonus,
    creatures: [...players, ...enemies],
    graveyard: { player: [], enemy: [] },
    playerTurnNumber: 1,
    enemyTurnNumber: 0,
    actionsTaken: 0,
    winner: null,
    cocoons: [],
    ember: { armed: null },
    pool: [...pool],
    relics: [...relics],
    karma: { pendingCard: null, blitzkrieg: null, depressionTurns: 0, discardMessage: null },
    bossPhase: 1,
    bossPhase2BaseTurn: null,
    firstBloodUsed: false,
    firstTurnApBonus,
    spawnCounter: 0,
    lastDepressionTurn: 0,
  };
  return { state, events };
}

export function checkWinLoss(state: BattleState): BattleEvent[] {
  if (state.winner !== null) return [];
  const enemyAlive = state.creatures.some((c) => c.side === 'enemy');
  const playerAlive = state.creatures.some((c) => c.side === 'player');
  // 17: Линия смерти убила всех с обеих сторон — побеждает игрок.
  if (!enemyAlive) {
    state.winner = 'player';
    return [{ t: 'battleWon' }];
  }
  if (!playerAlive) {
    state.winner = 'enemy';
    return [{ t: 'battleLost' }];
  }
  return [];
}

/**
 * Уничтожение существ с чертами «при гибели» (7.3). Черты срабатывают всегда,
 * от любого источника; при массовой гибели — по возрастанию x, затем y.
 * Терновый обод может добить соседнюю тварь — её черта тоже срабатывает.
 */
export function destroyCreatures(state: BattleState, targets: Creature[], events: BattleEvent[]): void {
  for (const victim of sortForMassDeath(targets)) {
    if (!state.creatures.some((c) => c.id === victim.id)) continue; // уже погиб в каскаде
    state.creatures = state.creatures.filter((c) => c.id !== victim.id);
    state.graveyard[victim.side].push(victim);
    events.push({ t: 'killed', id: victim.id, at: { ...victim.cell }, kind: victim.kind, side: victim.side });
    runDeathTraits(state, victim, events);
  }
  checkBossPhase(state, events);
}

function firstAdjacentEnemy(state: BattleState, around: Cell): Creature | null {
  const order: Cell[] = [
    { x: 0, y: -1 },
    { x: 1, y: -1 },
    { x: 1, y: 0 },
    { x: 1, y: 1 },
    { x: 0, y: 1 },
    { x: -1, y: 1 },
    { x: -1, y: 0 },
    { x: -1, y: -1 },
  ];
  for (const d of order) {
    const found = getCreatureAt(state.creatures, { x: around.x + d.x, y: around.y + d.y });
    if (found && found.side === 'enemy') return found;
  }
  return null;
}

/** Фаза II (7.5): немедленно, когда в свите остаётся 3 или меньше. */
function checkBossPhase(state: BattleState, events: BattleEvent[]): void {
  if (state.bossPhase !== 1) return;
  const preacher = state.creatures.find((c) => c.side === 'enemy' && c.kind === 'preacher');
  if (!preacher) return;
  const retinue = state.creatures.filter((c) => c.side === 'enemy' && c.kind !== 'preacher').length;
  if (retinue <= 3) {
    state.bossPhase = 2;
    state.bossPhase2BaseTurn = state.enemyTurnNumber;
    events.push({ t: 'bossPhase', phase: 2 });
  }
}

/**
 * Посвящение (6.7): все существа на своих линиях, по возрастанию x (9.3).
 * Иерофант остаётся на линии. Нет свободных клеток — отменяется.
 */
export function resolveOrdinations(state: BattleState, events: BattleEvent[], rng: () => number = Math.random): void {
  const onLine = state.creatures
    .filter((c) => c.cell.y === ordinationRow(c.side))
    .sort((a, b) => a.cell.x - b.cell.x);
  for (const creature of onLine) {
    const nextKind = creature.side === 'player' ? ordainedPlayerKind(creature.kind) : ordainedEnemyKind(creature.kind);
    if (!nextKind) continue;
    const slot = findPlacementSlot(state, creature.side);
    if (!slot) {
      events.push({ t: 'ordainCancelled', id: creature.id, at: { ...creature.cell } });
      continue;
    }
    const fromRank = RANK_OF[creature.kind];
    const at = { ...creature.cell };
    creature.kind = nextKind;
    creature.cell = { ...slot };
    creature.acted = true; // в этот ход больше не действует
    events.push({ t: 'ordained', id: creature.id, from: fromRank, to: RANK_OF[nextKind], at, placedAt: { ...slot } });

    // Блицкриг обрывается, если существо посвятилось (9.2).
    if (state.karma.blitzkrieg?.creatureId === creature.id) state.karma.blitzkrieg = null;

    // Реликварий (5): за каждое посвящение — случайная карта в пул до конца боя.
    if (creature.side === 'player' && state.relics.includes('reliquary')) {
      const card = ALL_CARD_IDS[randInt(0, ALL_CARD_IDS.length - 1, rng)];
      state.pool.push(card);
      events.push({ t: 'relicFired', relic: 'reliquary' });
    }
  }
}

/** Регистрирует действие в окне Блицкрига. Возвращает true, если существо может действовать дальше. */
function consumeBlitz(state: BattleState, id: Id): boolean {
  const blitz = state.karma.blitzkrieg;
  if (!blitz) return false;
  if (blitz.creatureId === null) {
    blitz.creatureId = id;
    blitz.actionsLeft = 4; // это действие — первое из пяти
    return true;
  }
  if (blitz.creatureId !== id) {
    state.karma.blitzkrieg = null; // подействовал другим существом — эффект обрывается
    return false;
  }
  blitz.actionsLeft -= 1;
  if (blitz.actionsLeft <= 0) state.karma.blitzkrieg = null;
  return state.karma.blitzkrieg !== null;
}

function beginTurn(state: BattleState, side: Side, events: BattleEvent[], rng: () => number): void {
  state.turn = side;
  state.actionsTaken = 0;
  for (const c of state.creatures) if (c.side === side) c.acted = false;

  if (side === 'player') {
    state.playerTurnNumber += 1;
    state.ap = apPerTurn(state.relics);
    state.karma.blitzkrieg = null;
    state.karma.discardMessage = null;

    // Коконы: снимаются в начале хода игрока, когда прожили 3 его хода.
    const expired = state.cocoons.filter((c) => state.playerTurnNumber >= c.expiresOnPlayerTurn);
    state.cocoons = state.cocoons.filter((c) => state.playerTurnNumber < c.expiresOnPlayerTurn);
    for (const c of expired) events.push({ t: 'unblocked', at: { ...c.cell } });

    // Жаровня (8.1): помеченная клетка вспыхивает в начале следующего хода игрока.
    if (state.ember.armed) {
      const at = { ...state.ember.armed };
      state.ember.armed = null;
      events.push({ t: 'emberFired', at });
      const victim = getCreatureAt(state.creatures, at);
      if (victim) destroyCreatures(state, [victim], events);
      // 17: клетка Жаровни под коконом — вспышка уничтожает кокон.
      const cocoonHit = state.cocoons.find((c) => cellEquals(c.cell, at));
      if (cocoonHit) {
        state.cocoons = state.cocoons.filter((c) => c !== cocoonHit);
        events.push({ t: 'unblocked', at });
      }
    }
    // Каждый 3-й ход игрока — пометка новой клетки.
    if (state.arena === 'brazier' && state.playerTurnNumber % 3 === 0) {
      const cells = ARENAS.brazier.emberCells;
      const armed = cells[randInt(0, cells.length - 1, rng)];
      state.ember.armed = { ...armed };
      events.push({ t: 'emberArmed', at: { ...armed } });
    }

    // Период Кармы (9.1): карта тянется в начале последнего хода периода.
    const period = karmaPeriod(state.relics);
    if (state.karma.pendingCard === null && state.pool.length > 0 && state.playerTurnNumber % period === 0) {
      const card = state.pool[randInt(0, state.pool.length - 1, rng)];
      state.karma.pendingCard = card;
      events.push({ t: 'cardDrawn', card });
    }
  } else {
    state.enemyTurnNumber += 1;
    state.ap = 5;
  }
}

const MAX_AUTO_PASSES = 8;

export function endTurnAndAdvance(state: BattleState, rng: () => number = Math.random, depth = 0): BattleEvent[] {
  const events: BattleEvent[] = [{ t: 'turnEnded', side: state.turn }];

  if (state.turn === 'player') {
    // Неразыгранная карта сбрасывается в конце периода (9.1) — то есть в конце хода прихода.
    if (state.karma.pendingCard) {
      events.push({ t: 'cardDiscarded', card: state.karma.pendingCard });
      state.karma.pendingCard = null;
    }
    state.karma.blitzkrieg = null;
    if (state.karma.depressionTurns > 0) state.karma.depressionTurns -= 1;
  }

  const nextSide: Side = state.turn === 'player' ? 'enemy' : 'player';
  beginTurn(state, nextSide, events, rng);

  // Проигрыш от вспышки Жаровни и т.п. в начале хода.
  events.push(...checkWinLoss(state));
  if (state.winner !== null) return events;

  // 17: нет легальных действий — ход переходит дальше, поражения нет.
  if (depth < MAX_AUTO_PASSES && !hasAnyLegalAction(state, nextSide)) {
    return [...events, ...endTurnAndAdvance(state, rng, depth + 1)];
  }
  return events;
}

function maybeAutoEndTurn(state: BattleState, rng: () => number): BattleEvent[] {
  if (state.winner !== null) return [];
  if (state.ap >= 1 && hasAnyLegalAction(state, state.turn)) return [];
  return endTurnAndAdvance(state, rng);
}

export function applyMove(state: BattleState, id: Id, to: Cell, rng: () => number = Math.random): Result {
  const legal = getLegalMoves(state, id);
  if (!legal.some((c) => cellEquals(c, to))) throw new Error(`illegal move: ${id} -> (${to.x},${to.y})`);

  const next = structuredClone(state);
  const events: BattleEvent[] = [];
  const creature = getCreatureById(next.creatures, id)!;
  const from = { ...creature.cell };

  if (next.turn === 'player') consumeBlitz(next, id);
  creature.cell = { ...to };
  creature.acted = true; // блиц-окно учитывается в canCreatureAct
  next.ap -= 1;
  next.actionsTaken += 1;
  events.push({ t: 'moved', id, from, to: { ...to } }, { t: 'apSpent', left: next.ap });

  resolveOrdinations(next, events, rng);
  events.push(...checkWinLoss(next));
  if (next.winner === null) events.push(...maybeAutoEndTurn(next, rng));
  return { state: next, events };
}

export function applyAttack(state: BattleState, id: Id, to: Cell, rng: () => number = Math.random): Result {
  const legal = getLegalAttacks(state, id);
  if (!legal.some((c) => cellEquals(c, to))) throw new Error(`illegal attack: ${id} -> (${to.x},${to.y})`);

  const next = structuredClone(state);
  const events: BattleEvent[] = [];
  const attacker = getCreatureById(next.creatures, id)!;
  const from = { ...attacker.cell };
  const target = getCreatureAt(next.creatures, to)!;

  // Первая кровь (5): первое убийство игрока в бою стоит 1 ОД и не завершает ход.
  const firstBlood = next.turn === 'player' && next.relics.includes('firstBlood') && !next.firstBloodUsed;

  if (next.turn === 'player') {
    if (firstBlood) consumeBlitz(next, id);
    else next.karma.blitzkrieg = null; // атака завершает ход — окно сгорает
    next.firstBloodUsed = true; // первое убийство в бою совершено
  }

  // 6.6: цель уничтожается, атакующий занимает её клетку, потом черты.
  next.creatures = next.creatures.filter((c) => c.id !== target.id);
  next.graveyard[target.side].push(target);
  events.push({ t: 'killed', id: target.id, at: { ...to }, kind: target.kind, side: target.side });

  attacker.cell = { ...to };
  attacker.acted = true;
  events.push({ t: 'attacked', id, from, to: { ...to } });

  // Черты цели «при гибели» — после того, как атакующий занял клетку (17).
  runDeathTraits(next, target, events);

  if (firstBlood) {
    next.ap -= 1;
    events.push({ t: 'relicFired', relic: 'firstBlood' }, { t: 'apSpent', left: next.ap });
  } else {
    next.ap = 0;
    events.push({ t: 'apSpent', left: 0 });
  }
  next.actionsTaken += 1;

  // 6.6: посвящение до передачи хода.
  resolveOrdinations(next, events, rng);
  checkBossPhase(next, events);
  events.push(...checkWinLoss(next));
  if (next.winner === null) {
    if (firstBlood) events.push(...maybeAutoEndTurn(next, rng));
    else events.push(...endTurnAndAdvance(next, rng));
  }
  return { state: next, events };
}

/** Черты «при гибели» для существа, уже убранного с арены (атака, вспышка и т.п.). */
function runDeathTraits(state: BattleState, victim: Creature, events: BattleEvent[]): void {
  if (victim.kind === 'bellringer') {
    // Похоронный звон: существа противоположной стороны в соседних клетках
    // оглушены — в этот ход больше не действуют. Черта переживает смену стороны.
    for (const c of state.creatures) {
      if (c.side === victim.side || c.acted) continue;
      if (Math.abs(c.cell.x - victim.cell.x) > 1 || Math.abs(c.cell.y - victim.cell.y) > 1) continue;
      c.acted = true;
      events.push({ t: 'stunned', id: c.id, at: { ...c.cell } });
    }
  } else if (victim.kind === 'weaver') {
    const cell = firstFreeNeighbor(state, victim.cell);
    if (cell) {
      state.cocoons.push({ cell, expiresOnPlayerTurn: state.playerTurnNumber + 3 });
      events.push({ t: 'blocked', at: cell, source: 'cocoon', turns: 3 });
    }
  } else if (victim.kind === 'catcher') {
    const blocked = blockedCells(state);
    let cell: Cell | null = null;
    if (!getCreatureAt(state.creatures, victim.cell) && !blocked.has(cellKey(victim.cell))) cell = victim.cell;
    else cell = firstFreeNeighbor(state, victim.cell);
    if (cell) {
      state.spawnCounter++;
      const larva = createCreature(`s${state.spawnCounter}`, victim.side, 'larva', cell);
      larva.acted = true;
      state.creatures.push(larva);
      events.push({ t: 'spawned', id: larva.id, kind: 'larva', at: { ...cell } });
    }
  } else if (victim.kind === 'preacher') {
    state.karma.depressionTurns = 0;
  }

  if (victim.side === 'player' && state.relics.includes('thornRim')) {
    const neighbor = firstAdjacentEnemy(state, victim.cell);
    if (neighbor) {
      events.push({ t: 'relicFired', relic: 'thornRim' });
      destroyCreatures(state, [neighbor], events);
    }
  }
  checkBossPhase(state, events);
}

export function applyEndTurn(state: BattleState, rng: () => number = Math.random): Result {
  // 6.4: сторона обязана совершить хотя бы одно действие.
  if (state.actionsTaken < 1 || state.winner !== null) return { state, events: [] };
  const next = structuredClone(state);
  return { state: next, events: endTurnAndAdvance(next, rng) };
}

/** Принудительное завершение хода (ИИ без легальных действий). */
export function forceEndTurn(state: BattleState, rng: () => number = Math.random): Result {
  if (state.winner !== null) return { state, events: [] };
  const next = structuredClone(state);
  return { state: next, events: endTurnAndAdvance(next, rng) };
}

/** Толчок Ока (7.3). Возвращает null, если толчок невозможен. */
export function applyEyePush(state: BattleState, eyeId: Id, rng: () => number = Math.random): Result | null {
  const eye = getCreatureById(state.creatures, eyeId);
  if (!eye || eye.kind !== 'eye' || eye.acted || state.ap < 1) return null;

  const target = pickEyePushTarget(state, eye);
  if (!target) return null;

  const next = structuredClone(state);
  const events: BattleEvent[] = [];
  const victim = getCreatureById(next.creatures, target.id)!;
  const from = { ...victim.cell };
  const to = { x: from.x, y: from.y + 1 };
  victim.cell = to;
  const pusher = getCreatureById(next.creatures, eyeId)!;
  pusher.acted = true;
  next.ap -= 1;
  next.actionsTaken += 1;
  events.push({ t: 'pushed', id: victim.id, from, to: { ...to } }, { t: 'apSpent', left: next.ap });

  // Толкнутое существо ордена может оказаться на линии посвящения тварей — посвящения там нет (чужая линия).
  events.push(...maybeAutoEndTurn(next, rng));
  return { state: next, events };
}

/** Цель толчка (7.3): ближайшее существо ордена; при равенстве — наибольшая ценность. Толчок в сторону y+1. */
export function pickEyePushTarget(state: BattleState, eye: Creature): Creature | null {
  const blocked = blockedCells(state);
  const candidates = state.creatures
    .filter((c) => c.side === 'player')
    .map((c) => ({ c, dist: manhattan(c.cell, eye.cell), value: creatureValue(c.kind) }))
    .sort((a, b) => a.dist - b.dist || b.value - a.value);
  if (candidates.length === 0) return null;
  const best = candidates[0].c;
  const to = { x: best.cell.x, y: best.cell.y + 1 };
  // 7.3: клетка занята, непроходима или за краем — толчок не выполняется.
  if (to.y > 7) return null;
  if (blocked.has(cellKey(to))) return null;
  if (getCreatureAt(state.creatures, to)) return null;
  return best;
}

/** Призыв Личинки Проповедником в фазе II (7.5): по правилу Ловчего, 1 ОД, считается действием. */
export function applyPreacherSummon(state: BattleState, rng: () => number = Math.random): Result | null {
  const preacher = state.creatures.find((c) => c.side === 'enemy' && c.kind === 'preacher' && !c.acted);
  if (!preacher || state.ap < 1) return null;

  const next = structuredClone(state);
  const events: BattleEvent[] = [];
  const p = getCreatureById(next.creatures, preacher.id)!;
  const cell = firstFreeNeighbor(next, p.cell);
  if (!cell) return null;

  next.spawnCounter++;
  const larva = createCreature(`s${next.spawnCounter}`, 'enemy', 'larva', cell);
  larva.acted = true;
  next.creatures.push(larva);
  p.acted = true;
  next.ap -= 1;
  next.actionsTaken += 1;
  events.push({ t: 'spawned', id: larva.id, kind: 'larva', at: { ...cell } }, { t: 'apSpent', left: next.ap });
  events.push(...maybeAutoEndTurn(next, rng));
  return { state: next, events };
}

/** Депрессия (7.5): дальность Стражей и Иерофантов игрока = 1 на 3 хода игрока. Не расходует ОД. */
export function applyDepression(state: BattleState): Result {
  const next = structuredClone(state);
  next.karma.depressionTurns = 3;
  next.lastDepressionTurn = next.enemyTurnNumber;
  return { state: next, events: [{ t: 'cardPlayed', card: 'depression' }] };
}

/** Ход тварей, в который Проповедник разыгрывает Депрессию (7.5). */
export function isDepressionTurn(state: BattleState): boolean {
  const preacher = state.creatures.find((c) => c.side === 'enemy' && c.kind === 'preacher');
  if (!preacher) return false;
  if (state.bossPhase === 1) return state.enemyTurnNumber === 3 || state.enemyTurnNumber === 7;
  const base = state.bossPhase2BaseTurn ?? 0;
  const since = state.enemyTurnNumber - base;
  return since > 0 && since % 4 === 0;
}

/** Ход тварей, в который Проповедник (фаза II) призывает Личинку. */
export function isSummonTurn(state: BattleState): boolean {
  if (state.bossPhase !== 2) return false;
  const preacher = state.creatures.find((c) => c.side === 'enemy' && c.kind === 'preacher');
  if (!preacher) return false;
  const base = state.bossPhase2BaseTurn ?? 0;
  const since = state.enemyTurnNumber - base;
  return since > 0 && since % 2 === 0;
}

/** Ход тварей, в который Око выполняет толчок (7.3): каждый 3-й. */
export function isEyePushTurn(state: BattleState): boolean {
  return state.enemyTurnNumber > 0 && state.enemyTurnNumber % 3 === 0;
}
