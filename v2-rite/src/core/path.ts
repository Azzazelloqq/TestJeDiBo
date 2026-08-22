import type { BattleId } from './arenas';
import type { EventId } from './events';

export type NodeType = 'battle' | 'elite' | 'event' | 'altar' | 'treasure' | 'boss';

export interface PathNode {
  id: string;
  level: number;
  type: NodeType;
  label: string;
  battleId?: BattleId;
  eventId?: EventId;
}

/**
 * Путь (4.1): 9 уровней, на чётных два узла на выбор, на нечётных один.
 * Структура и содержимое фиксированные.
 */
export const PATH_LEVELS: PathNode[][] = [
  [{ id: 'n1', level: 1, type: 'battle', label: 'Преддверие', battleId: 'L1' }],
  [
    { id: 'n2A', level: 2, type: 'event', label: 'Слепой', eventId: 'blind' },
    { id: 'n2B', level: 2, type: 'battle', label: 'Колодец', battleId: 'L2B' },
  ],
  [{ id: 'n3', level: 3, type: 'battle', label: 'Жаровня', battleId: 'L3' }],
  [
    { id: 'n4A', level: 4, type: 'elite', label: 'Провал', battleId: 'L4A' },
    { id: 'n4B', level: 4, type: 'event', label: 'Торговец костью', eventId: 'boneTrader' },
  ],
  [{ id: 'n5', level: 5, type: 'treasure', label: 'Сокровище' }],
  [
    { id: 'n6A', level: 6, type: 'battle', label: 'Галерея', battleId: 'L6A' },
    { id: 'n6B', level: 6, type: 'event', label: 'Три двери', eventId: 'threeDoors' },
  ],
  [{ id: 'n7', level: 7, type: 'altar', label: 'Алтарь' }],
  [{ id: 'n8', level: 8, type: 'battle', label: 'Хор', battleId: 'L8' }],
  [{ id: 'n9', level: 9, type: 'boss', label: 'Алтарь Проповедника', battleId: 'L9' }],
];

export function getNode(id: string): PathNode {
  for (const level of PATH_LEVELS) {
    const node = level.find((n) => n.id === id);
    if (node) return node;
  }
  throw new Error(`unknown path node: ${id}`);
}

export function nodesAtLevel(level: number): PathNode[] {
  return PATH_LEVELS[level - 1] ?? [];
}
