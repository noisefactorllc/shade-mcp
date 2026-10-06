# Changelog

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.4.5] — 2026-10-06

### Fixed

- **`testUniformResponsiveness` sees spatial controls and never tests a
  default.** It compared only the frame's mean color, which blur, scale,
  rotation, offset and warp controls leave unchanged, and it could pick a test
  value equal to the control's default (noisemaker's `filter/bulge`
  `strength` defaults to the 25% point it tested) or one a symmetric input is
  invariant to (a 90-degree rotation of a checkerboard). It now also compares
  a strided per-pixel sample (`pixel_diff`), and tries two values that are
  never the default: the farther of the 25% and 75% points, then the 38.2%
  point. Against noisemaker, `filter/blur`, `bulge`, `channel`, `celShading`,
  `chrome`, `corrupt` and `classicNoisedeck/caustic` now pass.

## [0.4.4] — 2026-10-06

### Fixed

- **`benchmarkEffectFPS` reports the size the pipeline rendered at.** It
  reported the presented canvas, which the viewer's layout sizes: noisemaker's
  demo viewer measured a 256x256 request as 90x90 and warned that the
  resolution was not honored, although the pipeline rendered at 256x256. It now
  reports `pipeline.width`/`height` and falls back to the canvas only when the
  pipeline does not expose them, matching `renderEffectFrame` since 0.4.3.

## [0.4.3] — 2026-10-06

### Fixed

- **`renderEffectFrame` reads the render surface on WebGL2 too.** On WebGL2
  it read the default framebuffer, which is the viewer's presented canvas
  and is sized by the viewer's own layout: noisemaker's demo viewer, laid
  out at 179x179 in a 512x512 window, returned a 179x179 frame for a
  512x512 request although the pipeline rendered at 512x512. WebGPU already
  read the render surface, as `testPixelParity` does on both backends. The
  verb now reads the presented half of the render surface on both backends
  and falls back to the canvas only when no surface can be read, so the
  frame size and metrics describe the render, not its presentation.
- **`testNoPassthrough` reads a global surface input through its read half.**
  A filter whose input is bound to a global surface (`global_o0`) failed with
  `Failed to read input texture global_o0`, because the backend stores the
  pair as `global_o0_read`/`_write`. The input is now read from the half the
  frame presented (`frameReadTextures`), then `global_<name>_read`.
- **An effect whose name contains "error" is no longer a compile failure.**
  Selection treated any viewer status text matching `error` or `failed` as a
  failure, so noisemaker's `filter/scanlineError` ("compiled scanlineError")
  failed every verb. Only the whole words count now.

### Changed

- **`testUniformResponsiveness` measures controls the way they work.** It
  rendered only at t=0 with every control at its default, so speed-like
  controls (inert at t=0) and controls behind an unmet `ui.enabledBy`
  condition (palette controls while the palette mode is off) were reported
  as failures: 117 of noisemaker's 206 effects failed. Each control is now
  measured at t=0 and t=0.37, after opening its `enabledBy` gate by setting
  the gate params (`enabled_with` names them); a gate that cannot be opened
  at run time (a compile-time define, a `not`) is reported as `gated` and
  not measured. Ungated controls that never move the output still fail.

### Added

- **Captures wait for async effects.** After a confirmed selection,
  `BrowserSession.selectEffect()` awaits the viewer pipeline's
  `whenAsyncInitsSettled()` when it exists (noisemaker 1.x provides it),
  bounded by the session timeout. Async CPU effects such as noisemaker's
  `filter/fibers` draw their overlay over several frames, so every capture
  verb measured an unfinished, often blank, frame. Viewers without the method
  are unaffected.

## [0.4.2] — 2026-10-06

### Fixed

- **A uniform that does not affect output is a `fail`, not an `error`.**
  `testUniformResponsiveness` reported a measured but unresponsive uniform
  with `status: "error"`, so the 0.4.0 envelope turned a negative verdict
  into `outcome: "error"` with `isError`. It now returns `status: "fail"`
  (`outcome: "fail"`, no `isError`); `error` is kept for uniforms that could
  not be measured.
- **The computed `outcome` cannot be overridden by the payload.** An
  `outcome` key in a result (for example AI JSON that `analyzeBranching`
  merges into its result) replaced the computed one, and an AI-supplied
  `error` string turned any result into an error. The computed outcome now
  always wins, and an `error` string decides the outcome only for payloads
  that carry no `status`.
- **`renderEffectFrame`, `testUniformResponsiveness` and `testPixelParity`
  read the half of the render surface the last frame presented.** On
  WebGPU they read `global_<surface>_read`, which after the ping-pong swap
  can be the stale half; `testNoPassthrough` already preferred
  `pipeline.frameReadTextures`. All four now read that half first.
- The README states that input-schema validation errors are plain text from
  the MCP SDK and gives the exact batch outcome rule.

## [0.4.1] — 2026-10-06

### Fixed

- **`checkEffectStructure` no longer calls every shader file unused when a
  definition builds its passes at run time.** Since 0.4.0 a `definition.js`
  whose passes come from `flatMap` or a spread is projected with no pass
  list and marked `partial`, and the unused-file check then flagged all of
  its files (19 in noisemaker's `render/pointsBillboardRender`, 9 in
  `render/pointsRender`). When the passes are partial, the check is skipped
  and `unusedFilesUnchecked` gives the reason; the other structure checks
  still run.

## [0.4.0] — 2026-10-06

### Changed

- **One result envelope for every tool (#32).** Each result now carries a
  common `outcome` (`ok`, `fail`, `warning`, `skipped`, `error`), and
  verb-specific verdicts map onto it: a parity `mismatch`, a `passthrough`
  filter, `divergent` algorithms and `meets_target: false` are `fail`.
  **Breaking for clients that parse batch results:** a multi-effect call
  used to return a bare JSON array; it now returns
  `{ outcome, summary, results }`, with an `outcome` on each entry.
  A batch in which every entry is an error is now marked `isError` (it used
  to look like a success), and errors thrown before a tool's own handling,
  such as an unresolvable selector, now arrive as JSON
  (`{ outcome, status, error }`) instead of bare text. The envelope is
  documented in the README.

### Fixed

- **`definition.js` effects are read completely (#30).** `parseDefinitionJs`
  projected the file with regular expressions: it dropped every global
  without a `uniform` key (compile-time `define` globals), read only `type`,
  `min`, `max`, `step` and a numeric `default`, counted one pass per
  `program:` literal anywhere in the source (comments included), and never
  read pass `name`, `type`, `inputs` or `outputs`. Measured against
  noisemaker's 210 effects, it lost data on all of them. The file is now
  parsed with acorn and the effect config is read as literal values,
  whether it is passed to `new Effect(...)` or `super(...)`, default-exported,
  or written as class fields. Nothing is imported or executed. A
  `definition.js` and its equivalent `definition.json` now yield the same
  `globals` and `passes`, and both keep `define` and `ui`. Against
  noisemaker's 210 effects, 208 now match the live module's passes and
  globals exactly.
- **`ImageMetrics` fields mean one thing everywhere (#29).**
  `renderEffectFrame` computed its metrics in the page while `runDslProgram`
  and the library export used `computeImageMetrics`, and four fields
  disagreed. A flat mid-gray frame was `is_essentially_blank` from one verb
  and not the other. `renderEffectFrame` now reads the frame back to Node and
  calls `computeImageMetrics`, the only implementation, whose fields are
  documented on the `ImageMetrics` type. Each field keeps the meaning its
  name states, which is the one `renderEffectFrame` already used except for
  transparency: `is_essentially_blank` is a flat frame (luma variance
  below 1e-4) at any brightness, `unique_sampled_colors` and `is_monochrome`
  count exact 8-bit colors, and `is_all_transparent` requires every sample
  to be transparent. **Changed values:** library and `runDslProgram`
  callers see the flat-frame blank rule and exact color counts;
  `renderEffectFrame` callers see `is_all_transparent` false when any
  sample is opaque.
- **A projection that is not complete says so.** A value that only exists
  at run time (a spread, `Array.from`, `flatMap`, a reference to another
  binding) is left out, and the definition carries `partial: true` with
  `partialReasons` naming each path. `analyzeEffect` returns both, and
  `listEffects` marks such effects `partial`.

## [0.3.3] — 2026-10-06

### Fixed

- **WebGPU browser sessions keep the runner's environment.** `BrowserSession`
  replaced the chromium process environment with the SwiftShader Vulkan
  variables. On sandboxed runners that reach the web only through a filtering
  proxy, the replacement dropped `HTTP(S)_PROXY`/`NO_PROXY`, so the viewer
  page's CDN import failed with `ERR_NAME_NOT_RESOLVED` before the renderer
  global appeared and session setup timed out. The ICD variables are now
  merged over `process.env`, with a lifecycle regression asserting a proxy
  variable survives.
- **The viewer server binds on restricted runners.** Verification sandboxes
  refuse an ephemeral loopback `listen(0)` with `EPERM` while permitting
  explicit fixed ports, which failed every server-binding test there.
  Ephemeral requests now bind through a candidate chain — an `NM_TS_PORT`
  override, the requested port, then a rotating fixed fallback range — each
  attempt on a fresh server, rejecting only after every candidate fails;
  an explicitly requested nonzero port keeps its exact single-attempt
  semantics. A release after an acquire also waits for the previous server's
  close to drain, fixing the re-bind-during-teardown connection reset that
  the traversal canary documents.
- The dist self-contained check stages its drop with a plain JS copy instead
  of `fs.cpSync({ recursive: true })`, whose native path fails with `EACCES`
  on overlayfs under Node ≥ 26. Same assertions, portable staging.

## [0.3.2] — 2026-10-04

### Changed

- Workflows declare least-privilege token permissions. Runtime behavior and
  tool results are unchanged from 0.3.1.

## [0.3.1] — 2026-10-02

### Changed

- **Browser verb results are bound to the requested effect and backend.**
  `compileEffect`, `renderEffectFrame`, `benchmarkEffectFPS`,
  `testUniformResponsiveness`, `testNoPassthrough` and `testPixelParity`
  used to wait on the viewer's status text, which still describes the
  previous effect right after a selection — so an `ok` result could report
  the previous graph, and `setBackend()` returned silently when the page
  backend never reached the target. Selections now wait for a bound
  readiness signal inside the page (a pipeline rebuilt after the selection —
  graph swap, compile generation, or an `isCompiling` round-trip — or the
  `currentEffect` global confirming the requested id), `setBackend()`
  rejects on timeout, and every result reports the page-confirmed effect id
  (`effect_id`) and the actual backend (`pipeline.backend.getName()`).
  A disagreement with the request is a `status: 'error'` result, and when the
  viewer does not expose its current effect's identity at all the verbs fail
  closed with an error instead of reporting an unconfirmed result. A viewer
  that exposes rebuild signals must prove a graph was built after the
  selection even when re-selecting the effect it already shows, the
  completion of a compile that was already in flight before the selection is
  never treated as that evidence, backend-switch failures report the
  page-confirmed effect id and backend too, and every parity error result —
  including a capture size mismatch — carries the final leg's page-confirmed
  identity.

- **`testNoPassthrough` now compares the rendered output with the input
  texture the effect consumes, at one fixed paused time.** Filter
  classification uses the pass input key (a pipeline input name such as
  `inputTex`) or a value naming a pipeline input — never a substring of the
  bound texture id, which reported every compiled graph as "not a filter
  effect" and misclassified generators whose texture ids contain "input".
  The verdict no longer depends on animation or unique-color count:
  `passthrough` means the output matches the input within the reported
  threshold (`0.01` mean per-channel difference), and the result carries the
  measured difference (`similarity`) and the consumed `inputTexture`. The
  capture reads through the backend's `readPixels` on both WebGL2 and
  WebGPU. The result no longer includes `temporalDiff` or `uniqueColors`.

- **`testUniformResponsiveness` no longer reports `ok` while uniforms fail.**
  The overall status used to be `ok` as soon as any single uniform moved the
  output, so an effect with one live control and ten dead ones read as
  healthy, and `toolResult()` set no `isError`. The status is now `ok` only
  when at least one uniform was tested and *every* tested uniform affected
  output; `error` when any tested uniform did not respond or could not be
  measured, with `details` naming those uniforms; `skipped` when nothing was
  testable. Callers that gated on the old `ok` will see `error` for effects
  with dead controls.
- **The result now carries the measurements.** Each tested uniform is also
  reported as a structured entry — `{ name, uniform, default_value,
  test_value, luma_diff, max_channel_diff, responds }` (plus `error` when the
  test render could not be captured) — and the result states the threshold
  used (`0.002`). The legacy `tested_uniforms` strings (`name:pass` /
  `name:fail` / `name:error`) are unchanged for compatibility.

## [0.2.2] — 2026-08-31

The third 0.2.x regression in the same blind spot: this package is also
consumed as a bare file drop, and nothing in CI ran the shipped files that
way. 0.2.0 broke portable's MCP server outright and no test noticed for
seventeen days.

### Fixed

- **The advertised version no longer reads a file that the drop does not
  ship.** 0.2.0 began reading the MCP handshake version from
  `../package.json` at runtime. That resolves in this repo and under npm
  (`files: ["dist"]` puts package.json beside `dist/`), so every test stayed
  green. The release tarball is `tar -C dist .` — the contents of `dist`,
  with nothing above them — so portable, which vendors that flat into
  `vendor/shade-mcp/` and launches `vendor/shade-mcp/index.js` as its MCP
  server, looked for a `vendor/package.json` the tarball cannot supply. Its
  shade server threw `Cannot find module '../package.json'` at import on
  every start from v0.2.1 (2026-08-14). noisemaker was untouched: it runs the
  server via `npx github:` and vendors no `index.js`. The version is now
  substituted at build time from package.json, which stays the single source,
  so the drift fixed in 0.2.0 stays fixed.

### Added

- `scripts/check-dist-selfcontained.mjs`, run from `postbuild` beside
  `check:dist`. `check-dist-externals` covers what the dist *imports*; a reach
  through `createRequire` is the same contract violation and a scan for bare
  specifiers cannot see it. The new check runs the built entry the way a
  vendoring consumer does — staged with no package.json above it — and
  asserts it completes an MCP handshake advertising the right version.

## [0.2.1] — 2026-08-13

Both fixes here are 0.2.0 regressions in the same blind spot: noisemaker and
portable consume this package as a vendored file drop and drive it from a page
built with `page.setContent()`, and nothing in CI exercised either of those.
0.2.0 broke both, and noisemaker's shader test run — the gate on publishing
`shaders.noisedeck.app` — went red.

### Fixed

- The vendored dist is self-contained again. Declaring `zod` a direct
  dependency in 0.2.0 made tsup leave it external, so `dist/harness/index.js`
  shipped `import { z } from "zod"` — an unresolvable specifier for consumers
  that copy the dist and never install this package. It is bundled again;
  `playwright`, `openai` and `@anthropic-ai/sdk` stay external because the
  consumers really do supply those.
- The viewer server answers cross-origin requests from opaque (`null`) and
  loopback origins. 0.2.0 removed `Access-Control-Allow-Origin: *` outright,
  which also refused the `setContent` pages every consumer uses to import the
  renderer as an ES module — indistinguishable from the server being down, and
  it hung their suites on a timeout. A page at a remote origin still gets no
  header. The dotfile refusal, which is what actually keeps `.anthropic` and
  `.openai` unreadable, is unchanged.

### Added

- `npm run check:dist` asserts what each built entry point may import: nothing
  outside the declared dependencies, and for the vendored entries nothing the
  consumers do not already have. It runs on every build. The zod break would
  have failed it.
- The browser smoke test now also loads the renderer through the consumer
  pattern — `setContent`, then a cross-origin ES module import — instead of
  only calling tools over stdio.

## [0.2.0] — 2026-08-13

### Security

- The local viewer server no longer sends `Access-Control-Allow-Origin: *`.
  Any page open in the user's browser could previously read whatever the server
  served, which included `.anthropic` / `.openai` key files whenever
  `SHADE_VIEWER_ROOT` pointed at a workspace root — as the docs used to suggest.
- Dotfiles, and anything beneath a dot-directory, are refused by the file server.
- Path containment now respects segment boundaries and re-checks symlinks. This
  closes a traversal in which an encoded slash (`..%2f`) survived URL
  normalization and reappeared once the handler decoded the path.
- `resolveEffectDir` rejects absolute and traversal effect IDs rather than
  joining caller-supplied input straight onto the effects directory, which had
  let a tool argument read files elsewhere on disk.
- A malformed request target returns 400 instead of throwing an uncaught
  `URIError` that terminated the whole server process.
- `matchEffects` escapes its pattern instead of compiling caller-supplied text
  as a regular expression, where `(a|b)/*` matched by alternation and a
  backtracking pattern could stall the process.

### Fixed

- AI provider calls are bounded. They previously had no timeout at all, so a
  stalled provider held the caller's browser slot for the SDK default of about
  ten minutes; requests now time out after `SHADE_AI_TIMEOUT_MS` with retries
  capped at one, so a stall cannot multiply the wait.
- `SIGINT` and `SIGTERM` tear down live browser sessions before exiting. An MCP
  client killing the server used to leave Chromium running and the viewer port
  bound.
- The effect index is rebuilt rather than cached for the life of the process,
  so an effect written during a session is visible to `searchEffects` and
  `listEffects` instead of missing until restart. Concurrent lookups share one
  build, and `generateManifest` drops the cached index after rewriting the
  library on disk.
- `describeEffectFrame` reports why a render failed instead of the bare
  "Failed to render frame", and normalizes model output that is not a JSON
  object so callers always see the same shape.
- A failed `setup()` handed back the browser slot but never the server it had
  already acquired, while `teardown()` released both unconditionally — so the
  `finally` block every tool uses could return resources the session never held.
- A non-numeric `SHADE_MAX_BROWSERS` became `NaN`, making every capacity check
  false and leaving browser tools queued forever with no error.
  `resetBrowserQueue()` now resolves its waiters instead of dropping them.
- `analyzeBranching` no longer lets model output overwrite its own computed
  status, and `checkAlgEquiv` keeps the program name it matched on disk.
- `benchmarkEffectFPS`, `testUniformResponsiveness` and `testNoPassthrough`
  switch the viewer to the requested backend before measuring, instead of
  labelling results with a backend they never selected.
- The server reports the real package version over the MCP handshake; it had
  said `0.1.0` since the first release.

### Added

- Tool failures carry `isError`, so a caller can tell a failed call from a
  successful one that found nothing.
- `npm run typecheck`, which also covers the `tests/` directory.
- A browser smoke test (`scripts/browser-smoke.mjs`) drives the built server
  against a real viewer in CI. The unit suite mocks Playwright, so it cannot
  tell whether the browser tools work at all — a wrong viewer root made every
  one of them time out while the suite stayed green.
- `SHADE_SWIFTSHADER=1` enables Chromium's software rasterizer for machines
  with no GPU. It is opt-in: forcing it where a real GPU exists would quietly
  change what every render and parity comparison produces.

### Changed

- **The default AI models are current-generation and undated**: `claude-opus-5`
  and `gpt-5.2`, replacing `claude-sonnet-4-5-20250929` and `gpt-4o`. The dated
  id pinned a snapshot that ages out silently. Both remain overridable with
  `SHADE_AI_MODEL` — set it to `claude-sonnet-5` for a cheaper default.
- **AI replies are no longer capped at 500 tokens.** Every AI-backed tool asks
  for JSON, and that ceiling truncated the reply mid-object; the parse then
  failed and the caller silently received the fallback shape instead of an
  analysis. The default is 2000, with the vision and comparison tools at 1500
  and the branching analysis at 3000.
- **`SHADE_TIMEOUT_MS` defaults to two minutes rather than five.** Five minutes
  is indistinguishable from a hang in an agent loop; raise it with the variable
  if a legitimately slow compile needs the headroom.
- Every dependency advisory is resolved and `npm audit` reports nothing. Nine
  of the ten came out through lockfile updates that leave the declared ranges
  untouched; the last needed an override pinning esbuild past the affected
  range, since tsup's own range stops one release short of the fix.
- **`describeEffectFrame` no longer returns the rendered image by default.**
  The frame still goes to the vision model; echoing megabytes of base64 back to
  the caller spent context it had not asked for. Pass `capture_image: true` to
  get it.
- Every browser and page operation shares one configurable ceiling
  (`SHADE_TIMEOUT_MS`), replacing nine hardcoded five-minute literals and two
  duplicate constants. The AI model is selectable with `SHADE_AI_MODEL`.
- **Chromium runs headless by default.** A visible window on every tool call is
  noise, and launching headed fails outright on a machine with no display. Set
  `SHADE_HEADLESS=0` to watch the browser again.
- `zod` is declared as a direct dependency instead of resolving through the
  MCP SDK.
- Published packages contain only `dist/`, README and LICENSE.
- Documentation records the viewer requirement, the full environment variable
  set, and their real defaults.
- **The documented noisemaker viewer configuration was wrong and is fixed.**
  `SHADE_VIEWER_ROOT` has to be the repository root with `SHADE_VIEWER_PATH`
  set to `/demo/shaders/`; the page lives there but imports the engine from
  `shaders/src/` at the top level, so serving only the page's directory made
  every module request 404 and the renderer global never appeared. Following
  the old instructions, every browser tool timed out. Verified by driving the
  real tools against noisemaker: compile and render now finish in seconds.

## [0.1.4] — 2026-06-15

Releases through 0.1.4 are described in the
[GitHub releases](https://github.com/noisefactorllc/shade-mcp/releases).
