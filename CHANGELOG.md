# Changelog

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed

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
