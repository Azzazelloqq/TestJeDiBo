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

export interface CameraView {
  shakeX: number;
  shakeY: number;
  zoom: number;
}

function boardCenter(): { x: number; y: number } {
  return { x: BOARD_ORIGIN.x + BOARD_PX / 2, y: BOARD_ORIGIN.y + BOARD_PX / 2 };
}

/** То же дыхание, что у рендера арены (13.5). */
export function breatheZoom(nowMs: number): number {
  return 1 + 0.005 * Math.sin((nowMs / 8000) * Math.PI * 2);
}

/** Экран → клетка арены: инверсия zoom/shake, иначе клик мимо фигуры. */
export function boardPointFromScreen(x: number, y: number, cam: CameraView, nowMs: number): { x: number; y: number } {
  const { x: cx, y: cy } = boardCenter();
  const z = cam.zoom * breatheZoom(nowMs);
  return {
    x: (x - cx - cam.shakeX) / z + cx,
    y: (y - cy - cam.shakeY) / z + cy,
  };
}

export function screenPointFromBoard(x: number, y: number, cam: CameraView, nowMs: number): { x: number; y: number } {
  const { x: cx, y: cy } = boardCenter();
  const z = cam.zoom * breatheZoom(nowMs);
  return {
    x: (x - cx) * z + cx + cam.shakeX,
    y: (y - cy) * z + cy + cam.shakeY,
  };
}
