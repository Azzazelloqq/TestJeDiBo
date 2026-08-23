import type { BattleEvent, Cell, CreatureKind, Id, Rank, Side } from '../core/types';
import type { AvatarMood, AvatarPose } from './avatars';
import { cellCenter, BOARD_ORIGIN, BOARD_PX } from './geometry';
import { Camera } from './camera';
import { ParticleSystem } from './particles';
import {
  ATTACK_ATTACKER_SETTLES_AT_MS,
  ATTACK_DEBRIS_LANDS_AT_MS,
  ATTACK_HITSTOP_BIG_MS,
  ATTACK_HITSTOP_MS,
  ATTACK_LUNGE_MS,
  ATTACK_SHATTER_AT_MS,
  ATTACK_WINDUP_MS,
  BARRAGE_DURATION_MS,
  BOSS_PHASE_DURATION_MS,
  DEATHLINE_DURATION_MS,
  ORDAIN_DURATION_MS,
  ORDAIN_FIRST_DURATION_MS,
  SHAKE_BIG_KILL_PX,
  SHAKE_BOSS_PHASE_PX,
  SHAKE_EMBER_PX,
  SHAKE_KILL_PX,
  SHAKE_WOW_SCENE_PX,
  scaledDuration,
} from './scenes';

const BIG_KILL_KINDS: CreatureKind[] = ['hierophant', 'eye', 'preacher'];

interface Slide {
  id: Id;
  from: Cell;
  to: Cell;
  startedAt: number;
  duration: number;
}

export interface OrdainScene {
  id: Id;
  fromRank: Rank;
  toRank: Rank;
  at: Cell;
  placedAt: Cell;
  side: Side;
  startedAt: number;
  duration: number;
}

export interface CardScene {
  kind: 'deathline' | 'barrage' | 'depression';
  startedAt: number;
  duration: number;
  column?: number;
  cells?: Cell[];
}

export interface BossScene {
  startedAt: number;
  duration: number;
  at: Cell;
}

/**
 * Очередь анимаций поверх мгновенного состояния (2.1, 13). Логика никогда не
 * ждёт анимацию; ввод блокируется только на время вау-сцен.
 */
export class Animator {
  camera = new Camera();
  particles = new ParticleSystem();

  private slides: Slide[] = [];
  private hidden = new Set<Id>();
  private ordainScene: OrdainScene | null = null;
  private cardScene: CardScene | null = null;
  private bossScene: BossScene | null = null;
  private hitstopUntil = 0;
  private flashUntil = 0;
  private flashStrength = 1;
  private bloodSplats: Cell[] = [];
  private craters: Cell[] = [];
  private seenScenes = new Set<string>();
  private timers: ReturnType<typeof setTimeout>[] = [];
  private stunnedUntil = new Map<Id, number>();
  private comboUntil = 0;
  private comboCount = 0;
  private finisherUntil = 0;
  private playerAvatar: AvatarPose = { mood: 'idle', until: 0 };
  private enemyAvatar: AvatarPose = { mood: 'idle', until: 0 };

  /** Сброс между боями. Сцены-повторы (`seenScenes`) живут весь ран. */
  resetBattle(): void {
    this.slides = [];
    this.hidden.clear();
    this.ordainScene = null;
    this.cardScene = null;
    this.bossScene = null;
    this.hitstopUntil = 0;
    this.flashUntil = 0;
    this.bloodSplats = [];
    this.craters = [];
    for (const t of this.timers) clearTimeout(t);
    this.timers = [];
    this.particles.particles = [];
    this.stunnedUntil.clear();
    this.comboUntil = 0;
    this.comboCount = 0;
    this.finisherUntil = 0;
    this.playerAvatar = { mood: 'idle', until: 0 };
    this.enemyAvatar = { mood: 'idle', until: 0 };
  }

  resetRun(): void {
    this.resetBattle();
    this.seenScenes.clear();
  }

  private schedule(delayMs: number, fn: () => void): void {
    if (delayMs <= 0) fn();
    else this.timers.push(setTimeout(fn, delayMs));
  }

  /** Вау-сцена активна — ввод заблокирован (13.4). */
  isBusy(nowMs: number): boolean {
    if (this.ordainScene && nowMs < this.ordainScene.startedAt + this.ordainScene.duration) return true;
    if (this.cardScene && nowMs < this.cardScene.startedAt + this.cardScene.duration) return true;
    if (this.bossScene && nowMs < this.bossScene.startedAt + this.bossScene.duration) return true;
    if (nowMs < this.finisherUntil) return true;
    return false;
  }

  isStunned(id: Id, nowMs: number): boolean {
    return nowMs < (this.stunnedUntil.get(id) ?? 0);
  }

  getPlayerAvatar(nowMs: number): AvatarPose {
    return nowMs < this.playerAvatar.until ? this.playerAvatar : { mood: 'idle', until: 0 };
  }

  getEnemyAvatar(nowMs: number): AvatarPose {
    return nowMs < this.enemyAvatar.until ? this.enemyAvatar : { mood: 'idle', until: 0 };
  }

  private setAvatar(side: Side, mood: AvatarMood, until: number): void {
    if (side === 'player') this.playerAvatar = { mood, until };
    else this.enemyAvatar = { mood, until };
  }

  getComboFlash(nowMs: number): { count: number; alpha: number } | null {
    if (nowMs >= this.comboUntil || this.comboCount < 2) return null;
    return { count: this.comboCount, alpha: Math.max(0, (this.comboUntil - nowMs) / 700) };
  }

  isHitstopped(nowMs: number): boolean {
    return nowMs < this.hitstopUntil;
  }

  flashAlpha(nowMs: number): number {
    return nowMs < this.flashUntil ? Math.max(0, ((this.flashUntil - nowMs) / 40) * this.flashStrength) : 0;
  }

  isCreatureHidden(id: Id): boolean {
    return this.hidden.has(id);
  }

  getSlidePosition(id: Id, nowMs: number): { x: number; y: number } | null {
    const slide = this.slides.find((s) => s.id === id);
    if (!slide) return null;
    const t = Math.min(1, (nowMs - slide.startedAt) / slide.duration);
    if (t >= 1) {
      this.slides = this.slides.filter((s) => s !== slide);
      return null;
    }
    // ease-out-back с перелётом 6% (13.2)
    const eased = 1 + 2.06 * Math.pow(t - 1, 3) + 1.06 * Math.pow(t - 1, 2);
    const from = cellCenter(slide.from);
    const to = cellCenter(slide.to);
    return { x: from.x + (to.x - from.x) * eased, y: from.y + (to.y - from.y) * eased };
  }

  getOrdainScene(nowMs: number): (OrdainScene & { progress: number }) | null {
    if (!this.ordainScene) return null;
    const progress = (nowMs - this.ordainScene.startedAt) / this.ordainScene.duration;
    if (progress >= 1) {
      this.hidden.delete(this.ordainScene.id);
      this.ordainScene = null;
      return null;
    }
    return { ...this.ordainScene, progress };
  }

  getCardScene(nowMs: number): (CardScene & { progress: number }) | null {
    if (!this.cardScene) return null;
    const progress = (nowMs - this.cardScene.startedAt) / this.cardScene.duration;
    if (progress >= 1) {
      this.cardScene = null;
      return null;
    }
    return { ...this.cardScene, progress };
  }

  getBossScene(nowMs: number): (BossScene & { progress: number }) | null {
    if (!this.bossScene) return null;
    const progress = (nowMs - this.bossScene.startedAt) / this.bossScene.duration;
    if (progress >= 1) {
      this.bossScene = null;
      return null;
    }
    return { ...this.bossScene, progress };
  }

  getBloodSplats(): Cell[] {
    return this.bloodSplats;
  }

  getCraters(): Cell[] {
    return this.craters;
  }

  update(dtMs: number): void {
    this.particles.update(dtMs);
  }

  /** Скармливает события одного применённого действия. */
  processEvents(events: BattleEvent[], nowMs: number, bossCell?: Cell): void {
    let cursor = 0;
    let pendingKill: { id: Id; at: Cell; kind: CreatureKind } | null = null;
    const finisher = events.find((e) => e.t === 'finisher');
    const combo = [...events].reverse().find((e) => e.t === 'combo');

    for (const event of events) {
      switch (event.t) {
        case 'moved': {
          this.slides.push({ id: event.id, from: event.from, to: event.to, startedAt: nowMs + cursor, duration: 140 });
          const { x, y } = cellCenter(event.to);
          this.schedule(cursor + 30, () => this.particles.dust(x, y, 8));
          break;
        }
        case 'pushed': {
          this.slides.push({ id: event.id, from: event.from, to: event.to, startedAt: nowMs + cursor, duration: 180 });
          const { x, y } = cellCenter(event.from);
          this.schedule(cursor, () => this.particles.dust(x, y, 8));
          break;
        }
        case 'killed': {
          pendingKill = { id: event.id, at: event.at, kind: event.kind };
          if (event.side === 'player') {
            this.setAvatar('player', 'hurt', nowMs + cursor + 1400);
            this.setAvatar('enemy', 'eat', nowMs + cursor + 1200);
          } else {
            this.setAvatar('player', 'eat', nowMs + cursor + 1200);
            this.setAvatar('enemy', 'hurt', nowMs + cursor + 1400);
          }
          // Гибель без атаки (карта, вспышка, обод) — распад на месте.
          // Если следом идёт attacked на ту же клетку, распад делает атака.
          break;
        }
        case 'attacked': {
          const big = pendingKill !== null && BIG_KILL_KINDS.includes(pendingKill.kind);
          this.runAttackSequence(event.id, event.from, event.to, nowMs + cursor, {
            big,
            finisher: finisher !== undefined,
            combo: combo && combo.t === 'combo' ? combo.count : 0,
          });
          pendingKill = null;
          cursor += finisher ? ATTACK_DEBRIS_LANDS_AT_MS + 400 : ATTACK_DEBRIS_LANDS_AT_MS;
          break;
        }
        case 'stunned': {
          const { x, y } = cellCenter(event.at);
          this.stunnedUntil.set(event.id, nowMs + cursor + 900);
          this.schedule(cursor, () => this.particles.wormwoodSmoke(x, y, 6));
          break;
        }
        case 'combo': {
          this.comboCount = event.count;
          this.comboUntil = nowMs + cursor + 700;
          break;
        }
        case 'feast': {
          this.finisherUntil = Math.max(this.finisherUntil, nowMs + cursor + 420);
          const { x, y } = cellCenter(event.targets[0] ?? { x: 3, y: 3 });
          this.schedule(cursor, () => {
            this.camera.zoomTransition(1.14, 180, nowMs + cursor);
            this.camera.shake(10, 220, nowMs + cursor);
            this.particles.sparks(x, y, 14);
            this.particles.goldDustIn(x - 36, y - 36, x + 36, y + 36, 18);
          });
          this.schedule(cursor + 360, () => this.camera.zoomTransition(1, 240, nowMs + cursor + 360));
          this.setAvatar('player', 'eat', nowMs + cursor + 1600);
          this.setAvatar('enemy', 'hurt', nowMs + cursor + 1400);
          break;
        }
        case 'arenaGesture': {
          this.schedule(cursor, () => {
            this.camera.shake(SHAKE_WOW_SCENE_PX, 480, nowMs + cursor);
            this.flashUntil = nowMs + cursor + 90;
            this.flashStrength = 0.5;
          });
          cursor += 360;
          break;
        }
        case 'finisher': {
          this.finisherUntil = nowMs + cursor + 1400;
          const { x, y } = cellCenter(event.at);
          this.schedule(cursor, () => {
            this.camera.zoomTransition(1.22, 220, nowMs + cursor);
            this.camera.shake(SHAKE_WOW_SCENE_PX, 360, nowMs + cursor);
            this.particles.boneShards(x, y, '#D9A441', 10);
            this.particles.sparks(x, y, 16);
          });
          this.schedule(cursor + 900, () => this.camera.zoomTransition(1, 400, nowMs + cursor + 900));
          this.setAvatar('player', 'eat', nowMs + cursor + 1100);
          this.setAvatar('enemy', 'hurt', nowMs + cursor + 1400);
          break;
        }
        case 'battleWon':
          this.setAvatar('player', 'win', nowMs + cursor + 8000);
          this.setAvatar('enemy', 'lose', nowMs + cursor + 8000);
          break;
        case 'battleLost':
          this.setAvatar('player', 'lose', nowMs + cursor + 8000);
          this.setAvatar('enemy', 'win', nowMs + cursor + 8000);
          break;
        case 'ordained': {
          this.runOrdainScene(event, nowMs + cursor);
          cursor += this.ordainScene?.duration ?? ORDAIN_DURATION_MS;
          break;
        }
        case 'spawned': {
          const { x, y } = cellCenter(event.at);
          this.schedule(cursor, () => this.particles.ash(x, y, 10));
          break;
        }
        case 'blocked': {
          const { x, y } = cellCenter(event.at);
          this.schedule(cursor, () => this.particles.wormwoodSmoke(x, y, 8));
          break;
        }
        case 'unblocked': {
          const { x, y } = cellCenter(event.at);
          this.schedule(cursor, () => this.particles.ash(x, y, 8));
          break;
        }
        case 'emberFired': {
          const at = event.at;
          this.schedule(cursor, () => {
            const { x, y } = cellCenter(at);
            this.camera.shake(SHAKE_EMBER_PX, 250, nowMs + cursor);
            this.particles.sparks(x, y, 14);
            this.particles.ash(x, y, 10);
          });
          break;
        }
        case 'captured': {
          const { x, y } = cellCenter(event.at);
          this.schedule(cursor, () => this.particles.goldDustIn(x - 24, y - 24, x + 24, y + 24, 20));
          break;
        }
        case 'bossPhase': {
          this.runBossPhaseScene(nowMs + cursor, bossCell ?? { x: 3, y: 0 });
          cursor += BOSS_PHASE_DURATION_MS;
          break;
        }
        case 'cardPlayed': {
          this.setAvatar('player', 'cast', nowMs + cursor + 700);
          if (event.card === 'deathline') {
            const { column } = event.payload as { column: number };
            this.runDeathlineScene(column, nowMs + cursor);
            cursor += this.cardScene?.duration ?? DEATHLINE_DURATION_MS;
          } else if (event.card === 'barrage') {
            const { cells } = event.payload as { cells: Cell[] };
            this.runBarrageScene(cells, nowMs + cursor);
            cursor += this.cardScene?.duration ?? BARRAGE_DURATION_MS;
          } else if (event.card === 'depression') {
            this.cardScene = { kind: 'depression', startedAt: nowMs + cursor, duration: 1200 };
            cursor += 1200;
          }
          break;
        }
        default:
          break;
      }

      // Одиночная гибель (не от атаки): распад на месте.
      if (pendingKill && event.t === 'killed') {
        const kill = pendingKill;
        const next = events[events.indexOf(event) + 1];
        if (!next || next.t !== 'attacked') {
          const { x, y } = cellCenter(kill.at);
          const big = BIG_KILL_KINDS.includes(kill.kind);
          this.schedule(cursor, () => {
            this.camera.shake(big ? SHAKE_BIG_KILL_PX : SHAKE_KILL_PX, big ? 260 : 180, nowMs + cursor);
            this.particles.boneShards(x, y, '#4A4643');
            if (big) this.particles.sparks(x, y, 12);
            this.bloodSplats.push(kill.at);
          });
          pendingKill = null;
        }
      }
    }
  }

  /** Атака — эталонная последовательность (13.3). */
  private runAttackSequence(
    attackerId: Id,
    from: Cell,
    to: Cell,
    atMs: number,
    opts: { big: boolean; finisher: boolean; combo: number }
  ): void {
    const base = atMs - performance.now();
    const hitstop = opts.finisher ? 260 : opts.big ? ATTACK_HITSTOP_BIG_MS : ATTACK_HITSTOP_MS;
    const shake = opts.finisher ? SHAKE_WOW_SCENE_PX : opts.big ? SHAKE_BIG_KILL_PX : SHAKE_KILL_PX;

    // 0 мс: замах — существо остаётся на месте (слайд с нулевым смещением создаёт паузу).
    this.slides.push({ id: attackerId, from, to: from, startedAt: atMs, duration: ATTACK_WINDUP_MS });
    this.schedule(base + ATTACK_WINDUP_MS, () => {
      this.slides = this.slides.filter((s) => s.id !== attackerId);
      this.slides.push({ id: attackerId, from, to, startedAt: atMs + ATTACK_WINDUP_MS, duration: ATTACK_LUNGE_MS + 20 });
    });

    // 150 мс: hitstop, белая вспышка, тишина.
    this.schedule(base + ATTACK_SHATTER_AT_MS - hitstop, () => {
      this.hitstopUntil = atMs + ATTACK_SHATTER_AT_MS;
      this.flashUntil = atMs + ATTACK_SHATTER_AT_MS - hitstop + 40;
      this.flashStrength = opts.finisher ? 0.7 : opts.big ? 0.5 : 0.35;
    });

    // 260 мс: мир оживает — тряска, осколки, пятно.
    this.schedule(base + ATTACK_SHATTER_AT_MS, () => {
      this.camera.shake(shake, opts.finisher || opts.big ? 280 : 180, atMs + ATTACK_SHATTER_AT_MS);
      const { x, y } = cellCenter(to);
      this.particles.boneShards(x, y, opts.finisher || opts.big ? '#D9A441' : '#4A4643', opts.finisher ? 10 : undefined);
      if (opts.big || opts.finisher || opts.combo >= 2) this.particles.sparks(x, y, opts.finisher ? 16 : 12);
      if (opts.combo >= 3) this.particles.goldDustIn(x - 40, y - 40, x + 40, y + 40, 24);
      this.bloodSplats.push(to);
    });

    this.schedule(base + ATTACK_ATTACKER_SETTLES_AT_MS, () => {
      const { x, y } = cellCenter(to);
      this.particles.ash(x, y, 6);
    });
  }

  /** Посвящение — 1400 мс, первое за ран — 1800 мс + золотая пыль (13.4). */
  private runOrdainScene(event: Extract<BattleEvent, { t: 'ordained' }>, atMs: number): void {
    const isRepeat = this.seenScenes.has('ordain');
    this.seenScenes.add('ordain');
    const duration = isRepeat ? scaledDuration(ORDAIN_DURATION_MS, true) : ORDAIN_FIRST_DURATION_MS;
    const side: Side = event.placedAt.y >= 5 ? 'player' : 'enemy';
    const base = atMs - performance.now();

    this.hidden.add(event.id);
    this.ordainScene = {
      id: event.id,
      fromRank: event.from,
      toRank: event.to,
      at: event.at,
      placedAt: event.placedAt,
      side,
      startedAt: atMs,
      duration,
    };

    this.schedule(base + duration * 0.06, () => this.camera.zoomTransition(1.25, 400, atMs + duration * 0.06));
    this.schedule(base + duration * (1000 / 1400), () => {
      const { x, y } = cellCenter(event.placedAt);
      this.flashUntil = atMs + duration * (1000 / 1400) + 60;
      this.flashStrength = 1;
      this.camera.shake(SHAKE_WOW_SCENE_PX / 2, 300, atMs + duration * (1000 / 1400));
      this.particles.sparks(x, y, 16);
      if (!isRepeat) {
        this.particles.goldDustIn(BOARD_ORIGIN.x, BOARD_ORIGIN.y, BOARD_ORIGIN.x + BOARD_PX, BOARD_ORIGIN.y + BOARD_PX, 60);
      }
    });
    this.schedule(base + duration, () => {
      this.camera.zoomTransition(1, 400, atMs + duration);
      this.hidden.delete(event.id);
    });
  }

  /** Линия смерти — 2200 мс (13.4). */
  private runDeathlineScene(column: number, atMs: number): void {
    const isRepeat = this.seenScenes.has('deathline');
    this.seenScenes.add('deathline');
    const duration = scaledDuration(DEATHLINE_DURATION_MS, isRepeat);
    this.cardScene = { kind: 'deathline', startedAt: atMs, duration, column };
    const base = atMs - performance.now();

    const impactAt = duration * (1400 / 2200);
    this.schedule(base + impactAt - 200, () => {
      this.hitstopUntil = atMs + impactAt;
    });
    this.schedule(base + impactAt, () => {
      this.camera.shake(SHAKE_WOW_SCENE_PX, 400, atMs + impactAt);
      this.flashUntil = atMs + impactAt + 40;
      this.flashStrength = 0.6;
      for (let y = 0; y < 8; y++) {
        const { x: px, y: py } = cellCenter({ x: column, y });
        this.particles.ash(px, py, 6);
        this.particles.boneShards(px, py, '#4A4643', 4);
      }
    });
  }

  /** Обстрел — 1600 мс (13.4). Кратеры остаются до конца боя. */
  private runBarrageScene(cells: Cell[], atMs: number): void {
    const isRepeat = this.seenScenes.has('barrage');
    this.seenScenes.add('barrage');
    const duration = scaledDuration(BARRAGE_DURATION_MS, isRepeat);
    this.cardScene = { kind: 'barrage', startedAt: atMs, duration, cells };
    const base = atMs - performance.now();
    const hitsFrom = duration * (1000 / 1600);

    cells.forEach((cell, i) => {
      this.schedule(base + hitsFrom + i * 60, () => {
        const { x, y } = cellCenter(cell);
        this.camera.shake(6, 150, atMs + hitsFrom + i * 60);
        this.particles.sparks(x, y, 6);
        this.particles.ash(x, y, 6);
        this.craters.push(cell);
      });
    });
  }

  /** Переход босса в фазу II — 1200 мс, играется один раз за ран (7.5). */
  private runBossPhaseScene(atMs: number, at: Cell): void {
    if (this.seenScenes.has('bossPhase')) return;
    this.seenScenes.add('bossPhase');
    this.bossScene = { startedAt: atMs, duration: BOSS_PHASE_DURATION_MS, at };
    const base = atMs - performance.now();
    this.schedule(base + 100, () => {
      this.camera.shake(SHAKE_BOSS_PHASE_PX, 900, atMs + 100);
      const { x, y } = cellCenter(at);
      this.particles.boneShards(x, y, '#8C1C13', 8);
    });
  }
}
