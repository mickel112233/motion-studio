# Motion Studio

**Motion Studio** is an independent, local-first motion-graphics editor project focused on a professional timeline workflow and agent-friendly project editing. It is not affiliated with Adobe.

## Current foundation

- Electron desktop shell with context isolation, sandboxed renderer and a narrow preload bridge.
- React + TypeScript + Vite editor with composition preview, layers, timeline, playhead, inspector and keyboard shortcuts.
- Text and shape layers; editable transforms, timing, color, composition dimensions and frame rate.
- Import local image, video and audio files into the project layer list.
- Save/open JSON project files from the desktop shell; download JSON in browser mode.
- Export the current preview frame as PNG.
- Undo/redo, visibility and locking controls, and basic keyframe marker storage.
- Windows NSIS packaging configuration.
- **MCP server for external agents** to inspect/validate projects, create and update layers, change composition settings, and store keyframes.

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
npm run test:mcp
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

This repository is an evolving foundation, **not a complete After Effects replacement yet**. Full per-frame keyframe interpolation, a GPU compositing/effects graph, audio waveform playback/mixing, and final video rendering/export are not implemented. The Effects panel is a UI preview. PNG export captures the current preview surface; it is not a video export pipeline.

The MCP server edits a configured saved project file. It does not sync unsaved editor state or live-refresh the open editor, and it is designed for one writer at a time. Agent-generated edits should be reviewed and validated before delivery.

## Planned engineering milestones

1. Typed project schema, migrations, autosave, recovery and external-change detection.
2. Deterministic animation engine with interpolation, easing curves and property-level keyframes.
3. Canvas/WebGL compositor, masks, blend modes and effect stack.
4. Audio playback, waveform display and timeline synchronization.
5. FFmpeg-backed video/image-sequence export with progress, cancellation and error reporting.
6. Automated unit tests, renderer E2E tests and Windows packaging validation.
7. Live project bridge, scoped MCP permissions, undoable agent transactions and plugin/extension API.

## Security

Media selection and project dialogs run in the Electron main process. The renderer has no Node integration and communicates through a narrow preload bridge. The MCP server is limited to the explicitly configured project JSON; it does not expose arbitrary filesystem, shell or network tools. Only connect trusted agents and keep backups.

## License

Not yet selected. Add a license before distributing builds publicly.
