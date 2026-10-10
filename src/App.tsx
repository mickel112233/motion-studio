import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { evaluateTransform, isLayerActive, type Easing } from './animation';
import { cssEffectFilter, drawComposition } from './compositor';
import { createAudioExportSession, type AudioExportSession } from './audio-export';
import { isValidProject } from './project-validation';
import {
  Activity, AlignCenter, Aperture, AudioLines, Bot, Box, ChevronDown, ChevronRight,
  CircleHelp, Clapperboard, Clock3, Command, Copy, Download, Eye, EyeOff,
  FilePlus2, Film, FolderOpen, Gauge, Grid2X2, Image, Layers3, Magnet, Maximize2,
  MoreHorizontal, MousePointer2, Move, Pause, Play, Plus, Redo2, Save, Scissors,
  Settings2, Shapes, Sparkles, Square, Type, Undo2, Upload, Volume2, WandSparkles,
  ZoomIn, ZoomOut
} from 'lucide-react';

type LayerKind = 'text' | 'shape' | 'image' | 'video' | 'audio';
type EffectType = 'blur' | 'brightness' | 'contrast' | 'saturate' | 'grayscale' | 'sepia' | 'hue-rotate' | 'drop-shadow';
type LayerEffect = { id: string; type: EffectType; enabled: boolean; value: number };
type Layer = {
  id: string; name: string; kind: LayerKind; color: string; visible: boolean;
  locked: boolean; start: number; duration: number; x: number; y: number;
  scale: number; rotation: number; opacity: number; text?: string; assetUrl?: string; effects?: LayerEffect[]; volume?: number; muted?: boolean;
  keyframes: { time: number; x: number; y: number; scale: number; rotation: number; opacity: number; easing?: Easing }[];
};
type Project = { name: string; width: number; height: number; fps: number; duration: number; layers: Layer[] };
const uid = () => Math.random().toString(36).slice(2, 10);
const colors = ['#a78bfa', '#5eead4', '#fbbf24', '#fb7185', '#60a5fa', '#c084fc'];
const effectDefaults: Record<EffectType, { min: number; max: number; initial: number; unit: string; label: string }> = {
  blur: { min: 0, max: 40, initial: 8, unit: 'px', label: 'Gaussian blur' },
  brightness: { min: 0, max: 300, initial: 120, unit: '%', label: 'Brightness' },
  contrast: { min: 0, max: 300, initial: 110, unit: '%', label: 'Contrast' },
  saturate: { min: 0, max: 300, initial: 125, unit: '%', label: 'Saturation' },
  grayscale: { min: 0, max: 100, initial: 100, unit: '%', label: 'Grayscale' },
  sepia: { min: 0, max: 100, initial: 80, unit: '%', label: 'Sepia' },
  'hue-rotate': { min: 0, max: 360, initial: 180, unit: '°', label: 'Hue rotation' },
  'drop-shadow': { min: 0, max: 50, initial: 18, unit: 'px', label: 'Drop shadow' }
};

const initialLayer = (kind: LayerKind, name: string, index: number): Layer => ({
  id: uid(), name, kind, color: colors[index % colors.length], visible: true, locked: false,
  start: 0, duration: 8, x: 0, y: 0, scale: 1, rotation: 0, opacity: 100,
  text: kind === 'text' ? 'Your next big idea.' : undefined, effects: [], volume: 100, muted: false,
  keyframes: [{ time: 0, x: 0, y: 0, scale: 1, rotation: 0, opacity: 100 }]
});
const upsertKeyframe = (layer: Layer, time: number, transformPatch: Partial<Pick<Layer, 'x' | 'y' | 'scale' | 'rotation' | 'opacity'>> = {}, easing?: Easing) => {
  const transform = { ...evaluateTransform(layer, time), ...transformPatch };
  const existing = layer.keyframes.find(k => Math.abs(k.time - time) < 1e-7);
  const frame = { time, ...transform, easing: easing ?? existing?.easing ?? ('linear' as Easing) };
  return [...layer.keyframes.filter(k => Math.abs(k.time - time) >= 1e-7), frame].sort((a,b) => a.time - b.time);
};
const initialProject: Project = {
  name: 'Untitled Composition', width: 1920, height: 1080, fps: 30, duration: 12,
  layers: [
    { ...initialLayer('shape', 'Accent shape', 0), x: 250, y: 40, scale: 1.15, duration: 8, keyframes: [{ time: 0, x: 250, y: 40, scale: 1.15, rotation: 0, opacity: 100 }] },
    { ...initialLayer('text', 'Title · Main', 1), x: 0, y: 0, duration: 8 },
    { ...initialLayer('text', 'Subtitle', 2), text: 'MOTION, MADE YOURS', x: 0, y: 90, scale: .48, duration: 8, keyframes: [{ time: 0, x: 0, y: 90, scale: .48, rotation: 0, opacity: 100 }] }
  ]
};
const fmt = (t: number, fps = 30) => { const safe = Math.max(0, t); const m = Math.floor(safe / 60); const s = Math.floor(safe % 60); const f = Math.floor((safe % 1) * fps); return `${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}:${String(f).padStart(2,'0')}`; };

export default function App() {
  const [project, setProject] = useState<Project>(initialProject);
  const latestProjectRef = useRef(project);
  latestProjectRef.current = project;
  const autosavePromiseRef = useRef<Promise<{ saved: boolean; recovery?: boolean; conflict?: boolean; filePath?: string; data?: unknown }> | null>(null);
  const [selected, setSelected] = useState(project.layers[1]?.id ?? '');
  const [currentTime, setCurrentTime] = useState(1.25);
  const [playing, setPlaying] = useState(false);
  const [exportingVideo, setExportingVideo] = useState(false);
  const [exportProgress, setExportProgress] = useState(0);
  const [externalConflict, setExternalConflict] = useState(false);
  const [isDirty, setIsDirty] = useState(false);
  const [panel, setPanel] = useState<'project' | 'effects' | 'audio' | 'agents'>('project');
  const [tool, setTool] = useState<'select' | 'move' | 'text' | 'shape'>('select');
  const [zoom, setZoom] = useState(1);
  const [showGrid, setShowGrid] = useState(false);
  const [snap, setSnap] = useState(true);
  const [status, setStatus] = useState('All changes saved');
  const [history, setHistory] = useState<Project[]>([]);
  const [future, setFuture] = useState<Project[]>([]);
  const [activeTab, setActiveTab] = useState<'timeline' | 'graph'>('timeline');
  const fileInput = useRef<HTMLInputElement>(null);
  const exportCancelRef = useRef(false);
  const timelineDragRef = useRef<{ id: string; startX: number; originalStart: number; previewStart: number; originalDuration: number; previewDuration: number; trackWidth: number; pointerId: number; mode: 'move' | 'trim-start' | 'trim-end' } | null>(null);
  const scrubbingRef = useRef(false);
  const [dragPreview, setDragPreview] = useState<{ id: string; start: number; duration: number } | null>(null);
  const selectedLayer = project.layers.find(l => l.id === selected) ?? project.layers[0];
  const selectedTransform = selectedLayer ? evaluateTransform(selectedLayer, currentTime) : undefined;
  const selectedKeyframe = selectedLayer?.keyframes.find(k => Math.abs(k.time - currentTime) < (1 / project.fps) / 2);

  const updateLayer = useCallback((id: string, patch: Partial<Layer>) => {
    setHistory(h => [...h.slice(-39), project]); setFuture([]);
    setProject(p => ({ ...p, layers: p.layers.map(l => {
      if (l.id !== id) return l;
      const next = { ...l, ...patch };
      const transformChanged = ['x','y','scale','rotation','opacity'].some(key => key in patch);
      if (!('keyframes' in patch) && transformChanged && l.keyframes.length === 1 && Math.abs(l.keyframes[0].time - l.start) < 1e-7) {
        next.keyframes = [{ ...l.keyframes[0], x:next.x, y:next.y, scale:next.scale, rotation:next.rotation, opacity:next.opacity }];
      }
      return next;
    }) }));
    setIsDirty(true); setStatus('Unsaved changes');
  }, [project]);
  const updateProject = (updater: (value: Project) => Project) => {
    setHistory(h => [...h.slice(-39), project]); setFuture([]);
    setProject(updater(project)); setIsDirty(true); setStatus('Unsaved changes');
  };
  const updateScrubTime = (event: ReactPointerEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    if (rect.width <= 0) return;
    const ratio = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
    setCurrentTime(Math.round(ratio * project.duration * project.fps) / project.fps);
  };
  const beginScrub = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId);
    scrubbingRef.current = true; setPlaying(false); updateScrubTime(event);
  };
  const moveScrub = (event: ReactPointerEvent<HTMLDivElement>) => { if (scrubbingRef.current) updateScrubTime(event); };
  const finishScrub = () => { scrubbingRef.current = false; };
  const beginTimelineDrag = (event: ReactPointerEvent<HTMLDivElement>, layer: Layer, mode: 'move' | 'trim-start' | 'trim-end' = 'move') => {
    if (layer.locked) return;
    const trackWidth = event.currentTarget.closest('.track')?.getBoundingClientRect().width ?? 0;
    if (trackWidth <= 0) return;
    event.preventDefault(); event.stopPropagation(); event.currentTarget.setPointerCapture(event.pointerId);
    timelineDragRef.current = { id: layer.id, startX: event.clientX, originalStart: layer.start, previewStart: layer.start, originalDuration: layer.duration, previewDuration: layer.duration, trackWidth, pointerId: event.pointerId, mode };
    setSelected(layer.id); setDragPreview({ id: layer.id, start: layer.start, duration: layer.duration });
  };
  const moveTimelineDrag = (event: ReactPointerEvent<HTMLDivElement>, layer: Layer) => {
    const drag = timelineDragRef.current;
    if (!drag || drag.id !== layer.id || drag.pointerId !== event.pointerId) return;
    const delta = ((event.clientX - drag.startX) / drag.trackWidth) * project.duration;
    const minDuration = 1 / project.fps;
    if (drag.mode === 'move') {
      const maxStart = Math.max(0, project.duration - drag.originalDuration);
      drag.previewStart = Math.max(0, Math.min(maxStart, Math.round((drag.originalStart + delta) * project.fps) / project.fps));
      drag.previewDuration = drag.originalDuration;
    } else if (drag.mode === 'trim-start') {
      const end = drag.originalStart + drag.originalDuration;
      const maxStart = Math.max(0, Math.min(end - minDuration, project.duration - minDuration));
      drag.previewStart = Math.max(0, Math.min(maxStart, Math.round((drag.originalStart + delta) * project.fps) / project.fps));
      drag.previewDuration = Math.max(minDuration, end - drag.previewStart);
    } else {
      drag.previewStart = drag.originalStart;
      drag.previewDuration = Math.max(minDuration, Math.min(project.duration - drag.originalStart, Math.round((drag.originalDuration + delta) * project.fps) / project.fps));
    }
    setDragPreview({ id: layer.id, start: drag.previewStart, duration: drag.previewDuration });
  };
  const finishTimelineDrag = (event: ReactPointerEvent<HTMLDivElement>, layer: Layer) => {
    const drag = timelineDragRef.current;
    if (!drag || drag.id !== layer.id || drag.pointerId !== event.pointerId) return;
    timelineDragRef.current = null; setDragPreview(null);
    if (drag.mode === 'trim-start') {
      if (Math.abs(drag.previewStart - drag.originalStart) >= 1 / project.fps / 2) updateLayer(layer.id, { start: drag.previewStart, duration: drag.previewDuration });
      return;
    }
    if (drag.mode === 'trim-end') {
      if (Math.abs(drag.previewDuration - drag.originalDuration) >= 1 / project.fps / 2) updateLayer(layer.id, { duration: drag.previewDuration });
      return;
    }
    const delta = drag.previewStart - drag.originalStart;
    if (Math.abs(delta) < 1 / project.fps / 2) return;
    const nextFrames = layer.keyframes.map(frame => ({ ...frame, time: Math.max(0, Math.min(project.duration, frame.time + delta)) })).sort((a,b) => a.time-b.time);
    updateLayer(layer.id, { start: drag.previewStart, keyframes: nextFrames });
  };
  const editTransformAtPlayhead = (layer: Layer, patch: Partial<Pick<Layer, 'x' | 'y' | 'scale' | 'rotation' | 'opacity'>>) => {
    const atKeyframe = layer.keyframes.some(k => Math.abs(k.time - currentTime) < (1 / project.fps) / 2);
    if (layer.keyframes.length > 1 || atKeyframe) updateLayer(layer.id, { keyframes: upsertKeyframe(layer, currentTime, patch) });
    else updateLayer(layer.id, patch);
  };
  const addLayer = (kind: LayerKind) => {
    const name = kind === 'text' ? 'Text layer' : kind === 'shape' ? 'Shape layer' : kind === 'audio' ? 'Audio layer' : kind === 'video' ? 'Video layer' : 'Image layer';
    const layer = initialLayer(kind, name, project.layers.length);
    setHistory(h => [...h.slice(-39), project]); setFuture([]);
    setProject(p => ({ ...p, layers: [...p.layers, layer] })); setSelected(layer.id); setIsDirty(true); setStatus('Unsaved changes');
  };
  const undo = () => {
    if (!history.length) return;
    setFuture(f => [project, ...f]); setProject(history[history.length - 1]); setHistory(h => h.slice(0, -1)); setIsDirty(true); setStatus('Undo');
  };
  const redo = () => {
    if (!future.length) return;
    setHistory(h => [...h, project]); setProject(future[0]); setFuture(f => f.slice(1)); setIsDirty(true); setStatus('Redo');
  };
  useEffect(() => {
    if (!playing) return;
    const id = window.setInterval(() => setCurrentTime(t => t >= project.duration ? 0 : t + 1 / project.fps), 1000 / project.fps);
    return () => window.clearInterval(id);
  }, [playing, project.duration, project.fps]);
  useEffect(() => {
    const api = window.motionStudio;
    if (!api) return;
    let cancelled = false;
    void api.getRecoveryProject().then(result => {
      if (cancelled || !result.available || !result.data) return;
      if (!isValidProject(result.data)) { void api.discardRecoveryProject(); return; }
      const when = result.modifiedAt ? new Date(result.modifiedAt).toLocaleString() : 'an earlier session';
      if (window.confirm(`A recovery snapshot from ${when} was found. Restore it? Choose Cancel to discard the recovery snapshot.`)) {
        setProject(result.data); setSelected(result.data.layers[0]?.id ?? ''); setCurrentTime(0); setIsDirty(true); setExternalConflict(false); setStatus('Recovered unsaved project — save to choose a location');
      } else {
        void api.discardRecoveryProject();
      }
    }).catch(() => {});
    return () => { cancelled = true; };
  }, []);
  useEffect(() => {
    const api = window.motionStudio;
    if (!api || !isDirty || externalConflict) return;
    const sourceProject = project;
    const snapshot = { ...project, schemaVersion: 1, autosavedAt: new Date().toISOString() };
    const timer = window.setTimeout(() => {
      const task = api.autosaveProject(snapshot);
      autosavePromiseRef.current = task;
      void task.then(result => {
        if (result.conflict) { setExternalConflict(true); setStatus('External edits detected — resolve conflict before saving'); return; }
        if (result.saved && latestProjectRef.current === sourceProject) {
          if (!result.recovery) setIsDirty(false);
          setStatus(result.recovery ? 'Recovery snapshot saved' : 'Autosaved');
        }
      }).catch(() => {
        if (latestProjectRef.current === sourceProject) setStatus('Autosave failed — use Save to keep your changes');
      }).finally(() => {
        if (autosavePromiseRef.current === task) autosavePromiseRef.current = null;
      });
    }, 1400);
    return () => window.clearTimeout(timer);
  }, [project, isDirty, externalConflict]);
  useEffect(() => {
    if (!window.motionStudio?.onProjectExternalChange) return;
    return window.motionStudio.onProjectExternalChange(payload => {
      if (payload.error) { setStatus(payload.error); return; }
      if (!payload.data || !isValidProject(payload.data)) { setStatus('An external project edit could not be validated'); return; }
      if ((isDirty || externalConflict) && !window.confirm('An external agent changed this project on disk. Reload and discard your unsaved editor changes? Choose Cancel to keep your local edits and resolve the conflict manually.')) {
        setExternalConflict(true);
        setStatus('External edits detected — resolve conflict before saving');
        return;
      }
      setProject(payload.data); setSelected(payload.data.layers[0]?.id ?? ''); setCurrentTime(0);
      setHistory([]); setFuture([]); setExternalConflict(false); setIsDirty(false); setStatus('Synced external agent changes');
    });
  }, [isDirty, externalConflict]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target;
      const editingText = target instanceof HTMLElement && (target.isContentEditable || ['INPUT','TEXTAREA','SELECT'].includes(target.tagName));
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); void save(); return; }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !editingText) { e.preventDefault(); undo(); return; }
      if (editingText || e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.code === 'Space') { e.preventDefault(); setPlaying(v => !v); }
      if (e.key.toLowerCase() === 'v') setTool('select');
      if (e.key.toLowerCase() === 'm') setTool('move');
      if (e.key.toLowerCase() === 't') { setTool('text'); addLayer('text'); }
      if (e.key.toLowerCase() === 'r') { setTool('shape'); addLayer('shape'); }
      if (e.key === 'Delete' && selectedLayer && !selectedLayer.locked) {
        updateProject(p => ({ ...p, layers: p.layers.filter(l => l.id !== selected) })); setSelected('');
      }
    };
    window.addEventListener('keydown', onKey); return () => window.removeEventListener('keydown', onKey);
  });
  const save = async () => {
    if (autosavePromiseRef.current) await autosavePromiseRef.current.catch(() => undefined);
    if (externalConflict) { setStatus('External changes conflict — use Open to reload or Save As to preserve your local version'); return; }
    const data = { ...latestProjectRef.current, savedAt: new Date().toISOString(), schemaVersion: 1 };
    if (window.motionStudio) {
      try { const result = await window.motionStudio.saveProject(data); if (result.conflict) { setExternalConflict(true); setStatus('External edits detected — use Open to reload or Save As to preserve your local version'); return; } if (!result.canceled) { setIsDirty(false); setStatus('Saved to ' + result.filePath); } }
      catch { setStatus('Save failed'); }
    } else {
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a'); a.href = url; a.download = `${project.name.replace(/[^a-z0-9-_]/gi, '-')}.motion.json`; a.click(); window.setTimeout(() => URL.revokeObjectURL(url), 5000); setIsDirty(false); setStatus('Project downloaded');
    }
  };
  const saveAs = async () => {
    if (autosavePromiseRef.current) await autosavePromiseRef.current.catch(() => undefined);
    const data = { ...project, savedAt: new Date().toISOString(), schemaVersion: 1 };
    if (window.motionStudio) {
      try {
        const result = await window.motionStudio.saveProjectAs(data);
        if (!result.canceled) { setExternalConflict(false); setIsDirty(false); setStatus('Saved to ' + result.filePath); }
      } catch (error) {
        setStatus(error instanceof Error ? 'Save As failed: ' + error.message : 'Save As failed');
      }
    } else {
      await save();
    }
  };
  const open = async () => {
    if (isDirty && !window.confirm('Open another project and discard your unsaved changes?')) return;
    if (!window.motionStudio) { fileInput.current?.click(); return; }
    try {
      const result = await window.motionStudio.openProject();
      if (result.canceled || !result.data) return;
      if (!isValidProject(result.data)) { setStatus('Project file is invalid or unsupported'); return; }
      setProject(result.data); setSelected(result.data.layers[0]?.id ?? ''); setCurrentTime(0); setExternalConflict(false); setIsDirty(false); setStatus('Project opened');
    } catch (error) {
      setStatus(error instanceof Error ? 'Could not open project: ' + error.message : 'Could not open project file');
    }
  };
  const openBrowserProject = async (file: File) => {
    if (isDirty && !window.confirm('Open this project and discard your unsaved changes?')) return;
    try {
      const data: unknown = JSON.parse(await file.text());
      if (!isValidProject(data)) { setStatus('Project file is invalid or unsupported'); return; }
      setProject(data); setSelected(data.layers[0]?.id ?? ''); setCurrentTime(0); setExternalConflict(false); setIsDirty(false); setStatus('Project opened');
    } catch {
      setStatus('Could not read project JSON');
    }
  };
  const importMedia = async () => {
    if (window.motionStudio) {
      try {
        const files = await window.motionStudio.importMedia();
        const imported = files.map((f, index) => {
          const ext = f.name.split('.').pop()?.toLowerCase() ?? '';
          const kind: LayerKind = ['mp4','mov','webm'].includes(ext) ? 'video' : ['mp3','wav','ogg','m4a'].includes(ext) ? 'audio' : 'image';
          return { ...initialLayer(kind, f.name, project.layers.length + index), assetUrl: f.url };
        });
        if (imported.length) {
          updateProject(p => ({ ...p, layers: [...p.layers, ...imported] }));
          setSelected(imported[imported.length - 1].id);
          setStatus(`Imported ${imported.length} media item(s)`);
        }
      } catch { setStatus('Import failed'); }
    } else fileInput.current?.click();
  };
  const importBrowserFile = (file?: File) => {
    if (!file) return;
    const kind: LayerKind = file.type.startsWith('video/') ? 'video' : file.type.startsWith('audio/') ? 'audio' : file.type.startsWith('image/') ? 'image' : 'image';
    const url = URL.createObjectURL(file);
    const layer = { ...initialLayer(kind, file.name, project.layers.length), assetUrl: url };
    updateProject(p => ({ ...p, layers: [...p.layers, layer] })); setSelected(layer.id); setStatus('Imported ' + file.name);
  };
  const exportFrame = async () => {
    const canvas = document.querySelector<HTMLCanvasElement>('#composition-canvas');
    if (!canvas) return;
    try {
      await drawComposition(canvas, project, currentTime);
      const url = canvas.toDataURL('image/png');
      const a = document.createElement('a');
      a.download = `${project.name.replace(/[^a-z0-9-_]/gi, '-')}-${Math.round(currentTime * project.fps)}.png`;
      a.href = url; a.click();
      setStatus('Rendered frame exported as PNG');
    } catch (error) {
      setStatus(error instanceof Error ? 'Frame export failed: ' + error.message : 'Frame export failed');
    }
  };
  const exportVideo = async () => {
    const canvas = document.querySelector<HTMLCanvasElement>('#composition-canvas');
    if (!canvas) return;
    if (typeof MediaRecorder === 'undefined' || typeof canvas.captureStream !== 'function') {
      setStatus('Video export is not supported by this runtime'); return;
    }
    if (project.duration > 120) {
      setStatus('Video export is limited to 120 seconds in this beta'); return;
    }
    const fps = Math.max(1, Math.min(60, Math.round(project.fps)));
    const frameCount = Math.max(1, Math.ceil(project.duration * fps));
    exportCancelRef.current = false;
    setExportingVideo(true); setExportProgress(0); setPlaying(false); setStatus('Preparing video export…');
    let stream: MediaStream | undefined;
    let recorder: MediaRecorder | undefined;
    let audioSession: AudioExportSession | undefined;
    try {
      await drawComposition(canvas, project, 0);
      const canvasStream = canvas.captureStream(fps);
      stream = canvasStream;
      let recordingStream: MediaStream = canvasStream;
      audioSession = await createAudioExportSession(project.layers);
      if (audioSession) { recordingStream = new MediaStream([...canvasStream.getVideoTracks(), ...audioSession.stream.getAudioTracks()]); stream = recordingStream; }
      const mimeType = ['video/webm;codecs=vp9','video/webm;codecs=vp8','video/webm'].find(type => MediaRecorder.isTypeSupported(type));
      recorder = new MediaRecorder(recordingStream, mimeType ? { mimeType } : undefined);
      const recorded = new Promise<Blob>((resolve, reject) => {
        const chunks: BlobPart[] = [];
        recorder!.ondataavailable = event => { if (event.data.size > 0) chunks.push(event.data); };
        recorder!.onerror = () => reject(new Error('The browser video encoder reported an error'));
        recorder!.onstop = () => resolve(new Blob(chunks, { type: recorder!.mimeType || 'video/webm' }));
      });
      recorder.start(250);
      audioSession?.start();
      const exportStartedAt = performance.now();
      let lastRenderedFrame = 0;
      while ((performance.now() - exportStartedAt) < project.duration * 1000) {
        if (exportCancelRef.current) break;
        const elapsed = (performance.now() - exportStartedAt) / 1000;
        const frame = Math.min(frameCount - 1, Math.floor(elapsed * fps));
        if (frame !== lastRenderedFrame) {
          await drawComposition(canvas, project, frame / fps);
          lastRenderedFrame = frame;
          setExportProgress(Math.round(((frame + 1) / frameCount) * 100));
        }
        const afterRender = (performance.now() - exportStartedAt) / 1000;
        const untilNextFrame = Math.max(1, ((Math.min(frame + 1, frameCount)) / fps - afterRender) * 1000);
        await new Promise(resolve => window.setTimeout(resolve, Math.min(untilNextFrame, 50)));
      }
      const wasCancelled = exportCancelRef.current;
      recorder.stop();
      const blob = await recorded;
      if (wasCancelled) { setStatus('Video export cancelled'); return; }
      if (!blob.size) throw new Error('The encoder produced an empty video');
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.download = `${project.name.replace(/[^a-z0-9-_]/gi, '-')}.webm`;
      a.href = url; a.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 5000);
      setStatus(`Video exported as WebM (${fps} FPS${audioSession ? ', audio mixed' : ''})`);
    } catch (error) {
      if (recorder && recorder.state !== 'inactive') recorder.stop();
      setStatus(error instanceof Error ? 'Video export failed: ' + error.message : 'Video export failed');
    } finally {
      stream?.getTracks().forEach(track => track.stop());
      await audioSession?.dispose();
      setExportingVideo(false);
    }
  };
  const visibleLayers = useMemo(() => project.layers.filter(l => l.visible && isLayerActive(l, currentTime)).map(l => ({ ...l, ...evaluateTransform(l, currentTime) })), [project.layers, currentTime]);
  useEffect(() => {
    const videos = document.querySelectorAll<HTMLVideoElement>('.comp-video');
    videos.forEach(video => {
      const start = Number(video.dataset.layerStart || 0);
      const target = Math.max(0, currentTime - start);
      if (video.readyState >= 1) {
        const safeTarget = Number.isFinite(video.duration) && video.duration > 0 ? Math.min(target, video.duration - 0.001) : target;
        if (Math.abs(video.currentTime - safeTarget) > 0.2) {
          try { video.currentTime = safeTarget; } catch { /* Wait for metadata before seeking. */ }
        }
      }
      if (playing) { if (video.paused) void video.play().catch(() => {}); }
      else video.pause();
    });
  }, [currentTime, playing, visibleLayers]);

  const scalePreview = Math.min(1, 760 / project.width, 430 / project.height) * zoom;
  const timeX = (t: number) => `${(t / project.duration) * 100}%`;

  return <div className="app-shell">
    <header className="topbar">
      <div className="brand"><div className="brand-mark"><Aperture size={19}/></div><span>motion<span className="brand-light">studio</span></span><span className="version">BETA</span></div>
      <div className="top-divider" />
      <button className="project-name" onClick={() => { const n = prompt('Composition name', project.name); if (n?.trim()) updateProject(p => ({ ...p, name: n.trim() })); }}>{project.name}<ChevronDown size={14}/></button>
      <div className="top-center"><span className="save-dot" />{status}</div>
      <div className="top-actions">
        <button className="icon-btn" title="Undo (Ctrl+Z)" onClick={undo}><Undo2 size={16}/></button>
        <button className="icon-btn" title="Redo" onClick={redo}><Redo2 size={16}/></button>
        <span className="top-divider small" />
        <button className="secondary-btn" onClick={() => void open()}><FolderOpen size={15}/> Open</button>
        <button className="secondary-btn" onClick={() => void save()}><Save size={15}/> Save</button>
        <button className="secondary-btn" onClick={() => void saveAs()}><Save size={15}/> Save As</button>
        <button className="secondary-btn" onClick={() => void exportFrame()} disabled={exportingVideo}><Download size={15}/> Export PNG</button><button className="primary-btn" onClick={() => { if (exportingVideo) exportCancelRef.current = true; else void exportVideo(); }}>{exportingVideo ? <><Film size={15}/> Cancel {exportProgress}%</> : <><Film size={15}/> Export video</>}</button>
      </div>
    </header>
    {externalConflict && <div className="external-conflict-banner"><span><strong>External project conflict.</strong> An agent updated the saved file while you had local edits. Saving is paused to avoid overwriting the agent's work.</span><button className="secondary-btn" onClick={() => void open()}>Open / reload</button><button className="primary-btn" onClick={() => void saveAs()}>Save local copy as…</button></div>}

    <div className="workspace">
      <aside className="left-rail">
        <button className={tool === 'select' ? 'rail-tool active' : 'rail-tool'} title="Select tool (V)" onClick={() => setTool('select')}><MousePointer2 size={18}/><span>Select</span></button>
        <button className={tool === 'move' ? 'rail-tool active' : 'rail-tool'} title="Move tool (M)" onClick={() => setTool('move')}><Move size={18}/><span>Move</span></button>
        <button className={tool === 'text' ? 'rail-tool active' : 'rail-tool'} title="Text tool" onClick={() => { setTool('text'); addLayer('text'); }}><Type size={18}/><span>Text</span></button>
        <button className={tool === 'shape' ? 'rail-tool active' : 'rail-tool'} title="Shape tool" onClick={() => { setTool('shape'); addLayer('shape'); }}><Shapes size={18}/><span>Shape</span></button>
        <div className="rail-spacer" />
        <button className="rail-tool" title="Help"><CircleHelp size={18}/><span>Help</span></button>
      </aside>

      <main className="editor">
        <section className="preview-panel">
          <div className="panel-heading"><div className="heading-left"><span className="eyebrow">COMPOSITION</span><span className="heading-title">Main composition</span><span className="resolution-pill">{project.width} × {project.height}</span></div><div className="panel-tools"><button className="icon-btn" title="Toggle grid" onClick={() => setShowGrid(v => !v)}><Grid2X2 size={15}/></button><button className={snap ? 'icon-btn toggled' : 'icon-btn'} title="Snapping" onClick={() => setSnap(v => !v)}><Magnet size={15}/></button><span className="v-sep"/><button className="icon-btn" onClick={() => setZoom(z => Math.max(.5, z - .1))} title="Zoom out"><ZoomOut size={15}/></button><span className="zoom-label">{Math.round(zoom * 100)}%</span><button className="icon-btn" onClick={() => setZoom(z => Math.min(1.5, z + .1))} title="Zoom in"><ZoomIn size={15}/></button><button className="icon-btn" title="Fit preview" onClick={() => setZoom(1)}><Maximize2 size={15}/></button></div></div>
          <div className="stage-area">
            <div className={showGrid ? 'canvas-frame with-grid' : 'canvas-frame'} style={{ width: project.width * scalePreview, height: project.height * scalePreview }}>
              <canvas id="composition-canvas" width={project.width} height={project.height} style={{ display: 'none' }} />
              <div className="composition" style={{ width: project.width, height: project.height, transform: `scale(${scalePreview})` }}>
                <div className="composition-bg" />
                {visibleLayers.map(layer => {
                  const x = project.width / 2 + layer.x;
                  const y = project.height / 2 + layer.y;
                  const isSelected = selected === layer.id;
                  if (layer.kind === 'text') return <div key={layer.id} className={isSelected ? 'comp-text selected-comp' : 'comp-text'} style={{ left: x, top: y, transform: `translate(-50%, -50%) scale(${layer.scale}) rotate(${layer.rotation}deg)`, opacity: layer.opacity / 100, filter: cssEffectFilter(layer.effects, layer.color), color: '#f4f2ff' }} onClick={() => setSelected(layer.id)}>{layer.text ?? layer.name}{isSelected && <span className="selection-box"/>}</div>;
                  if (layer.kind === 'image' && layer.assetUrl) return <img key={layer.id} className={isSelected ? 'comp-image selected-comp' : 'comp-image'} src={layer.assetUrl} style={{ left: x, top: y, transform: `translate(-50%, -50%) scale(${layer.scale}) rotate(${layer.rotation}deg)`, opacity: layer.opacity / 100, filter: cssEffectFilter(layer.effects, layer.color) }} onClick={() => setSelected(layer.id)} />;
                  if (layer.kind === 'video' && layer.assetUrl) return <video key={layer.id} className="comp-image comp-video" data-layer-start={layer.start} src={layer.assetUrl} muted={false} autoPlay={playing} loop style={{ left: x, top: y, transform: `translate(-50%, -50%) scale(${layer.scale}) rotate(${layer.rotation}deg)`, opacity: layer.opacity / 100, filter: cssEffectFilter(layer.effects, layer.color), maxWidth: '60%' }} onClick={() => setSelected(layer.id)} />;
                  if (layer.kind === 'audio') return null;
                  if (layer.kind === 'shape') return <div key={layer.id} className={isSelected ? 'comp-shape selected-comp' : 'comp-shape'} style={{ left: x, top: y, background: layer.color, transform: `translate(-50%, -50%) scale(${layer.scale}) rotate(${layer.rotation}deg)`, opacity: layer.opacity / 100, filter: cssEffectFilter(layer.effects, layer.color) }} onClick={() => setSelected(layer.id)}>{isSelected && <span className="selection-box"/>}</div>;
                  return null;
                })}
              </div>
            </div>
          </div>
          <div className="transport"><div className="transport-left"><button className="icon-btn" title="Jump to start" onClick={() => setCurrentTime(0)}><SkipBackIcon/></button><button className="play-btn" onClick={() => setPlaying(v => !v)}>{playing ? <Pause size={16} fill="currentColor"/> : <Play size={16} fill="currentColor"/>}</button><button className="icon-btn" title="Jump to end" onClick={() => setCurrentTime(project.duration)}><SkipForwardIcon/></button><span className="timecode">{fmt(currentTime, project.fps)}</span><span className="fps-label">{project.fps} FPS</span></div><div className="transport-right"><span className="muted-label">WORK AREA</span><span className="workarea-value">00:00 — {fmt(project.duration, project.fps)}</span></div></div>
          <div className="scrub-track"><input aria-label="Current time" type="range" min="0" max={project.duration} step={1/project.fps} value={currentTime} onChange={e => setCurrentTime(Number(e.target.value))}/></div>
        </section>

        <section className="timeline-panel">
          <div className="timeline-head"><div className="timeline-tabs"><button className={activeTab === 'timeline' ? 'tab active-tab' : 'tab'} onClick={() => setActiveTab('timeline')}><Layers3 size={15}/> Timeline</button><button className={activeTab === 'graph' ? 'tab active-tab' : 'tab'} onClick={() => setActiveTab('graph')}><Activity size={15}/> Graph editor <span className="soon">BETA</span></button></div><div className="timeline-actions"><button className="icon-btn" onClick={() => addLayer('text')} title="Add text"><Type size={15}/></button><button className="icon-btn" onClick={() => addLayer('shape')} title="Add shape"><Plus size={16}/></button><button className="icon-btn" onClick={() => void importMedia()} title="Import media"><Upload size={15}/></button><span className="v-sep"/><button className="icon-btn" onClick={() => setZoom(z => Math.max(.5,z-.1))} title="Zoom out"><ZoomOut size={15}/></button><button className="icon-btn" onClick={() => setZoom(z => Math.min(1.5,z+.1))} title="Zoom in"><ZoomIn size={15}/></button><button className="icon-btn" title="Timeline options"><MoreHorizontal size={17}/></button></div></div>
          <div className="timeline-body">
            <div className="layer-column"><div className="layer-column-head"><span>LAYERS</span><span>V</span><span>L</span></div>{[...project.layers].reverse().map(layer => <div key={layer.id} className={selected === layer.id ? 'layer-row selected-layer' : 'layer-row'} onClick={() => setSelected(layer.id)}><span className="layer-color" style={{background:layer.color}}/><LayerIcon kind={layer.kind}/><span className="layer-name">{layer.name}</span><button className="layer-mini" title={layer.visible?'Hide layer':'Show layer'} onClick={e => {e.stopPropagation();updateLayer(layer.id,{visible:!layer.visible});}}>{layer.visible?<Eye size={13}/>:<EyeOff size={13}/>}</button><button className="layer-mini" title={layer.locked?'Unlock':'Lock'} onClick={e => {e.stopPropagation();updateLayer(layer.id,{locked:!layer.locked});}}><Square size={12} fill={layer.locked?'currentColor':'none'}/></button></div>)}</div>
            <div className="tracks-wrap"><div className="ruler" onPointerDown={beginScrub} onPointerMove={moveScrub} onPointerUp={finishScrub} onPointerCancel={finishScrub} title="Drag to scrub the playhead">{Array.from({length:Math.ceil(project.duration)+1},(_,i)=><div key={i} className="ruler-tick" style={{left:timeX(i)}}><span>{i===0?'00':String(i).padStart(2,'0')}s</span></div>)}</div>
              {activeTab === 'timeline' ? <div className="tracks">{[...project.layers].reverse().map(layer => {const clipStart=dragPreview?.id===layer.id?dragPreview.start:layer.start;const clipDuration=dragPreview?.id===layer.id?dragPreview.duration:layer.duration;return <div className="track" key={layer.id} onClick={() => setSelected(layer.id)}><div className={selected===layer.id?'clip selected-clip':'clip'} title={layer.locked?'Layer locked':'Drag the clip to move it; drag its edges to trim'} style={{left:timeX(clipStart),width:timeX(Math.max(0,Math.min(clipDuration,project.duration-clipStart))),background:layer.color+'30',borderColor:layer.color,cursor:layer.locked?'not-allowed':'grab',touchAction:'none'}} onPointerDown={e=>beginTimelineDrag(e,layer)} onPointerMove={e=>moveTimelineDrag(e,layer)} onPointerUp={e=>finishTimelineDrag(e,layer)} onPointerCancel={()=>{timelineDragRef.current=null;setDragPreview(null);}}><div className="trim-handle trim-start" onPointerDown={e=>beginTimelineDrag(e,layer,'trim-start')} title="Trim start"/><span>{layer.name}</span>{layer.keyframes.map(k => <span key={k.time} className="keyframe" style={{left:`${Math.max(0,Math.min(100,((k.time-layer.start)/Math.max(layer.duration,.001))*100))}%`}} title={`Keyframe ${k.time}s · ${k.easing || 'linear'}`}/> )}<div className="trim-handle trim-end" onPointerDown={e=>beginTimelineDrag(e,layer,'trim-end')} title="Trim end"/></div></div>})}
                <div className="playhead" style={{left:timeX(currentTime)}}><div className="playhead-cap"/><div className="playhead-line"/></div></div> : <div className="graph-empty"><Activity size={22}/><strong>Animation curves</strong><span>Keyframes now interpolate in the preview. Select a keyframe time to change the outgoing easing curve.</span><div className="graph-controls"><button className="secondary-btn" onClick={() => { if(selectedLayer) updateLayer(selectedLayer.id,{keyframes:upsertKeyframe(selectedLayer,currentTime)}); }}>Set keyframe at playhead</button><button className="secondary-btn" disabled={!selectedLayer||!selectedKeyframe} onClick={() => { if(selectedLayer&&selectedKeyframe) updateLayer(selectedLayer.id,{keyframes:selectedLayer.keyframes.filter(k=>Math.abs(k.time-selectedKeyframe.time)>=1e-7)}); }}>Remove keyframe</button><label className="easing-label">Outgoing easing<select className="easing-select" value={selectedKeyframe?.easing || 'linear'} disabled={!selectedLayer || !selectedKeyframe} onChange={e => { if(selectedLayer && selectedKeyframe) updateLayer(selectedLayer.id,{keyframes:selectedLayer.keyframes.map(k => Math.abs(k.time-selectedKeyframe.time)<1e-7 ? {...k,easing:e.target.value as Easing} : k)}); }}><option value="linear">Linear</option><option value="ease-in">Ease in</option><option value="ease-out">Ease out</option><option value="ease-in-out">Ease in / out</option><option value="hold">Hold</option></select></label></div></div>}
            </div>
          </div>
          <div className="timeline-footer"><span><span className="status-led"/> {project.layers.length} layers</span><span>{project.width} × {project.height} · {project.fps} fps</span><span className="footer-spacer"/><button className="footer-button" onClick={() => setCurrentTime(0)}><Clock3 size={12}/> Go to start</button><button className="footer-button" onClick={() => setSnap(v=>!v)}><Magnet size={12}/> Snap {snap?'on':'off'}</button></div>
        </section>
      </main>

      <aside className="inspector">
        <div className="inspector-tabs"><button className={panel==='project'?'inspector-tab selected':'inspector-tab'} onClick={() => setPanel('project')}>Properties</button><button className={panel==='effects'?'inspector-tab selected':'inspector-tab'} onClick={() => setPanel('effects')}>Effects</button><button className={panel==='audio'?'inspector-tab selected':'inspector-tab'} onClick={() => setPanel('audio')}>Audio</button><button className={panel==='agents'?'inspector-tab selected':'inspector-tab'} onClick={() => setPanel('agents')}><Bot size={13}/> Agents</button></div>
        {panel==='project' ? <div className="inspector-content">
          <div className="inspector-section"><div className="section-title"><span>TRANSFORM</span><button className="icon-btn tiny"><ChevronDown size={14}/></button></div>
            {selectedLayer ? <><div className="property-row"><label>Position X</label><NumberField value={selectedTransform?.x ?? selectedLayer.x} onChange={v=>editTransformAtPlayhead(selectedLayer,{x:v})}/><KeyButton active={!!selectedKeyframe} onClick={()=>updateLayer(selectedLayer.id,{keyframes:upsertKeyframe(selectedLayer,currentTime)})}/></div><div className="property-row"><label>Position Y</label><NumberField value={selectedTransform?.y ?? selectedLayer.y} onChange={v=>editTransformAtPlayhead(selectedLayer,{y:v})}/><KeyButton active={!!selectedKeyframe} onClick={()=>updateLayer(selectedLayer.id,{keyframes:upsertKeyframe(selectedLayer,currentTime)})}/></div><div className="property-row"><label>Scale</label><NumberField value={Math.round((selectedTransform?.scale ?? selectedLayer.scale)*100)} suffix="%" onChange={v=>editTransformAtPlayhead(selectedLayer,{scale:v/100})}/><KeyButton active={!!selectedKeyframe} onClick={()=>updateLayer(selectedLayer.id,{keyframes:upsertKeyframe(selectedLayer,currentTime)})}/></div><div className="property-row"><label>Rotation</label><NumberField value={selectedTransform?.rotation ?? selectedLayer.rotation} suffix="°" onChange={v=>editTransformAtPlayhead(selectedLayer,{rotation:v})}/><KeyButton active={!!selectedKeyframe} onClick={()=>updateLayer(selectedLayer.id,{keyframes:upsertKeyframe(selectedLayer,currentTime)})}/></div><div className="property-row"><label>Opacity</label><NumberField value={selectedTransform?.opacity ?? selectedLayer.opacity} suffix="%" onChange={v=>editTransformAtPlayhead(selectedLayer,{opacity:Math.max(0,Math.min(100,v))})}/><KeyButton active={!!selectedKeyframe} onClick={()=>updateLayer(selectedLayer.id,{keyframes:upsertKeyframe(selectedLayer,currentTime)})}/></div></> : <div className="empty-inspector">Select a layer to edit its properties.</div>}
          </div>
          {selectedLayer?.kind==='text' && <div className="inspector-section"><div className="section-title"><span>TYPOGRAPHY</span><ChevronDown size={14}/></div><label className="field-label">Text content</label><textarea className="text-edit" value={selectedLayer.text??''} onChange={e=>updateLayer(selectedLayer.id,{text:e.target.value})}/><div className="property-row"><label>Color</label><input className="color-input" type="color" value="#f4f2ff" aria-label="Text color"/></div></div>}
          {selectedLayer?.kind==='shape' && <div className="inspector-section"><div className="section-title"><span>APPEARANCE</span><ChevronDown size={14}/></div><div className="property-row"><label>Fill color</label><input className="color-input" type="color" value={selectedLayer.color} onChange={e=>updateLayer(selectedLayer.id,{color:e.target.value})}/></div></div>}
          <div className="inspector-section"><div className="section-title"><span>TIMING</span><ChevronDown size={14}/></div>{selectedLayer && <><div className="property-row"><label>Start</label><NumberField value={selectedLayer.start} suffix="s" onChange={v=>updateLayer(selectedLayer.id,{start:Math.max(0,v)})}/></div><div className="property-row"><label>Duration</label><NumberField value={selectedLayer.duration} suffix="s" onChange={v=>updateLayer(selectedLayer.id,{duration:Math.max(.1,v)})}/></div></>}</div>
          <div className="inspector-section"><div className="section-title"><span>COMPOSITION</span><button className="icon-btn tiny" title="Composition settings"><Settings2 size={13}/></button></div><div className="property-row"><label>Width</label><NumberField value={project.width} onChange={v=>updateProject(p=>({...p,width:Math.max(16,Math.min(16384,Math.round(v)))}))}/></div><div className="property-row"><label>Height</label><NumberField value={project.height} onChange={v=>updateProject(p=>({...p,height:Math.max(16,Math.min(16384,Math.round(v)))}))}/></div><div className="property-row"><label>Frame rate</label><select className="field-select" value={project.fps} onChange={e=>updateProject(p=>({...p,fps:Number(e.target.value)}))}><option value="24">24 fps</option><option value="25">25 fps</option><option value="30">30 fps</option><option value="50">50 fps</option><option value="60">60 fps</option></select></div><div className="property-row"><label>Duration</label><NumberField value={project.duration} suffix="s" onChange={v=>updateProject(p=>({...p,duration:Math.max(1,Math.min(86400,v))}))}/></div></div>
          <button className="ai-card" onClick={() => setPanel('effects')}><div className="ai-icon"><WandSparkles size={16}/></div><div><strong>Make it move</strong><span>Explore effects and animation tools</span></div><ChevronRight size={16}/></button>
        </div> : panel==='effects' ? <div className="inspector-content"><div className="effect-intro"><div className="effect-spark"><Sparkles size={20}/></div><strong>Live effects stack</strong><span>These filters affect the selected layer in the preview and canvas exports.</span></div>{selectedLayer ? <><label className="field-label">Add effect<select className="field-select" value="" onChange={e=>{const type=e.target.value as EffectType;if(!type)return;const effect={id:uid(),type,enabled:true,value:effectDefaults[type].initial};updateLayer(selectedLayer.id,{effects:[...(selectedLayer.effects??[]),effect]});}}><option value="">Choose a filter…</option><option value="blur">Gaussian blur</option><option value="brightness">Brightness</option><option value="contrast">Contrast</option><option value="saturate">Saturation</option><option value="grayscale">Grayscale</option><option value="sepia">Sepia</option><option value="hue-rotate">Hue rotation</option><option value="drop-shadow">Drop shadow</option></select></label><div className="effect-stack">{(selectedLayer.effects??[]).length ? (selectedLayer.effects??[]).map(effect=>{const meta=effectDefaults[effect.type];return <div className="effect-control" key={effect.id}><div className="effect-control-head"><label><input type="checkbox" checked={effect.enabled} onChange={e=>updateLayer(selectedLayer.id,{effects:(selectedLayer.effects??[]).map(item=>item.id===effect.id?{...item,enabled:e.target.checked}:item)})}/><strong>{meta.label}</strong></label><button className="footer-button" onClick={()=>updateLayer(selectedLayer.id,{effects:(selectedLayer.effects??[]).filter(item=>item.id!==effect.id)})}>Remove</button></div><div className="effect-control-value"><input aria-label={meta.label+' amount'} type="range" min={meta.min} max={meta.max} step={1} value={effect.value} onChange={e=>updateLayer(selectedLayer.id,{effects:(selectedLayer.effects??[]).map(item=>item.id===effect.id?{...item,value:Number(e.target.value)}:item)})}/><span>{effect.value}{meta.unit}</span></div></div>}) : <div className="empty-inspector">No effects on this layer. Add a filter above.</div>}</div></> : <div className="empty-inspector">Select a layer to edit its effects.</div>}<p className="note-text">Filters are real CSS/canvas effects. Advanced GPU effects, masks, keying and procedural compositing are not implemented yet.</p></div> : panel==='audio' ? <div className="inspector-content"><div className="effect-intro"><div className="effect-spark"><AudioLines size={20}/></div><strong>Audio workspace</strong><span>Control source audio from audio and video layers. Volume and mute settings are applied to WebM exports; waveform editing and live preview mixing are still planned.</span></div><button className="secondary-btn full-width" onClick={() => void importMedia()}><Upload size={15}/> Import audio or media</button><div className="inspector-section"><div className="section-title"><span>PROJECT AUDIO</span></div>{project.layers.filter(l=>l.kind==='audio'||l.kind==='video').length ? project.layers.filter(l=>l.kind==='audio'||l.kind==='video').map(l=><div className="audio-item" key={l.id}><div className="audio-item-title"><AudioLines size={15}/><span>{l.name}</span></div><div className="audio-controls"><label><input type="checkbox" checked={l.muted??false} onChange={e=>updateLayer(l.id,{muted:e.target.checked})}/> Mute</label><input aria-label={`Volume for ${l.name}`} type="range" min="0" max="100" value={l.volume??100} onChange={e=>updateLayer(l.id,{volume:Number(e.target.value)})}/><span>{l.volume??100}%</span></div></div>) : <div className="empty-inspector">No audio clips yet.</div>}</div></div> : <AgentPanel />}
      </aside>
    </div>
    <footer className="statusbar"><div><span className="status-led"/> Ready <span className="status-sep">/</span> Local project</div><div className="status-center"><span><Command size={12}/> S to save</span><span><Command size={12}/> Z to undo</span><span>Space to play</span></div><div>Motion Studio <span className="status-sep">·</span> 0.4.0</div></footer>
    <input ref={fileInput} type="file" hidden accept="image/*,video/*,audio/*,.json" onChange={e=>{const f=e.target.files?.[0]; if(f?.name.toLowerCase().endsWith('.json')) void openBrowserProject(f); else importBrowserFile(f); e.currentTarget.value='';}}/>
  </div>;
}
function NumberField({value,onChange,suffix}:{value:number;onChange:(v:number)=>void;suffix?:string}) {
  return <div className="number-field"><input type="number" value={Number.isFinite(value)?value:0} onChange={e=>onChange(Number(e.target.value))}/>{suffix&&<span>{suffix}</span>}</div>;
}
function KeyButton({active,onClick}:{active:boolean;onClick:()=>void}) { return <button className={active?'key-button keyed':'key-button'} title="Add keyframe at current time" onClick={onClick}>◆</button>; }
function LayerIcon({kind}:{kind:LayerKind}) { const props={size:14,strokeWidth:1.8}; if(kind==='text')return <Type {...props}/>;if(kind==='shape')return <Shapes {...props}/>;if(kind==='image')return <Image {...props}/>;if(kind==='video')return <Film {...props}/>;return <AudioLines {...props}/>; }
function SkipBackIcon(){return <span className="skip-icon">|◀</span>}
function SkipForwardIcon(){return <span className="skip-icon">▶|</span>}
function AgentPanel() {
  const [copied, setCopied] = useState(false);
  const config = JSON.stringify({
    mcpServers: {
      "motion-studio": {
        command: "node",
        args: [
          "C:/REPLACE/WITH/Motion-Studio/electron/mcp-server.cjs",
          "--project",
          "C:/REPLACE/WITH/YOUR-PROJECT.motion.json"
        ]
      }
    }
  }, null, 2);
  const copyConfig = async () => {
    try {
      await navigator.clipboard.writeText(config);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };
  return <div className="inspector-content agent-panel">
    <div className="effect-intro"><div className="effect-spark"><Bot size={20}/></div><strong>Agent workspace</strong><span>Connect compatible AI agents through MCP to inspect and edit saved Motion Studio projects.</span></div>
    <div className="agent-status"><span className="status-led"/><div><strong>MCP server available</strong><small>External client connection not detected by this panel.</small></div></div>
    <div className="inspector-section"><div className="section-title"><span>QUICK CONNECT</span></div>
      <ol className="agent-steps"><li>Save your composition as a project JSON file.</li><li>Install Node.js 20+ on this computer.</li><li>Copy the starter config and replace both example paths.</li><li>Add it to your MCP client's configuration, then restart that client.</li></ol>
      <button className="primary-btn full-width" onClick={() => void copyConfig()}><Copy size={14}/>{copied ? 'Config copied' : 'Copy MCP config template'}</button>
      <p className="note-text">This is a template, not an active connection. Use real absolute paths on your computer.</p>
    </div>
    <div className="inspector-section"><div className="section-title"><span>AGENT TOOLS</span></div>
      {['Inspect and validate project','Create text, shape, image, video and audio layers','Update transforms, visibility, timing and text','Add keyframe data','Change composition dimensions and FPS','Set blur, brightness, contrast and other layer effects','Control audio volume and mute settings','Duplicate and reorder layers','Delete layers only with explicit confirmation'].map(item => <div className="agent-tool-row" key={item}><span className="status-led"/><span>{item}</span></div>)}
    </div>
    <div className="agent-warning"><strong>Current boundary</strong><span>Agents edit the saved project file. The desktop app watches for agent changes and offers safe reload/conflict handling. WebM export is available; advanced effects and audio mixing are still in development.</span></div>
  </div>;
}
