import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
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
import { createShadeServer } from '../server.js'

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
  // A compile is ALREADY in flight when the selection fires (default false).
  // Its eventual graph swap and generation bump belong to that pre-existing
  // build, not to the selection.
  compileInFlight?: boolean
  // With compileInFlight: after the in-flight build completes, the viewer
  // starts and finishes ANOTHER build (one attributable to the selection).
  secondBuild?: boolean
  // Canvas size the renderer reports while on the wgsl backend (default
  // 4x4) — lets the two parity legs capture at different resolutions.
  webgpuCanvas?: { width: number; height: number }
  // Effect ids the viewer does not know: their selection is ignored and the
  // viewer keeps showing the effect it had, as the noisemaker demo does for
  // an id that is not in its effect list.
  unknownEffects?: string[]
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
      // Offscreen readback; on wgsl it reports the modeled WebGPU surface
      // size so the two parity legs can capture at different resolutions.
      readPixels: async (id: string) => {
        const size = state.backendKind === 'wgsl' && options.webgpuCanvas ? options.webgpuCanvas : { width: 4, height: 4 }
        return { data: new Uint8Array(size.width * size.height * 4).fill(200), width: size.width, height: size.height }
      },
    },
    isCompiling: options.compileInFlight === true,
    get graph() { return state.graph },
    setUniform: () => {},
    globalUniforms: {},
  }
  w[globals.renderingPipeline] = pipeline
  if (options.exposeIdentity !== false) w[globals.currentEffect] = entry(initialEffect)
  w[globals.currentBackend] = () => state.backendKind
  w[globals.pipelineGeneration!] = 0
  w[globals.canvasRenderer] = {
    canvas: {
      get width() { return state.backendKind === 'wgsl' && options.webgpuCanvas ? options.webgpuCanvas.width : 4 },
      get height() { return state.backendKind === 'wgsl' && options.webgpuCanvas ? options.webgpuCanvas.height : 4 },
    },
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
      if (options.unknownEffects?.includes(id)) return
      if (options.exposeIdentity !== false) w[globals.currentEffect] = entry(id)
      if (!options.silentSelect) state.status = `selected ${id}`
      if (options.compileInFlight) {
        // The in-flight build (started BEFORE the selection) completes: its
        // graph swap and generation bump are not evidence of a post-selection
        // build. With secondBuild, the viewer then runs another compile that
        // IS attributable to the selection.
        setTimeout(() => {
          state.graph = { passes: [{ name: 'inflight-done-pass', inputs: {} }], renderSurface: 'frame' }
          pipeline.isCompiling = false
          w[globals.pipelineGeneration!] = (w[globals.pipelineGeneration!] || 0) + 1
          state.status = `compiled ${id}`
          if (options.secondBuild) {
            pipeline.isCompiling = true
            setTimeout(() => {
              state.graph = { passes: [{ name: `${id.split('/')[1]}-pass`, inputs: {} }], renderSurface: 'frame' }
              pipeline.isCompiling = false
              w[globals.pipelineGeneration!] = (w[globals.pipelineGeneration!] || 0) + 1
              state.status = `compiled ${id}`
            }, 20)
          }
        }, options.loadDelayMs!)
        return
      }
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
      // The result is labelled with the request, and the page's own effect
      // is reported beside it.
      expect(result.effect_id).toBe('synth/requested')
      expect(result.page_effect_id).toBe('synth/previous')
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
      expect(result.page_effect_id).toBe('synth/requested')
      expect(result.backend).toBe('WebGL2')
      if (name === 'compileEffect') {
        // Passes come from the graph built AFTER the selection, not the
        // previous effect's graph.
        expect(result.passes).toEqual([{ id: 'requested-pass', status: 'ok' }])
      }
    })

    it(`${name} accepts an effect whose name contains "error" ("compiled scanlineError" is a success)`, async () => {
      installFakeViewer(DEFAULT_GLOBALS, { requested: 'filter/scanlineError', loadDelayMs: 20 })
      const result = await run(makeSession('webgl2'), 'filter/scanlineError')

      expect(result.status).not.toBe('error')
      expect(result.effect_id).toBe('filter/scanlineError')
      expect(result.page_effect_id).toBe('filter/scanlineError')
    })

    it(`${name} returns status error when the viewer ends up showing a different effect`, async () => {
      installFakeViewer(DEFAULT_GLOBALS, { requested: 'synth/requested', loadDelayMs: 20, showsEffect: 'synth/other' })
      const session = makeSession('webgl2')

      const result = await run(session, 'synth/requested')

      expect(result.status).toBe('error')
      expect(result.effect_id).toBe('synth/requested')
      expect(result.page_effect_id).toBe('synth/other')
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
      expect(result.page_effect_id).toBe('synth/requested')
      expect(result.backend).toBe('WebGL2')
      // Evidence of a post-selection build: the reported passes come from
      // the graph built AFTER the selection, never from the stale one.
      if (result.passes) {
        expect(result.passes).toEqual([{ id: 'requested-pass', status: 'ok' }])
      }
      expect(JSON.stringify(result)).not.toContain('stale-pass')
    })

    it(`${name} does not accept a compile that was already in flight before the selection`, async () => {
      // The viewer already shows the requested id and a build for it is in
      // flight. That build's completion (graph swap + generation bump) is
      // NOT evidence of a post-selection build: the wait must not resolve ok
      // on it, and the in-flight build's passes are never reported fresh.
      installFakeViewer(DEFAULT_GLOBALS, {
        requested: 'synth/requested',
        loadDelayMs: 20,
        initialEffect: 'synth/requested',
        compileInFlight: true,
      })
      const session = makeSession('webgl2')

      const result = await run(session, 'synth/requested')

      expect(result.status).toBe('error')
      const message = result.message ?? result.error ?? result.details
      expect(message).toMatch(/Timed out/)
      expect(JSON.stringify(result)).not.toContain('inflight-done-pass')
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
      expect(result.effect_id).toBe('synth/requested')
      expect(result.page_effect_id).toBe('synth/previous')
      // The page backend is still the one it started on.
      expect((globalThis as any).window[DEFAULT_GLOBALS.currentBackend]()).toBe('glsl')
    })

    it(`${name} accepts only a build that started after the selection`, async () => {
      // Same setup, but the viewer runs a SECOND compile after the in-flight
      // one completes — a build attributable to the selection. Its graph is
      // the one reported.
      installFakeViewer(DEFAULT_GLOBALS, {
        requested: 'synth/requested',
        loadDelayMs: 20,
        initialEffect: 'synth/requested',
        compileInFlight: true,
        secondBuild: true,
      })
      const session = makeSession('webgl2')

      const result = await run(session, 'synth/requested')

      expect(result.status).not.toBe('error')
      expect(result.effect_id).toBe('synth/requested')
      expect(result.page_effect_id).toBe('synth/requested')
      expect(result.backend).toBe('WebGL2')
      if (result.passes) {
        expect(result.passes).toEqual([{ id: 'requested-pass', status: 'ok' }])
      }
      expect(JSON.stringify(result)).not.toContain('inflight-done-pass')
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
      expect(result.effect_id).toBe('synth/requested')
      expect(result.page_effect_id).toBe(null)
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
      expect(result.page_effect_id).toBe('synth/requested')
      expect(result.backend).toBe('WebGPU')
    })

    it('returns status error when a leg ends up showing a different effect', async () => {
      installFakeViewer(DEFAULT_GLOBALS, { requested: 'synth/requested', loadDelayMs: 20, showsEffect: 'synth/other', switchBackend: true })
      const session = makeSession('webgl2')

      const result = await testPixelParity(session, 'synth/requested', { seed: 7 })

      expect(result.status).toBe('error')
      expect(result.details).toContain('synth/other')
      expect(result.effect_id).toBe('synth/requested')
      expect(result.page_effect_id).toBe('synth/other')
    })

    it('fails closed when the viewer does not expose its current effect\'s identity', async () => {
      installFakeViewer(DEFAULT_GLOBALS, { requested: 'synth/requested', loadDelayMs: 20, exposeIdentity: false })
      const session = makeSession('webgl2')

      const result = await testPixelParity(session, 'synth/requested', { seed: 7 })

      expect(result.status).toBe('error')
      expect(result.details).toMatch(/does not report which effect/)
    })

    it('binds the capture size mismatch error to the page identity', async () => {
      // The WebGPU leg renders at a different resolution than the WebGL2
      // leg; the error result still carries the final leg's page-confirmed
      // effect id and backend name.
      installFakeViewer(DEFAULT_GLOBALS, {
        requested: 'synth/requested',
        loadDelayMs: 20,
        switchBackend: true,
        webgpuCanvas: { width: 8, height: 8 },
      })
      const session = makeSession('webgl2')

      const result = await testPixelParity(session, 'synth/requested', { seed: 7 })

      expect(result.status).toBe('error')
      expect(result.details).toMatch(/Capture size mismatch/)
      expect(result.effect_id).toBe('synth/requested')
      expect(result.page_effect_id).toBe('synth/requested')
      expect(result.backend).toBe('WebGPU')
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
      expect(result.page_effect_id).toBe('synth/requested')
    })
  })
})

// Batches over MCP: each entry must stay matched to its request. The six
// viewer verbs run through the shipped server wiring against the fake viewer
// (setup() is replaced so no browser launches).
describe('batch results keep the requested effect id over MCP (issue #34)', () => {
  const VERB_CALLS: Array<{ tool: string; args: Record<string, unknown>; backend: string }> = [
    { tool: 'compileEffect', args: { backend: 'webgl2' }, backend: 'WebGL2' },
    { tool: 'renderEffectFrame', args: { backend: 'webgl2', warmup_frames: 2 }, backend: 'WebGL2' },
    { tool: 'benchmarkEffectFPS', args: { backend: 'webgl2', duration_seconds: 0.05 }, backend: 'WebGL2' },
    { tool: 'testUniformResponsiveness', args: { backend: 'webgl2' }, backend: 'WebGL2' },
    { tool: 'testNoPassthrough', args: { backend: 'webgl2' }, backend: 'WebGL2' },
    { tool: 'testPixelParity', args: { seed: 7 }, backend: 'WebGPU' },
  ]
  let saved: any[]

  beforeEach(() => {
    resetBrowserQueue()
    saved = [(globalThis as any).window, (globalThis as any).requestAnimationFrame, (globalThis as any).document]
    vi.stubEnv('SHADE_TIMEOUT_MS', '300')
    vi.stubEnv('SHADE_GLOBALS_PREFIX', '__shade')
    vi.spyOn(BrowserSession.prototype, 'setup').mockImplementation(async function (this: BrowserSession) {
      this.page = {
        setViewportSize: async () => {},
        waitForFunction: async () => {},
        evaluate: async (fn: (arg: any) => any, arg: any) => fn(arg),
      } as any
    })
    vi.spyOn(BrowserSession.prototype, 'teardown').mockImplementation(async () => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
    ;[(globalThis as any).window, (globalThis as any).requestAnimationFrame, (globalThis as any).document] = saved
    while (getRefCount() > 0) releaseServer()
  })

  async function callBatch(tool: string, args: Record<string, unknown>): Promise<{ isError: boolean | undefined; body: any }> {
    const server = createShadeServer()
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
    const client = new Client({ name: 'test-client', version: '1.0.0' })
    await server.connect(serverTransport)
    await client.connect(clientTransport)
    try {
      const result: any = await client.callTool({ name: tool, arguments: args })
      return { isError: result.isError, body: JSON.parse(result.content[0].text) }
    } finally {
      await client.close()
      await server.close()
    }
  }

  for (const { tool, args, backend } of VERB_CALLS) {
    it(`${tool}: a batch with one unknown id names that id on its error entry`, async () => {
      installFakeViewer(DEFAULT_GLOBALS, {
        requested: 'synth/requested', loadDelayMs: 20, switchBackend: true, unknownEffects: ['nope/two'],
      })

      const { body } = await callBatch(tool, { ...args, effects: 'synth/requested,nope/two' })

      expect(body.results.map((r: any) => r.effect_id)).toEqual(['synth/requested', 'nope/two'])
      const [known, unknown] = body.results
      expect(known.outcome).not.toBe('error')
      expect(known.page_effect_id).toBe('synth/requested')
      expect(known.backend).toBe(backend)
      // The failed entry names the id it was asked for; the effect the page
      // still shows is reported beside it, never as the entry's id.
      expect(unknown.outcome).toBe('error')
      expect(unknown.effect_id).toBe('nope/two')
      expect(unknown.page_effect_id).toBe('synth/requested')
      expect(unknown.message ?? unknown.error ?? unknown.details).toContain('nope/two')
    }, 20000)

    it(`${tool}: a batch of unknown ids labels each entry with its own request`, async () => {
      installFakeViewer(DEFAULT_GLOBALS, {
        requested: 'synth/requested', loadDelayMs: 20, switchBackend: true, unknownEffects: ['nope/one', 'nope/two'],
      })

      const { isError, body } = await callBatch(tool, { ...args, effects: 'nope/one,nope/two' })

      expect(isError).toBe(true)
      expect(body.outcome).toBe('error')
      expect(body.results.map((r: any) => r.effect_id)).toEqual(['nope/one', 'nope/two'])
      for (const entry of body.results) {
        expect(entry.outcome).toBe('error')
        expect(entry.page_effect_id).toBe('synth/previous')
      }
    }, 20000)
  }
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
