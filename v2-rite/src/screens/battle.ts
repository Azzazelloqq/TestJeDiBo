import { computeIntents, decideAiAction, type Intent } from '../core/ai';
import { applyAttack, applyDepression, applyEndTurn, applyMove, applyPreacherSummon, forceEndTurn, type Result } from '../core/battle';
import { getCreatureAt, getCreatureById } from '../core/board';
import { CARDS, discardInapplicable, isCardApplicable, pickBarrageCells, playBarrage, playBlitzkrieg, playDeathline, playResurrection, playSpy } from '../core/cards';
import { RANK_OF } from '../core/creatures';
import { getLegalAttacks, getLegalMoves } from '../core/rules';
import type { BattleEvent, BattleState, CardId, Cell, Id } from '../core/types';

function cardTitle(card: CardId): string {
  return CARDS[card].name;
}
import { audio } from '../audio/audio';
import type { Animator } from '../view/animator';
import { boardPointFromScreen, cellFromPoint } from '../view/geometry';
import {
  graveyardCreatureAt,
  pointInEndTurn,
  pointInHint,
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
  private targeting: 'spy' | 'resurrection' | 'deathline' | 'barrage' | null = null;
  private barragePreview: Cell[] | null = null;
  private aiTimer: ReturnType<typeof setTimeout> | null = null;
  private intents: Map<Id, Intent> = new Map();
  private intentsFor: BattleState | null = null;
  private discardMsgUntil = 0;
  private discardMsg: string | null = null;
  private denyMsgUntil = 0;
  private denyMsg: string | null = null;
  /** Хореография появления (13.7): момент показа боя и «первый бой рана». */
  private shownAtMs = 0;
  private firstBattle = false;
  private hintUntilActions = 0;

  constructor(private deps: BattleDeps) {}

  onBattleStart(firstBattle: boolean): void {
    this.selectedId = null;
    this.targeting = null;
    this.barragePreview = null;
    this.firstBattle = firstBattle;
    this.hintUntilActions = firstBattle ? 3 : 1;
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
    let settled = result;
    if (result.events.some((e) => e.t === 'cardDrawn')) {
      settled = discardInapplicable(result.state);
      settled = { state: settled.state, events: [...result.events, ...settled.events] };
    }
    const state = settled.state;
    const events = settled.events;

    for (const e of events) {
      if (e.t === 'cardDiscarded' && state.karma.discardMessage) {
        this.discardMsg = state.karma.discardMessage;
        this.discardMsgUntil = performance.now() + 1600;
      }
      if (e.t === 'cardPlayed') {
        const name = e.card === 'depression' ? 'Депрессия' : cardTitle(e.card);
        this.discardMsg = `Разыграно — ${name}`;
        this.discardMsgUntil = performance.now() + 1800;
      }
    }

    if (this.hintUntilActions > 0 && result.events.some((e) => e.t === 'moved' || e.t === 'attacked')) {
      this.hintUntilActions -= 1;
    }
    this.deps.setBattle(state);
    this.deps.onEvents(events);

    if (state.feast) {
      this.selectedId = state.feast.creatureId;
      this.selectedAtMs = performance.now();
      const feaster = getCreatureById(state.creatures, state.feast.creatureId);
      setSelectionOrigin(feaster ? feaster.cell : null);
    }

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

    try {
      const decision = decideAiAction(battle);
      let result: Result | null;
      if (!decision) {
        result = forceEndTurn(battle);
      } else {
        switch (decision.kind) {
          case 'depression':
            result = applyDepression(battle);
            break;
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
    } catch {
      this.commit(forceEndTurn(battle));
    }
  }

  /** Клик по арене — с учётом zoom/shake камеры. UI (карта, конец хода) остаётся в экранных координатах. */
  private boardCellAt(x: number, y: number): Cell | null {
    const now = performance.now();
    const cam = this.deps.animator.camera.transform(now);
    const board = boardPointFromScreen(x, y, cam, now);
    return cellFromPoint(board.x, board.y);
  }

  /** Пинок ИИ при входе в бой не нужен: первым всегда ходит игрок (6.3). */

  handleClick(x: number, y: number): void {
    const battle = this.deps.getBattle();
    if (!battle || battle.winner !== null) return;

    // Карту можно нажать даже во время интро — иначе её не замечают.
    if (battle.karma.pendingCard && pointInPendingCard(x, y)) {
      if (this.deps.animator.isBusy(performance.now())) return;
      if (battle.turn !== 'player') {
        this.denyMsg = 'Карту разыгрывают в свой ход';
        this.denyMsgUntil = performance.now() + 1400;
        audio.sfx('ui_deny');
        return;
      }
      if (this.targeting === 'barrage' && this.barragePreview) {
        audio.sfx('ui_click');
        const cells = this.barragePreview;
        this.targeting = null;
        this.barragePreview = null;
        this.commit(playBarrage(battle, cells));
        return;
      }
      audio.sfx('ui_click');
      this.playPendingCard();
      return;
    }

    if (this.inputBlocked()) return;
    if (this.hintUntilActions > 0 && pointInHint(x, y)) {
      this.hintUntilActions = 0;
      return;
    }

    if (pointInEndTurn(x, y)) {
      this.endTurn();
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
      this.denyMsg = 'Кликни павшего слева от доски';
      this.denyMsgUntil = performance.now() + 1600;
      audio.sfx('ui_deny');
      return;
    }

    const cell = this.boardCellAt(x, y);
    if (!cell) {
      this.cancel();
      return;
    }
    this.handleCellClick(battle, cell);
  }

  private handleCellClick(battle: BattleState, cell: Cell): void {
    if (battle.turn !== 'player') {
      this.denyMsg = 'Сейчас ход противника';
      this.denyMsgUntil = performance.now() + 1200;
      audio.sfx('ui_deny');
      return;
    }

    if (this.targeting === 'deathline') {
      this.targeting = null;
      this.commit(playDeathline(battle, cell.x));
      return;
    }
    if (this.targeting === 'barrage') {
      this.denyMsg = 'Нажми карту ещё раз — подтвердить. Esc — отмена';
      this.denyMsgUntil = performance.now() + 1600;
      audio.sfx('ui_deny');
      return;
    }

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

    if (clicked && clicked.side === 'enemy') {
      const attackerId = this.findAttacker(battle, cell);
      if (attackerId) {
        const result = applyAttack(battle, attackerId, cell);
        this.clearSelection();
        this.commit(result);
        return;
      }
      audio.sfx('ui_deny');
      this.denyMsg = clicked.kind === 'shell' ? 'Панцирь не принимает этот удар' : 'Не достаёт';
      this.denyMsgUntil = performance.now() + 1100;
      return;
    }

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
      this.denyMove(selected, cell);
      return;
    }

    if (clicked && clicked.side === 'player') {
      if (battle.feast && battle.feast.creatureId !== clicked.id) {
        this.denyMsg = 'Пир: бей той же фигурой';
        this.denyMsgUntil = performance.now() + 1400;
        audio.sfx('ui_deny');
        return;
      }
      if (clicked.acted && !this.canActViaBlitz(battle, clicked.id) && battle.feast?.creatureId !== clicked.id) {
        this.denyMsg = 'Эта фигура уже ходила';
        this.denyMsgUntil = performance.now() + 1400;
        audio.sfx('ui_deny');
        return;
      }
      this.select(battle, clicked.id);
      return;
    }

    const moverId = this.findMover(battle, cell);
    if (moverId) {
      const result = applyMove(battle, moverId, cell);
      this.clearSelection();
      this.commit(result);
      return;
    }
    this.denyMsg = 'Сначала кликни свою фигуру';
    this.denyMsgUntil = performance.now() + 1400;
    audio.sfx('ui_deny');
  }

  private denyMove(selected: ReturnType<typeof getCreatureById>, cell: Cell): void {
    audio.sfx('ui_deny');
    if (!selected) {
      this.denyMsg = 'Сюда не сходить';
    } else if (RANK_OF[selected.kind] === 'square' && cell.y > selected.cell.y) {
      this.denyMsg = 'Квадрат не ходит назад';
    } else {
      this.denyMsg = 'Сюда не достаёт';
    }
    this.denyMsgUntil = performance.now() + 1400;
  }

  /** Кто может шагнуть на пустую клетку: выбранное существо, иначе любой, кто достаёт. */
  private findMover(battle: BattleState, cell: Cell): Id | null {
    if (this.selectedId) {
      const moves = getLegalMoves(battle, this.selectedId);
      if (moves.some((c) => c.x === cell.x && c.y === cell.y)) return this.selectedId;
    }
    for (const creature of battle.creatures) {
      if (creature.side !== 'player') continue;
      const moves = getLegalMoves(battle, creature.id);
      if (moves.some((c) => c.x === cell.x && c.y === cell.y)) return creature.id;
    }
    return null;
  }

  /** Кто может ударить клетку: выбранное существо, иначе любой, кто достаёт. */
  private findAttacker(battle: BattleState, cell: Cell): Id | null {
    if (this.selectedId) {
      const attacks = getLegalAttacks(battle, this.selectedId);
      if (attacks.some((c) => c.x === cell.x && c.y === cell.y)) return this.selectedId;
    }
    for (const creature of battle.creatures) {
      if (creature.side !== 'player') continue;
      const attacks = getLegalAttacks(battle, creature.id);
      if (attacks.some((c) => c.x === cell.x && c.y === cell.y)) return creature.id;
    }
    return null;
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
    if (!battle || battle.winner !== null) return;
    if (battle.turn !== 'player') {
      this.denyMsg = 'Сейчас ход противника';
      this.denyMsgUntil = performance.now() + 1200;
      audio.sfx('ui_deny');
      return;
    }
    const result = applyEndTurn(battle);
    if (result.events.length === 0) {
      this.denyMsg = battle.actionsTaken < 1 ? 'Сначала сходи фигурой' : 'Ход уже кончился';
      this.denyMsgUntil = performance.now() + 1400;
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
      this.commit(discardInapplicable(battle));
      return;
    }
    switch (card) {
      case 'deathline':
        this.targeting = 'deathline';
        break;
      case 'barrage':
        this.targeting = 'barrage';
        this.barragePreview = pickBarrageCells();
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
    const cell = this.boardCellAt(x, y);
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
      this.barragePreview = null;
      this.denyMsg = 'Отмена';
      this.denyMsgUntil = performance.now() + 800;
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

    if (battle.turn === 'enemy' && battle.winner === null && this.aiTimer === null) {
      this.scheduleAi();
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
      barragePreview: this.barragePreview,
      animator: this.deps.animator,
      intents: nowMs - this.shownAtMs > (this.firstBattle ? 3600 : 0) ? this.intents : new Map(),
      discardMessage: nowMs < this.denyMsgUntil ? this.denyMsg : nowMs < this.discardMsgUntil ? this.discardMsg : null,
      spawnFx: introFx,
      hint: battle.feast
        ? 'ПИР — эта фигура достаёт ещё. Бей выделенную тварь'
        : this.targeting
          ? null
          : this.hintUntilActions > 0 && nowMs - this.shownAtMs > this.introDurationMs()
            ? 'Кликни свою фигуру, потом клетку. Стрелки над тварями — куда они пойдут'
            : null,
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
