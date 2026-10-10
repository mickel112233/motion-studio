import { describe, expect, it } from 'vitest';
import { cssEffectFilter } from './compositor';

describe('layer effect renderer', () => {
  it('returns no filter for an empty stack', () => {
    expect(cssEffectFilter([])).toBe('none');
    expect(cssEffectFilter(undefined)).toBe('none');
  });
  it('composes enabled filters in stack order', () => {
    expect(cssEffectFilter([
      { id: 'blur', type: 'blur', enabled: true, value: 8 },
      { id: 'disabled', type: 'sepia', enabled: false, value: 80 },
      { id: 'brightness', type: 'brightness', enabled: true, value: 120 }
    ])).toBe('blur(8px) brightness(120%)');
  });
  it('clamps filter values to supported limits', () => {
    expect(cssEffectFilter([
      { id: 'blur', type: 'blur', enabled: true, value: 90 },
      { id: 'hue', type: 'hue-rotate', enabled: true, value: 720 }
    ])).toBe('blur(40px) hue-rotate(360deg)');
  });
  it('adds basic color grade filters with bounded exposure and color adjustments', () => {
    expect(cssEffectFilter([], '#a78bfa', { exposure: 1, contrast: 110, saturation: 90, temperature: 0, tint: 0 })).toBe('brightness(200%) contrast(110%) saturate(90%)');
    expect(cssEffectFilter(undefined, '#a78bfa', { exposure: 0, contrast: 100, saturation: 100, temperature: 20, tint: 10 })).toBe('brightness(100%) contrast(100%) saturate(100%) sepia(10%) hue-rotate(1.8deg)');
  });
  it('uses the layer color for drop shadow', () => {
    expect(cssEffectFilter([{ id: 'shadow', type: 'drop-shadow', enabled: true, value: 12 }], '#ff0000')).toBe('drop-shadow(0 0 12px #ff0000)');
  });
});
