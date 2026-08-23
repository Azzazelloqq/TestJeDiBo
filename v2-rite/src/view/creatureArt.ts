import { RANK_OF } from '../core/creatures';
import type { CreatureKind, Side } from '../core/types';

export const PALETTE = {
  background: '#0B0A0A',
  floor: '#14120F',
  player: '#EFE6D8',
  enemy: '#5C3834',
  blood: '#8C1C13',
  candle: '#D9A441',
  karma: '#2E6B5E',
  textMain: '#EFE6D8',
  textMuted: '#7A7370',
} as const;

/** Динамика повадок, вычисляемая рендером из состояния боя. */
export interface CreatureMood {
  /** Панцирь: глаз открыт (существо ордена в зоне атаки), 0..1. */
  shellOpen?: number;
  /** Ловчий: угол на ближайшее существо ордена. */
  gazeAngle?: number | null;
  /** Око: за ход до толчка глаз краснеет и растёт. */
  eyeCharging?: boolean;
  /** Око: зрачок следит за курсором. */
  cursorAngle?: number | null;
  /** Проповедник: зрачок сужается при наведении на своё существо. */
  preacherNarrow?: boolean;
  /** Ткач: смещения к соседним клеткам для нитей (в пикселях). */
  threadTargets?: { x: number; y: number }[];
}

function hashSeed(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) h = (h ^ id.charCodeAt(i)) * 16777619;
  return h >>> 0;
}

/** Моргание (7.4): сжатие по вертикали до 10% за 60 мс и обратно. */
function blinkScale(nowMs: number, seed: number, periodMinS: number, periodMaxS: number): number {
  const period = periodMinS + (seed % 1000) / 1000 * (periodMaxS - periodMinS);
  const t = (nowMs / 1000 + (seed % 97) * 0.13) % period;
  if (t > 0.12) return 1;
  const p = t / 0.12; // 0..1 за 120 мс
  const s = p < 0.5 ? 1 - p * 2 * 0.9 : 0.1 + (p - 0.5) * 2 * 0.9;
  return s;
}

interface EyeOpts {
  r: number;
  color: string;
  glow?: number;
  blink?: number; // 0.1..1 вертикальный масштаб
  pupilRatio?: number;
  pupilAngle?: number | null; // куда смотрит зрачок
  pupilShift?: number;
  vertical?: boolean; // вертикальный зрачок
  verticalAngle?: number;
  pupilScaleX?: number; // сужение
}

/** Глаз (7.4): круг со свечением, поверх зрачок 40% радиуса. */
function drawEye(ctx: CanvasRenderingContext2D, x: number, y: number, o: EyeOpts): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(1, o.blink ?? 1);

  ctx.save();
  ctx.shadowColor = o.color;
  ctx.shadowBlur = o.glow ?? 6;
  ctx.fillStyle = o.color;
  ctx.beginPath();
  ctx.arc(0, 0, o.r, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  const pr = o.r * (o.pupilRatio ?? 0.4);
  let px = 0;
  let py = 0;
  if (o.pupilAngle !== null && o.pupilAngle !== undefined) {
    const shift = o.pupilShift ?? o.r * 0.3;
    px = Math.cos(o.pupilAngle) * shift;
    py = Math.sin(o.pupilAngle) * shift;
  }
  ctx.fillStyle = PALETTE.background;
  if (o.vertical) {
    ctx.save();
    ctx.translate(px, py);
    ctx.rotate(o.verticalAngle ?? 0);
    ctx.scale(o.pupilScaleX ?? 1, 1);
    ctx.beginPath();
    ctx.ellipse(0, 0, pr * 0.55, pr * 1.6, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  } else {
    ctx.beginPath();
    ctx.arc(px, py, pr, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

/** Метки за пережитые бои (7.1): короткие линии, позиции детерминированы. */
function drawMarks(ctx: CanvasRenderingContext2D, marks: number, seed: number): void {
  ctx.strokeStyle = 'rgba(140,28,19,0.5)';
  ctx.lineWidth = 1.5;
  const count = Math.min(5, marks);
  for (let i = 0; i < count; i++) {
    const a = -Math.PI / 2 + ((i + (seed % 3)) * 2 * Math.PI) / 5;
    const rr = 12;
    const cx = Math.cos(a) * rr;
    const cy = Math.sin(a) * rr;
    ctx.beginPath();
    ctx.moveTo(cx - 3, cy);
    ctx.lineTo(cx + 3, cy);
    ctx.stroke();
  }
}

export interface DrawCreatureOpts {
  kind: CreatureKind;
  side: Side;
  id: string;
  marks: number;
  nowMs: number;
  mood?: CreatureMood;
  /** Приглушить (кладбище, панель ордена). */
  still?: boolean;
}

/**
 * Рисует существо в его текущей позе в точке (0,0). У каждого существа
 * обеих сторон есть глаза и повадка (1.1) — иначе это фишка.
 */
export function drawCreature(ctx: CanvasRenderingContext2D, o: DrawCreatureOpts): void {
  const seed = hashSeed(o.id);
  const t = o.still ? 0 : o.nowMs / 1000;
  const rank = RANK_OF[o.kind];
  const isPlayer = o.side === 'player';
  const baseColor = isPlayer ? PALETTE.player : PALETTE.enemy;
  const mood = o.mood ?? {};

  ctx.save();

  // Дыхание: треугольник чаще, квадрат 5 с, круг почти не дышит.
  if (!o.still) {
    const period = rank === 'triangle' ? 3 : rank === 'square' ? 5 : 4;
    const breathe =
      1 +
      0.02 *
        (0.5 + 0.5 * Math.sin(((t + (seed % 13) * 0.37) / period) * Math.PI * 2)) *
        (rank === 'circle' && o.kind !== 'preacher' ? 0 : 1);
    ctx.scale(breathe, breathe);
  }

  switch (o.kind) {
    case 'acolyte':
    case 'larva': {
      drawTriangleBody(ctx, isPlayer ? PALETTE.player : PALETTE.enemy, isPlayer ? -1 : 1, isPlayer);
      if (o.kind === 'acolyte') {
        const blink = o.still ? 1 : blinkScale(o.nowMs, seed, 3.2, 5.8);
        drawEye(ctx, -3.5, isPlayer ? 3 : -3, { r: 2.1, color: '#1a1614', pupilRatio: 0.5, blink });
        drawEye(ctx, 3.5, isPlayer ? 3 : -3, {
          r: 2.1,
          color: '#1a1614',
          pupilRatio: 0.5,
          blink: o.still ? 1 : blinkScale(o.nowMs, seed + 29, 3.2, 5.8),
        });
      } else {
        drawEye(ctx, 0, isPlayer ? 2 : -2, {
          r: 3.2,
          color: PALETTE.blood,
          glow: 7,
          blink: o.still ? 1 : blinkScale(o.nowMs, seed, 2.2, 4.2),
        });
      }
      break;
    }

    case 'shell': {
      const s = 44;
      ctx.fillStyle = '#2A201C';
      ctx.beginPath();
      ctx.roundRect(-s / 2, -s / 2, s, s, 3);
      ctx.fill();
      ctx.strokeStyle = '#1a1410';
      ctx.lineWidth = 6;
      ctx.stroke();
      ctx.strokeStyle = 'rgba(217,164,65,0.18)';
      ctx.lineWidth = 2;
      for (let i = -1; i <= 1; i++) {
        ctx.beginPath();
        ctx.moveTo(-16, i * 8);
        ctx.lineTo(16, i * 8);
        ctx.stroke();
      }
      ctx.fillStyle = 'rgba(217,164,65,0.25)';
      for (const [sx, sy] of [[-18, -18], [16, -18], [-18, 16], [16, 16]] as const) {
        ctx.fillRect(sx, sy, 4, 4);
      }
      const open = mood.shellOpen ?? 0;
      if (open < 0.05) {
        ctx.fillStyle = '#0a0808';
        ctx.fillRect(-8, -2, 16, 3);
      } else {
        drawEye(ctx, 0, 0, { r: 2 + 3 * open, color: PALETTE.blood, glow: 8 * open, blink: Math.max(0.15, open) });
      }
      break;
    }

    case 'warden':
    case 'brute': {
      const s = 40;
      ctx.fillStyle = baseColor;
      ctx.beginPath();
      ctx.roundRect(-s / 2, -s / 2, s, s, 4);
      ctx.fill();
      if (isPlayer) {
        ctx.strokeStyle = 'rgba(255,255,255,0.12)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.roundRect(-s / 2 + 3, -s / 2 + 3, s - 6, s - 6, 3);
        ctx.stroke();
      } else {
        ctx.strokeStyle = 'rgba(0,0,0,0.55)';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.roundRect(-s / 2, -s / 2, s, s, 4);
        ctx.stroke();
      }

      if (o.kind === 'warden') {
        const blink = o.still ? 1 : blinkScale(o.nowMs, seed, 3.5, 6.5);
        drawEye(ctx, -5, -4, { r: 2.5, color: '#1a1614', pupilRatio: 0.5, blink });
        drawEye(ctx, 5, -4, { r: 2.5, color: '#1a1614', pupilRatio: 0.5, blink: o.still ? 1 : blinkScale(o.nowMs, seed + 31, 3.5, 6.5) });
      } else {
        drawEye(ctx, -5, 0, { r: 2.5, color: PALETTE.blood, glow: 6, blink: o.still ? 1 : blinkScale(o.nowMs, seed, 2.5, 4.5) });
        drawEye(ctx, 5, 0, { r: 2.5, color: PALETTE.blood, glow: 6, blink: o.still ? 1 : blinkScale(o.nowMs, seed + 17, 2.5, 4.5) });
      }
      break;
    }

    case 'hierophant': {
      // Диск, внутри кольцо с пульсирующим свечением (7.1).
      const pulse = o.still ? 14 : 12 + (0.5 + 0.5 * Math.sin((t / 3) * Math.PI * 2)) * 8;
      ctx.save();
      ctx.shadowColor = PALETTE.candle;
      ctx.shadowBlur = o.still ? 8 : 16;
      ctx.fillStyle = baseColor;
      ctx.beginPath();
      ctx.arc(0, 0, 22, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();

      ctx.save();
      ctx.shadowColor = PALETTE.candle;
      ctx.shadowBlur = pulse;
      ctx.strokeStyle = PALETTE.candle;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(0, 0, 12, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();

      // Глаз с вертикальным зрачком; зрачок медленно вращается, не моргает никогда.
      drawEye(ctx, 0, 0, { r: 6, color: '#141210', vertical: true, verticalAngle: o.still ? 0 : t * 0.4, pupilRatio: 0.55 });
      break;
    }

    case 'eye': {
      const charging = mood.eyeCharging ?? false;
      const r = 22 * (charging ? 1.15 : 1);
      ctx.fillStyle = baseColor;
      ctx.beginPath();
      ctx.arc(0, 0, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,0.55)';
      ctx.lineWidth = 3;
      ctx.stroke();

      drawEye(ctx, 0, 0, {
        r: 8 * (charging ? 1.15 : 1),
        color: charging ? PALETTE.blood : '#8a8078',
        glow: charging ? 12 : 6,
        pupilAngle: mood.cursorAngle ?? null,
        pupilShift: 3,
        pupilRatio: 3.5 / 8,
      });
      break;
    }

    case 'preacher': {
      drawPreacher(ctx, t, o.still ?? false, mood.preacherNarrow ?? false);
      break;
    }
  }

  if (isPlayer && o.marks > 0) drawMarks(ctx, o.marks, seed);

  ctx.restore();
}

/** Равносторонний треугольник, вершина смотрит «вперёд» стороны. */
function drawTriangleBody(ctx: CanvasRenderingContext2D, fill: string, dir: 1 | -1, player: boolean): void {
  const r = 22;
  ctx.save();
  ctx.shadowColor = '#000';
  ctx.shadowBlur = 12;
  ctx.shadowOffsetY = 4;
  ctx.fillStyle = fill;
  ctx.beginPath();
  for (let i = 0; i < 3; i++) {
    const a = -Math.PI / 2 + (dir === 1 ? Math.PI : 0) + (i * 2 * Math.PI) / 3;
    const x = Math.cos(a) * r;
    const y = Math.sin(a) * r;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.fill();
  ctx.restore();

  ctx.strokeStyle = player ? 'rgba(0,0,0,0.4)' : 'rgba(0,0,0,0.55)';
  ctx.lineWidth = player ? 1.5 : 3;
  ctx.beginPath();
  for (let i = 0; i < 3; i++) {
    const a = -Math.PI / 2 + (dir === 1 ? Math.PI : 0) + (i * 2 * Math.PI) / 3;
    const x = Math.cos(a) * r;
    const y = Math.sin(a) * r;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.stroke();

  if (player) {
    ctx.strokeStyle = 'rgba(0,0,0,0.10)';
    ctx.lineWidth = 1;
    for (let i = 0; i < 5; i++) {
      const a = ((i * 2.1) % 3) - 1.4;
      ctx.beginPath();
      ctx.moveTo(-6 + i * 2.4, 4 + a * 3);
      ctx.lineTo(-2 + i * 2.1, 8 + a);
      ctx.stroke();
    }
  }
}

/** Митра, тройное кольцо, тлеющее ядро — сразу читается как босс, не как круг. */
function drawPreacher(ctx: CanvasRenderingContext2D, t: number, still: boolean, narrow: boolean): void {
  const pulse = still ? 0.35 : 0.5 + 0.5 * Math.sin((t / 1.6) * Math.PI * 2);

  ctx.save();
  ctx.shadowColor = PALETTE.blood;
  ctx.shadowBlur = still ? 14 : 18 + pulse * 10;
  ctx.fillStyle = '#3A1814';
  ctx.beginPath();
  ctx.arc(0, 4, 20, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  ctx.strokeStyle = PALETTE.blood;
  ctx.lineWidth = 3.5;
  ctx.beginPath();
  ctx.arc(0, 4, 20, 0, Math.PI * 2);
  ctx.stroke();
  ctx.lineWidth = 2;
  ctx.strokeStyle = PALETTE.candle;
  ctx.beginPath();
  ctx.arc(0, 4, 15, 0, Math.PI * 2);
  ctx.stroke();
  ctx.strokeStyle = PALETTE.blood;
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.arc(0, 4, 10.5, 0, Math.PI * 2);
  ctx.stroke();

  ctx.save();
  ctx.shadowColor = PALETTE.candle;
  ctx.shadowBlur = still ? 8 : 10 + pulse * 8;
  ctx.fillStyle = `rgba(217,164,65,${0.28 + pulse * 0.22})`;
  ctx.beginPath();
  ctx.arc(0, 4, 5.2, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  // Митра — силуэт, которого нет ни у круга, ни у глаза.
  ctx.save();
  ctx.shadowColor = 'rgba(239,230,216,0.35)';
  ctx.shadowBlur = 10;
  ctx.fillStyle = '#F0E6D4';
  ctx.beginPath();
  ctx.moveTo(0, -36);
  ctx.bezierCurveTo(10, -30, 16, -18, 13, -6);
  ctx.lineTo(7, -2);
  ctx.lineTo(0, -8);
  ctx.lineTo(-7, -2);
  ctx.lineTo(-13, -6);
  ctx.bezierCurveTo(-16, -18, -10, -30, 0, -36);
  ctx.closePath();
  ctx.fill();
  ctx.restore();

  ctx.strokeStyle = PALETTE.blood;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(0, -36);
  ctx.bezierCurveTo(10, -30, 16, -18, 13, -6);
  ctx.lineTo(7, -2);
  ctx.lineTo(0, -8);
  ctx.lineTo(-7, -2);
  ctx.lineTo(-13, -6);
  ctx.bezierCurveTo(-16, -18, -10, -30, 0, -36);
  ctx.closePath();
  ctx.stroke();

  ctx.strokeStyle = PALETTE.candle;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(0, -32);
  ctx.lineTo(0, -10);
  ctx.stroke();
  ctx.fillStyle = PALETTE.blood;
  ctx.beginPath();
  ctx.arc(0, -22, 2.2, 0, Math.PI * 2);
  ctx.fill();

  // Ленты столы.
  ctx.strokeStyle = PALETTE.candle;
  ctx.lineWidth = 2.2;
  ctx.beginPath();
  ctx.moveTo(-7, 20);
  ctx.quadraticCurveTo(-10, 28, -8, 34);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(7, 20);
  ctx.quadraticCurveTo(10, 28, 8, 34);
  ctx.stroke();

  drawEye(ctx, 0, 3, {
    r: 6.4,
    color: PALETTE.blood,
    glow: still ? 8 : 12 + pulse * 6,
    vertical: true,
    pupilRatio: 0.58,
    pupilScaleX: narrow ? 0.4 : 1,
  });
}
