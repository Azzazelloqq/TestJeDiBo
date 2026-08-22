import { describe, expect, it } from 'vitest';
import { applyAttack, applyEyePush, destroyCreatures, endTurnAndAdvance } from './battle';
import { PATH_LEVELS } from './path';
import { enterNode, nodesAvailable, startRun } from './run';
import { c, makeState } from './testHelpers';
import type { BattleEvent } from './types';

describe('черты тварей (7.3)', () => {
  it('гибель Ткача ставит кокон, кокон снимается через 3 хода игрока', () => {
    const w = c('player', 'warden', 4, 5);
    const weaver = c('enemy', 'weaver', 4, 4);
    const foe = c('enemy', 'larva', 1, 1);
    const state = makeState([w, weaver, foe]);

    const { state: next, events } = applyAttack(state, w.id, { x: 4, y: 4 }, () => 0.5);
    const blockedEvent = events.find((e) => e.t === 'blocked');
    expect(blockedEvent).toBeTruthy();
    expect(next.cocoons).toHaveLength(1);
    // Кокон живёт 3 хода игрока: поставлен на ходу 1, снимается в начале хода 4.
    expect(next.cocoons[0].expiresOnPlayerTurn).toBe(4);

    // Снятие: начало хода игрока, до которого кокон дожил.
    const expiring = makeState([w, foe], {
      turn: 'enemy',
      playerTurnNumber: 3,
      cocoons: [{ cell: { x: 4, y: 3 }, expiresOnPlayerTurn: 4 }],
      actionsTaken: 1,
    });
    const endEvents = endTurnAndAdvance(expiring, () => 0.5);
    expect(expiring.cocoons).toHaveLength(0);
    expect(endEvents.some((e) => e.t === 'unblocked')).toBe(true);
  });

  it('гибель Ловчего призывает Личинку, которая не действует в тот же ход', () => {
    const catcher = c('enemy', 'catcher', 4, 4);
    const player = c('player', 'warden', 0, 7);
    const foe = c('enemy', 'larva', 1, 1);
    const state = makeState([catcher, player, foe]);

    const events: BattleEvent[] = [];
    destroyCreatures(state, [catcher], events);
    const spawned = events.find((e) => e.t === 'spawned');
    expect(spawned).toBeTruthy();
    const larva = state.creatures.find((cr) => cr.id === (spawned as { id: string }).id)!;
    expect(larva.kind).toBe('larva');
    expect(larva.cell).toEqual({ x: 4, y: 4 }); // на месте гибели, если оно свободно
    expect(larva.acted).toBe(true); // в этот ход не действует
  });

  it('толчок Ока не выполняется, если клетка за спиной занята', () => {
    const eye = c('enemy', 'eye', 4, 2);
    const target = c('player', 'acolyte', 4, 4);
    const blocker = c('player', 'acolyte', 4, 5);
    const state = makeState([eye, target, blocker], { turn: 'enemy', enemyTurnNumber: 3 });
    expect(applyEyePush(state, eye.id, () => 0.5)).toBeNull();
  });

  it('толчок Ока сдвигает ближайшее существо ордена на клетку назад', () => {
    const eye = c('enemy', 'eye', 4, 2);
    const target = c('player', 'acolyte', 4, 4);
    const other = c('player', 'acolyte', 0, 7);
    const state = makeState([eye, target, other], { turn: 'enemy', enemyTurnNumber: 3 });
    const result = applyEyePush(state, eye.id, () => 0.5);
    expect(result).not.toBeNull();
    const pushed = result!.state.creatures.find((cr) => cr.id === target.id)!;
    expect(pushed.cell).toEqual({ x: 4, y: 5 });
    expect(result!.events.some((e) => e.t === 'pushed')).toBe(true);
  });
});

describe('фаза II босса (7.5)', () => {
  function bossState(retinue: number) {
    const preacher = c('enemy', 'preacher', 3, 0);
    const larvas = Array.from({ length: retinue }, (_, i) => c('enemy', 'larva', i, 2));
    const player = c('player', 'warden', 4, 7);
    return { state: makeState([preacher, ...larvas, player]), larvas };
  }

  it('не наступает, пока в свите больше 3 существ', () => {
    const { state, larvas } = bossState(5);
    const events: BattleEvent[] = [];
    destroyCreatures(state, [larvas[0]], events);
    expect(state.bossPhase).toBe(1);
    expect(events.some((e) => e.t === 'bossPhase')).toBe(false);
  });

  it('наступает немедленно при 3 существах свиты', () => {
    const { state, larvas } = bossState(4);
    const events: BattleEvent[] = [];
    destroyCreatures(state, [larvas[0]], events);
    expect(state.bossPhase).toBe(2);
    expect(events.some((e) => e.t === 'bossPhase')).toBe(true);
  });
});

describe('Жаровня (8.1)', () => {
  it('помеченная клетка вспыхивает ровно через один ход игрока', () => {
    const victim = c('player', 'acolyte', 3, 3);
    const survivor = c('player', 'warden', 6, 6);
    const foe = c('enemy', 'larva', 1, 1);
    const state = makeState([victim, survivor, foe], {
      arena: 'brazier',
      turn: 'enemy',
      playerTurnNumber: 1,
      ember: { armed: { x: 3, y: 3 } },
      actionsTaken: 1,
    });
    const events = endTurnAndAdvance(state, () => 0.99);
    expect(events.some((e) => e.t === 'emberFired')).toBe(true);
    expect(state.creatures.some((cr) => cr.id === victim.id)).toBe(false);
    expect(state.ember.armed).toBeNull(); // ход 2 — не кратен 3, новая метка не ставится
  });

  it('каждый 3-й ход игрока помечается новая клетка', () => {
    const player = c('player', 'warden', 6, 6);
    const foe = c('enemy', 'larva', 1, 1);
    const state = makeState([player, foe], {
      arena: 'brazier',
      turn: 'enemy',
      playerTurnNumber: 2,
      actionsTaken: 1,
    });
    const events = endTurnAndAdvance(state, () => 0);
    expect(state.playerTurnNumber).toBe(3);
    expect(events.some((e) => e.t === 'emberArmed')).toBe(true);
    expect(state.ember.armed).not.toBeNull();
  });
});

describe('путь (4.1)', () => {
  it('на чётных уровнях с выбором два узла, на остальных один', () => {
    expect(PATH_LEVELS).toHaveLength(9);
    const twoNodeLevels = [2, 4, 6];
    PATH_LEVELS.forEach((nodes, i) => {
      expect(nodes).toHaveLength(twoNodeLevels.includes(i + 1) ? 2 : 1);
    });
  });

  it('пройденный узел недоступен повторно', () => {
    const run = startRun();
    run.level = 5; // сокровище — узел без боя
    enterNode(run, 'n5', () => 0.5);
    expect(run.completed).toContain('n5');
    expect(run.level).toBe(6);
    expect(nodesAvailable(run)).not.toContain('n5');

    const before = { level: run.level, completed: [...run.completed] };
    enterNode(run, 'n5', () => 0.5); // повторный вход игнорируется
    expect(run.level).toBe(before.level);
    expect(run.completed).toEqual(before.completed);
  });
});
