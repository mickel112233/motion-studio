import type { RenderLayer } from './compositor';

export type AudioExportSession = {
  stream: MediaStream;
  start: () => void;
  dispose: () => Promise<void>;
};

function waitUntilPlayable(audio: HTMLAudioElement): Promise<void> {
  if (audio.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) return Promise.resolve();
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
  const clips = layers.filter(layer => layer.kind === 'audio' && layer.visible && layer.assetUrl && !layer.muted && (layer.volume ?? 100) > 0);
  if (!clips.length) return undefined;
  const context = new AudioContext();
  const destination = context.createMediaStreamDestination();
  const entries: { audio: HTMLAudioElement; layer: RenderLayer }[] = [];
  const timers: number[] = [];
  try {
    for (const layer of clips) {
      const audio = document.createElement('audio');
      audio.preload = 'auto';
      audio.src = layer.assetUrl!;
      await waitUntilPlayable(audio);
      const source = context.createMediaElementSource(audio);
      const gain = context.createGain();
      gain.gain.value = Math.max(0, Math.min(1, (layer.volume ?? 100) / 100));
      source.connect(gain);
      gain.connect(destination);
      entries.push({ audio, layer });
    }
    await context.resume();
    return {
      stream: destination.stream,
      start: () => {
        for (const entry of entries) {
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
