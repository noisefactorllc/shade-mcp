import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { BrowserSession } from '../harness/browser-session.js'
import { DEFAULT_GLOBALS } from '../harness/types.js'
import { computeImageMetrics } from '../harness/pixel-reader.js'
import { renderEffectFrame } from '../tools/browser/render.js'
import { resetBrowserQueue } from '../harness/browser-queue.js'
import { getRefCount, releaseServer } from '../harness/server-manager.js'

// Issue #29: renderEffectFrame and computeImageMetrics (used by runDslProgram
// and the library export) returned the same ImageMetrics fields with
// different meanings. Both now share one definition; this pins it by feeding
// the same screen-order buffers to the render verb (through a WebGPU-shaped
// fake viewer, run in Node like render-readback.test.ts) and to the helper.

const SIZE = 64

function buffer(fill: (i: number) => [number, number, number, number]): Uint8Array {
  const data = new Uint8Array(SIZE * SIZE * 4)
  for (let i = 0; i < SIZE * SIZE; i++) data.set(fill(i), i * 4)
  return data
}

// Same sample stride the metrics use (~1000 samples).
const STRIDE = Math.max(1, Math.floor((SIZE * SIZE) / 1000))

const BUFFERS: Record<string, Uint8Array> = {
  'flat bright gray': buffer(() => [200, 200, 200, 255]),
  'alternating 200/201 samples': buffer(i => {
    const v = (i / STRIDE) % 2 === 0 ? 200 : 201
    return [v, v, v, 255]
  }),
  'one opaque sample': buffer(i => [50, 50, 50, i === 0 ? 255 : 0]),
  'all zero': buffer(() => [0, 0, 0, 0]),
}

function flipRows(topDown: Uint8Array): Uint8Array {
  const out = new Uint8Array(topDown.length)
  const rowBytes = SIZE * 4
  for (let y = 0; y < SIZE; y++) out.set(topDown.subarray(y * rowBytes, (y + 1) * rowBytes), (SIZE - 1 - y) * rowBytes)
  return out
}

function installFakeViewer(screen: Uint8Array): void {
  const g = DEFAULT_GLOBALS
  const w: any = {}
  const bottomUp = flipRows(screen)
  w[g.renderingPipeline] = {
    backend: {
      getName: () => 'webgpu',
      textures: new Map([['global_frame_read', {}]]),
      device: { queue: { onSubmittedWorkDone: async () => {} } },
      readPixels: async () => ({ data: bottomUp, width: SIZE, height: SIZE }),
    },
    graph: { renderSurface: 'frame', passes: [{ inputs: {} }] },
    setUniform: () => {},
    globalUniforms: {},
  }
  w[g.canvasRenderer] = { canvas: { width: SIZE, height: SIZE }, render: () => {} }
  w[g.currentEffect] = { namespace: 'synth', name: 'noise', instance: { globals: {} } }
  w[g.pipelineGeneration!] = 0
  let frames = 0
  Object.defineProperty(w, g.frameCount, { configurable: true, get: () => frames })
  w[g.setPaused] = () => {}
  w[g.setPausedTime] = () => {}
  ;(globalThis as any).window = w
  ;(globalThis as any).requestAnimationFrame = (cb: () => void) => setTimeout(() => { frames++; cb() }, 0)
  ;(globalThis as any).document = {
    getElementById: (id: string) => id === 'effect-select'
      ? {
          value: 'synth/noise',
          dispatchEvent: (ev: Event) => {
            if (ev.type !== 'change') return
            const pipeline = w[g.renderingPipeline]
            pipeline.graph = { ...pipeline.graph }
            w[g.pipelineGeneration!] = (w[g.pipelineGeneration!] || 0) + 1
          },
        }
      : null,
    createElement: () => ({ getContext: () => null }),
  }
}

function makeSession(): BrowserSession {
  const session = new BrowserSession({ backend: 'webgpu', timeoutMs: 500, globals: DEFAULT_GLOBALS })
  session.page = {
    setViewportSize: async () => {},
    waitForFunction: async () => {},
    evaluate: async (fn: (arg: any) => any, arg: any) => fn(arg),
  } as any
  session.setBackend = async () => {}
  return session
}

describe('ImageMetrics contract (issue #29)', () => {
  let saved: any[]
  beforeEach(() => {
    resetBrowserQueue()
    saved = [(globalThis as any).window, (globalThis as any).requestAnimationFrame, (globalThis as any).document]
  })
  afterEach(() => {
    ;[(globalThis as any).window, (globalThis as any).requestAnimationFrame, (globalThis as any).document] = saved
    while (getRefCount() > 0) releaseServer()
  })

  for (const [name, screen] of Object.entries(BUFFERS)) {
    it(`renderEffectFrame and computeImageMetrics agree on every field: ${name}`, async () => {
      installFakeViewer(screen)
      const result = await renderEffectFrame(makeSession(), 'synth/noise', { warmupFrames: 1 })
      expect(result.status).toBe('ok')
      const verb: any = result.metrics
      const lib: any = computeImageMetrics(screen, SIZE, SIZE)
      expect(Object.keys(verb).sort()).toEqual(Object.keys(lib).sort())
      for (const key of Object.keys(lib)) {
        if (Array.isArray(lib[key])) lib[key].forEach((v: number, i: number) => expect(verb[key][i]).toBeCloseTo(v, 9))
        else if (typeof lib[key] === 'number') expect(verb[key]).toBeCloseTo(lib[key], 9)
        else expect(verb[key]).toBe(lib[key])
      }
      expect((result as any).pixels).toBeUndefined()
    })
  }

  it('pins the shared definitions on the issue buffers', () => {
    const m = (name: string) => computeImageMetrics(BUFFERS[name], SIZE, SIZE)
    expect(m('flat bright gray').is_essentially_blank).toBe(true)
    expect(m('alternating 200/201 samples').unique_sampled_colors).toBe(2)
    expect(m('alternating 200/201 samples').is_monochrome).toBe(false)
    expect(m('one opaque sample').is_all_transparent).toBe(false)
    expect(m('all zero').is_all_transparent).toBe(true)
    expect(m('all zero').is_essentially_blank).toBe(true)
  })
})
