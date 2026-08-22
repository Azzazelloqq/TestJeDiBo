import { describe, expect, it } from 'vitest';
import { applyAttack, applyMove } from './battle';
import { getLegalAttacks, getLegalMoves } from './rules';
import { c, has, makeState } from './testHelpers';

describe('движение по рангам (6.5)', () => {
  it('Послушник ходит только вперёд на 1, не назад и не вбок', () => {
    const a = c('player', 'acolyte', 4, 4);
    const state = makeState([a]);
    const moves = getLegalMoves(state, a.id);
    expect(moves).toHaveLength(1);
    expect(has(moves, 4, 3)).toBe(true);
  });

  it('с Сандалиями пилигрима Послушник ходит на 2, но атакует на 1', () => {
    const a = c('player', 'acolyte', 4, 4);
    const state = makeState([a], { relics: ['pilgrimSandals'] });
    const moves = getLegalMoves(state, a.id);
    expect(has(moves, 4, 3)).toBe(true);
    expect(has(moves, 4, 2)).toBe(true);
    expect(has(moves, 4, 1)).toBe(false);

    // Враг в 2 клетках впереди — вне дальности атаки (атака не растёт).
    const far = c('enemy', 'larva', 4, 2);
    const withEnemy = makeState([a, far], { relics: ['pilgrimSandals'] });
    expect(getLegalAttacks(withEnemy, a.id)).toHaveLength(0);
  });

  it('Страж не ходит назад, ходит на 1–3 в пяти направлениях', () => {
    const w = c('player', 'warden', 4, 4);
    const state = makeState([w]);
    const moves = getLegalMoves(state, w.id);
    expect(has(moves, 4, 5)).toBe(false); // назад нельзя
    expect(has(moves, 3, 5)).toBe(false);
    expect(has(moves, 4, 3)).toBe(true);
    expect(has(moves, 4, 1)).toBe(true); // вперёд на 3
    expect(has(moves, 1, 4)).toBe(true); // вбок на 3
    expect(has(moves, 2, 2)).toBe(true); // диагональ вперёд
  });

  it('Страж не перепрыгивает через существ', () => {
    const w = c('player', 'warden', 4, 4);
    const ally = c('player', 'acolyte', 4, 2);
    const state = makeState([w, ally]);
    const moves = getLegalMoves(state, w.id);
    expect(has(moves, 4, 3)).toBe(true);
    expect(has(moves, 4, 1)).toBe(false); // за спиной союзника
  });

  it('Иерофант ходит во все стороны на 1–5 и не перепрыгивает', () => {
    const h = c('player', 'hierophant', 4, 4);
    const enemy = c('enemy', 'larva', 4, 2);
    const state = makeState([h, enemy]);
    const moves = getLegalMoves(state, h.id);
    expect(has(moves, 4, 5)).toBe(true); // назад можно
    expect(has(moves, 0, 4)).toBe(true); // вбок на 4
    expect(has(moves, 4, 3)).toBe(true);
    expect(has(moves, 4, 1)).toBe(false); // за врагом — нельзя
    const attacks = getLegalAttacks(state, h.id);
    expect(has(attacks, 4, 2)).toBe(true); // а сам враг — цель
  });
});

describe('непроходимые клетки (6.5)', () => {
  it('через непроходимую клетку нельзя ни пройти, ни атаковать', () => {
    // Арена «Колодец»: непроходимы (3,3) и (4,4).
    const h = c('player', 'hierophant', 3, 5);
    const target = c('enemy', 'larva', 3, 1);
    const state = makeState([h, target], { arena: 'well' });
    const moves = getLegalMoves(state, h.id);
    expect(has(moves, 3, 4)).toBe(true);
    expect(has(moves, 3, 3)).toBe(false); // сама клетка
    expect(has(moves, 3, 2)).toBe(false); // за ней
    expect(has(getLegalAttacks(state, h.id), 3, 1)).toBe(false); // луч атаки оборван
  });
});

describe('атака и ОД (6.4, 6.6)', () => {
  it('атака тратит все оставшиеся ОД и завершает ход', () => {
    const w = c('player', 'warden', 4, 4);
    const victim = c('enemy', 'larva', 4, 3);
    const other = c('enemy', 'larva', 2, 1);
    const state = makeState([w, victim, other]);
    const { state: next, events } = applyAttack(state, w.id, { x: 4, y: 3 }, () => 0.5);
    expect(next.turn).toBe('enemy');
    expect(events.some((e) => e.t === 'killed' && e.id === victim.id)).toBe(true);
    expect(events.some((e) => e.t === 'turnEnded' && e.side === 'player')).toBe(true);
  });

  it('существо не действует дважды за ход', () => {
    const w = c('player', 'warden', 4, 4);
    const other = c('player', 'acolyte', 1, 4);
    const enemy = c('enemy', 'larva', 7, 0);
    const state = makeState([w, other, enemy]);
    const { state: next } = applyMove(state, w.id, { x: 4, y: 3 }, () => 0.5);
    expect(next.turn).toBe('player');
    expect(getLegalMoves(next, w.id)).toHaveLength(0); // уже действовал
    expect(getLegalMoves(next, other.id).length).toBeGreaterThan(0);
  });

  it('под Блицкригом зафиксированное существо действует повторно', () => {
    const w = c('player', 'warden', 4, 4);
    const enemy = c('enemy', 'larva', 7, 0);
    const state = makeState([w, enemy], {
      karma: { pendingCard: null, blitzkrieg: { creatureId: null, actionsLeft: 5 }, depressionTurns: 0, discardMessage: null },
    });
    const { state: next } = applyMove(state, w.id, { x: 4, y: 3 }, () => 0.5);
    expect(next.karma.blitzkrieg?.creatureId).toBe(w.id);
    expect(getLegalMoves(next, w.id).length).toBeGreaterThan(0);
  });
});

describe('Панцирь (7.3)', () => {
  it('Послушник не может атаковать Панциря, Страж — может', () => {
    const a = c('player', 'acolyte', 4, 4);
    const w = c('player', 'warden', 3, 4);
    const shell = c('enemy', 'shell', 3, 3);
    const state = makeState([a, w, shell]);
    expect(has(getLegalAttacks(state, a.id), 3, 3)).toBe(false); // диагональ вперёд, но цель — Панцирь
    expect(has(getLegalAttacks(state, w.id), 3, 3)).toBe(true);
  });
});

describe('посвящение (6.7)', () => {
  it('мгновенное, размещение по 6.7, метки переносятся', () => {
    const a = c('player', 'acolyte', 4, 1, 3);
    const enemy = c('enemy', 'larva', 7, 6);
    const state = makeState([a, enemy]);
    const { state: next, events } = applyMove(state, a.id, { x: 4, y: 0 }, () => 0.5);
    const ordained = events.find((e) => e.t === 'ordained');
    expect(ordained).toBeTruthy();
    const creature = next.creatures.find((cr) => cr.id === a.id)!;
    expect(creature.kind).toBe('warden');
    expect(creature.marks).toBe(3);
    expect(creature.cell).toEqual({ x: 0, y: 7 }); // первая свободная: y=7, слева направо
  });

  it('отменяется, если свободных клеток размещения нет', () => {
    const a = c('player', 'acolyte', 4, 1);
    const fillers = [];
    for (let y = 5; y <= 7; y++) for (let x = 0; x < 8; x++) fillers.push(c('player', 'acolyte', x, y));
    const enemy = c('enemy', 'larva', 7, 3);
    const state = makeState([a, ...fillers, enemy]);
    const { state: next, events } = applyMove(state, a.id, { x: 4, y: 0 }, () => 0.5);
    expect(events.some((e) => e.t === 'ordainCancelled' && e.id === a.id)).toBe(true);
    const creature = next.creatures.find((cr) => cr.id === a.id)!;
    expect(creature.kind).toBe('acolyte');
    expect(creature.cell).toEqual({ x: 4, y: 0 });
  });
});
