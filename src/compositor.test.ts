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
  it('uses the layer color for drop shadow', () => {
    expect(cssEffectFilter([{ id: 'shadow', type: 'drop-shadow', enabled: true, value: 12 }], '#ff0000')).toBe('drop-shadow(0 0 12px #ff0000)');
  });
});
