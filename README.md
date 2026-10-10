# Motion Studio

**Motion Studio** is an independent, local-first motion-graphics editor project focused on a professional timeline workflow and agent-friendly project editing. It is not affiliated with Adobe.

## Current foundation

**Version 0.5.0** adds guarded project-schema versioning and safer external-agent edit conflict handling.

- Electron desktop shell with context isolation, sandboxed renderer and a narrow preload bridge.
- React + TypeScript + Vite editor with composition preview, layers, timeline, playhead, inspector and keyboard shortcuts.
- Frame-snapped timeline scrubbing, clip movement and trim-start/trim-end handles.
- Text, shape and imported media layers; editable transforms, timing, color, composition dimensions and frame rate.
- Live per-layer filter stack: blur, brightness, contrast, saturation, grayscale, sepia, hue rotation and drop shadow.
- Import local image, video and audio files into the project layer list; control audio volume and mute state.
- Playhead-synchronized video and audio preview with source audio controls.
- Validated project open/save, Save As, atomic desktop writes, debounced autosave, recovery snapshots, external-file conflict detection that preserves the saved baseline until an external version is explicitly accepted, and a versioned project schema that upgrades legacy unversioned files to v1 in memory.
- Export a rendered PNG frame or an animated WebM video from the canvas compositor (up to 120 seconds in this beta).
- Undo/redo, visibility and locking controls, animated transform keyframes with linear/ease-in/ease-out/ease-in-out/hold interpolation, and editable outgoing easing.
- Windows NSIS packaging configuration.
- **MCP server for external agents** to inspect/validate projects, create/update/duplicate/reorder/delete layers, change composition settings, set live effect stacks, and edit keyframes including easing.

## Run on Windows

Install Node.js 20+ (Node 22 LTS recommended), then:

```powershell
npm install
npm run dev
```

Check and build:

```powershell
npm run typecheck
npm run build
npm run mcp:check
npm test
npm run test:mcp
npm run test:unit
```

Create a Windows installer:

```powershell
npm run dist:win
```

## Connect an MCP agent

Save a project from Motion Studio, then configure your MCP client to launch Node.js with the absolute path to electron/mcp-server.cjs and the absolute path to the saved project file.

Example generic configuration:

```json
{
  "mcpServers": {
    "motion-studio": {
      "command": "node",
      "args": [
        "C:/path/to/motion-studio/electron/mcp-server.cjs",
        "--project",
        "C:/path/to/project.motion.json"
      ]
    }
  }
}
```

Replace both example paths with real absolute paths. See docs/AGENTS-MCP.md for tool definitions, security boundaries and a multi-agent workflow.

## Important scope notes

This repository is an evolving foundation, **not a complete After Effects replacement yet**. The editor evaluates transform keyframes with interpolation and easing, and exports animated WebM from its canvas compositor. A GPU compositing/effects graph, waveform display, advanced audio routing and production-grade color management, and an FFmpeg-based production export pipeline are not implemented. WebM export can mix audio clips and source-video audio with per-layer volume/mute settings. The current filter stack uses CSS/canvas filters; some visual rendering details differ from the interactive DOM preview.

The MCP server edits a configured saved project file. The desktop app watches the active file and can reload agent edits; if local changes are unsaved, it prompts before replacing them and blocks a conflicting Save until resolved. Keep one writer agent active at a time and review agent-generated edits.

## Planned engineering milestones

1. Project schema migrations, richer crash recovery and explicit multi-writer locking.
2. Property-level keyframes, bezier easing, graph curves and animation presets.
3. Canvas/WebGL compositor, masks, blend modes and effect stack.
4. Live audio preview playback, waveform display and timeline synchronization.
5. FFmpeg-backed export, audio muxing, image sequences, cancellation and detailed render errors.
6. Automated unit tests, renderer E2E tests and Windows packaging validation.
7. Scoped MCP permissions, undoable agent transactions, task approvals and plugin/extension API.

## Security

Media selection and project dialogs run in the Electron main process. The renderer has no Node integration and communicates through a narrow preload bridge. The MCP server is limited to the explicitly configured project JSON; it does not expose arbitrary filesystem, shell or network tools. Only connect trusted agents and keep backups.

## License

Not yet selected. Add a license before distributing builds publicly.
