import { describe, expect, it } from 'vitest';
import { isValidProject } from './project-validation';

const validProject = () => ({
  name: 'Test composition', width: 1920, height: 1080, fps: 30, duration: 10,
  layers: [{
    id: 'layer-1', name: 'Title', kind: 'text', color: '#a78bfa', visible: true, locked: false,
    start: 0, duration: 8, x: 0, y: 0, scale: 1, rotation: 0, opacity: 100, text: 'Hello',
    keyframes: [{ time: 0, x: 0, y: 0, scale: 1, rotation: 0, opacity: 100 }]
  }]
});

describe('project file validation', () => {
  it('accepts a valid project schema', () => expect(isValidProject(validProject())).toBe(true));
  it('rejects duplicate layer IDs', () => {
    const p = validProject(); p.layers.push({ ...p.layers[0] });
    expect(isValidProject(p)).toBe(false);
  });
  it('rejects invalid dimensions and non-finite transforms', () => {
    expect(isValidProject({ ...validProject(), width: 0 })).toBe(false);
    const p = validProject(); p.layers[0].x = Number.NaN;
    expect(isValidProject(p)).toBe(false);
  });
  it('rejects unsupported layer kinds and easing values', () => {
    const p = validProject(); (p.layers[0] as {kind:string}).kind = 'script';
    expect(isValidProject(p)).toBe(false);
    const q = validProject(); (q.layers[0].keyframes[0] as {easing:string}).easing = 'teleport';
    expect(isValidProject(q)).toBe(false);
  });
  it('rejects malformed keyframe times', () => {
    const p = validProject(); p.layers[0].keyframes[0].time = 11;
    expect(isValidProject(p)).toBe(false);
  });
});
