import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity, AlignCenter, Aperture, AudioLines, Bot, Box, ChevronDown, ChevronRight,
  CircleHelp, Clapperboard, Clock3, Command, Copy, Download, Eye, EyeOff,
  FilePlus2, Film, FolderOpen, Gauge, Grid2X2, Image, Layers3, Magnet, Maximize2,
  MoreHorizontal, MousePointer2, Move, Pause, Play, Plus, Redo2, Save, Scissors,
  Settings2, Shapes, Sparkles, Square, Type, Undo2, Upload, Volume2, WandSparkles,
  ZoomIn, ZoomOut
} from 'lucide-react';

type LayerKind = 'text' | 'shape' | 'image' | 'video' | 'audio';
type Layer = {
  id: string; name: string; kind: LayerKind; color: string; visible: boolean;
  locked: boolean; start: number; duration: number; x: number; y: number;
  scale: number; rotation: number; opacity: number; text?: string; assetUrl?: string;
  keyframes: { time: number; x: number; y: number; scale: number; rotation: number; opacity: number }[];
};
type Project = { name: string; width: number; height: number; fps: number; duration: number; layers: Layer[] };
const uid = () => Math.random().toString(36).slice(2, 10);
const colors = ['#a78bfa', '#5eead4', '#fbbf24', '#fb7185', '#60a5fa', '#c084fc'];
const initialLayer = (kind: LayerKind, name: string, index: number): Layer => ({
  id: uid(), name, kind, color: colors[index % colors.length], visible: true, locked: false,
  start: 0, duration: 8, x: 0, y: 0, scale: 1, rotation: 0, opacity: 100,
  text: kind === 'text' ? 'Your next big idea.' : undefined,
  keyframes: [{ time: 0, x: 0, y: 0, scale: 1, rotation: 0, opacity: 100 }]
});
const initialProject: Project = {
  name: 'Untitled Composition', width: 1920, height: 1080, fps: 30, duration: 12,
  layers: [
    { ...initialLayer('shape', 'Accent shape', 0), x: 250, y: 40, scale: 1.15, duration: 8 },
    { ...initialLayer('text', 'Title · Main', 1), x: 0, y: 0, duration: 8 },
    { ...initialLayer('text', 'Subtitle', 2), text: 'MOTION, MADE YOURS', x: 0, y: 90, scale: .48, duration: 8 }
  ]
};
const fmt = (t: number) => { const m = Math.floor(t / 60); const s = Math.floor(t % 60); const f = Math.floor((t % 1) * 30); return `${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}:${String(f).padStart(2,'0')}`; };

export default function App() {
  const [project, setProject] = useState<Project>(initialProject);
  const [selected, setSelected] = useState(project.layers[1]?.id ?? '');
  const [currentTime, setCurrentTime] = useState(1.25);
  const [playing, setPlaying] = useState(false);
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
  const selectedLayer = project.layers.find(l => l.id === selected) ?? project.layers[0];

  const updateLayer = useCallback((id: string, patch: Partial<Layer>) => {
    setProject(p => {
      setHistory(h => [...h.slice(-39), p]); setFuture([]);
      return { ...p, layers: p.layers.map(l => l.id === id ? { ...l, ...patch } : l) };
    });
    setStatus('Unsaved changes');
  }, []);
  const addLayer = (kind: LayerKind) => {
    const name = kind === 'text' ? 'Text layer' : kind === 'shape' ? 'Shape layer' : kind === 'audio' ? 'Audio layer' : kind === 'video' ? 'Video layer' : 'Image layer';
    const layer = initialLayer(kind, name, project.layers.length);
    setHistory(h => [...h.slice(-39), project]); setFuture([]);
    setProject(p => ({ ...p, layers: [...p.layers, layer] })); setSelected(layer.id); setStatus('Unsaved changes');
  };
  const undo = () => {
    if (!history.length) return;
    setFuture(f => [project, ...f]); setProject(history[history.length - 1]); setHistory(h => h.slice(0, -1)); setStatus('Undo');
  };
  const redo = () => {
    if (!future.length) return;
    setHistory(h => [...h, project]); setProject(future[0]); setFuture(f => f.slice(1)); setStatus('Redo');
  };
  useEffect(() => {
    if (!playing) return;
    const id = window.setInterval(() => setCurrentTime(t => t >= project.duration ? 0 : t + 1 / project.fps), 1000 / project.fps);
    return () => window.clearInterval(id);
  }, [playing, project.duration, project.fps]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); void save(); }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); undo(); }
      if (e.code === 'Space' && !(e.target instanceof HTMLInputElement)) { e.preventDefault(); setPlaying(v => !v); }
      if (e.key === 'Delete' && selectedLayer && !(e.target instanceof HTMLInputElement)) {
        setHistory(h => [...h.slice(-39), project]); setProject(p => ({ ...p, layers: p.layers.filter(l => l.id !== selected) })); setSelected(''); setStatus('Unsaved changes');
      }
    };
    window.addEventListener('keydown', onKey); return () => window.removeEventListener('keydown', onKey);
  });
  const save = async () => {
    const data = { ...project, savedAt: new Date().toISOString(), schemaVersion: 1 };
    if (window.motionStudio) {
      try { const result = await window.motionStudio.saveProject(data); if (!result.canceled) setStatus('Saved to ' + result.filePath); }
      catch { setStatus('Save failed'); }
    } else {
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `${project.name.replace(/[^a-z0-9-_]/gi, '-')}.motion.json`; a.click(); URL.revokeObjectURL(a.href); setStatus('Project downloaded');
    }
  };
  const open = async () => {
    if (!window.motionStudio) { fileInput.current?.click(); return; }
    try {
      const result = await window.motionStudio.openProject();
      if (!result.canceled && result.data) { const d = result.data as Project; if (Array.isArray(d.layers)) { setProject(d); setSelected(d.layers[0]?.id ?? ''); setStatus('Project opened'); } }
    } catch { setStatus('Could not open project file'); }
  };
  const importMedia = async () => {
    if (window.motionStudio) {
      try {
        const files = await window.motionStudio.importMedia();
        files.forEach(f => {
          const ext = f.name.split('.').pop()?.toLowerCase() ?? '';
          const kind: LayerKind = ['mp4','mov','webm'].includes(ext) ? 'video' : ['mp3','wav','ogg','m4a'].includes(ext) ? 'audio' : 'image';
          const l = { ...initialLayer(kind, f.name, project.layers.length), assetUrl: f.url };
          setProject(p => ({ ...p, layers: [...p.layers, l] })); setSelected(l.id);
        });
        if (files.length) setStatus(`Imported ${files.length} media item(s)`);
      } catch { setStatus('Import failed'); }
    } else fileInput.current?.click();
  };
  const importBrowserFile = (file?: File) => {
    if (!file) return;
    const kind: LayerKind = file.type.startsWith('video/') ? 'video' : file.type.startsWith('audio/') ? 'audio' : file.type.startsWith('image/') ? 'image' : 'image';
    const url = URL.createObjectURL(file);
    const layer = { ...initialLayer(kind, file.name, project.layers.length), assetUrl: url };
    setProject(p => ({ ...p, layers: [...p.layers, layer] })); setSelected(layer.id); setStatus('Imported ' + file.name);
  };
  const exportFrame = async () => {
    const canvas = document.querySelector<HTMLCanvasElement>('#composition-canvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) { setStatus('Could not create export canvas'); return; }
    ctx.clearRect(0, 0, project.width, project.height);
    const bg = ctx.createLinearGradient(0, 0, project.width, project.height);
    bg.addColorStop(0, '#151521'); bg.addColorStop(.55, '#24213a'); bg.addColorStop(1, '#151521');
    ctx.fillStyle = bg; ctx.fillRect(0, 0, project.width, project.height);
    const glow = ctx.createRadialGradient(project.width*.78, project.height*.28, 0, project.width*.78, project.height*.28, project.width*.42);
    glow.addColorStop(0, '#3b2c61'); glow.addColorStop(1, '#3b2c6100');
    ctx.fillStyle = glow; ctx.fillRect(0, 0, project.width, project.height);
    for (const layer of visibleLayers) {
      ctx.save();
      ctx.globalAlpha = Math.max(0, Math.min(1, layer.opacity / 100));
      ctx.translate(project.width/2 + layer.x, project.height/2 + layer.y);
      ctx.rotate(layer.rotation * Math.PI / 180);
      ctx.scale(layer.scale, layer.scale);
      if (layer.kind === 'text') {
        ctx.fillStyle = '#f4f2ff'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.font = '700 106px DM Sans, sans-serif';
        const lines = (layer.text ?? layer.name).split('\\n');
        lines.forEach((line, i) => ctx.fillText(line, 0, (i-(lines.length-1)/2)*120, project.width*.8));
      } else if (layer.kind === 'shape') {
        ctx.fillStyle = layer.color; ctx.shadowColor = layer.color + '88'; ctx.shadowBlur = 35;
        ctx.beginPath(); ctx.roundRect(-135, -135, 270, 270, 35); ctx.fill();
      } else if ((layer.kind === 'image' || layer.kind === 'video') && layer.assetUrl) {
        try {
          const media = document.querySelector<HTMLImageElement | HTMLVideoElement>(layer.kind === 'image' ? `img[src="${CSS.escape(layer.assetUrl)}"]` : `video[src="${CSS.escape(layer.assetUrl)}"]`);
          if (media && (media instanceof HTMLVideoElement ? media.readyState >= 2 : media.complete)) {
            const mw = media instanceof HTMLVideoElement ? media.videoWidth : media.naturalWidth;
            const mh = media instanceof HTMLVideoElement ? media.videoHeight : media.naturalHeight;
            if (mw && mh) { const k = Math.min(project.width*.65/mw, project.height*.7/mh); ctx.drawImage(media, -mw*k/2, -mh*k/2, mw*k, mh*k); }
          }
        } catch { /* Skip media that cannot be decoded by the current renderer. */ }
      }
      ctx.restore();
    }
    const a = document.createElement('a'); a.download = 'motion-studio-frame.png'; a.href = canvas.toDataURL('image/png'); a.click(); setStatus('Composition frame exported as PNG');
  };
  const visibleLayers = useMemo(() => project.layers.filter(l => l.visible && currentTime >= l.start && currentTime <= l.start + l.duration), [project.layers, currentTime]);
  const scalePreview = Math.min(1, 760 / project.width, 430 / project.height) * zoom;
  const timeX = (t: number) => `${(t / project.duration) * 100}%`;

  return <div className="app-shell">
    <header className="topbar">
      <div className="brand"><div className="brand-mark"><Aperture size={19}/></div><span>motion<span className="brand-light">studio</span></span><span className="version">BETA</span></div>
      <div className="top-divider" />
      <button className="project-name" onClick={() => { const n = prompt('Composition name', project.name); if (n?.trim()) setProject(p => ({ ...p, name: n.trim() })); }}>{project.name}<ChevronDown size={14}/></button>
      <div className="top-center"><span className="save-dot" />{status}</div>
      <div className="top-actions">
        <button className="icon-btn" title="Undo (Ctrl+Z)" onClick={undo}><Undo2 size={16}/></button>
        <button className="icon-btn" title="Redo" onClick={redo}><Redo2 size={16}/></button>
        <span className="top-divider small" />
        <button className="secondary-btn" onClick={() => void open()}><FolderOpen size={15}/> Open</button>
        <button className="secondary-btn" onClick={() => void save()}><Save size={15}/> Save</button>
        <button className="primary-btn" onClick={exportFrame}><Download size={15}/> Export frame</button>
      </div>
    </header>

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
                  if (layer.kind === 'text') return <div key={layer.id} className={isSelected ? 'comp-text selected-comp' : 'comp-text'} style={{ left: x, top: y, transform: `translate(-50%, -50%) scale(${layer.scale}) rotate(${layer.rotation}deg)`, opacity: layer.opacity / 100, color: '#f4f2ff' }} onClick={() => setSelected(layer.id)}>{layer.text ?? layer.name}{isSelected && <span className="selection-box"/>}</div>;
                  if (layer.kind === 'image' && layer.assetUrl) return <img key={layer.id} className={isSelected ? 'comp-image selected-comp' : 'comp-image'} src={layer.assetUrl} style={{ left: x, top: y, transform: `translate(-50%, -50%) scale(${layer.scale}) rotate(${layer.rotation}deg)`, opacity: layer.opacity / 100 }} onClick={() => setSelected(layer.id)} />;
                  if (layer.kind === 'video' && layer.assetUrl) return <video key={layer.id} className="comp-image" src={layer.assetUrl} muted autoPlay loop style={{ left: x, top: y, transform: `translate(-50%, -50%) scale(${layer.scale}) rotate(${layer.rotation}deg)`, opacity: layer.opacity / 100, maxWidth: '60%' }} onClick={() => setSelected(layer.id)} />;
                  if (layer.kind === 'audio') return null;
                  if (layer.kind === 'shape') return <div key={layer.id} className={isSelected ? 'comp-shape selected-comp' : 'comp-shape'} style={{ left: x, top: y, background: layer.color, transform: `translate(-50%, -50%) scale(${layer.scale}) rotate(${layer.rotation}deg)`, opacity: layer.opacity / 100 }} onClick={() => setSelected(layer.id)}>{isSelected && <span className="selection-box"/>}</div>;
                  return null;
                })}
              </div>
            </div>
          </div>
          <div className="transport"><div className="transport-left"><button className="icon-btn" title="Jump to start" onClick={() => setCurrentTime(0)}><SkipBackIcon/></button><button className="play-btn" onClick={() => setPlaying(v => !v)}>{playing ? <Pause size={16} fill="currentColor"/> : <Play size={16} fill="currentColor"/>}</button><button className="icon-btn" title="Jump to end" onClick={() => setCurrentTime(project.duration)}><SkipForwardIcon/></button><span className="timecode">{fmt(currentTime)}</span><span className="fps-label">{project.fps} FPS</span></div><div className="transport-right"><span className="muted-label">WORK AREA</span><span className="workarea-value">00:00 — {fmt(project.duration)}</span></div></div>
          <div className="scrub-track"><input aria-label="Current time" type="range" min="0" max={project.duration} step={1/project.fps} value={currentTime} onChange={e => setCurrentTime(Number(e.target.value))}/></div>
        </section>

        <section className="timeline-panel">
          <div className="timeline-head"><div className="timeline-tabs"><button className={activeTab === 'timeline' ? 'tab active-tab' : 'tab'} onClick={() => setActiveTab('timeline')}><Layers3 size={15}/> Timeline</button><button className={activeTab === 'graph' ? 'tab active-tab' : 'tab'} onClick={() => setActiveTab('graph')}><Activity size={15}/> Graph editor <span className="soon">BETA</span></button></div><div className="timeline-actions"><button className="icon-btn" onClick={() => addLayer('text')} title="Add text"><Type size={15}/></button><button className="icon-btn" onClick={() => addLayer('shape')} title="Add shape"><Plus size={16}/></button><button className="icon-btn" onClick={() => void importMedia()} title="Import media"><Upload size={15}/></button><span className="v-sep"/><button className="icon-btn" onClick={() => setZoom(z => Math.max(.5,z-.1))} title="Zoom out"><ZoomOut size={15}/></button><button className="icon-btn" onClick={() => setZoom(z => Math.min(1.5,z+.1))} title="Zoom in"><ZoomIn size={15}/></button><button className="icon-btn" title="Timeline options"><MoreHorizontal size={17}/></button></div></div>
          <div className="timeline-body">
            <div className="layer-column"><div className="layer-column-head"><span>LAYERS</span><span>V</span><span>L</span></div>{[...project.layers].reverse().map(layer => <div key={layer.id} className={selected === layer.id ? 'layer-row selected-layer' : 'layer-row'} onClick={() => setSelected(layer.id)}><span className="layer-color" style={{background:layer.color}}/><LayerIcon kind={layer.kind}/><span className="layer-name">{layer.name}</span><button className="layer-mini" title={layer.visible?'Hide layer':'Show layer'} onClick={e => {e.stopPropagation();updateLayer(layer.id,{visible:!layer.visible});}}>{layer.visible?<Eye size={13}/>:<EyeOff size={13}/>}</button><button className="layer-mini" title={layer.locked?'Unlock':'Lock'} onClick={e => {e.stopPropagation();updateLayer(layer.id,{locked:!layer.locked});}}><Square size={12} fill={layer.locked?'currentColor':'none'}/></button></div>)}</div>
            <div className="tracks-wrap"><div className="ruler">{Array.from({length:Math.ceil(project.duration)+1},(_,i)=><div key={i} className="ruler-tick" style={{left:timeX(i)}}><span>{i===0?'00':String(i).padStart(2,'0')}s</span></div>)}</div>
              {activeTab === 'timeline' ? <div className="tracks">{[...project.layers].reverse().map(layer => <div className="track" key={layer.id} onClick={() => setSelected(layer.id)}><div className={selected===layer.id?'clip selected-clip':'clip'} style={{left:timeX(layer.start),width:timeX(Math.min(layer.duration,project.duration-layer.start)),background:layer.color+'30',borderColor:layer.color}}><span>{layer.name}</span>{layer.keyframes.map(k => <span key={k.time} className="keyframe" style={{left:timeX(k.time).replace('%','')}} title={`Keyframe ${k.time}s`}/> )}</div></div>)}
                <div className="playhead" style={{left:timeX(currentTime)}}><div className="playhead-cap"/><div className="playhead-line"/></div></div> : <div className="graph-empty"><Activity size={22}/><strong>Animation curves</strong><span>Select a property and add keyframes to edit easing curves.</span><button className="secondary-btn" onClick={() => { if(selectedLayer) updateLayer(selectedLayer.id,{keyframes:[...selectedLayer.keyframes,{time:Math.min(project.duration,currentTime+1),x:selectedLayer.x+80,y:selectedLayer.y,scale:selectedLayer.scale,rotation:selectedLayer.rotation,opacity:selectedLayer.opacity}]}); }}>Add keyframe</button></div>}
            </div>
          </div>
          <div className="timeline-footer"><span><span className="status-led"/> {project.layers.length} layers</span><span>{project.width} × {project.height} · {project.fps} fps</span><span className="footer-spacer"/><button className="footer-button" onClick={() => setCurrentTime(0)}><Clock3 size={12}/> Go to start</button><button className="footer-button" onClick={() => setSnap(v=>!v)}><Magnet size={12}/> Snap {snap?'on':'off'}</button></div>
        </section>
      </main>

      <aside className="inspector">
        <div className="inspector-tabs"><button className={panel==='project'?'inspector-tab selected':'inspector-tab'} onClick={() => setPanel('project')}>Properties</button><button className={panel==='effects'?'inspector-tab selected':'inspector-tab'} onClick={() => setPanel('effects')}>Effects</button><button className={panel==='audio'?'inspector-tab selected':'inspector-tab'} onClick={() => setPanel('audio')}>Audio</button><button className={panel==='agents'?'inspector-tab selected':'inspector-tab'} onClick={() => setPanel('agents')}><Bot size={13}/> Agents</button></div>
        {panel==='project' ? <div className="inspector-content">
          <div className="inspector-section"><div className="section-title"><span>TRANSFORM</span><button className="icon-btn tiny"><ChevronDown size={14}/></button></div>
            {selectedLayer ? <><div className="property-row"><label>Position X</label><NumberField value={selectedLayer.x} onChange={v=>updateLayer(selectedLayer.id,{x:v})}/></div><div className="property-row"><label>Position Y</label><NumberField value={selectedLayer.y} onChange={v=>updateLayer(selectedLayer.id,{y:v})}/></div><div className="property-row"><label>Scale</label><NumberField value={Math.round(selectedLayer.scale*100)} suffix="%" onChange={v=>updateLayer(selectedLayer.id,{scale:v/100})}/><KeyButton active={selectedLayer.keyframes.some(k=>k.time===currentTime)} onClick={()=>updateLayer(selectedLayer.id,{keyframes:[...selectedLayer.keyframes,{time:currentTime,x:selectedLayer.x,y:selectedLayer.y,scale:selectedLayer.scale,rotation:selectedLayer.rotation,opacity:selectedLayer.opacity}]})}/></div><div className="property-row"><label>Rotation</label><NumberField value={selectedLayer.rotation} suffix="°" onChange={v=>updateLayer(selectedLayer.id,{rotation:v})}/><KeyButton active={selectedLayer.keyframes.some(k=>k.time===currentTime)} onClick={()=>updateLayer(selectedLayer.id,{keyframes:[...selectedLayer.keyframes,{time:currentTime,x:selectedLayer.x,y:selectedLayer.y,scale:selectedLayer.scale,rotation:selectedLayer.rotation,opacity:selectedLayer.opacity}]})}/></div><div className="property-row"><label>Opacity</label><NumberField value={selectedLayer.opacity} suffix="%" onChange={v=>updateLayer(selectedLayer.id,{opacity:Math.max(0,Math.min(100,v))})}/><KeyButton active={selectedLayer.keyframes.some(k=>k.time===currentTime)} onClick={()=>updateLayer(selectedLayer.id,{keyframes:[...selectedLayer.keyframes,{time:currentTime,x:selectedLayer.x,y:selectedLayer.y,scale:selectedLayer.scale,rotation:selectedLayer.rotation,opacity:selectedLayer.opacity}]})}/></div></> : <div className="empty-inspector">Select a layer to edit its properties.</div>}
          </div>
          {selectedLayer?.kind==='text' && <div className="inspector-section"><div className="section-title"><span>TYPOGRAPHY</span><ChevronDown size={14}/></div><label className="field-label">Text content</label><textarea className="text-edit" value={selectedLayer.text??''} onChange={e=>updateLayer(selectedLayer.id,{text:e.target.value})}/><div className="property-row"><label>Color</label><input className="color-input" type="color" value="#f4f2ff" aria-label="Text color"/></div></div>}
          {selectedLayer?.kind==='shape' && <div className="inspector-section"><div className="section-title"><span>APPEARANCE</span><ChevronDown size={14}/></div><div className="property-row"><label>Fill color</label><input className="color-input" type="color" value={selectedLayer.color} onChange={e=>updateLayer(selectedLayer.id,{color:e.target.value})}/></div></div>}
          <div className="inspector-section"><div className="section-title"><span>TIMING</span><ChevronDown size={14}/></div>{selectedLayer && <><div className="property-row"><label>Start</label><NumberField value={selectedLayer.start} suffix="s" onChange={v=>updateLayer(selectedLayer.id,{start:Math.max(0,v)})}/></div><div className="property-row"><label>Duration</label><NumberField value={selectedLayer.duration} suffix="s" onChange={v=>updateLayer(selectedLayer.id,{duration:Math.max(.1,v)})}/></div></>}</div>
          <div className="inspector-section"><div className="section-title"><span>COMPOSITION</span><button className="icon-btn tiny" title="Composition settings"><Settings2 size={13}/></button></div><div className="property-row"><label>Width</label><NumberField value={project.width} onChange={v=>setProject(p=>({...p,width:Math.max(16,v)}))}/></div><div className="property-row"><label>Height</label><NumberField value={project.height} onChange={v=>setProject(p=>({...p,height:Math.max(16,v)}))}/></div><div className="property-row"><label>Frame rate</label><select className="field-select" value={project.fps} onChange={e=>setProject(p=>({...p,fps:Number(e.target.value)}))}><option value="24">24 fps</option><option value="25">25 fps</option><option value="30">30 fps</option><option value="50">50 fps</option><option value="60">60 fps</option></select></div><div className="property-row"><label>Duration</label><NumberField value={project.duration} suffix="s" onChange={v=>setProject(p=>({...p,duration:Math.max(1,v)}))}/></div></div>
          <button className="ai-card" onClick={() => setPanel('effects')}><div className="ai-icon"><WandSparkles size={16}/></div><div><strong>Make it move</strong><span>Explore effects and animation tools</span></div><ChevronRight size={16}/></button>
        </div> : panel==='effects' ? <div className="inspector-content"><div className="effect-intro"><div className="effect-spark"><Sparkles size={20}/></div><strong>Effects &amp; finishing</strong><span>Build your look with editable effect stacks. More effects are on the roadmap.</span></div>{[['Blur & sharpen','Gaussian blur, directional blur'],['Color correction','Exposure, contrast, curves'],['Glow & light','Bloom, glow, light leaks'],['Keying & mattes','Chroma key, luma matte'],['Distortion','Transform, warp, displacement'],['Stylize','Grain, posterize, halftone']].map(([a,b])=><button key={a} className="effect-row" onClick={()=>setStatus(a+' selected — effect engine planned')}><span className="effect-thumb"><Aperture size={17}/></span><span><strong>{a}</strong><small>{b}</small></span><Plus size={15}/></button>)}<p className="note-text">Effect tiles are currently UI previews; effect processing is not implemented yet.</p></div> : panel==='audio' ? <div className="inspector-content"><div className="effect-intro"><div className="effect-spark"><AudioLines size={20}/></div><strong>Audio workspace</strong><span>Import audio clips to add them as timeline layers. Waveform editing and mixing are planned.</span></div><button className="secondary-btn full-width" onClick={() => void importMedia()}><Upload size={15}/> Import audio or media</button><div className="inspector-section"><div className="section-title"><span>PROJECT AUDIO</span></div>{project.layers.filter(l=>l.kind==='audio').length ? project.layers.filter(l=>l.kind==='audio').map(l=><div className="audio-item" key={l.id}><AudioLines size={15}/><span>{l.name}</span></div>) : <div className="empty-inspector">No audio clips yet.</div>}</div></div> : <AgentPanel />}
      </aside>
    </div>
    <footer className="statusbar"><div><span className="status-led"/> Ready <span className="status-sep">/</span> Local project</div><div className="status-center"><span><Command size={12}/> S to save</span><span><Command size={12}/> Z to undo</span><span>Space to play</span></div><div>Motion Studio <span className="status-sep">·</span> 0.1.0</div></footer>
    <input ref={fileInput} type="file" hidden accept="image/*,video/*,audio/*,.json" onChange={e=>{const f=e.target.files?.[0]; if(f?.name.endsWith('.json')) {void f.text().then(t=>{try{const p=JSON.parse(t);if(Array.isArray(p.layers)){setProject(p);setSelected(p.layers[0]?.id??'');setStatus('Project opened');}else importBrowserFile(f);}catch{importBrowserFile(f);}});}else importBrowserFile(f);e.currentTarget.value='';}}/>
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
      {['Inspect and validate project','Create text, shape, image, video and audio layers','Update transforms, visibility, timing and text','Add keyframe data','Change composition dimensions and FPS','Delete layers only with explicit confirmation'].map(item => <div className="agent-tool-row" key={item}><span className="status-led"/><span>{item}</span></div>)}
    </div>
    <div className="agent-warning"><strong>Current boundary</strong><span>Agents edit the saved project file. Save before agent work and reopen after edits. Unsaved-state sync, live refresh and final video rendering are not yet implemented.</span></div>
  </div>;
}
