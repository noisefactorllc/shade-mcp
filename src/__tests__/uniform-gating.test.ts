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

type Shade = (values: Record<string, any>, time: number, pixel: number) => number

function installFakeViewer(globals: ViewerGlobals, specs: Record<string, any>, shade: Shade, alpha?: (values: Record<string, any>) => number,
  enums: Record<string, number> = {}): void {
  const w: any = {}
  const values: Record<string, any> = {}
  const convert = (value: any) => (typeof value === 'string' && value in enums ? enums[value] : value)
  for (const spec of Object.values(specs) as any[]) if (spec.uniform) values[spec.uniform] = convert(spec.default ?? spec.min)
  let time = 0
  w[globals.renderingPipeline] = {
    backend: {
      gl: {
        bindFramebuffer: () => {},
        readPixels: (_x: number, _y: number, _wd: number, _ht: number, _f: number, _t: number, out: Uint8Array) => {
          for (let i = 0; i < out.length; i += 4) {
            const c = Math.max(0, Math.min(255, Math.round(shade(values, time, i / 4) * 255)))
            out[i] = c; out[i + 1] = c; out[i + 2] = c
            out[i + 3] = alpha ? Math.round(alpha(values) * 255) : 255
          }
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
  w[globals.canvasRenderer] = {
    canvas: { width: 2, height: 2 },
    render: (t: number) => { time = t },
    convertParameterForUniform: (value: any) => convert(value),
  }
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

  it('counts a control that moves pixels without changing the mean color as responsive', async () => {
    // An offset that shifts a two-tone pattern: the frame mean stays 0.5.
    const specs = { offset: { uniform: 'u_offset', type: 'int', min: 0, max: 1, default: 0 } }
    installFakeViewer(DEFAULT_GLOBALS, specs, (v, _t, px) => ((px + v.u_offset) % 2 === 0 ? 0 : 1))
    const result = await testUniformResponsiveness(makeSession(), 'synth/noise')
    expect(result.status).toBe('ok')
    expect(result.uniforms[0].luma_diff).toBe(0)
    expect(result.uniforms[0].pixel_diff).toBeGreaterThan(0.5)
  })

  it('never tests a control at its own default value', async () => {
    // strength defaults to the 25% point of its range.
    const specs = { strength: { uniform: 'u_strength', type: 'float', min: 0, max: 100, default: 25 } }
    installFakeViewer(DEFAULT_GLOBALS, specs, (v) => v.u_strength / 100)
    const result = await testUniformResponsiveness(makeSession(), 'synth/noise')
    expect(result.status).toBe('ok')
    expect(result.uniforms[0].test_value).not.toBe(25)
  })

  it('tries a second value when the input is symmetric under the first', async () => {
    // A rotation over a pattern that looks the same at multiples of 90 degrees.
    const specs = { rotation: { uniform: 'u_rotation', type: 'float', min: -180, max: 180, default: 0 } }
    installFakeViewer(DEFAULT_GLOBALS, specs, (v) => (Math.abs(v.u_rotation) % 90 === 0 ? 0.5 : 0.8))
    const result = await testUniformResponsiveness(makeSession(), 'synth/noise')
    expect(result.status).toBe('ok')
    expect(Math.abs(result.uniforms[0].test_value) % 90).not.toBe(0)
  })

  it('counts a control that changes only alpha as responsive', async () => {
    const specs = { bgAlpha: { uniform: 'u_bgAlpha', type: 'float', min: 0, max: 1, default: 1 } }
    installFakeViewer(DEFAULT_GLOBALS, specs, () => 0.5, (v) => v.u_bgAlpha)
    const result = await testUniformResponsiveness(makeSession(), 'synth/noise')
    expect(result.status).toBe('ok')
  })

  it('opens a threshold gate far enough for the gated control to show', async () => {
    // Like glitch's xChonk: its effect scales with glitchiness, so just past
    // the gate's threshold it is too small to measure.
    const specs = {
      glitchiness: { uniform: 'u_glitch', type: 'float', min: 0, max: 100, default: 0 },
      xChonk: { uniform: 'u_x', type: 'int', min: 1, max: 100, default: 1, ui: { enabledBy: { param: 'glitchiness', gt: 0 } } },
    }
    installFakeViewer(DEFAULT_GLOBALS, specs, (v) => 0.2 + (v.u_glitch / 100) * 0.3 + (v.u_glitch / 100) * (v.u_x / 100) * 0.05)
    const result = await testUniformResponsiveness(makeSession(), 'synth/noise')
    const x = result.uniforms.find((u: any) => u.name === 'xChonk')
    expect(x.responds).toBe(true)
    expect(x.enabled_with).toEqual({ glitchiness: 50 })
  })

  it('opens a gate on a member enum with the enum value it names', async () => {
    const specs = {
      oscType: { uniform: 'u_osc', type: 'member', enum: 'oscType', default: 'oscType.sine' },
      seed: { uniform: 'u_seed', type: 'int', min: 1, max: 100, default: 1,
        ui: { enabledBy: { param: 'oscType', in: ['oscType.noise1d', 'oscType.noise2d'] } } },
    }
    const enums = { 'oscType.sine': 0, 'oscType.noise1d': 3, 'oscType.noise2d': 4 }
    installFakeViewer(DEFAULT_GLOBALS, specs, (v) => (v.u_osc === 3 ? 0.2 + 0.5 * v.u_seed / 100 : 0.2), undefined, enums)
    const result = await testUniformResponsiveness(makeSession(), 'synth/noise')
    const seed = result.uniforms.find((u: any) => u.name === 'seed')
    expect(seed.responds).toBe(true)
    expect(seed.enabled_with).toEqual({ oscType: 'oscType.noise1d' })
  })

  it('opens a gate that needs a vector to differ from a neutral value', async () => {
    const neutral = [0.5, 0.5, 0.5]
    const specs = {
      tint: { uniform: 'u_tint', type: 'vec3', default: neutral },
      balance: { uniform: 'u_balance', type: 'float', min: -1, max: 1, default: 0,
        ui: { enabledBy: { param: 'tint', neq: neutral } } },
    }
    const tinted = (t: number[]) => t.some((c, i) => Math.abs(c - neutral[i]) > 1e-4)
    installFakeViewer(DEFAULT_GLOBALS, specs, (v) => 0.4 + (tinted(v.u_tint) ? 0.3 * v.u_balance : 0))
    const result = await testUniformResponsiveness(makeSession(), 'synth/noise')
    const balance = result.uniforms.find((u: any) => u.name === 'balance')
    expect(balance.responds).toBe(true)
    expect(balance.enabled_with.tint).toEqual([0.75, 0.75, 0.75])
  })

  it('reports a compile-time define as gated instead of measuring it', async () => {
    const specs = {
      amount: { uniform: 'u_amount', type: 'float', min: 0, max: 1, default: 0.5 },
      border: { uniform: 'u_border', define: 'LP_BORDER', type: 'int', min: 0, max: 100, default: 0 },
    }
    installFakeViewer(DEFAULT_GLOBALS, specs, (v) => v.u_amount)
    const result = await testUniformResponsiveness(makeSession(), 'synth/noise')
    expect(result.status).toBe('ok')
    expect(result.uniforms.find((u: any) => u.name === 'border')).toMatchObject({ gated: true, define: 'LP_BORDER', responds: null })
  })

  it('counts a control that acts only with another control changed, and names that context', async () => {
    // Like grade's HSL range: it selects what the adjustment changes, so at a
    // zero adjustment it does nothing.
    const specs = {
      adjust: { uniform: 'u_adjust', type: 'float', min: -1, max: 1, default: 0 },
      range: { uniform: 'u_range', type: 'float', min: 0, max: 1, default: 0.5 },
    }
    installFakeViewer(DEFAULT_GLOBALS, specs, (v) => 0.4 + 0.3 * v.u_adjust * v.u_range)
    const result = await testUniformResponsiveness(makeSession(), 'synth/noise')
    expect(result.status).toBe('ok')
    const range = result.uniforms.find((u: any) => u.name === 'range')
    expect(range.responds).toBe(true)
    expect(range.context).toEqual({ adjust: -0.5 })
  })

  it('opens the gates of other controls it varies for the context', async () => {
    // Like grade: the hue range and the hue shift both sit behind hslEnable.
    const specs = {
      hslEnable: { uniform: 'u_enable', type: 'int', min: 0, max: 1, default: 0 },
      hueShift: { uniform: 'u_shift', type: 'float', min: -1, max: 1, default: 0, ui: { enabledBy: 'hslEnable' } },
      hueRange: { uniform: 'u_range', type: 'float', min: 0, max: 1, default: 0.5, ui: { enabledBy: 'hslEnable' } },
    }
    installFakeViewer(DEFAULT_GLOBALS, specs, (v) => 0.4 + (v.u_enable ? 0.3 * v.u_shift * v.u_range : 0))
    const result = await testUniformResponsiveness(makeSession(), 'synth/noise')
    const range = result.uniforms.find((u: any) => u.name === 'hueRange')
    expect(range.responds).toBe(true)
    expect(range.context).toMatchObject({ hslEnable: 1, hueShift: -0.5 })
  })

  it('waits for an async overlay to regenerate before capturing', async () => {
    const specs = { density: { uniform: 'u_density', type: 'float', min: 0, max: 1, default: 0.5 } }
    let drawn = 0.5
    installFakeViewer(DEFAULT_GLOBALS, specs, () => 0.2 + 0.5 * drawn)
    const w = (globalThis as any).window
    const pipeline = w[DEFAULT_GLOBALS.renderingPipeline]
    let pending: number | null = null
    const set = pipeline.setUniform
    pipeline.setUniform = (name: string, val: any) => { set(name, val); if (name === 'u_density') pending = val }
    pipeline.whenAsyncInitsSettled = async () => { if (pending !== null) { drawn = pending; pending = null } }
    const result = await testUniformResponsiveness(makeSession(), 'synth/noise')
    expect(result.status).toBe('ok')
  })

  it('restores each control to the value the program set, not its spec default', async () => {
    // A defaultProgram like sharpen(amount: 5): the baseline is captured at
    // amount 0.9, so restoring to the spec default would make the inert
    // control after it look responsive.
    const specs = {
      amount: { uniform: 'u_amount', type: 'float', min: 0, max: 1, default: 0.5 },
      inert: { uniform: 'u_inert', type: 'float', min: 0, max: 1, default: 0.5 },
    }
    installFakeViewer(DEFAULT_GLOBALS, specs, (v) => v.u_amount)
    const pipeline = (globalThis as any).window[DEFAULT_GLOBALS.renderingPipeline]
    pipeline.setUniform('u_amount', 0.9)
    pipeline.globalUniforms = { u_amount: 0.9, u_inert: 0.5 }
    const result = await testUniformResponsiveness(makeSession(), 'synth/noise')
    expect(result.uniforms.find((u: any) => u.name === 'amount')).toMatchObject({ default_value: 0.9, responds: true })
    expect(result.uniforms.find((u: any) => u.name === 'inert').responds).toBe(false)
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
