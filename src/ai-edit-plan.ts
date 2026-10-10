import { isValidProject, type ValidatedProject, type ValidatedLayer } from './project-validation';

export type EditPatch = Partial<Pick<ValidatedLayer,
  'name' | 'start' | 'duration' | 'x' | 'y' | 'scale' | 'rotation' | 'opacity' |
  'text' | 'color' | 'visible' | 'volume' | 'muted' | 'effects'
>>;
export type AiEditOperation =
  | { type: 'update-layer'; layerId: string; patch: EditPatch; reason?: string }
  | { type: 'add-layer'; kind: 'text' | 'shape'; name: string; start?: number; duration?: number; x?: number; y?: number; scale?: number; rotation?: number; opacity?: number; color?: string; text?: string; reason?: string }
  | { type: 'delete-layer'; layerId: string; confirm: true; reason?: string }
  | { type: 'set-project'; patch: Partial<Pick<ValidatedProject, 'name' | 'width' | 'height' | 'fps' | 'duration'>>; reason?: string };
export type AiEditPlan = { summary: string; operations: AiEditOperation[]; riskNotes?: string[] };
export type PlanValidation = { ok: true; plan: AiEditPlan } | { ok: false; errors: string[] };

const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const text = (v: unknown, max = 200) => typeof v === 'string' && v.trim().length > 0 && v.length <= max;
const color = (v: unknown) => typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v);
const allowedLayerPatch = new Set(['name','start','duration','x','y','scale','rotation','opacity','text','color','visible','volume','muted','effects']);
const allowedProjectPatch = new Set(['name','width','height','fps','duration']);

export function parseAiEditPlan(raw: string): PlanValidation {
  const errors: string[] = [];
  let source = raw.trim();
  source = source.replace(/^\u0060\u0060\u0060(?:json)?\s*/i, '').replace(/\s*\u0060\u0060\u0060$/, '');
  let value: unknown;
  try { value = JSON.parse(source); }
  catch { return { ok: false, errors: ['The model did not return valid JSON. Ask it to regenerate the edit plan.'] }; }
  if (!isRecord(value)) return { ok: false, errors: ['The edit plan must be a JSON object.'] };
  if (!text(value.summary, 1000)) errors.push('Plan summary must be a non-empty string under 1,000 characters.');
  if (!Array.isArray(value.operations) || value.operations.length < 1 || value.operations.length > 30) errors.push('Plan must contain between 1 and 30 operations.');
  if (value.riskNotes !== undefined && (!Array.isArray(value.riskNotes) || value.riskNotes.length > 20 || value.riskNotes.some(note => !text(note, 500)))) errors.push('riskNotes must be an array of short strings.');
  if (Array.isArray(value.operations)) value.operations.forEach((op, i) => {
    const label = `Operation ${i + 1}`;
    if (!isRecord(op) || !text(op.type, 40)) { errors.push(`${label} is malformed.`); return; }
    if (op.type === 'update-layer') {
      if (!text(op.layerId, 160) || !isRecord(op.patch)) { errors.push(`${label} needs layerId and patch.`); return; }
      const keys = Object.keys(op.patch);
      if (!keys.length || keys.some(key => !allowedLayerPatch.has(key))) errors.push(`${label} contains unsupported layer fields.`);
      for (const key of keys) {
        const v = op.patch[key];
        if (['name'].includes(key) && !text(v, 200)) errors.push(`${label}: ${key} must be a short string.`);
        if (key === 'text' && (typeof v !== 'string' || v.length > 10000)) errors.push(`${label}: text must be a string under 10,000 characters.`);
        if (key === 'color' && !color(v)) errors.push(`${label}: color must be a hex RGB value.`);
        if (['visible','muted'].includes(key) && typeof v !== 'boolean') errors.push(`${label}: ${key} must be boolean.`);
        if (['start','duration','x','y','scale','rotation','opacity','volume'].includes(key) && !finite(v)) errors.push(`${label}: ${key} must be finite.`);
        if (key === 'effects' && !Array.isArray(v)) errors.push(`${label}: effects must be an array.`);
      }
      const p = op.patch as Record<string, unknown>;
      if (finite(p.start) && (p.start < 0 || p.start > 86400)) errors.push(`${label}: start is outside the supported range.`);
      if (finite(p.duration) && (p.duration <= 0 || p.duration > 86400)) errors.push(`${label}: duration must be positive.`);
      if (finite(p.scale) && (p.scale <= 0 || p.scale > 100)) errors.push(`${label}: scale must be between 0 and 100.`);
      if (finite(p.opacity) && (p.opacity < 0 || p.opacity > 100)) errors.push(`${label}: opacity must be between 0 and 100.`);
      if (finite(p.volume) && (p.volume < 0 || p.volume > 100)) errors.push(`${label}: volume must be between 0 and 100.`);
    } else if (op.type === 'add-layer') {
      if (!['text','shape'].includes(String(op.kind)) || !text(op.name, 200)) errors.push(`${label} can add only a named text or shape layer.`);
      for (const key of ['start','duration','x','y','scale','rotation','opacity']) if (op[key] !== undefined && !finite(op[key])) errors.push(`${label}: ${key} must be finite.`);
      if (op.start !== undefined && finite(op.start) && (op.start < 0 || op.start > 86400)) errors.push(`${label}: invalid start time.`);
      if (op.duration !== undefined && finite(op.duration) && (op.duration <= 0 || op.duration > 86400)) errors.push(`${label}: invalid duration.`);
      if (op.scale !== undefined && finite(op.scale) && (op.scale <= 0 || op.scale > 100)) errors.push(`${label}: invalid scale.`);
      if (op.opacity !== undefined && finite(op.opacity) && (op.opacity < 0 || op.opacity > 100)) errors.push(`${label}: invalid opacity.`);
      if (op.color !== undefined && !color(op.color)) errors.push(`${label}: color must be a hex RGB value.`);
      if (op.text !== undefined && (typeof op.text !== 'string' || op.text.length > 10000)) errors.push(`${label}: invalid text.`);
    } else if (op.type === 'delete-layer') {
      if (!text(op.layerId, 160) || op.confirm !== true) errors.push(`${label} deletion requires a layer ID and explicit confirm:true.`);
    } else if (op.type === 'set-project') {
      if (!isRecord(op.patch) || !Object.keys(op.patch).length || Object.keys(op.patch).some(key => !allowedProjectPatch.has(key))) errors.push(`${label} has an invalid project settings patch.`);
      else {
        const p = op.patch as Record<string, unknown>;
        if (p.name !== undefined && !text(p.name, 200)) errors.push(`${label}: invalid project name.`);
        for (const key of ['width','height','fps','duration']) if (p[key] !== undefined && !finite(p[key])) errors.push(`${label}: ${key} must be finite.`);
        if (finite(p.width) && (p.width < 16 || p.width > 16384) || finite(p.height) && (p.height < 16 || p.height > 16384)) errors.push(`${label}: dimensions must be between 16 and 16384.`);
        if (finite(p.fps) && (p.fps < 1 || p.fps > 240)) errors.push(`${label}: FPS must be between 1 and 240.`);
        if (finite(p.duration) && (p.duration < .1 || p.duration > 86400)) errors.push(`${label}: duration must be between 0.1 and 86400 seconds.`);
      }
    } else errors.push(`${label} uses unsupported operation type "${String(op.type)}".`);
    if (op.reason !== undefined && !text(op.reason, 500)) errors.push(`${label}: reason must be a short string.`);
  });
  if (errors.length) return { ok: false, errors };
  return { ok: true, plan: { summary: value.summary as string, operations: value.operations as AiEditOperation[], riskNotes: (value.riskNotes as string[] | undefined) ?? [] } };
}

/** Applies a fully validated plan atomically; on any conflict, the original project is left unchanged. */
export function applyAiEditPlan(project: ValidatedProject, plan: AiEditPlan): { ok: true; project: ValidatedProject; applied: number } | { ok: false; errors: string[] } {
  if (!isValidProject(project)) return { ok: false, errors: ['Current project failed validation; no edits were applied.'] };
  const next = JSON.parse(JSON.stringify(project)) as ValidatedProject;
  const errors: string[] = [];
  for (const [i, op] of plan.operations.entries()) {
    if (op.type === 'set-project') Object.assign(next, op.patch);
    else if (op.type === 'add-layer') {
      if (next.layers.length >= 10000) { errors.push('Layer limit reached.'); break; }
      const id = `ai-${Date.now().toString(36)}-${i}-${Math.random().toString(36).slice(2, 7)}`;
      const start = op.start ?? 0, duration = op.duration ?? Math.min(5, Math.max(.1, next.duration - start));
      const x = op.x ?? 0, y = op.y ?? 0, scale = op.scale ?? 1, rotation = op.rotation ?? 0, opacity = op.opacity ?? 100;
      next.layers.push({ id, name: op.name, kind: op.kind, color: op.color ?? '#a78bfa', visible: true, locked: false, start, duration, x, y, scale, rotation, opacity, text: op.kind === 'text' ? (op.text ?? op.name) : undefined, volume: 100, muted: false, effects: [], keyframes: [{ time: start, x, y, scale, rotation, opacity }] });
    } else {
      const layer = next.layers.find(item => item.id === op.layerId);
      if (!layer) { errors.push(`Operation ${i + 1}: layer "${op.layerId}" does not exist.`); break; }
      if (layer.locked) { errors.push(`Operation ${i + 1}: layer "${layer.name}" is locked. Unlock it before applying the plan.`); break; }
      if (op.type === 'delete-layer') next.layers = next.layers.filter(item => item.id !== op.layerId);
      else {
        const patch = op.patch;
        Object.assign(layer, patch);
        const transformChanged = ['x','y','scale','rotation','opacity'].some(key => key in patch);
        if (transformChanged && !('keyframes' in patch) && layer.keyframes.length === 1 && Math.abs(layer.keyframes[0].time - layer.start) < 1e-7) {
          layer.keyframes = [{ ...layer.keyframes[0], x:layer.x, y:layer.y, scale:layer.scale, rotation:layer.rotation, opacity:layer.opacity }];
        }
      }
    }
  }
  if (errors.length) return { ok: false, errors };
  if (!isValidProject(next)) return { ok: false, errors: ['The proposed changes violate project validation; nothing was applied.'] };
  return { ok: true, project: next, applied: plan.operations.length };
}
