# MCP and agent integration

Motion Studio includes a local Model Context Protocol (MCP) server for compatible desktop agents. It uses Node.js built-ins and MCP JSON-RPC over stdio; no additional npm dependency is required.

## Available tools

- `project.get_summary` — composition dimensions, FPS, duration and layer counts.
- `project.validate` — check core project structure and unique layer IDs.
- `layers.list` — inspect layers and optionally their keyframes.
- `layers.create` — create text, shape, image, video or audio layers.
- `layers.update` — edit whitelisted layer properties, including audio volume/mute; locked layers require explicit unlocking.
- `layers.delete` — destructive action requiring `confirm: true`; locked layers cannot be deleted.
- `layers.add_keyframe` — add or replace a transform keyframe, including linear, ease-in, ease-out, ease-in-out or hold easing.
- `layers.duplicate` — duplicate a layer with optional position/time offsets.
- `layers.reorder` — move a layer to a stack index.
- `layers.set_effects` — replace a layer's supported CSS/canvas effect stack.
- `project.update_settings` — update composition name, dimensions, FPS and duration.
- Resource `motion-studio://project` — read project JSON.
- Prompt `create_motion_sequence` — a guided project-aware editing workflow.

## Configure an MCP client

Save a project in Motion Studio, then configure your MCP-compatible client to start Node.js with the server path and the absolute path of the saved project. Adapt the wrapper key to the client you use.

```json
{
  "mcpServers": {
    "motion-studio": {
      "command": "node",
      "args": [
        "C:/path/to/motion-studio/electron/mcp-server.cjs",
        "--project",
        "C:/path/to/my-project.motion.json"
      ]
    }
  }
}
```

Replace both example paths with real absolute paths. Windows JSON paths can use forward slashes or escaped backslashes. Alternatively, set the `MOTION_STUDIO_PROJECT` environment variable to an absolute `.motion.json` or `.json` path.

## Recommended agent workflow

1. Call `project.get_summary` and `project.validate`.
2. Inspect the current layer hierarchy with `layers.list`.
3. Plan the intended result and call out destructive edits before applying them.
4. Make small, targeted edits using the layer and project tools.
5. Read the layers again and validate the project.
6. Report what changed and what still needs visual review. Do not claim that a video was rendered unless a real render engine confirms it.

For multi-agent workflows, assign explicit roles: a director/planner creates the brief and acceptance criteria; a motion designer edits layer hierarchy and timing; an asset researcher proposes assets and licensing notes; a QA/verifier independently validates IDs, timing and project settings; and a render operator only handles export when a real renderer is connected. Use one writer agent per project at a time.

## Safety and limitations

The server reads and writes only the one configured project JSON file. Tool arguments cannot choose arbitrary filesystem paths, run shell commands or access the network. Changes are written atomically, and projects larger than 20 MB are rejected. Nevertheless, connected agents can alter your configured project, so only connect trusted MCP clients and keep backups.

MCP edits the saved project file. The desktop app watches the active project for external file changes and can reload agent edits; if the editor has unsaved changes, it asks before discarding them and blocks overwriting until the conflict is resolved. Animation keyframes interpolate in the preview, and the editor can export animated WebM video from the canvas renderer. This is an early renderer: advanced GPU effects, waveform display, advanced audio routing and production-grade color management are not implemented; WebM export can mix source audio and is limited to 120 seconds in this beta. MCP is a project-editing bridge, not an autonomous rendering agent.
