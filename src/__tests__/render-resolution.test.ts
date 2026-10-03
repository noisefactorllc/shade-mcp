import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { BrowserSession } from '../harness/browser-session.js'
import { DEFAULT_GLOBALS, type ViewerGlobals } from '../harness/types.js'
import { renderEffectFrame } from '../tools/browser/render.js'
import { benchmarkEffectFPS } from '../tools/browser/benchmark.js'
import { resetBrowserQueue } from '../harness/browser-queue.js'
import { getRefCount, releaseServer } from '../harness/server-manager.js'

// Fake-viewer reproduction of issue #33: `resolution` only sets the Playwright
// viewport, while the render canvas backing size is owned by the viewer's own
// layout logic. A viewer whose canvas does not follow the window captured at a
// different size and returned a silent `ok`. These tests pin the contract:
// the result echoes the request in `requested_resolution`, warns when the
// actual frame size differs, and stays warning-free when it matches.

interface FakeViewerOptions {
  canvasWidth: number
  canvasHeight: number
  // The viewer's layout owns the canvas size: assignments are ignored (a
  // frozen object throws under strict-mode assignment, like a real canvas
  // whose backing size is managed elsewhere).
  fixed?: boolean
  // The viewer exposes a resize hook that honors the request.
  resizeHook?: boolean
}

function installFakeViewer(globals: ViewerGlobals, options: FakeViewerOptions): any {
  const w: any = {}
  let frames = 0
  w[globals.renderingPipeline] = {
    backend: {
      gl: {
        bindFramebuffer: () => {},
        readPixels: (_x: number, _y: number, wd: number, ht: number, _f: number, _t: number, out: Uint8Array) => {
          if (out.length === wd * ht * 4) out.fill(128)
        },
      },
      getName: () => 'webgl2',
    },
  }
  const canvas: any = options.fixed
    ? Object.freeze({ width: options.canvasWidth, height: options.canvasHeight })
    : { width: options.canvasWidth, height: options.canvasHeight }
  w[globals.canvasRenderer] = {
    canvas,
    resize: options.resizeHook
      ? (width: number, height: number) => {
          w.__resizeCalled = (w.__resizeCalled || 0) + 1
          canvas.width = width
          canvas.height = height
        }
      : undefined,
    render: () => { frames++ },
  }
  Object.defineProperty(w, globals.frameCount, { configurable: true, get: () => frames })
  w[globals.setPaused] = (v: boolean) => { w.__paused = v }
  w[globals.setPausedTime] = (t: number) => { w.__pausedTime = t }

  ;(globalThis as any).window = w
  ;(globalThis as any).requestAnimationFrame = (cb: () => void) => setTimeout(() => { frames++; cb() }, 0)
  ;(globalThis as any).document = {
    getElementById: () => null,
    createElement: () => ({ width: 0, height: 0, getContext: () => null }),
  }
  return w
}

function makeSession(timeoutMs = 500): { session: BrowserSession; viewportCalls: Array<{ width: number; height: number }> } {
  const session = new BrowserSession({ backend: 'webgl2', timeoutMs })
  const viewportCalls: Array<{ width: number; height: number }> = []
  session.page = {
    setViewportSize: async (size: { width: number; height: number }) => { viewportCalls.push(size) },
    waitForFunction: async () => {},
    evaluate: async (fn: (arg: any) => any, arg: any) => fn(arg),
  } as any
  session.setBackend = async () => {}
  return { session, viewportCalls }
}

describe('renderEffectFrame resolution honoring (issue #33)', () => {
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

  it('does not return a silent ok when a fixed-size viewer ignores the requested resolution', async () => {
    installFakeViewer(DEFAULT_GLOBALS, { canvasWidth: 90, canvasHeight: 90, fixed: true })
    const { session, viewportCalls } = makeSession()

    const result = await renderEffectFrame(session, 'synth/noise', { warmupFrames: 2, resolution: [256, 256] })

    // The request was applied to the viewport...
    expect(viewportCalls).toEqual([{ width: 256, height: 256 }])
    // ...but the viewer kept its own 90x90 canvas, so the result must say so
    // explicitly instead of a silent `ok` with only the actual size.
    expect(result.status).toBe('ok')
    expect(result.requested_resolution).toEqual([256, 256])
    expect(result.frame?.width).toBe(90)
    expect(result.frame?.height).toBe(90)
    expect(result.warning).toContain('256x256')
    expect(result.warning).toContain('90x90')
  })

  it('renders at the requested size when sizing the canvas honors the request', async () => {
    installFakeViewer(DEFAULT_GLOBALS, { canvasWidth: 90, canvasHeight: 90 })
    const { session } = makeSession()

    const result = await renderEffectFrame(session, 'synth/noise', { warmupFrames: 2, resolution: [256, 256] })

    expect(result.status).toBe('ok')
    expect(result.requested_resolution).toEqual([256, 256])
    expect(result.frame?.width).toBe(256)
    expect(result.frame?.height).toBe(256)
    expect(result.warning).toBeUndefined()
  })

  it('prefers the viewer resize hook when one is exposed', async () => {
    const w = installFakeViewer(DEFAULT_GLOBALS, { canvasWidth: 90, canvasHeight: 90, resizeHook: true })
    const { session } = makeSession()

    const result = await renderEffectFrame(session, 'synth/noise', { warmupFrames: 2, resolution: [256, 256] })

    expect(w.__resizeCalled).toBe(1)
    expect(result.frame?.width).toBe(256)
    expect(result.frame?.height).toBe(256)
    expect(result.warning).toBeUndefined()
  })

  it('does not warn when the viewer already matches the requested size', async () => {
    installFakeViewer(DEFAULT_GLOBALS, { canvasWidth: 256, canvasHeight: 256, fixed: true })
    const { session } = makeSession()

    const result = await renderEffectFrame(session, 'synth/noise', { warmupFrames: 2, resolution: [256, 256] })

    expect(result.status).toBe('ok')
    expect(result.requested_resolution).toEqual([256, 256])
    expect(result.frame?.width).toBe(256)
    expect(result.frame?.height).toBe(256)
    expect(result.warning).toBeUndefined()
  })

  it('leaves a call without resolution unchanged', async () => {
    installFakeViewer(DEFAULT_GLOBALS, { canvasWidth: 90, canvasHeight: 90, fixed: true })
    const { session, viewportCalls } = makeSession()

    const result = await renderEffectFrame(session, 'synth/noise', { warmupFrames: 2 })

    expect(viewportCalls).toEqual([])
    expect(result.status).toBe('ok')
    expect(result.frame?.width).toBe(90)
    expect(result.frame?.height).toBe(90)
    expect(result.warning).toBeUndefined()
    expect(result.requested_resolution).toBeUndefined()
  })
})

describe('benchmarkEffectFPS frame size reporting (issue #33)', () => {
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

  it('reports the measured frame size when resolution is given', async () => {
    installFakeViewer(DEFAULT_GLOBALS, { canvasWidth: 90, canvasHeight: 90, fixed: true })
    const { session } = makeSession()

    const result = await benchmarkEffectFPS(session, 'synth/noise', { durationSeconds: 0.05, resolution: [256, 256] })

    expect(result.status).toBe('ok')
    expect(result.requested_resolution).toEqual([256, 256])
    expect(result.frame).toEqual({ width: 90, height: 90 })
    expect(result.warning).toContain('256x256')
    expect(result.warning).toContain('90x90')
  })

  it('does not warn when the measured size matches the request', async () => {
    installFakeViewer(DEFAULT_GLOBALS, { canvasWidth: 256, canvasHeight: 256, fixed: true })
    const { session } = makeSession()

    const result = await benchmarkEffectFPS(session, 'synth/noise', { durationSeconds: 0.05, resolution: [256, 256] })

    expect(result.frame).toEqual({ width: 256, height: 256 })
    expect(result.warning).toBeUndefined()
  })

  it('still reports the frame size without a resolution request', async () => {
    installFakeViewer(DEFAULT_GLOBALS, { canvasWidth: 90, canvasHeight: 90, fixed: true })
    const { session } = makeSession()

    const result = await benchmarkEffectFPS(session, 'synth/noise', { durationSeconds: 0.05 })

    expect(result.frame).toEqual({ width: 90, height: 90 })
    expect(result.warning).toBeUndefined()
    expect(result.requested_resolution).toBeUndefined()
  })
})