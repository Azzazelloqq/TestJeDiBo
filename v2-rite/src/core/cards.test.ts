import { describe, expect, it } from 'vitest';
import { discardInapplicable, isCardApplicable, playBlitzkrieg, playDeathline, playSpy } from './cards';
import { getLegalMoves } from './rules';
import { c, has, makeState, seqRng } from './testHelpers';
import type { KarmaState } from './types';

function karmaWith(pendingCard: KarmaState['pendingCard']): KarmaState {
  return { pendingCard, blitzkrieg: null, depressionTurns: 0, discardMessage: null };
}

describe('Линия смерти (9.2)', () => {
  it('убивает существ обеих сторон в столбце и считается за ход', () => {
    const myWarden = c('player', 'warden', 3, 6);
    const myAcolyte = c('player', 'acolyte', 5, 6);
    const foeInColumn = c('enemy', 'larva', 3, 1);
    const foeOutside = c('enemy', 'larva', 6, 1);
    const state = makeState([myWarden, myAcolyte, foeInColumn, foeOutside], { karma: karmaWith('deathline') });

    // randInt(0,7) при rng=3/8 → столбец 3.
    const { state: next, events } = playDeathline(state, seqRng([3 / 8, 0.5]));
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
    const a = c('player', 'acolyte', 4, 4);
    const foe = c('enemy', 'larva', 2, 2);
    const state = makeState([a, foe], { karma: karmaWith('resurrection') });
    expect(isCardApplicable(state, 'resurrection')).toBe(false);

    const { state: next, events } = discardInapplicable(state);
    expect(next.karma.pendingCard).toBeNull();
    expect(next.karma.discardMessage).toBe('Карта не может быть разыграна');
    expect(events.some((e) => e.t === 'cardDiscarded' && e.card === 'resurrection')).toBe(true);
  });

  it('применимо, когда на кладбище есть существо', () => {
    const a = c('player', 'acolyte', 4, 4);
    const dead = c('player', 'acolyte', 0, 0);
    const foe = c('enemy', 'larva', 2, 2);
    const state = makeState([a, foe], {
      karma: karmaWith('resurrection'),
      graveyard: { player: [dead], enemy: [] },
    });
    expect(isCardApplicable(state, 'resurrection')).toBe(true);
  });
});

describe('Шпион (9.2)', () => {
  it('разворачивает направление существа: тварь ходит как орден, к y=0', () => {
    const a = c('player', 'acolyte', 0, 7);
    const foe = c('enemy', 'larva', 4, 4);
    const other = c('enemy', 'larva', 7, 1);
    const state = makeState([a, foe, other], { karma: karmaWith('spy') });

    const { state: next, events } = playSpy(state, foe.id, () => 0.5);
    const captured = next.creatures.find((cr) => cr.id === foe.id)!;
    expect(captured.side).toBe('player');
    expect(events.some((e) => e.t === 'captured' && e.id === foe.id)).toBe(true);

    // Личинка (треугольник) теперь ходит вперёд ордена: к y=0.
    const moves = getLegalMoves(next, foe.id);
    expect(has(moves, 4, 3)).toBe(true);
    expect(has(moves, 4, 5)).toBe(false);
  });
});

describe('Блицкриг (9.2)', () => {
  it('открывает окно на 5 действий и не завершает ход', () => {
    const w = c('player', 'warden', 4, 4);
    const foe = c('enemy', 'larva', 1, 1);
    const state = makeState([w, foe], { karma: karmaWith('blitzkrieg') });
    const { state: next } = playBlitzkrieg(state);
    expect(next.turn).toBe('player');
    expect(next.karma.blitzkrieg).toEqual({ creatureId: null, actionsLeft: 5 });
    expect(next.karma.pendingCard).toBeNull();
  });
});
