import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { BrowserSession } from '../harness/browser-session.js'
import { DEFAULT_GLOBALS, type ViewerGlobals } from '../harness/types.js'
import { testNoPassthrough } from '../tools/browser/passthrough.js'
import { resetBrowserQueue } from '../harness/browser-queue.js'
import { getRefCount, releaseServer } from '../harness/server-manager.js'

// Regression tests for issue #31: testNoPassthrough must (a) classify filters
// by the pass input key / a value naming a pipeline input — never by a
// substring of the bound texture id, (b) compare the rendered OUTPUT with the
// INPUT texture the effect consumes at one fixed paused time — not two
// outputs over time plus a color count, and (c) capture through the backend's
// async readPixels on both backends, like testPixelParity.

const W = 16
const H = 16

function clamp255(v: number): number {
  return Math.max(0, Math.min(255, v))
}

// A varied 16x16 texture: every pixel is a distinct color, so the old
// `uniqueColors > 5` branch of the old verdict would call any static copy of
// it "modifying".
function variedBytes(shift = 0): Uint8Array {
  const data = new Uint8Array(W * H * 4)
  for (let i = 0; i < W * H; i++) {
    data[i * 4] = clamp255(((i * 7) % 256) + shift)
    data[i * 4 + 1] = clamp255(((i * 13 + 5) % 256) + shift)
    data[i * 4 + 2] = clamp255(((i * 29 + 11) % 256) + shift)
    data[i * 4 + 3] = 255
  }
  return data
}

// The same pattern as Float32 0..1 readback (WebGPU backends serve floats).
function variedFloats(shift = 0): Float32Array {
  const bytes = variedBytes(shift)
  const data = new Float32Array(bytes.length)
  for (let i = 0; i < bytes.length; i++) data[i] = bytes[i] / 255
  return data
}

interface FakeTex { width: number; height: number; data: Uint8Array | Float32Array }

interface FakeViewerOptions {
  // Effect id the viewer reports as current (issue #34 contract); tests pass
  // the id the verb requests.
  effectId?: string
  passes: any[]
  textures: Record<string, FakeTex>
  renderSurface?: string
  // Ping-pong read-half registry on the pipeline: surface -> texture id.
  frameReadTextures?: [string, string][]
  // WebGPU-shaped backend: no `gl`, async readPixels, a device queue to drain.
  webgpu?: boolean
}

function installFakeViewer(globals: ViewerGlobals, options: FakeViewerOptions): any {
  const w: any = {}
  const textures = options.textures
  const surface = options.renderSurface ?? 'frame'

  const backend: any = {
    textures: new Map(Object.keys(textures).map((id) => [id, {}])),
    readPixels: async (id: string) => {
      const t = textures[id]
      if (!t) throw new Error(`unknown texture ${id}`)
      return { width: t.width, height: t.height, data: t.data }
    },
    getName: () => (options.webgpu ? 'webgpu' : 'webgl2'),
  }
  if (options.webgpu) {
    backend.device = { queue: { onSubmittedWorkDone: async () => {} } }
  } else {
    backend.gl = { bindFramebuffer: () => {}, readPixels: () => {} }
  }

  w[globals.renderingPipeline] = {
    backend,
    graph: { passes: options.passes, renderSurface: surface },
    ...(options.frameReadTextures ? { frameReadTextures: new Map(options.frameReadTextures) } : {}),
  }
  // The viewer reports which effect it is showing (issue #34 contract): the
  // namespace/name entry the verb's requested id maps to.
  const requested = options.effectId ?? 'filter/fake'
  const [namespace, name] = [requested.slice(0, requested.indexOf('/')), requested.slice(requested.indexOf('/') + 1)]
  w[globals.currentEffect] = { namespace, name }
  w[globals.pipelineGeneration!] = 0
  w[globals.canvasRenderer] = {
    canvas: { width: W, height: H },
    render: (t: number) => {
      w.__renderTimes = w.__renderTimes || []
      w.__renderTimes.push({ time: t, paused: w.__paused === true })
    },
  }
  w[globals.setPaused] = (v: boolean) => { w.__paused = v }
  w[globals.setPausedTime] = (t: number) => { w.__pausedTime = t }

  ;(globalThis as any).window = w
  ;(globalThis as any).document = { getElementById: () => null }
  return w
}

function makeSession(backend: 'webgl2' | 'webgpu' = 'webgl2'): BrowserSession {
  const session = new BrowserSession({ backend, timeoutMs: 500, globals: DEFAULT_GLOBALS })
  session.page = {
    setViewportSize: async () => {},
    waitForFunction: async () => {},
    evaluate: async (fn: (arg: any) => any, arg: any) => fn(arg),
  } as any
  session.setBackend = async () => {}
  return session
}

describe('testNoPassthrough (issue #31)', () => {
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

  it('reports a static copy of a varied input as passthrough, with the measured output-to-input difference', async () => {
    const input: FakeTex = { width: W, height: H, data: variedBytes() }
    installFakeViewer(DEFAULT_GLOBALS, {
      effectId: 'filter/copy',
      passes: [{ inputs: { inputTex: 'inputTex' } }],
      textures: { inputTex: input, global_frame_read: { width: W, height: H, data: new Uint8Array(input.data) } },
    })
    const session = makeSession()
    const result: any = await testNoPassthrough(session, 'filter/copy')

    expect(result.status).toBe('passthrough')
    expect(result.isFilterEffect).toBe(true)
    expect(result.similarity).toBe(0)
    expect(result.threshold).toBe(0.01)
    expect(result.inputTexture).toBe('inputTex')
    // The verdict was measured at one fixed paused time: every render happened
    // while paused at time 0, and the viewer runs again afterwards.
    const w: any = (globalThis as any).window
    expect(w.__renderTimes.length).toBeGreaterThan(0)
    for (const r of w.__renderTimes) {
      expect(r.paused).toBe(true)
      expect(r.time).toBe(0)
    }
    expect(w.__paused).toBe(false)
  })

  it('reports a filter whose output differs from its input beyond the threshold as ok, with the measured difference', async () => {
    const input: FakeTex = { width: W, height: H, data: variedBytes() }
    installFakeViewer(DEFAULT_GLOBALS, {
      effectId: 'filter/modifying',
      passes: [{ inputs: { inputTex: 'inputTex' } }],
      textures: { inputTex: input, global_frame_read: { width: W, height: H, data: variedBytes(40) } },
    })
    const session = makeSession()
    const result: any = await testNoPassthrough(session, 'filter/modifying')

    expect(result.status).toBe('ok')
    expect(result.isFilterEffect).toBe(true)
    expect(result.similarity).toBeGreaterThan(0.01)
    expect(result.threshold).toBe(0.01)
  })

  it('classifies a compiled-graph binding of inputTex to node_0_out as a filter, not skipped', async () => {
    const input: FakeTex = { width: W, height: H, data: variedBytes() }
    installFakeViewer(DEFAULT_GLOBALS, {
      effectId: 'filter/compiled',
      passes: [{ inputs: { inputTex: 'node_0_out' } }],
      textures: { node_0_out: input, global_frame_read: { width: W, height: H, data: new Uint8Array(input.data) } },
    })
    const session = makeSession()
    const result: any = await testNoPassthrough(session, 'filter/compiled')

    expect(result.status).not.toBe('skipped')
    expect(result.isFilterEffect).toBe(true)
    expect(result.inputTexture).toBe('node_0_out')
  })

  it('does not classify a generator whose bound texture id contains "input" as a filter', async () => {
    installFakeViewer(DEFAULT_GLOBALS, {
      effectId: 'synth/generator',
      passes: [{ inputs: { noiseTex: 'global_inputTex_noise' } }],
      textures: {
        global_inputTex_noise: { width: W, height: H, data: variedBytes() },
        global_frame_read: { width: W, height: H, data: variedBytes() },
      },
    })
    const session = makeSession()
    const result: any = await testNoPassthrough(session, 'synth/generator')

    expect(result.status).toBe('skipped')
    expect(result.isFilterEffect).toBe(false)
  })

  it('measures on a WebGPU-shaped backend (no gl, async readPixels), not "No GL context"', async () => {
    installFakeViewer(DEFAULT_GLOBALS, {
      effectId: 'filter/webgpu',
      webgpu: true,
      passes: [{ inputs: { inputTex: 'inputTex' } }],
      textures: {
        inputTex: { width: W, height: H, data: variedFloats() },
        global_frame_read: { width: W, height: H, data: variedFloats(120) },
      },
    })
    const session = makeSession('webgpu')
    const result: any = await testNoPassthrough(session, 'filter/webgpu')

    expect(result.status).not.toBe('error')
    expect(result.details).not.toContain('No GL context')
    expect(result.isFilterEffect).toBe(true)
    expect(typeof result.similarity).toBe('number')
    expect(result.similarity).toBeGreaterThan(0.01)
    expect(result.status).toBe('ok')
  })

  it('reads the output through the fresh read half named by frameReadTextures, not a stale ping-pong half', async () => {
    const input: FakeTex = { width: W, height: H, data: variedBytes() }
    installFakeViewer(DEFAULT_GLOBALS, {
      effectId: 'filter/pingpong',
      passes: [{ inputs: { inputTex: 'inputTex' } }],
      textures: {
        inputTex: input,
        // The conventional name holds the stale half (inverted); the fresh
        // read half tracked by frameReadTextures holds the rendered copy.
        global_frame_read: { width: W, height: H, data: variedBytes(255) },
        global_frame_read_fresh: { width: W, height: H, data: new Uint8Array(input.data) },
      },
      frameReadTextures: [['frame', 'global_frame_read_fresh']],
    })
    const session = makeSession()
    const result: any = await testNoPassthrough(session, 'filter/pingpong')

    expect(result.status).toBe('passthrough')
    expect(result.similarity).toBe(0)
  })
})