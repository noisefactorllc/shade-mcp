import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { BrowserSession } from '../harness/browser-session.js'
import { DEFAULT_GLOBALS, type ViewerGlobals } from '../harness/types.js'
import { testUniformResponsiveness } from '../tools/browser/uniforms.js'
import { resetBrowserQueue } from '../harness/browser-queue.js'
import { getRefCount, releaseServer } from '../harness/server-manager.js'

// Controls that are inert at an effect's defaults are not dead controls:
// a speed-like uniform changes nothing at t=0, and a control behind an unmet
// enabledBy condition only acts once its gate opens. The fake viewer's single
// grey level is computed by `shade(values, time)` from the current uniform
// values and the render time.

type Shade = (values: Record<string, any>, time: number) => number

function installFakeViewer(globals: ViewerGlobals, specs: Record<string, any>, shade: Shade): void {
  const w: any = {}
  const values: Record<string, any> = {}
  for (const spec of Object.values(specs) as any[]) if (spec.uniform) values[spec.uniform] = spec.default ?? spec.min
  let time = 0
  w[globals.renderingPipeline] = {
    backend: {
      gl: {
        bindFramebuffer: () => {},
        readPixels: (_x: number, _y: number, _wd: number, _ht: number, _f: number, _t: number, out: Uint8Array) => {
          const c = Math.max(0, Math.min(255, Math.round(shade(values, time) * 255)))
          for (let i = 0; i < out.length; i += 4) { out[i] = c; out[i + 1] = c; out[i + 2] = c; out[i + 3] = 255 }
        },
      },
      getName: () => 'webgl2',
    },
    isCompiling: false,
    graph: { passes: [{ name: 'main' }], renderSurface: 'frame' },
    setUniform: (name: string, val: any) => { values[name] = val },
  }
  w[globals.currentEffect] = { namespace: 'synth', name: 'noise', instance: { globals: specs } }
  w[globals.pipelineGeneration!] = 0
  w[globals.canvasRenderer] = { canvas: { width: 2, height: 2 }, render: (t: number) => { time = t } }
  ;(globalThis as any).window = w
  ;(globalThis as any).document = {
    getElementById: (id: string) => id === 'effect-select'
      ? {
          value: 'synth/noise',
          dispatchEvent: (ev: Event) => {
            if (ev.type !== 'change') return
            const pipeline = w[globals.renderingPipeline] as any
            pipeline.graph = { ...pipeline.graph }
            w[globals.pipelineGeneration!] = (w[globals.pipelineGeneration!] || 0) + 1
          },
        }
      : null,
    createElement: () => ({ width: 0, height: 0, getContext: () => null }),
  }
}

function makeSession(): BrowserSession {
  const session = new BrowserSession({ backend: 'webgl2', timeoutMs: 500, globals: DEFAULT_GLOBALS })
  session.page = {
    setViewportSize: async () => {},
    waitForFunction: async () => {},
    evaluate: async (fn: (arg: any) => any, arg: any) => fn(arg),
  } as any
  session.setBackend = async () => {}
  return session
}

describe('testUniformResponsiveness: controls inert at defaults', () => {
  let saved: any[]
  beforeEach(() => { resetBrowserQueue(); saved = [(globalThis as any).window, (globalThis as any).document] })
  afterEach(() => {
    ;[(globalThis as any).window, (globalThis as any).document] = saved
    while (getRefCount() > 0) releaseServer()
  })

  it('counts a speed-like control that only acts after t=0 as responsive', async () => {
    const specs = { speed: { uniform: 'u_speed', type: 'float', min: 0, max: 10, default: 1 } }
    installFakeViewer(DEFAULT_GLOBALS, specs, (v, t) => (0.2 + 0.05 * v.u_speed * t) % 1)
    const result = await testUniformResponsiveness(makeSession(), 'synth/noise')
    expect(result.status).toBe('ok')
    expect(result.uniforms[0].responds).toBe(true)
  })

  it('opens an enabledBy gate before measuring the gated control', async () => {
    const specs = {
      mode: { uniform: 'u_mode', type: 'int', min: 0, max: 6, default: 0 },
      hueRange: { uniform: 'u_hue', type: 'float', min: 0, max: 1, default: 0.5, ui: { enabledBy: { param: 'mode', eq: 4 } } },
    }
    // hueRange acts only in mode 4; mode itself moves the output too.
    installFakeViewer(DEFAULT_GLOBALS, specs, (v) => 0.1 * v.u_mode / 6 + (v.u_mode === 4 ? 0.5 * v.u_hue : 0))
    const result = await testUniformResponsiveness(makeSession(), 'synth/noise')
    const hue = result.uniforms.find((u: any) => u.name === 'hueRange')
    expect(hue.responds).toBe(true)
    expect(hue.enabled_with).toEqual({ mode: 4 })
    expect(result.status).toBe('ok')
  })

  it('reports a control whose gate is a compile-time define as gated, not failed', async () => {
    const specs = {
      noiseType: { define: 'NOISE_TYPE', type: 'int', default: 0, choices: { a: 0, b: 1 } },
      amount: { uniform: 'u_amount', type: 'float', min: 0, max: 1, default: 0.5 },
      detail: { uniform: 'u_detail', type: 'float', min: 0, max: 1, default: 0.5, ui: { enabledBy: { param: 'noiseType', eq: 1 } } },
    }
    installFakeViewer(DEFAULT_GLOBALS, specs, (v) => v.u_amount)
    const result = await testUniformResponsiveness(makeSession(), 'synth/noise')
    expect(result.status).toBe('ok')
    expect(result.tested_uniforms).toEqual(expect.arrayContaining(['amount:pass', 'detail:gated']))
    expect(result.uniforms.find((u: any) => u.name === 'detail')).toMatchObject({ gated: true, responds: null })
    expect(result.details).toContain('gated')
  })

  it('still fails a control that is ungated and never moves the output', async () => {
    const specs = {
      amount: { uniform: 'u_amount', type: 'float', min: 0, max: 1, default: 0.5 },
      unused: { uniform: 'u_unused', type: 'float', min: 0, max: 1, default: 0.5 },
    }
    installFakeViewer(DEFAULT_GLOBALS, specs, (v) => v.u_amount)
    const result = await testUniformResponsiveness(makeSession(), 'synth/noise')
    expect(result.status).toBe('fail')
    expect(result.details).toContain('unused')
  })
})
