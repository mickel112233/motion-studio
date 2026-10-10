import { describe, expect, it } from 'vitest';
import { applyEasing, evaluateTransform, isLayerActive, normalizeKeyframes, evaluateClipPresentation, type AnimatableLayer } from './animation';

const layer = (overrides: Partial<AnimatableLayer> = {}): AnimatableLayer => ({
  start: 0, duration: 10, x: 0, y: 10, scale: 1, rotation: 0, opacity: 100,
  keyframes: [
    { time: 0, x: 0, y: 10, scale: 1, rotation: 0, opacity: 100 },
    { time: 10, x: 100, y: 30, scale: 3, rotation: 180, opacity: 0 }
  ],
  ...overrides
} as AnimatableLayer);

describe('Motion Studio animation engine', () => {
  it('interpolates all transform channels at a midpoint', () => {
    expect(evaluateTransform(layer(), 5)).toEqual({ x: 50, y: 20, scale: 2, rotation: 90, opacity: 50 });
  });

  it('clamps before the first and after the last keyframe', () => {
    expect(evaluateTransform(layer(), -1).x).toBe(0);
    expect(evaluateTransform(layer(), 20).x).toBe(100);
  });

  it('keeps base transform until the first keyframe time', () => {
    const value = evaluateTransform(layer({ keyframes: [
      { time: 5, x: 80, y: 10, scale: 1, rotation: 0, opacity: 100 },
      { time: 10, x: 100, y: 10, scale: 1, rotation: 0, opacity: 100 }
    ] }), 2);
    expect(value.x).toBe(0);
    const single = evaluateTransform(layer({ keyframes: [
      { time: 5, x: 80, y: 10, scale: 1, rotation: 0, opacity: 100 }
    ] }), 2);
    expect(single.x).toBe(0);
    expect(evaluateTransform(layer({ keyframes: [
      { time: 5, x: 80, y: 10, scale: 1, rotation: 0, opacity: 100 }
    ] }), 6).x).toBe(80);
  });

  it('applies easing curves deterministically', () => {
    expect(applyEasing(0.5, 'linear')).toBe(0.5);
    expect(applyEasing(0.5, 'ease-in')).toBe(0.25);
    expect(applyEasing(0.5, 'ease-out')).toBe(0.75);
    expect(applyEasing(0.5, 'ease-in-out')).toBe(0.5);
    expect(applyEasing(0.7, 'hold')).toBe(0);
  });

  it('uses the left keyframe easing for its outgoing segment', () => {
    const value = evaluateTransform(layer({ keyframes: [
      { time: 0, x: 0, y: 0, scale: 1, rotation: 0, opacity: 100, easing: 'ease-in' },
      { time: 10, x: 100, y: 0, scale: 1, rotation: 0, opacity: 100 }
    ] }), 5);
    expect(value.x).toBe(25);
  });

  it('sorts keyframes and resolves duplicate times using the last value', () => {
    const frames = normalizeKeyframes([
      { time: 5, x: 10, y: 0, scale: 1, rotation: 0, opacity: 100 },
      { time: 0, x: 0, y: 0, scale: 1, rotation: 0, opacity: 100 },
      { time: 5, x: 25, y: 0, scale: 1, rotation: 0, opacity: 100 }
    ]);
    expect(frames.map(f => f.time)).toEqual([0, 5]);
    expect(frames[1].x).toBe(25);
  });

  it('handles missing or invalid keyframes with the base transform', () => {
    expect(evaluateTransform(layer({ keyframes: undefined }), 3).x).toBe(0);
    expect(evaluateTransform(layer({ keyframes: [{ time: NaN, x: 9, y: 0, scale: 1, rotation: 0, opacity: 100 }] }), 3).x).toBe(0);
  });

  it('treats a hold segment as constant until the next keyframe', () => {
    const value = evaluateTransform(layer({ keyframes: [
      { time: 0, x: 12, y: 0, scale: 1, rotation: 0, opacity: 100, easing: 'hold' },
      { time: 10, x: 99, y: 0, scale: 1, rotation: 0, opacity: 100 }
    ] }), 8);
    expect(value.x).toBe(12);
  });

  it('checks layer active range using an exclusive end boundary', () => {
    expect(isLayerActive({ start: 2, duration: 3 }, 2)).toBe(true);
    expect(isLayerActive({ start: 2, duration: 3 }, 4.999)).toBe(true);
    expect(isLayerActive({ start: 2, duration: 3 }, 5)).toBe(false);
  });
});

describe('clip transition presentation', () => {
  const layer = { start: 2, duration: 8, transitionIn: { type: 'fade' as const, duration: 2 }, transitionOut: { type: 'zoom' as const, duration: 2 } };
  it('fades in according to local clip time', () => {
    expect(evaluateClipPresentation(layer, 2).opacity).toBe(0);
    expect(evaluateClipPresentation(layer, 3).opacity).toBeCloseTo(.5);
    expect(evaluateClipPresentation(layer, 4).opacity).toBe(1);
  });
  it('zooms out at the clip end and ignores time outside transitions', () => {
    expect(evaluateClipPresentation(layer, 8).scale).toBe(1);
    expect(evaluateClipPresentation(layer, 9).scale).toBeCloseTo(1.1);
    expect(evaluateClipPresentation(layer, 10).scale).toBeCloseTo(1.2);
  });
  it('reveals wipe transitions with a deterministic clip path', () => {
    expect(evaluateClipPresentation({ start: 0, duration: 5, transitionIn: { type: 'wipe-left', duration: 1 } }, .5).clipPath).toBe('inset(0 50% 0 0)');
  });
});
