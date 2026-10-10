# Motion Studio

**Motion Studio** is an independent, local-first motion-graphics editor project focused on a professional timeline workflow and agent-friendly project editing. It is not affiliated with Adobe.

## AI provider setup

Open the **Agents** inspector tab, add a provider, choose its API type, set the base URL and exact model ID, and enter the key. Use **Test** to verify access, then choose a saved provider and request an edit plan. OpenAI-compatible endpoints use `/models` and `/chat/completions`; Anthropic uses `/v1/models` and `/v1/messages`; Gemini uses its native model endpoints. AI edit plans are parsed against a strict operation schema, previewed before approval, applied atomically, and recorded as one undo step. Invalid plans and edits to locked layers are rejected. Provider usage may incur charges. HTTPS is required except for localhost endpoints.

## Current foundation

**Version 0.7.0** adds a validated AI-to-timeline edit workflow, clip transitions, geometric masks, basic per-layer color grading and matching MCP controls, on top of the encrypted multi-provider API foundation.

- Electron desktop shell with context isolation, sandboxed renderer and a narrow preload bridge.
- Multiple saved AI API profiles: OpenAI-compatible endpoints (including compatible gateways/local endpoints), Anthropic Messages API, and Google Gemini API.
- API keys are encrypted with Electron `safeStorage` in the desktop main process; the renderer receives only provider metadata and masked key status.
- Provider connection tests and an AI editing assistant that returns structured edit operations, previews the proposal, validates it, and applies supported changes as one undoable transaction.
- React + TypeScript + Vite editor with composition preview, layers, timeline, playhead, inspector and keyboard shortcuts.
- Frame-snapped timeline scrubbing, clip movement and trim-start/trim-end handles.
- Text, shape and imported media layers; editable transforms, timing, color, composition dimensions and frame rate.
- Live per-layer filter stack: blur, brightness, contrast, saturation, grayscale, sepia, hue rotation and drop shadow; clip transitions (fade, wipe and zoom), rectangle/ellipse masks, and basic exposure/contrast/saturation/temperature/tint controls.
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

This repository is an evolving foundation, **not a complete After Effects replacement yet**. The editor evaluates transform keyframes with interpolation and easing, and exports animated WebM from its canvas compositor. A GPU compositing/effects graph, feathered/bezier/tracked masks, waveform editing, advanced audio routing, professional color scopes/LUT workflows, and an FFmpeg-based production export pipeline are not implemented. Color temperature/tint are approximated using CSS filters rather than a color-managed pipeline. WebM export can mix audio clips and source-video audio with per-layer volume/mute settings. The current filter stack uses CSS/canvas filters; some visual rendering details differ from the interactive DOM preview.

The MCP server edits a configured saved project file and can update clip transitions, geometric masks and basic color-grade properties. The desktop app watches the active file and can reload agent edits; if local changes are unsaved, it prompts before replacing them and blocks a conflicting Save until resolved. Keep one writer agent active at a time and review agent-generated edits.

## Planned engineering milestones

1. Project schema migrations, richer crash recovery and explicit multi-writer locking.
2. Property-level keyframes, bezier easing, graph curves and animation presets.
3. Canvas/WebGL compositor, advanced masks, blend modes and effect stack.
4. Live audio preview playback, waveform display and timeline synchronization.
5. FFmpeg-backed export, audio muxing, image sequences, cancellation and detailed render errors.
6. Automated unit tests, renderer E2E tests and Windows packaging validation.
7. Scoped MCP permissions, undoable agent transactions, task approvals and plugin/extension API.

## Security

Media selection and project dialogs run in the Electron main process. The renderer has no Node integration and communicates through a narrow preload bridge. The MCP server is limited to the explicitly configured project JSON; it does not expose arbitrary filesystem, shell or network tools. Only connect trusted agents and keep backups.

## License

Not yet selected. Add a license before distributing builds publicly.
