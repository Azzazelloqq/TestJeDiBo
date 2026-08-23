import { describe, expect, it } from 'vitest';
import { ALL_SFX, hasSfxFallback } from './audio';

describe('procedural audio fallbacks', () => {
  it('covers every sfx so missing mp3s are never silent', () => {
    for (const name of ALL_SFX) {
      expect(hasSfxFallback(name), name).toBe(true);
    }
  });
});
