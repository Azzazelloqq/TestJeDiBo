import { audio, type SfxName } from './audio/audio';
import {
  chooseAltar,
  chooseEventOption,
  chooseGiveCard,
  choosePickFallen,
  choosePickOrdain,
  chooseRewardCard,
  chooseRewardRelic,
  closeRelicScene,
  completeBattle,
  dismissDeadEndEvent,
  enterNode,
  ingestBattleEvents,
  isEventDeadEnd,
  startRun,
  type RunPhase,
  type RunState,
} from './core/run';
import type { BattleEvent } from './core/types';
import { attachInput } from './input';
import { BattleScreen } from './screens/battle';
import { mapNodeAt, renderMap } from './screens/map';
import { overlayActionAt, renderOverlay } from './screens/overlays';
import { pointInRestart, renderSummary } from './screens/summary';
import { pointInTitleButton, renderTitle } from './screens/title';
import { Animator } from './view/animator';
import { CANVAS_H, CANVAS_W } from './view/geometry';
import { drawGrain, drawVignette } from './view/renderer';

const BATTLE_END_DELAY_MS = 800; // 16: пауза перед итогами/наградой

// ---------- Холст ----------

const canvas = document.getElementById('game') as HTMLCanvasElement;
const ctx = canvas.getContext('2d')!;
const app = document.getElementById('app') as HTMLDivElement;

function resize(w: number, h: number): void {
  if (w <= 0 || h <= 0) return;
  const scale = Math.min(w / CANVAS_W, h / CANVAS_H);
  canvas.style.width = `${CANVAS_W * scale}px`;
  canvas.style.height = `${CANVAS_H * scale}px`;
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.round(CANVAS_W * dpr);
  canvas.height = Math.round(CANVAS_H * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

new ResizeObserver((entries) => {
  const e = entries[0];
  if (e) resize(e.contentRect.width, e.contentRect.height);
}).observe(app);
resize(app.clientWidth, app.clientHeight);

// ---------- Состояние ----------

let run: RunState = startRun();
const animator = new Animator();
let titleShownAt = performance.now();
let mapRevealAt = 0;
let overlayShownAt = 0;
let phaseFadeAt = 0;
let lastPhase: RunPhase = 'title';
let hoverPoint: { x: number; y: number } | null = null;
let battleEndTimer: ReturnType<typeof setTimeout> | null = null;
let firstBattleIntroPlayed = false; // 13.7: интро играет один раз за загрузку страницы

const battleScreen = new BattleScreen({
  getBattle: () => run.battle,
  setBattle: (s) => {
    run = { ...run, battle: s };
  },
  onEvents: handleBattleEvents,
  animator,
  isBlocked: () => false,
});

// ---------- Звук событий (12.2) ----------

function sfxLater(name: SfxName, delayMs: number, opts?: { volume?: number }): void {
  setTimeout(() => audio.sfx(name, opts), delayMs);
}

function playEventSounds(events: BattleEvent[]): void {
  const hasAttack = events.some((e) => e.t === 'attacked');
  let cursor = 0;
  for (const e of events) {
    switch (e.t) {
      case 'moved':
        audio.sfx('move');
        break;
      case 'pushed':
        audio.sfx('eye_push');
        break;
      case 'apSpent':
        audio.sfx('ap_spend', { volume: 0.5 });
        break;
      case 'killed': {
        const big = e.kind === 'hierophant' || e.kind === 'eye' || e.kind === 'preacher';
        // 13.3: звук удара приходит на 260 мс, вместе с распадом.
        sfxLater(big ? 'kill_big' : 'kill', hasAttack ? 260 + cursor : cursor);
        break;
      }
      case 'ordained':
        audio.duckForOrdination();
        audio.sfx('ordain');
        cursor += 1400;
        break;
      case 'cardDrawn':
        audio.sfx('card_draw');
        break;
      case 'cardDiscarded':
        audio.sfx('card_burn');
        break;
      case 'cardPlayed':
        if (e.card === 'deathline') audio.sfx('deathline');
        else if (e.card === 'barrage') sfxLater('barrage', 1000);
        break;
      case 'blocked':
        if (e.source === 'cocoon') audio.sfx('weaver_die');
        break;
      case 'spawned':
        audio.sfx('catcher_die');
        break;
      case 'emberArmed':
        audio.sfx('ember_arm');
        break;
      case 'emberFired':
        audio.sfx('ember_fire');
        break;
      case 'bossPhase':
        audio.sfx('boss_phase');
        break;
      case 'battleWon':
        sfxLater('battle_win', 400);
        break;
      case 'battleLost':
        sfxLater('run_lose', 400);
        break;
      default:
        break;
    }
  }
}

// ---------- Пайплайн боя ----------

function handleBattleEvents(events: BattleEvent[]): void {
  const battle = run.battle;
  const bossCell = battle?.creatures.find((c) => c.kind === 'preacher')?.cell;
  animator.processEvents(events, performance.now(), bossCell);
  playEventSounds(events);
  ingestBattleEvents(run, events);

  if (battle) {
    const playersLeft = battle.creatures.filter((c) => c.side === 'player').length;
    audio.setHeartbeat(playersLeft <= 2 && playersLeft > 0 && battle.winner === null);
  }

  if (battle && battle.winner !== null) {
    audio.setHeartbeat(false);
    if (battleEndTimer) clearTimeout(battleEndTimer);
    battleEndTimer = setTimeout(() => {
      battleEndTimer = null;
      completeBattle(run);
      if (run.overlay) overlayShownAt = performance.now();
      if (run.overlay?.kind === 'relic-scene') audio.sfx('relic_get');
    }, BATTLE_END_DELAY_MS);
  }
}

function startBattlePhase(events: BattleEvent[]): void {
  const first = !firstBattleIntroPlayed;
  firstBattleIntroPlayed = true;
  battleScreen.onBattleStart(first);
  handleBattleEvents(events);
  if (run.battleNode?.type === 'boss') setTimeout(() => audio.sfx('boss_theme'), 600);
}

// ---------- Ввод ----------

canvas.addEventListener('pointerdown', () => audio.unlock(), { once: true });

function handleClick(x: number, y: number): void {
  switch (run.phase) {
    case 'title': {
      if (pointInTitleButton(x, y)) {
        audio.sfx('ui_click');
        run.phase = 'map';
        mapRevealAt = performance.now();
      }
      break;
    }
    case 'map': {
      if (run.overlay) {
        handleOverlayClick(x, y);
        break;
      }
      const node = mapNodeAt(x, y);
      if (node && node.level === run.level) {
        audio.sfx('map_move');
        const battleEvents = enterNode(run, node.id);
        // enterNode мутирует run: перечитываем состояние без сужения типов.
        const after: RunState = run;
        if (after.phase === 'battle') startBattlePhase(battleEvents);
        else if (after.overlay) overlayShownAt = performance.now();
        if (after.overlay?.kind === 'relic-scene') audio.sfx('relic_get');
      }
      break;
    }
    case 'battle':
      battleScreen.handleClick(x, y);
      break;
    case 'summary': {
      if (pointInRestart(x, y)) restart();
      break;
    }
  }
}

function handleOverlayClick(x: number, y: number): void {
  const overlay = run.overlay;
  if (!overlay) return;
  const action = overlayActionAt(run, x, y, performance.now(), overlayShownAt);
  if (!action) return;

  const prevOverlay = run.overlay;
  switch (action.type) {
    case 'card': {
      audio.sfx('ui_click');
      if (overlay.kind === 'pick-give-card') chooseGiveCard(run, action.card);
      else chooseRewardCard(run, action.card);
      break;
    }
    case 'relic': {
      chooseRewardRelic(run, action.relic);
      audio.sfx('relic_get');
      break;
    }
    case 'altar': {
      audio.sfx('ui_click');
      chooseAltar(run, action.choice);
      break;
    }
    case 'event': {
      audio.sfx('ui_click');
      if (overlay.kind === 'event') {
        const events = chooseEventOption(run, overlay.eventId, action.option);
        if (run.phase === 'battle') {
          startBattlePhase(events);
          return;
        }
        if (run.overlay?.kind === 'relic-scene') audio.sfx('relic_get');
      }
      break;
    }
    case 'member': {
      if (overlay.kind === 'pick-ordain') {
        choosePickOrdain(run, action.id);
        audio.sfx('ordain');
      } else {
        choosePickFallen(run, action.id);
        audio.sfx('revive');
      }
      break;
    }
    case 'close': {
      audio.sfx('ui_click');
      if (overlay.kind === 'event' && isEventDeadEnd(run, overlay.eventId)) dismissDeadEndEvent(run);
      else closeRelicScene(run);
      break;
    }
  }
  if (run.overlay !== prevOverlay) overlayShownAt = performance.now();
}

function restart(): void {
  // 16: клик мгновенно начинает новый обряд — без меню и подтверждений.
  audio.sfx('ui_click');
  if (battleEndTimer) clearTimeout(battleEndTimer);
  battleEndTimer = null;
  animator.resetRun();
  audio.setHeartbeat(false);
  run = startRun();
  run.phase = 'map';
  mapRevealAt = performance.now();
}

attachInput(canvas, {
  onClick: handleClick,
  onHover: (x, y) => {
    hoverPoint = { x, y };
    if (run.phase === 'battle') battleScreen.handleHover(x, y);
  },
  onHoverEnd: () => {
    hoverPoint = null;
  },
  onKey: (code) => {
    if (run.phase === 'battle') battleScreen.handleKey(code);
    else if (run.phase === 'summary' && code === 'Space') restart();
    else if (run.phase === 'map' && run.overlay?.kind === 'info' && code === 'Escape') closeRelicScene(run);
  },
  onCancel: () => {
    if (run.phase === 'battle') battleScreen.cancel();
  },
});

// ---------- Музыка по фазам (12.3) ----------

function updateMusic(): void {
  switch (run.phase) {
    case 'title':
    case 'map':
      audio.music('mus_path');
      break;
    case 'battle':
      audio.music(run.battleNode?.type === 'boss' ? 'mus_boss' : 'mus_battle');
      break;
    case 'summary':
      audio.music(null); // на итогах музыки нет
      break;
  }
}

// ---------- Игровой цикл ----------

let lastFrame = 0;
let rafId = 0;

function frame(nowMs: number): void {
  const dt = lastFrame === 0 ? 16.7 : Math.min(100, nowMs - lastFrame);
  lastFrame = nowMs;
  animator.update(dt);

  if (run.phase !== lastPhase) {
    phaseFadeAt = nowMs;
    lastPhase = run.phase;
    updateMusic();
  }

  switch (run.phase) {
    case 'title':
      renderTitle(ctx, nowMs, titleShownAt, hoverPoint !== null && pointInTitleButton(hoverPoint.x, hoverPoint.y));
      break;
    case 'map': {
      renderMap(ctx, run, nowMs, mapRevealAt, run.overlay ? null : hoverPoint);
      if (run.overlay) renderOverlay(ctx, run, nowMs, overlayShownAt, hoverPoint);
      drawVignette(ctx);
      drawGrain(ctx, nowMs);
      break;
    }
    case 'battle': {
      battleScreen.render(ctx, nowMs);
      const fade = battleScreen.introFadeAlpha(nowMs);
      if (fade > 0) {
        ctx.fillStyle = `rgba(0,0,0,${fade})`;
        ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
      }
      break;
    }
    case 'summary':
      renderSummary(ctx, run, nowMs, hoverPoint !== null && pointInRestart(hoverPoint.x, hoverPoint.y));
      break;
  }

  // Кроссфейд 250 мс между экранами (3).
  const fadeT = (nowMs - phaseFadeAt) / 250;
  if (fadeT < 1 && phaseFadeAt > 0) {
    ctx.fillStyle = `rgba(0,0,0,${1 - fadeT})`;
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
  }

  rafId = requestAnimationFrame(frame);
}

rafId = requestAnimationFrame(frame);

// 17: вкладка ушла в фон — приостановить кадры и звук.
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    cancelAnimationFrame(rafId);
    audio.suspend();
  } else {
    lastFrame = 0;
    audio.resume();
    rafId = requestAnimationFrame(frame);
  }
});

updateMusic();
