import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { BrowserSession, effectSelectionProblem } from '../../harness/browser-session.js'
import type { EffectSelectionResult } from '../../harness/types.js'
import { getConfig } from '../../config.js'
import { resolveEffectIds } from '../resolve-effects.js'
import { toolResult } from '../tool-result.js'

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

export const testUniformResponsivenessSchema = {
  effect_id: z.string().optional().describe('One effect ID, such as "synth/noise"'),
  effects: z.string().optional().describe('Comma-separated effect IDs'),
  backend: z.enum(['webgl2', 'webgpu']).default('webgl2').describe('Rendering backend'),
}

export const UNIFORM_RESPONSE_THRESHOLD = 0.002

export async function testUniformResponsiveness(
  session: BrowserSession,
  effectId: string,
): Promise<any> {
  return session.runWithConsoleCapture(async () => {
    const page = session.page!

    // The switch must actually take effect: setBackend rejects when the page
    // backend never reaches the target (issue #34).
    try {
      await session.setBackend(session.backend)
    } catch (err) {
      // Bind even this failure to what the page actually holds (issue #34).
      const failed = await session.readPageIdentity()
      return {
        status: 'error',
        tested_uniforms: [],
        uniforms: [],
        backend: failed.backend ?? 'unknown',
        details: `Backend switch failed: ${errorMessage(err)}`,
        ...(failed.effectId ? { effect_id: failed.effectId } : {}),
      }
    }

    // Select and wait until the page finished building THIS effect (issue
    // #34) — status text is not a readiness signal.
    const selection: EffectSelectionResult = await session.selectEffect(effectId)
    const problem = effectSelectionProblem(selection, effectId, session.backend)
    if (problem) {
      return {
        status: 'error',
        tested_uniforms: [],
        uniforms: [],
        backend: selection.backend,
        details: problem,
        ...(selection.effectId ? { effect_id: selection.effectId } : {}),
      }
    }

    // Pause animation for deterministic testing
    await page.evaluate((globals) => {
      const w = window as any
      if (w[globals.setPaused]) w[globals.setPaused](true)
      if (w[globals.setPausedTime]) w[globals.setPausedTime](0)
    }, session.globals)

    const result = await page.evaluate(async (globals) => {
      const w = window as any
      const pipeline = w[globals.renderingPipeline]
      const effect = w[globals.currentEffect]
      if (!pipeline || !effect?.instance?.globals) {
        return { status: 'error', tested_uniforms: [], details: 'No effect loaded' }
      }

      const renderer = w[globals.canvasRenderer]
      const backend = pipeline.backend
      const backendName = backend?.getName?.() || 'unknown'

      // Read the rendered frame through the backend. WebGL2 reads the default
      // framebuffer synchronously; a backend without a GL context (WebGPU)
      // reads the offscreen render surface through its async texture reader —
      // the same surface and candidate fallback the parity capture uses.
      async function readFrame(): Promise<{ pixels: Uint8Array; width: number; height: number } | null> {
        const gl = backend?.gl
        if (gl) {
          const canvas = renderer.canvas
          const width = canvas.width, height = canvas.height
          const pixels = new Uint8Array(width * height * 4)
          gl.bindFramebuffer(gl.FRAMEBUFFER, null)
          gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels)
          return { pixels, width, height }
        }
        if (backend?.readPixels && backend?.textures) {
          // A read issued right after a draw can return the previous frame;
          // drain the submitted work first (same as runDslProgram).
          await backend.device?.queue?.onSubmittedWorkDone?.()
          const surf = pipeline.graph?.renderSurface
          if (!surf) return null
          // Prefer the half of the surface's ping-pong pair the last frame
          // presented (frameReadTextures); a fixed global_<surface>_read
          // guess can pick the stale half after the swap.
          const candidates: string[] = []
          const frameRead = pipeline.frameReadTextures?.get?.(surf)
          if (frameRead) candidates.push(frameRead)
          candidates.push('global_' + surf + '_read')
          try {
            const nodes: string[] = []
            for (const k of backend.textures.keys()) if (/node_\d+_out/.test(k)) nodes.push(k)
            nodes.sort((a: string, c: string) => parseInt(a.match(/node_(\d+)/)![1], 10) - parseInt(c.match(/node_(\d+)/)![1], 10))
            if (nodes.length) candidates.push(nodes[nodes.length - 1])
          } catch (e) { /* textures map not iterable */ }
          for (const id of candidates) {
            try {
              const px = await backend.readPixels(id)
              if (px && px.width && px.height && px.data) {
                const raw = px.data instanceof Float32Array
                  ? Uint8Array.from(px.data, (v: number) => Math.round(Math.max(0, Math.min(1, v)) * 255))
                  : new Uint8Array(px.data)
                return { pixels: raw, width: px.width, height: px.height }
              }
            } catch (e) { /* try next candidate */ }
          }
          return null
        }
        return null
      }

      // Two capture times: speed-like controls change nothing at t=0, so a
      // uniform counts as responsive when it moves the output at either time.
      const CAPTURE_TIMES = [0, 0.37]

      async function captureMetrics(time: number) {
        if (!renderer) return null
        renderer.render(time)
        const read = await readFrame()
        if (!read) return null
        const { pixels, width, height } = read
        const count = width * height
        let sumR = 0, sumG = 0, sumB = 0, sumA = 0
        for (let i = 0; i < pixels.length; i += 4) {
          sumR += pixels[i] / 255; sumG += pixels[i + 1] / 255; sumB += pixels[i + 2] / 255; sumA += pixels[i + 3] / 255
        }
        // A strided sample of the pixels themselves: blur, scale, rotation and
        // offset controls move pixels without changing the frame's mean color,
        // so the comparison must also be per pixel. Alpha is included: a
        // background-alpha control changes nothing else.
        const stride = Math.max(1, Math.floor(count / 4096))
        const samples: number[] = []
        for (let p = 0; p < count; p += stride) {
          const i = p * 4
          samples.push(pixels[i] / 255, pixels[i + 1] / 255, pixels[i + 2] / 255, pixels[i + 3] / 255)
        }
        return { mean: [sumR / count, sumG / count, sumB / count, sumA / count], samples }
      }

      async function captureAll() {
        const out: Array<{ mean: number[]; samples: number[] }> = []
        for (const t of CAPTURE_TIMES) {
          const m = await captureMetrics(t)
          if (!m) return null
          out.push(m)
        }
        return out
      }

      const effectGlobals = effect.instance.globals
      const setValue = (uniformName: string, value: unknown) => {
        if (pipeline.setUniform) pipeline.setUniform(uniformName, value)
        else if (pipeline.globalUniforms) pipeline.globalUniforms[uniformName] = value
      }
      const defaultOf = (spec: any) => spec.default ?? spec.min
      // The values the loaded program set (a defaultProgram can pass
      // sharpen(amount: 5)): the baseline is captured at these, so every
      // control is restored to them, not to its spec default.
      const initial: Record<string, unknown> = {}
      for (const [param, spec] of Object.entries(effectGlobals) as any[]) {
        const current = spec.uniform ? pipeline.globalUniforms?.[spec.uniform] : undefined
        initial[param] = typeof current === 'number' || Array.isArray(current) ? current : defaultOf(spec)
      }
      const startOf = (param: string) => initial[param]
      // Values compare as the noisemaker UI compares them: vectors per
      // component, numbers within 1e-4.
      const same = (a: any, b: any): boolean => {
        if (a === b) return true
        if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((v: number, i: number) => Math.abs(v - b[i]) < 1e-4)
        return typeof a === 'number' && typeof b === 'number' && Math.abs(a - b) < 1e-4
      }
      // A parameter value as its uniform takes it: member enums are stored as
      // paths ("oscType.noise1d") and set as their numbers.
      const toUniform = (spec: any, value: unknown) =>
        typeof value === 'string' && typeof renderer?.convertParameterForUniform === 'function'
          ? renderer.convertParameterForUniform(value, spec)
          : value

      // enabledBy: the control only acts when this condition holds (the same
      // shape the noisemaker UI evaluates). Find runtime values for the
      // condition's params that satisfy it; null when it cannot be satisfied
      // at run time (a compile-time define, an unknown param, a `not`).
      function satisfy(cond: any, assign: Record<string, unknown>): boolean {
        if (cond == null) return true
        if (typeof cond === 'string') return satisfy({ param: cond }, assign)
        if (Array.isArray(cond.and)) return cond.and.every((c: any) => satisfy(c, assign))
        if (Array.isArray(cond.or)) return cond.or.some((c: any) => {
          const trial = { ...assign }
          if (!satisfy(c, trial)) return false
          Object.assign(assign, trial)
          return true
        })
        if (cond.not !== undefined) return false
        const gate = effectGlobals[cond.param]
        if (!gate || !gate.uniform) return false
        const choices = gate.choices ? Object.values(gate.choices).filter((v: any) => typeof v === 'number') as number[] : null
        const lo = typeof gate.min === 'number' ? gate.min : (choices ? Math.min(...choices) : 0)
        const hi = typeof gate.max === 'number' ? gate.max : (choices ? Math.max(...choices) : 1)
        const step = gate.type === 'int' || choices ? 1 : (hi - lo) / 100
        // A threshold gate opens halfway into its open range first: just past
        // the threshold (glitchiness 1 of 100) the gated control often moves
        // the output too little to measure.
        const halfway = (from: number, to: number) => (gate.type === 'int' ? Math.round((from + to) / 2) : (from + to) / 2)
        const candidates: unknown[] = []
        if (cond.eq !== undefined) candidates.push(cond.eq)
        if (Array.isArray(cond.in)) candidates.push(...cond.in)
        if (choices && [cond.gt, cond.gte, cond.lt, cond.lte].some((v) => v !== undefined)) candidates.push(...choices)
        if (cond.gt !== undefined) candidates.push(halfway(cond.gt, hi), cond.gt + step)
        if (cond.gte !== undefined) candidates.push(halfway(cond.gte, hi), cond.gte)
        if (cond.lt !== undefined) candidates.push(halfway(cond.lt, lo), cond.lt - step)
        if (cond.lte !== undefined) candidates.push(halfway(cond.lte, lo), cond.lte)
        if (cond.neq !== undefined || Array.isArray(cond.notIn)) {
          const banned = [...(cond.neq !== undefined ? [cond.neq] : []), ...(cond.notIn || [])]
          const base = startOf(cond.param)
          // A vector gate (a tint that must differ from neutral) opens with
          // each component moved a quarter of the range toward the far end.
          const options = Array.isArray(base)
            ? [base.map((c: number) => c + (c <= (lo + hi) / 2 ? 1 : -1) * (hi - lo) / 4)]
            : (choices ?? [base, lo, hi])
          for (const v of options) if (!banned.some((b) => same(v, b))) { candidates.push(v); break }
        }
        if (candidates.length === 0) candidates.push(gate.type === 'boolean' ? true : hi)
        const holds = (v: any) =>
          (cond.eq === undefined || same(v, cond.eq)) && (cond.neq === undefined || !same(v, cond.neq)) &&
          (cond.gt === undefined || v > cond.gt) && (cond.gte === undefined || v >= cond.gte) &&
          (cond.lt === undefined || v < cond.lt) && (cond.lte === undefined || v <= cond.lte) &&
          (!Array.isArray(cond.in) || cond.in.some((c: any) => same(v, c))) &&
          (!Array.isArray(cond.notIn) || !cond.notIn.some((c: any) => same(v, c))) &&
          (Object.keys(cond).some((k) => k !== 'param') || Boolean(v))
        const value = candidates.find(holds)
        if (value === undefined) return false
        assign[cond.param] = value
        return true
      }

      const tested: string[] = []
      const uniforms: Array<Record<string, any>> = []
      const failedNames: string[] = []
      const errorNames: string[] = []
      const gatedNames: string[] = []

      const baseline = await captureAll()
      if (!baseline) return { status: 'error', tested_uniforms: [], backend: backendName, details: `Failed to capture baseline on ${backendName}` }

      // A changed param can restart an async CPU overlay (fibers, scratches);
      // wait for it before capturing, as the effect switch does.
      const settle = async () => {
        if (typeof pipeline.whenAsyncInitsSettled === 'function') await pipeline.whenAsyncInitsSettled()
      }
      const measurable = (spec: any) =>
        spec.uniform && spec.define === undefined && spec.type !== 'boolean' && spec.type !== 'button' &&
        typeof spec.min === 'number' && typeof spec.max === 'number' && spec.min !== spec.max
      const round = (spec: any, v: number) => (spec.type === 'int' ? Math.round(v) : v)
      // Two test values, never the default: the farther of the 25% and 75%
      // points, then a point at 38.2% of the range, which does not line up
      // with the right angles and halves a symmetric input is invariant to.
      const testValuesOf = (param: string, spec: any) => {
        const defaultVal = startOf(param) as number
        const range = spec.max - spec.min
        const quarter = round(spec, spec.min + range * 0.25), threeQuarter = round(spec, spec.min + range * 0.75)
        const far = Math.abs(threeQuarter - defaultVal) > Math.abs(quarter - defaultVal) ? threeQuarter : quarter
        const values = [far, round(spec, spec.min + range * 0.381966)]
          .filter((v, i, all) => v !== defaultVal && all.indexOf(v) === i)
        return values.length > 0 ? values : [far]
      }

      type Capture = Array<{ mean: number[]; samples: number[] }>
      const compare = (reference: Capture, test: Capture) => {
        let luma = 0, channel = 0, pixel = 0
        for (let i = 0; i < CAPTURE_TIMES.length; i++) {
          const a = reference[i].mean, b = test[i].mean
          luma = Math.max(luma, Math.abs((b[0] + b[1] + b[2]) / 3 - (a[0] + a[1] + a[2]) / 3))
          channel = Math.max(channel, Math.abs(b[0] - a[0]), Math.abs(b[1] - a[1]), Math.abs(b[2] - a[2]), Math.abs(b[3] - a[3]))
          const sa = reference[i].samples, sb = test[i].samples
          if (sa.length === sb.length && sa.length > 0) {
            let sum = 0
            for (let k = 0; k < sa.length; k++) sum += Math.abs(sb[k] - sa[k])
            pixel = Math.max(pixel, sum / sa.length)
          }
        }
        return { luma, channel, pixel }
      }
      // This function is serialized into the page: the threshold must stay a
      // literal, kept in sync with UNIFORM_RESPONSE_THRESHOLD.
      const responds = (d: { luma: number; channel: number; pixel: number }) => d.luma > 0.002 || d.channel > 0.002 || d.pixel > 0.002

      // Set the given params, capture a reference, then try the control's
      // test values against it. Returns the strongest response.
      async function measure(spec: any, setup: Record<string, unknown>, testValues: number[]) {
        for (const [param, value] of Object.entries(setup)) setValue(effectGlobals[param].uniform, toUniform(effectGlobals[param], value))
        await settle()
        const reference = Object.keys(setup).length > 0 ? await captureAll() : baseline
        let best: { luma: number; channel: number; pixel: number } | null = null
        let bestValue = testValues[0]
        for (const value of testValues) {
          setValue(spec.uniform, value)
          await settle()
          const test = reference ? await captureAll() : null
          if (!test || !reference) return null
          const d = compare(reference, test)
          if (!best || d.pixel + d.channel > best.pixel + best.channel) { best = d; bestValue = value }
          if (responds(d)) break
        }
        return best ? { ...best, value: bestValue } : null
      }
      async function restore(names: string[]) {
        for (const param of names) setValue(effectGlobals[param].uniform, toUniform(effectGlobals[param], startOf(param)))
        await settle()
      }

      for (const [name, spec] of Object.entries(effectGlobals) as any[]) {
        if (!spec.uniform) continue
        if (spec.type === 'boolean' || spec.type === 'button') continue
        if (typeof spec.min !== 'number' || typeof spec.max !== 'number' || spec.min === spec.max) continue

        const defaultVal = startOf(name)
        const testValues = testValuesOf(name, spec)

        // A compile-time define changes only on recompile, never through
        // setUniform; report it rather than measure it.
        if (spec.define !== undefined) {
          gatedNames.push(name)
          tested.push(`${name}:gated`)
          uniforms.push({ name, uniform: spec.uniform, default_value: defaultVal, test_value: testValues[0],
            luma_diff: null, max_channel_diff: null, responds: null, gated: true, define: spec.define })
          continue
        }

        // Enable a gated control first; a gate that cannot be opened at run
        // time leaves the control untestable here, reported as gated.
        const gate = spec.ui?.enabledBy
        const assign: Record<string, unknown> = {}
        if (gate !== undefined && !satisfy(gate, assign)) {
          gatedNames.push(name)
          tested.push(`${name}:gated`)
          uniforms.push({ name, uniform: spec.uniform, default_value: defaultVal, test_value: testValues[0],
            luma_diff: null, max_channel_diff: null, responds: null, gated: true, enabled_by: gate })
          continue
        }

        let measured: Awaited<ReturnType<typeof measure>> = null
        let context: Record<string, unknown> | null = null
        let measureError: string | null = null
        try {
          measured = await measure(spec, assign, testValues)
          await restore([name, ...Object.keys(assign)])
          // A control can act only in combination with others (a range that
          // selects what an adjustment changes, a transform of a feedback
          // that is mixed out at defaults). Try once more with every other
          // control at its first test value (gated ones with their gates
          // opened), the control's own gate on top.
          if (measured && !responds(measured)) {
            const varied: Record<string, unknown> = {}
            for (const [other, otherSpec] of Object.entries(effectGlobals) as any[]) {
              if (other === name || !measurable(otherSpec)) continue
              // A gated other (an adjustment behind an enable toggle) joins
              // the context with its gate opened, when the gate can be.
              if (otherSpec.ui?.enabledBy !== undefined) {
                const trial = { ...varied }
                if (!satisfy(otherSpec.ui.enabledBy, trial)) continue
                Object.assign(varied, trial)
              }
              if (!(other in varied)) varied[other] = testValuesOf(other, otherSpec)[0]
            }
            Object.assign(varied, assign)
            if (Object.keys(varied).length > Object.keys(assign).length) {
              const retry = await measure(spec, varied, testValues)
              await restore([name, ...Object.keys(varied)])
              if (retry && responds(retry)) { measured = retry; context = varied }
            }
          }
        } catch (err) {
          measureError = err instanceof Error ? err.message : String(err)
          measured = null
          await restore([name, ...Object.keys(assign)])
        }

        if (measured) {
          const ok = responds(measured)
          uniforms.push({
            name,
            uniform: spec.uniform,
            default_value: defaultVal,
            test_value: measured.value,
            luma_diff: measured.luma,
            max_channel_diff: measured.channel,
            pixel_diff: measured.pixel,
            responds: ok,
            ...(Object.keys(assign).length > 0 ? { enabled_with: assign } : {}),
            ...(context ? { context } : {}),
          })
          if (ok) {
            tested.push(`${name}:pass`)
          } else {
            failedNames.push(name)
            tested.push(`${name}:fail`)
          }
        } else {
          errorNames.push(name)
          tested.push(`${name}:error`)
          uniforms.push({
            name,
            uniform: spec.uniform,
            default_value: defaultVal,
            test_value: testValues[0],
            luma_diff: null,
            max_channel_diff: null,
            responds: false,
            error: measureError ?? 'Failed to capture test render',
          })
        }
      }

      let status: string
      let details: string
      const measured = tested.length - gatedNames.length
      if (measured === 0) {
        status = 'skipped'
        details = gatedNames.length > 0
          ? `No testable uniforms; gated: ${gatedNames.join(', ')}`
          : 'No testable uniforms'
      } else {
        const problems: string[] = []
        if (errorNames.length > 0) problems.push(`could not be measured: ${errorNames.join(', ')}`)
        if (failedNames.length > 0) problems.push(`did not affect output: ${failedNames.join(', ')}`)
        if (problems.length > 0) {
          // A uniform that was measured and did not move the output is a
          // negative verdict (fail); one that could not be measured leaves
          // the check without a verdict (error).
          status = errorNames.length > 0 ? 'error' : 'fail'
          details = `Uniforms ${problems.join('; ')}`
        } else {
          status = 'ok'
          details = 'Uniforms affect output'
        }
        if (gatedNames.length > 0) details += `; gated (not testable at run time): ${gatedNames.join(', ')}`
      }

      return {
        status,
        tested_uniforms: tested,
        uniforms,
        threshold: 0.002,
        details,
      }
    }, session.globals)

    // Resume animation
    await page.evaluate((globals) => {
      const w = window as any
      if (w[globals.setPaused]) w[globals.setPaused](false)
    }, session.globals)

    // Report the page-confirmed identity (issue #34): the backend the page
    // actually rendered on, and the effect id the page confirms.
    return {
      ...result,
      backend: selection.backend,
      ...(selection.effectId ? { effect_id: selection.effectId } : {}),
    }
  })
}

export function registerTestUniformResponsiveness(server: McpServer): void {
  server.tool(
    'testUniformResponsiveness',
    'For each uniform:\n1. Open its ui.enabledBy gate, if any, by setting the gate params.\n2. Render a baseline at t=0 and t=0.37.\n' +
        '3. Change the uniform value.\n4. Compare the output at both times.\n' +
        'A uniform responds when it moves the output at either time. A uniform whose gate cannot be opened at run time ' +
        '(a compile-time define, a not condition) is reported as gated and not measured. ' +
        'Status is ok only when at least one uniform was measured and every measured uniform affected output; ' +
        'fail when a measured uniform did not affect output, error when any tested uniform could not be measured (details names them); ' +
        'skipped when nothing was measurable. Each measured uniform is reported with its test value, luma and ' +
        'max channel deltas against the 0.002 threshold, and enabled_with when a gate was opened.',
    testUniformResponsivenessSchema,
    async (args: any) => {
      const config = getConfig()
      const effectIds = resolveEffectIds(args, config.effectsDir)
      const session = new BrowserSession({ backend: args.backend })
      try {
        await session.setup()
        const results = []
        for (const id of effectIds) {
          try {
            results.push({ effect_id: id, ...await testUniformResponsiveness(session, id) })
          } catch (err) {
            results.push({ effect_id: id, status: 'error', error: err instanceof Error ? err.message : String(err) })
          }
        }
        return toolResult(results.length === 1 ? results[0] : results)
      } finally {
        await session.teardown()
      }
    }
  )
}
