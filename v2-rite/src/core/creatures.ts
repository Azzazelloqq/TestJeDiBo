import type { CreatureKind, EnemyKind, PlayerKind, Rank } from './types';

/** Ранг задаёт только правила движения и атаки (7). */
export const RANK_OF: Record<CreatureKind, Rank> = {
  acolyte: 'triangle',
  penitent: 'triangle',
  warden: 'square',
  hierophant: 'circle',
  larva: 'triangle',
  weaver: 'triangle',
  shell: 'square',
  catcher: 'square',
  bellringer: 'square',
  eye: 'circle',
  preacher: 'circle',
};

/** Ценности для ИИ (10.1). */
export const VALUE_ENEMY: Record<EnemyKind, number> = {
  larva: 10,
  weaver: 20,
  shell: 40,
  bellringer: 45,
  catcher: 50,
  eye: 100,
  preacher: 200,
};

export const VALUE_PLAYER: Record<PlayerKind, number> = {
  acolyte: 10,
  penitent: 20,
  warden: 40,
  hierophant: 100,
};

export function creatureValue(kind: CreatureKind): number {
  return (VALUE_ENEMY as Record<string, number>)[kind] ?? (VALUE_PLAYER as Record<string, number>)[kind] ?? 0;
}

/** Посвящение ордена (6.7). Кающийся не посвящается никогда — его путь окончен. */
export function ordainedPlayerKind(kind: CreatureKind): PlayerKind | null {
  if (kind === 'acolyte') return 'warden';
  if (kind === 'warden') return 'hierophant';
  return null;
}

/** Твари посвящаются зеркально (6.7): по рангу вверх. */
export function ordainedEnemyKind(kind: CreatureKind): EnemyKind | null {
  const rank = RANK_OF[kind];
  if (rank === 'triangle') return 'shell';
  if (rank === 'square') return 'eye';
  return null;
}

export const KIND_NAMES: Record<CreatureKind, string> = {
  acolyte: 'Послушник',
  penitent: 'Кающийся',
  warden: 'Страж',
  hierophant: 'Иерофант',
  larva: 'Личинка',
  weaver: 'Ткач',
  shell: 'Панцирь',
  catcher: 'Ловчий',
  bellringer: 'Звонарь',
  eye: 'Око',
  preacher: 'Проповедник',
};

export function isEnemyKind(kind: CreatureKind): kind is EnemyKind {
  return kind in VALUE_ENEMY;
}
