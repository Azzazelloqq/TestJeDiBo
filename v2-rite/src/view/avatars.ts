import { SERIF, smallCaps } from './ui';

export type AvatarMood = 'idle' | 'eat' | 'hurt' | 'anger' | 'cast' | 'win' | 'lose' | 'grin';

export interface AvatarPose {
  mood: AvatarMood;
  until: number;
}

interface Visual {
  lift: number;
  lean: number;
  eyeOpen: number;
  eyeScale: number;
  glow: number;
  crack: number;
  shatter: number;
  shake: number;
  ash: number;
  consume: number;
}

const IDLE: Visual = {
  lift: 0,
  lean: 0,
  eyeOpen: 1,
  eyeScale: 1,
  glow: 0.18,
  crack: 0,
  shatter: 0,
  shake: 0,
  ash: 0,
  consume: 0,
};

function moodVisual(mood: AvatarMood): Visual {
  switch (mood) {
    case 'eat':
      return { ...IDLE, lift: 0.12, lean: 0.42, eyeOpen: 0.42, eyeScale: 1.18, glow: 1, consume: 1 };
    case 'hurt':
      return { ...IDLE, lift: -0.22, lean: -0.18, eyeOpen: 0.52, eyeScale: 0.68, glow: 0.06, crack: 0.9, shake: 1, ash: 0.7 };
    case 'anger':
      return { ...IDLE, lean: 0.28, eyeOpen: 0.72, eyeScale: 1.08, glow: 0.45 };
    case 'cast':
      return { ...IDLE, lift: 0.18, glow: 0.75, eyeScale: 1.1 };
    case 'grin':
      return { ...IDLE, lift: 0.1, eyeOpen: 0.34, glow: 0.55, consume: 0.35 };
    case 'win':
      return { ...IDLE, lift: 0.58, eyeOpen: 1.12, eyeScale: 1.22, glow: 1 };
    case 'lose':
      return { ...IDLE, lift: -0.58, lean: 0.12, eyeOpen: 0.16, eyeScale: 0.45, glow: 0, crack: 1, shatter: 1, ash: 1 };
    default:
      return IDLE;
  }
}

const playerVis: Visual = { ...IDLE };
const enemyVis: Visual = { ...IDLE };
let lastMs = 0;

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function mix(cur: Visual, target: Visual, t: number): void {
  cur.lift = lerp(cur.lift, target.lift, t);
  cur.lean = lerp(cur.lean, target.lean, t);
  cur.eyeOpen = lerp(cur.eyeOpen, target.eyeOpen, t);
  cur.eyeScale = lerp(cur.eyeScale, target.eyeScale, t);
  cur.glow = lerp(cur.glow, target.glow, t);
  cur.crack = lerp(cur.crack, target.crack, t);
  cur.shatter = lerp(cur.shatter, target.shatter, t);
  cur.shake = lerp(cur.shake, target.shake, t);
  cur.ash = lerp(cur.ash, target.ash, t);
  cur.consume = lerp(cur.consume, target.consume, t);
}

function stepVisuals(nowMs: number, playerMood: AvatarMood, enemyMood: AvatarMood): void {
  const dt = lastMs === 0 ? 16 : Math.min(48, Math.max(0, nowMs - lastMs));
  lastMs = nowMs;
  const k = 1 - Math.pow(0.001, dt / 260);
  mix(playerVis, moodVisual(playerMood), k);
  mix(enemyVis, moodVisual(enemyMood), k);
}

function resolveMood(pose: AvatarPose, nowMs: number, fallback: AvatarMood): AvatarMood {
  return nowMs < pose.until ? pose.mood : fallback;
}

/** Портрет: свой снизу, чужой сверху. */
export function drawAvatars(
  ctx: CanvasRenderingContext2D,
  nowMs: number,
  player: AvatarPose,
  enemy: AvatarPose | null,
  playerAlive: number,
  boss: boolean
): void {
  const playerMood = resolveMood(player, nowMs, playerAlive <= 2 ? 'anger' : 'idle');
  const enemyMood = enemy ? resolveMood(enemy, nowMs, 'idle') : 'idle';
  stepVisuals(nowMs, playerMood, enemyMood);

  drawPortrait(ctx, {
    x: 118,
    y: 575,
    nowMs,
    mood: playerMood,
    vis: playerVis,
    side: 'player',
    label: 'Ты',
    boss: false,
  });
  drawPortrait(ctx, {
    x: 1162,
    y: 148,
    nowMs,
    mood: enemyMood,
    vis: enemyVis,
    side: 'enemy',
    label: boss ? 'Проповедник' : 'Противник',
    boss,
  });
}

interface PortraitOpts {
  x: number;
  y: number;
  nowMs: number;
  mood: AvatarMood;
  vis: Visual;
  side: 'player' | 'enemy';
  label: string;
  boss: boolean;
}

function drawPortrait(ctx: CanvasRenderingContext2D, o: PortraitOpts): void {
  const t = o.nowMs / 1000;
  const v = o.vis;
  const breathe = Math.sin(t * 1.4 + (o.side === 'player' ? 0 : 1.7)) * 2;
  const shakeX = v.shake * Math.sin(t * 48) * 3.2;
  const shakeY = v.shake * Math.cos(t * 37) * 2.2;

  ctx.save();
  ctx.translate(o.x + shakeX + v.lean * 7, o.y + shakeY - v.lift * 10 + breathe * 0.35);
  ctx.rotate(v.lean * 0.07 - v.lift * 0.05);

  drawAura(ctx, o.side, v, t, o.boss);
  drawAsh(ctx, v, t, o.side, o.boss);

  ctx.save();
  if (v.shatter > 0.08) {
    ctx.translate(-4 * v.shatter, -3 * v.shatter);
    ctx.rotate(-0.08 * v.shatter);
    ctx.globalAlpha = 1 - v.shatter * 0.35;
  }

  if (o.side === 'player') drawPlayerMask(ctx, v, t);
  else if (o.boss) drawBossMask(ctx, v, t);
  else drawEnemyMask(ctx, v, t);

  ctx.restore();

  if (v.shatter > 0.2) {
    ctx.save();
    ctx.globalAlpha = v.shatter * 0.7;
    ctx.translate(7 * v.shatter, 4 * v.shatter);
    ctx.rotate(0.12 * v.shatter);
    if (o.side === 'player') drawPlayerMask(ctx, v, t);
    else if (o.boss) drawBossMask(ctx, v, t);
    else drawEnemyMask(ctx, v, t);
    ctx.restore();
  }

  ctx.restore();

  ctx.save();
  ctx.globalAlpha = 0.85 - v.ash * 0.4;
  ctx.fillStyle = o.side === 'player' ? '#EFE6D8' : o.boss ? '#F0E6D4' : '#C4B8A8';
  ctx.font = `13px ${SERIF}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.fillText(smallCaps(o.label), o.x, o.y + 58);
  ctx.restore();
}

function drawAura(
  ctx: CanvasRenderingContext2D,
  side: 'player' | 'enemy',
  v: Visual,
  t: number,
  boss: boolean
): void {
  const pulse = 0.7 + 0.3 * Math.sin(t * 5);
  const r = 46 + v.glow * 10 + v.consume * 6 * pulse + (boss ? 8 : 0);
  const g = ctx.createRadialGradient(0, 4, 8, 0, 4, r);
  if (side === 'player') {
    g.addColorStop(0, `rgba(239,230,216,${0.08 + v.glow * 0.22 + v.consume * 0.18})`);
    g.addColorStop(0.55, `rgba(217,164,65,${0.04 + v.glow * 0.12})`);
    g.addColorStop(1, 'rgba(217,164,65,0)');
  } else if (boss) {
    g.addColorStop(0, `rgba(240,230,212,${0.22 + v.glow * 0.28 + v.consume * 0.18})`);
    g.addColorStop(0.45, `rgba(217,164,65,${0.16 + v.glow * 0.18})`);
    g.addColorStop(0.75, `rgba(140,28,19,${0.14 + v.glow * 0.12})`);
    g.addColorStop(1, 'rgba(140,28,19,0)');
  } else {
    g.addColorStop(0, `rgba(255,255,255,${0.05 + v.glow * 0.2 + v.consume * 0.16})`);
    g.addColorStop(0.5, `rgba(140,28,19,${0.06 + v.glow * 0.14})`);
    g.addColorStop(1, 'rgba(140,28,19,0)');
  }
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(0, 4, r, 0, Math.PI * 2);
  ctx.fill();
}

function drawAsh(
  ctx: CanvasRenderingContext2D,
  v: Visual,
  t: number,
  side: 'player' | 'enemy',
  boss: boolean
): void {
  if (v.ash < 0.04) return;
  ctx.save();
  ctx.globalAlpha = v.ash * 0.55;
  for (let i = 0; i < 7; i++) {
    const a = t * (0.7 + i * 0.11) + i * 1.7;
    const x = Math.sin(a) * (10 + i * 3);
    const y = ((t * (12 + i * 4) + i * 9) % 36) - 8;
    ctx.fillStyle = side === 'player' ? 'rgba(90,86,80,0.7)' : boss ? 'rgba(180,140,90,0.7)' : 'rgba(20,16,14,0.85)';
    ctx.beginPath();
    ctx.arc(x, y, 1.1 + (i % 3) * 0.5, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function playerFacePath(ctx: CanvasRenderingContext2D): void {
  ctx.beginPath();
  ctx.moveTo(0, 30);
  ctx.bezierCurveTo(-8, 24, -22, 10, -24, -2);
  ctx.bezierCurveTo(-26, -14, -18, -20, -8, -20);
  ctx.quadraticCurveTo(0, -16, 8, -20);
  ctx.bezierCurveTo(18, -20, 26, -14, 24, -2);
  ctx.bezierCurveTo(22, 10, 8, 24, 0, 30);
  ctx.closePath();
}

function playerHornPath(ctx: CanvasRenderingContext2D, dir: 1 | -1): void {
  ctx.beginPath();
  ctx.moveTo(dir * 14, -16);
  ctx.bezierCurveTo(dir * 26, -22, dir * 24, -46, dir * 9, -62);
  ctx.bezierCurveTo(dir * 6, -54, dir * 10, -44, dir * 7, -36);
  ctx.lineTo(dir * 11, -34);
  ctx.lineTo(dir * 7, -28);
  ctx.lineTo(dir * 10, -26);
  ctx.lineTo(dir * 6, -20);
  ctx.quadraticCurveTo(dir * 10, -18, dir * 14, -16);
  ctx.closePath();
}

function drawPlayerMask(ctx: CanvasRenderingContext2D, v: Visual, t: number): void {
  ctx.save();
  ctx.shadowColor = `rgba(239,230,216,${0.25 + v.glow * 0.55})`;
  ctx.shadowBlur = 8 + v.glow * 16;
  ctx.fillStyle = '#F4EEE4';
  playerHornPath(ctx, -1);
  ctx.fill();
  playerHornPath(ctx, 1);
  ctx.fill();
  playerFacePath(ctx);
  ctx.fill();
  ctx.restore();

  ctx.strokeStyle = 'rgba(20,16,12,0.22)';
  ctx.lineWidth = 1.2;
  playerHornPath(ctx, -1);
  ctx.stroke();
  playerHornPath(ctx, 1);
  ctx.stroke();
  playerFacePath(ctx);
  ctx.stroke();

  // Шея.
  ctx.fillStyle = '#141210';
  ctx.beginPath();
  ctx.moveTo(-6, 26);
  ctx.quadraticCurveTo(0, 32, 6, 26);
  ctx.lineTo(5, 36);
  ctx.quadraticCurveTo(0, 34, -5, 36);
  ctx.closePath();
  ctx.fill();

  const blink = eyeBlink(t, 0);
  const open = Math.max(0.08, v.eyeOpen * blink);
  const eyeGlow = v.consume > 0.15;
  drawHoleEye(ctx, -8.5, 2, 6.2 * v.eyeScale, 8.2 * open, -0.12, eyeGlow, v.glow);
  drawHoleEye(ctx, 8.5, 2, 6.2 * v.eyeScale, 8.2 * open, 0.12, eyeGlow, v.glow);

  if (v.consume > 0.2) {
    ctx.save();
    ctx.globalAlpha = v.consume * 0.45;
    ctx.fillStyle = '#EFE6D8';
    ctx.shadowColor = '#D9A441';
    ctx.shadowBlur = 14;
    ctx.beginPath();
    ctx.ellipse(0, 16, 3.2, 1.4 + v.consume, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  drawCracks(ctx, v.crack, '#1a1612', [
    [-16, -8, -2, 6, 8, 18],
    [12, -14, 4, -2, 2, 16],
    [-6, -18, 0, -6, 10, 4],
  ]);
}

function drawHoleEye(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  rx: number,
  ry: number,
  rot: number,
  glow: boolean,
  glowAmt: number
): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rot);
  if (glow) {
    ctx.shadowColor = 'rgba(239,230,216,0.85)';
    ctx.shadowBlur = 10 + glowAmt * 10;
  }
  ctx.fillStyle = '#0B0A0A';
  ctx.beginPath();
  ctx.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2);
  ctx.fill();
  if (glow) {
    ctx.shadowBlur = 0;
    ctx.fillStyle = `rgba(239,230,216,${0.18 + glowAmt * 0.25})`;
    ctx.beginPath();
    ctx.ellipse(0, -ry * 0.15, rx * 0.35, ry * 0.22, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function enemyHeadPath(ctx: CanvasRenderingContext2D): void {
  ctx.beginPath();
  ctx.moveTo(0, 34);
  ctx.bezierCurveTo(-10, 22, -20, 8, -18, -8);
  ctx.bezierCurveTo(-16, -18, -8, -22, 0, -20);
  ctx.bezierCurveTo(8, -22, 16, -18, 18, -8);
  ctx.bezierCurveTo(20, 8, 10, 22, 0, 34);
  ctx.closePath();
}

function enemyHornPath(ctx: CanvasRenderingContext2D, dir: 1 | -1): void {
  ctx.beginPath();
  ctx.moveTo(dir * 6, -16);
  ctx.bezierCurveTo(dir * 4, -36, dir * -2, -50, dir * 8, -68);
  ctx.bezierCurveTo(dir * 14, -72, dir * 16, -60, dir * 10, -48);
  ctx.lineTo(dir * 14, -46);
  ctx.bezierCurveTo(dir * 16, -36, dir * 12, -22, dir * 8, -16);
  ctx.closePath();
}

function enemySpike(ctx: CanvasRenderingContext2D, dir: 1 | -1, ox: number, oy: number, len: number, lift: number): void {
  ctx.beginPath();
  ctx.moveTo(dir * ox, oy);
  ctx.quadraticCurveTo(dir * (ox + 10), oy - lift * 0.4, dir * (ox + len), oy - lift);
  ctx.quadraticCurveTo(dir * (ox + 8), oy - 2, dir * ox, oy + 3);
  ctx.closePath();
}

function bossMitrePath(ctx: CanvasRenderingContext2D): void {
  ctx.beginPath();
  ctx.moveTo(0, -78);
  ctx.bezierCurveTo(16, -70, 22, -48, 18, -28);
  ctx.lineTo(10, -20);
  ctx.lineTo(0, -28);
  ctx.lineTo(-10, -20);
  ctx.lineTo(-18, -28);
  ctx.bezierCurveTo(-22, -48, -16, -70, 0, -78);
  ctx.closePath();
}

function bossFacePath(ctx: CanvasRenderingContext2D): void {
  ctx.beginPath();
  ctx.moveTo(0, 36);
  ctx.bezierCurveTo(-12, 26, -24, 10, -22, -6);
  ctx.bezierCurveTo(-20, -18, -10, -24, 0, -22);
  ctx.bezierCurveTo(10, -24, 20, -18, 22, -6);
  ctx.bezierCurveTo(24, 10, 12, 26, 0, 36);
  ctx.closePath();
}

function drawBossMask(ctx: CanvasRenderingContext2D, v: Visual, t: number): void {
  ctx.save();
  ctx.shadowColor = `rgba(240,230,212,${0.45 + v.glow * 0.4})`;
  ctx.shadowBlur = 14 + v.glow * 16;
  ctx.fillStyle = '#F3E8D6';
  bossMitrePath(ctx);
  ctx.fill();
  bossFacePath(ctx);
  ctx.fill();
  ctx.restore();

  ctx.strokeStyle = 'rgba(140,28,19,0.7)';
  ctx.lineWidth = 2;
  bossMitrePath(ctx);
  ctx.stroke();
  bossFacePath(ctx);
  ctx.stroke();

  ctx.strokeStyle = '#D9A441';
  ctx.lineWidth = 2.4;
  ctx.beginPath();
  ctx.moveTo(0, -72);
  ctx.lineTo(0, -26);
  ctx.stroke();
  ctx.fillStyle = '#8C1C13';
  ctx.beginPath();
  ctx.arc(0, -50, 3.2, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = '#2A1410';
  ctx.beginPath();
  ctx.moveTo(-7, 30);
  ctx.quadraticCurveTo(0, 36, 7, 30);
  ctx.lineTo(6, 42);
  ctx.quadraticCurveTo(0, 40, -6, 42);
  ctx.closePath();
  ctx.fill();

  const blink = eyeBlink(t, 0.4);
  const open = Math.max(0.1, v.eyeOpen * blink);
  drawBossEye(ctx, -8.5, 2, 6.4 * v.eyeScale, 8.6 * open, -0.1, v.glow);
  drawBossEye(ctx, 8.5, 2, 6.4 * v.eyeScale, 8.6 * open, 0.1, v.glow);

  if (v.consume > 0.2) {
    ctx.save();
    ctx.globalAlpha = v.consume * 0.5;
    ctx.shadowColor = '#D9A441';
    ctx.shadowBlur = 16;
    ctx.fillStyle = '#F3E8D6';
    ctx.beginPath();
    ctx.ellipse(0, 20, 3, 1.3 + v.consume, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  drawCracks(ctx, v.crack, 'rgba(140,28,19,0.75)', [
    [-14, -8, -2, 6, 8, 20],
    [12, -16, 4, -2, 2, 16],
    [-4, -20, 0, -8, 10, 2],
  ]);
}

function drawBossEye(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  rx: number,
  ry: number,
  rot: number,
  glow: number
): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rot);
  ctx.shadowColor = `rgba(140,28,19,${0.55 + glow * 0.4})`;
  ctx.shadowBlur = 8 + glow * 10;
  ctx.fillStyle = '#8C1C13';
  ctx.beginPath();
  ctx.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.fillStyle = '#1A0808';
  ctx.beginPath();
  ctx.ellipse(0, 0, rx * 0.38, ry * 0.72, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = `rgba(243,232,214,${0.35 + glow * 0.3})`;
  ctx.beginPath();
  ctx.ellipse(-rx * 0.18, -ry * 0.22, rx * 0.22, ry * 0.16, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawEnemyMask(ctx: CanvasRenderingContext2D, v: Visual, t: number): void {
  ctx.save();
  ctx.fillStyle = '#0A0909';
  ctx.shadowColor = `rgba(255,255,255,${0.08 + v.glow * 0.35})`;
  ctx.shadowBlur = 6 + v.glow * 12;

  enemyHornPath(ctx, -1);
  ctx.fill();
  enemyHornPath(ctx, 1);
  ctx.fill();
  enemySpike(ctx, -1, 16, -8, 16, 14);
  ctx.fill();
  enemySpike(ctx, 1, 16, -8, 16, 14);
  ctx.fill();
  enemySpike(ctx, -1, 14, 2, 14, 6);
  ctx.fill();
  enemySpike(ctx, 1, 14, 2, 14, 6);
  ctx.fill();
  enemySpike(ctx, -1, 10, 14, 10, 2);
  ctx.fill();
  enemySpike(ctx, 1, 10, 14, 10, 2);
  ctx.fill();
  enemyHeadPath(ctx);
  ctx.fill();
  ctx.restore();

  ctx.strokeStyle = 'rgba(255,255,255,0.08)';
  ctx.lineWidth = 1;
  enemyHeadPath(ctx);
  ctx.stroke();

  const blink = eyeBlink(t, 1.3);
  const open = Math.max(0.06, v.eyeOpen * blink);
  const glow = 0.45 + v.glow * 0.55 + v.consume * 0.35;
  const cols: Array<{ x: number; rot: number }> = [
    { x: -5.6, rot: 0.38 },
    { x: 5.6, rot: -0.38 },
  ];
  const ys = [-9, -3, 3.2, 9.2];
  for (const col of cols) {
    ys.forEach((y, i) => {
      const s = (1 - i * 0.08) * v.eyeScale;
      drawAlmondEye(ctx, col.x * (1 - i * 0.06), y, 2.15 * s, 3.4 * s * open, col.rot * (1 - i * 0.12), glow);
    });
  }

  if (v.consume > 0.2) {
    ctx.save();
    ctx.globalAlpha = v.consume * 0.5;
    ctx.shadowColor = '#FFFFFF';
    ctx.shadowBlur = 16;
    ctx.fillStyle = '#FFFFFF';
    ctx.beginPath();
    ctx.ellipse(0, 22, 2.4, 1.2 + v.consume * 1.4, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  drawCracks(ctx, v.crack, 'rgba(230,226,218,0.55)', [
    [-10, -12, -2, 4, 6, 20],
    [8, -16, 3, -2, -4, 14],
    [0, -18, 2, 0, 8, 10],
  ]);
}

function drawAlmondEye(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  rx: number,
  ry: number,
  rot: number,
  glow: number
): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rot);
  ctx.shadowColor = `rgba(255,255,255,${0.35 + glow * 0.5})`;
  ctx.shadowBlur = 6 + glow * 8;
  ctx.fillStyle = `rgba(255,255,255,${0.55 + glow * 0.45})`;
  ctx.beginPath();
  ctx.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawCracks(ctx: CanvasRenderingContext2D, amount: number, color: string, lines: number[][]): void {
  if (amount < 0.05) return;
  ctx.save();
  ctx.globalAlpha = Math.min(1, amount);
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.15;
  ctx.lineCap = 'round';
  for (const line of lines) {
    ctx.beginPath();
    ctx.moveTo(line[0], line[1]);
    ctx.quadraticCurveTo(line[2], line[3], line[4], line[5]);
    ctx.stroke();
  }
  ctx.restore();
}

function eyeBlink(t: number, seed: number): number {
  const period = 3.8 + seed;
  const p = (t + seed) % period;
  if (p > 0.12) return 1;
  return p < 0.06 ? 1 - (p / 0.06) * 0.85 : 0.15 + ((p - 0.06) / 0.06) * 0.85;
}
