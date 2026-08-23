import { destroyCreatures, endTurnAndAdvance, checkWinLoss, createCreature, resolveOrdinations, type Result } from './battle';
import { blockedCells, cellKey, findPlacementSlot, getCreatureById } from './board';
import { toPlayerKind } from './creatures';
import { type BattleEvent, type BattleState, type CardId, type Cell, type Id } from './types';

export interface CardDef {
  id: CardId;
  name: string;
  effect: string;
  /** «сразу» — по клику после показа; «в свой ход» — до конца периода. */
  mode: 'instant' | 'own-turn';
  /** Считается за ход (9.1). */
  endsTurn: boolean;
  /** Нужен выбор цели после клика. */
  targeting: 'none' | 'enemy' | 'graveyard';
}

export const CARDS: Record<CardId, CardDef> = {
  deathline: {
    id: 'deathline',
    name: 'Линия смерти',
    effect: 'Кликни столбец: гибнут все существа обеих сторон в нём. Считается за ход.',
    mode: 'instant',
    endsTurn: true,
    targeting: 'none',
  },
  barrage: {
    id: 'barrage',
    name: 'Обстрел',
    effect: 'Восемь клеток вспыхивают. Подтверди картой или отмени. Считается за ход.',
    mode: 'instant',
    endsTurn: true,
    targeting: 'none',
  },
  spy: {
    id: 'spy',
    name: 'Шпион',
    effect: 'Одна тварь по выбору переходит в орден навсегда и может действовать в этот же ход.',
    mode: 'instant',
    endsTurn: false,
    targeting: 'enemy',
  },
  blitzkrieg: {
    id: 'blitzkrieg',
    name: 'Блицкриг',
    effect: 'Первое существо, которым ты начнёшь действовать, совершает до 5 действий подряд.',
    mode: 'own-turn',
    endsTurn: false,
    targeting: 'none',
  },
  resurrection: {
    id: 'resurrection',
    name: 'Воскрешение',
    effect: 'Кликни павшего слева от доски. Он возвращается и может ходить сразу.',
    mode: 'instant',
    endsTurn: false,
    targeting: 'graveyard',
  },
};

export function isCardApplicable(state: BattleState, card: CardId): boolean {
  switch (card) {
    case 'deathline':
    case 'barrage':
    case 'blitzkrieg':
      return true;
    case 'spy':
      return state.creatures.some((c) => c.side === 'enemy');
    case 'resurrection':
      // 9.2: неприменима — кладбище пусто или нет свободных клеток.
      return state.graveyard.player.length > 0 && findPlacementSlot(state, 'player') !== null;
  }
}

/** Сброс неприменимой карты с надписью (9.1). */
export function discardInapplicable(state: BattleState): Result {
  const card = state.karma.pendingCard;
  if (!card || isCardApplicable(state, card)) return { state, events: [] };
  const next = structuredClone(state);
  next.karma.pendingCard = null;
  next.karma.discardMessage = 'Карта не может быть разыграна';
  return { state: next, events: [{ t: 'cardDiscarded', card }] };
}

function requirePending(state: BattleState, card: CardId): void {
  if (state.karma.pendingCard !== card) throw new Error(`card ${card} is not pending`);
}

/** Линия смерти: выбранный столбец. */
export function playDeathline(state: BattleState, column: number, rng: () => number = Math.random): Result {
  requirePending(state, 'deathline');
  const x = Math.max(0, Math.min(7, column | 0));

  const next = structuredClone(state);
  next.karma.pendingCard = null;
  const events: BattleEvent[] = [{ t: 'cardPlayed', card: 'deathline', payload: { column: x } }];

  const victims = next.creatures.filter((c) => c.cell.x === x);
  destroyCreatures(next, victims, events);

  resolveOrdinations(next, events, rng);
  events.push(...checkWinLoss(next));
  if (next.winner === null) events.push(...endTurnAndAdvance(next, rng));
  return { state: next, events };
}

export function pickBarrageCells(rng: () => number = Math.random): Cell[] {
  const all: Cell[] = [];
  for (let x = 0; x < 8; x++) for (let y = 0; y < 8; y++) all.push({ x, y });
  for (let i = all.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [all[i], all[j]] = [all[j], all[i]];
  }
  return all.slice(0, 8);
}

/** Обстрел: заранее выбранные клетки. Непроходимая клетка засчитывается, эффекта нет (17). */
export function playBarrage(state: BattleState, cells: Cell[], rng: () => number = Math.random): Result {
  requirePending(state, 'barrage');

  const next = structuredClone(state);
  next.karma.pendingCard = null;
  const events: BattleEvent[] = [{ t: 'cardPlayed', card: 'barrage', payload: { cells } }];

  const blocked = blockedCells(next);
  const victims = next.creatures.filter(
    (c) => cells.some((cell) => cell.x === c.cell.x && cell.y === c.cell.y) && !blocked.has(cellKey(c.cell))
  );
  destroyCreatures(next, victims, events);

  resolveOrdinations(next, events, rng);
  events.push(...checkWinLoss(next));
  if (next.winner === null) events.push(...endTurnAndAdvance(next, rng));
  return { state: next, events };
}

/** Шпион (9.2): тварь переходит в орден навсегда. Может действовать в этот же ход. */
export function playSpy(state: BattleState, targetId: Id, rng: () => number = Math.random): Result {
  requirePending(state, 'spy');
  const target = getCreatureById(state.creatures, targetId);
  if (!target || target.side !== 'enemy') throw new Error(`spy: ${targetId} is not an enemy`);

  const next = structuredClone(state);
  next.karma.pendingCard = null;
  const creature = getCreatureById(next.creatures, targetId)!;
  creature.side = 'player';
  creature.kind = toPlayerKind(creature.kind);
  creature.acted = false;
  const events: BattleEvent[] = [
    { t: 'cardPlayed', card: 'spy', payload: { id: targetId } },
    { t: 'captured', id: targetId, at: { ...creature.cell } },
  ];

  // 9.2: если после смены она стоит на y=0 — посвящается по обычным правилам.
  resolveOrdinations(next, events, rng);
  events.push(...checkWinLoss(next)); // забрали последнюю тварь — бой выигран
  return { state: next, events };
}

/** Блицкриг (9.2): открывает окно «первое существо — до 5 действий». */
export function playBlitzkrieg(state: BattleState): Result {
  requirePending(state, 'blitzkrieg');
  const next = structuredClone(state);
  next.karma.pendingCard = null;
  next.karma.blitzkrieg = { creatureId: null, actionsLeft: 5 };
  return { state: next, events: [{ t: 'cardPlayed', card: 'blitzkrieg' }] };
}

/** Воскрешение (9.2): существо с кладбища этого боя возвращается по правилу 6.7. */
export function playResurrection(state: BattleState, creatureId: Id, rng: () => number = Math.random): Result {
  requirePending(state, 'resurrection');
  const buried = state.graveyard.player.find((c) => c.id === creatureId);
  if (!buried) throw new Error(`resurrection: ${creatureId} not in graveyard`);
  const slot = findPlacementSlot(state, 'player');
  if (!slot) throw new Error('resurrection: no free placement cell');

  const next = structuredClone(state);
  next.karma.pendingCard = null;
  next.graveyard.player = next.graveyard.player.filter((c) => c.id !== creatureId);
  const revived = createCreature(creatureId, 'player', buried.kind, slot, buried.marks);
  next.creatures.push(revived); // может действовать в этот же ход

  const events: BattleEvent[] = [{ t: 'cardPlayed', card: 'resurrection', payload: { id: creatureId, at: slot } }];
  resolveOrdinations(next, events, rng);
  return { state: next, events };
}
