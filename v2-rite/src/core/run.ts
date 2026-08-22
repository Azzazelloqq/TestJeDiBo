import { BATTLES } from './arenas';
import { createBattle, type OrderMember, type Result } from './battle';
import { ordainedEnemyKind, ordainedPlayerKind } from './creatures';
import { EVENTS, type EventEffect, type EventId } from './events';
import { getNode, PATH_LEVELS, type PathNode } from './path';
import {
  ALL_CARD_IDS,
  ALL_RELIC_IDS,
  randInt,
  type BattleEvent,
  type BattleState,
  type CardId,
  type CreatureKind,
  type RelicId,
} from './types';

export type RunPhase = 'title' | 'map' | 'battle' | 'summary';

export type Overlay =
  | { kind: 'reward-cards'; options: CardId[] }
  | { kind: 'reward-relics'; options: RelicId[] }
  | { kind: 'relic-scene'; relic: RelicId }
  | { kind: 'event'; eventId: EventId }
  | { kind: 'altar' }
  | { kind: 'altar-cards'; options: CardId[] }
  | { kind: 'pick-ordain' }
  | { kind: 'pick-fallen' }
  | { kind: 'pick-give-card' }
  | { kind: 'info'; title: string; body: string };

export interface RunStats {
  turns: number;
  kills: number;
  ordinations: number;
}

export interface RunState {
  phase: RunPhase;
  overlay: Overlay | null;
  order: OrderMember[];
  /** Погибшие за весь ран (для алтаря и «Хора в стене»). */
  fallen: OrderMember[];
  pool: CardId[];
  relics: RelicId[];
  /** Текущий доступный уровень пути (1..9). */
  level: number;
  completed: string[];
  battle: BattleState | null;
  battleNode: PathNode | null;
  battleFromDoors: boolean;
  nextBattleApBonus: number;
  stats: RunStats;
  outcome: 'victory' | 'defeat' | null;
  idCounter: number;
}

export function startRun(): RunState {
  // 6.2: стартовый орден — 2 Стража и 4 Послушника.
  const kinds: CreatureKind[] = ['warden', 'warden', 'acolyte', 'acolyte', 'acolyte', 'acolyte'];
  return {
    phase: 'title',
    overlay: null,
    order: kinds.map((kind, i) => ({ id: `o${i + 1}`, kind, marks: 0 })),
    fallen: [],
    pool: [],
    relics: [],
    level: 1,
    completed: [],
    battle: null,
    battleNode: null,
    battleFromDoors: false,
    nextBattleApBonus: 0,
    stats: { turns: 0, kills: 0, ordinations: 0 },
    outcome: null,
    idCounter: 6,
  };
}

export function untakenCards(run: RunState): CardId[] {
  return ALL_CARD_IDS.filter((c) => !run.pool.includes(c));
}

export function untakenRelics(run: RunState): RelicId[] {
  return ALL_RELIC_IDS.filter((r) => !run.relics.includes(r));
}

function pickRandom<T>(items: T[], n: number, rng: () => number): T[] {
  const shuffled = [...items];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled.slice(0, n);
}

export function canOrdainMember(member: OrderMember): boolean {
  return (ordainedPlayerKind(member.kind) ?? ordainedEnemyKind(member.kind)) !== null;
}

function ordainMember(run: RunState, memberId: string): void {
  const member = run.order.find((m) => m.id === memberId);
  if (!member) return;
  const next = ordainedPlayerKind(member.kind) ?? ordainedEnemyKind(member.kind);
  if (!next) return;
  member.kind = next;
  run.stats.ordinations += 1;
}

/** Посвящение как награда узла (17: кончились карты и реликвии). */
function ordinationFallback(run: RunState): void {
  if (run.order.some(canOrdainMember)) {
    run.overlay = { kind: 'pick-ordain' };
  } else {
    run.overlay = { kind: 'info', title: 'Пусто', body: 'Здесь ничего для тебя нет' };
  }
}

function giveRelicOverlay(run: RunState, rng: () => number): void {
  const options = untakenRelics(run);
  if (options.length === 0) {
    ordinationFallback(run);
    return;
  }
  const relic = options[randInt(0, options.length - 1, rng)];
  run.relics.push(relic);
  run.overlay = { kind: 'relic-scene', relic };
}

export function nodesAvailable(run: RunState): string[] {
  if (run.level > 9 || run.level < 1) return [];
  return (PATH_LEVELS[run.level - 1] ?? []).map((n) => n.id);
}

/** Вход в узел пути. Возвращает события боя (для сцен), если начался бой. */
export function enterNode(run: RunState, nodeId: string, rng: () => number = Math.random): BattleEvent[] {
  const node = getNode(nodeId);
  if (node.level !== run.level) return [];

  switch (node.type) {
    case 'battle':
    case 'elite':
    case 'boss': {
      return startNodeBattle(run, node, rng);
    }
    case 'event': {
      run.overlay = { kind: 'event', eventId: node.eventId! };
      completeNode(run, node);
      return [];
    }
    case 'altar': {
      run.overlay = { kind: 'altar' };
      completeNode(run, node);
      return [];
    }
    case 'treasure': {
      completeNode(run, node);
      giveRelicOverlay(run, rng);
      return [];
    }
  }
}

function startNodeBattle(run: RunState, node: PathNode, rng: () => number, fromDoors = false): BattleEvent[] {
  const def = BATTLES[node.battleId!];
  const result: Result = createBattle(run.order, def, run.relics, run.pool, run.nextBattleApBonus, rng);
  run.nextBattleApBonus = 0;
  run.battle = result.state;
  run.battleNode = node;
  run.battleFromDoors = fromDoors;
  run.phase = 'battle';
  return result.events;
}

function completeNode(run: RunState, node: PathNode): void {
  if (!run.completed.includes(node.id)) run.completed.push(node.id);
  run.level = node.level + 1;
}

export function ingestBattleEvents(run: RunState, events: BattleEvent[]): void {
  for (const e of events) {
    if (e.t === 'turnEnded' && e.side === 'player') run.stats.turns += 1;
    else if (e.t === 'killed' && e.side === 'enemy') run.stats.kills += 1;
    else if (e.t === 'ordained' && e.placedAt.y >= 5) run.stats.ordinations += 1; // посвящения ордена
  }
}

/** Вызывается, когда battle.winner установлен. */
export function completeBattle(run: RunState, rng: () => number = Math.random): void {
  const battle = run.battle;
  const node = run.battleNode;
  if (!battle || battle.winner === null || !node) return;

  if (battle.winner === 'enemy') {
    run.phase = 'summary';
    run.outcome = 'defeat';
    return;
  }

  // Выжившие: переносим текущий облик и метки, +1 метка за пережитый бой (7.1, максимум 5).
  const survivors: OrderMember[] = battle.creatures
    .filter((c) => c.side === 'player')
    .map((c) => ({ id: c.id, kind: c.kind, marks: Math.min(5, c.marks + 1) }));

  // Погибшие уходят в список павших.
  let dead: OrderMember[] = battle.graveyard.player.map((c) => ({ id: c.id, kind: c.kind, marks: c.marks }));

  // Печать возврата (5): первое погибшее за бой существо возвращается после боя.
  if (run.relics.includes('returnSeal') && dead.length > 0) {
    const returned = dead[0];
    dead = dead.slice(1);
    survivors.push(returned);
  }

  run.order = survivors;
  run.fallen.push(...dead);

  // 4.3: после каждого выигранного боя орден получает +1 Послушника.
  run.idCounter += 1;
  run.order.push({ id: `o${run.idCounter}`, kind: 'acolyte', marks: 0 });

  const fromDoors = run.battleFromDoors;
  run.battle = null;
  run.battleNode = null;
  run.battleFromDoors = false;
  run.phase = 'map';

  if (node.type === 'boss') {
    run.phase = 'summary';
    run.outcome = 'victory';
    return;
  }

  completeNode(run, node);

  if (fromDoors) {
    run.overlay = null; // бой из «Трёх дверей» — без награды
    return;
  }

  if (node.type === 'elite') {
    // 4.3: элита — выбор 1 реликвии из 2.
    const options = pickRandom(untakenRelics(run), 2, rng);
    if (options.length === 0) ordinationFallback(run);
    else run.overlay = { kind: 'reward-relics', options };
    return;
  }

  // Обычный бой: 1 карта из 2 невзятых; кончились карты — реликвия; кончились и они — посвящение.
  const cardOptions = pickRandom(untakenCards(run), 2, rng);
  if (cardOptions.length > 0) run.overlay = { kind: 'reward-cards', options: cardOptions };
  else giveRelicOverlay(run, rng);
}

// ---------- Выборы в оверлеях ----------

export function chooseRewardCard(run: RunState, card: CardId): void {
  if (run.overlay?.kind !== 'reward-cards' && run.overlay?.kind !== 'altar-cards') return;
  if (!run.overlay.options.includes(card)) return;
  run.pool.push(card);
  run.overlay = null;
}

export function chooseRewardRelic(run: RunState, relic: RelicId): void {
  if (run.overlay?.kind !== 'reward-relics' || !run.overlay.options.includes(relic)) return;
  run.relics.push(relic);
  run.overlay = { kind: 'relic-scene', relic };
}

export function closeRelicScene(run: RunState): void {
  if (run.overlay?.kind === 'relic-scene' || run.overlay?.kind === 'info') run.overlay = null;
}

export function choosePickOrdain(run: RunState, memberId: string): void {
  if (run.overlay?.kind !== 'pick-ordain') return;
  ordainMember(run, memberId);
  run.overlay = null;
}

export function choosePickFallen(run: RunState, memberId: string): void {
  if (run.overlay?.kind !== 'pick-fallen') return;
  const idx = run.fallen.findIndex((m) => m.id === memberId);
  if (idx < 0) return;
  const member = run.fallen[idx];
  run.fallen.splice(idx, 1);
  // 4.4/4.5: возвращается в орден Послушником.
  run.order.push({ id: member.id, kind: 'acolyte', marks: member.marks });
  run.overlay = null;
}

export function chooseGiveCard(run: RunState, card: CardId, rng: () => number = Math.random): void {
  if (run.overlay?.kind !== 'pick-give-card') return;
  const idx = run.pool.indexOf(card);
  if (idx < 0) return;
  run.pool.splice(idx, 1);
  const others = ALL_CARD_IDS.filter((c) => c !== card && !run.pool.includes(c));
  const gained = pickRandom(others, 2, rng);
  run.pool.push(...gained);
  run.overlay = {
    kind: 'info',
    title: 'Обмен совершён',
    body: gained.length > 0 ? 'Новые знания легли в пул' : 'Торговцу нечего дать взамен',
  };
}

// ---------- Алтарь (4.4) ----------

export type AltarChoice = 'ordain' | 'raise' | 'knowledge';

export function isAltarChoiceAvailable(run: RunState, choice: AltarChoice): boolean {
  switch (choice) {
    case 'ordain':
      return run.order.some(canOrdainMember);
    case 'raise':
      return run.fallen.length > 0;
    case 'knowledge':
      return untakenCards(run).length > 0;
  }
}

export function chooseAltar(run: RunState, choice: AltarChoice, rng: () => number = Math.random): void {
  if (run.overlay?.kind !== 'altar' || !isAltarChoiceAvailable(run, choice)) return;
  switch (choice) {
    case 'ordain':
      run.overlay = { kind: 'pick-ordain' };
      break;
    case 'raise':
      run.overlay = { kind: 'pick-fallen' };
      break;
    case 'knowledge': {
      const options = pickRandom(untakenCards(run), 2, rng);
      run.overlay = { kind: 'altar-cards', options };
      break;
    }
  }
}

// ---------- События (4.5) ----------

export function isEventOptionAvailable(run: RunState, effect: EventEffect): boolean {
  switch (effect.kind) {
    case 'none':
    case 'doorsEnter':
    case 'nextBattleAp':
      return true;
    case 'loseAcolyteGainRelic':
      return run.order.some((m) => m.kind === 'acolyte') && untakenRelics(run).length > 0;
    case 'tradeCard':
      return run.pool.length > 0 && ALL_CARD_IDS.some((c) => !run.pool.includes(c));
    case 'ordainOne':
      return run.order.some(canOrdainMember);
    case 'raiseFallen':
      return run.fallen.length > 0;
  }
}

/** Оба варианта недоступны (17): событие проходится без последствий. */
export function isEventDeadEnd(run: RunState, eventId: EventId): boolean {
  const def = EVENTS[eventId];
  return !isEventOptionAvailable(run, def.a.effect) && !isEventOptionAvailable(run, def.b.effect);
}

/** Возвращает события боя, если выбор привёл к бою («Три двери»). */
export function chooseEventOption(run: RunState, eventId: EventId, option: 'a' | 'b', rng: () => number = Math.random): BattleEvent[] {
  if (run.overlay?.kind !== 'event' || run.overlay.eventId !== eventId) return [];
  const effect = EVENTS[eventId][option].effect;
  if (!isEventOptionAvailable(run, effect)) return [];

  switch (effect.kind) {
    case 'none':
      run.overlay = null;
      return [];
    case 'loseAcolyteGainRelic': {
      const idx = run.order.findIndex((m) => m.kind === 'acolyte');
      const [lost] = run.order.splice(idx, 1);
      run.fallen.push(lost);
      giveRelicOverlay(run, rng);
      return [];
    }
    case 'tradeCard':
      run.overlay = { kind: 'pick-give-card' };
      return [];
    case 'doorsEnter': {
      if (rng() < 0.5) {
        giveRelicOverlay(run, rng);
        return [];
      }
      run.overlay = null;
      const doorsNode: PathNode = { id: 'n6B-battle', level: 6, type: 'battle', label: 'Галерея', battleId: 'doors' };
      return startNodeBattle(run, doorsNode, rng, true);
    }
    case 'ordainOne':
      run.overlay = { kind: 'pick-ordain' };
      return [];
    case 'nextBattleAp':
      run.nextBattleApBonus = 2;
      run.overlay = null;
      return [];
    case 'raiseFallen':
      run.overlay = { kind: 'pick-fallen' };
      return [];
  }
}

/** Событие с двумя недоступными вариантами закрывается «Здесь ничего для тебя нет». */
export function dismissDeadEndEvent(run: RunState): void {
  if (run.overlay?.kind !== 'event') return;
  run.overlay = { kind: 'info', title: 'Пусто', body: 'Здесь ничего для тебя нет' };
}
