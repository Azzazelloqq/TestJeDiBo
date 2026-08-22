import { ARENAS, BOSS_PHASE2_LIGHT } from '../core/arenas';
import type { Intent } from '../core/ai';
import { getCreatureAt } from '../core/board';
import { isEyePushTurn } from '../core/battle';
import { apPerTurn, karmaPeriod } from '../core/relics';
import { getThreatenedCells, reachableCells } from '../core/rules';
import type { BattleState, Cell, Creature, Id } from '../core/types';
import type { Animator } from './animator';
import { drawCreature, PALETTE, type CreatureMood } from './creatureArt';
import { BOARD_ORIGIN, BOARD_PX, CANVAS_H, CANVAS_W, CELL_SIZE, cellCenter, cellTopLeft } from './geometry';
import { drawCard, drawRelic, drawTooltip, relicEffect, relicName, smallCaps, SERIF, SANS } from './ui';

export { CANVAS_W, CANVAS_H };

export interface BattleViewExtra {
  selectedId: Id | null;
  selectedAtMs: number;
  legalMoves: Cell[];
  legalAttacks: Cell[];
  hoverCell: Cell | null;
  hoverPoint: { x: number; y: number } | null;
  nowMs: number;
  targeting: 'spy' | 'resurrection' | null;
  animator: Animator;
  intents: Map<Id, Intent>;
  /** Сообщение о сброшенной карте, показывается 1.2 с (9.1). */
  discardMessage: string | null;
  /** Хореография появления существ (13.7): альфа и вертикальный сдвиг. */
  spawnFx: Map<Id, { alpha: number; dy: number }> | null;
}

// ---------- Хит-тесты ----------

const END_TURN = { x: 1050, y: 655, w: 200, h: 34 };
const PENDING_CARD = { x: 60, y: 300, w: 180, h: 260 };

export function pointInEndTurn(x: number, y: number): boolean {
  return x >= END_TURN.x && x <= END_TURN.x + END_TURN.w && y >= END_TURN.y && y <= END_TURN.y + END_TURN.h;
}

export function pointInPendingCard(x: number, y: number): boolean {
  return x >= PENDING_CARD.x && x <= PENDING_CARD.x + PENDING_CARD.w && y >= PENDING_CARD.y && y <= PENDING_CARD.y + PENDING_CARD.h;
}

const GRAVE_SPACING = 34;

function graveyardPositions(state: BattleState): { id: Id; x: number; y: number }[] {
  const out: { id: Id; x: number; y: number }[] = [];
  state.graveyard.player.forEach((c, i) => out.push({ id: c.id, x: 335, y: BOARD_ORIGIN.y + BOARD_PX - 20 - i * GRAVE_SPACING }));
  state.graveyard.enemy.forEach((c, i) => out.push({ id: c.id, x: 945, y: BOARD_ORIGIN.y + 20 + i * GRAVE_SPACING }));
  return out;
}

export function graveyardCreatureAt(state: BattleState, x: number, y: number): Id | null {
  for (const p of graveyardPositions(state)) {
    if (Math.hypot(p.x - x, p.y - y) <= 17) return p.id;
  }
  return null;
}

export function relicPositions(count: number): { x: number; y: number }[] {
  const out: { x: number; y: number }[] = [];
  for (let i = 0; i < count; i++) out.push({ x: 1030 + i * 54, y: 46 });
  return out;
}

// ---------- Трещины пола (11.3): фиксированное зерно по арене ----------

function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const crackCache = new Map<string, { points: { x: number; y: number }[]; width: number }[]>();

function cracksFor(arenaId: string): { points: { x: number; y: number }[]; width: number }[] {
  const cached = crackCache.get(arenaId);
  if (cached) return cached;
  const seed = Array.from(arenaId).reduce((acc, ch) => acc * 31 + ch.charCodeAt(0), 7) >>> 0;
  const rng = mulberry32(seed);
  const cracks: { points: { x: number; y: number }[]; width: number }[] = [];
  for (let i = 0; i < 14; i++) {
    const points: { x: number; y: number }[] = [];
    let x = BOARD_ORIGIN.x + rng() * BOARD_PX;
    let y = BOARD_ORIGIN.y + rng() * BOARD_PX;
    const segments = 3 + Math.floor(rng() * 4);
    points.push({ x, y });
    for (let s = 0; s < segments; s++) {
      x += (rng() - 0.5) * 90;
      y += (rng() - 0.5) * 90;
      points.push({ x, y });
    }
    cracks.push({ points, width: 1 + rng() });
  }
  crackCache.set(arenaId, cracks);
  return cracks;
}

// ---------- Повадки (7.4): сглаживание глаза Панциря ----------

const shellOpenState = new Map<Id, number>();

function shellOpenAmount(state: BattleState, shell: Creature, dtApprox: number): number {
  const inZone = reachableCells(state, state.creatures, shell, 'attack').length > 0;
  const prev = shellOpenState.get(shell.id) ?? 0;
  const speed = inZone ? dtApprox / 200 : -dtApprox / 1000; // открывается за 200 мс, закрывается медленно
  const next = Math.max(0, Math.min(1, prev + speed));
  shellOpenState.set(shell.id, next);
  return next;
}

// ---------- Намерения (10.4): анимация появления значка ----------

const intentAppear = new Map<Id, { key: string; sinceMs: number }>();

function intentKey(intent: Intent): string {
  switch (intent.kind) {
    case 'attack':
      return `a${intent.target.x},${intent.target.y}`;
    case 'move':
      return `m${intent.to.x},${intent.to.y}`;
    default:
      return intent.kind;
  }
}

// ---------- Отрисовка ----------

export function renderBattle(ctx: CanvasRenderingContext2D, state: BattleState, extra: BattleViewExtra): void {
  const { nowMs, animator } = extra;
  const ordainScene = animator.getOrdainScene(nowMs);
  const cardScene = animator.getCardScene(nowMs);
  const bossScene = animator.getBossScene(nowMs);
  const sceneActive = ordainScene !== null || cardScene !== null || bossScene !== null;

  ctx.fillStyle = PALETTE.background;
  ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

  const cam = animator.camera.transform(nowMs);
  const bcx = BOARD_ORIGIN.x + BOARD_PX / 2;
  const bcy = BOARD_ORIGIN.y + BOARD_PX / 2;
  // Дыхание камеры (13.5): 0.5% с периодом 8 с.
  const breatheZoom = 1 + 0.005 * Math.sin((nowMs / 8000) * Math.PI * 2);

  ctx.save();
  ctx.translate(bcx + cam.shakeX, bcy + cam.shakeY);
  ctx.scale(cam.zoom * breatheZoom, cam.zoom * breatheZoom);
  ctx.translate(-bcx, -bcy);

  drawFloor(ctx, state, nowMs);
  drawStains(ctx, animator.getBloodSplats(), animator.getCraters());
  drawThreat(ctx, state);
  if (!sceneActive) {
    drawSelection(ctx, extra);
    drawIntentTargets(ctx, extra, nowMs);
  }
  drawCocoons(ctx, state, nowMs);

  // Существа.
  for (const creature of state.creatures) {
    if (animator.isCreatureHidden(creature.id)) continue;
    const slide = animator.getSlidePosition(creature.id, nowMs);
    const pos = slide ?? cellCenter(creature.cell);
    const selected = creature.id === extra.selectedId;
    const fx = extra.spawnFx?.get(creature.id);
    if (fx && fx.alpha <= 0) continue;
    ctx.save();
    ctx.translate(pos.x, pos.y + (fx?.dy ?? 0));
    if (fx) ctx.globalAlpha = fx.alpha;
    if (selected) {
      ctx.scale(1.08, 1.08);
      ctx.shadowColor = creature.side === 'player' ? PALETTE.player : PALETTE.blood;
      ctx.shadowBlur = 14;
    }
    drawCreature(ctx, {
      kind: creature.kind,
      side: creature.side,
      id: creature.id,
      marks: creature.marks,
      nowMs,
      mood: computeMood(state, creature, extra),
    });
    ctx.restore();
  }

  if (!sceneActive) drawIntentIcons(ctx, state, extra, nowMs);

  // Сцены поверх арены.
  if (cardScene?.kind === 'deathline') drawDeathlineScene(ctx, cardScene, nowMs);
  if (cardScene?.kind === 'barrage') drawBarrageScene(ctx, cardScene);
  if (cardScene?.kind === 'depression') drawDepressionScene(ctx, cardScene);
  if (ordainScene) drawOrdainScene(ctx, ordainScene, state, nowMs);
  if (bossScene) drawBossScene(ctx, bossScene);

  animator.particles.draw(ctx);
  ctx.restore();

  // Затемнение вне сцены (13.4: всё, кроме субъекта, гаснет).
  if (ordainScene) {
    ctx.save();
    ctx.globalCompositeOperation = 'multiply';
    ctx.fillStyle = 'rgba(60,60,60,1)';
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
    ctx.restore();
  }

  drawHud(ctx, state, extra);
  drawVignette(ctx);
  drawGrain(ctx, nowMs);

  const flash = animator.flashAlpha(nowMs);
  if (flash > 0) {
    ctx.fillStyle = `rgba(255,255,255,${flash})`;
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
  }
}

function computeMood(state: BattleState, creature: Creature, extra: BattleViewExtra): CreatureMood {
  const mood: CreatureMood = {};
  if (creature.kind === 'shell') {
    mood.shellOpen = shellOpenAmount(state, creature, 16.7);
  } else if (creature.kind === 'catcher') {
    const nearest = nearestPlayer(state, creature.cell);
    mood.gazeAngle = nearest ? Math.atan2(nearest.cell.y - creature.cell.y, nearest.cell.x - creature.cell.x) : null;
  } else if (creature.kind === 'eye' && creature.side === 'enemy') {
    const probe = { ...state, enemyTurnNumber: state.turn === 'player' ? state.enemyTurnNumber + 1 : state.enemyTurnNumber };
    mood.eyeCharging = isEyePushTurn(probe);
    if (extra.hoverPoint) {
      const pos = cellCenter(creature.cell);
      mood.cursorAngle = Math.atan2(extra.hoverPoint.y - pos.y, extra.hoverPoint.x - pos.x);
    }
  } else if (creature.kind === 'preacher') {
    const hovered = extra.hoverCell ? getCreatureAt(state.creatures, extra.hoverCell) : undefined;
    mood.preacherNarrow = hovered?.side === 'player';
  } else if (creature.kind === 'weaver') {
    const seed = creature.id.charCodeAt(creature.id.length - 1);
    const dirs = [
      { x: -CELL_SIZE, y: 0 },
      { x: CELL_SIZE, y: 0 },
      { x: 0, y: CELL_SIZE },
      { x: -CELL_SIZE, y: CELL_SIZE },
      { x: CELL_SIZE, y: -CELL_SIZE },
    ];
    mood.threadTargets = [dirs[seed % 5], dirs[(seed + 2) % 5], ...(seed % 2 === 0 ? [dirs[(seed + 4) % 5]] : [])];
  }
  return mood;
}

function nearestPlayer(state: BattleState, from: Cell): Creature | null {
  let best: Creature | null = null;
  let bestDist = Infinity;
  for (const c of state.creatures) {
    if (c.side !== 'player') continue;
    const d = Math.abs(c.cell.x - from.x) + Math.abs(c.cell.y - from.y);
    if (d < bestDist) {
      bestDist = d;
      best = c;
    }
  }
  return best;
}

// ---------- Пол (11.3) ----------

function drawFloor(ctx: CanvasRenderingContext2D, state: BattleState, nowMs: number): void {
  const arena = ARENAS[state.arena];

  // Один цвет, без шахматного чередования и без сетки.
  ctx.fillStyle = PALETTE.floor;
  ctx.fillRect(BOARD_ORIGIN.x, BOARD_ORIGIN.y, BOARD_PX, BOARD_PX);

  // Насечки в углах клеток: короткие штрихи по диагонали от угла.
  ctx.strokeStyle = 'rgba(239,230,216,0.06)';
  ctx.lineWidth = 1;
  for (let gx = 1; gx < 8; gx++) {
    for (let gy = 1; gy < 8; gy++) {
      const x = BOARD_ORIGIN.x + gx * CELL_SIZE;
      const y = BOARD_ORIGIN.y + gy * CELL_SIZE;
      ctx.beginPath();
      ctx.moveTo(x - 2.8, y - 2.8);
      ctx.lineTo(x + 2.8, y + 2.8);
      ctx.stroke();
    }
  }

  // Процедурные трещины из фиксированного зерна.
  for (const crack of cracksFor(state.arena)) {
    ctx.strokeStyle = PALETTE.background;
    ctx.lineWidth = crack.width;
    ctx.beginPath();
    crack.points.forEach((p, i) => {
      const px = Math.min(Math.max(p.x, BOARD_ORIGIN.x), BOARD_ORIGIN.x + BOARD_PX);
      const py = Math.min(Math.max(p.y, BOARD_ORIGIN.y), BOARD_ORIGIN.y + BOARD_PX);
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    });
    ctx.stroke();
  }

  // Непроходимые клетки арены — провалы.
  for (const cell of arena.blocked) {
    const { x, y } = cellTopLeft(cell);
    ctx.fillStyle = '#000000';
    ctx.fillRect(x, y, CELL_SIZE, CELL_SIZE);
    ctx.strokeStyle = 'rgba(140,28,19,0.25)';
    ctx.lineWidth = 1;
    ctx.strokeRect(x + 0.5, y + 0.5, CELL_SIZE - 1, CELL_SIZE - 1);
    ctx.fillStyle = 'rgba(217,164,65,0.15)';
    const seed = cell.x * 8 + cell.y;
    for (let i = 0; i < 3; i++) {
      const dx = 12 + ((seed * (i + 3) * 7919) % 40);
      const dy = 12 + ((seed * (i + 5) * 104729) % 40);
      ctx.fillRect(x + dx, y + dy, 1.5, 1.5);
    }
  }

  // Клетки Жаровни (8.1).
  if (state.arena === 'brazier') {
    for (const cell of arena.emberCells) {
      const { x, y } = cellTopLeft(cell);
      const armed = state.ember.armed && state.ember.armed.x === cell.x && state.ember.armed.y === cell.y;
      const period = armed ? 400 : 2000;
      const pulse = 0.5 + 0.5 * Math.sin((nowMs / period) * Math.PI * 2);
      ctx.save();
      if (armed) {
        ctx.strokeStyle = PALETTE.blood;
        ctx.lineWidth = 3;
        ctx.shadowColor = PALETTE.blood;
        ctx.shadowBlur = 14;
        ctx.globalAlpha = 0.55 + 0.45 * pulse;
      } else {
        ctx.strokeStyle = 'rgba(217,100,40,0.35)';
        ctx.lineWidth = 1.5;
        ctx.globalAlpha = 0.5 + 0.5 * pulse;
      }
      ctx.strokeRect(x + 2, y + 2, CELL_SIZE - 4, CELL_SIZE - 4);
      ctx.restore();
    }
  }

  // Края арены растворяются в темноту (11.3).
  const D = 40;
  const edges: [number, number, number, number, number, number][] = [
    [BOARD_ORIGIN.x, BOARD_ORIGIN.y, BOARD_ORIGIN.x, BOARD_ORIGIN.y + D, 0, 0],
    [BOARD_ORIGIN.x, BOARD_ORIGIN.y + BOARD_PX, BOARD_ORIGIN.x, BOARD_ORIGIN.y + BOARD_PX - D, 0, 0],
    [BOARD_ORIGIN.x, BOARD_ORIGIN.y, BOARD_ORIGIN.x + D, BOARD_ORIGIN.y, 0, 0],
    [BOARD_ORIGIN.x + BOARD_PX, BOARD_ORIGIN.y, BOARD_ORIGIN.x + BOARD_PX - D, BOARD_ORIGIN.y, 0, 0],
  ];
  for (let i = 0; i < edges.length; i++) {
    const [x0, y0, x1, y1] = edges[i];
    const g = ctx.createLinearGradient(x0, y0, x1, y1);
    g.addColorStop(0, 'rgba(11,10,10,1)');
    g.addColorStop(1, 'rgba(11,10,10,0)');
    ctx.fillStyle = g;
    if (i < 2) ctx.fillRect(BOARD_ORIGIN.x, Math.min(y0, y1), BOARD_PX, D);
    else ctx.fillRect(Math.min(x0, x1), BOARD_ORIGIN.y, D, BOARD_PX);
  }

  // Линии посвящения (11.3).
  ctx.save();
  ctx.shadowColor = PALETTE.candle;
  ctx.shadowBlur = 20;
  ctx.fillStyle = PALETTE.candle;
  ctx.fillRect(BOARD_ORIGIN.x, BOARD_ORIGIN.y - 1.5, BOARD_PX, 3);
  ctx.shadowColor = PALETTE.blood;
  ctx.shadowBlur = 12;
  ctx.fillStyle = PALETTE.blood;
  ctx.fillRect(BOARD_ORIGIN.x, BOARD_ORIGIN.y + BOARD_PX - 1.5, BOARD_PX, 3);
  ctx.restore();

  // Освещение: свет дышит, центр колеблется ±8 px за 6 с.
  const lightColor = state.bossPhase === 2 ? BOSS_PHASE2_LIGHT : arena.light;
  const wob = Math.sin((nowMs / 6000) * Math.PI * 2) * 8;
  const cx = BOARD_ORIGIN.x + BOARD_PX / 2 + wob;
  const cy = BOARD_ORIGIN.y + BOARD_PX / 2 + Math.cos((nowMs / 6000) * Math.PI * 2) * 4;
  const glow = ctx.createRadialGradient(cx, cy, 0, cx, cy, 400);
  glow.addColorStop(0, lightColor);
  glow.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = glow;
  ctx.fillRect(BOARD_ORIGIN.x - 60, BOARD_ORIGIN.y - 60, BOARD_PX + 120, BOARD_PX + 120);
}

function drawStains(ctx: CanvasRenderingContext2D, splats: Cell[], craters: Cell[]): void {
  for (const cell of splats) {
    const { x, y } = cellCenter(cell);
    ctx.fillStyle = 'rgba(140,28,19,0.16)';
    ctx.beginPath();
    ctx.ellipse(x, y, 24, 20, (cell.x * 7 + cell.y) % 3, 0, Math.PI * 2);
    ctx.fill();
  }
  for (const cell of craters) {
    const { x, y } = cellCenter(cell);
    ctx.fillStyle = 'rgba(0,0,0,0.4)';
    ctx.beginPath();
    ctx.arc(x, y, 17, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.55)';
    ctx.stroke();
  }
}

function drawCocoons(ctx: CanvasRenderingContext2D, state: BattleState, nowMs: number): void {
  for (const cocoon of state.cocoons) {
    const { x, y } = cellCenter(cocoon.cell);
    const sway = Math.sin(nowMs / 900 + cocoon.cell.x) * 1.5;
    ctx.save();
    ctx.translate(x + sway, y);
    ctx.fillStyle = '#3a3633';
    ctx.strokeStyle = 'rgba(74,70,67,0.8)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.ellipse(0, 0, 18, 24, 0.15, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.strokeStyle = 'rgba(20,18,16,0.7)';
    ctx.lineWidth = 1;
    for (let i = -2; i <= 2; i++) {
      ctx.beginPath();
      ctx.moveTo(-16, i * 8);
      ctx.quadraticCurveTo(0, i * 8 + 4, 16, i * 8 - 2);
      ctx.stroke();
    }
    ctx.restore();
  }
}

/** Клетки под ударом тварей — всегда включено (11.4). */
function drawThreat(ctx: CanvasRenderingContext2D, state: BattleState): void {
  const threatened = getThreatenedCells(state, 'enemy');
  ctx.strokeStyle = 'rgba(140,28,19,0.45)';
  ctx.lineWidth = 1;
  for (const key of threatened) {
    const [x, y] = key.split(',').map(Number);
    const { x: px, y: py } = cellTopLeft({ x, y });
    ctx.strokeRect(px + 0.5, py + 0.5, CELL_SIZE - 1, CELL_SIZE - 1);
  }
}

function drawSelection(ctx: CanvasRenderingContext2D, extra: BattleViewExtra): void {
  // Каскад: задержка 14 мс × расстояние (11.4).
  for (const cell of extra.legalMoves) {
    const dist = Math.max(Math.abs(cell.x - (extra.hoverCell?.x ?? cell.x)), 1);
    void dist;
    const sel = extra.selectedId;
    if (!sel) break;
    const delay = 14 * cellDistanceFromSelection(cell);
    const t = Math.min(1, Math.max(0, (extra.nowMs - extra.selectedAtMs - delay) / 120));
    if (t <= 0) continue;
    const { x, y } = cellTopLeft(cell);
    ctx.globalAlpha = t;
    ctx.fillStyle = 'rgba(239,230,216,0.10)';
    ctx.fillRect(x, y, CELL_SIZE, CELL_SIZE);
    ctx.strokeStyle = 'rgba(239,230,216,0.35)';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(x + 0.75, y + 0.75, CELL_SIZE - 1.5, CELL_SIZE - 1.5);
    ctx.globalAlpha = 1;
  }
  for (const cell of extra.legalAttacks) {
    const { x, y } = cellTopLeft(cell);
    ctx.save();
    ctx.strokeStyle = PALETTE.blood;
    ctx.lineWidth = 2;
    ctx.shadowColor = PALETTE.blood;
    ctx.shadowBlur = 8;
    ctx.strokeRect(x + 1, y + 1, CELL_SIZE - 2, CELL_SIZE - 2);
    ctx.restore();
  }
  if (extra.hoverCell) {
    const { x, y } = cellTopLeft(extra.hoverCell);
    ctx.fillStyle = 'rgba(255,255,255,0.06)';
    ctx.fillRect(x, y, CELL_SIZE, CELL_SIZE);
  }
}

let selectionOrigin: Cell | null = null;
export function setSelectionOrigin(cell: Cell | null): void {
  selectionOrigin = cell;
}

function cellDistanceFromSelection(cell: Cell): number {
  if (!selectionOrigin) return 0;
  return Math.max(Math.abs(cell.x - selectionOrigin.x), Math.abs(cell.y - selectionOrigin.y));
}

// ---------- Намерения (10.4) ----------

function drawIntentTargets(ctx: CanvasRenderingContext2D, extra: BattleViewExtra, nowMs: number): void {
  for (const intent of extra.intents.values()) {
    if (intent.kind !== 'attack') continue;
    const { x, y } = cellTopLeft(intent.target);
    const pulse = 0.35 + 0.3 * (0.5 + 0.5 * Math.sin((nowMs / 700) * Math.PI * 2));
    ctx.save();
    ctx.strokeStyle = PALETTE.blood;
    ctx.globalAlpha = pulse;
    ctx.lineWidth = 2;
    ctx.strokeRect(x + 2, y + 2, CELL_SIZE - 4, CELL_SIZE - 4);
    ctx.restore();
  }
}

function drawIntentIcons(ctx: CanvasRenderingContext2D, state: BattleState, extra: BattleViewExtra, nowMs: number): void {
  for (const creature of state.creatures) {
    if (creature.side !== 'enemy') continue;
    const intent = extra.intents.get(creature.id);
    if (!intent || intent.kind === 'none') {
      intentAppear.delete(creature.id);
      continue;
    }
    const key = intentKey(intent);
    let anim = intentAppear.get(creature.id);
    if (!anim || anim.key !== key) {
      anim = { key, sinceMs: nowMs };
      intentAppear.set(creature.id, anim);
    }
    const t = Math.min(1, (nowMs - anim.sinceMs) / 120);
    const scale = 0.8 + 0.2 * t;

    const pos = cellCenter(creature.cell);
    ctx.save();
    ctx.translate(pos.x, pos.y - 26 - 8);
    ctx.scale(scale, scale);
    ctx.globalAlpha = t;

    if (intent.kind === 'attack') {
      const target = cellCenter(intent.target);
      const angle = Math.atan2(target.y - pos.y, target.x - pos.x);
      ctx.rotate(angle + Math.PI / 2);
      ctx.fillStyle = PALETTE.blood;
      ctx.shadowColor = PALETTE.blood;
      ctx.shadowBlur = 8;
      ctx.beginPath();
      ctx.moveTo(0, -6);
      ctx.lineTo(5, 4);
      ctx.lineTo(-5, 4);
      ctx.closePath();
      ctx.fill();
    } else if (intent.kind === 'move') {
      const to = cellCenter(intent.to);
      const angle = Math.atan2(to.y - pos.y, to.x - pos.x);
      ctx.rotate(angle);
      ctx.strokeStyle = 'rgba(239,230,216,0.7)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(-6, 0);
      ctx.lineTo(6, 0);
      ctx.moveTo(6, 0);
      ctx.lineTo(2, -4);
      ctx.moveTo(6, 0);
      ctx.lineTo(2, 4);
      ctx.stroke();
    } else {
      ctx.fillStyle = PALETTE.karma;
      if (creature.kind === 'eye') {
        ctx.strokeStyle = PALETTE.karma;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.ellipse(0, 0, 7, 4, 0, 0, Math.PI * 2);
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(0, 0, 2, 0, Math.PI * 2);
        ctx.fill();
      } else {
        for (const [dx, dy] of [[0, -4], [-4, 3], [4, 3]] as const) {
          ctx.beginPath();
          ctx.arc(dx, dy, 2, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }
    ctx.restore();
  }
}

// ---------- Сцены ----------

function drawDeathlineScene(
  ctx: CanvasRenderingContext2D,
  scene: { progress: number; duration: number; column?: number },
  nowMs: number
): void {
  const col = scene.column ?? 0;
  const ms = scene.progress * scene.duration;
  const norm = scene.duration / 2200;
  const { x } = cellTopLeft({ x: col, y: 0 });

  // Кубик катится (400–700 мс) — единственное место, где кубик показан.
  if (ms >= 400 * norm && ms < 900 * norm) {
    const t = (ms - 400 * norm) / (500 * norm);
    const dx = BOARD_ORIGIN.x - 60 + (x + CELL_SIZE / 2 - BOARD_ORIGIN.x + 60) * Math.min(1, t * 1.2);
    const dy = BOARD_ORIGIN.y + BOARD_PX / 2;
    ctx.save();
    ctx.translate(dx, dy);
    ctx.rotate(t * Math.PI * 4);
    ctx.fillStyle = '#EFE6D8';
    ctx.fillRect(-12, -12, 24, 24);
    ctx.fillStyle = PALETTE.background;
    ctx.font = `bold 14px ${SANS}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(col + 1), 0, 0);
    ctx.restore();
  }

  // 700–1200 мс: столбец наливается красным снизу вверх.
  if (ms >= 700 * norm) {
    const fill = Math.min(1, (ms - 700 * norm) / (500 * norm));
    const h = BOARD_PX * fill;
    ctx.fillStyle = 'rgba(140,28,19,0.5)';
    ctx.fillRect(x, BOARD_ORIGIN.y + BOARD_PX - h, CELL_SIZE, h);
  }

  // 1400 мс: столб света бьёт сверху.
  if (ms >= 1400 * norm && ms < 2000 * norm) {
    const t = (ms - 1400 * norm) / (600 * norm);
    ctx.save();
    ctx.globalAlpha = 1 - t;
    const g = ctx.createLinearGradient(x, 0, x + CELL_SIZE, 0);
    g.addColorStop(0, 'rgba(255,240,220,0)');
    g.addColorStop(0.5, 'rgba(255,240,220,0.9)');
    g.addColorStop(1, 'rgba(255,240,220,0)');
    ctx.fillStyle = g;
    ctx.fillRect(x - 10, 0, CELL_SIZE + 20, BOARD_ORIGIN.y + BOARD_PX);
    ctx.restore();
  }
  void nowMs;
}

function drawBarrageScene(ctx: CanvasRenderingContext2D, scene: { progress: number; duration: number; cells?: Cell[] }): void {
  const ms = scene.progress * scene.duration;
  const norm = scene.duration / 1600;
  if (ms < 300 * norm) return;
  (scene.cells ?? []).forEach((cell, i) => {
    const hitAt = 1000 * norm + i * 60;
    const { x, y } = cellTopLeft(cell);
    if (ms < hitAt) {
      const pulse = 0.4 + 0.6 * Math.abs(Math.sin(ms / 90));
      ctx.save();
      ctx.strokeStyle = PALETTE.blood;
      ctx.globalAlpha = pulse;
      ctx.lineWidth = 2;
      ctx.strokeRect(x + 3, y + 3, CELL_SIZE - 6, CELL_SIZE - 6);
      ctx.restore();
    } else if (ms < hitAt + 150) {
      ctx.fillStyle = 'rgba(255,240,220,0.7)';
      ctx.fillRect(x, y, CELL_SIZE, CELL_SIZE);
    }
  });
}

function drawDepressionScene(ctx: CanvasRenderingContext2D, scene: { progress: number }): void {
  const alpha = scene.progress < 0.15 ? scene.progress / 0.15 : scene.progress > 0.85 ? (1 - scene.progress) / 0.15 : 1;
  const cx = BOARD_ORIGIN.x + BOARD_PX / 2;
  const cy = BOARD_ORIGIN.y + BOARD_PX / 2;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.fillStyle = 'rgba(11,10,10,0.95)';
  ctx.strokeStyle = PALETTE.blood;
  ctx.lineWidth = 2;
  ctx.shadowColor = PALETTE.blood;
  ctx.shadowBlur = 16;
  ctx.beginPath();
  ctx.roundRect(cx - 90, cy - 130, 180, 260, 6);
  ctx.fill();
  ctx.stroke();
  ctx.shadowBlur = 0;
  ctx.fillStyle = PALETTE.blood;
  ctx.font = `18px ${SERIF}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.fillText(smallCaps('Депрессия'), cx, cy - 105);
  // Символ: нисходящие стрелки.
  ctx.strokeStyle = PALETTE.blood;
  ctx.lineWidth = 2;
  for (let i = -1; i <= 1; i++) {
    ctx.beginPath();
    ctx.moveTo(cx + i * 30, cy - 40);
    ctx.lineTo(cx + i * 30, cy + 30);
    ctx.lineTo(cx + i * 30 - 6, cy + 20);
    ctx.moveTo(cx + i * 30, cy + 30);
    ctx.lineTo(cx + i * 30 + 6, cy + 20);
    ctx.stroke();
  }
  ctx.fillStyle = PALETTE.textMuted;
  ctx.font = `13px ${SANS}`;
  ctx.fillText('Дальность Стражей и Иерофантов = 1', cx, cy + 60);
  ctx.fillText('на 3 ближайших хода', cx, cy + 78);
  ctx.restore();
}

function drawOrdainScene(
  ctx: CanvasRenderingContext2D,
  scene: { id: Id; fromRank: string; toRank: string; at: Cell; placedAt: Cell; side: 'player' | 'enemy'; progress: number; duration: number },
  state: BattleState,
  nowMs: number
): void {
  const revealT = 1000 / 1400;
  const showNew = scene.progress >= revealT;
  const cell = showNew ? scene.placedAt : scene.at;
  const { x, y } = cellCenter(cell);
  const creature = state.creatures.find((c) => c.id === scene.id);

  // Столб света из линии (13.4, 300 мс).
  if (scene.progress > 0.2) {
    const alpha = Math.min(0.5, (scene.progress - 0.2) * 2) * (showNew ? Math.max(0, 1 - (scene.progress - revealT) * 5) : 1);
    const lx = cellCenter(scene.at).x;
    ctx.save();
    ctx.globalAlpha = alpha;
    const g = ctx.createLinearGradient(lx - 20, 0, lx + 20, 0);
    g.addColorStop(0, 'rgba(217,164,65,0)');
    g.addColorStop(0.5, 'rgba(217,164,65,0.8)');
    g.addColorStop(1, 'rgba(217,164,65,0)');
    ctx.fillStyle = g;
    const top = scene.side === 'player' ? BOARD_ORIGIN.y : BOARD_ORIGIN.y + BOARD_PX - 200;
    ctx.fillRect(lx - 20, top, 40, 200);
    ctx.restore();
  }

  ctx.save();
  ctx.translate(x, y);
  const wobble = scene.progress < revealT ? 1 + Math.sin(scene.progress * Math.PI * 6) * 0.05 : 1 + Math.max(0, 0.3 - (scene.progress - revealT) * 2);
  ctx.scale(wobble, wobble);
  ctx.shadowColor = PALETTE.candle;
  ctx.shadowBlur = 24;

  // Трещины света на существе (600–850 мс).
  const kind = creature?.kind ?? (scene.side === 'player' ? 'acolyte' : 'larva');
  drawCreature(ctx, { kind, side: scene.side, id: scene.id, marks: creature?.marks ?? 0, nowMs, still: false });

  if (!showNew && scene.progress > 600 / 1400) {
    ctx.strokeStyle = PALETTE.candle;
    ctx.lineWidth = 1.5;
    ctx.shadowBlur = 10;
    const seed = scene.id.charCodeAt(0);
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * Math.PI * 2 + seed;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(Math.cos(a) * 20, Math.sin(a) * 20);
      ctx.stroke();
    }
  }
  ctx.restore();
}

function drawBossScene(ctx: CanvasRenderingContext2D, scene: { progress: number; at: Cell }): void {
  const { x, y } = cellCenter(scene.at);
  // Внешнее кольцо рвётся: 8 осколков разлетаются (7.5).
  ctx.save();
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    const dist = 22 + scene.progress * 140;
    ctx.save();
    ctx.translate(x + Math.cos(a) * dist, y + Math.sin(a) * dist);
    ctx.rotate(a + scene.progress * 3);
    ctx.strokeStyle = PALETTE.blood;
    ctx.lineWidth = 3;
    ctx.globalAlpha = Math.max(0, 1 - scene.progress);
    ctx.beginPath();
    ctx.arc(0, 0, 22, a - 0.3, a + 0.3);
    ctx.stroke();
    ctx.restore();
  }
  // Свет краснеет.
  ctx.globalAlpha = Math.min(0.35, scene.progress * 0.6);
  ctx.fillStyle = 'rgba(140,28,19,0.5)';
  ctx.fillRect(BOARD_ORIGIN.x, BOARD_ORIGIN.y, BOARD_PX, BOARD_PX);
  ctx.restore();
}

// ---------- HUD (11.6) ----------

function drawHud(ctx: CanvasRenderingContext2D, state: BattleState, extra: BattleViewExtra): void {
  drawApTrack(ctx, state);
  drawKarmaPips(ctx, state, extra.nowMs);
  drawEndTurn(ctx, state);
  drawGraveyards(ctx, state, extra.nowMs);
  drawRelicRow(ctx, state, extra);
  drawPoolIndicator(ctx, state);

  if (state.karma.pendingCard) {
    drawCard(ctx, state.karma.pendingCard, PENDING_CARD.x, PENDING_CARD.y, 1, true);
    ctx.fillStyle = PALETTE.textMuted;
    ctx.font = `12px ${SANS}`;
    ctx.textAlign = 'center';
    ctx.fillText('разыграть', PENDING_CARD.x + 90, PENDING_CARD.y + 278);
  }

  if (state.karma.depressionTurns > 0) {
    ctx.fillStyle = PALETTE.blood;
    ctx.font = `13px ${SERIF}`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText(smallCaps(`Депрессия · ${state.karma.depressionTurns}`), 40, 100);
  }
  if (state.karma.blitzkrieg) {
    ctx.fillStyle = PALETTE.karma;
    ctx.font = `13px ${SERIF}`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText(smallCaps(state.karma.blitzkrieg.creatureId ? `Блицкриг · ${state.karma.blitzkrieg.actionsLeft}` : 'Блицкриг ждёт'), 40, 120);
  }
  if (extra.discardMessage) {
    ctx.fillStyle = PALETTE.textMain;
    ctx.font = `16px ${SERIF}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(extra.discardMessage, CANVAS_W / 2, 70);
  }
  if (extra.targeting) {
    ctx.fillStyle = PALETTE.textMain;
    ctx.font = `14px ${SANS}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(extra.targeting === 'spy' ? 'Выбери тварь' : 'Выбери существо на кладбище', CANVAS_W / 2, 70);
  }
}

function drawApTrack(ctx: CanvasRenderingContext2D, state: BattleState): void {
  const max = state.turn === 'player' ? apPerTurn(state.relics) + (state.playerTurnNumber === 1 ? state.firstTurnApBonus : 0) : 5;
  const step = 26;
  const centerX = BOARD_ORIGIN.x + BOARD_PX / 2;
  const startX = centerX - ((max - 1) * step) / 2;
  for (let i = 0; i < max; i++) {
    const x = startX + i * step;
    ctx.beginPath();
    ctx.arc(x, 648, 7, 0, Math.PI * 2);
    if (i < state.ap) {
      ctx.save();
      ctx.shadowColor = PALETTE.candle;
      ctx.shadowBlur = 10;
      ctx.fillStyle = PALETTE.candle;
      ctx.fill();
      ctx.restore();
    } else {
      ctx.strokeStyle = 'rgba(217,164,65,0.25)';
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
  }
}

function drawKarmaPips(ctx: CanvasRenderingContext2D, state: BattleState, nowMs: number): void {
  const period = karmaPeriod(state.relics);
  const filled = ((state.playerTurnNumber - 1) % period) + 1;
  const centerX = BOARD_ORIGIN.x + BOARD_PX / 2;
  const step = 16;
  const startX = centerX - ((period - 1) * step) / 2;
  for (let i = 0; i < period; i++) {
    ctx.beginPath();
    ctx.arc(startX + i * step, 668, 3, 0, Math.PI * 2);
    const isLast = i === period - 1 && filled === period;
    if (isLast && state.karma.pendingCard) {
      const pulse = 0.6 + 0.4 * Math.sin(nowMs / 200);
      ctx.fillStyle = `rgba(46,107,94,${pulse})`;
    } else {
      ctx.fillStyle = i < filled ? PALETTE.karma : 'rgba(46,107,94,0.25)';
    }
    ctx.fill();
  }
}

function drawEndTurn(ctx: CanvasRenderingContext2D, state: BattleState): void {
  const enabled = state.turn === 'player' && state.actionsTaken >= 1 && state.winner === null;
  ctx.fillStyle = enabled ? PALETTE.textMain : '#3A3634';
  ctx.font = `15px ${SERIF}`;
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  ctx.fillText(smallCaps('Завершить ход'), END_TURN.x + END_TURN.w, END_TURN.y + END_TURN.h / 2);
}

function drawGraveyards(ctx: CanvasRenderingContext2D, state: BattleState, nowMs: number): void {
  for (const side of ['player', 'enemy'] as const) {
    const list = state.graveyard[side];
    list.forEach((creature, i) => {
      const pos = graveyardPositions(state).find((p) => p.id === creature.id);
      if (!pos) return;
      ctx.save();
      ctx.translate(pos.x, pos.y);
      ctx.scale(0.5, 0.5);
      ctx.globalAlpha = 0.65;
      drawCreature(ctx, { kind: creature.kind, side, id: creature.id, marks: creature.marks, nowMs, still: true });
      ctx.restore();
      void i;
    });
  }
}

function drawRelicRow(ctx: CanvasRenderingContext2D, state: BattleState, extra: BattleViewExtra): void {
  const positions = relicPositions(state.relics.length);
  let hovered: { relic: (typeof state.relics)[number]; x: number; y: number } | null = null;
  state.relics.forEach((relic, i) => {
    const p = positions[i];
    const isHover = extra.hoverPoint !== null && Math.hypot(extra.hoverPoint.x - p.x, extra.hoverPoint.y - p.y) <= 24;
    drawRelic(ctx, relic, p.x, p.y, 22, isHover);
    if (isHover) hovered = { relic, x: p.x, y: p.y };
  });
  if (hovered !== null) {
    const h = hovered as { relic: (typeof state.relics)[number]; x: number; y: number };
    drawTooltip(ctx, relicName(h.relic), relicEffect(h.relic), h.x, h.y + 32);
  }
}

/** Пул Карт Кармы — веер у левого края (11.1). */
function drawPoolIndicator(ctx: CanvasRenderingContext2D, state: BattleState): void {
  if (state.karma.pendingCard) return; // на этом месте лежит пришедшая карта
  const count = state.pool.length;
  if (count === 0) return;
  const cx = 150;
  const cy = 420;
  for (let i = 0; i < count; i++) {
    const a = (i - (count - 1) / 2) * 0.12;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(a);
    ctx.translate(0, -20);
    ctx.fillStyle = 'rgba(11,10,10,0.95)';
    ctx.strokeStyle = 'rgba(46,107,94,0.6)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.roundRect(-32, -46, 64, 92, 4);
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }
  ctx.fillStyle = PALETTE.textMuted;
  ctx.font = `12px ${SANS}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.fillText(`карм: ${count}`, cx, cy + 64);
}

export function drawVignette(ctx: CanvasRenderingContext2D): void {
  const g = ctx.createRadialGradient(CANVAS_W / 2, CANVAS_H / 2, CANVAS_H / 3, CANVAS_W / 2, CANVAS_H / 2, CANVAS_H * 0.85);
  g.addColorStop(0, 'rgba(0,0,0,0)');
  g.addColorStop(1, 'rgba(0,0,0,0.75)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
}

/** Зерно (11.3): 400 случайных точек каждый кадр. */
export function drawGrain(ctx: CanvasRenderingContext2D, nowMs: number): void {
  ctx.fillStyle = 'rgba(255,255,255,0.015)';
  let seed = (nowMs | 0) * 2654435761;
  for (let i = 0; i < 400; i++) {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    const x = seed % CANVAS_W;
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    const y = seed % CANVAS_H;
    ctx.fillRect(x, y, 1, 1);
  }
}
