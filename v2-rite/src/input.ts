import { CANVAS_H, CANVAS_W } from './view/geometry';

export interface InputHandlers {
  onClick(x: number, y: number): void;
  onHover(x: number, y: number): void;
  onHoverEnd(): void;
  onKey(code: string): void;
  onCancel(): void;
}

/** Мышь, тач и хоткеи (6.3). Координаты переводятся в логические 1280×720. */
export function attachInput(canvas: HTMLCanvasElement, handlers: InputHandlers): () => void {
  function toLogical(clientX: number, clientY: number): { x: number; y: number } {
    const rect = canvas.getBoundingClientRect();
    return {
      x: ((clientX - rect.left) / rect.width) * CANVAS_W,
      y: ((clientY - rect.top) / rect.height) * CANVAS_H,
    };
  }

  function onClick(e: MouseEvent): void {
    const { x, y } = toLogical(e.clientX, e.clientY);
    handlers.onClick(x, y);
  }

  function onContextMenu(e: MouseEvent): void {
    e.preventDefault();
    handlers.onCancel();
  }

  function onMouseMove(e: MouseEvent): void {
    const { x, y } = toLogical(e.clientX, e.clientY);
    handlers.onHover(x, y);
  }

  function onKeyDown(e: KeyboardEvent): void {
    if (e.code === 'Space') e.preventDefault();
    handlers.onKey(e.code);
  }

  const onMouseLeave = (): void => handlers.onHoverEnd();

  canvas.addEventListener('click', onClick);
  canvas.addEventListener('contextmenu', onContextMenu);
  canvas.addEventListener('mousemove', onMouseMove);
  canvas.addEventListener('mouseleave', onMouseLeave);
  window.addEventListener('keydown', onKeyDown);

  return () => {
    canvas.removeEventListener('click', onClick);
    canvas.removeEventListener('contextmenu', onContextMenu);
    canvas.removeEventListener('mousemove', onMouseMove);
    canvas.removeEventListener('mouseleave', onMouseLeave);
    window.removeEventListener('keydown', onKeyDown);
  };
}
