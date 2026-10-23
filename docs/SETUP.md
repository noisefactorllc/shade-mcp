# Setting Up shade-mcp for Your Project

shade-mcp replaces the built-in MCP servers in **noisemaker** and **portable**.
This guide explains setup for each project in VS Code and Claude Code.

The paths below use `/path/to/<project>`.
Replace these paths with your checkout locations.
Use absolute paths. MCP clients do not expand `~`.

## Prerequisites

Node.js 22 or newer. Build shade-mcp once, from the shade-mcp directory:

```bash
cd /path/to/shade-mcp
npm install                # installs dependencies and builds dist/
npm run setup              # install Playwright Chromium (browser tools only)
```

Check that the build created the entry point:

```bash
ls dist/index.js  # should exist
```

## The viewer

The eight browser tools need a viewer page that hosts the renderer.
shade-mcp does not include a viewer.
Set `SHADE_VIEWER_ROOT` to your project's viewer root.
Set `SHADE_GLOBALS_PREFIX` to match the window globals that the viewer exposes.
The configurations below include both variables.

The analysis, knowledge, and utility tools read from disk and work without a viewer.

## noisemaker

Effects live at `noisemaker/shaders/effects/` in nested `namespace/effect/` layout, and the demo viewer at `noisemaker/demo/shaders/`.

Set the viewer root to the repository root.
The page imports the engine from `shaders/src/` at the repository root.
If you serve only `demo/shaders/`, every module request returns 404.
The renderer global then never appears.

### VS Code (Copilot)

Create or edit `noisemaker/.vscode/mcp.json`:

```json
{
  "servers": {
    "shade": {
      "type": "stdio",
      "command": "node",
      "args": ["/path/to/shade-mcp/dist/index.js"],
      "env": {
        "SHADE_EFFECTS_DIR": "/path/to/noisemaker/shaders/effects",
        "SHADE_PROJECT_ROOT": "/path/to/noisemaker",
        "SHADE_VIEWER_ROOT": "/path/to/noisemaker",
        "SHADE_VIEWER_PATH": "/demo/shaders/",
        "SHADE_GLOBALS_PREFIX": "__noisemaker"
      }
    }
  }
}
```

Remove or comment out the old `noisemaker-shader-tools` entry in `.vscode/settings.json` if present.

### Claude Code

Add this to `.mcp.json` at the root of the checkout, or register the same server for yourself with `claude mcp add shade -e NAME=value ... -- node /path/to/shade-mcp/dist/index.js`. Claude Code reads MCP servers from `.mcp.json` and `~/.claude.json`, not from `settings.json`:

```json
{
  "mcpServers": {
    "shade": {
      "command": "node",
      "args": ["/path/to/shade-mcp/dist/index.js"],
      "env": {
        "SHADE_EFFECTS_DIR": "/path/to/noisemaker/shaders/effects",
        "SHADE_PROJECT_ROOT": "/path/to/noisemaker",
        "SHADE_VIEWER_ROOT": "/path/to/noisemaker",
        "SHADE_VIEWER_PATH": "/demo/shaders/",
        "SHADE_GLOBALS_PREFIX": "__noisemaker"
      }
    }
  }
}
```

### What works

All 18 tools. Examples:

```
compileEffect({ effects: "synth/noise, synth/gradient", backend: "webgl2" })
renderEffectFrame({ effect_id: "filter/blur", backend: "webgpu" })
searchEffects({ query: "fractal noise" })
generateManifest()
```

## portable

The effect lives at `portable/effect/` in a flat layout (no namespace nesting). shade-mcp auto-detects this. The viewer lives at `portable/viewer/` and loads the effect from `../effect/`, so the viewer root is the checkout itself.

A Portable checkout already registers its vendored shade-mcp in `.mcp.json` with these settings. After `npm install` there, Claude Code offers that server when it opens the checkout. The blocks below are for running your own shade-mcp build instead.

### VS Code (Copilot)

Create or edit `portable/.vscode/mcp.json`:

```json
{
  "servers": {
    "shade": {
      "type": "stdio",
      "command": "node",
      "args": ["/path/to/shade-mcp/dist/index.js"],
      "env": {
        "SHADE_EFFECTS_DIR": "/path/to/portable/effect",
        "SHADE_PROJECT_ROOT": "/path/to/portable",
        "SHADE_VIEWER_ROOT": "/path/to/portable",
        "SHADE_VIEWER_PATH": "/viewer/index.html",
        "SHADE_GLOBALS_PREFIX": "__portable"
      }
    }
  }
}
```

Remove or comment out the old `portable-shader` entry if present.

### Claude Code

Add this to `.mcp.json` at the root of the checkout, or register the same server for yourself with `claude mcp add shade -e NAME=value ... -- node /path/to/shade-mcp/dist/index.js`. Claude Code reads MCP servers from `.mcp.json` and `~/.claude.json`, not from `settings.json`:

```json
{
  "mcpServers": {
    "shade": {
      "command": "node",
      "args": ["/path/to/shade-mcp/dist/index.js"],
      "env": {
        "SHADE_EFFECTS_DIR": "/path/to/portable/effect",
        "SHADE_PROJECT_ROOT": "/path/to/portable",
        "SHADE_VIEWER_ROOT": "/path/to/portable",
        "SHADE_VIEWER_PATH": "/viewer/index.html",
        "SHADE_GLOBALS_PREFIX": "__portable"
      }
    }
  }
}
```

### What works

All tools work. You can omit `effect_id` because the directory contains only one effect.
shade-mcp detects that effect automatically:

```
compileEffect({ backend: "webgl2" })
renderEffectFrame({ backend: "webgpu", capture_image: true })
testPixelParity()
```

shade-mcp writes this expected warning to stderr: `[shade-mcp] Auto-detected flat effect layout: effect`.

## Disabling the old MCP

You do not need to delete the old MCP servers.
Make sure only one server is active at a time:

- **VS Code**: Remove the old server entry from `.vscode/mcp.json` or `.vscode/settings.json`
- **Claude Code**: `claude mcp list` shows the registered servers; `claude mcp remove <name>` removes the old one
- **Cursor**: Remove the old server entry from `.cursor/mcp.json`

If both old and new MCPs are active, you'll get duplicate tool names and unpredictable behavior.

## Troubleshooting

**"Effects directory not found"** — Check that `SHADE_EFFECTS_DIR` points to the right path. For noisemaker it's `shaders/effects/`, for portable it's `effect/`.

**"No effects found"** — The directory exists but contains no `definition.json` or `definition.js` files. Check the path is correct and points to the effects, not one level above.

**"Multiple effects found. Please specify effect_id"** — You're pointing at a multi-effect library (like noisemaker) but didn't pass `effect_id`. Pass it explicitly: `compileEffect({ effect_id: "synth/noise" })`.

**"Invalid effect id"** — shade-mcp resolves effect IDs inside `SHADE_EFFECTS_DIR`.
It refuses absolute paths and `..` segments.
Pass a plain `namespace/effect` ID.

**Browser tools hang or time out** — Check these conditions:

1. `npm run setup` installed Chromium.
2. `SHADE_VIEWER_ROOT` points to a directory containing the viewer's `index.html`.
3. `SHADE_GLOBALS_PREFIX` matches the globals that the viewer exposes.

If the prefix does not match, the renderer global never appears. Setup waits for that global.

**I want to watch the render happen** — Set `SHADE_HEADLESS=0` to run headed. The default is headless, which is also the only mode that works on a machine with no display.

**AI tools return "No API key"** — Set `ANTHROPIC_API_KEY` (preferred) or `OPENAI_API_KEY` in your MCP configuration's env block.
Alternatively, create a `.anthropic` or `.openai` file in the project root.
The file must contain only the key.

## Environment Variables Reference

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `SHADE_EFFECTS_DIR` | Yes | `<project root>/effects` | Path to effects directory |
| `SHADE_PROJECT_ROOT` | No | cwd | Project root for relative paths and AI key lookup |
| `SHADE_VIEWER_ROOT` | Browser tools | `<project root>/viewer` | Directory served as the viewer |
| `SHADE_GLOBALS_PREFIX` | Browser tools | `__shade` | Prefix of the viewer's window globals |
| `SHADE_VIEWER_PATH` | No | `/` | Path within the viewer to open |
| `SHADE_VIEWER_PORT` | No | `0` (OS-assigned) | HTTP server port |
| `SHADE_BACKEND` | No | `webgl2` | Default backend (`webgl2` or `webgpu`) |
| `SHADE_MAX_BROWSERS` | No | `1` | Concurrent browser sessions |
| `SHADE_HEADLESS` | No | `1` (headless) | Set to `0` to watch the browser window |
| `SHADE_TIMEOUT_MS` | No | `120000` | Ceiling for every browser and page operation |
| `SHADE_AI_TIMEOUT_MS` | No | `120000` | Ceiling for a single AI provider request |
| `SHADE_AI_MODEL` | No | provider default | Model used by the AI-powered tools |
| `ANTHROPIC_API_KEY` | No | — | For AI-powered tools |
| `OPENAI_API_KEY` | No | — | Fallback AI provider |

The viewer server binds to `127.0.0.1` and serves only `SHADE_VIEWER_ROOT` and `SHADE_EFFECTS_DIR`.
Set `SHADE_VIEWER_ROOT` to the viewer directory itself instead of a whole workspace.
This setting excludes unrelated files.
