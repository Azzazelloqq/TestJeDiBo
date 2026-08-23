import { PATH_LEVELS, type NodeType, type PathNode } from '../core/path';
import type { RunState } from '../core/run';
import { drawCreature, PALETTE } from '../view/creatureArt';
import { CANVAS_H, CANVAS_W } from '../view/geometry';
import { cardEffect, cardName, drawRelic, drawTooltip, relicEffect, relicName, SERIF, smallCaps } from '../view/ui';

/** Позиции узлов: уровни идут снизу вверх, центр свободен от боковых панелей. */
export function nodePosition(node: PathNode): { x: number; y: number } {
  const y = 656 - (node.level - 1) * 62;
  const siblings = PATH_LEVELS[node.level - 1];
  if (siblings.length === 1) return { x: CANVAS_W / 2, y };
  const idx = siblings.indexOf(node);
  return { x: CANVAS_W / 2 + (idx === 0 ? -118 : 118), y };
}

export function mapNodeAt(x: number, y: number): PathNode | null {
  for (const level of PATH_LEVELS) {
    for (const node of level) {
      const p = nodePosition(node);
      if (Math.hypot(p.x - x, p.y - y) <= 22) return node;
    }
  }
  return null;
}

interface HoverInfo {
  title: string;
  body: string;
  x: number;
  y: number;
}

export function renderMap(
  ctx: CanvasRenderingContext2D,
  run: RunState,
  nowMs: number,
  revealStartMs: number,
  hoverPoint: { x: number; y: number } | null
): void {
  ctx.fillStyle = PALETTE.background;
  ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

  let hoverInfo: HoverInfo | null = null;

  // Линии между узлами — с лёгким провисанием (4.2).
  for (let li = 0; li < PATH_LEVELS.length - 1; li++) {
    for (const from of PATH_LEVELS[li]) {
      for (const to of PATH_LEVELS[li + 1]) {
        const a = nodePosition(from);
        const b = nodePosition(to);
        const passed = run.completed.includes(from.id) && (run.completed.includes(to.id) || run.level === to.level);
        ctx.strokeStyle = passed ? 'rgba(140,28,19,0.7)' : 'rgba(122,115,112,0.35)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.quadraticCurveTo((a.x + b.x) / 2, (a.y + b.y) / 2 + 10, b.x, b.y);
        ctx.stroke();
      }
    }
  }

  // Узлы: проявляются снизу вверх по одному, 80 мс между (13.7).
  for (const level of PATH_LEVELS) {
    for (const node of level) {
      const appearAt = revealStartMs + (node.level - 1) * 80;
      const t = Math.min(1, Math.max(0, (nowMs - appearAt) / 200));
      if (t <= 0) continue;
      const p = nodePosition(node);
      const completed = run.completed.includes(node.id);
      const available = node.level === run.level;
      const isCurrent = completed && node.level === run.level - 1;
      const hovered = hoverPoint !== null && Math.hypot(hoverPoint.x - p.x, hoverPoint.y - p.y) <= 22;

      ctx.save();
      ctx.globalAlpha = t;
      ctx.translate(p.x, p.y);
      if (hovered && available) ctx.scale(1.08, 1.08);

      const r = node.type === 'boss' ? 26 : 18;

      if (completed) {
        ctx.fillStyle = PALETTE.blood;
        ctx.beginPath();
        ctx.arc(0, 0, r, 0, Math.PI * 2);
        ctx.fill();
      } else {
        ctx.fillStyle = PALETTE.background;
        ctx.beginPath();
        ctx.arc(0, 0, r, 0, Math.PI * 2);
        ctx.fill();
      }

      if (isCurrent) {
        const pulse = 0.5 + 0.5 * Math.sin((nowMs / 2000) * Math.PI * 2);
        ctx.strokeStyle = PALETTE.candle;
        ctx.lineWidth = 2 + pulse;
        ctx.shadowColor = PALETTE.candle;
        ctx.shadowBlur = 8 + 8 * pulse;
      } else if (available) {
        const pulse = 0.5 + 0.5 * Math.sin((nowMs / 2000) * Math.PI * 2);
        ctx.strokeStyle = PALETTE.textMain;
        ctx.lineWidth = 2;
        ctx.shadowColor = PALETTE.candle;
        ctx.shadowBlur = 6 * pulse;
      } else if (completed) {
        ctx.strokeStyle = 'rgba(140,28,19,0.8)';
        ctx.lineWidth = 1.5;
      } else {
        ctx.strokeStyle = 'rgba(122,115,112,0.4)';
        ctx.lineWidth = 1.5;
      }
      ctx.beginPath();
      ctx.arc(0, 0, r, 0, Math.PI * 2);
      ctx.stroke();
      ctx.shadowBlur = 0;

      const symbolColor =
        node.type === 'boss' ? PALETTE.blood : completed ? PALETTE.textMain : available ? PALETTE.textMain : 'rgba(122,115,112,0.6)';
      drawNodeSymbol(ctx, node.type, symbolColor, node.type === 'boss' ? 2 : 1);

      ctx.restore();

      ctx.save();
      ctx.globalAlpha = t * (available || completed ? 0.9 : 0.45);
      ctx.fillStyle = available ? PALETTE.textMain : PALETTE.textMuted;
      ctx.font = `12px ${SERIF}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      ctx.fillText(node.label, p.x, p.y + r + 8);
      ctx.restore();

      if (hovered) {
        hoverInfo = { title: node.label, body: nodeTypeName(node.type), x: p.x, y: p.y + r + 26 };
      }
    }
  }

  drawOrderPanel(ctx, run, nowMs);
  const rightHover = drawResourcePanel(ctx, run, hoverPoint);
  if (rightHover) hoverInfo = rightHover;

  // Виньетка (4.2).
  const g = ctx.createRadialGradient(CANVAS_W / 2, CANVAS_H / 2, CANVAS_H / 3, CANVAS_W / 2, CANVAS_H / 2, CANVAS_H * 0.9);
  g.addColorStop(0, 'rgba(0,0,0,0)');
  g.addColorStop(1, 'rgba(0,0,0,0.6)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

  if (hoverInfo) drawTooltip(ctx, hoverInfo.title, hoverInfo.body, hoverInfo.x, hoverInfo.y);
}

function nodeTypeName(type: NodeType): string {
  switch (type) {
    case 'battle':
      return 'бой';
    case 'elite':
      return 'элита';
    case 'event':
      return 'событие';
    case 'altar':
      return 'алтарь';
    case 'treasure':
      return 'сокровище';
    case 'boss':
      return 'финальный обряд';
  }
}

/** Символы узлов примитивами (4.2). */
function drawNodeSymbol(ctx: CanvasRenderingContext2D, type: NodeType, color: string, scale: number): void {
  ctx.save();
  ctx.scale(scale, scale);
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = 2 / scale;

  switch (type) {
    case 'battle':
    case 'elite':
    case 'boss': {
      // Скрещённые клинья.
      ctx.beginPath();
      ctx.moveTo(-7, -7);
      ctx.lineTo(7, 7);
      ctx.moveTo(7, -7);
      ctx.lineTo(-7, 7);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(-7, -7);
      ctx.lineTo(-4, -7);
      ctx.lineTo(-7, -4);
      ctx.closePath();
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(7, -7);
      ctx.lineTo(4, -7);
      ctx.lineTo(7, -4);
      ctx.closePath();
      ctx.fill();
      if (type === 'elite' || type === 'boss') {
        // Корона из трёх шипов.
        ctx.beginPath();
        ctx.moveTo(-6, -9);
        ctx.lineTo(-4, -13);
        ctx.moveTo(0, -10);
        ctx.lineTo(0, -14);
        ctx.moveTo(6, -9);
        ctx.lineTo(4, -13);
        ctx.stroke();
      }
      break;
    }
    case 'event': {
      // Знак вопроса из дуги и точки.
      ctx.beginPath();
      ctx.arc(0, -3, 5, Math.PI, Math.PI * 2.4);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(2.5, 1);
      ctx.lineTo(0.5, 4);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(0, 8, 1.5, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case 'altar': {
      // Чаша.
      ctx.beginPath();
      ctx.arc(0, -2, 7, 0, Math.PI);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(0, 5);
      ctx.lineTo(0, 9);
      ctx.moveTo(-5, 9);
      ctx.lineTo(5, 9);
      ctx.stroke();
      break;
    }
    case 'treasure': {
      // Ромб.
      ctx.beginPath();
      ctx.moveTo(0, -8);
      ctx.lineTo(6, 0);
      ctx.lineTo(0, 8);
      ctx.lineTo(-6, 0);
      ctx.closePath();
      ctx.stroke();
      break;
    }
  }
  ctx.restore();
}

/** Панель ордена слева (4.2): миниатюры живых существ, под каждой — метки. */
function drawOrderPanel(ctx: CanvasRenderingContext2D, run: RunState, nowMs: number): void {
  ctx.fillStyle = PALETTE.textMuted;
  ctx.font = `13px ${SERIF}`;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillText(smallCaps('Отряд'), 48, 48);

  run.order.forEach((member, i) => {
    const col = i % 2;
    const row = Math.floor(i / 2);
    const x = 78 + col * 70;
    const y = 118 + row * 64;
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(0.5, 0.5);
    drawCreature(ctx, { kind: member.kind, side: 'player', id: member.id, marks: member.marks, nowMs });
    ctx.restore();
    // Метки под миниатюрой.
    if (member.marks > 0) {
      ctx.strokeStyle = 'rgba(140,28,19,0.5)';
      ctx.lineWidth = 1.5;
      for (let m = 0; m < Math.min(5, member.marks); m++) {
        ctx.beginPath();
        ctx.moveTo(x - 12 + m * 6, y + 20);
        ctx.lineTo(x - 9 + m * 6, y + 20);
        ctx.stroke();
      }
    }
  });
}

/** Панель справа (4.2): пул Карт Кармы и Реликвии, наведение — название и эффект. */
function drawResourcePanel(ctx: CanvasRenderingContext2D, run: RunState, hover: { x: number; y: number } | null): HoverInfo | null {
  let info: HoverInfo | null = null;

  ctx.fillStyle = PALETTE.textMuted;
  ctx.font = `13px ${SERIF}`;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';

  if (run.relics.length > 0) {
    ctx.fillText(smallCaps('Реликвии'), 1050, 60);
    run.relics.forEach((relic, i) => {
      const x = 1075 + (i % 3) * 52;
      const y = 110 + Math.floor(i / 3) * 52;
      const isHover = hover !== null && Math.hypot(hover.x - x, hover.y - y) <= 24;
      drawRelic(ctx, relic, x, y, 20, isHover);
      if (isHover) info = { title: relicName(relic), body: relicEffect(relic), x, y: y + 28 };
    });
  }

  if (run.pool.length > 0) {
    const baseY = 110 + Math.ceil(run.relics.length / 3) * 52 + 40;
    ctx.fillStyle = PALETTE.textMuted;
    ctx.font = `13px ${SERIF}`;
    ctx.fillText(smallCaps('Кармы'), 1050, baseY - 30);
    run.pool.forEach((card, i) => {
      const x = 1075 + (i % 3) * 52;
      const y = baseY + Math.floor(i / 3) * 66;
      const isHover = hover !== null && Math.abs(hover.x - x) <= 20 && Math.abs(hover.y - y) <= 28;
      ctx.save();
      ctx.fillStyle = PALETTE.background;
      ctx.strokeStyle = isHover ? PALETTE.karma : 'rgba(46,107,94,0.55)';
      ctx.lineWidth = 1.5;
      ctx.shadowColor = PALETTE.karma;
      ctx.shadowBlur = isHover ? 12 : 4;
      ctx.beginPath();
      ctx.roundRect(x - 18, y - 26, 36, 52, 3);
      ctx.fill();
      ctx.stroke();
      ctx.restore();
      if (isHover) info = { title: cardName(card), body: cardEffect(card), x, y: y + 32 };
    });
  }

  return info;
}
