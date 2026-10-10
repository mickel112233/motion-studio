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
  it('accepts legacy unversioned projects but rejects unknown future schema versions', () => {
    const legacy = validProject() as ReturnType<typeof validProject> & { schemaVersion?: number };
    expect(isValidProject(legacy)).toBe(true);
    expect(isValidProject({ ...validProject(), schemaVersion: 2 })).toBe(false);
    expect(isValidProject({ ...validProject(), schemaVersion: 0 })).toBe(false);
  });
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
    const q = validProject(); (q.layers[0].keyframes[0] as unknown as {easing:string}).easing = 'teleport';
    expect(isValidProject(q)).toBe(false);
  });
  it('accepts bounded effect stacks and rejects invalid effect values', () => {
    const p = validProject();
    (p.layers[0] as unknown as { effects: unknown[] }).effects = [{ id: 'fx-1', type: 'blur', enabled: true, value: 8 }];
    expect(isValidProject(p)).toBe(true);
    const q = validProject();
    (q.layers[0] as unknown as { effects: unknown[] }).effects = [{ id: 'fx-1', type: 'blur', enabled: true, value: 99 }];
    expect(isValidProject(q)).toBe(false);
  });

  it('validates per-layer audio settings', () => {
    const p = validProject();
    (p.layers[0] as unknown as { volume: number; muted: boolean }).volume = 65;
    (p.layers[0] as unknown as { volume: number; muted: boolean }).muted = true;
    expect(isValidProject(p)).toBe(true);
    const q = validProject();
    (q.layers[0] as unknown as { volume: number }).volume = 101;
    expect(isValidProject(q)).toBe(false);
  });

  it('validates clip transitions, geometric masks and color grade ranges', () => {
    const p = validProject();
    (p.layers[0] as any).transitionIn = { type: 'fade', duration: 1 };
    (p.layers[0] as any).transitionOut = { type: 'wipe-left', duration: 2 };
    (p.layers[0] as any).mask = { type: 'ellipse', inset: 10 };
    (p.layers[0] as any).colorGrade = { exposure: 1, contrast: 110, saturation: 90, temperature: -10, tint: 5 };
    expect(isValidProject(p)).toBe(true);
    const bad = validProject(); (bad.layers[0] as any).mask = { type: 'path-script', inset: 0 };
    expect(isValidProject(bad)).toBe(false);
    const badGrade = validProject(); (badGrade.layers[0] as any).colorGrade = { exposure: 99, contrast: 100, saturation: 100, temperature: 0, tint: 0 };
    expect(isValidProject(badGrade)).toBe(false);
  });

  it('rejects malformed keyframe times', () => {
    const p = validProject(); p.layers[0].keyframes[0].time = 11;
    expect(isValidProject(p)).toBe(false);
  });
});
