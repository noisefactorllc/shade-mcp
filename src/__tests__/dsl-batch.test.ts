import { afterEach, describe, expect, it, vi } from 'vitest'
import { runDslProgram } from '../tools/browser/dsl.js'
import type { BrowserSession } from '../harness/browser-session.js'

describe('runDslProgram batch inputs', () => {
  afterEach(() => vi.unstubAllEnvs())
  const session = {
    backend: 'webgl2',
    runWithConsoleCapture: () => { throw new Error('renderer opened') },
  } as unknown as BrowserSession

  it('rejects unsorted capture frames before opening the renderer', async () => {
    await expect(runDslProgram(session, 'noise().write(o0)', { frames: [120, 1] }))
      .rejects.toThrow('Capture frames must be strictly increasing')
  })

  it('rejects traversal and oversized authored selections before opening the renderer', async () => {
    await expect(runDslProgram(session, 'noise().write(o0)', { effects: '../outside' }))
      .rejects.toThrow(/Invalid.*effect/)
    await expect(runDslProgram(session, 'noise().write(o0)', { effects: Array(17).fill('user/one').join(',') }))
      .rejects.toThrow(/16/)
  })

  it('bounds the contact-sheet allocation before opening the renderer', async () => {
    await expect(runDslProgram(session, 'noise().write(o0)', {
      frames: [1, 2, 3], cellResolution: [1920, 1080],
    })).rejects.toThrow('Contact sheet exceeds the 4 million pixel limit')
  })

  it('passes the separate Portable DSL runtime to the fresh browser page', async () => {
    vi.stubEnv('SHADE_DSL_RENDERER_MODULE', 'https://shaders.noisedeck.app/1/noisemaker-shaders-core.esm.js')
    vi.stubEnv('SHADE_DSL_ASSETS_BASE', 'https://shaders.noisedeck.app/1')
    vi.stubEnv('SHADE_DSL_USE_BUNDLES', 'true')
    let browserInput: any
    const portableSession = {
      backend: 'webgl2', timeoutMs: 100,
      page: { evaluate: async (_fn: unknown, input: unknown) => {
        browserInput = input
        return { status: 'error', error: 'fixture stopped before browser render' }
      } },
      runWithConsoleCapture: (fn: () => Promise<unknown>) => fn(),
    } as unknown as BrowserSession
    await runDslProgram(portableSession, 'noise().write(o0)', { frames: [1], resolution: [16, 16] })
    expect(browserInput.rendererModule).toBe('https://shaders.noisedeck.app/1/noisemaker-shaders-core.esm.js')
    expect(browserInput.assetsBase).toBe('https://shaders.noisedeck.app/1')
    expect(browserInput.useBundles).toBe(true)
  })
})
