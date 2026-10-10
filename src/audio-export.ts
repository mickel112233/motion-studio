import type { RenderLayer } from './compositor';

export function normalizeAudioFades(duration: number, fadeIn = 0, fadeOut = 0): { fadeIn: number; fadeOut: number } {
  const safeDuration = Number.isFinite(duration) ? Math.max(0, duration) : 0;
  let inTime = Number.isFinite(fadeIn) ? Math.max(0, Math.min(safeDuration, fadeIn)) : 0;
  let outTime = Number.isFinite(fadeOut) ? Math.max(0, Math.min(safeDuration, fadeOut)) : 0;
  const total = inTime + outTime;
  if (total > safeDuration && total > 0) { const factor = safeDuration / total; inTime *= factor; outTime *= factor; }
  return { fadeIn: inTime, fadeOut: outTime };
}

export type AudioExportSession = {
  stream: MediaStream;
  start: () => void;
  dispose: () => Promise<void>;
};

function waitUntilPlayable(audio: HTMLAudioElement): Promise<void> {
  if (audio.readyState >= 2) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => { cleanup(); reject(new Error('Timed out loading audio clip')); }, 15000);
    const cleanup = () => {
      window.clearTimeout(timer);
      audio.removeEventListener('canplay', ready);
      audio.removeEventListener('error', failed);
    };
    const ready = () => { cleanup(); resolve(); };
    const failed = () => { cleanup(); reject(new Error('Could not decode audio clip')); };
    audio.addEventListener('canplay', ready, { once: true });
    audio.addEventListener('error', failed, { once: true });
    audio.load();
  });
}

export async function createAudioExportSession(layers: RenderLayer[]): Promise<AudioExportSession | undefined> {
  const clips = layers.filter(layer => (layer.kind === 'audio' || layer.kind === 'video') && layer.visible && layer.assetUrl && !layer.muted && (layer.volume ?? 100) > 0);
  if (!clips.length) return undefined;
  const context = new AudioContext();
  const destination = context.createMediaStreamDestination();
  const entries: { audio: HTMLAudioElement; layer: RenderLayer; gain: GainNode }[] = [];
  const timers: number[] = [];
  try {
    for (const layer of clips) {
      const audio = document.createElement('audio');
      audio.preload = 'auto';
      audio.src = layer.assetUrl!;
      try {
        await waitUntilPlayable(audio);
        const source = context.createMediaElementSource(audio);
        const gain = context.createGain();
        gain.gain.value = Math.max(0, Math.min(1, (layer.volume ?? 100) / 100));
        source.connect(gain);
        gain.connect(destination);
        entries.push({ audio, layer, gain });
      } catch (error) {
        audio.pause(); audio.removeAttribute('src'); audio.load();
        if (layer.kind === 'video') continue;
        throw new Error('Audio clip "' + layer.name + '": ' + (error instanceof Error ? error.message : 'unsupported media'));
      }
    }
    if (!entries.length) {
      destination.stream.getTracks().forEach(track => track.stop());
      await context.close().catch(() => {});
      return undefined;
    }
    await context.resume();
    return {
      stream: destination.stream,
      start: () => {
        for (const entry of entries) {
          const volume = Math.max(0, Math.min(1, (entry.layer.volume ?? 100) / 100));
          const fades = normalizeAudioFades(entry.layer.duration, entry.layer.audioFadeIn ?? 0, entry.layer.audioFadeOut ?? 0);
          const when = context.currentTime + Math.max(0, entry.layer.start);
          entry.gain.gain.cancelScheduledValues(when);
          entry.gain.gain.setValueAtTime(fades.fadeIn > 0 ? 0 : volume, when);
          if (fades.fadeIn > 0) entry.gain.gain.linearRampToValueAtTime(volume, when + fades.fadeIn);
          if (fades.fadeOut > 0) {
            entry.gain.gain.setValueAtTime(volume, when + Math.max(0, entry.layer.duration - fades.fadeOut));
            entry.gain.gain.linearRampToValueAtTime(0, when + Math.max(0, entry.layer.duration));
          }
          const startTimer = window.setTimeout(() => {
            entry.audio.currentTime = 0;
            void entry.audio.play().catch(() => {});
            const stopTimer = window.setTimeout(() => entry.audio.pause(), Math.max(0, entry.layer.duration) * 1000);
            timers.push(stopTimer);
          }, Math.max(0, entry.layer.start) * 1000);
          timers.push(startTimer);
        }
      },
      dispose: async () => {
        timers.forEach(timer => window.clearTimeout(timer));
        entries.forEach(({ audio }) => { audio.pause(); audio.removeAttribute('src'); audio.load(); });
        destination.stream.getTracks().forEach(track => track.stop());
        await context.close().catch(() => {});
      }
    };
  } catch (error) {
    entries.forEach(({ audio }) => { audio.pause(); audio.removeAttribute('src'); audio.load(); });
    destination.stream.getTracks().forEach(track => track.stop());
    await context.close().catch(() => {});
    const message = error instanceof Error ? error.message : 'Unknown audio error';
    throw new Error('Could not prepare audio for export: ' + message);
  }
}
