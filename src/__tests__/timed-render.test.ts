import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { BrowserSession } from '../harness/browser-session.js'
import { DEFAULT_GLOBALS, globalsFromPrefix } from '../harness/types.js'
import { renderEffectFrame } from '../tools/browser/render.js'
import { resetBrowserQueue } from '../harness/browser-queue.js'
import { getRefCount, releaseServer } from '../harness/server-manager.js'

// Runs the serialized in-page callbacks for real inside Node: a fake page whose
// evaluate invokes the payload function against a fake window/document. This
// exercises the actual warmup poll, pause/unpause ordering and capture code —
// including the timed-render path where a paused viewer freezes the frame
// counter — without a browser.

function installFakeViewer(globals: ReturnType<typeof globalsFromPrefix>): void {
  const w: any = {}
  let frames = 0
  w[globals.renderingPipeline] = {
    backend: {
      gl: {
        bindFramebuffer: () => {},
        readPixels: (_x: number, _y: number, _wd: number, _ht: number, _f: number, _t: number, out: Uint8Array) => {
          out.fill(128)
        },
      },
      getName: () => 'webgl2',
    },
  }
  w[globals.canvasRenderer] = {
    canvas: { width: 2, height: 2 },
    render: () => { frames++ },
  }
  Object.defineProperty(w, globals.frameCount, {
    configurable: true,
    get: () => frames,
  })
  w[globals.setPaused] = (v: boolean) => { w.__paused = v }
  w[globals.setPausedTime] = () => {}

  ;(globalThis as any).window = w
  ;(globalThis as any).requestAnimationFrame = (cb: () => void) => setTimeout(() => { frames++; cb() }, 0)
  ;(globalThis as any).document = {
    getElementById: () => null,
    createElement: () => ({ width: 0, height: 0, getContext: () => null }),
  }
}

function makeSession(timeoutMs = 500): BrowserSession {
  const session = new BrowserSession({ backend: 'webgl2', timeoutMs })
  session.page = {
    setViewportSize: async () => {},
    waitForFunction: async () => {},
    evaluate: async (fn: (arg: any) => any, arg: any) => fn(arg),
  } as any
  session.setBackend = async () => {}
  return session
}

describe('renderEffectFrame timed capture', () => {
  let originalWindow: any
  let originalRaf: any
  let originalDocument: any

  beforeEach(() => {
    resetBrowserQueue()
    originalWindow = (globalThis as any).window
    originalRaf = (globalThis as any).requestAnimationFrame
    originalDocument = (globalThis as any).document
    installFakeViewer(DEFAULT_GLOBALS)
  })

  afterEach(() => {
    ;(globalThis as any).window = originalWindow
    ;(globalThis as any).requestAnimationFrame = originalRaf
    ;(globalThis as any).document = originalDocument
    while (getRefCount() > 0) releaseServer()
  })

  it('warms up before pausing, then pauses, captures and unpauses for a timed render', async () => {
    const session = makeSession()
    const window: any = (globalThis as any).window
    const events: string[] = []
    const evaluate = session.page!.evaluate.bind(session.page)
    session.page!.evaluate = async (fn: any, arg: any) => {
      const src = String(fn)
      if (src.includes('frameCount') && src.includes('requestAnimationFrame')) events.push('warmup')
      if (src.includes('setPaused') && src.includes('PausedTime')) events.push(`pause@${window[DEFAULT_GLOBALS.frameCount]}`)
      if (src.includes('readPixels')) events.push(`capture@paused=${window.__paused}`)
      if (src.includes('setPaused') && !src.includes('PausedTime')) events.push('unpause')
      return evaluate(fn, arg)
    }

    const result = await renderEffectFrame(session, 'synth/noise', { time: 1.5, warmupFrames: 3 })

    expect(result.status).toBe('ok')
    expect(events[0]).toBe('warmup')
    expect(events[1]).toMatch(/^pause@\d+$/)
    expect(events[events.length - 1]).toBe('unpause')
    expect(window.__paused).toBe(false)
  })

  it('still unpauses when the capture throws', async () => {
    const session = makeSession()
    const window: any = (globalThis as any).window
    const evaluate = session.page!.evaluate.bind(session.page)
    vi.spyOn(session.page!, 'evaluate').mockImplementation(async (fn: any, arg: any) => {
      if (String(fn).includes('captureImage')) throw new Error('capture exploded')
      return evaluate(fn, arg)
    })

    await expect(renderEffectFrame(session, 'synth/noise', { time: 1.0, warmupFrames: 1 }))
      .rejects.toThrow('capture exploded')
    expect(window.__paused).toBe(false)
  })

  it('bounds the warmup wait when the frame counter never advances', async () => {
    const session = makeSession(80)
    const window: any = (globalThis as any).window
    Object.defineProperty(window, DEFAULT_GLOBALS.frameCount, {
      configurable: true,
      get: () => 0,
    })

    await expect(renderEffectFrame(session, 'synth/noise', { warmupFrames: 5 }))
      .rejects.toThrow(/Warmup timed out/)
  })
})
