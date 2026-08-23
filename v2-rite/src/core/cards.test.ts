import { describe, expect, it } from 'vitest';
import { applyEndTurn, applyMove } from './battle';
import { discardInapplicable, isCardApplicable, playBarrage, playBlitzkrieg, playDeathline, playResurrection, playSpy } from './cards';
import { getLegalMoves } from './rules';
import { c, has, makeState, seqRng } from './testHelpers';
import type { KarmaState } from './types';

function karmaWith(pendingCard: KarmaState['pendingCard']): KarmaState {
  return { pendingCard, blitzkrieg: null, depressionTurns: 0, discardMessage: null };
}

describe('Обстрел', () => {
  it('убивает только на подтверждённых клетках', () => {
    const a = c('player', 'warden', 1, 6);
    const foe = c('enemy', 'brute', 3, 1);
    const safe = c('enemy', 'brute', 6, 1);
    const state = makeState([a, foe, safe], { karma: karmaWith('barrage') });
    const { state: next } = playBarrage(state, [{ x: 3, y: 1 }, { x: 0, y: 0 }], () => 0.5);
    expect(next.creatures.some((cr) => cr.id === foe.id)).toBe(false);
    expect(next.creatures.some((cr) => cr.id === safe.id)).toBe(true);
  });
});

describe('Линия смерти (9.2)', () => {
  it('убивает существ обеих сторон в столбце и считается за ход', () => {
    const myWarden = c('player', 'warden', 3, 6);
    const myAcolyte = c('player', 'warden', 5, 6);
    const foeInColumn = c('enemy', 'brute', 3, 1);
    const foeOutside = c('enemy', 'brute', 6, 1);
    const state = makeState([myWarden, myAcolyte, foeInColumn, foeOutside], { karma: karmaWith('deathline') });

    const { state: next, events } = playDeathline(state, 3, seqRng([0.5]));
    const ids = next.creatures.map((cr) => cr.id);
    expect(ids).not.toContain(myWarden.id);
    expect(ids).not.toContain(foeInColumn.id);
    expect(ids).toContain(myAcolyte.id);
    expect(ids).toContain(foeOutside.id);
    expect(events.some((e) => e.t === 'turnEnded' && e.side === 'player')).toBe(true);
  });
});

describe('Воскрешение (9.2)', () => {
  it('неприменимо при пустом кладбище — карта сбрасывается с надписью', () => {
    const a = c('player', 'warden', 4, 4);
    const foe = c('enemy', 'brute', 2, 2);
    const state = makeState([a, foe], { karma: karmaWith('resurrection') });
    expect(isCardApplicable(state, 'resurrection')).toBe(false);

    const { state: next, events } = discardInapplicable(state);
    expect(next.karma.pendingCard).toBeNull();
    expect(next.karma.discardMessage).toBe('Карта не может быть разыграна');
    expect(events.some((e) => e.t === 'cardDiscarded' && e.card === 'resurrection')).toBe(true);
  });

  it('применимо, когда на кладбище есть существо', () => {
    const a = c('player', 'warden', 4, 4);
    const dead = c('player', 'warden', 0, 0);
    const foe = c('enemy', 'brute', 2, 2);
    const state = makeState([a, foe], {
      karma: karmaWith('resurrection'),
      graveyard: { player: [dead], enemy: [] },
    });
    expect(isCardApplicable(state, 'resurrection')).toBe(true);
  });

  it('возвращает павшего в зону ордена, и он может ходить', () => {
    const a = c('player', 'warden', 4, 4);
    const dead = c('player', 'acolyte', 3, 3);
    const foe = c('enemy', 'brute', 2, 2);
    const state = makeState([a, foe], {
      karma: karmaWith('resurrection'),
      graveyard: { player: [dead], enemy: [] },
    });
    const { state: next, events } = playResurrection(state, dead.id, () => 0.5);
    const revived = next.creatures.find((cr) => cr.id === dead.id)!;
    expect(revived.side).toBe('player');
    expect(revived.kind).toBe('acolyte');
    expect(revived.acted).toBe(false);
    expect(next.graveyard.player).toHaveLength(0);
    expect(events.some((e) => e.t === 'cardPlayed' && e.card === 'resurrection')).toBe(true);
    expect(getLegalMoves(next, dead.id).length).toBeGreaterThan(0);
  });
});

describe('Шпион (9.2)', () => {
  it('разворачивает направление существа: тварь ходит как орден, к y=0', () => {
    const a = c('player', 'warden', 0, 7);
    const foe = c('enemy', 'brute', 4, 4);
    const other = c('enemy', 'brute', 7, 1);
    const state = makeState([a, foe, other], { karma: karmaWith('spy') });

    const { state: next, events } = playSpy(state, foe.id, () => 0.5);
    const captured = next.creatures.find((cr) => cr.id === foe.id)!;
    expect(captured.side).toBe('player');
    expect(captured.kind).toBe('warden');
    expect(events.some((e) => e.t === 'captured' && e.id === foe.id)).toBe(true);

    // Квадрат теперь ходит вперёд ордена: к y=0, не назад.
    const moves = getLegalMoves(next, foe.id);
    expect(has(moves, 4, 3)).toBe(true);
    expect(has(moves, 4, 5)).toBe(false);
  });

  it('на линии повышения сразу становится фигурой ордена рангом выше', () => {
    const a = c('player', 'warden', 0, 7);
    const larva = c('enemy', 'larva', 3, 0);
    const brute = c('enemy', 'brute', 5, 0);
    const spare = c('enemy', 'larva', 7, 1);

    const fromLarva = playSpy(makeState([a, larva, spare], { karma: karmaWith('spy') }), larva.id, () => 0.5);
    const ordainedLarva = fromLarva.state.creatures.find((cr) => cr.id === larva.id)!;
    expect(ordainedLarva.kind).toBe('warden');
    expect(fromLarva.events.some((e) => e.t === 'ordained' && e.id === larva.id)).toBe(true);

    const fromBrute = playSpy(makeState([a, brute, spare], { karma: karmaWith('spy') }), brute.id, () => 0.5);
    const ordainedBrute = fromBrute.state.creatures.find((cr) => cr.id === brute.id)!;
    expect(ordainedBrute.kind).toBe('hierophant');
    expect(fromBrute.events.some((e) => e.t === 'ordained' && e.id === brute.id)).toBe(true);
  });

  it('после захвата доходит до линии и повышается как орден', () => {
    const a = c('player', 'warden', 0, 7);
    const foe = c('enemy', 'larva', 4, 1);
    const spare = c('enemy', 'brute', 7, 6);
    const captured = playSpy(makeState([a, foe, spare], { karma: karmaWith('spy') }), foe.id, () => 0.5);
    expect(captured.state.creatures.find((cr) => cr.id === foe.id)?.kind).toBe('acolyte');

    const { state: next, events } = applyMove(captured.state, foe.id, { x: 4, y: 0 }, () => 0.5);
    expect(next.creatures.find((cr) => cr.id === foe.id)?.kind).toBe('warden');
    expect(events.some((e) => e.t === 'ordained' && e.id === foe.id)).toBe(true);
  });
});

describe('сброс карты', () => {
  it('неразыгранная карта не сгорает в конце обычного хода, только в конце периода', () => {
    const w = c('player', 'warden', 4, 6);
    const foe = c('enemy', 'brute', 1, 1);
    const other = c('player', 'warden', 0, 7);
    const state = makeState([w, other, foe], {
      karma: karmaWith('blitzkrieg'),
      playerTurnNumber: 1,
      actionsTaken: 1,
    });
    const { state: next } = applyEndTurn(state, () => 0.5);
    expect(next.karma.pendingCard).toBe('blitzkrieg');

    const late = makeState([w, other, foe], {
      karma: karmaWith('blitzkrieg'),
      playerTurnNumber: 3,
      actionsTaken: 1,
    });
    const ended = applyEndTurn(late, () => 0.5);
    expect(ended.state.karma.pendingCard).toBeNull();
    expect(ended.events.some((e) => e.t === 'cardDiscarded' && e.card === 'blitzkrieg')).toBe(true);
  });
});

describe('Блицкриг (9.2)', () => {
  it('открывает окно на 5 действий и не завершает ход', () => {
    const w = c('player', 'warden', 4, 4);
    const foe = c('enemy', 'brute', 1, 1);
    const state = makeState([w, foe], { karma: karmaWith('blitzkrieg') });
    const { state: next } = playBlitzkrieg(state);
    expect(next.turn).toBe('player');
    expect(next.karma.blitzkrieg).toEqual({ creatureId: null, actionsLeft: 5 });
    expect(next.karma.pendingCard).toBeNull();
  });
});
