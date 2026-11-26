import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { freshSeed, runSeedOperation } from '../tools/browser/seed.js'
import type { BrowserSession } from '../harness/browser-session.js'

// A renderer module served as a data URL, so the page function can run here
// with the same import it makes in the browser.
function moduleUrl(source: string): string {
  return `data:text/javascript,${encodeURIComponent(source)}`
}

// A Noisemaker 1.x renderer: no seed API.
const RENDERER_1X = moduleUrl(`
export class CanvasRenderer {
  async loadManifest() { return {} }
  async loadEffects() {}
  async compile() {}
  async dispose() {}
}`)

// A renderer with the Noisemaker 2 seed API, holding the program as text.
const RENDERER_2X = moduleUrl(`
export class CanvasRenderer {
  constructor() { this.currentDsl = '' }
  async loadManifest() { return {} }
  async loadEffects() {}
  async compile(dsl) { this.currentDsl = dsl }
  getSeed() {
    const match = /^seed (\\d+)$/m.exec(this.currentDsl)
    return match ? Number(match[1]) : null
  }
  async setSeed(seed) {
    const body = this.currentDsl.replace(/^seed \\d+\\n/m, '')
    this.currentDsl = body.replace(/^(search [^\\n]*\\n)/, '$1seed ' + seed + '\\n')
  }
  async dispose() {}
}`)

function sessionWith(rendererModule: string): BrowserSession {
  return {
    backend: 'webgl2', timeoutMs: 5000,
    page: { evaluate: async (fn: (input: any) => any, input: any) => fn({ ...input, rendererModule }) },
    runWithConsoleCapture: (fn: () => Promise<unknown>) => fn(),
  } as unknown as BrowserSession
}

const closedSession = {
  backend: 'webgl2',
  runWithConsoleCapture: () => { throw new Error('renderer opened') },
} as unknown as BrowserSession

describe('seed tools', () => {
  let originalDocument: any
  beforeEach(() => {
    originalDocument = (globalThis as any).document
    ;(globalThis as any).document = { createElement: () => ({ width: 0, height: 0, remove: () => {} }) }
  })
  afterEach(() => { (globalThis as any).document = originalDocument })

  it('rejects a seed outside 0 to 4294967295, a fraction and an empty program before opening the renderer', async () => {
    for (const seed of [-1, 4294967296, 1.5]) {
      await expect(runSeedOperation(closedSession, 'search synth\nnoise().write(o0)', seed)).rejects.toThrow()
    }
    await expect(runSeedOperation(closedSession, '')).rejects.toThrow()
  })

  it('names the missing seed API when the renderer has none', async () => {
    const result = await runSeedOperation(sessionWith(RENDERER_1X), 'search synth\nnoise().write(o0)')
    expect(result).toEqual({ status: 'error', error: expect.stringContaining('does not support getSeed/setSeed') })
    const set = await runSeedOperation(sessionWith(RENDERER_1X), 'search synth\nnoise().write(o0)', 7)
    expect(set.status).toBe('error')
  })

  it('reads the seed, or null without a seed directive', async () => {
    expect(await runSeedOperation(sessionWith(RENDERER_2X), 'search synth\nseed 42\nnoise().write(o0)')).toEqual({ status: 'ok', seed: 42 })
    expect(await runSeedOperation(sessionWith(RENDERER_2X), 'search synth\nnoise().write(o0)')).toEqual({ status: 'ok', seed: null })
  })

  it('sets the seed and returns the program as the renderer writes it back', async () => {
    const result = await runSeedOperation(sessionWith(RENDERER_2X), 'search synth\nseed 42\nnoise().write(o0)', 4294967295)
    expect(result).toEqual({ status: 'ok', seed: 4294967295, dsl: 'search synth\nseed 4294967295\nnoise().write(o0)' })
  })

  it('draws a fresh seed over the whole range', () => {
    const seeds = Array.from({ length: 64 }, freshSeed)
    for (const seed of seeds) expect(Number.isInteger(seed) && seed >= 0 && seed <= 4294967295).toBe(true)
    expect(new Set(seeds).size).toBeGreaterThan(60)
  })
})
