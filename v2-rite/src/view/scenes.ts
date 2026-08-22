// Тайминги вау-сцен (13.4). При повторе за ран длительность сокращается на 40%.
export const ORDAIN_DURATION_MS = 1400;
export const ORDAIN_FIRST_DURATION_MS = 1800;
export const DEATHLINE_DURATION_MS = 2200;
export const BARRAGE_DURATION_MS = 1600;
export const BOSS_PHASE_DURATION_MS = 1200; // сокращению не подлежит
export const RELIC_SCENE_DURATION_MS = 900;
export const REPEAT_SCENE_SCALE = 0.6;

export function scaledDuration(baseMs: number, isRepeat: boolean): number {
  return isRepeat ? Math.round(baseMs * REPEAT_SCENE_SCALE) : baseMs;
}

// Тряска камеры (13.5): всегда с затуханием.
export const SHAKE_KILL_PX = 7;
export const SHAKE_BIG_KILL_PX = 12;
export const SHAKE_WOW_SCENE_PX = 16;
export const SHAKE_BOSS_PHASE_PX = 14;
export const SHAKE_EMBER_PX = 8;

// Атака — эталонная последовательность (13.3), мс от клика.
export const ATTACK_WINDUP_MS = 90;
export const ATTACK_LUNGE_MS = 60;
export const ATTACK_HITSTOP_MS = 110;
export const ATTACK_HITSTOP_BIG_MS = 180;
export const ATTACK_SHATTER_AT_MS = 260;
export const ATTACK_ATTACKER_SETTLES_AT_MS = 380;
export const ATTACK_DEBRIS_LANDS_AT_MS = 600;
