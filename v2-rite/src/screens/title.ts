import { PALETTE } from '../view/creatureArt';
import { CANVAS_H, CANVAS_W } from '../view/geometry';
import { SERIF, smallCaps } from '../view/ui';

const BUTTON = { x: CANVAS_W / 2 - 140, y: 430, w: 280, h: 48 };

/** Титул (3): название, одна кнопка. Держится максимум 2 секунды до первого клика. */
export function renderTitle(ctx: CanvasRenderingContext2D, nowMs: number, shownAtMs: number, hover: boolean): void {
  ctx.fillStyle = PALETTE.background;
  ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

  const t = Math.min(1, (nowMs - shownAtMs) / 1000);

  ctx.save();
  ctx.globalAlpha = t;
  ctx.fillStyle = PALETTE.textMain;
  ctx.font = `64px ${SERIF}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(smallCaps('Обряд'), CANVAS_W / 2, 300);

  ctx.font = `15px ${SERIF}`;
  ctx.fillStyle = PALETTE.textMuted;
  ctx.fillText(smallCaps('R I T E'), CANVAS_W / 2, 356);
  ctx.restore();

  if (t > 0.4) {
    ctx.save();
    ctx.globalAlpha = Math.min(1, (t - 0.4) / 0.4);
    const scale = hover ? 1.04 : 1;
    ctx.translate(CANVAS_W / 2, BUTTON.y + BUTTON.h / 2);
    ctx.scale(scale, scale);
    ctx.fillStyle = hover ? PALETTE.candle : PALETTE.textMain;
    ctx.font = `20px ${SERIF}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(smallCaps('Начать обряд'), 0, 0);
    ctx.restore();
  }
}

export function pointInTitleButton(x: number, y: number): boolean {
  return x >= BUTTON.x && x <= BUTTON.x + BUTTON.w && y >= BUTTON.y && y <= BUTTON.y + BUTTON.h;
}
