<!-- repo-hero -->
<a href="https://shade.noisedeck.app/"><img src="docs/hero.jpg" alt="Shade MCP MCP dev tools for Noisemaker and Portable effects" width="100%"></a>

<sub>Open source from <a href="https://noisefactor.io">Noise Factor</a> &middot; <a href="https://github.com/noisefactorllc">more projects</a></sub>

# shade-mcp

MCP server for shader effect development.

Distilled from three projects:
- **[noisemaker](https://noisemaker.app/)** — browser-based shader testing
- **[portable](https://github.com/noisefactorllc/portable)** — portable effect authoring
- **[shade](https://shade.noisedeck.app)** — agent-assisted shader editing

## Requirements

- Node.js 22 or newer
- A viewer page for the seven viewer-driven browser tools; `runDslProgram` needs a Noisemaker checkout. See [Viewer](#viewer).

## Quick Start

```bash
npm install            # installs dependencies and builds dist/
npm run setup          # install Playwright Chromium (browser tools only)
```

**Using shade-mcp with noisemaker or portable?** See [docs/SETUP.md](docs/SETUP.md) for step-by-step configuration.

## Viewer

The browser tools use Chromium. Seven control a viewer page that hosts the renderer;
`runDslProgram` creates a fresh renderer on a blank page for each call.
shade-mcp does not include a viewer.
Set `SHADE_VIEWER_ROOT` to the smallest directory containing the viewer and its imported modules.
For the seven viewer tools, the page must expose the renderer through window globals.
Set `SHADE_GLOBALS_PREFIX` to match those globals. `runDslProgram` uses a fresh
renderer independently of the viewer globals and `SHADE_VIEWER_PATH`. By default
it imports Noisemaker source modules from `/shaders/src/index.js` and assets from
`/shaders` under `SHADE_VIEWER_ROOT`. For Portable's built-in Noisemaker DSL,
set `SHADE_DSL_RENDERER_MODULE=https://shaders.noisedeck.app/1/noisemaker-shaders-core.esm.js`,
`SHADE_DSL_ASSETS_BASE=https://shaders.noisedeck.app/1`, and
`SHADE_DSL_USE_BUNDLES=true`; keep its viewer settings for the other browser tools.
To use authored `user.*` effects, pass `effects` as comma-separated Portable
package IDs under `SHADE_EFFECTS_DIR` (up to 16), such as `user/gradient,user/tint`.
For a flat single-effect directory, use its directory name as the ID. The fresh
renderer loads each package's raw `definition.json` and the requested backend's
shader files. Omitting `effects` loads built-ins only. Authored registration
requires a Noisemaker runtime with `CanvasRenderer.registerPortableEffect`;
older CDN bundles return an explicit unsupported-runtime error. Viewer state
is never inherited, and duplicate authored function names fail the batch.

| Project | `SHADE_VIEWER_ROOT` | `SHADE_VIEWER_PATH` | `SHADE_GLOBALS_PREFIX` |
|---------|---------------------|---------------------|------------------------|
| noisemaker | `<noisemaker>` | `/demo/shaders/` | `__noisemaker` |
| portable | `<portable>` | `/viewer/index.html` | `__portable` |

noisemaker's viewer page is in `demo/shaders/` and imports the engine from `shaders/src/` at the repository root.
For noisemaker, set `SHADE_VIEWER_ROOT` to the repository root.
If you use the page's directory as the root, every module request returns 404.
The server refuses dotfiles regardless of the root.

The analysis, knowledge, and utility tools read from disk and need no viewer.

## Configuration

Environment variables:

| Variable | Default | Description |
|----------|---------|-------------|
| `SHADE_EFFECTS_DIR` | `<project root>/effects` | Path to the effects library |
| `SHADE_PROJECT_ROOT` | cwd | Project root, used for relative paths and AI key lookup |
| `SHADE_VIEWER_ROOT` | `<project root>/viewer` | Directory served as the viewer |
| `SHADE_VIEWER_PATH` | `/` | Path within the viewer to open |
| `SHADE_VIEWER_PORT` | `0` (OS-assigned) | Port for the local viewer server |
| `SHADE_GLOBALS_PREFIX` | `__shade` | Prefix of the viewer's window globals |
| `SHADE_DSL_RENDERER_MODULE` | `/shaders/src/index.js` | Root-relative or HTTPS Noisemaker module exporting `CanvasRenderer` and `compile` for `runDslProgram` |
| `SHADE_DSL_ASSETS_BASE` | `/shaders` | Root-relative or HTTPS Noisemaker asset base for `runDslProgram` |
| `SHADE_DSL_USE_BUNDLES` | `false` | Set `true` when DSL effects load from bundled assets (Portable's CDN) |
| `SHADE_BACKEND` | `webgl2` | Default rendering backend (`webgl2` or `webgpu`) |
| `SHADE_MAX_BROWSERS` | `1` | Concurrent browser sessions |
| `SHADE_HEADLESS` | `1` (headless) | Set to `0` to watch the browser window |
| `SHADE_TIMEOUT_MS` | `120000` | Ceiling for every browser and page operation |
| `SHADE_AI_TIMEOUT_MS` | `120000` | Ceiling for a single AI provider request |
| `SHADE_AI_MODEL` | provider default | Model used by the AI-powered tools |
| `ANTHROPIC_API_KEY` | — | Required for AI-powered tools (vision, analysis) |
| `OPENAI_API_KEY` | — | Fallback AI provider |

## MCP Client Configuration

### Claude Code

```json
{
  "mcpServers": {
    "shade": {
      "command": "node",
      "args": ["/path/to/shade-mcp/dist/index.js"],
      "env": {
        "SHADE_EFFECTS_DIR": "/path/to/effects"
      }
    }
  }
}
```

### VS Code Copilot

In `.vscode/mcp.json`:

```json
{
  "servers": {
    "shade": {
      "command": "node",
      "args": ["/path/to/shade-mcp/dist/index.js"],
      "env": {
        "SHADE_EFFECTS_DIR": "/path/to/effects"
      }
    }
  }
}
```

### Cursor

In `.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "shade": {
      "command": "node",
      "args": ["/path/to/shade-mcp/dist/index.js"],
      "env": {
        "SHADE_EFFECTS_DIR": "/path/to/effects"
      }
    }
  }
}
```

### Windsurf

In `~/.codeium/windsurf/mcp_config.json`:

```json
{
  "mcpServers": {
    "shade": {
      "command": "node",
      "args": ["/path/to/shade-mcp/dist/index.js"],
      "env": {
        "SHADE_EFFECTS_DIR": "/path/to/effects"
      }
    }
  }
}
```

## Tool Reference

### Result envelope

Every tool result's text is JSON in one envelope, errors included.

- A single result carries a top-level `outcome`, computed from the tool's
  own `status`: `ok` (the check passed or the query answered), `fail` (the
  check ran and its verdict is negative: a parity `mismatch`, a
  `passthrough` filter, `divergent` algorithms, a uniform that did not
  affect output, `meets_target: false`), `warning` (findings to review),
  `skipped` (nothing was testable) or `error` (no verdict). A payload with
  no `status` is `error` when it carries an `error` string. An `outcome`
  key inside the payload never overrides the computed one. Verb-specific
  fields such as `status` and `mismatchPercent` are kept beside it.
- A batch (several effects in one call) is
  `{ outcome, summary, results }`. Each entry carries its own `outcome` and
  `summary` counts entries per outcome. The batch `outcome` is `error` when
  every entry is an error, `fail` when any entry is `fail` or `error`,
  `warning` when any entry is `warning`, `skipped` when every entry is
  skipped, and `ok` otherwise.
- MCP `isError` is set when the call failed as a whole: a single `error`
  result, or a batch in which every entry is an `error`. A `fail` verdict is
  a successful call and does not set `isError`.
- Errors raised inside a tool before it reaches its own handling, such as an
  unresolvable effect selector, and calls the MCP SDK rejects before the
  tool runs (an argument that fails the tool's input schema, an unknown
  tool) arrive in the same envelope with `isError`:
  `{ "outcome": "error", "status": "error", "error": "..." }`. For a
  rejected argument, `error` is the SDK's message, for example
  `MCP error -32602: Input validation error: ...`.

### Browser Tools (8)

These tools require Playwright Chromium; all except `runDslProgram` require a viewer (see [Viewer](#viewer)).

Each result of the six viewer verbs (`compileEffect`, `renderEffectFrame`,
`benchmarkEffectFPS`, `testUniformResponsiveness`, `testNoPassthrough`,
`testPixelParity`), and each batch entry, carries `effect_id`, the effect id
that was requested, so entries match their requests. `page_effect_id` is the
effect the viewer page reports as loaded (null when the viewer does not expose
it) and `backend` is the backend the page reports. When the page shows another
effect or renders on another backend, the entry's `status` is `error`.

| Tool | Description |
|------|-------------|
| `compileEffect` | Compile a shader effect. Return diagnostics for each pass. Use comma-separated effect IDs for a batch. |
| `renderEffectFrame` | Render one frame. Return mean RGB, variance, and blank/monochrome detection. Optionally capture a PNG. |
| `describeEffectFrame` | Render a frame. Analyze the image with AI vision. The tool requires `ANTHROPIC_API_KEY` or `OPENAI_API_KEY`. |
| `benchmarkEffectFPS` | Measure FPS, jitter, and frame timing statistics against a target frame rate. |
| `testUniformResponsiveness` | Check whether each uniform control changes the output: range, dropdown, boolean and vector controls, gates opened first, against a reference captured twice to measure the output's own change between renders. Each control is `pass`, `fail`, `error`, `gated`, `unstable` (no verdict) or `untested`. The status is `ok` only when every measured control passed; any `error` or `unstable` control makes it `error`, otherwise any `fail` makes it `fail`. |
| `testNoPassthrough` | Check that a filter effect modifies the input it consumes: compares output and input at two paused times by mean difference, changed grid pixels and strongly changed pixels; a filter that is the identity at its defaults is measured again with its controls moved. |
| `testPixelParity` | Compare WebGL2 and WebGPU output pixel by pixel within the epsilon tolerance. |
| `runDslProgram` | Render every written output surface at frames 1, 120, and 600 after warmup by default, at 960×540. Return one PNG contact sheet as MCP image content plus metrics for each surface and frame. |

### Analysis Tools (4)

These tools analyze files on disk and do not need a browser.

| Tool | Description |
|------|-------------|
| `checkEffectStructure` | Detect unused files, broken references, naming violations, leaked uniforms, and structural parity issues. |
| `checkAlgEquiv` | Compare the semantics of GLSL/WGSL pairs with AI. The tool requires an AI key. |
| `compareShaders` | Compare shader structure: function names, uniforms, and line counts. |
| `analyzeBranching` | Analyze unnecessary shader branching with AI. Return optimization suggestions. The tool requires an AI key. |

### Knowledge Tools (4)

In-memory search indexes.

| Tool | Description |
|------|-------------|
| `searchEffects` | Search effect library by concept, tag, algorithm, or visual style. |
| `analyzeEffect` | Return the full definition, shader source, uniforms, and passes for an effect ID. |
| `searchShaderSource` | Search GLSL source code across all effects with a regular expression. |
| `searchShaderKnowledge` | Search curated shader documentation by meaning: DSL grammar, GLSL techniques, patterns, and errors. |

### Utility Tools (2)

| Tool | Description |
|------|-------------|
| `listEffects` | List all effects, optionally filtered by namespace. |
| `generateManifest` | Rebuild effect manifest by scanning effects directory. |

## Development

```bash
npm test           # run tests
npm run typecheck  # tsc --noEmit, including tests
npm run build      # build with tsup
npm run dev        # watch mode
```

Tests and typecheck are separate checks. Vitest does not typecheck. Run both commands.

## License

MIT
