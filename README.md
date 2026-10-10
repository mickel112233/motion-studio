# Motion Studio

**Motion Studio** is a local-first, desktop-first motion graphics editor prototype inspired by professional timeline/compositing workflows. It is an independent project and is not affiliated with Adobe.

## Current foundation

- Electron desktop shell with context isolation, sandboxed renderer and a preload bridge.
- React + TypeScript + Vite UI with composition preview, layers, timeline, playhead, inspector and keyboard shortcuts.
- Add text and shape layers; edit transforms, timing, color, composition dimensions and frame rate.
- Import local image, video and audio files into the project layer list.
- Save/open JSON project files from the desktop shell; download JSON in browser mode.
- Export the current preview frame as PNG.
- Undo/redo for layer edits, visibility and locking controls, basic keyframe marker storage and a graph-editor placeholder.
- Windows NSIS packaging configuration.

## Run on Windows

Install Node.js 20+ (Node 22 LTS recommended), then:

```powershell
npm install
npm run dev
```

Build the renderer:

```powershell
npm run typecheck
npm run build
```

Create a Windows installer:

```powershell
npm run dist:win
```

The first build requires an internet connection to download npm packages. The editor itself does not require an AI API key.

## Important scope notes

This repository is the first working foundation, **not a complete After Effects replacement yet**. In this initial version, timeline clips and keyframe data are editable, but true per-frame keyframe interpolation, a GPU compositing/effects graph, audio waveform playback/mixing, and video rendering/export are not implemented. The Effects panel is clearly marked as a preview. PNG export captures the visible browser composition surface; it is not a video export pipeline.

## Planned engineering milestones

1. Typed project schema, migration/versioning, autosave and recovery.
2. Deterministic animation engine with interpolation, easing curves and property-level keyframes.
3. Canvas/WebGL compositor and proper transforms, masks, blend modes and effect stack.
4. Audio playback, waveform display and timeline sync.
5. FFmpeg-backed video/image-sequence export with progress, cancellation and error reporting.
6. Automated unit tests, renderer E2E tests, and Windows packaging validation.
7. Plugin/extension API, reusable presets, accessibility and localization.

## Security

Media selection and project file dialogs run in the Electron main process. The renderer has no Node integration and communicates through a narrow preload bridge. Treat imported media and project files as untrusted input.

## License

Not yet selected. Add a license before distributing builds publicly.