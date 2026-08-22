import type { RunState } from '../core/run';
import { PALETTE } from '../view/creatureArt';
import { CANVAS_H, CANVAS_W } from '../view/geometry';
import { cardName, drawRelic, SANS, SERIF, smallCaps } from '../view/ui';

const RESTART = { x: CANVAS_W / 2 - 90, y: 560, w: 180, h: 44 };

/** Экран итогов (16): исход, статистика, рестарт в один клик. */
export function renderSummary(ctx: CanvasRenderingContext2D, run: RunState, nowMs: number, hover: boolean): void {
  ctx.fillStyle = '#000000';
  ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

  const outcome = run.outcome === 'victory' ? 'Обряд завершён' : 'Орден пал';
  ctx.fillStyle = PALETTE.textMain;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.font = `40px ${SERIF}`;
  ctx.fillText(smallCaps(outcome), CANVAS_W / 2, 140);

  const reached = Math.min(9, run.outcome === 'victory' ? 9 : run.level);
  ctx.font = `16px ${SERIF}`;
  const lines = [
    `уровень: ${reached} из 9`,
    `ходов: ${run.stats.turns}`,
    `убийств: ${run.stats.kills}`,
    `посвящений: ${run.stats.ordinations}`,
  ];
  lines.forEach((line, i) => ctx.fillText(line, CANVAS_W / 2, 230 + i * 30));

  // Собранные кармы и реликвии символами.
  if (run.pool.length > 0) {
    ctx.fillStyle = PALETTE.textMuted;
    ctx.font = `13px ${SANS}`;
    ctx.fillText(run.pool.map(cardName).join(' · '), CANVAS_W / 2, 370);
  }
  run.relics.forEach((relic, i) => {
    const x = CANVAS_W / 2 - ((run.relics.length - 1) * 52) / 2 + i * 52;
    drawRelic(ctx, relic, x, 440, 20);
  });

  ctx.save();
  ctx.translate(CANVAS_W / 2, RESTART.y + RESTART.h / 2);
  ctx.scale(hover ? 1.04 : 1, hover ? 1.04 : 1);
  ctx.fillStyle = PALETTE.blood;
  ctx.font = `24px ${SERIF}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(smallCaps('Заново'), 0, 0);
  ctx.restore();
  void nowMs;
}

export function pointInRestart(x: number, y: number): boolean {
  return x >= RESTART.x && x <= RESTART.x + RESTART.w && y >= RESTART.y && y <= RESTART.y + RESTART.h;
}
