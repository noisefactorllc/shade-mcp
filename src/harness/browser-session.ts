import { chromium, type Browser, type BrowserContext, type Page, type ConsoleMessage, type Route } from 'playwright'
import { dirname, join, resolve } from 'node:path'
import { existsSync } from 'node:fs'
import type { Backend } from '../config.js'
import type { BrowserSessionOptions, CompileResult, RenderResult, BenchmarkResult, ImageMetrics, ViewerGlobals, EffectSelectionResult } from './types.js'
import { DEFAULT_GLOBALS, globalsFromPrefix } from './types.js'
import { acquireServer, releaseServer, getServerUrl } from './server-manager.js'
import { acquireBrowserSlot, releaseBrowserSlot } from './browser-queue.js'
import { trackSession, untrackSession } from './live-sessions.js'
import { getConfig } from '../config.js'

interface ConsoleEntry {
  type: string
  text: string
}

function getBrowserLaunchOptions(headless: boolean, backend: Backend): {
  headless: boolean
  args: string[]
  env?: Record<string, string>
} {
  const args = ['--disable-gpu-sandbox']

  if (backend === 'webgpu') {
    args.push(
      '--enable-unsafe-webgpu',
      '--enable-features=Vulkan',
      '--enable-webgpu-developer-features',
      process.platform === 'darwin' ? '--use-angle=metal' : '--use-angle=vulkan'
    )
  } else {
    if (process.platform === 'darwin') {
      args.push('--use-angle=metal')
    }
  }

  // A GPU-less machine — a CI runner, a container — has no hardware GL driver,
  // so context creation fails outright. Chromium's software rasterizer covers
  // that, but it is opt-in: forcing it where a real GPU exists would quietly
  // change what every render and parity comparison produces.
  if (process.env.SHADE_SWIFTSHADER === '1' || process.env.SHADE_SWIFTSHADER === 'true') {
    args.push('--enable-unsafe-swiftshader')
  }

  return { headless, args }
}

function swiftshaderEnabled(): boolean {
  return process.env.SHADE_SWIFTSHADER === '1' || process.env.SHADE_SWIFTSHADER === 'true'
}

/**
 * GPU-less machines usually have no system Vulkan driver either, so Dawn's
 * WebGPU backend finds no ICD: adapter enumeration is erratic and device
 * requests die with Dawn's "A valid external Instance reference no longer
 * exists". Chromium ships its own SwiftShader Vulkan ICD next to the browser
 * binary — point the Vulkan loader at it so WebGPU renders deterministically.
 */
export function swiftshaderVulkanEnv(): Record<string, string> {
  try {
    const bundleDir = dirname(chromium.executablePath())
    const icd = join(bundleDir, 'vk_swiftshader_icd.json')
    if (!existsSync(icd)) return {}
    const ld = process.env.LD_LIBRARY_PATH ? `${bundleDir}:${process.env.LD_LIBRARY_PATH}` : bundleDir
    // VK_DRIVER_FILES is the loader-1.3.4+ variable; VK_ICD_FILENAMES covers
    // older loaders. Chromium 153 ignores the legacy name, so both are set.
    return { VK_DRIVER_FILES: icd, VK_ICD_FILENAMES: icd, LD_LIBRARY_PATH: ld }
  } catch {
    return {}
  }
}

// ---------------------------------------------------------------------------
// In-page selection helpers. These run serialized inside the page (or against
// fake viewers in tests), so each must be self-contained: no closure
// references to module scope. They implement the bound selection contract of
// issue #34: a wait that resolves only when the page finished building the
// requested effect AFTER this selection — never on viewer status text alone,
// which still describes the previous effect right after a selection.
// ---------------------------------------------------------------------------

/**
 * In-page bound selection (issue #34): captures the viewer's pre-selection
 * state, dispatches the change event, then polls until the viewer finished
 * building the requested effect AFTER this selection — or reports a viewer
 * failure bound to it. Resolves with the page-confirmed identity either way;
 * never throws — the caller maps timeouts to errors.
 *
 * Runs serialized inside the page (or against fake viewers in tests), so it
 * must be self-contained: no closure references to module scope. The
 * pre-selection state MUST be captured here, inside the page: a snapshot
 * passed in from Node arrives deserialized, and its graph object identity —
 * the primary rebuild signal — would not survive the boundary.
 */
function selectAndAwaitEffect({ effectId, globals, timeout }: {
  effectId: string
  globals: ViewerGlobals
  timeout: number
}): Promise<EffectSelectionResult> {
  return new Promise<EffectSelectionResult>((resolve) => {
    const w = window as any
    const readId = (): string | null => {
      const e = w[globals.currentEffect]
      if (!e) return null
      if (typeof e === 'string') return e
      // Effect entries carry the identity (noisemaker: namespace + name);
      // some viewers expose it as id/effectId. A bare `name` is NOT an id —
      // with a namespace it would be ambiguous — so it is not matched.
      const ns = typeof e.namespace === 'string' ? e.namespace
        : e.instance && typeof e.instance.namespace === 'string' ? e.instance.namespace : null
      const nm = typeof e.name === 'string' ? e.name
        : e.instance && typeof e.instance.name === 'string' ? e.instance.name : null
      if (ns && nm) return `${ns}/${nm}`
      if (typeof e.id === 'string') return e.id
      if (typeof e.effectId === 'string') return e.effectId
      return null
    }
    const genName = globals.pipelineGeneration

    const p0 = w[globals.renderingPipeline]
    const before = {
      effectId: readId(),
      ready: !!(p0 && !p0.isCompiling && p0.graph?.passes && p0.graph.passes.length > 0),
      // Whether a compile was ALREADY in flight when the selection fired: the
      // graph it eventually produces (and its generation bump) belong to that
      // pre-existing build, not to this selection, so they are not evidence
      // of a post-selection build.
      compiling: !!(p0 && p0.isCompiling),
      graph: p0 ? (p0.graph ?? null) : null,
      generation: typeof genName === 'string' && typeof w[genName] === 'number' ? w[genName] : null,
      statusText: document.getElementById('status')?.textContent || '',
    }

    const select = document.getElementById('effect-select') as HTMLSelectElement | null
    if (select) {
      select.value = effectId
      select.dispatchEvent(new Event('change'))
    }

    const start = Date.now()
    let compilingNow = before.compiling
    // True once a compile START is observed after the selection (isCompiling
    // going true between polls). The tail of a compile that was already in
    // flight before the selection never sets this.
    let newBuildObserved = false
    const poll = () => {
      const p = w[globals.renderingPipeline]
      const backendName: string = p?.backend?.getName?.() || 'unknown'
      const idNow = readId()
      const graph = p ? (p.graph ?? null) : null
      const passes = p?.graph?.passes
      const generation = typeof genName === 'string' && typeof w[genName] === 'number' ? w[genName] : null
      const statusText: string = document.getElementById('status')?.textContent || ''

      if (Date.now() - start > timeout) {
        resolve({
          status: 'error',
          message: `Timed out after ${timeout} ms waiting for the viewer to finish building ${effectId}`
            + (idNow && idNow !== effectId ? ` (the viewer is still showing ${idNow})`
              : !idNow ? ' (the viewer does not report which effect it is showing)' : ''),
          effectId: idNow ?? null,
          backend: backendName,
          passes: null,
        })
        return
      }

      if (!p) { setTimeout(poll, 50); return }

      // Compile START observed after the selection (isCompiling going true
      // between polls)? The tail of a compile already in flight before the
      // selection is a continuation, not a new start.
      const compiling = !!p.isCompiling
      if (compiling && !compilingNow) newBuildObserved = true
      compilingNow = compiling

      // While a compile runs, the graph in front of us is mid-rebuild — the
      // passes are whatever the previous build left; never accept them.
      if (compiling) { setTimeout(poll, 50); return }

      const ready = !!(passes && passes.length > 0)
      // Evidence of a graph built after THIS selection. When nothing was
      // compiling at selection time, a graph swap, a bumped compile
      // generation, or an observed compile start all prove it. When a
      // compile was already in flight, its eventual graph swap and single
      // generation bump belong to THAT build — evidence must be attributable
      // to the new selection: a compile START observed after the selection,
      // or a generation advance of two or more (the in-flight build's
      // completion plus another build's). A single +1 bump is exactly what
      // the pre-existing build's completion looks like, so it is never
      // accepted; with no generation global, only an observed start counts.
      const graphChanged = graph !== before.graph
        || (before.generation !== null && generation !== null && generation !== before.generation)
      const generationDelta = before.generation !== null && generation !== null
        ? generation - before.generation
        : null
      const rebuilt = before.compiling
        ? ready && (newBuildObserved || (generationDelta !== null && generationDelta >= 2))
        : ready && (graphChanged || newBuildObserved)
      const idMatches = idNow !== null && idNow === effectId
      const statusChanged = statusText !== before.statusText
      const failing = /error|failed/.test(statusText.toLowerCase())
      // Viewers that expose NO rebuild signal at all (no compile generation,
      // no isCompiling flag) cannot prove a rebuild happened; for those, a
      // page-confirmed effect id on a ready graph is the strongest available
      // binding. Viewers that do expose a signal (noisemaker does both) must
      // always wait for it.
      const hasRebuildSignal = generation !== null || ('isCompiling' in p)

      // A confirmed mismatch: the page rebuilt after this selection but now
      // reports a different, readable effect id. Fail closed immediately with
      // the page-confirmed identity instead of measuring the wrong graph.
      if (ready && rebuilt && idNow !== null && idNow !== effectId) {
        resolve({
          status: 'error',
          message: `The viewer is showing ${idNow}, not the requested ${effectId}`,
          effectId: idNow,
          backend: backendName,
          passes: null,
        })
        return
      }

      // Compile failure. Two guards against the PREVIOUS effect's failure
      // text: the failure must be bound to this selection (identity or a
      // rebuild observed) and must be fresh (the text changed, or the
      // pipeline rebuilt since the selection).
      if (failing && (idMatches || rebuilt) && (statusChanged || rebuilt)) {
        resolve({
          status: 'error',
          message: statusText || 'Compilation failed',
          effectId: idNow ?? null,
          backend: backendName,
          passes: (passes || []).map((pass: any, i: number) => ({ id: pass.name || `pass_${i}`, status: 'error' as const })),
        })
        return
      }

      // Ready, bound to the request: a graph built after this selection whose
      // identity the page confirms, or — for viewers that expose no rebuild
      // signal at all — a ready graph whose identity the page confirms. The
      // pre-selection graph is NEVER accepted on a viewer with rebuild
      // signals, even when it already shows the requested effect: right
      // after the selection an asynchronous rebuild may still be pending,
      // and "nothing changed yet" cannot distinguish "no rebuild coming"
      // from "rebuild in flight". A rebuild WITHOUT page-confirmed identity
      // is likewise never accepted — the wait keeps polling and fails closed
      // on timeout.
      if (ready && ((rebuilt && idMatches)
        || (!hasRebuildSignal && idMatches))) {
        resolve({
          status: 'ok',
          effectId: idNow,
          backend: backendName,
          passes: passes.map((pass: any, i: number) => ({ id: pass.name || `pass_${i}`, status: 'ok' as const })),
        })
        return
      }

      setTimeout(poll, 50)
    }
    poll()
  })
}

/**
 * Reads the page's current effect identity and backend name WITHOUT any
 * selection. Self-contained (runs serialized inside the page or against fake
 * viewers in tests). Verbs use this to bind even their failure results to
 * what the page actually holds — a backend-switch failure, for example,
 * reports the backend the page is really on and the effect it is really
 * showing, when the page exposes them.
 */
function readPageIdentity({ globals }: { globals: ViewerGlobals }): { effectId: string | null; backend: string | null } {
  const w = window as any
  const e = w[globals.currentEffect]
  let effectId: string | null = null
  if (e) {
    if (typeof e === 'string') effectId = e
    else {
      const ns = typeof e.namespace === 'string' ? e.namespace
        : e.instance && typeof e.instance.namespace === 'string' ? e.instance.namespace : null
      const nm = typeof e.name === 'string' ? e.name
        : e.instance && typeof e.instance.name === 'string' ? e.instance.name : null
      if (ns && nm) effectId = `${ns}/${nm}`
      else if (typeof e.id === 'string') effectId = e.id
      else if (typeof e.effectId === 'string') effectId = e.effectId
    }
  }
  const p = w[globals.renderingPipeline]
  const backend = p?.backend?.getName?.()
    ? String(p.backend.getName())
    : typeof w[globals.currentBackend] === 'function' ? String(w[globals.currentBackend]()) : null
  return { effectId, backend }
}

/**
 * Whether a page-reported backend name is the requested backend. Names come
 * in two conventions: `pipeline.backend.getName()` ('WebGL2'/'WebGPU' in
 * noisemaker) and the `currentBackend` viewer global ('glsl'/'wgsl').
 */
export function backendNameMatches(actual: string | null | undefined, requested: Backend): boolean {
  if (!actual) return false
  const name = actual.toLowerCase()
  return requested === 'webgpu'
    ? name === 'webgpu' || name === 'wgsl'
    : name === 'webgl2' || name === 'webgl' || name === 'glsl'
}

/**
 * Returns a human-readable problem when a selection outcome does not match
 * the request — selection failure, wrong effect, wrong backend — or null
 * when the page confirmed the requested effect on the requested backend.
 * The verbs surface this as a `status: 'error'` result instead of silently
 * measuring whatever the page happens to hold (issue #34).
 */
export function effectSelectionProblem(
  selection: EffectSelectionResult,
  effectId: string,
  requestedBackend: Backend,
): string | null {
  if (selection.status === 'error') return selection.message || `Failed to select ${effectId}`
  if (selection.effectId !== null && selection.effectId !== effectId) {
    return `The viewer is showing ${selection.effectId}, not the requested ${effectId}`
  }
  if (!backendNameMatches(selection.backend, requestedBackend)) {
    return `The viewer is rendering on ${selection.backend}, not the requested ${requestedBackend}`
  }
  return null
}

export class BrowserSession {
  private options: Required<Omit<BrowserSessionOptions, 'globals' | 'viewerPath' | 'timeoutMs'>>
  private viewerPath: string
  /** Ceiling for every page operation this session performs. */
  public readonly timeoutMs: number
  private browser: Browser | null = null
  private context: BrowserContext | null = null
  public page: Page | null = null
  public globals: ViewerGlobals
  private baseUrl = ''
  private consoleMessages: ConsoleEntry[] = []
  private _isSetup = false
  private _serverAcquired = false
  private _slotAcquired = false

  constructor(opts: BrowserSessionOptions) {
    const config = getConfig()
    this.globals = opts.globals ?? (config.globalsPrefix ? globalsFromPrefix(config.globalsPrefix) : DEFAULT_GLOBALS)
    this.viewerPath = opts.viewerPath ?? config.viewerPath ?? '/'
    this.timeoutMs = opts.timeoutMs ?? config.timeoutMs
    this.options = {
      backend: opts.backend,
      blankPage: opts.blankPage ?? false,
      // Headless by default: a visible window on every tool call is noise, and
      // launching headed fails outright wherever there is no display. Opt back
      // in with { headless: false } or SHADE_HEADLESS=0.
      headless: opts.headless ?? !(process.env.SHADE_HEADLESS === '0' || process.env.SHADE_HEADLESS === 'false'),
      viewerPort: opts.viewerPort ?? config.viewerPort,
      viewerRoot: opts.viewerRoot ?? process.env.SHADE_VIEWER_ROOT ?? resolve(config.projectRoot, 'viewer'),
      effectsDir: opts.effectsDir ?? config.effectsDir
    }
  }

  async setup(): Promise<void> {
    if (this._isSetup) throw new Error('The session is already initialized. Call teardown() first.')

    await acquireBrowserSlot()
    this._slotAcquired = true
    try {
      this.baseUrl = await acquireServer(this.options.viewerPort, this.options.viewerRoot, this.options.effectsDir)
      this._serverAcquired = true

      const launchOptions = getBrowserLaunchOptions(this.options.headless, this.options.backend)
      // Only WebGPU sessions run through Dawn's Vulkan backend; pointing the
      // loader at the SwiftShader ICD must not change what the WebGL2 tools
      // render on machines with a real GL stack.
      if (this.options.backend === 'webgpu' && swiftshaderEnabled()) {
        const env = swiftshaderVulkanEnv()
        if (Object.keys(env).length > 0) {
          // Merge the ICD variables over the runner's environment instead of
          // replacing it: a sandboxed runner that reaches the web only through
          // a filtering proxy loses HTTP(S)_PROXY/NO_PROXY on replacement, and
          // the viewer page's CDN imports then fail with ERR_NAME_NOT_RESOLVED
          // before the renderer global ever appears.
          launchOptions.env = Object.fromEntries(
            Object.entries({ ...process.env, ...env }).filter((entry): entry is [string, string] =>
              typeof entry[1] === 'string'))
        }
      }
      this.browser = await chromium.launch(launchOptions)

      const viewportSize = process.env.CI
        ? { width: 256, height: 256 }
        : { width: 1280, height: 720 }

      this.context = await this.browser.newContext({
        viewport: viewportSize,
        ignoreHTTPSErrors: true
      })

      this.page = await this.context.newPage()
      this.page.setDefaultTimeout(this.timeoutMs)
      this.page.setDefaultNavigationTimeout(this.timeoutMs)

      this.consoleMessages = []
      this.page.on('console', (msg: ConsoleMessage) => {
        const text = msg.text()
        if (text.includes('Error') || text.includes('error') || text.includes('warning') ||
            text.includes('[compileEffect]') || text.includes('[expand]') ||
            text.includes('[Pipeline') || text.includes('[MCP-UNIFORM]') ||
            msg.type() === 'error' || msg.type() === 'warning') {
          this.consoleMessages.push({ type: msg.type(), text })
        }
      })

      this.page.on('pageerror', (error: Error) => {
        this.consoleMessages.push({ type: 'pageerror', text: error.message })
      })

      if (this.options.blankPage) {
        // WebGPU requires a trustworthy origin. Keep the DSL page isolated from
        // the consumer's viewer while giving it the same loopback origin as
        // the renderer modules it imports from the local server.
        const blankUrl = `${this.baseUrl}/.shade-mcp-blank.html`
        const fulfillBlankPage = (route: Route) => route.fulfill({
          status: 200,
          contentType: 'text/html',
          body: '<!doctype html><html><head><meta charset="utf-8"></head><body></body></html>',
        })
        await this.page.route(blankUrl, fulfillBlankPage)
        try {
          await this.page.goto(blankUrl, { waitUntil: 'domcontentloaded' })
        } finally {
          await this.page.unroute(blankUrl, fulfillBlankPage)
        }
      } else {
        await this.page.goto(`${this.baseUrl}${this.viewerPath}`, { waitUntil: 'networkidle' })

        // Existing effect tools run in the configured viewer. The DSL batch
        // tool builds an isolated renderer on the blank page instead.
        const rendererGlobal = this.globals.canvasRenderer
        await this.page.waitForFunction(
          (name) => !!(window as any)[name],
          rendererGlobal,
          { timeout: this.timeoutMs }
        )
      }

      this._isSetup = true
      trackSession(this)
    } catch (err) {
      // Clean up partially initialized resources and hand back whatever this
      // session actually took, including the server acquired above.
      if (this.page) await this.page.close().catch(() => {})
      if (this.context) await this.context.close().catch(() => {})
      if (this.browser) await this.browser.close().catch(() => {})
      this.page = null
      this.context = null
      this.browser = null
      this.releaseShared()
      throw err
    }
  }

  /**
   * Hands back the server ref and browser slot exactly once. Tools call
   * teardown() from a finally block that also runs after a failed setup, so
   * releasing unconditionally would hand back another session's resources.
   */
  private releaseShared(): void {
    if (this._serverAcquired) {
      releaseServer()
      this._serverAcquired = false
    }
    if (this._slotAcquired) {
      releaseBrowserSlot()
      this._slotAcquired = false
    }
  }

  async teardown(): Promise<void> {
    if (this.page) {
      await this.page.close().catch(() => {})
      this.page = null
    }
    if (this.context) {
      await this.context.close().catch(() => {})
      this.context = null
    }
    if (this.browser) {
      await this.browser.close().catch(() => {})
      this.browser = null
    }
    this.releaseShared()
    untrackSession(this)
    this.consoleMessages = []
    this._isSetup = false
  }

  /**
   * Puts the viewer on the requested backend and verifies the switch took
   * effect: rejects when the page backend never reaches the target within
   * `timeoutMs` (issue #34) instead of returning silently while every verb
   * keeps measuring on the previous backend.
   */
  async setBackend(backend: Backend): Promise<void> {
    const targetBackend = backend === 'webgpu' ? 'wgsl' : 'glsl'

    const final = await this.page!.evaluate(async ({ targetBackend, timeout, globals }) => {
      const w = window as any
      const readBackend = () => typeof w[globals.currentBackend] === 'function'
        ? w[globals.currentBackend]()
        : 'glsl'

      if (readBackend() === targetBackend) return { reached: true, backend: targetBackend }

      // Try renderer.switchBackend first (noisemaker demo + Shade app expose this).
      const renderer = w[globals.canvasRenderer]
      if (renderer && typeof renderer.switchBackend === 'function') {
        await renderer.switchBackend(targetBackend)
      } else {
        // Fall back to UI controls. Try button[data-backend] (noisemaker demo)
        // then input[name="backend"] radio (legacy/Shade viewer).
        const btn = document.querySelector(`button[data-backend="${targetBackend}"]`) as HTMLButtonElement | null
        if (btn) {
          btn.click()
        } else {
          const radio = document.querySelector(`input[name="backend"][value="${targetBackend}"]`) as HTMLInputElement | null
          if (radio) radio.click()
        }
      }

      const start = Date.now()
      while (Date.now() - start < timeout) {
        if (readBackend() === targetBackend) return { reached: true, backend: targetBackend }
        await new Promise(r => setTimeout(r, 50))
      }
      return { reached: false, backend: readBackend() }
    }, { targetBackend, timeout: this.timeoutMs, globals: this.globals }) as { reached: boolean; backend: string }

    if (!final.reached) {
      throw new Error(
        `Backend switch to ${backend} did not take effect within ${this.timeoutMs} ms` +
        ` (the viewer is still on ${final.backend})`
      )
    }
  }

  clearConsoleMessages(): void {
    this.consoleMessages = []
  }

  getConsoleMessages(): ConsoleEntry[] {
    return this.consoleMessages
  }

  async runWithConsoleCapture<T>(fn: () => Promise<T>): Promise<T & { console_errors?: string[] }> {
    this.clearConsoleMessages()
    const result = await fn() as T & { console_errors?: string[] }
    if (this.consoleMessages.length > 0) {
      result.console_errors = this.consoleMessages.map(m => m.text)
    }
    return result
  }

  get backend(): Backend {
    return this.options.backend
  }

  /**
   * Selects an effect in the viewer and waits until the page actually built
   * it (issue #34): the wait resolves only when the viewer's current effect
   * is the requested id — or the pipeline provably rebuilt after this
   * selection AND the page confirms the id — and the graph finished
   * compiling. Status text is NOT a readiness signal: right after a
   * selection it still describes the previous effect, which is how verbs
   * ended up measuring the old graph.
   *
   * Returns the page-confirmed outcome: status 'error' when the wait timed
   * out, the viewer reported a compile failure bound to this selection, the
   * page ended up showing a different effect than the one requested, or the
   * page does not expose the current effect's identity at all (fail closed —
   * an unbound result is never reported as ok).
   */
  async selectEffect(effectId: string): Promise<EffectSelectionResult> {
    const page = this.page!
    const outcome = await page.evaluate(selectAndAwaitEffect, {
      effectId, globals: this.globals, timeout: this.timeoutMs,
    }) as EffectSelectionResult

    if (outcome.status === 'ok' && outcome.effectId !== null && outcome.effectId !== effectId) {
      return {
        ...outcome,
        status: 'error',
        message: `The viewer is showing ${outcome.effectId}, not the requested ${effectId}`,
      }
    }
    // Defense in depth behind the in-page wait, which only accepts a ready
    // graph when the page confirms the requested id: a result whose identity
    // cannot be confirmed is an error, never a silent ok.
    if (outcome.status === 'ok' && outcome.effectId === null) {
      return {
        ...outcome,
        status: 'error',
        message: `The viewer does not report which effect it is showing; cannot confirm ${effectId}`,
      }
    }
    return outcome
  }

  /**
   * The page's current effect identity and backend name, without any
   * selection. Used to bind even failure results to what the page actually
   * holds (issue #34): values the page does not expose come back null.
   */
  async readPageIdentity(): Promise<{ effectId: string | null; backend: string | null }> {
    return await this.page!.evaluate(readPageIdentity, { globals: this.globals }) as { effectId: string | null; backend: string | null }
  }

  async getEffectGlobals(): Promise<Record<string, any>> {
    return await this.page!.evaluate((globals) => {
      const effect = (window as any)[globals.currentEffect]
      if (!effect?.instance?.globals) return {}
      return effect.instance.globals
    }, this.globals)
  }

  async resetUniformsToDefaults(): Promise<void> {
    await this.page!.evaluate((globals) => {
      const w = window as any
      const pipeline = w[globals.renderingPipeline]
      const effect = w[globals.currentEffect]
      if (!pipeline || !effect?.instance?.globals) return

      for (const spec of Object.values(effect.instance.globals) as any[]) {
        if (!spec.uniform) continue
        const val = spec.default ?? spec.min ?? 0
        if (pipeline.setUniform) {
          pipeline.setUniform(spec.uniform, val)
        } else if (pipeline.globalUniforms) {
          pipeline.globalUniforms[spec.uniform] = val
        }
      }
    }, this.globals)
  }
}
