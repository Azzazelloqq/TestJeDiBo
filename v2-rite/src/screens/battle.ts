import { computeIntents, decideAiAction, type Intent } from '../core/ai';
import { applyAttack, applyDepression, applyEndTurn, applyEyePush, applyMove, applyPreacherSummon, forceEndTurn, type Result } from '../core/battle';
import { getCreatureAt, getCreatureById } from '../core/board';
import { discardInapplicable, isCardApplicable, playBarrage, playBlitzkrieg, playDeathline, playResurrection, playSpy } from '../core/cards';
import { getLegalAttacks, getLegalMoves } from '../core/rules';
import type { BattleEvent, BattleState, Cell, Id } from '../core/types';
import { audio } from '../audio/audio';
import type { Animator } from '../view/animator';
import { cellFromPoint } from '../view/geometry';
import {
  graveyardCreatureAt,
  pointInEndTurn,
  pointInPendingCard,
  renderBattle,
  setSelectionOrigin,
  type BattleViewExtra,
} from '../view/renderer';

const AI_STEP_DELAY_MS = 420; // 10.3

export interface BattleDeps {
  getBattle(): BattleState | null;
  setBattle(state: BattleState): void;
  /** Главный обработчик событий: анимации, звук, статистика, конец боя. */
  onEvents(events: BattleEvent[]): void;
  animator: Animator;
  /** Ввод заблокирован извне (вау-сцена, интро). */
  isBlocked(): boolean;
}

/** Экран боя (3): выбор, ход, атака, карты, ИИ. */
export class BattleScreen {
  private selectedId: Id | null = null;
  private selectedAtMs = 0;
  private hoverCell: Cell | null = null;
  private hoverPoint: { x: number; y: number } | null = null;
  private targeting: 'spy' | 'resurrection' | null = null;
  private aiTimer: ReturnType<typeof setTimeout> | null = null;
  private intents: Map<Id, Intent> = new Map();
  private intentsFor: BattleState | null = null;
  private discardMsgUntil = 0;
  private discardMsg: string | null = null;
  /** Хореография появления (13.7): момент показа боя и «первый бой рана». */
  private shownAtMs = 0;
  private firstBattle = false;

  constructor(private deps: BattleDeps) {}

  onBattleStart(firstBattle: boolean): void {
    this.selectedId = null;
    this.targeting = null;
    this.firstBattle = firstBattle;
    this.shownAtMs = performance.now();
    this.intentsFor = null;
    this.stopAi();
    this.deps.animator.resetBattle();
  }

  destroy(): void {
    this.stopAi();
  }

  private stopAi(): void {
    if (this.aiTimer) {
      clearTimeout(this.aiTimer);
      this.aiTimer = null;
    }
  }

  private introDurationMs(): number {
    return this.firstBattle ? 4200 : 500;
  }

  private introBlocked(nowMs: number): boolean {
    return nowMs - this.shownAtMs < this.introDurationMs();
  }

  private inputBlocked(): boolean {
    const now = performance.now();
    return this.deps.isBlocked() || this.deps.animator.isBusy(now) || this.introBlocked(now);
  }

  /** Центральный сток каждого применённого действия. */
  private commit(result: Result): void {
    // Неприменимая пришедшая карта сбрасывается сама (9.1).
    const settled = discardInapplicable(result.state);
    const state = settled.state;
    const events = [...result.events, ...settled.events];

    for (const e of events) {
      if (e.t === 'cardDiscarded' && state.karma.discardMessage) {
        this.discardMsg = state.karma.discardMessage;
        this.discardMsgUntil = performance.now() + 1200;
      }
    }

    this.deps.setBattle(state);
    this.deps.onEvents(events);

    if (state.winner !== null) {
      this.stopAi();
      return;
    }
    this.scheduleAi();
  }

  private scheduleAi(): void {
    this.stopAi();
    const battle = this.deps.getBattle();
    if (!battle || battle.turn !== 'enemy' || battle.winner !== null) return;
    this.aiTimer = setTimeout(() => this.aiStep(), AI_STEP_DELAY_MS);
  }

  private aiStep(): void {
    this.aiTimer = null;
    const battle = this.deps.getBattle();
    if (!battle || battle.turn !== 'enemy' || battle.winner !== null) return;

    const decision = decideAiAction(battle);
    let result: Result | null;
    if (!decision) {
      result = forceEndTurn(battle);
    } else {
      switch (decision.kind) {
        case 'depression':
          result = applyDepression(battle);
          break;
        case 'push': {
          audio.sfx('eye_charge');
          result = applyEyePush(battle, decision.id) ?? forceEndTurn(battle);
          break;
        }
        case 'summon':
          result = applyPreacherSummon(battle) ?? forceEndTurn(battle);
          break;
        case 'attack':
          result = applyAttack(battle, decision.id, decision.to);
          break;
        case 'move':
          result = applyMove(battle, decision.id, decision.to);
          break;
      }
    }
    this.commit(result);
  }

  /** Пинок ИИ при входе в бой не нужен: первым всегда ходит игрок (6.3). */

  handleClick(x: number, y: number): void {
    if (this.inputBlocked()) return;
    const battle = this.deps.getBattle();
    if (!battle || battle.winner !== null) return;

    if (pointInEndTurn(x, y)) {
      this.endTurn();
      return;
    }
    if (battle.karma.pendingCard && pointInPendingCard(x, y)) {
      audio.sfx('ui_click');
      this.playPendingCard();
      return;
    }
    if (this.targeting === 'resurrection') {
      const id = graveyardCreatureAt(battle, x, y);
      if (id && battle.graveyard.player.some((c) => c.id === id)) {
        this.targeting = null;
        this.commit(playResurrection(battle, id));
        audio.sfx('revive');
        return;
      }
    }

    const cell = cellFromPoint(x, y);
    if (!cell) {
      this.cancel();
      return;
    }
    this.handleCellClick(battle, cell);
  }

  private handleCellClick(battle: BattleState, cell: Cell): void {
    if (battle.turn !== 'player') return;

    if (this.targeting === 'spy') {
      const target = getCreatureAt(battle.creatures, cell);
      if (target && target.side === 'enemy') {
        this.targeting = null;
        this.commit(playSpy(battle, target.id));
        audio.sfx('spy');
      }
      return;
    }

    const clicked = getCreatureAt(battle.creatures, cell);

    if (this.selectedId) {
      const selected = getCreatureById(battle.creatures, this.selectedId);
      if (selected && clicked && clicked.id === selected.id) return;
      if (clicked && clicked.side === 'player') {
        this.select(battle, clicked.id);
        return;
      }
      const moves = getLegalMoves(battle, this.selectedId);
      if (moves.some((c) => c.x === cell.x && c.y === cell.y)) {
        const result = applyMove(battle, this.selectedId, cell);
        this.clearSelection();
        this.commit(result);
        return;
      }
      const attacks = getLegalAttacks(battle, this.selectedId);
      if (attacks.some((c) => c.x === cell.x && c.y === cell.y)) {
        const result = applyAttack(battle, this.selectedId, cell);
        this.clearSelection();
        this.commit(result);
        return;
      }
      audio.sfx('ui_deny');
      this.clearSelection();
      return;
    }

    if (clicked && clicked.side === 'player') {
      if (clicked.acted && !this.canActViaBlitz(battle, clicked.id)) {
        audio.sfx('ui_deny');
        return;
      }
      this.select(battle, clicked.id);
    }
  }

  private canActViaBlitz(battle: BattleState, id: Id): boolean {
    const blitz = battle.karma.blitzkrieg;
    return blitz !== null && blitz.creatureId === id && blitz.actionsLeft > 0;
  }

  private select(battle: BattleState, id: Id): void {
    this.selectedId = id;
    this.selectedAtMs = performance.now();
    const creature = getCreatureById(battle.creatures, id);
    setSelectionOrigin(creature ? creature.cell : null);
    audio.sfx('ui_select');
  }

  private clearSelection(): void {
    this.selectedId = null;
    setSelectionOrigin(null);
  }

  private endTurn(): void {
    const battle = this.deps.getBattle();
    if (!battle || battle.turn !== 'player' || battle.winner !== null) return;
    const result = applyEndTurn(battle);
    if (result.events.length === 0) {
      audio.sfx('ui_deny');
      return;
    }
    this.clearSelection();
    audio.sfx('ui_click');
    this.commit(result);
  }

  private playPendingCard(): void {
    const battle = this.deps.getBattle();
    if (!battle || battle.turn !== 'player' || !battle.karma.pendingCard) return;
    const card = battle.karma.pendingCard;
    if (!isCardApplicable(battle, card)) {
      this.commit({ state: battle, events: [] }); // discardInapplicable внутри commit
      return;
    }
    switch (card) {
      case 'deathline':
        this.commit(playDeathline(battle));
        break;
      case 'barrage':
        this.commit(playBarrage(battle));
        break;
      case 'blitzkrieg':
        this.commit(playBlitzkrieg(battle));
        audio.sfx('blitz');
        break;
      case 'spy':
        this.targeting = 'spy';
        break;
      case 'resurrection':
        this.targeting = 'resurrection';
        break;
    }
  }

  handleHover(x: number, y: number): void {
    this.hoverPoint = { x, y };
    const cell = cellFromPoint(x, y);
    if (cell && (!this.hoverCell || this.hoverCell.x !== cell.x || this.hoverCell.y !== cell.y)) {
      if (!this.inputBlocked()) audio.sfx('ui_hover', { volume: 0.4 });
    }
    this.hoverCell = cell;
  }

  handleKey(code: string): void {
    if (this.inputBlocked()) return;
    if (code === 'Space') this.endTurn();
    else if (code === 'Escape') this.cancel();
  }

  cancel(): void {
    if (this.targeting) {
      this.targeting = null;
      return;
    }
    this.clearSelection();
  }

  render(ctx: CanvasRenderingContext2D, nowMs: number): void {
    const battle = this.deps.getBattle();
    if (!battle) return;

    if (this.intentsFor !== battle) {
      this.intents = computeIntents(battle);
      this.intentsFor = battle;
    }

    const blocked = this.inputBlocked();
    const introFx = this.computeIntroFx(battle, nowMs);

    const extra: BattleViewExtra = {
      selectedId: this.selectedId,
      selectedAtMs: this.selectedAtMs,
      legalMoves: this.selectedId && !blocked ? getLegalMoves(battle, this.selectedId) : [],
      legalAttacks: this.selectedId && !blocked ? getLegalAttacks(battle, this.selectedId) : [],
      hoverCell: this.hoverCell,
      hoverPoint: this.hoverPoint,
      nowMs,
      targeting: this.targeting,
      animator: this.deps.animator,
      intents: nowMs - this.shownAtMs > (this.firstBattle ? 3600 : 0) ? this.intents : new Map(),
      discardMessage: nowMs < this.discardMsgUntil ? this.discardMsg : null,
      spawnFx: introFx,
    };
    renderBattle(ctx, battle, extra);
  }

  /** Первые десять секунд (13.7): существа падают на арену по одному, твари проступают из темноты. */
  private computeIntroFx(battle: BattleState, nowMs: number): Map<Id, { alpha: number; dy: number }> | null {
    const t = nowMs - this.shownAtMs;
    if (!this.firstBattle) {
      if (t >= 500) return null;
      const fx = new Map<Id, { alpha: number; dy: number }>();
      const alpha = Math.min(1, t / 400);
      for (const c of battle.creatures) fx.set(c.id, { alpha, dy: 0 });
      return fx;
    }
    if (t >= 4200) return null;

    const fx = new Map<Id, { alpha: number; dy: number }>();
    let playerIdx = 0;
    let enemyIdx = 0;
    for (const c of battle.creatures) {
      if (c.side === 'player') {
        // 5–6 с общего таймлайна: падают по одному с ударом, 90 мс между.
        const appearAt = 1800 + playerIdx * 90;
        playerIdx++;
        const p = Math.min(1, Math.max(0, (t - appearAt) / 160));
        fx.set(c.id, { alpha: p, dy: -(1 - p) * (1 - p) * 46 });
      } else {
        // Твари проступают из темноты беззвучно.
        const appearAt = 2800 + enemyIdx * 60;
        enemyIdx++;
        const p = Math.min(1, Math.max(0, (t - appearAt) / 420));
        fx.set(c.id, { alpha: p, dy: 0 });
      }
    }
    return fx;
  }

  /** Затемнение арены в начале первого боя (13.7: арена возникает из темноты). */
  introFadeAlpha(nowMs: number): number {
    const t = nowMs - this.shownAtMs;
    const fadeMs = this.firstBattle ? 1500 : 300;
    return Math.max(0, 1 - t / fadeMs);
  }
}
