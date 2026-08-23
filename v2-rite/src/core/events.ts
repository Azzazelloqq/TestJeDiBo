export type EventId = 'blind' | 'boneTrader' | 'threeDoors' | 'wallChoir';

export type EventEffect =
  | { kind: 'none' }
  | { kind: 'loseAcolyteGainRelic' }
  | { kind: 'tradeCard' }
  | { kind: 'doorsEnter' }
  | { kind: 'ordainOne' }
  | { kind: 'nextBattleAp' }
  | { kind: 'raiseFallen' };

export interface EventOption {
  label: string;
  outcome: string;
  effect: EventEffect;
}

export interface EventDef {
  id: EventId;
  name: string;
  text: string;
  a: EventOption;
  b: EventOption;
}

/** 4 события пути (4.5). Последствие всегда написано прямо. */
export const EVENTS: Record<EventId, EventDef> = {
  blind: {
    id: 'blind',
    name: 'Слепой',
    text: 'Он сидит у стены и просит глаз. Взамен обещает то, что видел.',
    a: { label: 'Отдать', outcome: 'Теряешь одного Послушника, получаешь случайную реликвию', effect: { kind: 'loseAcolyteGainRelic' } },
    b: { label: 'Пройти мимо', outcome: 'Ничего', effect: { kind: 'none' } },
  },
  boneTrader: {
    id: 'boneTrader',
    name: 'Торговец костью',
    text: 'Он раскладывает чужие знания на камне и ждёт обмена.',
    a: { label: 'Обменять', outcome: 'Отдаёшь одну Карту Кармы из пула, берёшь две другие', effect: { kind: 'tradeCard' } },
    b: { label: 'Отказаться', outcome: 'Ничего', effect: { kind: 'none' } },
  },
  threeDoors: {
    id: 'threeDoors',
    name: 'Три двери',
    text: 'Три проёма, из одного тянет теплом.',
    a: { label: 'Войти', outcome: 'С вероятностью 50% реликвия, иначе бой без награды', effect: { kind: 'doorsEnter' } },
    b: { label: 'Замуровать', outcome: 'Одно существо посвящается на ранг выше', effect: { kind: 'ordainOne' } },
  },
  wallChoir: {
    id: 'wallChoir',
    name: 'Хор в стене',
    text: 'Голоса поют изнутри камня, и они знают твоё имя.',
    a: { label: 'Слушать', outcome: 'Следующий бой начинается с 7 ОД вместо 5', effect: { kind: 'nextBattleAp' } },
    b: { label: 'Заткнуть уши', outcome: 'Одно погибшее существо возвращается Послушником', effect: { kind: 'raiseFallen' } },
  },
};
