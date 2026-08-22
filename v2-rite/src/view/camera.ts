export interface CameraTransform {
  shakeX: number;
  shakeY: number;
  zoom: number;
}

interface ShakeImpulse {
  amplitude: number;
  startedAt: number;
  duration: number;
  seedX: number;
  seedY: number;
}

/** Screen shake + zoom (§9.5). Shake always decays, never linear; zoom only ever moves during wow-scenes. */
export class Camera {
  private shakes: ShakeImpulse[] = [];
  private zoomFrom = 1;
  private zoomTo = 1;
  private zoomStartedAt = 0;
  private zoomDuration = 0;

  shake(amplitude: number, durationMs: number, nowMs: number): void {
    this.shakes.push({ amplitude, startedAt: nowMs, duration: durationMs, seedX: Math.random() * Math.PI * 2, seedY: Math.random() * Math.PI * 2 });
  }

  zoomTransition(target: number, durationMs: number, nowMs: number): void {
    this.zoomFrom = this.currentZoom(nowMs);
    this.zoomTo = target;
    this.zoomStartedAt = nowMs;
    this.zoomDuration = durationMs;
  }

  private currentZoom(nowMs: number): number {
    if (this.zoomDuration <= 0) return this.zoomTo;
    const t = Math.min(1, Math.max(0, (nowMs - this.zoomStartedAt) / this.zoomDuration));
    const eased = 1 - Math.pow(1 - t, 3);
    return this.zoomFrom + (this.zoomTo - this.zoomFrom) * eased;
  }

  transform(nowMs: number): CameraTransform {
    this.shakes = this.shakes.filter((s) => nowMs - s.startedAt < s.duration);
    let sx = 0;
    let sy = 0;
    for (const s of this.shakes) {
      const t = (nowMs - s.startedAt) / s.duration;
      const decay = 1 - t;
      sx += Math.sin((nowMs - s.startedAt) * 0.09 + s.seedX) * s.amplitude * decay;
      sy += Math.cos((nowMs - s.startedAt) * 0.11 + s.seedY) * s.amplitude * decay;
    }
    return { shakeX: sx, shakeY: sy, zoom: this.currentZoom(nowMs) };
  }
}
