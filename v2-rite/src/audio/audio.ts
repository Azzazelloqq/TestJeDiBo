/**
 * Единый слой звука (12). Все обращения идут через него; отсутствующий файл —
 * тишина, не ошибка и не спам в консоль. Файлы кладутся заказчиком в
 * /assets/audio/ по списку 12.2.
 */

export type SfxName =
  | 'ui_hover'
  | 'ui_select'
  | 'ui_deny'
  | 'ui_click'
  | 'move'
  | 'ap_spend'
  | 'kill'
  | 'kill_big'
  | 'ordain'
  | 'card_draw'
  | 'card_burn'
  | 'deathline'
  | 'barrage'
  | 'spy'
  | 'blitz'
  | 'revive'
  | 'weaver_die'
  | 'catcher_die'
  | 'shell_open'
  | 'eye_charge'
  | 'eye_push'
  | 'ember_arm'
  | 'ember_fire'
  | 'boss_theme'
  | 'boss_phase'
  | 'relic_get'
  | 'battle_win'
  | 'run_lose'
  | 'map_move';

export type MusicName = 'mus_path' | 'mus_battle' | 'mus_boss';

const ALL_SFX: SfxName[] = [
  'ui_hover', 'ui_select', 'ui_deny', 'ui_click', 'move', 'ap_spend', 'kill', 'kill_big', 'ordain',
  'card_draw', 'card_burn', 'deathline', 'barrage', 'spy', 'blitz', 'revive', 'weaver_die',
  'catcher_die', 'shell_open', 'eye_charge', 'eye_push', 'ember_arm', 'ember_fire', 'boss_theme',
  'boss_phase', 'relic_get', 'battle_win', 'run_lose', 'map_move',
];
const ALL_MUSIC: MusicName[] = ['mus_path', 'mus_battle', 'mus_boss'];

const MAX_SOURCES = 12; // 12.1: тринадцатый вытесняет самый старый

interface ActiveSource {
  node: AudioBufferSourceNode;
  startedAt: number;
}

class AudioLayer {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private musicBus: GainNode | null = null;
  private buffers = new Map<string, AudioBuffer | null>(); // null — файла нет, молчим
  private loading = new Set<string>();
  private active: ActiveSource[] = [];
  private currentMusic: MusicName | null = null;
  private musicNodes = new Map<MusicName, { src: AudioBufferSourceNode; gain: GainNode }>();
  private heartbeat: { src: AudioBufferSourceNode; gain: GainNode } | null = null;
  private unlocked = false;

  /** Первый пользовательский клик разблокирует AudioContext (12.1). */
  unlock(): void {
    if (this.unlocked) return;
    this.unlocked = true;
    try {
      this.ctx = new AudioContext();
      const compressor = this.ctx.createDynamicsCompressor();
      compressor.threshold.value = -18;
      compressor.ratio.value = 4;
      compressor.connect(this.ctx.destination);
      this.master = this.ctx.createGain();
      this.master.connect(compressor);
      this.musicBus = this.ctx.createGain();
      this.musicBus.connect(this.master);
      void this.ctx.resume().catch(() => undefined);
      for (const name of [...ALL_SFX, ...ALL_MUSIC, 'heartbeat']) void this.load(name);
    } catch {
      this.ctx = null;
    }
  }

  private async load(name: string): Promise<AudioBuffer | null> {
    if (!this.ctx) return null;
    if (this.buffers.has(name)) return this.buffers.get(name) ?? null;
    if (this.loading.has(name)) return null;
    this.loading.add(name);
    try {
      const res = await fetch(`assets/audio/${name}.mp3`);
      if (!res.ok) throw new Error('missing');
      const type = res.headers.get('content-type') ?? '';
      if (type.includes('text/html')) throw new Error('missing'); // dev-сервер отдал index.html
      const data = await res.arrayBuffer();
      const buffer = await this.ctx.decodeAudioData(data);
      this.buffers.set(name, buffer);
      return buffer;
    } catch {
      this.buffers.set(name, null); // тишина, без ошибок и логов
      return null;
    } finally {
      this.loading.delete(name);
    }
  }

  /** Проигрывает эффект с вариативностью (12.1): питч ±8%, громкость ±2 дБ. */
  sfx(name: SfxName, opts: { vary?: boolean; volume?: number } = {}): void {
    if (!this.ctx || !this.master) return;
    const buffer = this.buffers.get(name);
    if (!buffer) return;

    while (this.active.length >= MAX_SOURCES) {
      const oldest = this.active.shift()!;
      try {
        oldest.node.stop();
      } catch {
        /* уже остановлен */
      }
    }

    const src = this.ctx.createBufferSource();
    src.buffer = buffer;
    const vary = opts.vary !== false;
    if (vary) src.playbackRate.value = 1 + (Math.random() * 2 - 1) * 0.08;

    const gain = this.ctx.createGain();
    const varyDb = vary ? (Math.random() * 2 - 1) * 2 : 0;
    gain.gain.value = (opts.volume ?? 1) * Math.pow(10, varyDb / 20);

    src.connect(gain);
    gain.connect(this.master);
    src.start();
    const entry = { node: src, startedAt: performance.now() };
    this.active.push(entry);
    src.onended = () => {
      this.active = this.active.filter((a) => a !== entry);
    };
  }

  /** Смена музыкального лупа с кроссфейдом 2 с (12.3). */
  music(name: MusicName | null): void {
    if (!this.ctx || !this.musicBus) {
      this.currentMusic = name;
      return;
    }
    if (name === this.currentMusic) return;

    const fade = 2;
    const now = this.ctx.currentTime;
    const prev = this.currentMusic ? this.musicNodes.get(this.currentMusic) : null;
    if (prev) {
      prev.gain.gain.setTargetAtTime(0, now, fade / 4);
      const node = prev;
      setTimeout(() => {
        try {
          node.src.stop();
        } catch {
          /* ok */
        }
      }, fade * 1000 + 200);
      if (this.currentMusic) this.musicNodes.delete(this.currentMusic);
    }
    this.currentMusic = name;
    if (!name) return;

    void this.load(name).then((buffer) => {
      if (!buffer || !this.ctx || !this.musicBus || this.currentMusic !== name) return;
      const src = this.ctx.createBufferSource();
      src.buffer = buffer;
      src.loop = true;
      const gain = this.ctx.createGain();
      gain.gain.value = 0;
      gain.gain.setTargetAtTime(0.6, this.ctx.currentTime, fade / 4);
      src.connect(gain);
      gain.connect(this.musicBus);
      src.start();
      this.musicNodes.set(name, { src, gain });
    });
  }

  /** Посвящение (12.3): музыка в ноль за 40 мс, назад через 1.4 с. */
  duckForOrdination(): void {
    if (!this.ctx || !this.musicBus) return;
    const now = this.ctx.currentTime;
    this.musicBus.gain.cancelScheduledValues(now);
    this.musicBus.gain.setValueAtTime(this.musicBus.gain.value, now);
    this.musicBus.gain.linearRampToValueAtTime(0, now + 0.04);
    this.musicBus.gain.setValueAtTime(0, now + 1.4);
    this.musicBus.gain.linearRampToValueAtTime(1, now + 1.9);
  }

  /** Осталось ≤ 2 существа — зацикленное сердцебиение (12.2). */
  setHeartbeat(on: boolean): void {
    if (!this.ctx || !this.master) return;
    if (on && !this.heartbeat) {
      const buffer = this.buffers.get('heartbeat');
      if (!buffer) return;
      const src = this.ctx.createBufferSource();
      src.buffer = buffer;
      src.loop = true;
      const gain = this.ctx.createGain();
      gain.gain.value = 0.7;
      src.connect(gain);
      gain.connect(this.master);
      src.start();
      this.heartbeat = { src, gain };
    } else if (!on && this.heartbeat) {
      try {
        this.heartbeat.src.stop();
      } catch {
        /* ok */
      }
      this.heartbeat = null;
    }
  }

  /** Вкладка ушла в фон (17): приостановить звук. */
  suspend(): void {
    void this.ctx?.suspend().catch(() => undefined);
  }

  resume(): void {
    if (this.unlocked) void this.ctx?.resume().catch(() => undefined);
  }
}

export const audio = new AudioLayer();
