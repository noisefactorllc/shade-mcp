import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { BrowserSession } from '../harness/browser-session.js'
import { DEFAULT_GLOBALS, type ViewerGlobals } from '../harness/types.js'
import { renderEffectFrame } from '../tools/browser/render.js'
import { testUniformResponsiveness } from '../tools/browser/uniforms.js'
import { testNoPassthrough } from '../tools/browser/passthrough.js'
import { resetBrowserQueue } from '../harness/browser-queue.js'
import { getRefCount, releaseServer } from '../harness/server-manager.js'

// Runs the serialized in-page capture callbacks for real inside Node against a
// WebGPU-shaped fake viewer: a pipeline backend with no `gl`, an async
// `readPixels(textureId)` that returns the fake render surface's RGBA bytes, a
// `textures` map and a `graph.renderSurface` — the same fake-viewer pattern as
// timed-render.test.ts. The readback is bottom-up like a real WebGPU
// copyTextureToBuffer, so the tests also pin the row-flip normalization.

// Fake surface: 4x3. Raw (bottom-up) rows: bottom+middle (200,100,50,255),
// top row (10,20,30,255). After the WebGPU row flip, the top row is 10/20/30.
const WIDTH = 4
const HEIGHT = 3

function fakeSurfaceData(topDown: boolean, top: [number, number, number], rest: [number, number, number]): Uint8Array {
  const data = new Uint8Array(WIDTH * HEIGHT * 4)
  for (let y = 0; y < HEIGHT; y++) {
    const row = topDown ? (y === 0 ? top : rest) : (y === HEIGHT - 1 ? top : rest)
    for (let x = 0; x < WIDTH; x++) {
      const idx = (y * WIDTH + x) * 4
      data[idx] = row[0]; data[idx + 1] = row[1]; data[idx + 2] = row[2]; data[idx + 3] = 255
    }
  }
  return data
}

interface FakeViewerOptions {
  uniforms?: Record<string, any>
  filterEffect?: boolean
}

// Installs a WebGPU-shaped fake viewer. Its async readPixels returns valid RGBA
// bytes for any texture id, bottom-up (WebGPU orientation): the fake "shader"
// draws the top row in a distinct color and the rest in another, and, when
// `uniforms` specs are given, the `amount` uniform drives the rest color so the
// uniform probe can measure a response.
function installWebGpuFakeViewer(globals: ViewerGlobals, options: FakeViewerOptions = {}): any {
  const w: any = {}
  const values: Record<string, number> = {}
  for (const spec of Object.values(options.uniforms ?? {}) as any[]) {
    values[spec.uniform] = spec.default ?? spec.min
  }
  w.__values = values
  let lastRenderTime = 0

  const computeBytes = (): Uint8Array => {
    let rest: [number, number, number]
    if (options.uniforms) {
      const c = Math.round(values.u_amount * 255)
      rest = [c, 0, c]
    } else if (options.filterEffect) {
      // Time-varying fake shader so the frame probes see redraws take effect.
      rest = lastRenderTime > 0.5 ? [200, 100, 50] : [10, 0, 0]
    } else {
      rest = [200, 100, 50]
    }
    // bottom-up: the last raw row is the screen's top row.
    return fakeSurfaceData(false, [10, 20, 30], rest)
  }

  // Models real WebGPU readback lag: each draw produces a new frame, but the
  // async reader only serves frames the queue has drained. A read issued
  // before onSubmittedWorkDone gets the PREVIOUS frame's bytes. The filter
  // fake binds its pipeline input (inputTex) to node_0_out, which the reader
  // serves as a static buffer distinct from the rendered surface, so the
  // passthrough probe has a real output-to-input difference to measure.
  const filterInputBytes = fakeSurfaceData(true, [0, 0, 0], [3, 3, 3])
  let rendered = computeBytes()
  let served = rendered

  const readPixels = async (id: string) => {
    if (options.filterEffect && id === 'node_0_out') {
      return { data: filterInputBytes, width: WIDTH, height: HEIGHT }
    }
    return served ? { data: served, width: WIDTH, height: HEIGHT } : null
  }

  w[globals.renderingPipeline] = {
    backend: {
      getName: () => 'webgpu',
      textures: new Map([['global_frame_read', {}]]),
      device: { queue: { onSubmittedWorkDone: async () => { served = rendered } } },
      readPixels,
    },
    graph: {
      renderSurface: 'frame',
      passes: options.filterEffect ? [{ inputs: { inputTex: 'node_0_out' } }] : [{ inputs: {} }],
    },
    setUniform: (name: string, val: number) => { values[name] = val },
    globalUniforms: values,
  }
  w[globals.canvasRenderer] = {
    canvas: { width: 2, height: 2 },
    render: (t: number) => {
      lastRenderTime = t
      rendered = computeBytes()
      w.__redrawCalls = (w.__redrawCalls || 0) + 1
      w.__lastRedrawArg = t
    },
    __lastRenderTime: () => lastRenderTime,
  }
  w[globals.currentEffect] = { instance: { globals: options.uniforms ?? {} } }
  let frames = 0
  Object.defineProperty(w, globals.frameCount, { configurable: true, get: () => frames })
  w[globals.setPaused] = (v: boolean) => { w.__paused = v }
  w[globals.setPausedTime] = (t: number) => { w.__pausedTime = t }

  ;(globalThis as any).window = w
  ;(globalThis as any).requestAnimationFrame = (cb: () => void) => setTimeout(() => { frames++; cb() }, 0)
  ;(globalThis as any).document = {
    getElementById: () => null,
    __canvases: [] as any[],
    createElement: () => {
      const canvas: any = { width: 0, height: 0, lastImageData: null as any }
      canvas.getContext = () => ({
        createImageData: (cw: number, ch: number) => ({ width: cw, height: ch, data: new Uint8ClampedArray(cw * ch * 4) }),
        putImageData: (img: any) => { canvas.lastImageData = img },
      })
      canvas.toDataURL = () => 'data:image/png;base64,fake'
      ;(globalThis as any).document.__canvases.push(canvas)
      return canvas
    },
  }
  return w
}

function makeSession(backend: 'webgl2' | 'webgpu', timeoutMs = 500): BrowserSession {
  const session = new BrowserSession({ backend, timeoutMs, globals: DEFAULT_GLOBALS })
  session.page = {
    setViewportSize: async () => {},
    waitForFunction: async () => {},
    evaluate: async (fn: (arg: any) => any, arg: any) => fn(arg),
  } as any
  session.setBackend = async () => {}
  return session
}

describe('backend-neutral frame readback (issue #28)', () => {
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

  describe('renderEffectFrame on a WebGPU backend', () => {
    it('returns ok with the surface dimensions and metrics read through the backend', async () => {
      installWebGpuFakeViewer(DEFAULT_GLOBALS)
      const session = makeSession('webgpu')
      const result = await renderEffectFrame(session, 'synth/noise', { warmupFrames: 2 })

      expect(result.status).toBe('ok')
      expect(result.backend).toBe('webgpu')
      expect(result.frame?.width).toBe(WIDTH)
      expect(result.frame?.height).toBe(HEIGHT)
      const m: any = result.metrics
      // top row (10,20,30) once, rest (200,100,50) twice per column
      expect(m.mean_rgb[0]).toBeCloseTo((10 + 200 + 200) / 3 / 255, 5)
      expect(m.mean_rgb[1]).toBeCloseTo((20 + 100 + 100) / 3 / 255, 5)
      expect(m.mean_rgb[2]).toBeCloseTo((30 + 50 + 50) / 3 / 255, 5)
      expect(m.mean_alpha).toBe(1)
      expect(m.unique_sampled_colors).toBe(2)
      expect(m.is_monochrome).toBe(false)
    })

    it('captures the image in screen orientation (WebGPU rows flipped to top-down)', async () => {
      installWebGpuFakeViewer(DEFAULT_GLOBALS)
      const session = makeSession('webgpu')
      const result = await renderEffectFrame(session, 'synth/noise', { warmupFrames: 2, captureImage: true })

      expect(result.status).toBe('ok')
      const img = result.frame?.image_uri
      expect(img).toBe('data:image/png;base64,fake')
      // Reach the stored ImageData through the fake canvas registry.
      const doc: any = (globalThis as any).document
      const withImage = doc.__canvases.find((c: any) => c.lastImageData)
      expect(withImage).toBeDefined()
      expect(Array.from(withImage.lastImageData.data.slice(0, 4))).toEqual([10, 20, 30, 255])
    })

    it('reads the requested timed frame, not the stale previous readback', async () => {
      // The filter-effect fake varies with render time; a read issued before
      // the queue drain would return the install-time frame (rest 10/0/0)
      // instead of the paused frame at t=1.5 (rest 200/100/50).
      installWebGpuFakeViewer(DEFAULT_GLOBALS, { filterEffect: true })
      const session = makeSession('webgpu')
      const w: any = (globalThis as any).window
      const result = await renderEffectFrame(session, 'synth/noise', { warmupFrames: 2, time: 1.5 })

      expect(result.status).toBe('ok')
      expect(w.__lastRedrawArg).toBe(1.5)
      const m: any = result.metrics
      expect(m.mean_rgb[0]).toBeCloseTo((10 + 200 + 200) / 3 / 255, 5)
    })

    it('names the backend when a readback is impossible', async () => {
      const w = installWebGpuFakeViewer(DEFAULT_GLOBALS)
      // Remove the async reader: the backend can no longer deliver pixels.
      delete (w[DEFAULT_GLOBALS.renderingPipeline] as any).backend.readPixels
      const session = makeSession('webgpu')
      const result = await renderEffectFrame(session, 'synth/noise', { warmupFrames: 2 })

      expect(result.status).toBe('error')
      expect(result.backend).toBe('webgpu')
      expect(result.backend).not.toBe('unknown')
      expect(result.error).toContain('webgpu')
    })
  })

  describe('testUniformResponsiveness on a WebGPU backend', () => {
    const SPECS: Record<string, any> = {
      amount: { uniform: 'u_amount', type: 'float', min: 0, max: 1, default: 0.5 },
      unused: { uniform: 'u_unused', type: 'float', min: 0, max: 1, default: 0.5 },
    }

    it('measures uniforms through the backend readback instead of failing the baseline', async () => {
      installWebGpuFakeViewer(DEFAULT_GLOBALS, { uniforms: { amount: SPECS.amount, unused: SPECS.unused } })
      const session = makeSession('webgpu')
      const result = await testUniformResponsiveness(session, 'synth/noise')

      // Both uniforms were measured (no baseline failure); `unused` correctly
      // does not affect the output, so the aggregation reports it.
      expect(result.details).not.toContain('Failed to capture baseline')
      expect(result.uniforms).toHaveLength(2)
      const byName = Object.fromEntries(result.uniforms.map((e: any) => [e.name, e]))
      expect(byName.amount.responds).toBe(true)
      expect(byName.unused.responds).toBe(false)
      expect(byName.amount.luma_diff).toBeGreaterThan(0.002)
      expect(byName.unused.luma_diff).toBe(0)
    })

    it('reports the backend name when a measurement is impossible', async () => {
      const w = installWebGpuFakeViewer(DEFAULT_GLOBALS, { uniforms: SPECS })
      delete (w[DEFAULT_GLOBALS.renderingPipeline] as any).backend.readPixels
      const session = makeSession('webgpu')
      const result = await testUniformResponsiveness(session, 'synth/noise')

      expect(result.status).toBe('error')
      expect(result.details).toContain('webgpu')
    })
  })

  describe('testNoPassthrough on a WebGPU backend', () => {
    it('measures the output-to-input difference through the backend readback', async () => {
      installWebGpuFakeViewer(DEFAULT_GLOBALS, { filterEffect: true })
      const session = makeSession('webgpu')
      const result = await testNoPassthrough(session, 'synth/noise')

      expect(result.status).toBe('ok')
      expect(result.isFilterEffect).toBe(true)
      expect(result.similarity).not.toBeNull()
      // The measured difference is between the rendered surface and the
      // consumed input texture (node_0_out), both read through the backend
      // after the queue drain — not a temporal diff of two outputs.
      expect(result.similarity).toBeGreaterThan(0.01)
      expect(result.inputTexture).toBe('node_0_out')
      expect(result.details).not.toContain('No GL context')
    })

    it('reports the backend name when no readback is possible', async () => {
      const w = installWebGpuFakeViewer(DEFAULT_GLOBALS, { filterEffect: true })
      delete (w[DEFAULT_GLOBALS.renderingPipeline] as any).backend.readPixels
      const session = makeSession('webgpu')
      const result = await testNoPassthrough(session, 'synth/noise')

      expect(result.status).toBe('error')
      expect(result.details).toContain('webgpu')
      expect(result.details).not.toContain('No GL context')
    })
  })
})
