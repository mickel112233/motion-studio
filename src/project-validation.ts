import type { Easing } from './animation';

export type ValidatedLayer = {
  id: string; name: string; kind: 'text' | 'shape' | 'image' | 'video' | 'audio';
  color: string; visible: boolean; locked: boolean; start: number; duration: number;
  x: number; y: number; scale: number; rotation: number; opacity: number;
  text?: string; assetUrl?: string; volume?: number; muted?: boolean; audioFadeIn?: number; audioFadeOut?: number;
  transitionIn?: { type: 'none' | 'fade' | 'wipe-left' | 'wipe-right' | 'zoom'; duration: number };
  transitionOut?: { type: 'none' | 'fade' | 'wipe-left' | 'wipe-right' | 'zoom'; duration: number };
  mask?: { type: 'none' | 'rectangle' | 'ellipse'; inset: number };
  colorGrade?: { exposure: number; contrast: number; saturation: number; temperature: number; tint: number };
  effects?: { id: string; type: 'blur' | 'brightness' | 'contrast' | 'saturate' | 'grayscale' | 'sepia' | 'hue-rotate' | 'drop-shadow'; enabled: boolean; value: number }[];
  keyframes: { time: number; x: number; y: number; scale: number; rotation: number; opacity: number; easing?: Easing }[];
};
export type ValidatedProject = {
  name: string; width: number; height: number; fps: number; duration: number; layers: ValidatedLayer[];
  schemaVersion?: number; savedAt?: string; updatedAt?: string;
};

const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

export function isValidProject(value: unknown): value is ValidatedProject {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const p = value as Record<string, unknown>;
  if (p.schemaVersion !== undefined && p.schemaVersion !== 1) return false;
  if (typeof p.name !== 'string' || !p.name.trim() || p.name.length > 200) return false;
  if (!finite(p.width) || p.width < 16 || p.width > 16384 || !finite(p.height) || p.height < 16 || p.height > 16384) return false;
  if (!finite(p.fps) || p.fps < 1 || p.fps > 240 || !finite(p.duration) || p.duration < .1 || p.duration > 86400) return false;
  if (!Array.isArray(p.layers) || p.layers.length > 10000) return false;
  const ids = new Set<string>();
  const easings = new Set(['linear', 'ease-in', 'ease-out', 'ease-in-out', 'hold']);
  for (const raw of p.layers) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return false;
    const l = raw as Record<string, unknown>;
    if (typeof l.id !== 'string' || !l.id || l.id.length > 160 || ids.has(l.id)) return false;
    ids.add(l.id);
    if (!['text', 'shape', 'image', 'video', 'audio'].includes(String(l.kind))) return false;
    if (typeof l.name !== 'string' || !l.name.trim() || l.name.length > 200) return false;
    if (typeof l.visible !== 'boolean' || typeof l.locked !== 'boolean') return false;
    if (typeof l.color !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(l.color)) return false;
    for (const key of ['start', 'duration', 'x', 'y', 'scale', 'rotation', 'opacity']) if (!finite(l[key])) return false;
    if ((l.start as number) < 0 || (l.start as number) > (p.duration as number) || (l.duration as number) <= 0 || (l.scale as number) <= 0 || (l.opacity as number) < 0 || (l.opacity as number) > 100) return false;
    if (l.text !== undefined && typeof l.text !== 'string') return false;
    if (l.assetUrl !== undefined && typeof l.assetUrl !== 'string') return false;
    if (l.volume !== undefined && (!finite(l.volume) || l.volume < 0 || l.volume > 100)) return false;
    if (l.muted !== undefined && typeof l.muted !== 'boolean') return false;
    if (l.audioFadeIn !== undefined && (!finite(l.audioFadeIn) || l.audioFadeIn < 0 || l.audioFadeIn > 30)) return false;
    if (l.audioFadeOut !== undefined && (!finite(l.audioFadeOut) || l.audioFadeOut < 0 || l.audioFadeOut > 30)) return false;
    for (const transitionKey of ['transitionIn','transitionOut']) {
      if (l[transitionKey] !== undefined) {
        const transition = l[transitionKey] as Record<string, unknown>;
        if (!transition || typeof transition !== 'object' || Array.isArray(transition) || !['none','fade','wipe-left','wipe-right','zoom'].includes(String(transition.type)) || !finite(transition.duration) || transition.duration < 0 || transition.duration > 30) return false;
      }
    }
    if (l.mask !== undefined) {
      const mask = l.mask as Record<string, unknown>;
      if (!mask || typeof mask !== 'object' || Array.isArray(mask) || !['none','rectangle','ellipse'].includes(String(mask.type)) || !finite(mask.inset) || mask.inset < 0 || mask.inset > 45) return false;
    }
    if (l.colorGrade !== undefined) {
      const grade = l.colorGrade as Record<string, unknown>;
      if (!grade || typeof grade !== 'object' || Array.isArray(grade)) return false;
      const limits: Record<string, [number,number]> = { exposure: [-4,4], contrast: [0,200], saturation: [0,200], temperature: [-100,100], tint: [-100,100] };
      for (const [key, [min,max]] of Object.entries(limits)) if (!finite(grade[key]) || (grade[key] as number) < min || (grade[key] as number) > max) return false;
    }
    if (l.effects !== undefined) {
      const effectTypes = new Set(['blur','brightness','contrast','saturate','grayscale','sepia','hue-rotate','drop-shadow']);
      const limits: Record<string, number> = { blur:40, brightness:300, contrast:300, saturate:300, grayscale:100, sepia:100, 'hue-rotate':360, 'drop-shadow':50 };
      if (!Array.isArray(l.effects) || l.effects.length > 64) return false;
      const effectIds = new Set<string>();
      for (const rawEffect of l.effects) {
        if (!rawEffect || typeof rawEffect !== 'object' || Array.isArray(rawEffect)) return false;
        const effect = rawEffect as Record<string, unknown>;
        if (typeof effect.id !== 'string' || !effect.id || effect.id.length > 160 || effectIds.has(effect.id) || typeof effect.type !== 'string' || !effectTypes.has(effect.type) || typeof effect.enabled !== 'boolean' || !finite(effect.value)) return false;
        effectIds.add(effect.id);
        if (effect.value < 0 || effect.value > limits[effect.type]) return false;
      }
    }
    if (!Array.isArray(l.keyframes) || l.keyframes.length > 10000) return false;
    for (const rawFrame of l.keyframes) {
      if (!rawFrame || typeof rawFrame !== 'object' || Array.isArray(rawFrame)) return false;
      const k = rawFrame as Record<string, unknown>;
      if (!finite(k.time) || k.time < 0 || k.time > (p.duration as number)) return false;
      for (const key of ['x', 'y', 'scale', 'rotation', 'opacity']) if (!finite(k[key])) return false;
      if ((k.scale as number) <= 0 || (k.opacity as number) < 0 || (k.opacity as number) > 100) return false;
      if (k.easing !== undefined && (typeof k.easing !== 'string' || !easings.has(k.easing))) return false;
    }
  }
  return true;
}
