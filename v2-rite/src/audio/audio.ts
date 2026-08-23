/**
 * Единый слой звука. MP3 из /assets/audio/ проигрываются, если файл есть.
 * Если файла нет — процедурный Web Audio (осцилляторы и шум), игра не немая.
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
  | 'bell_toll'
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

export const ALL_SFX: SfxName[] = [
  'ui_hover', 'ui_select', 'ui_deny', 'ui_click', 'move', 'ap_spend', 'kill', 'kill_big', 'ordain',
  'card_draw', 'card_burn', 'deathline', 'barrage', 'spy', 'blitz', 'revive', 'weaver_die',
  'bell_toll', 'catcher_die', 'shell_open', 'eye_charge', 'eye_push', 'ember_arm', 'ember_fire', 'boss_theme',
  'boss_phase', 'relic_get', 'battle_win', 'run_lose', 'map_move',
];
const ALL_MUSIC: MusicName[] = ['mus_path', 'mus_battle', 'mus_boss'];

const MAX_SOURCES = 12; // 12.1: тринадцатый вытесняет самый старый

interface ActiveSource {
  node: AudioBufferSourceNode;
  startedAt: number;
}

interface MusicVoice {
  gain: GainNode;
  stop: () => void;
}

function db(n: number): number {
  return Math.pow(10, n / 20);
}

function varyAmt(amount: number): number {
  return 1 + (Math.random() * 2 - 1) * amount;
}

function makeNoiseBuffer(ctx: AudioContext, seconds = 2): AudioBuffer {
  const buf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * seconds), ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  return buf;
}

function tone(
  ctx: AudioContext,
  dest: AudioNode,
  opts: { type?: OscillatorType; freq: number; freqEnd?: number; dur: number; gain: number; delay?: number },
): void {
  const t0 = ctx.currentTime + (opts.delay ?? 0);
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.type = opts.type ?? 'sine';
  osc.frequency.setValueAtTime(Math.max(20, opts.freq), t0);
  if (opts.freqEnd !== undefined) {
    osc.frequency.exponentialRampToValueAtTime(Math.max(20, opts.freqEnd), t0 + opts.dur);
  }
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(Math.max(0.0001, opts.gain), t0 + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + opts.dur);
  osc.connect(g);
  g.connect(dest);
  osc.start(t0);
  osc.stop(t0 + opts.dur + 0.02);
}

function noiseHit(
  ctx: AudioContext,
  dest: AudioNode,
  noise: AudioBuffer,
  opts: {
    dur: number;
    freq: number;
    freqEnd?: number;
    q?: number;
    gain: number;
    delay?: number;
    filter?: BiquadFilterType;
  },
): void {
  const t0 = ctx.currentTime + (opts.delay ?? 0);
  const src = ctx.createBufferSource();
  src.buffer = noise;
  const filter = ctx.createBiquadFilter();
  filter.type = opts.filter ?? 'bandpass';
  filter.frequency.setValueAtTime(Math.max(40, opts.freq), t0);
  if (opts.freqEnd !== undefined) {
    filter.frequency.exponentialRampToValueAtTime(Math.max(40, opts.freqEnd), t0 + opts.dur);
  }
  filter.Q.value = opts.q ?? 4;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(Math.max(0.0001, opts.gain), t0 + 0.004);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + opts.dur);
  src.connect(filter);
  filter.connect(g);
  g.connect(dest);
  src.start(t0);
  src.stop(t0 + opts.dur + 0.02);
}

type SfxRecipe = (ctx: AudioContext, dest: AudioNode, noise: AudioBuffer, pitch: number, vol: number) => void;

/** Рецепты по SPEC 8.2 плюс недостающие события. Компилятор требует покрытие всех SfxName. */
const RECIPES: Record<SfxName, SfxRecipe> = {
  ui_hover: (ctx, dest, noise, p, v) => {
    noiseHit(ctx, dest, noise, { dur: 0.025, freq: 2400 * p, q: 6, gain: db(-20) * v });
  },
  ui_select: (ctx, dest, noise, p, v) => {
    tone(ctx, dest, { freq: 90 * p, dur: 0.18, gain: db(-12) * v });
    noiseHit(ctx, dest, noise, { dur: 0.03, freq: 900 * p, q: 6, gain: db(-16) * v });
  },
  ui_deny: (ctx, dest, _n, p, v) => {
    tone(ctx, dest, { type: 'square', freq: 140 * p, dur: 0.07, gain: db(-16) * v });
  },
  ui_click: (ctx, dest, noise, p, v) => {
    tone(ctx, dest, { freq: 160 * p, dur: 0.09, gain: db(-12) * v });
    noiseHit(ctx, dest, noise, { dur: 0.025, freq: 1100 * p, q: 5, gain: db(-16) * v });
  },
  move: (ctx, dest, noise, p, v) => {
    noiseHit(ctx, dest, noise, { dur: 0.16, freq: 800 * p, freqEnd: 300 * p, q: 4, gain: db(-10) * v });
    tone(ctx, dest, { freq: 70 * p, dur: 0.09, gain: db(-14) * v, delay: 0.12 });
  },
  map_move: (ctx, dest, noise, p, v) => {
    noiseHit(ctx, dest, noise, { dur: 0.12, freq: 700 * p, freqEnd: 280 * p, q: 5, gain: db(-14) * v });
    tone(ctx, dest, { freq: 80 * p, dur: 0.08, gain: db(-16) * v, delay: 0.08 });
  },
  ap_spend: (ctx, dest, noise, p, v) => {
    noiseHit(ctx, dest, noise, { dur: 0.04, freq: 3000 * p, q: 1, gain: db(-22) * v, filter: 'highpass' });
  },
  kill: (ctx, dest, noise, p, v) => {
    tone(ctx, dest, { freq: 120 * p, freqEnd: 40 * p, dur: 0.12, gain: db(-3) * v });
    noiseHit(ctx, dest, noise, { dur: 0.09, freq: 1800 * p, q: 3, gain: db(-8) * v });
    noiseHit(ctx, dest, noise, { dur: 0.4, freq: 400 * p, q: 1, gain: db(-10) * v, filter: 'lowpass' });
  },
  kill_big: (ctx, dest, noise, p, v) => {
    RECIPES.kill(ctx, dest, noise, p, v);
    tone(ctx, dest, { type: 'triangle', freq: 660 * p, dur: 0.9, gain: db(-8) * v });
  },
  ordain: (ctx, dest, noise, p, v) => {
    tone(ctx, dest, { freq: 55 * p, dur: 1.2, gain: db(-8) * v, delay: 0.3 });
    for (const cents of [-14, -9, -4, 4, 9, 14]) {
      const f = 220 * p * Math.pow(2, cents / 1200);
      tone(ctx, dest, { type: 'sawtooth', freq: f, dur: 1.0, gain: db(-18) * v, delay: 0.6 });
    }
    noiseHit(ctx, dest, noise, { dur: 0.2, freq: 800 * p, q: 2, gain: db(-6) * v, delay: 1.0 });
    tone(ctx, dest, { freq: 80 * p, dur: 0.35, gain: db(-6) * v, delay: 1.0 });
  },
  card_draw: (ctx, dest, _n, p, v) => {
    const ratios = [1, 2.76, 5.4, 8.93, 13.34];
    const durs = [2.4, 1.8, 1.2, 0.8, 0.5];
    ratios.forEach((r, i) => {
      tone(ctx, dest, { freq: 180 * r * p, dur: durs[i], gain: db(-8 - i * 2) * v });
    });
  },
  card_burn: (ctx, dest, noise, p, v) => {
    noiseHit(ctx, dest, noise, { dur: 0.8, freq: 4000 * p, freqEnd: 200 * p, q: 3, gain: db(-14) * v });
  },
  deathline: (ctx, dest, noise, p, v) => {
    tone(ctx, dest, { freq: 90 * p, dur: 0.4, gain: db(-4) * v });
    noiseHit(ctx, dest, noise, { dur: 1.2, freq: 300 * p, q: 1, gain: db(-8) * v, filter: 'lowpass', delay: 0.4 });
  },
  barrage: (ctx, dest, noise, p, v) => {
    for (let i = 0; i < 8; i++) {
      const f = (1200 + Math.random() * 800) * p;
      noiseHit(ctx, dest, noise, { dur: 0.12, freq: f, q: 4, gain: db(-6) * v, delay: i * 0.06 });
    }
  },
  spy: (ctx, dest, noise, p, v) => {
    tone(ctx, dest, { type: 'triangle', freq: 880 * p, dur: 0.07, gain: db(-14) * v });
    noiseHit(ctx, dest, noise, { dur: 0.05, freq: 2400 * p, q: 8, gain: db(-18) * v });
  },
  blitz: (ctx, dest, noise, p, v) => {
    noiseHit(ctx, dest, noise, { dur: 0.18, freq: 1600 * p, freqEnd: 400 * p, q: 2, gain: db(-8) * v });
    tone(ctx, dest, { type: 'square', freq: 200 * p, freqEnd: 90 * p, dur: 0.12, gain: db(-16) * v });
  },
  revive: (ctx, dest, _n, p, v) => {
    tone(ctx, dest, { freq: 110 * p, freqEnd: 330 * p, dur: 0.45, gain: db(-10) * v });
    tone(ctx, dest, { type: 'triangle', freq: 440 * p, dur: 0.35, gain: db(-14) * v, delay: 0.2 });
  },
  weaver_die: (ctx, dest, noise, p, v) => {
    noiseHit(ctx, dest, noise, { dur: 0.22, freq: 500 * p, q: 2, gain: db(-10) * v, filter: 'lowpass' });
    tone(ctx, dest, { freq: 60 * p, dur: 0.2, gain: db(-12) * v });
  },
  bell_toll: (ctx, dest, _n, p, v) => {
    tone(ctx, dest, { freq: 220 * p, dur: 0.9, gain: db(-8) * v });
    tone(ctx, dest, { freq: 440 * p, dur: 0.5, gain: db(-14) * v });
  },
  catcher_die: (ctx, dest, noise, p, v) => {
    tone(ctx, dest, { freq: 44 * p, dur: 1.0, gain: db(-8) * v });
    noiseHit(ctx, dest, noise, { dur: 0.5, freq: 200 * p, freqEnd: 900 * p, q: 2, gain: db(-14) * v });
  },
  shell_open: (ctx, dest, noise, p, v) => {
    noiseHit(ctx, dest, noise, { dur: 0.15, freq: 1800 * p, freqEnd: 600 * p, q: 3, gain: db(-10) * v });
    tone(ctx, dest, { type: 'triangle', freq: 300 * p, dur: 0.12, gain: db(-14) * v });
  },
  eye_charge: (ctx, dest, _n, p, v) => {
    tone(ctx, dest, { type: 'sawtooth', freq: 80 * p, freqEnd: 240 * p, dur: 0.5, gain: db(-16) * v });
  },
  eye_push: (ctx, dest, noise, p, v) => {
    noiseHit(ctx, dest, noise, { dur: 0.2, freq: 500 * p, freqEnd: 180 * p, q: 2, gain: db(-10) * v });
    tone(ctx, dest, { freq: 90 * p, freqEnd: 50 * p, dur: 0.16, gain: db(-12) * v });
  },
  ember_arm: (ctx, dest, noise, p, v) => {
    tone(ctx, dest, { type: 'square', freq: 240 * p, dur: 0.05, gain: db(-18) * v });
    noiseHit(ctx, dest, noise, { dur: 0.12, freq: 2200 * p, q: 3, gain: db(-16) * v });
  },
  ember_fire: (ctx, dest, noise, p, v) => {
    noiseHit(ctx, dest, noise, { dur: 0.28, freq: 900 * p, freqEnd: 200 * p, q: 2, gain: db(-6) * v });
    tone(ctx, dest, { freq: 70 * p, freqEnd: 35 * p, dur: 0.2, gain: db(-8) * v });
  },
  boss_theme: (ctx, dest, _n, p, v) => {
    tone(ctx, dest, { type: 'triangle', freq: 146.8 * p, dur: 0.4, gain: db(-8) * v });
    tone(ctx, dest, { type: 'triangle', freq: 138.6 * p, dur: 0.9, gain: db(-8) * v, delay: 0.4 });
  },
  boss_phase: (ctx, dest, noise, p, v) => {
    tone(ctx, dest, { freq: 40 * p, dur: 0.8, gain: db(-6) * v });
    noiseHit(ctx, dest, noise, { dur: 0.5, freq: 200 * p, q: 1, gain: db(-8) * v, filter: 'lowpass' });
  },
  relic_get: (ctx, dest, _n, p, v) => {
    tone(ctx, dest, { freq: 523 * p, dur: 0.25, gain: db(-10) * v });
    tone(ctx, dest, { freq: 784 * p, dur: 0.35, gain: db(-12) * v, delay: 0.08 });
    tone(ctx, dest, { freq: 1046 * p, dur: 0.45, gain: db(-14) * v, delay: 0.16 });
  },
  battle_win: (ctx, dest, _n, p, v) => {
    tone(ctx, dest, { freq: 220 * p, dur: 0.3, gain: db(-6) * v });
    tone(ctx, dest, { freq: 293.7 * p, dur: 0.3, gain: db(-6) * v, delay: 0.3 });
    tone(ctx, dest, { freq: 440 * p, dur: 0.45, gain: db(-6) * v, delay: 0.6 });
  },
  run_lose: (ctx, dest, _n, p, v) => {
    tone(ctx, dest, { freq: 55 * p, dur: 3, gain: db(-8) * v });
  },
};

export function hasSfxFallback(name: SfxName): boolean {
  return typeof RECIPES[name] === 'function';
}

class AudioLayer {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private musicBus: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private buffers = new Map<string, AudioBuffer>();
  private loading = new Set<string>();
  private active: ActiveSource[] = [];
  private currentMusic: MusicName | null = null;
  private musicVoice: MusicVoice | null = null;
  private musicFromFile: MusicName | null = null;
  private heartbeat: { src: AudioBufferSourceNode; gain: GainNode } | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private unlocked = false;

  /** Первый пользовательский жест разблокирует AudioContext (12.1). */
  unlock(): void {
    if (this.ctx) {
      void this.ctx.resume().catch(() => undefined);
      return;
    }
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
      this.noise = makeNoiseBuffer(this.ctx);
      this.unlocked = true;
      void this.ctx.resume().catch(() => undefined);
      // Тихий клик в том же жесте — Safari/Chrome не оставляют контекст «пустым».
      const tick = this.ctx.createBuffer(1, 1, this.ctx.sampleRate);
      const src = this.ctx.createBufferSource();
      src.buffer = tick;
      src.connect(this.master);
      src.start();
      for (const name of [...ALL_SFX, ...ALL_MUSIC, 'heartbeat']) void this.load(name);
      const pending = this.currentMusic;
      this.currentMusic = null;
      if (pending) this.music(pending);
    } catch {
      this.ctx = null;
      this.master = null;
      this.musicBus = null;
      this.unlocked = false;
    }
  }

  private async load(name: string): Promise<AudioBuffer | null> {
    if (!this.ctx) return null;
    if (this.buffers.has(name)) return this.buffers.get(name) ?? null;
    if (this.loading.has(name)) return null;
    this.loading.add(name);
    try {
      const res = await fetch(`/assets/audio/${name}.mp3`);
      if (!res.ok) throw new Error('missing');
      const type = res.headers.get('content-type') ?? '';
      if (type.includes('text/html')) throw new Error('missing');
      const data = await res.arrayBuffer();
      const buffer = await this.ctx.decodeAudioData(data);
      this.buffers.set(name, buffer);
      return buffer;
    } catch {
      return null;
    } finally {
      this.loading.delete(name);
    }
  }

  private playBuffer(buffer: AudioBuffer, opts: { vary?: boolean; volume?: number }): void {
    if (!this.ctx || !this.master) return;
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

  /** Проигрывает эффект с вариативностью (12.1): питч ±8%, громкость ±2 дБ. */
  sfx(name: SfxName, opts: { vary?: boolean; volume?: number } = {}): void {
    if (!this.ctx || !this.master) return;
    void this.ctx.resume().catch(() => undefined);
    const buffer = this.buffers.get(name);
    if (buffer) {
      this.playBuffer(buffer, opts);
      return;
    }
    if (!this.noise) return;
    const pitch = opts.vary !== false ? varyAmt(0.08) : 1;
    const vol = (opts.volume ?? 1) * (opts.vary !== false ? db((Math.random() * 2 - 1) * 2) : 1);
    RECIPES[name](this.ctx, this.master, this.noise, pitch, vol);
  }

  private fadeOutMusic(fade: number): void {
    if (!this.ctx || !this.musicVoice) return;
    const now = this.ctx.currentTime;
    const voice = this.musicVoice;
    voice.gain.gain.setTargetAtTime(0, now, fade / 4);
    setTimeout(() => voice.stop(), fade * 1000 + 200);
    this.musicVoice = null;
    this.musicFromFile = null;
  }

  private startFileMusic(name: MusicName, buffer: AudioBuffer): void {
    if (!this.ctx || !this.musicBus) return;
    const src = this.ctx.createBufferSource();
    src.buffer = buffer;
    src.loop = true;
    const gain = this.ctx.createGain();
    gain.gain.value = 0;
    gain.gain.setTargetAtTime(0.6, this.ctx.currentTime, 0.5);
    src.connect(gain);
    gain.connect(this.musicBus);
    src.start();
    this.musicVoice = {
      gain,
      stop: () => {
        try {
          src.stop();
        } catch {
          /* ok */
        }
      },
    };
    this.musicFromFile = name;
  }

  private startProceduralMusic(name: MusicName): void {
    if (!this.ctx || !this.musicBus) return;
    const ctx = this.ctx;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    gain.gain.setTargetAtTime(0.28, ctx.currentTime, 0.5);
    gain.connect(this.musicBus);

    const base = name === 'mus_boss' ? 41 : 55;
    const cutoff = name === 'mus_boss' ? 260 : name === 'mus_battle' ? 520 : 380;
    const osc1 = ctx.createOscillator();
    const osc2 = ctx.createOscillator();
    osc1.type = 'sawtooth';
    osc2.type = 'sawtooth';
    osc1.frequency.value = base;
    osc2.frequency.value = base * Math.pow(2, 6 / 1200);

    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = cutoff;
    lp.Q.value = 0.7;

    osc1.connect(lp);
    osc2.connect(lp);
    lp.connect(gain);

    const extra = ctx.createOscillator();
    extra.type = name === 'mus_path' ? 'sine' : 'triangle';
    extra.frequency.value = name === 'mus_boss' ? 61.5 : name === 'mus_battle' ? 82.4 : 82.5;
    const extraGain = ctx.createGain();
    extraGain.gain.value = name === 'mus_path' ? 0.12 : 0.2;
    extra.connect(extraGain);
    extraGain.connect(lp);

    osc1.start();
    osc2.start();
    extra.start();

    this.musicVoice = {
      gain,
      stop: () => {
        try {
          osc1.stop();
          osc2.stop();
          extra.stop();
        } catch {
          /* ok */
        }
      },
    };
    this.musicFromFile = null;
  }

  /** Смена музыкального лупа с кроссфейдом 2 с (12.3). */
  music(name: MusicName | null): void {
    if (!this.ctx || !this.musicBus) {
      this.currentMusic = name;
      return;
    }
    if (name === this.currentMusic && this.musicVoice) return;

    const fade = 2;
    this.fadeOutMusic(fade);
    this.currentMusic = name;
    if (!name) return;

    const buffer = this.buffers.get(name);
    if (buffer) {
      this.startFileMusic(name, buffer);
      return;
    }
    this.startProceduralMusic(name);
    void this.load(name).then((loaded) => {
      if (!loaded || !this.ctx || this.currentMusic !== name || this.musicFromFile === name) return;
      this.fadeOutMusic(1.2);
      this.startFileMusic(name, loaded);
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
    if (on && !this.heartbeat && this.heartbeatTimer === null) {
      const buffer = this.buffers.get('heartbeat');
      if (buffer) {
        const src = this.ctx.createBufferSource();
        src.buffer = buffer;
        src.loop = true;
        const gain = this.ctx.createGain();
        gain.gain.value = 0.7;
        src.connect(gain);
        gain.connect(this.master);
        src.start();
        this.heartbeat = { src, gain };
      } else {
        const beat = (): void => {
          if (!this.ctx || !this.master) return;
          tone(this.ctx, this.master, { freq: 50, dur: 0.08, gain: db(-18) });
          tone(this.ctx, this.master, { freq: 50, dur: 0.08, gain: db(-18), delay: 0.18 });
        };
        beat();
        this.heartbeatTimer = setInterval(beat, 2000);
      }
    } else if (!on) {
      if (this.heartbeat) {
        try {
          this.heartbeat.src.stop();
        } catch {
          /* ok */
        }
        this.heartbeat = null;
      }
      if (this.heartbeatTimer !== null) {
        clearInterval(this.heartbeatTimer);
        this.heartbeatTimer = null;
      }
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
