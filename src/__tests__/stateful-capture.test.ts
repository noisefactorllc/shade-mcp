import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { BrowserSession } from '../harness/browser-session.js'
import { DEFAULT_GLOBALS, type ViewerGlobals } from '../harness/types.js'
import { testPixelParity, PARITY_FRAMES } from '../tools/browser/parity.js'
import { testUniformResponsiveness } from '../tools/browser/uniforms.js'
import { resetBrowserQueue } from '../harness/browser-queue.js'
import { getRefCount, releaseServer } from '../harness/server-manager.js'

// A stateful effect (feedback, a temporal filter, a simulation) draws each
// frame from the frames before it, so its output depends on how many frames
// its pipeline rendered. The fake viewer models the noisemaker demo for such
// an effect:
// - every render adds one frame to the pipeline's history;
// - a dispose + compile of the renderer's program builds a fresh pipeline with
//   no history, the program's uniform values and no uploaded textures;
// - a selection builds a fresh pipeline too, then the demo's UI uploads the
//   effect's text input, sets its size on the pass, and renders a frame for
//   each control it builds while paused (uiRenders: a different number per
//   selection, as WebGPU's asynchronous compile can drop some of them);
// - the live loop draws frames while the viewer is not paused, a different
//   number each time (the wall-clock frame rate decides it).
// The read-back pixels change with the column, the frame history, the
// `amount` uniform, the uploaded text texture and the text size on the pass;
// they do not change with the row, so the WebGPU leg's row flip does not move
// them.

interface StatefulViewer {
  rebuilds: number
  window: any
}

interface StatefulViewerOptions {
  liveFrames?: number[]
  uiRenders?: number[]
  uploads?: boolean
}

const TEXT_TEXTURE = 'textTex_step_0'

function installStatefulViewer(globals: ViewerGlobals, specs: Record<string, any>, options: StatefulViewerOptions = {}): StatefulViewer {
  const liveFrames = [...(options.liveFrames ?? [])]
  const uiRenders = [...(options.uiRenders ?? [])]
  const w: any = {}
  const defaults: Record<string, number> = {}
  for (const spec of Object.values(specs) as any[]) defaults[spec.uniform] = spec.default ?? spec.min
  const state = {
    backendKind: 'glsl',
    paused: false,
    history: 0,
    values: { ...defaults } as Record<string, number>,
    rebuilds: 0,
  }
  const size = { width: 4, height: 4 }
  const makePipeline = () => {
    const pipeline: any = {
      isCompiling: false,
      graph: { passes: [{ name: 'main', inputs: {}, uniforms: {} }], renderSurface: 'frame' },
      globalUniforms: {},
      width: size.width,
      height: size.height,
      setUniform: (name: string, value: number) => { state.values[name] = value },
      whenAsyncInitsSettled: async () => {},
    }
    const backend: any = {
      getName: () => (state.backendKind === 'wgsl' ? 'WebGPU' : 'WebGL2'),
      textures: new Map<string, any>([['global_frame_read', {}]]),
      device: { queue: { onSubmittedWorkDone: async () => {} } },
      readPixels: async () => {
        const text = backend.textures.get(TEXT_TEXTURE)?.value ?? 0
        const textSize = pipeline.graph.passes[0].uniforms.textSize?.[0] ?? 0
        const data = new Uint8Array(size.width * size.height * 4)
        for (let p = 0; p < size.width * size.height; p++) {
          const x = p % size.width
          const c = (x * 40 + state.history * 9 + Math.round((state.values.u_amount ?? 0) * 100) + text + textSize) % 256
          data[p * 4] = c; data[p * 4 + 1] = c; data[p * 4 + 2] = c; data[p * 4 + 3] = 255
        }
        return { data, width: size.width, height: size.height }
      },
    }
    if (state.backendKind !== 'wgsl') backend.gl = { bindFramebuffer: () => {}, readPixels: () => {} }
    pipeline.backend = backend
    return pipeline
  }
  // A fresh pipeline: no frame history, the program's uniform values.
  const build = () => {
    state.history = 0
    state.values = { ...defaults }
    const pipeline = makePipeline()
    w[globals.renderingPipeline] = pipeline
    return pipeline
  }
  build()
  w[globals.currentEffect] = { namespace: 'filter', name: 'stateful', instance: { globals: specs } }
  w[globals.currentBackend] = () => state.backendKind
  w[globals.pipelineGeneration!] = 0
  w[globals.setPaused] = (paused: boolean) => {
    // The live loop draws an unknown number of frames before the next pause.
    if (!paused && state.paused) state.history += liveFrames.shift() ?? 0
    state.paused = paused
  }
  w[globals.setPausedTime] = () => {}
  const renderer: any = {
    canvas: size,
    loopDuration: 10,
    // Frames rendered since the last build (a compile sets it to 0).
    get frameCount() { return state.history },
    currentDsl: 'search filter\n\nstateful().write(o0)\nrender(o0)',
    get pipeline() { return w[globals.renderingPipeline] },
    render: () => {
      if (!w[globals.renderingPipeline]) throw new Error('render without a pipeline')
      state.history++
    },
    dispose: async () => { w[globals.renderingPipeline] = null },
    compile: async () => { state.rebuilds++; return build() },
    switchBackend: async (b: string) => { state.backendKind = b },
    updateTextureFromSource: (texId: string, source: { value: number }) => {
      w[globals.renderingPipeline].backend.textures.set(texId, { value: source.value })
      return { width: 8, height: 2 }
    },
  }
  w[globals.canvasRenderer] = renderer
  // The demo rebuilds on selection: a fresh pipeline swapped in after a short
  // delay, with the compile generation bumped (the issue #34 contract).
  const selectEl: any = {
    value: '',
    dispatchEvent(ev: Event) {
      if (ev.type !== 'change') return
      setTimeout(() => {
        const pipeline = build()
        if (options.uploads) {
          renderer.updateTextureFromSource(TEXT_TEXTURE, { value: 77 })
          pipeline.graph.passes[0].uniforms.textSize = [8, 2]
        }
        for (let i = uiRenders.shift() ?? 0; i > 0; i--) renderer.render(0.07)
        w[globals.pipelineGeneration!] = (w[globals.pipelineGeneration!] || 0) + 1
      }, 5)
    },
  }
  ;(globalThis as any).window = w
  ;(globalThis as any).document = {
    getElementById: (id: string) => (id === 'effect-select' ? selectEl : id === 'status' ? { textContent: '' } : null),
    querySelector: () => null,
    createElement: () => ({ width: 0, height: 0, getContext: () => null }),
  }
  return {
    get rebuilds() { return state.rebuilds },
    window: w,
  }
}

function makeSession(backend: 'webgl2' | 'webgpu'): BrowserSession {
  const session = new BrowserSession({ backend, timeoutMs: 500, globals: DEFAULT_GLOBALS })
  session.page = {
    setViewportSize: async () => {},
    waitForFunction: async () => {},
    evaluate: async (fn: (arg: any) => any, arg: any) => fn(arg),
  } as any
  return session
}

const AMOUNT = { uniform: 'u_amount', type: 'float', min: 0, max: 1, default: 0.5 }
const UNUSED = { uniform: 'u_unused', type: 'float', min: 0, max: 1, default: 0.5 }

describe('captures of a stateful effect start from a reset state', () => {
  let originalWindow: any
  let originalDocument: any

  beforeEach(() => {
    resetBrowserQueue()
    originalWindow = (globalThis as any).window
    originalDocument = (globalThis as any).document
  })

  afterEach(() => {
    ;(globalThis as any).window = originalWindow
    ;(globalThis as any).document = originalDocument
    while (getRefCount() > 0) releaseServer()
  })

  it('testPixelParity compares both backends after the same frames from a fresh pipeline', async () => {
    // The live loop would draw 7 frames before the WebGL2 capture and 6
    // before the WebGPU one, and the selection's UI renders 17 and 15. Both
    // backends render the same pixels for the same history, so any difference
    // comes from the capture, not the effect.
    const viewer = installStatefulViewer(DEFAULT_GLOBALS, {}, { liveFrames: [7, 6, 5, 4], uiRenders: [17, 15] })
    const session = makeSession('webgl2')

    const result = await testPixelParity(session, 'filter/stateful', { seed: 7 })

    expect(result.status).toBe('ok')
    expect(result.maxDiff).toBe(0)
    expect(result.mismatchPercent).toBe(0)
    // Each leg rebuilt the program and rendered the fixed frame sequence.
    expect(viewer.rebuilds).toBe(2)
    expect(result.stateReset).toBe(true)
    expect(result.frames).toBe(PARITY_FRAMES)
  })

  it('testPixelParity keeps the uploaded inputs and the page\'s pass values through the rebuild', async () => {
    const viewer = installStatefulViewer(DEFAULT_GLOBALS, {}, { uiRenders: [3, 4], uploads: true })
    const session = makeSession('webgl2')

    const result = await testPixelParity(session, 'filter/stateful', { seed: 7 })

    expect(result.status).toBe('ok')
    expect(result.stateReset).toBe(true)
    expect(viewer.rebuilds).toBe(2)
    // The rebuilt pipeline holds the text texture the demo uploaded, from the
    // same source, and the text size the demo set on the pass.
    const pipeline = viewer.window[DEFAULT_GLOBALS.renderingPipeline]
    expect(pipeline.backend.textures.get(TEXT_TEXTURE)).toEqual({ value: 77 })
    expect(pipeline.graph.passes[0].uniforms.textSize).toEqual([8, 2])
  })

  it('testUniformResponsiveness measures a stateful effect from the same start state', async () => {
    // amount moves the output and unused does not. Every render adds to the
    // history, so without a reset the output changes between two captures on
    // its own and the dead control gets no verdict.
    const viewer = installStatefulViewer(DEFAULT_GLOBALS, { amount: AMOUNT, unused: UNUSED })
    const session = makeSession('webgl2')

    const result = await testUniformResponsiveness(session, 'filter/stateful')

    expect(result.tested_uniforms).toEqual(['amount:pass', 'unused:fail'])
    expect(result.status).toBe('fail')
    expect(result.details).toContain('did not affect output: unused')
    const byName = Object.fromEntries((result.uniforms as any[]).map((e) => [e.name, e]))
    // The repeat noise of a deterministic stateful effect is zero.
    expect(byName.amount.unstable).toBeUndefined()
    expect(byName.unused.unstable).toBeUndefined()
    expect(byName.unused.luma_diff).toBe(0)
    expect(byName.unused.pixel_diff).toBe(0)
    // The test value outlived the rebuild that reset the state.
    expect(byName.amount.luma_diff).toBeGreaterThan(0.002)
    expect(viewer.rebuilds).toBeGreaterThan(0)
  })
})
