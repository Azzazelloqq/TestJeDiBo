import { EVENTS } from '../core/events';
import {
  canOrdainMember,
  isAltarChoiceAvailable,
  isEventDeadEnd,
  isEventOptionAvailable,
  type AltarChoice,
  type RunState,
} from '../core/run';
import { KIND_NAMES } from '../core/creatures';
import type { CardId, RelicId } from '../core/types';
import { drawCreature, PALETTE } from '../view/creatureArt';
import { CANVAS_H, CANVAS_W } from '../view/geometry';
import { CARD_H, CARD_W, drawCard, drawRelic, relicEffect, relicName, SANS, SERIF, smallCaps, wrapText } from '../view/ui';
import { RELIC_SCENE_DURATION_MS } from '../view/scenes';

export type OverlayAction =
  | { type: 'card'; card: CardId }
  | { type: 'relic'; relic: RelicId }
  | { type: 'altar'; choice: AltarChoice }
  | { type: 'event'; option: 'a' | 'b' }
  | { type: 'member'; id: string }
  | { type: 'close' };

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

const inRect = (r: Rect, x: number, y: number): boolean => x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;

function cardRects(count: number): Rect[] {
  const gap = 60;
  const totalW = count * CARD_W + (count - 1) * gap;
  const startX = CANVAS_W / 2 - totalW / 2;
  return Array.from({ length: count }, (_, i) => ({ x: startX + i * (CARD_W + gap), y: 230, w: CARD_W, h: CARD_H }));
}

function relicRects(count: number): Rect[] {
  const gap = 180;
  const startX = CANVAS_W / 2 - ((count - 1) * gap) / 2;
  return Array.from({ length: count }, (_, i) => ({ x: startX + i * gap - 50, y: 280, w: 100, h: 140 }));
}

function eventOptionRects(): [Rect, Rect] {
  return [
    { x: CANVAS_W / 2 - 330, y: 380, w: 300, h: 110 },
    { x: CANVAS_W / 2 + 30, y: 380, w: 300, h: 110 },
  ];
}

function altarRects(): Rect[] {
  return [0, 1, 2].map((i) => ({ x: CANVAS_W / 2 - 260, y: 250 + i * 100, w: 520, h: 84 }));
}

function memberRects(count: number): Rect[] {
  const perRow = Math.min(count, 6);
  const gap = 90;
  return Array.from({ length: count }, (_, i) => {
    const row = Math.floor(i / 6);
    const col = i % 6;
    const rowCount = Math.min(count - row * 6, perRow);
    const startX = CANVAS_W / 2 - ((rowCount - 1) * gap) / 2;
    return { x: startX + col * gap - 32, y: 290 + row * 100 - 32, w: 64, h: 64 };
  });
}

export function renderOverlay(
  ctx: CanvasRenderingContext2D,
  run: RunState,
  nowMs: number,
  shownAtMs: number,
  hover: { x: number; y: number } | null
): void {
  const overlay = run.overlay;
  if (!overlay) return;

  ctx.fillStyle = 'rgba(0,0,0,0.72)';
  ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

  const title = (text: string, y = 160): void => {
    ctx.fillStyle = PALETTE.textMain;
    ctx.font = `24px ${SERIF}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillText(smallCaps(text), CANVAS_W / 2, y);
  };

  switch (overlay.kind) {
    case 'reward-cards':
    case 'altar-cards': {
      title(overlay.kind === 'altar-cards' ? 'Взять знание' : 'Выбери карму');
      const rects = cardRects(overlay.options.length);
      overlay.options.forEach((card, i) => {
        const r = rects[i];
        const isHover = hover !== null && inRect(r, hover.x, hover.y);
        ctx.save();
        if (isHover) {
          ctx.translate(r.x + r.w / 2, r.y + r.h / 2);
          ctx.scale(1.04, 1.04);
          ctx.translate(-(r.x + r.w / 2), -(r.y + r.h / 2));
        }
        drawCard(ctx, card, r.x, r.y, 1, isHover);
        ctx.restore();
      });
      break;
    }

    case 'reward-relics': {
      title('Выбери реликвию');
      const rects = relicRects(overlay.options.length);
      overlay.options.forEach((relic, i) => {
        const r = rects[i];
        const cx = r.x + r.w / 2;
        const isHover = hover !== null && inRect(r, hover.x, hover.y);
        drawRelic(ctx, relic, cx, r.y + 40, 34, isHover);
        ctx.fillStyle = PALETTE.textMain;
        ctx.font = `15px ${SERIF}`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        ctx.fillText(smallCaps(relicName(relic)), cx, r.y + 90);
        ctx.fillStyle = PALETTE.textMuted;
        ctx.font = `12px ${SANS}`;
        wrapText(ctx, relicEffect(relic), cx, r.y + 112, 220, 15, 3);
      });
      break;
    }

    case 'relic-scene': {
      // Сцена получения реликвии — 900 мс (13.4).
      const t = Math.min(1, (nowMs - shownAtMs) / RELIC_SCENE_DURATION_MS);
      const rise = Math.min(1, t / (500 / 900));
      const eased = 1 - Math.pow(1 - rise, 3);
      const y = 500 - eased * 140;
      const scale = 0.6 + eased * 0.4;
      ctx.save();
      ctx.translate(CANVAS_W / 2, y);
      ctx.scale(scale, scale);
      drawRelic(ctx, overlay.relic, 0, 0, 40, true);
      ctx.restore();
      if (t >= 500 / 900) {
        const flashT = (t - 500 / 900) / (100 / 900);
        if (flashT < 1) {
          ctx.fillStyle = `rgba(217,164,65,${0.35 * Math.max(0, 1 - flashT)})`;
          ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
        }
        ctx.fillStyle = PALETTE.textMain;
        ctx.font = `20px ${SERIF}`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        ctx.fillText(smallCaps(relicName(overlay.relic)), CANVAS_W / 2, y + 70);
        ctx.fillStyle = PALETTE.textMuted;
        ctx.font = `13px ${SANS}`;
        ctx.fillText(relicEffect(overlay.relic), CANVAS_W / 2, y + 104);
      }
      if (t >= 1) {
        ctx.fillStyle = PALETTE.textMuted;
        ctx.font = `12px ${SANS}`;
        ctx.textAlign = 'center';
        ctx.fillText('нажми, чтобы продолжить', CANVAS_W / 2, 620);
      }
      break;
    }

    case 'event': {
      const def = EVENTS[overlay.eventId];
      title(def.name, 200);
      ctx.fillStyle = PALETTE.textMain;
      ctx.font = `16px ${SANS}`;
      wrapText(ctx, def.text, CANVAS_W / 2, 260, 560, 22, 3);

      if (isEventDeadEnd(run, overlay.eventId)) {
        ctx.fillStyle = PALETTE.textMuted;
        ctx.font = `16px ${SERIF}`;
        ctx.textAlign = 'center';
        ctx.fillText('Здесь ничего для тебя нет', CANVAS_W / 2, 420);
        ctx.font = `12px ${SANS}`;
        ctx.fillText('нажми, чтобы продолжить', CANVAS_W / 2, 460);
        break;
      }

      const rects = eventOptionRects();
      (['a', 'b'] as const).forEach((key, i) => {
        const option = def[key];
        const available = isEventOptionAvailable(run, option.effect);
        const r = rects[i];
        const isHover = available && hover !== null && inRect(r, hover.x, hover.y);
        ctx.save();
        ctx.strokeStyle = available ? (isHover ? PALETTE.candle : 'rgba(239,230,216,0.5)') : 'rgba(122,115,112,0.3)';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.roundRect(r.x, r.y, r.w, r.h, 4);
        ctx.stroke();
        ctx.fillStyle = available ? PALETTE.textMain : 'rgba(122,115,112,0.5)';
        ctx.font = `17px ${SERIF}`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        ctx.fillText(smallCaps(option.label), r.x + r.w / 2, r.y + 16);
        ctx.fillStyle = available ? PALETTE.textMuted : 'rgba(122,115,112,0.35)';
        ctx.font = `13px ${SANS}`;
        wrapText(ctx, option.outcome, r.x + r.w / 2, r.y + 48, r.w - 30, 17, 3);
        ctx.restore();
      });
      break;
    }

    case 'altar': {
      title('Алтарь', 170);
      const labels: { choice: AltarChoice; name: string; line: string }[] = [
        { choice: 'ordain', name: 'Посвятить', line: 'Одно существо поднимается на ранг выше' },
        { choice: 'raise', name: 'Поднять павшего', line: 'Погибший возвращается Стражем' },
        { choice: 'knowledge', name: 'Взять знание', line: 'Одна Карта Кармы из невзятых, на выбор из двух' },
      ];
      const rects = altarRects();
      labels.forEach((item, i) => {
        const available = isAltarChoiceAvailable(run, item.choice);
        const r = rects[i];
        const isHover = available && hover !== null && inRect(r, hover.x, hover.y);
        ctx.save();
        ctx.strokeStyle = available ? (isHover ? PALETTE.candle : 'rgba(239,230,216,0.5)') : 'rgba(122,115,112,0.3)';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.roundRect(r.x, r.y, r.w, r.h, 4);
        ctx.stroke();

        // Иконка варианта.
        ctx.translate(r.x + 46, r.y + r.h / 2);
        ctx.strokeStyle = available ? PALETTE.candle : 'rgba(122,115,112,0.4)';
        ctx.fillStyle = ctx.strokeStyle;
        ctx.lineWidth = 2;
        if (item.choice === 'ordain') {
          ctx.beginPath();
          ctx.moveTo(0, 10);
          ctx.lineTo(0, -10);
          ctx.lineTo(-7, -2);
          ctx.moveTo(0, -10);
          ctx.lineTo(7, -2);
          ctx.stroke();
        } else if (item.choice === 'raise') {
          ctx.beginPath();
          ctx.arc(0, 2, 9, Math.PI, Math.PI * 2);
          ctx.moveTo(-9, 2);
          ctx.lineTo(-9, 10);
          ctx.moveTo(9, 2);
          ctx.lineTo(9, 10);
          ctx.stroke();
        } else {
          ctx.strokeRect(-8, -10, 16, 20);
          ctx.beginPath();
          ctx.moveTo(-4, -4);
          ctx.lineTo(4, -4);
          ctx.moveTo(-4, 0);
          ctx.lineTo(4, 0);
          ctx.moveTo(-4, 4);
          ctx.lineTo(2, 4);
          ctx.stroke();
        }
        ctx.restore();

        ctx.fillStyle = available ? PALETTE.textMain : 'rgba(122,115,112,0.5)';
        ctx.font = `18px ${SERIF}`;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'top';
        ctx.fillText(smallCaps(item.name), r.x + 90, r.y + 18);
        ctx.fillStyle = available ? PALETTE.textMuted : 'rgba(122,115,112,0.35)';
        ctx.font = `13px ${SANS}`;
        ctx.fillText(item.line, r.x + 90, r.y + 48);
      });
      break;
    }

    case 'pick-ordain':
    case 'pick-fallen':
    case 'pick-give-card': {
      if (overlay.kind === 'pick-ordain') title('Кого посвятить');
      else if (overlay.kind === 'pick-fallen') title('Кого вернуть');
      else title('Что отдать');

      if (overlay.kind === 'pick-give-card') {
        const rects = cardRects(Math.min(run.pool.length, 5));
        run.pool.forEach((card, i) => {
          if (i >= rects.length) return;
          const r = rects[i];
          const isHover = hover !== null && inRect(r, hover.x, hover.y);
          drawCard(ctx, card, r.x, r.y, 1, isHover);
        });
        break;
      }

      const members = overlay.kind === 'pick-ordain' ? run.order : run.fallen;
      const rects = memberRects(members.length);
      members.forEach((member, i) => {
        const r = rects[i];
        const selectable = overlay.kind === 'pick-fallen' || canOrdainMember(member);
        const isHover = selectable && hover !== null && inRect(r, hover.x, hover.y);
        ctx.save();
        ctx.translate(r.x + 32, r.y + 32);
        if (isHover) {
          ctx.scale(1.1, 1.1);
          ctx.shadowColor = PALETTE.candle;
          ctx.shadowBlur = 14;
        }
        if (!selectable) ctx.globalAlpha = 0.3;
        ctx.scale(0.8, 0.8);
        drawCreature(ctx, { kind: member.kind, side: 'player', id: member.id, marks: member.marks, nowMs });
        ctx.restore();
        ctx.fillStyle = selectable ? PALETTE.textMuted : 'rgba(122,115,112,0.35)';
        ctx.font = `11px ${SANS}`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        ctx.fillText(KIND_NAMES[member.kind], r.x + 32, r.y + 70);
      });
      break;
    }

    case 'info': {
      title(overlay.title, 260);
      ctx.fillStyle = PALETTE.textMuted;
      ctx.font = `16px ${SANS}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      ctx.fillText(overlay.body, CANVAS_W / 2, 330);
      ctx.font = `12px ${SANS}`;
      ctx.fillText('нажми, чтобы продолжить', CANVAS_W / 2, 400);
      break;
    }
  }
}

export function overlayActionAt(run: RunState, x: number, y: number, nowMs: number, shownAtMs: number): OverlayAction | null {
  const overlay = run.overlay;
  if (!overlay) return null;

  switch (overlay.kind) {
    case 'reward-cards':
    case 'altar-cards': {
      const rects = cardRects(overlay.options.length);
      for (let i = 0; i < rects.length; i++) {
        if (inRect(rects[i], x, y)) return { type: 'card', card: overlay.options[i] };
      }
      return null;
    }
    case 'reward-relics': {
      const rects = relicRects(overlay.options.length);
      for (let i = 0; i < rects.length; i++) {
        if (inRect(rects[i], x, y)) return { type: 'relic', relic: overlay.options[i] };
      }
      return null;
    }
    case 'relic-scene':
      return nowMs - shownAtMs >= RELIC_SCENE_DURATION_MS ? { type: 'close' } : null;
    case 'event': {
      if (isEventDeadEnd(run, overlay.eventId)) return { type: 'close' };
      const [ra, rb] = eventOptionRects();
      const def = EVENTS[overlay.eventId];
      if (inRect(ra, x, y) && isEventOptionAvailable(run, def.a.effect)) return { type: 'event', option: 'a' };
      if (inRect(rb, x, y) && isEventOptionAvailable(run, def.b.effect)) return { type: 'event', option: 'b' };
      return null;
    }
    case 'altar': {
      const rects = altarRects();
      const choices: AltarChoice[] = ['ordain', 'raise', 'knowledge'];
      for (let i = 0; i < rects.length; i++) {
        if (inRect(rects[i], x, y) && isAltarChoiceAvailable(run, choices[i])) return { type: 'altar', choice: choices[i] };
      }
      return null;
    }
    case 'pick-ordain': {
      const rects = memberRects(run.order.length);
      for (let i = 0; i < rects.length; i++) {
        if (inRect(rects[i], x, y) && canOrdainMember(run.order[i])) return { type: 'member', id: run.order[i].id };
      }
      return null;
    }
    case 'pick-fallen': {
      const rects = memberRects(run.fallen.length);
      for (let i = 0; i < rects.length; i++) {
        if (inRect(rects[i], x, y)) return { type: 'member', id: run.fallen[i].id };
      }
      return null;
    }
    case 'pick-give-card': {
      const rects = cardRects(Math.min(run.pool.length, 5));
      for (let i = 0; i < rects.length; i++) {
        if (inRect(rects[i], x, y)) return { type: 'card', card: run.pool[i] };
      }
      return null;
    }
    case 'info':
      return { type: 'close' };
  }
}
