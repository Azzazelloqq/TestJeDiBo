import type { RelicId } from './types';

export interface RelicDef {
  id: RelicId;
  name: string;
  effect: string;
}

/** 8 Реликвий (5). Каждая — один хук в ядре. */
export const RELICS: Record<RelicId, RelicDef> = {
  boneKey: { id: 'boneKey', name: 'Костяной ключ', effect: '+1 ОД в начале каждого твоего хода' },
  pilgrimSandals: { id: 'pilgrimSandals', name: 'Сандалии пилигрима', effect: 'Стражи ходят на 1–4 клетки. Атака не меняется.' },
  firstBlood: { id: 'firstBlood', name: 'Первая кровь', effect: 'Первое убийство в бою стоит 1 ОД и не завершает ход' },
  reliquary: { id: 'reliquary', name: 'Реликварий', effect: 'За каждое посвящение — случайная Карта Кармы до конца боя' },
  ashenCrown: { id: 'ashenCrown', name: 'Пепельный венец', effect: 'В каждом бою один случайный Квадрат врага не появляется' },
  thornRim: { id: 'thornRim', name: 'Терновый обод', effect: 'Когда твоё существо гибнет, гибнет и одна тварь рядом с ним' },
  vigilCandle: { id: 'vigilCandle', name: 'Свеча бдения', effect: 'Период Кармы сокращается с 3 ходов до 2' },
  returnSeal: { id: 'returnSeal', name: 'Печать возврата', effect: 'Первое погибшее за бой существо возвращается после боя' },
};

/** ОД в начале хода игрока (6.4 + Костяной ключ). */
export function apPerTurn(relics: RelicId[]): number {
  return 5 + (relics.includes('boneKey') ? 1 : 0);
}

/** Период Кармы (9.1 + Свеча бдения). */
export function karmaPeriod(relics: RelicId[]): number {
  return relics.includes('vigilCandle') ? 2 : 3;
}

/** Дальность движения Стража (Сандалии пилигрима: 1–4, атака не меняется). */
export function wardenMoveRange(relics: RelicId[]): number {
  return relics.includes('pilgrimSandals') ? 4 : 3;
}
