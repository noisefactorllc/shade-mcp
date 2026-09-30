# shade-mcp

MCP server for shader effect development. TypeScript, ESM only, Node 22+.

## Build & Test

```bash
npm run build    # tsup (esbuild) → dist/index.js
npm test         # vitest
```

## Architecture

- `src/index.ts` — Entry point. Registers 18 tools with McpServer, starts stdio transport.
- `src/config.ts` — Config from env vars (SHADE_EFFECTS_DIR, SHADE_VIEWER_PORT, SHADE_VIEWER_ROOT, SHADE_VIEWER_PATH, SHADE_BACKEND, SHADE_PROJECT_ROOT, SHADE_GLOBALS_PREFIX).
- `src/ai/provider.ts` — AI abstraction. Anthropic-first, OpenAI fallback. Reads API keys from env or dotfiles.
- `src/formats/` — Effect definition parsers. Auto-detects definition.json (preferred) vs definition.js (regex extraction).
- `src/harness/` — Browser automation. `server-manager.ts` (ref-counted HTTP server), `browser-session.ts` (Playwright lifecycle), `pixel-reader.ts` (image metrics).
- `src/tools/browser/` — 8 browser-based tools (compile, render, describe, benchmark, uniforms, passthrough, parity, dsl).
- `src/tools/analysis/` — 4 tools analyze files on disk (structure, alg-equiv, compare, branching).
  `structure.ts` detects GLSL name collisions: uniforms versus functions, reserved words, and built-in shadowing.
  `compare.ts` exports `extractFunctionNames`, `extractUniforms`, and `stripComments` helpers for GLSL/WGSL static analysis.
- `src/tools/knowledge/` — 4 knowledge tools (search-effects, analyze-effect, search-source, search-knowledge).
- `src/tools/utility/` — 2 utility tools (list-effects, generate-manifest).
- `src/knowledge/` — TF-IDF vector DB, curated shader knowledge, effect index, GLSL index.

## Tool Registration Pattern

Each tool exports a `register*` function taking `McpServer`:

```typescript
import { z } from 'zod'

export const myToolSchema = {
  param: z.string().describe('Description'),
}

export function registerMyTool(server: any): void {
  server.tool('myTool', 'Tool description.', myToolSchema, async (args: any) => {
    return { content: [{ type: 'text', text: JSON.stringify(result) }] }
  })
}
```

## Per-Project Setup

Configure shade-mcp entirely through environment variables.
Point each project's MCP client to shade-mcp's binary.
Supply the environment variables for that project.

**VS Code** (`.vscode/mcp.json`):
```json
{
  "servers": {
    "shader-tools": {
      "type": "stdio",
      "command": "node",
      "args": ["/path/to/shade-mcp/dist/index.js"],
      "env": {
        "SHADE_EFFECTS_DIR": "${workspaceFolder}/effects",
        "SHADE_PROJECT_ROOT": "${workspaceFolder}",
        "SHADE_VIEWER_ROOT": "${workspaceFolder}/viewer",
        "SHADE_VIEWER_PATH": "/index.html",
        "SHADE_GLOBALS_PREFIX": "__myProject"
      }
    }
  }
}
```

**Environment Variables:**

| Variable | Required | Default | Description |
|---|---|---|---|
| `SHADE_EFFECTS_DIR` | Yes | `./effects` | Directory containing effect definitions |
| `SHADE_PROJECT_ROOT` | No | cwd | Project root (for .anthropic/.openai key files) |
| `SHADE_VIEWER_ROOT` | No | `$PROJECT_ROOT/viewer` | HTTP server root. Use the smallest directory containing the viewer and its imports. Noisemaker requires its repository root. The server exposes non-dotfiles within this root. |
| `SHADE_VIEWER_PATH` | No | `/` | Path to viewer index.html within viewer root |
| `SHADE_VIEWER_PORT` | No | `0` (auto) | HTTP server port (0 = OS-assigned to avoid conflicts) |
| `SHADE_GLOBALS_PREFIX` | No | `__shade` | Window globals prefix (e.g., `__portable` → `__portableCanvasRenderer`) |
| `SHADE_DSL_RENDERER_MODULE` | No | `/shaders/src/index.js` | Root-relative or HTTPS module exporting `CanvasRenderer` and `compile` for the fresh DSL renderer |
| `SHADE_DSL_ASSETS_BASE` | No | `/shaders` | Root-relative or HTTPS asset base for the fresh DSL renderer |
| `SHADE_DSL_USE_BUNDLES` | No | `false` | Use bundled effect assets for DSL batch rendering; Portable's CDN requires `true` |
| `SHADE_BACKEND` | No | `webgl2` | Default rendering backend |
| `SHADE_MAX_BROWSERS` | No | `1` | Max concurrent browser sessions (pipelining) |
| `SHADE_HEADLESS` | No | `1` (headless) | Set `0` to show the browser window. Headless mode is required when no display is available. |
| `SHADE_TIMEOUT_MS` | No | `120000` | Ceiling for every browser/page operation (`session.timeoutMs`) |
| `SHADE_AI_TIMEOUT_MS` | No | `120000` | Maximum duration of one AI provider request. The retry limit is 1. |
| `SHADE_AI_MODEL` | No | provider default | Overrides the model for AI-powered tools |

## Consumer Projects

### noisemaker (`../noisemaker`)
- The shared compatibility checkpoint is `../noisemaker/LEDGER.md`, section
  "AI development contract (llms-full.txt)". Follow its paired audit and
  validation recipe for changes to either project; the pass owns integration
  work in both checkouts even when only one supplied the trigger.
- Vendors `dist/harness/`, `dist/ai/`, `dist/formats/`, and `dist/analysis/`
  into `vendor/shade-mcp/` through `pull-shade-mcp`
- Imports `checkEffectStructure` directly from vendored harness (library mode, no MCP)
- Test harness: `shaders/tests/test-harness.js --structure` runs structure checks including name collision detection
- Structure-only mode: `--structure-only --effects "*/*"` runs all on-disk checks without a browser
- The release workflow dispatches Noisemaker's `pull-shade-mcp.yml` to
  refresh the vendor copy. Noisemaker's immutable `.mcp.json` pin is a
  separate delivery path. Reconcile both with the tested Shade source;
  never infer delivery from a local build, hand-edit generated vendor files,
  or replace the pin with a floating branch.
- Record both source SHAs, the MCP pin, vendor release/source, paired tests,
  and required exact-commit CI before advancing the shared checkpoint and
  `llms-full.txt` snapshot together. Pending release, pin, vendor, or browser
  validation work leaves the pass incomplete. Existing publication approval
  rules still apply.

### portable (`../portable`)
- Vendors full `dist/` via `pull-shade-mcp` script (clones from GitHub, builds, copies)
- Uses shade-mcp as MCP server and as library (harness imports)
- Gets name collision detection automatically on next `pull-shade-mcp` run
- Consumer contract: apps that read portable effect JSON MUST wrap the effect data in a real `Effect` instance.
  Use `new Effect({...})` before registering the effect with the runtime.
  Plain object literals lack `Effect.prototype.asyncInit` and crash the pipeline's lifecycle guard.
  See `portable/docs/FORMAT.md` → Registration → Consumer Contract.

### shade (`../shade`)
- Vendors only `dist/knowledge/` via `pull-shade-mcp` (knowledge module for augmenting prompts)
- In-app agent in `server/tools/index.js` implements tool definitions as plain objects
- `server/routes/chat.js` calls `executeToolCall()` directly (not via MCP protocol)
- Currently uses: `search_effects`, `search_shader_source`, `search_shader_knowledge`, `analyze_effect`, `list_effects`
- To add `checkEffectStructure` to shade's in-app agent, add its tool definition to the `tools` array.
  Implement an `executeToolCall` case that calls the function from a vendored harness module.

## Viewer

shade-mcp does not include a viewer.
Consumers must provide one through `SHADE_VIEWER_ROOT`, or through the `viewerRoot` option in library mode.
The seven viewer-driven browser tools require window globals that match the configured prefix.
The default is `__shade*`. Set `SHADE_GLOBALS_PREFIX` to change the prefix.
`runDslProgram` uses a fresh blank page and imports the configured Noisemaker
module and assets. Its defaults resolve under `SHADE_VIEWER_ROOT` when that is
the Noisemaker repository root. For Portable's built-in Noisemaker DSL, set
`SHADE_DSL_RENDERER_MODULE=https://shaders.noisedeck.app/1/noisemaker-shaders-core.esm.js`,
`SHADE_DSL_ASSETS_BASE=https://shaders.noisedeck.app/1`, and
`SHADE_DSL_USE_BUNDLES=true`. Keep Portable's viewer root/path/globals for the
seven viewer-driven tools. The fresh batch does not register Portable's authored
`user.*` effects; support for those requires shared browser-safe registration.
