export type Easing = 'linear' | 'ease-in' | 'ease-out' | 'ease-in-out' | 'hold';
export type ClipTransition = 'none' | 'fade' | 'wipe-left' | 'wipe-right' | 'zoom';
export type ClipTransitionConfig = { type: ClipTransition; duration: number };
export type ClipPresentation = { opacity: number; scale: number; clipPath?: string };

/** Deterministic clip-level transitions shared by the DOM preview and canvas export. */
export function evaluateClipPresentation(layer: { start: number; duration: number; transitionIn?: ClipTransitionConfig; transitionOut?: ClipTransitionConfig }, time: number): ClipPresentation {
  let opacity = 1, scale = 1, clipPath: string | undefined;
  const apply = (transition: ClipTransitionConfig | undefined, progress: number, outgoing: boolean) => {
    if (!transition || transition.type === 'none' || !Number.isFinite(transition.duration) || transition.duration <= 0) return;
    const p = Math.max(0, Math.min(1, progress));
    if (transition.type === 'fade') opacity *= outgoing ? 1 - p : p;
    if (transition.type === 'zoom') scale *= outgoing ? 1 + p * .2 : .8 + p * .2;
    if (transition.type === 'wipe-left') clipPath = outgoing ? `inset(0 ${p * 100}% 0 0)` : `inset(0 ${(1 - p) * 100}% 0 0)`;
    if (transition.type === 'wipe-right') clipPath = outgoing ? `inset(0 0 0 ${p * 100}%)` : `inset(0 0 0 ${(1 - p) * 100}%)`;
  };
  const intro = layer.transitionIn;
  if (intro && intro.duration > 0 && time < layer.start + intro.duration) apply(intro, (time - layer.start) / intro.duration, false);
  const outro = layer.transitionOut;
  const end = layer.start + layer.duration;
  if (outro && outro.duration > 0 && time > end - outro.duration) apply(outro, (time - (end - outro.duration)) / outro.duration, true);
  return { opacity: Math.max(0, Math.min(1, opacity)), scale, clipPath };
}

export type Transform = {
  x: number;
  y: number;
  scale: number;
  rotation: number;
  opacity: number;
};

export type TransformKeyframe = Transform & {
  time: number;
  easing?: Easing;
};

export type AnimatableLayer = Transform & {
  start: number;
  duration: number;
  keyframes?: TransformKeyframe[];
};

const PROPERTIES: (keyof Transform)[] = ['x', 'y', 'scale', 'rotation', 'opacity'];

function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

export function applyEasing(progress: number, easing: Easing = 'linear'): number {
  const t = Math.max(0, Math.min(1, progress));
  switch (easing) {
    case 'hold': return 0;
    case 'ease-in': return t * t;
    case 'ease-out': return 1 - (1 - t) * (1 - t);
    case 'ease-in-out': return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
    default: return t;
  }
}

export function normalizeKeyframes<T extends TransformKeyframe>(keyframes: T[] | undefined): T[] {
  if (!Array.isArray(keyframes)) return [];
  const byTime = new Map<number, T>();
  for (const frame of keyframes) {
    if (!frame || typeof frame !== 'object' || !Number.isFinite(frame.time) || frame.time < 0) continue;
    const next = { ...frame } as T;
    for (const prop of PROPERTIES) {
      const fallback = prop === 'scale' ? 1 : prop === 'opacity' ? 100 : 0;
      (next as unknown as Transform)[prop] = finite(frame[prop], fallback);
    }
    byTime.set(frame.time, next);
  }
  return [...byTime.values()].sort((a, b) => a.time - b.time);
}

export function evaluateTransform<T extends AnimatableLayer>(layer: T, time: number): Transform {
  const base: Transform = {
    x: finite(layer.x, 0), y: finite(layer.y, 0), scale: finite(layer.scale, 1),
    rotation: finite(layer.rotation, 0), opacity: finite(layer.opacity, 100)
  };
  const frames = normalizeKeyframes(layer.keyframes);
  if (!frames.length) return base;
  if (frames.length === 1) {
    const frame = frames[0];
    if (time < frame.time) return base;
    return { x: frame.x, y: frame.y, scale: frame.scale, rotation: frame.rotation, opacity: frame.opacity };
  }
  if (time < frames[0].time) return base;
  if (time === frames[0].time) {
    const first = frames[0];
    return { x:first.x, y:first.y, scale:first.scale, rotation:first.rotation, opacity:first.opacity };
  }
  const last = frames[frames.length - 1];
  if (time >= last.time) return { x:last.x, y:last.y, scale:last.scale, rotation:last.rotation, opacity:last.opacity };
  let left = frames[0];
  let right = frames[1];
  for (let i = 1; i < frames.length; i++) {
    if (frames[i].time >= time) { left = frames[i - 1]; right = frames[i]; break; }
  }
  const span = right.time - left.time;
  if (span <= 0) return { x:right.x, y:right.y, scale:right.scale, rotation:right.rotation, opacity:right.opacity };
  const t = applyEasing((time - left.time) / span, left.easing || 'linear');
  const out = {} as Transform;
  for (const prop of PROPERTIES) out[prop] = left[prop] + (right[prop] - left[prop]) * t;
  return out;
}

export function isLayerActive(layer: Pick<AnimatableLayer, 'start' | 'duration'>, time: number): boolean {
  return Number.isFinite(time) && time >= layer.start && time < layer.start + layer.duration;
}
