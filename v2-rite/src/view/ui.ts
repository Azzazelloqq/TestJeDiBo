import { CARDS } from '../core/cards';
import { RELICS } from '../core/relics';
import type { CardId, RelicId } from '../core/types';
import { PALETTE } from './creatureArt';

export const SERIF = "Georgia, 'Times New Roman', serif";
export const SANS = "system-ui, -apple-system, 'Segoe UI', sans-serif";

/** Капитель с трекингом 2 (11.6). */
export function smallCaps(text: string): string {
  return text.toUpperCase().split('').join('\u200a\u200a');
}

export function wrapText(
  ctx: CanvasRenderingContext2D,
  text: string,
  cx: number,
  y: number,
  maxWidth: number,
  lineHeight: number,
  maxLines: number
): void {
  const words = text.split(' ');
  const lines: string[] = [];
  let line = '';
  for (const word of words) {
    const test = line ? `${line} ${word}` : word;
    if (ctx.measureText(test).width > maxWidth && line) {
      lines.push(line);
      line = word;
      if (lines.length >= maxLines) break;
    } else {
      line = test;
    }
  }
  if (line && lines.length < maxLines) lines.push(line);
  ctx.save();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  lines.forEach((l, i) => ctx.fillText(l, cx, y + i * lineHeight));
  ctx.restore();
}

export const CARD_W = 180;
export const CARD_H = 260;

/** Карта Кармы (11.5): 180×260, гравюра-символ примитивами. */
export function drawCard(ctx: CanvasRenderingContext2D, card: CardId, x: number, y: number, scale = 1, hover = false): void {
  const def = CARDS[card];
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(scale, scale);

  ctx.save();
  ctx.shadowColor = PALETTE.karma;
  ctx.shadowBlur = hover ? 20 : 12;
  ctx.fillStyle = PALETTE.background;
  ctx.strokeStyle = PALETTE.karma;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.roundRect(0, 0, CARD_W, CARD_H, 6);
  ctx.fill();
  ctx.stroke();
  ctx.restore();

  ctx.fillStyle = PALETTE.textMain;
  ctx.font = `18px ${SERIF}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.fillText(smallCaps(def.name), CARD_W / 2, 18);

  drawCardSymbol(ctx, card, CARD_W / 2, 110);

  ctx.fillStyle = PALETTE.textMuted;
  ctx.font = `13px ${SANS}`;
  wrapText(ctx, def.effect, CARD_W / 2, CARD_H - 80, CARD_W - 28, 15, 4);
  ctx.restore();
}

function drawCardSymbol(ctx: CanvasRenderingContext2D, card: CardId, cx: number, cy: number): void {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.strokeStyle = PALETTE.karma;
  ctx.fillStyle = PALETTE.karma;
  ctx.lineWidth = 2;

  switch (card) {
    case 'deathline': {
      // Вертикальный столб с расходящимися лучами.
      ctx.fillRect(-7, -40, 14, 80);
      for (let i = 0; i < 6; i++) {
        const a = -Math.PI / 2 + (i - 2.5) * 0.35;
        ctx.beginPath();
        ctx.moveTo(Math.cos(a) * 16, Math.sin(a) * 16 - 20);
        ctx.lineTo(Math.cos(a) * 42, Math.sin(a) * 42 - 20);
        ctx.stroke();
      }
      break;
    }
    case 'barrage': {
      // 8 точек по сетке 3×3 без центра.
      for (const gx of [-1, 0, 1]) {
        for (const gy of [-1, 0, 1]) {
          if (gx === 0 && gy === 0) continue;
          ctx.beginPath();
          ctx.arc(gx * 30, gy * 30, 5, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      break;
    }
    case 'spy': {
      // Два клина вершинами навстречу: один залит, один контурный.
      ctx.beginPath();
      ctx.moveTo(-42, -20);
      ctx.lineTo(-6, 0);
      ctx.lineTo(-42, 20);
      ctx.closePath();
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(42, -20);
      ctx.lineTo(6, 0);
      ctx.lineTo(42, 20);
      ctx.closePath();
      ctx.stroke();
      break;
    }
    case 'blitzkrieg': {
      // 5 стрелок в ряд нарастающей длины.
      for (let i = 0; i < 5; i++) {
        const len = 12 + i * 7;
        const y = -30 + i * 15;
        ctx.beginPath();
        ctx.moveTo(-len / 2, y);
        ctx.lineTo(len / 2, y);
        ctx.lineTo(len / 2 - 5, y - 4);
        ctx.moveTo(len / 2, y);
        ctx.lineTo(len / 2 - 5, y + 4);
        ctx.stroke();
      }
      break;
    }
    case 'resurrection': {
      // Круг с восходящей стрелкой.
      ctx.beginPath();
      ctx.arc(0, 4, 32, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(0, 26);
      ctx.lineTo(0, -22);
      ctx.lineTo(-9, -11);
      ctx.moveTo(0, -22);
      ctx.lineTo(9, -11);
      ctx.stroke();
      break;
    }
  }
  ctx.restore();
}

export const RELIC_R = 22;

/** Реликвия (5): круг r=22, обводка золотом, символ примитивами. */
export function drawRelic(ctx: CanvasRenderingContext2D, relic: RelicId, x: number, y: number, r = RELIC_R, hover = false): void {
  ctx.save();
  ctx.translate(x, y);

  ctx.save();
  ctx.shadowColor = PALETTE.candle;
  ctx.shadowBlur = hover ? 16 : 10;
  ctx.fillStyle = PALETTE.background;
  ctx.strokeStyle = PALETTE.candle;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.restore();

  const s = r / RELIC_R;
  ctx.scale(s, s);
  ctx.strokeStyle = PALETTE.candle;
  ctx.fillStyle = PALETTE.candle;
  ctx.lineWidth = 1.8;

  switch (relic) {
    case 'boneKey': {
      ctx.beginPath();
      ctx.arc(0, -6, 4.5, 0, Math.PI * 2);
      ctx.moveTo(0, -1.5);
      ctx.lineTo(0, 11);
      ctx.moveTo(0, 6);
      ctx.lineTo(5, 6);
      ctx.moveTo(0, 10);
      ctx.lineTo(4, 10);
      ctx.stroke();
      break;
    }
    case 'pilgrimSandals': {
      ctx.beginPath();
      ctx.ellipse(-5, 0, 3.5, 8, -0.2, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.ellipse(5, 3, 3.5, 8, 0.2, 0, Math.PI * 2);
      ctx.stroke();
      break;
    }
    case 'firstBlood': {
      ctx.beginPath();
      ctx.moveTo(0, -10);
      ctx.quadraticCurveTo(8, 2, 0, 10);
      ctx.quadraticCurveTo(-8, 2, 0, -10);
      ctx.fill();
      break;
    }
    case 'reliquary': {
      ctx.strokeRect(-8, -6, 16, 13);
      ctx.beginPath();
      ctx.moveTo(0, -6);
      ctx.lineTo(0, 7);
      ctx.moveTo(-8, 0);
      ctx.lineTo(8, 0);
      ctx.stroke();
      break;
    }
    case 'ashenCrown': {
      ctx.beginPath();
      ctx.moveTo(-9, 7);
      ctx.lineTo(-9, -3);
      ctx.lineTo(-4, 2);
      ctx.lineTo(0, -9);
      ctx.lineTo(4, 2);
      ctx.lineTo(9, -3);
      ctx.lineTo(9, 7);
      ctx.closePath();
      ctx.stroke();
      break;
    }
    case 'thornRim': {
      ctx.beginPath();
      ctx.arc(0, 0, 7, 0, Math.PI * 2);
      ctx.stroke();
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        ctx.beginPath();
        ctx.moveTo(Math.cos(a) * 7, Math.sin(a) * 7);
        ctx.lineTo(Math.cos(a) * 12, Math.sin(a) * 12);
        ctx.stroke();
      }
      break;
    }
    case 'vigilCandle': {
      ctx.strokeRect(-3, -2, 6, 12);
      ctx.beginPath();
      ctx.ellipse(0, -7, 2.5, 4.5, 0, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case 'returnSeal': {
      ctx.beginPath();
      ctx.arc(0, 0, 8, -Math.PI * 0.8, Math.PI * 0.7);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(-9, -6);
      ctx.lineTo(-2, -8);
      ctx.lineTo(-6, -1);
      ctx.closePath();
      ctx.fill();
      break;
    }
  }
  ctx.restore();
}

/** Всплывающая подсказка названия и эффекта (4.2). Тело переносится. */
export function drawTooltip(ctx: CanvasRenderingContext2D, title: string, body: string, x: number, y: number): void {
  ctx.save();
  ctx.font = `12px ${SANS}`;
  const maxInner = 248;
  const words = body.split(' ');
  const lines: string[] = [];
  let line = '';
  for (const word of words) {
    const test = line ? `${line} ${word}` : word;
    if (ctx.measureText(test).width > maxInner && line) {
      lines.push(line);
      line = word;
    } else line = test;
  }
  if (line) lines.push(line);

  ctx.font = `13px ${SERIF}`;
  const titleW = ctx.measureText(smallCaps(title)).width;
  const w = Math.min(280, Math.max(titleW, ...lines.map((l) => {
    ctx.font = `12px ${SANS}`;
    return ctx.measureText(l).width;
  })) + 24);
  const h = 28 + lines.length * 16;
  const clampedX = Math.min(Math.max(x, w / 2 + 8), 1280 - w / 2 - 8);
  let top = y;
  if (top + h > 712) top = y - h - 16;

  ctx.fillStyle = 'rgba(11,10,10,0.94)';
  ctx.beginPath();
  ctx.roundRect(clampedX - w / 2, top, w, h, 4);
  ctx.fill();
  ctx.strokeStyle = 'rgba(239,230,216,0.12)';
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.fillStyle = PALETTE.textMain;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.font = `13px ${SERIF}`;
  ctx.fillText(smallCaps(title), clampedX, top + 7);
  ctx.fillStyle = PALETTE.textMuted;
  ctx.font = `12px ${SANS}`;
  lines.forEach((l, i) => ctx.fillText(l, clampedX, top + 24 + i * 16));
  ctx.restore();
}

export function relicName(relic: RelicId): string {
  return RELICS[relic].name;
}

export function relicEffect(relic: RelicId): string {
  return RELICS[relic].effect;
}

export function cardName(card: CardId): string {
  return CARDS[card].name;
}

export function cardEffect(card: CardId): string {
  return CARDS[card].effect;
}
