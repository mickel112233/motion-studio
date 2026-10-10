import { describe, expect, it } from 'vitest';
import { applyAiEditPlan, parseAiEditPlan, type AiEditPlan } from './ai-edit-plan';
import type { ValidatedProject } from './project-validation';

const project: ValidatedProject = {
  name: 'Test', width: 1920, height: 1080, fps: 30, duration: 12,
  layers: [{
    id: 'title', name: 'Title', kind: 'text', color: '#a78bfa', visible: true, locked: false,
    start: 0, duration: 8, x: 0, y: 0, scale: 1, rotation: 0, opacity: 100, text: 'Hello',
    keyframes: [{ time: 0, x: 0, y: 0, scale: 1, rotation: 0, opacity: 100 }]
  }]
};

describe('AI edit plan safety and application', () => {
  it('parses a fenced JSON edit plan', () => {
    const parsed = parseAiEditPlan('```json\n{"summary":"Improve title","operations":[{"type":"update-layer","layerId":"title","patch":{"text":"A better title","opacity":90}}]}\n```');
    expect(parsed.ok).toBe(true);
  });

  it('rejects unsupported operations and out-of-range values', () => {
    expect(parseAiEditPlan(JSON.stringify({ summary:'Bad plan', operations:[{ type:'run-shell', command:'delete files' }] })).ok).toBe(false);
    expect(parseAiEditPlan(JSON.stringify({ summary:'Bad opacity', operations:[{ type:'update-layer', layerId:'title', patch:{ opacity:101 } }] })).ok).toBe(false);
  });

  it('applies valid layer edits and new title layers', () => {
    const plan: AiEditPlan = { summary:'Improve the opening', operations:[
      { type:'update-layer', layerId:'title', patch:{ text:'A stronger opening', opacity:88 } },
      { type:'add-layer', kind:'text', name:'Call to action', text:'Watch now', start:8, duration:3, color:'#5eead4' }
    ] };
    const result = applyAiEditPlan(project, plan);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.project.layers).toHaveLength(2);
      expect(result.project.layers[0].text).toBe('A stronger opening');
      expect(result.project.layers[1].text).toBe('Watch now');
      expect(project.layers).toHaveLength(1);
    }
  });

  it('accepts and applies transitions, geometric masks and color grade controls', () => {
    const parsed = parseAiEditPlan(JSON.stringify({ summary:'Style the shot', operations:[{ type:'update-layer', layerId:'title', patch:{ transitionIn:{type:'fade',duration:1}, mask:{type:'ellipse',inset:8}, colorGrade:{exposure:1,contrast:110,saturation:90,temperature:10,tint:-5} } }] }));
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      const result = applyAiEditPlan(project, parsed.plan);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.project.layers[0].transitionIn?.type).toBe('fade');
        expect(result.project.layers[0].mask?.type).toBe('ellipse');
        expect(result.project.layers[0].colorGrade?.exposure).toBe(1);
      }
    }
  });

  it('does not partially apply a plan if a later operation conflicts', () => {
    const plan: AiEditPlan = { summary:'Conflict', operations:[
      { type:'update-layer', layerId:'title', patch:{ text:'Should not leak' } },
      { type:'update-layer', layerId:'missing', patch:{ opacity:50 } }
    ] };
    const result = applyAiEditPlan(project, plan);
    expect(result.ok).toBe(false);
    expect(project.layers[0].text).toBe('Hello');
  });

  it('refuses edits to locked layers and deletions without explicit confirmation', () => {
    const locked = structuredClone(project);
    locked.layers[0].locked = true;
    const result = applyAiEditPlan(locked, { summary:'Locked', operations:[{ type:'update-layer', layerId:'title', patch:{ opacity:50 } }] });
    expect(result.ok).toBe(false);
    expect(parseAiEditPlan(JSON.stringify({ summary:'Delete', operations:[{ type:'delete-layer', layerId:'title' }] })).ok).toBe(false);
  });
});
