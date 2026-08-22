import type { Cell } from '../core/types';

// §7.1. Shared by renderer.ts and animator.ts — kept separate from both so
// neither has to import the other just to compute pixel positions.
export const CANVAS_W = 1280;
export const CANVAS_H = 720;
export const BOARD_ORIGIN = { x: 384, y: 96 };
export const CELL_SIZE = 64;
export const BOARD_PX = 512;

export function cellCenter(cell: Cell): { x: number; y: number } {
  return {
    x: BOARD_ORIGIN.x + cell.x * CELL_SIZE + CELL_SIZE / 2,
    y: BOARD_ORIGIN.y + cell.y * CELL_SIZE + CELL_SIZE / 2,
  };
}

export function cellTopLeft(cell: Cell): { x: number; y: number } {
  return { x: BOARD_ORIGIN.x + cell.x * CELL_SIZE, y: BOARD_ORIGIN.y + cell.y * CELL_SIZE };
}

export function cellFromPoint(x: number, y: number): Cell | null {
  const localX = x - BOARD_ORIGIN.x;
  const localY = y - BOARD_ORIGIN.y;
  if (localX < 0 || localY < 0 || localX >= BOARD_PX || localY >= BOARD_PX) return null;
  return { x: Math.floor(localX / CELL_SIZE), y: Math.floor(localY / CELL_SIZE) };
}
