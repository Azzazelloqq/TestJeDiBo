import { describe, expect, it } from 'vitest';
import { decideAiAction } from './ai';
import { applyAttack, applyMove, createBattle, destroyCreatures, endTurnAndAdvance, forceEndTurn } from './battle';
import { getLegalAttacks } from './rules';
import { BATTLES } from './arenas';
import { PATH_LEVELS } from './path';
import { enterNode, nodesAvailable, offerOpeningKarma, startRun } from './run';
import { c, makeState } from './testHelpers';
import type { BattleEvent } from './types';

describe('фаза II босса (7.5)', () => {
  function bossState(retinue: number) {
    const preacher = c('enemy', 'preacher', 3, 0);
    const brutes = Array.from({ length: retinue }, (_, i) => c('enemy', 'brute', i, 2));
    const player = c('player', 'warden', 4, 7);
    return { state: makeState([preacher, ...brutes, player]), brutes };
  }

  it('не наступает, пока в свите больше 3 существ', () => {
    const { state, brutes } = bossState(5);
    const events: BattleEvent[] = [];
    destroyCreatures(state, [brutes[0]], events);
    expect(state.bossPhase).toBe(1);
    expect(events.some((e) => e.t === 'bossPhase')).toBe(false);
  });

  it('наступает немедленно при 3 существах свиты', () => {
    const { state, brutes } = bossState(4);
    const events: BattleEvent[] = [];
    destroyCreatures(state, [brutes[0]], events);
    expect(state.bossPhase).toBe(2);
    expect(events.some((e) => e.t === 'bossPhase')).toBe(true);
  });
});

describe('жест арены', () => {
  it('на третьем ходе игрока колодец открывает две новые дыры', () => {
    const player = c('player', 'warden', 6, 6);
    const foe = c('enemy', 'brute', 1, 1);
    const state = makeState([player, foe], {
      arena: 'well',
      turn: 'enemy',
      playerTurnNumber: 2,
      actionsTaken: 1,
    });
    const events = endTurnAndAdvance(state, () => 0.5);
    expect(state.playerTurnNumber).toBe(3);
    expect(state.gestureDone).toBe(true);
    expect(events.some((e) => e.t === 'arenaGesture')).toBe(true);
    expect(state.extraBlocked.some((cell) => cell.x === 3 && cell.y === 4)).toBe(true);
  });
});

describe('Жаровня (8.1)', () => {
  it('помеченная клетка вспыхивает ровно через один ход игрока', () => {
    const victim = c('player', 'warden', 3, 3);
    const survivor = c('player', 'warden', 6, 6);
    const foe = c('enemy', 'brute', 1, 1);
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
    expect(state.ember.armed).toBeNull();
  });

  it('на третьем ходе игрока вспыхивают все угли', () => {
    const player = c('player', 'warden', 6, 6);
    const foe = c('enemy', 'brute', 1, 1);
    const onCoal = c('enemy', 'brute', 2, 2);
    const state = makeState([player, foe, onCoal], {
      arena: 'brazier',
      turn: 'enemy',
      playerTurnNumber: 2,
      actionsTaken: 1,
    });
    const events = endTurnAndAdvance(state, () => 0);
    expect(state.playerTurnNumber).toBe(3);
    expect(events.some((e) => e.t === 'arenaGesture')).toBe(true);
    expect(events.filter((e) => e.t === 'emberFired').length).toBe(6);
    expect(state.creatures.some((cr) => cr.id === onCoal.id)).toBe(false);
  });
});

describe('карта авансом, комбо и финишер', () => {
  it('при непустом пуле одна карта сразу в руке', () => {
    const { state, events } = createBattle(
      [{ id: 'o1', kind: 'warden', marks: 0 }],
      BATTLES.L1,
      [],
      ['spy', 'blitzkrieg'],
      0,
      () => 0
    );
    expect(state.karma.pendingCard).toBe('spy');
    expect(events.some((e) => e.t === 'cardDrawn')).toBe(true);
  });

  it('при пустом пуле бой начинается с картой в руке', () => {
    const { state, events } = createBattle(
      [{ id: 'o1', kind: 'warden', marks: 0 }],
      BATTLES.L1,
      [],
      [],
      0,
      () => 0
    );
    expect(state.pool).toHaveLength(1);
    expect(state.karma.pendingCard).toBe(state.pool[0]);
    expect(events.some((e) => e.t === 'cardDrawn')).toBe(true);
  });

  it('ход не сбрасывается, если в руке карта, а ходить нечем', () => {
    const w = c('player', 'warden', 1, 6);
    const stuckA = c('player', 'warden', 4, 3);
    const stuckB = c('player', 'warden', 4, 2);
    stuckA.acted = true;
    stuckB.acted = true;
    const foe = c('enemy', 'brute', 7, 0);
    const karma = { pendingCard: 'blitzkrieg' as const, blitzkrieg: null, depressionTurns: 0, discardMessage: null };

    const kept = applyMove(makeState([w, stuckA, stuckB, foe], { karma }), w.id, { x: 1, y: 5 }, () => 0.5);
    expect(kept.state.turn).toBe('player');
    expect(kept.state.karma.pendingCard).toBe('blitzkrieg');

    const passed = applyMove(makeState([w, stuckA, stuckB, foe]), w.id, { x: 1, y: 5 }, () => 0.5);
    expect(passed.state.turn).toBe('enemy');
  });

  it('третье убийство за ход даёт +1 ОД', () => {
    const w = c('player', 'warden', 2, 5);
    const a = c('player', 'warden', 0, 7);
    const e1 = c('enemy', 'brute', 1, 1);
    const e2 = c('enemy', 'brute', 2, 1);
    const e3 = c('enemy', 'brute', 3, 1);
    const state = makeState([w, a, e1, e2, e3], { ap: 5 });
    const events: BattleEvent[] = [];
    destroyCreatures(state, [e1, e2, e3], events);
    expect(state.killStreak).toBe(3);
    expect(events.some((e) => e.t === 'combo' && e.count === 3)).toBe(true);
    expect(state.ap).toBe(6);
    expect(events.some((e) => e.t === 'finisher')).toBe(true);
  });
});

describe('пир', () => {
  it('после удара, если достаёт ещё, ход не кончается', () => {
    const w = c('player', 'warden', 4, 4);
    const first = c('enemy', 'brute', 4, 3);
    const second = c('enemy', 'brute', 4, 1);
    const { state: next, events } = applyAttack(makeState([w, first, second]), w.id, { x: 4, y: 3 }, () => 0.5);
    expect(next.turn).toBe('player');
    expect(next.feast?.creatureId).toBe(w.id);
    expect(events.some((e) => e.t === 'feast')).toBe(true);
    expect(getLegalAttacks(next, w.id).some((cell) => cell.x === 4 && cell.y === 1)).toBe(true);
  });

  it('второй удар пира завершает ход', () => {
    const w = c('player', 'warden', 4, 3);
    w.acted = true;
    const second = c('enemy', 'brute', 4, 1);
    const spare = c('enemy', 'brute', 7, 0);
    const state = makeState([w, second, spare], { feast: { creatureId: w.id }, ap: 0, actionsTaken: 1 });
    const { state: next } = applyAttack(state, w.id, { x: 4, y: 1 }, () => 0.5);
    expect(next.feast).toBeNull();
    expect(next.turn).toBe('enemy');
  });
});

describe('ход тварей', () => {
  it('ИИ на Жаровне находит легальный ход, иначе сдаёт ход', () => {
    const circle = c('player', 'hierophant', 2, 4);
    const square = c('player', 'warden', 5, 4);
    const left = c('enemy', 'brute', 2, 0);
    const shell = c('enemy', 'shell', 3, 0);
    const right = c('enemy', 'brute', 5, 0);
    const state = makeState([circle, square, left, shell, right], {
      arena: 'brazier',
      turn: 'enemy',
      ap: 5,
      playerTurnNumber: 5,
    });
    const decision = decideAiAction(state, () => 0.5);
    expect(decision).not.toBeNull();
    if (decision?.kind === 'move') {
      expect(() => applyMove(state, decision.id, decision.to, () => 0.5)).not.toThrow();
    } else if (decision?.kind === 'attack') {
      expect(() => applyAttack(state, decision.id, decision.to, () => 0.5)).not.toThrow();
    }
  });

  it('если тварям нечем ходить, ход возвращается игроку', () => {
    const player = c('player', 'warden', 0, 7);
    const boxed = c('enemy', 'brute', 7, 0);
    boxed.acted = true;
    const state = makeState([player, boxed], { turn: 'enemy', ap: 5, actionsTaken: 1 });
    const { state: next } = forceEndTurn(state, () => 0.5);
    expect(next.turn).toBe('player');
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
    run.level = 5;
    enterNode(run, 'n5', () => 0.5);
    expect(run.completed).toContain('n5');
    expect(run.level).toBe(6);
    expect(nodesAvailable(run)).not.toContain('n5');

    const before = { level: run.level, completed: [...run.completed] };
    enterNode(run, 'n5', () => 0.5);
    expect(run.level).toBe(before.level);
    expect(run.completed).toEqual(before.completed);
  });

  it('старт — два Стража и четыре Послушника', () => {
    const run = startRun();
    expect(run.order).toHaveLength(6);
    expect(run.order.filter((m) => m.kind === 'warden')).toHaveLength(2);
    expect(run.order.filter((m) => m.kind === 'acolyte')).toHaveLength(4);
  });

  it('перед первым боем предлагают выбрать карму', () => {
    const run = startRun();
    offerOpeningKarma(run, () => 0);
    expect(run.overlay?.kind).toBe('reward-cards');
    if (run.overlay?.kind === 'reward-cards') {
      expect(run.overlay.options).toHaveLength(2);
      expect(run.overlay.options.includes('resurrection')).toBe(false);
    }
  });
});
