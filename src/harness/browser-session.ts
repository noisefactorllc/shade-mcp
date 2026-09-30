import { chromium, type Browser, type BrowserContext, type Page, type ConsoleMessage, type Route } from 'playwright'
import { resolve } from 'node:path'
import type { Backend } from '../config.js'
import type { BrowserSessionOptions, CompileResult, RenderResult, BenchmarkResult, ImageMetrics, ViewerGlobals } from './types.js'
import { DEFAULT_GLOBALS, globalsFromPrefix } from './types.js'
import { acquireServer, releaseServer, getServerUrl } from './server-manager.js'
import { acquireBrowserSlot, releaseBrowserSlot } from './browser-queue.js'
import { trackSession, untrackSession } from './live-sessions.js'
import { getConfig } from '../config.js'

interface ConsoleEntry {
  type: string
  text: string
}

function getBrowserLaunchOptions(headless: boolean, backend: Backend) {
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

      this.browser = await chromium.launch(
        getBrowserLaunchOptions(this.options.headless, this.options.backend)
      )

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

  async setBackend(backend: Backend): Promise<void> {
    const targetBackend = backend === 'webgpu' ? 'wgsl' : 'glsl'

    await this.page!.evaluate(async ({ targetBackend, timeout, globals }) => {
      const w = window as any
      const current = typeof w[globals.currentBackend] === 'function'
        ? w[globals.currentBackend]()
        : 'glsl'

      if (current === targetBackend) return

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
        const nowBackend = typeof w[globals.currentBackend] === 'function' ? w[globals.currentBackend]() : 'glsl'
        if (nowBackend === targetBackend) break
        await new Promise(r => setTimeout(r, 50))
      }
    }, { targetBackend, timeout: this.timeoutMs, globals: this.globals })
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

  async selectEffect(effectId: string): Promise<void> {
    await this.page!.evaluate((id) => {
      const select = document.getElementById('effect-select') as HTMLSelectElement | null
      if (select) {
        select.value = id
        select.dispatchEvent(new Event('change'))
      }
    }, effectId)
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
