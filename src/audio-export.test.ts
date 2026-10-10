import { describe, expect, it } from 'vitest';
import { createAudioExportSession, normalizeAudioFades } from './audio-export';
import type { RenderLayer } from './compositor';

const audioLayer = (overrides: Partial<RenderLayer> = {}): RenderLayer => ({
  id: 'audio-1', name: 'Music', kind: 'audio', color: '#a78bfa', visible: true, locked: false,
  start: 0, duration: 5, x: 0, y: 0, scale: 1, rotation: 0, opacity: 100,
  volume: 100, muted: false, assetUrl: 'file:///music.wav', keyframes: [],
  ...overrides
} as RenderLayer);

describe('audio export preparation', () => {
  it('does not allocate audio resources when there are no audio clips', async () => {
    await expect(createAudioExportSession([])).resolves.toBeUndefined();
  });
  it('skips hidden, muted, zero-volume and missing-asset clips', async () => {
    await expect(createAudioExportSession([
      audioLayer({ visible: false }),
      audioLayer({ muted: true }),
      audioLayer({ volume: 0 }),
      audioLayer({ assetUrl: undefined })
    ])).resolves.toBeUndefined();
  });
});

describe('audio fade envelope', () => {
  it('clamps fade durations and proportionally fits overlapping fades', () => {
    expect(normalizeAudioFades(10, 2, 3)).toEqual({ fadeIn: 2, fadeOut: 3 });
    expect(normalizeAudioFades(4, 4, 4)).toEqual({ fadeIn: 2, fadeOut: 2 });
    expect(normalizeAudioFades(2, -1, 8)).toEqual({ fadeIn: 0, fadeOut: 2 });
  });
});
