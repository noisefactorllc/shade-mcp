import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { BrowserSession } from '../harness/browser-session.js'
import { DEFAULT_GLOBALS, type ViewerGlobals } from '../harness/types.js'
import { compileEffect } from '../tools/browser/compile.js'
import { renderEffectFrame } from '../tools/browser/render.js'
import { benchmarkEffectFPS } from '../tools/browser/benchmark.js'
import { testUniformResponsiveness } from '../tools/browser/uniforms.js'
import { testNoPassthrough } from '../tools/browser/passthrough.js'
import { testPixelParity } from '../tools/browser/parity.js'
import { resetBrowserQueue } from '../harness/browser-queue.js'
import { getRefCount, releaseServer } from '../harness/server-manager.js'

// Issue #34: viewer-based verbs must bind their result to the requested
// effect and backend. The fake viewer models the real noisemaker demo
// contract: a status element, an effect-select whose change event loads the
// selected effect (sets the currentEffect identity immediately, then swaps a
// fresh graph into the pipeline and bumps the compile generation after a
// delay), and both backend name conventions (currentBackend 'glsl'/'wgsl',
// pipeline.backend.getName() 'WebGL2'/'WebGPU').

type RequestedBackend = 'webgl2' | 'webgpu'

interface FakeViewerOptions {
  requested: string
  // Effect id the viewer ends up showing (default: the requested one).
  showsEffect?: string
  // Delay between the selection event and the fresh graph being ready.
  // Default 20 ms; null models a viewer that ignores the selection and keeps
  // the previous effect loaded (the issue #34 failure mode).
  loadDelayMs?: number | null
  // The viewer's renderer exposes a working switchBackend (default false).
  switchBackend?: boolean
  // currentBackend() convention value (default 'glsl').
  currentBackendValue?: string
  // Whether the viewer exposes its current effect's identity at all (default
  // true). false models a viewer with no currentEffect global.
  exposeIdentity?: boolean
  // Effect id the viewer shows before any selection (default
  // 'synth/previous').
  initialEffect?: string
  // Pass name in the viewer's pre-selection graph (default 'prev'). Set it
  // to something the post-selection build does NOT produce to tell a stale
  // graph apart from a fresh one.
  initialPassName?: string
  // The selection event itself does not touch the status text (default
  // false): models a viewer whose rebuild manifests only through the graph
  // and compile generation, so "nothing changed yet" cannot be told apart
  // from "rebuild in flight" right after the selection.
  silentSelect?: boolean
}

function installFakeViewer(globals: ViewerGlobals, options: FakeViewerOptions): any {
  const w: any = {}
  const entry = (id: string) => {
    const [namespace, name] = [id.slice(0, id.indexOf('/')), id.slice(id.indexOf('/') + 1)]
    return { namespace, name, instance: { globals: {} } }
  }
  const initialEffect = options.initialEffect ?? 'synth/previous'
  const state = {
    backendKind: options.currentBackendValue ?? 'glsl',
    status: `compiled ${initialEffect}`,
    graph: { passes: [{ name: options.initialPassName ?? 'prev' }], renderSurface: 'frame' } as any,
  }
  const pipeline: any = {
    backend: {
      getName: () => (state.backendKind === 'wgsl' ? 'WebGPU' : 'WebGL2'),
      // Readback surface for the parity/uniform/passthrough captures.
      gl: { bindFramebuffer: () => {}, readPixels: (_x: number, _y: number, _wd: number, _ht: number, _f: number, _t: number, out: Uint8Array) => out.fill(200) },
      textures: new Map([['global_frame_read', {}]]),
      device: { queue: { onSubmittedWorkDone: async () => {} } },
      readPixels: async (id: string) => ({ data: new Uint8Array(4 * 4 * 4).fill(200), width: 4, height: 4 }),
    },
    isCompiling: false,
    get graph() { return state.graph },
    setUniform: () => {},
    globalUniforms: {},
  }
  w[globals.renderingPipeline] = pipeline
  if (options.exposeIdentity !== false) w[globals.currentEffect] = entry(initialEffect)
  w[globals.currentBackend] = () => state.backendKind
  w[globals.pipelineGeneration!] = 0
  w[globals.canvasRenderer] = {
    canvas: { width: 4, height: 4 },
    render: () => {},
    ...(options.switchBackend
      ? { switchBackend: async (b: string) => { state.backendKind = b } }
      : {}),
  }
  w[globals.setPaused] = (v: boolean) => { w.__paused = v }
  w[globals.setPausedTime] = (t: number) => { w.__pausedTime = t }
  let frames = 0
  Object.defineProperty(w, globals.frameCount, { configurable: true, get: () => frames })

  const statusEl = { get textContent() { return state.status } }
  const selectEl: any = {
    value: '',
    dispatchEvent(ev: Event) {
      if (ev.type !== 'change' || options.loadDelayMs === null) return
      const id = selectEl.value
      if (options.exposeIdentity !== false) w[globals.currentEffect] = entry(id)
      if (!options.silentSelect) state.status = `selected ${id}`
      setTimeout(() => {
        const shown = options.showsEffect ?? id
        if (options.exposeIdentity !== false && shown !== id) w[globals.currentEffect] = entry(shown)
        state.graph = { passes: [{ name: `${shown.split('/')[1]}-pass`, inputs: {} }], renderSurface: 'frame' }
        w[globals.pipelineGeneration!] = (w[globals.pipelineGeneration!] || 0) + 1
        state.status = `compiled ${shown}`
      }, options.loadDelayMs)
    },
  }
  ;(globalThis as any).window = w
  ;(globalThis as any).requestAnimationFrame = (cb: () => void) => setTimeout(() => { frames++; cb() }, 0)
  ;(globalThis as any).document = {
    getElementById: (id: string) =>
      id === 'status' ? statusEl : id === 'effect-select' ? selectEl : null,
    querySelector: () => null,
  }
  return w
}

function makeSession(backend: RequestedBackend, timeoutMs = 400): BrowserSession {
  const session = new BrowserSession({ backend, timeoutMs, globals: DEFAULT_GLOBALS })
  session.page = {
    setViewportSize: async () => {},
    waitForFunction: async () => {},
    evaluate: async (fn: (arg: any) => any, arg: any) => fn(arg),
  } as any
  return session
}

// Runs each verb against the installed fake viewer.
const VERBS: Array<{ name: string; run: (session: BrowserSession, id: string) => Promise<any> }> = [
  { name: 'compileEffect', run: (s, id) => compileEffect(s, id) },
  { name: 'renderEffectFrame', run: (s, id) => renderEffectFrame(s, id, { warmupFrames: 2 }) },
  { name: 'benchmarkEffectFPS', run: (s, id) => benchmarkEffectFPS(s, id, { durationSeconds: 0.05 }) },
  { name: 'testUniformResponsiveness', run: (s, id) => testUniformResponsiveness(s, id) },
  { name: 'testNoPassthrough', run: (s, id) => testNoPassthrough(s, id) },
]

describe('browser verbs bind results to the requested effect (issue #34)', () => {
  let originalWindow: any
  let originalRaf: any
  let originalDocument: any

  beforeEach(() => {
    resetBrowserQueue()
    originalWindow = (globalThis as any).window
    originalRaf = (globalThis as any).requestAnimationFrame
    originalDocument = (globalThis as any).document
  })

  afterEach(() => {
    ;(globalThis as any).window = originalWindow
    ;(globalThis as any).requestAnimationFrame = originalRaf
    ;(globalThis as any).document = originalDocument
    while (getRefCount() > 0) releaseServer()
  })

  for (const { name, run } of VERBS) {
    it(`${name} does not resolve while the viewer still holds the previous effect, even when the status text already reads compiled`, async () => {
      // The viewer ignores the selection: the status text keeps reading
      // "compiled synth/previous" and the previous graph stays ready.
      installFakeViewer(DEFAULT_GLOBALS, { requested: 'synth/requested', loadDelayMs: null })
      const session = makeSession('webgl2')

      const result = await run(session, 'synth/requested')

      // No silent ok carrying the previous effect's graph.
      expect(result.status).toBe('error')
      const message = result.message ?? result.error ?? result.details
      expect(message).toMatch(/Timed out|showing synth\/previous/)
      // The previous graph's passes are never reported as fresh ok results.
      expect(JSON.stringify(result)).not.toContain('"id":"prev","status":"ok"')
    })

    it(`${name} resolves only after the viewer builds the request and reports the page-confirmed identity`, async () => {
      installFakeViewer(DEFAULT_GLOBALS, { requested: 'synth/requested', loadDelayMs: 20 })
      const session = makeSession('webgl2')

      const result = await run(session, 'synth/requested')

      expect(result.status).not.toBe('error')
      expect(result.effect_id).toBe('synth/requested')
      expect(result.backend).toBe('WebGL2')
      if (name === 'compileEffect') {
        // Passes come from the graph built AFTER the selection, not the
        // previous effect's graph.
        expect(result.passes).toEqual([{ id: 'requested-pass', status: 'ok' }])
      }
    })

    it(`${name} returns status error when the viewer ends up showing a different effect`, async () => {
      installFakeViewer(DEFAULT_GLOBALS, { requested: 'synth/requested', loadDelayMs: 20, showsEffect: 'synth/other' })
      const session = makeSession('webgl2')

      const result = await run(session, 'synth/requested')

      expect(result.status).toBe('error')
      expect(result.effect_id).toBe('synth/other')
      const message = result.message ?? result.error ?? result.details
      expect(message).toContain('synth/other')
    })

    it(`${name} requires a post-selection build even when re-selecting the effect the viewer already shows`, async () => {
      // The viewer already shows the requested effect, fully built, and the
      // selection event itself changes nothing observable; the fresh graph
      // arrives only after an async rebuild. The pre-selection graph (pass
      // 'stale-pass') must never be reported as the fresh result.
      installFakeViewer(DEFAULT_GLOBALS, {
        requested: 'synth/requested',
        loadDelayMs: 20,
        initialEffect: 'synth/requested',
        initialPassName: 'stale-pass',
        silentSelect: true,
      })
      const session = makeSession('webgl2')

      const result = await run(session, 'synth/requested')

      expect(result.status).not.toBe('error')
      expect(result.effect_id).toBe('synth/requested')
      expect(result.backend).toBe('WebGL2')
      // Evidence of a post-selection build: the reported passes come from
      // the graph built AFTER the selection, never from the stale one.
      if (result.passes) {
        expect(result.passes).toEqual([{ id: 'requested-pass', status: 'ok' }])
      }
      expect(JSON.stringify(result)).not.toContain('stale-pass')
    })

    it(`${name} returns status error when the page backend never reaches the requested one`, async () => {
      // No switchBackend, no backend controls: the viewer stays on 'glsl'.
      installFakeViewer(DEFAULT_GLOBALS, { requested: 'synth/requested', loadDelayMs: 20 })
      const session = makeSession('webgpu')

      const result = await run(session, 'synth/requested')

      expect(result.status).toBe('error')
      const message = result.message ?? result.error ?? result.details
      expect(message).toMatch(/Backend switch failed/)
      // The failure result still binds to the page: the backend the page is
      // really on, and the effect it is really showing.
      expect(result.backend).toBe('WebGL2')
      expect(result.effect_id).toBe('synth/previous')
      // The page backend is still the one it started on.
      expect((globalThis as any).window[DEFAULT_GLOBALS.currentBackend]()).toBe('glsl')
    })

    it(`${name} fails closed when the viewer does not expose its current effect's identity`, async () => {
      // The pipeline rebuilds for the selection, but the page never reports
      // which effect it is showing: the result is not bound to the request,
      // so the verb must not report ok.
      installFakeViewer(DEFAULT_GLOBALS, { requested: 'synth/requested', loadDelayMs: 20, exposeIdentity: false })
      const session = makeSession('webgl2')

      const result = await run(session, 'synth/requested')

      expect(result.status).toBe('error')
      const message = result.message ?? result.error ?? result.details
      expect(message).toMatch(/does not report which effect/)
    })
  }

  describe('testPixelParity', () => {
    it('does not resolve while a leg still holds the previous effect', async () => {
      installFakeViewer(DEFAULT_GLOBALS, { requested: 'synth/requested', loadDelayMs: null })
      const session = makeSession('webgl2')

      const result = await testPixelParity(session, 'synth/requested', { seed: 7 })

      expect(result.status).toBe('error')
      expect(result.details).toMatch(/WebGL2 leg: (Timed out|.*synth\/previous)/)
    })

    it('confirms the effect and backend on both legs before comparing', async () => {
      installFakeViewer(DEFAULT_GLOBALS, { requested: 'synth/requested', loadDelayMs: 20, switchBackend: true })
      const session = makeSession('webgl2')

      const result = await testPixelParity(session, 'synth/requested', { seed: 7 })

      expect(result.status).toBe('ok')
      expect(result.effect_id).toBe('synth/requested')
      expect(result.backend).toBe('WebGPU')
    })

    it('returns status error when a leg ends up showing a different effect', async () => {
      installFakeViewer(DEFAULT_GLOBALS, { requested: 'synth/requested', loadDelayMs: 20, showsEffect: 'synth/other', switchBackend: true })
      const session = makeSession('webgl2')

      const result = await testPixelParity(session, 'synth/requested', { seed: 7 })

      expect(result.status).toBe('error')
      expect(result.details).toContain('synth/other')
      expect(result.effect_id).toBe('synth/other')
    })

    it('fails closed when the viewer does not expose its current effect\'s identity', async () => {
      installFakeViewer(DEFAULT_GLOBALS, { requested: 'synth/requested', loadDelayMs: 20, exposeIdentity: false })
      const session = makeSession('webgl2')

      const result = await testPixelParity(session, 'synth/requested', { seed: 7 })

      expect(result.status).toBe('error')
      expect(result.details).toMatch(/does not report which effect/)
    })

    it('returns status error when the WebGPU leg cannot reach the backend', async () => {
      // WebGL2 leg succeeds; the switch to WebGPU has no mechanism.
      installFakeViewer(DEFAULT_GLOBALS, { requested: 'synth/requested', loadDelayMs: 20 })
      const session = makeSession('webgl2')

      const result = await testPixelParity(session, 'synth/requested', { seed: 7 })

      expect(result.status).toBe('error')
      expect(result.details).toMatch(/WebGPU leg: Backend switch failed/)
      // The failure result still binds to the page: the backend the page is
      // really on, and the effect it is really showing.
      expect(result.backend).toBe('WebGL2')
      expect(result.effect_id).toBe('synth/requested')
    })
  })
})

describe('browser tools select the requested backend', () => {
  /**
   * The viewer starts on its own default backend, so a tool that reports
   * results as `session.backend` has to put the viewer on that backend first.
   * The page stub aborts at the first evaluate, which is all the ordering
   * contract needs.
   */
  function fakeSession(backend: 'webgl2' | 'webgpu') {
    const setBackendCalls: string[] = []
    const session = {
      backend,
      globals: DEFAULT_GLOBALS,
      page: {
        evaluate: async () => { throw new Error('stop-here') },
        waitForFunction: async () => {},
        setViewportSize: async () => {},
      },
      async setBackend(b: string) { setBackendCalls.push(b) },
      async selectEffect() { throw new Error('stop-here') },
      async runWithConsoleCapture<T>(fn: () => Promise<T>): Promise<T> { return fn() },
    }
    return { session: session as unknown as BrowserSession, setBackendCalls }
  }

  it('benchmarkEffectFPS switches the viewer before measuring', async () => {
    const { session, setBackendCalls } = fakeSession('webgpu')
    await expect(benchmarkEffectFPS(session, 'synth/noise')).rejects.toThrow('stop-here')
    expect(setBackendCalls).toEqual(['webgpu'])
  })

  it('testUniformResponsiveness switches the viewer before rendering', async () => {
    const { session, setBackendCalls } = fakeSession('webgpu')
    await expect(testUniformResponsiveness(session, 'synth/noise')).rejects.toThrow('stop-here')
    expect(setBackendCalls).toEqual(['webgpu'])
  })

  it('testNoPassthrough switches the viewer before comparing', async () => {
    const { session, setBackendCalls } = fakeSession('webgpu')
    await expect(testNoPassthrough(session, 'synth/noise')).rejects.toThrow('stop-here')
    expect(setBackendCalls).toEqual(['webgpu'])
  })
})
