import { evaluateTransform, isLayerActive, evaluateClipPresentation } from './animation';

export type RenderLayer = {
  id: string; name: string; kind: 'text' | 'shape' | 'image' | 'video' | 'audio';
  color: string; visible: boolean; start: number; duration: number;
  x: number; y: number; scale: number; rotation: number; opacity: number;
  text?: string; assetUrl?: string; volume?: number; muted?: boolean; audioFadeIn?: number; audioFadeOut?: number; effects?: { id: string; type: 'blur' | 'brightness' | 'contrast' | 'saturate' | 'grayscale' | 'sepia' | 'hue-rotate' | 'drop-shadow'; enabled: boolean; value: number }[];
  transitionIn?: { type: 'none' | 'fade' | 'wipe-left' | 'wipe-right' | 'zoom'; duration: number };
  transitionOut?: { type: 'none' | 'fade' | 'wipe-left' | 'wipe-right' | 'zoom'; duration: number };
  mask?: { type: 'none' | 'rectangle' | 'ellipse'; inset: number };
  colorGrade?: { exposure: number; contrast: number; saturation: number; temperature: number; tint: number };
  keyframes?: { time: number; x: number; y: number; scale: number; rotation: number; opacity: number; easing?: 'linear' | 'ease-in' | 'ease-out' | 'ease-in-out' | 'hold' }[];
};
export type RenderProject = { name: string; width: number; height: number; fps: number; duration: number; layers: RenderLayer[] };

export function cssEffectFilter(effects: RenderLayer['effects'], shadowColor = '#a78bfa', grade?: RenderLayer['colorGrade']): string {
  const filters: string[] = [];
  if (grade) {
    filters.push(`brightness(${Math.max(6.25, Math.min(1600, 100 * Math.pow(2, grade.exposure)))}%)`);
    filters.push(`contrast(${Math.max(0, Math.min(200, grade.contrast))}%)`);
    filters.push(`saturate(${Math.max(0, Math.min(200, grade.saturation))}%)`);
    if (grade.temperature > 0) filters.push(`sepia(${Math.min(50, grade.temperature * .5)}%)`);
    if (grade.temperature < 0) filters.push(`hue-rotate(${Math.min(18, Math.round(Math.abs(grade.temperature) * .18 * 10) / 10)}deg)`);
    if (grade.tint) filters.push(`hue-rotate(${Math.max(-18, Math.min(18, Math.round(grade.tint * .18 * 10) / 10))}deg)`);
  }
  if (!effects?.length) return filters.join(' ') || 'none';
  filters.push(...effects.filter(effect => effect.enabled && Number.isFinite(effect.value)).map(effect => {
    const v = Math.max(0, effect.value);
    switch (effect.type) {
      case 'blur': return `blur(${Math.min(40, v)}px)`;
      case 'brightness': return `brightness(${Math.min(300, v)}%)`;
      case 'contrast': return `contrast(${Math.min(300, v)}%)`;
      case 'saturate': return `saturate(${Math.min(300, v)}%)`;
      case 'grayscale': return `grayscale(${Math.min(100, v)}%)`;
      case 'sepia': return `sepia(${Math.min(100, v)}%)`;
      case 'hue-rotate': return `hue-rotate(${Math.min(360, v)}deg)`;
      case 'drop-shadow': return `drop-shadow(0 0 ${Math.min(50, v)}px ${shadowColor})`;
      default: return '';
    }
  }).filter(Boolean));
  return filters.join(' ') || 'none';
}

const assets = new Map<string, HTMLImageElement | HTMLVideoElement>();

async function getAsset(layer: RenderLayer): Promise<HTMLImageElement | HTMLVideoElement | undefined> {
  if (!layer.assetUrl) return undefined;
  const cached = assets.get(layer.assetUrl);
  if (cached) {
    if (cached instanceof HTMLVideoElement && cached.readyState < 2) await waitEvent(cached, 'loadeddata');
    if (cached instanceof HTMLImageElement && !cached.complete) await waitEvent(cached, 'load');
    return cached;
  }
  if (layer.kind === 'image') {
    const img = new Image();
    img.decoding = 'async';
    img.src = layer.assetUrl;
    assets.set(layer.assetUrl, img);
    if (typeof img.decode === 'function') await img.decode().catch(() => undefined);
    else if (!img.complete) await waitEvent(img, 'load');
    return img.naturalWidth > 0 ? img : undefined;
  }
  if (layer.kind === 'video') {
    const video = document.createElement('video');
    video.preload = 'auto'; video.muted = true; video.playsInline = true;
    video.src = layer.assetUrl;
    assets.set(layer.assetUrl, video);
    video.load();
    if (video.readyState < 2) await waitEvent(video, 'loadeddata');
    return video.videoWidth > 0 ? video : undefined;
  }
  return undefined;
}

function waitEvent(target: EventTarget, event: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => { cleanup(); reject(new Error('Timed out loading media asset')); }, 10000);
    const cleanup = () => { window.clearTimeout(timer); target.removeEventListener(event, done); target.removeEventListener('error', fail); };
    const done = () => { cleanup(); resolve(); };
    const fail = () => { cleanup(); reject(new Error('Could not load media asset')); };
    target.addEventListener(event, done, { once: true });
    target.addEventListener('error', fail, { once: true });
  });
}

async function seekVideo(video: HTMLVideoElement, seconds: number): Promise<void> {
  if (!Number.isFinite(video.duration) || video.duration <= 0) return;
  const target = Math.max(0, Math.min(video.duration - 0.001, seconds % video.duration));
  if (Math.abs(video.currentTime - target) < 1 / 120 && video.readyState >= 2) return;
  const seeked = waitEvent(video, 'seeked');
  video.currentTime = target;
  await seeked;
}

export async function drawComposition(canvas: HTMLCanvasElement, project: RenderProject, time: number): Promise<void> {
  if (canvas.width !== project.width) canvas.width = project.width;
  if (canvas.height !== project.height) canvas.height = project.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D rendering is unavailable');
  ctx.clearRect(0, 0, project.width, project.height);
  const bg = ctx.createLinearGradient(0, 0, project.width, project.height);
  bg.addColorStop(0, '#151521'); bg.addColorStop(.55, '#24213a'); bg.addColorStop(1, '#151521');
  ctx.fillStyle = bg; ctx.fillRect(0, 0, project.width, project.height);
  const glow = ctx.createRadialGradient(project.width * .78, project.height * .28, 0, project.width * .78, project.height * .28, project.width * .42);
  glow.addColorStop(0, '#3b2c61'); glow.addColorStop(1, '#3b2c6100');
  ctx.fillStyle = glow; ctx.fillRect(0, 0, project.width, project.height);

  for (const layer of project.layers) {
    if (!layer.visible || !isLayerActive(layer, time) || layer.kind === 'audio') continue;
    const transform = evaluateTransform(layer, time);
    const presentation = evaluateClipPresentation(layer, time);
    ctx.save();
    ctx.globalAlpha = Math.max(0, Math.min(1, transform.opacity / 100)) * presentation.opacity;
    ctx.filter = cssEffectFilter(layer.effects, layer.color, layer.colorGrade);
    ctx.translate(project.width / 2 + transform.x, project.height / 2 + transform.y);
    ctx.rotate(transform.rotation * Math.PI / 180);
    ctx.scale(transform.scale * presentation.scale, transform.scale * presentation.scale);
    if (layer.mask?.type === 'rectangle') { const inset = layer.mask.inset / 100; ctx.beginPath(); ctx.rect(-project.width * (0.45 - inset), -project.height * (0.4 - inset), project.width * (0.9 - 2 * inset), project.height * (0.8 - 2 * inset)); ctx.clip(); }
    if (layer.mask?.type === 'ellipse') { const inset = layer.mask.inset / 100; ctx.beginPath(); ctx.ellipse(0, 0, project.width * (0.45 - inset), project.height * (0.4 - inset), 0, 0, Math.PI * 2); ctx.clip(); }
    if (presentation.clipPath) {
      const leftWipe = /^inset\(0 ([\d.]+)% 0 0\)$/.exec(presentation.clipPath);
      const rightWipe = /^inset\(0 0 0 ([\d.]+)%\)$/.exec(presentation.clipPath);
      if (leftWipe || rightWipe) {
        const hidden = Number((leftWipe ?? rightWipe)![1]) / 100;
        ctx.beginPath();
        if (leftWipe) ctx.rect(-project.width / 2, -project.height / 2, project.width * (1 - hidden), project.height);
        else ctx.rect(-project.width / 2 + project.width * hidden, -project.height / 2, project.width * (1 - hidden), project.height);
        ctx.clip();
      }
    }
    if (layer.kind === 'text') {
      ctx.fillStyle = '#f4f2ff'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.font = '700 106px "DM Sans", sans-serif';
      const lines = (layer.text ?? layer.name).split('\n');
      lines.forEach((line, i) => ctx.fillText(line, 0, (i - (lines.length - 1) / 2) * 120, project.width * .8));
    } else if (layer.kind === 'shape') {
      ctx.fillStyle = layer.color; ctx.shadowColor = layer.color + '88'; ctx.shadowBlur = 35;
      ctx.beginPath(); ctx.roundRect(-135, -135, 270, 270, 35); ctx.fill();
    } else if ((layer.kind === 'image' || layer.kind === 'video') && layer.assetUrl) {
      try {
        const media = await getAsset(layer);
        if (media instanceof HTMLVideoElement) await seekVideo(media, Math.max(0, time - layer.start));
        if (media) {
          const width = media instanceof HTMLVideoElement ? media.videoWidth : media.naturalWidth;
          const height = media instanceof HTMLVideoElement ? media.videoHeight : media.naturalHeight;
          if (width > 0 && height > 0) {
            const fit = Math.min(project.width * .65 / width, project.height * .7 / height);
            ctx.drawImage(media, -width * fit / 2, -height * fit / 2, width * fit, height * fit);
          }
        }
      } catch { /* Missing or unsupported media is skipped; other layers still render. */ }
    }
    ctx.restore();
  }
}
