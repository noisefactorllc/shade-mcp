import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { BrowserSession } from '../harness/browser-session.js'
import { DEFAULT_GLOBALS, type ViewerGlobals } from '../harness/types.js'
import { testUniformResponsiveness, UNIFORM_RESPONSE_THRESHOLD } from '../tools/browser/uniforms.js'
import { toolResult } from '../tools/tool-result.js'
import { resetBrowserQueue } from '../harness/browser-queue.js'
import { getRefCount, releaseServer } from '../harness/server-manager.js'

// Runs the in-page uniform probe for real inside Node against a fake viewer
// whose read-back pixels depend only on the `amount` uniform: the same
// fake-viewer pattern as timed-render.test.ts. The shader effect under test
// has three numeric uniforms — `amount` (the pixels follow it), `unused`
// (ignored by the shader) and `boom` (renders explode while it is off its
// default) — so the aggregation and the reported measurements can be asserted
// without a browser.

const UNIFORM_SPECS: Record<string, any> = {
  amount: { uniform: 'u_amount', type: 'float', min: 0, max: 1, default: 0.5 },
  unused: { uniform: 'u_unused', type: 'float', min: 0, max: 1, default: 0.5 },
  boom: { uniform: 'u_boom', type: 'float', min: 0, max: 1, default: 0.5 },
}

// selfChanging models an output that changes on its own between renders (a
// simulation or feedback effect stepping on every render): a per-pixel ripple
// that moves one pixel per frame. The frame mean stays the same, so only the
// per-pixel comparison sees the change.
function installFakeViewer(globals: ViewerGlobals, specs: Record<string, any>, options: { selfChanging?: boolean } = {}): void {
  const w: any = {}
  let frame = 0
  const values: Record<string, number> = {}
  for (const spec of Object.values(specs) as any[]) {
    values[spec.uniform] = spec.default ?? spec.min
  }
  w.__values = values
  w[globals.renderingPipeline] = {
    backend: {
      gl: {
        bindFramebuffer: () => {},
        readPixels: (_x: number, _y: number, _wd: number, _ht: number, _f: number, _t: number, out: Uint8Array) => {
          // The fake shader reads only u_amount; every other uniform is a no-op.
          const v = w.__values.u_amount
          for (let i = 0; i < out.length; i += 4) {
            const ripple = ((i / 4 + frame) % 4) / 4 * 0.1
            const c = Math.round((options.selfChanging ? v * 0.6 + ripple : v) * 255)
            out[i] = c; out[i + 1] = c; out[i + 2] = c; out[i + 3] = 255
          }
        },
      },
      getName: () => 'webgl2',
    },
    // Viewer contract for a bound selection (issue #34): a built graph and
    // the id of the effect the viewer is showing.
    isCompiling: false,
    graph: { passes: [{ name: 'main' }], renderSurface: 'frame' },
    setUniform: (name: string, val: number) => {
      w.__values[name] = val
    },
  }
  w[globals.currentEffect] = { namespace: 'synth', name: 'noise', instance: { globals: specs } }
  w[globals.pipelineGeneration!] = 0
  w[globals.canvasRenderer] = {
    canvas: { width: 2, height: 2 },
    render: () => {
      frame++
      if ('u_boom' in w.__values && w.__values.u_boom !== 0.5) throw new Error('render exploded')
    },
  }
  ;(globalThis as any).window = w
  ;(globalThis as any).document = {
    // The modeled viewer rebuilds on selection: each change event swaps the
    // graph object and bumps the compile generation (issue #34 contract).
    getElementById: (id: string) => id === 'effect-select'
      ? {
          value: 'synth/noise',
          dispatchEvent: (ev: Event) => {
            if (ev.type !== 'change') return
            const pipeline = w[globals.renderingPipeline] as any
            if (pipeline?.graph) pipeline.graph = { ...pipeline.graph }
            w[globals.pipelineGeneration!] = (w[globals.pipelineGeneration!] || 0) + 1
          },
        }
      : null,
    createElement: () => ({ width: 0, height: 0, getContext: () => null }),
  }
}

function makeSession(timeoutMs = 500): BrowserSession {
  const session = new BrowserSession({ backend: 'webgl2', timeoutMs, globals: DEFAULT_GLOBALS })
  session.page = {
    setViewportSize: async () => {},
    waitForFunction: async () => {},
    evaluate: async (fn: (arg: any) => any, arg: any) => fn(arg),
  } as any
  session.setBackend = async () => {}
  return session
}

describe('testUniformResponsiveness result contract', () => {
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

  it('reports non-ok and names the unresponsive uniform when one uniform is ignored', async () => {
    // Only amount and unused: the aggregation case must fail on the status
    // contract alone, not on a measurement error (boom is covered below).
    installFakeViewer(DEFAULT_GLOBALS, {
      amount: UNIFORM_SPECS.amount,
      unused: UNIFORM_SPECS.unused,
    })
    const session = makeSession()
    const result = await testUniformResponsiveness(session, 'synth/noise')

    expect(result.status).not.toBe('ok')
    expect(result.status).toBe('fail')
    expect(result.details).toContain('unused')
    // A dead control is a negative verdict: the common outcome is fail, and
    // the call itself succeeded, so it is not an MCP isError.
    expect(JSON.parse(toolResult(result).content[0].text).outcome).toBe('fail')
    expect(toolResult(result).isError).toBeUndefined()
    // The measured deltas and the threshold are reported, not just pass/fail.
    expect(result.threshold).toBe(0.002)
    expect(result.threshold).toBe(UNIFORM_RESPONSE_THRESHOLD)
    const entries: any[] = result.uniforms
    const byName = Object.fromEntries(entries.map((e) => [e.name, e]))
    expect(byName.amount.responds).toBe(true)
    expect(byName.unused.responds).toBe(false)
    for (const name of ['amount', 'unused']) {
      expect(byName[name].uniform).toBe(UNIFORM_SPECS[name].uniform)
      expect(byName[name].default_value).toBe(0.5)
      expect(typeof byName[name].test_value).toBe('number')
      expect(typeof byName[name].luma_diff).toBe('number')
      expect(typeof byName[name].max_channel_diff).toBe('number')
    }
    // The ignored uniform moved the output by exactly zero.
    expect(byName.unused.luma_diff).toBe(0)
    expect(byName.unused.max_channel_diff).toBe(0)
    // The responsive uniform actually moved it.
    expect(byName.amount.luma_diff).toBeGreaterThan(0.002)
    // Legacy per-uniform strings stay for compatibility.
    expect(result.tested_uniforms).toEqual(expect.arrayContaining(['amount:pass', 'unused:fail']))
  })

  it('reports ok when every tested uniform affects output', async () => {
    installFakeViewer(DEFAULT_GLOBALS, { amount: UNIFORM_SPECS.amount })
    const session = makeSession()
    const result = await testUniformResponsiveness(session, 'synth/noise')

    expect(result.status).toBe('ok')
    expect(toolResult(result).isError).toBeUndefined()
    expect(result.uniforms).toHaveLength(1)
    expect(result.uniforms[0]).toMatchObject({
      name: 'amount',
      uniform: 'u_amount',
      default_value: 0.5,
      responds: true,
    })
    expect(typeof result.uniforms[0].test_value).toBe('number')
    expect(typeof result.uniforms[0].luma_diff).toBe('number')
    expect(typeof result.uniforms[0].max_channel_diff).toBe('number')
    expect(result.threshold).toBe(0.002)
  })

  it('reports non-ok when a uniform cannot be measured', async () => {
    installFakeViewer(DEFAULT_GLOBALS, UNIFORM_SPECS)
    const session = makeSession()
    const result = await testUniformResponsiveness(session, 'synth/noise')

    const boom = result.uniforms.find((e: any) => e.name === 'boom')
    expect(boom).toBeDefined()
    expect(boom.responds).toBe(false)
    expect(boom.error).toMatch(/render exploded/)
    expect(result.tested_uniforms).toContain('boom:error')
    expect(result.status).not.toBe('ok')
    expect(result.status).toBe('error')
    expect(result.details).toContain('boom')
  })

  it('reports skipped, and lists the controls, when nothing is testable', async () => {
    installFakeViewer(DEFAULT_GLOBALS, {
      fixed: { uniform: 'u_fixed', type: 'float', min: 1, max: 1, default: 1 },
      kind: { uniform: 'u_kind', type: 'member', enum: 'kind', default: 'kind.a' },
    })
    const session = makeSession()
    const result = await testUniformResponsiveness(session, 'synth/noise')

    expect(result.status).toBe('skipped')
    expect(result.details).toBe('No uniform could be measured; untested: fixed, kind')
    expect(result.tested_uniforms).toEqual(['fixed:untested', 'kind:untested'])
  })

  it('reports non-ok when the output changes on its own and one control gets no verdict', async () => {
    // A self-changing output with one live and one dead control: the live
    // control moves the output far beyond the output's own change (pass), and
    // the dead one cannot be told apart from that change (unstable, no
    // verdict). A control without a verdict must not leave the status ok.
    installFakeViewer(DEFAULT_GLOBALS, {
      amount: UNIFORM_SPECS.amount,
      unused: UNIFORM_SPECS.unused,
    }, { selfChanging: true })
    const session = makeSession()
    const result = await testUniformResponsiveness(session, 'synth/noise')

    expect(result.tested_uniforms).toEqual(['amount:pass', 'unused:unstable'])
    expect(result.status).not.toBe('ok')
    expect(result.status).toBe('error')
    expect(result.details).toContain('unused')
    expect(result.details).not.toMatch(/^Uniforms affect output/)
    const envelope = toolResult(result)
    expect(JSON.parse(envelope.content[0].text).outcome).toBe('error')
    expect(envelope.isError).toBe(true)
    // The measured deltas stay in the result for every tested control,
    // including the one without a verdict, beside the threshold.
    expect(result.threshold).toBe(UNIFORM_RESPONSE_THRESHOLD)
    const byName = Object.fromEntries((result.uniforms as any[]).map((e) => [e.name, e]))
    expect(byName.amount.responds).toBe(true)
    expect(byName.unused.responds).toBe(null)
    expect(byName.unused.unstable).toBe(true)
    for (const name of ['amount', 'unused']) {
      expect(typeof byName[name].test_value).toBe('number')
      expect(typeof byName[name].luma_diff).toBe('number')
      expect(typeof byName[name].max_channel_diff).toBe('number')
      expect(typeof byName[name].pixel_diff).toBe('number')
    }
    // The live control moved the frame mean; the dead one did not, and the
    // output's own change between renders is reported beside it.
    expect(byName.amount.luma_diff).toBeGreaterThan(0.1)
    expect(byName.unused.luma_diff).toBe(0)
    expect(byName.unused.noise.pixel).toBeGreaterThan(UNIFORM_RESPONSE_THRESHOLD)
  })
})