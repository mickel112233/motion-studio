export type Easing = 'linear' | 'ease-in' | 'ease-out' | 'ease-in-out' | 'hold';

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
