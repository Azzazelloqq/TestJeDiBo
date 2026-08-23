import type { CreatureKind, EnemyKind, PlayerKind, Rank } from './types';

/** Ранг задаёт только правила движения и атаки (7). */
export const RANK_OF: Record<CreatureKind, Rank> = {
  warden: 'square',
  hierophant: 'circle',
  brute: 'square',
  shell: 'square',
  eye: 'circle',
  preacher: 'circle',
};

/** Ценности для ИИ (10.1). */
export const VALUE_ENEMY: Record<EnemyKind, number> = {
  brute: 20,
  shell: 40,
  eye: 100,
  preacher: 200,
};

export const VALUE_PLAYER: Record<PlayerKind, number> = {
  warden: 40,
  hierophant: 100,
};

export function creatureValue(kind: CreatureKind): number {
  return (VALUE_ENEMY as Record<string, number>)[kind] ?? (VALUE_PLAYER as Record<string, number>)[kind] ?? 0;
}

/** Посвящение ордена: квадрат становится кругом. */
export function ordainedPlayerKind(kind: CreatureKind): PlayerKind | null {
  if (kind === 'warden') return 'hierophant';
  return null;
}

/** Твари посвящаются зеркально: квадрат становится кругом. Панцирь и босс — нет. */
export function ordainedEnemyKind(kind: CreatureKind): EnemyKind | null {
  if (kind === 'brute') return 'eye';
  return null;
}

/** Одна строка — что делает существо. Для осмотра на арене. */
export const KIND_TRAITS: Record<CreatureKind, string> = {
  warden: 'Квадрат. Шаг и удар на 1–3: вперёд, вбок, вперёд по диагонали. Панциря не берёт.',
  hierophant: 'Круг. Ходит и бьёт во все стороны на 1–5. Бьёт Панциря.',
  brute: 'Квадрат. Ходит и бьёт как Страж, со стороны тварей.',
  shell: 'Бронированный квадрат. Берёт только удар круга — Иерофанта.',
  eye: 'Круг. Ходит и бьёт во все стороны на 1–5.',
  preacher: 'Босс. Сужает дальность Стражей и Иерофантов. Во второй фазе зовёт Квадраты.',
};

/** Короткая метка для списка тварей на арене. */
export const KIND_MARKS: Record<CreatureKind, string> = {
  warden: 'Квадрат · удар 1–3',
  hierophant: 'Круг · все стороны',
  brute: 'Квадрат',
  shell: 'Броня · бей кругом',
  eye: 'Круг',
  preacher: 'Босс',
};

export const KIND_NAMES: Record<CreatureKind, string> = {
  warden: 'Страж',
  hierophant: 'Иерофант',
  brute: 'Квадрат',
  shell: 'Панцирь',
  eye: 'Круг',
  preacher: 'Проповедник',
};

export function isEnemyKind(kind: CreatureKind): kind is EnemyKind {
  return kind in VALUE_ENEMY;
}
