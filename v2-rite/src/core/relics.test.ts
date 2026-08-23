import { describe, expect, it } from 'vitest';
import { BATTLES } from './arenas';
import { applyAttack, applyMove, createBattle, destroyCreatures, endTurnAndAdvance } from './battle';
import { apPerTurn, karmaPeriod } from './relics';
import { c, makeState } from './testHelpers';
import type { BattleEvent } from './types';

describe('Костяной ключ', () => {
  it('даёт 6 ОД вместо 5', () => {
    expect(apPerTurn([])).toBe(5);
    expect(apPerTurn(['boneKey'])).toBe(6);
    const { state } = createBattle([{ id: 'o1', kind: 'warden', marks: 0 }], BATTLES.L1, ['boneKey'], [], 0, () => 0.5);
    expect(state.ap).toBe(6);
  });
});

describe('Свеча бдения', () => {
  it('сокращает период Кармы с 3 до 2 ходов', () => {
    expect(karmaPeriod([])).toBe(3);
    expect(karmaPeriod(['vigilCandle'])).toBe(2);
  });

  it('со Свечой карта тянется уже на 2-м ходу игрока', () => {
    const a = c('player', 'warden', 4, 4);
    const foe = c('enemy', 'brute', 1, 1);
    const state = makeState([a, foe], { turn: 'enemy', relics: ['vigilCandle'], pool: ['spy'], actionsTaken: 1 });
    const events = endTurnAndAdvance(state, () => 0);
    expect(state.playerTurnNumber).toBe(2);
    expect(state.karma.pendingCard).toBe('spy');
    expect(events.some((e) => e.t === 'cardDrawn' && e.card === 'spy')).toBe(true);
  });

  it('без Свечи на 2-м ходу карта не приходит', () => {
    const a = c('player', 'warden', 4, 4);
    const foe = c('enemy', 'brute', 1, 1);
    const state = makeState([a, foe], { turn: 'enemy', pool: ['spy'], actionsTaken: 1 });
    endTurnAndAdvance(state, () => 0);
    expect(state.karma.pendingCard).toBeNull();
  });
});

describe('Первая кровь', () => {
  it('первое убийство в бою стоит 1 ОД, ход продолжается; второе — обычное', () => {
    const w1 = c('player', 'warden', 4, 4);
    const w2 = c('player', 'warden', 1, 4);
    const foe1 = c('enemy', 'brute', 4, 3);
    const foe2 = c('enemy', 'brute', 1, 3);
    const foe3 = c('enemy', 'brute', 7, 1);
    const state = makeState([w1, w2, foe1, foe2, foe3], { relics: ['firstBlood'] });

    const first = applyAttack(state, w1.id, { x: 4, y: 3 }, () => 0.5);
    expect(first.state.turn).toBe('player');
    expect(first.state.ap).toBe(4);
    expect(first.state.firstBloodUsed).toBe(true);
    expect(first.events.some((e) => e.t === 'relicFired' && e.relic === 'firstBlood')).toBe(true);

    const second = applyAttack(first.state, w2.id, { x: 1, y: 3 }, () => 0.5);
    expect(second.state.turn).toBe('enemy'); // обычная атака завершает ход
  });
});

describe('Терновый обод', () => {
  it('при гибели своего существа гибнет соседняя тварь', () => {
    const a = c('player', 'warden', 4, 4);
    const other = c('player', 'warden', 0, 7);
    const foe = c('enemy', 'brute', 4, 3);
    const far = c('enemy', 'brute', 0, 0);
    const state = makeState([a, other, foe, far], { relics: ['thornRim'] });

    const events: BattleEvent[] = [];
    destroyCreatures(state, [a], events);
    const ids = state.creatures.map((cr) => cr.id);
    expect(ids).not.toContain(a.id);
    expect(ids).not.toContain(foe.id); // сосед погиб
    expect(ids).toContain(far.id);
    expect(events.some((e) => e.t === 'relicFired' && e.relic === 'thornRim')).toBe(true);
  });
});

describe('Пепельный венец', () => {
  it('один случайный Квадрат врага не появляется в бою', () => {
    const order = [{ id: 'o1', kind: 'warden' as const, marks: 0 }];
    const plain = createBattle(order, BATTLES.L1, [], [], 0, () => 0.5);
    expect(plain.state.creatures.filter((cr) => cr.side === 'enemy')).toHaveLength(3);

    const crowned = createBattle(order, BATTLES.L1, ['ashenCrown'], [], 0, () => 0.5);
    expect(crowned.state.creatures.filter((cr) => cr.side === 'enemy')).toHaveLength(2);
    expect(crowned.events.some((e) => e.t === 'relicFired' && e.relic === 'ashenCrown')).toBe(true);
  });
});

describe('Реликварий', () => {
  it('за посвящение — случайная карта в пул до конца боя', () => {
    const a = c('player', 'warden', 4, 1);
    const other = c('player', 'warden', 6, 6);
    const foe = c('enemy', 'brute', 1, 3);
    const state = makeState([a, other, foe], { relics: ['reliquary'] });

    const { state: next, events } = applyMove(state, a.id, { x: 4, y: 0 }, () => 0);
    expect(events.some((e) => e.t === 'ordained')).toBe(true);
    expect(events.some((e) => e.t === 'relicFired' && e.relic === 'reliquary')).toBe(true);
    expect(next.pool).toHaveLength(1);
  });
});
