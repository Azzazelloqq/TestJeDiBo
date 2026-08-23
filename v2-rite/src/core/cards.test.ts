import { describe, expect, it } from 'vitest';
import { applyEndTurn } from './battle';
import { discardInapplicable, isCardApplicable, playBarrage, playBlitzkrieg, playDeathline, playSpy } from './cards';
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
    expect(events.some((e) => e.t === 'captured' && e.id === foe.id)).toBe(true);

    // Квадрат теперь ходит вперёд ордена: к y=0, не назад.
    const moves = getLegalMoves(next, foe.id);
    expect(has(moves, 4, 3)).toBe(true);
    expect(has(moves, 4, 5)).toBe(false);
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
