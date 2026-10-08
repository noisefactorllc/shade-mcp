import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { BrowserSession, effectSelectionProblem, requestIdentity } from '../../harness/browser-session.js'
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
// Share of all pixels changed by more than 16/255 above which a control responds.
export const UNIFORM_STRONG_FRACTION_THRESHOLD = 0.0005

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
        ...requestIdentity(effectId, failed.effectId),
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
        ...requestIdentity(effectId, selection.effectId),
      }
    }

    // Pause animation for deterministic testing
    await page.evaluate((globals) => {
      const w = window as any
      if (w[globals.setPaused]) w[globals.setPaused](true)
      if (w[globals.setPausedTime]) w[globals.setPausedTime](0)
    }, session.globals)

    const result = await page.evaluate(async ({ globals, settleMs }) => {
      const w = window as any
      const pipeline = w[globals.renderingPipeline]
      const effect = w[globals.currentEffect]
      if (!pipeline || !effect?.instance?.globals) {
        return { status: 'error', tested_uniforms: [], details: 'No effect loaded' }
      }

      const renderer = w[globals.canvasRenderer]
      const backend = pipeline.backend
      const backendName = backend?.getName?.() || 'unknown'

      // Read the rendered frame from the offscreen render surface through the
      // backend's texture reader, on both backends, as the capture verbs do:
      // the presented canvas can be smaller than the render size (a 179x179
      // viewer canvas), and downscaling blends small changes away. A backend
      // without a texture reader falls back to the WebGL2 default framebuffer.
      async function readFrame(): Promise<{ pixels: Uint8Array; width: number; height: number } | null> {
        const surfaceFrame = await readSurface()
        if (surfaceFrame) return surfaceFrame
        const gl = backend?.gl
        if (gl) {
          const canvas = renderer.canvas
          const width = canvas.width, height = canvas.height
          const pixels = new Uint8Array(width * height * 4)
          gl.bindFramebuffer(gl.FRAMEBUFFER, null)
          gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels)
          return { pixels, width, height }
        }
        return null
      }

      async function readSurface(): Promise<{ pixels: Uint8Array; width: number; height: number } | null> {
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
        // A 64x64 grid at cell centers: a flat stride of count/4096 lands on
        // the same few columns of a power-of-two frame (x = 0, 256, 512, 768
        // at 1024x1024) and can miss a periodic pattern.
        const nx = Math.min(64, width), ny = Math.min(64, height)
        const samples: number[] = []
        for (let g = 0; g < nx * ny; g++) {
          const p = Math.floor((Math.floor(g / nx) + 0.5) * height / ny) * width + Math.floor((g % nx + 0.5) * width / nx)
          const i = p * 4
          samples.push(pixels[i] / 255, pixels[i + 1] / 255, pixels[i + 2] / 255, pixels[i + 3] / 255)
        }
        return { mean: [sumR / count, sumG / count, sumB / count, sumA / count], samples, pixels: new Uint8Array(pixels) }
      }

      async function captureAll() {
        const out: Array<{ mean: number[]; samples: number[]; pixels: Uint8Array }> = []
        for (const t of CAPTURE_TIMES) {
          const m = await captureMetrics(t)
          if (!m) return null
          out.push(m)
        }
        return out
      }

      const effectGlobals = effect.instance.globals
      const passes: any[] = pipeline.graph?.passes || []
      const effectFunc = effect.instance?.func ?? effect.name
      const ownPass = (pass: any) =>
        pass.effectFunc === effectFunc && (pass.effectNamespace == null || pass.effectNamespace === effect.namespace)
      // Uniform values go through the renderer's conversion where the UI's
      // parameter paths convert them: a member enum path becomes its number,
      // a boolean stays a boolean.
      const toUniform = (spec: any, value: unknown) =>
        (typeof value === 'string' || typeof value === 'boolean') && typeof renderer?.convertParameterForUniform === 'function'
          ? renderer.convertParameterForUniform(value, spec)
          : value
      const setValue = (spec: any, value: unknown) => {
        const converted = toUniform(spec, value)
        if (pipeline.setUniform) pipeline.setUniform(spec.uniform, converted)
        else if (pipeline.globalUniforms) pipeline.globalUniforms[spec.uniform] = converted
      }
      const defaultOf = (spec: any) => spec.default ?? spec.min
      // Values compare as the noisemaker UI compares them: vectors per
      // component, numbers within 1e-4.
      const same = (a: any, b: any): boolean => {
        if (a === b) return true
        if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((v: number, i: number) => Math.abs(v - b[i]) < 1e-4)
        return typeof a === 'number' && typeof b === 'number' && Math.abs(a - b) < 1e-4
      }
      // The values the loaded program set (a defaultProgram can pass
      // sharpen(amount: 5)). The viewer writes program values into the
      // passes' uniforms, not the pipeline's global uniforms, so the effect's
      // own passes are read first. Every control is restored to its start.
      const isValue = (v: unknown) => typeof v === 'number' || typeof v === 'boolean' || Array.isArray(v)
      const initial: Record<string, unknown> = {}
      for (const [param, spec] of Object.entries(effectGlobals) as any[]) {
        let current: unknown
        if (spec.uniform) {
          for (const pass of [...passes.filter(ownPass), ...passes]) {
            const v = pass.uniforms?.[spec.uniform]
            if (isValue(v)) { current = v; break }
          }
          if (current === undefined && isValue(pipeline.globalUniforms?.[spec.uniform])) current = pipeline.globalUniforms[spec.uniform]
        }
        initial[param] = current !== undefined ? current : defaultOf(spec)
      }
      const startOf = (param: string) => initial[param]

      // enabledBy: the control only acts when this condition holds (the same
      // shape the noisemaker UI evaluates). Find runtime values for the
      // condition's params that satisfy it; false when it cannot be satisfied
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
        if (!gate || !gate.uniform || gate.define !== undefined) return false
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

      // A changed param can restart an async CPU overlay (fibers, scratches);
      // wait for it before capturing, as the effect switch does, but never
      // longer than the session timeout.
      let settleTimedOut = false
      const settle = async () => {
        if (typeof pipeline.whenAsyncInitsSettled !== 'function') return
        let timer: any
        const timedOut = await Promise.race([
          pipeline.whenAsyncInitsSettled().then(() => false),
          new Promise<boolean>((resolve) => { timer = setTimeout(() => resolve(true), settleMs) }),
        ])
        clearTimeout(timer)
        if (timedOut) settleTimedOut = true
      }

      const visible = (spec: any) => spec.ui?.control !== false && spec.ui?.hidden !== true
      const round = (spec: any, v: number) => (spec.type === 'int' ? Math.round(v) : v)
      // Up to two values that differ from the control's start value, or null
      // when it cannot be moved at run time:
      // - a boolean: its opposite;
      // - a vector (a tint, a light direction): each component moved a
      //   quarter of its range toward the far end;
      // - a dropdown: the first two other choices;
      // - a range: the farther of the 25% and 75% points, then the 38.2%
      //   point, which does not line up with the right angles and halves a
      //   symmetric input is invariant to.
      const testValuesOf = (param: string, spec: any): unknown[] | null => {
        const start = startOf(param)
        if (spec.type === 'boolean') return [!start]
        if (Array.isArray(start)) {
          const lo = typeof spec.min === 'number' ? spec.min : 0
          const hi = typeof spec.max === 'number' ? spec.max : 1
          return [start.map((c: number) => c + (c <= (lo + hi) / 2 ? 1 : -1) * (hi - lo) / 4)]
        }
        if (spec.choices) {
          // null entries are section headings in the dropdown.
          const others = Object.values(spec.choices)
            .filter((v) => v !== null && v !== undefined && !same(toUniform(spec, v), toUniform(spec, start)))
          return others.length > 0 ? others.slice(0, 2) : null
        }
        // A member enum lists its members in the renderer's enum registry
        // (enums.oscType.noise1d = { value: 5 }); its values are member paths.
        const members = spec.type === 'member' && spec.enum ? renderer?.enums?.[spec.enum] : null
        if (members && typeof members === 'object') {
          const others = Object.entries(members)
            .filter(([, entry]: [string, any]) => typeof entry === 'number' || typeof entry?.value === 'number')
            .map(([member]) => `${spec.enum}.${member}`)
            .filter((path) => !same(toUniform(spec, path), toUniform(spec, start)))
          return others.length > 0 ? others.slice(0, 2) : null
        }
        if (typeof spec.min !== 'number' || typeof spec.max !== 'number' || spec.min === spec.max) return null
        const startNumber = start as number
        const range = spec.max - spec.min
        const quarter = round(spec, spec.min + range * 0.25), threeQuarter = round(spec, spec.min + range * 0.75)
        const far = Math.abs(threeQuarter - startNumber) > Math.abs(quarter - startNumber) ? threeQuarter : quarter
        const values = [far, round(spec, spec.min + range * 0.381966)]
          .filter((v, i, all) => v !== startNumber && all.indexOf(v) === i)
        return values.length > 0 ? values : [far]
      }
      // Why a control with a uniform cannot be measured here, or null.
      const untestedReason = (param: string, spec: any): string | null => {
        if (spec.type === 'button') return 'a button triggers an action rather than holding a value'
        if (testValuesOf(param, spec) === null) {
          if (spec.type === 'surface') return 'a surface input, set by the program rather than a value'
          return spec.type === 'member'
            ? 'an enum whose members are not available'
            : 'no range, choices or other value to set at run time'
        }
        return null
      }
      // Another control's values for a context: its first test value, then a
      // range's extremes (a count at its maximum uses every vertex; a fractal
      // power at its minimum changes the shape). Empty when it cannot be
      // moved at run time.
      const contextValuesOf = (param: string, spec: any): unknown[] => {
        if (!spec.uniform || spec.define !== undefined || spec.type === 'button' || !visible(spec)) return []
        const first = testValuesOf(param, spec)?.[0]
        if (first === undefined) return []
        const values: unknown[] = [first]
        const isRange = !spec.choices && spec.type !== 'boolean' && !Array.isArray(startOf(param)) &&
          typeof spec.min === 'number' && typeof spec.max === 'number'
        if (isRange) {
          for (const extreme of [spec.max, spec.min]) {
            if (!same(extreme, startOf(param)) && !values.some((v) => same(v, extreme))) values.push(extreme)
          }
        }
        return values
      }
      // Retry order: controls in the same UI category, then controls whose
      // names share a prefix (zone1_count for zone1_v24, hslEnable for
      // hslHueCenter), then toggles and dropdowns, then the rest in definition
      // order. At most 24 retries per control keep an effect with hundreds of
      // controls (remap's zone vertices) bounded.
      const prefixOf = (param: string) => (param.includes('_') ? param.split('_')[0] : (param.match(/^[a-z]+/)?.[0] ?? param))
      const retryRank = (param: string, spec: any, other: string, otherSpec: any) => {
        const category = spec.ui?.category
        if (category !== undefined && otherSpec.ui?.category === category) return 0
        const prefix = prefixOf(param)
        if (prefix.length >= 3 && prefixOf(other) === prefix) return 1
        if (otherSpec.type === 'boolean' || otherSpec.choices) return 2
        return 3
      }
      const MAX_CONTEXT_RETRIES = 24

      type Delta = { luma: number; channel: number; pixel: number; strong: number }
      type Capture = Array<{ mean: number[]; samples: number[]; pixels: Uint8Array }>
      const compare = (reference: Capture, test: Capture): Delta => {
        let luma = 0, channel = 0, pixel = 0, strong = 0
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
          // A sparse overlay (a few stray hairs) falls between the samples:
          // count every pixel that changed by more than 16/255 in any channel.
          const pa = reference[i].pixels, pb = test[i].pixels
          if (pa.length === pb.length && pa.length > 0) {
            let n = 0
            for (let k = 0; k < pa.length; k += 4) {
              if (Math.abs(pb[k] - pa[k]) > 16 || Math.abs(pb[k + 1] - pa[k + 1]) > 16 ||
                  Math.abs(pb[k + 2] - pa[k + 2]) > 16 || Math.abs(pb[k + 3] - pa[k + 3]) > 16) n++
            }
            strong = Math.max(strong, n / (pa.length / 4))
          }
        }
        return { luma, channel, pixel, strong }
      }
      // This function is serialized into the page: the thresholds must stay
      // literals, kept in sync with UNIFORM_RESPONSE_THRESHOLD and
      // UNIFORM_STRONG_FRACTION_THRESHOLD.
      const responds = (d: Delta) => d.luma > 0.002 || d.channel > 0.002 || d.pixel > 0.002 || d.strong > 0.0005
      // An output that changes between renders on its own (a simulation steps
      // on every render) responds only well beyond that change.
      const respondsBeyond = (d: Delta, noise: Delta) =>
        d.luma > 2 * noise.luma + 0.002 || d.channel > 2 * noise.channel + 0.002 ||
        d.pixel > 2 * noise.pixel + 0.002 || d.strong > 2 * noise.strong + 0.0005

      // Set the given params, capture the reference twice (the second capture
      // against the first is the output's own change between renders), then
      // try the control's test values against the reference.
      async function measure(spec: any, setup: Record<string, unknown>, testValues: unknown[]) {
        for (const [param, value] of Object.entries(setup)) setValue(effectGlobals[param], value)
        await settle()
        const first = await captureAll()
        const reference = first ? await captureAll() : null
        if (!first || !reference) return null
        const noise = compare(first, reference)
        const unstable = responds(noise)
        let best: Delta | null = null
        let bestValue = testValues[0]
        let hit = false
        for (const value of testValues) {
          setValue(spec, value)
          await settle()
          const test = await captureAll()
          if (!test) return null
          const d = compare(reference, test)
          if (unstable ? respondsBeyond(d, noise) : responds(d)) { best = d; bestValue = value; hit = true; break }
          if (!best || d.pixel + d.channel > best.pixel + best.channel) { best = d; bestValue = value }
        }
        return best ? { ...best, value: bestValue, responds: hit, unstable, noise } : null
      }
      async function restore(names: string[]) {
        for (const param of names) setValue(effectGlobals[param], startOf(param))
        await settle()
      }

      // An aspect-ratio control (a lens's 1:1 aspect) does nothing on a square
      // frame: measure on a non-square render size, restored afterwards.
      const sizeBefore = { width: pipeline.width, height: pipeline.height }
      const reshape = typeof renderer?.resize === 'function' && sizeBefore.width > 0 && sizeBefore.width === sizeBefore.height
      if (reshape) {
        renderer.resize(sizeBefore.width, Math.max(1, Math.round(sizeBefore.height * 0.625)))
        await settle()
      }
      try {

      // A frame that cannot be read leaves every control unmeasurable: say so
      // once, naming the backend, instead of erroring control by control.
      if (!(await captureAll())) {
        return { status: 'error', tested_uniforms: [], uniforms: [], backend: backendName, details: `Failed to capture a frame on ${backendName}` }
      }

      const tested: string[] = []
      const uniforms: Array<Record<string, any>> = []
      const failedNames: string[] = []
      const errorNames: string[] = []
      const gatedNames: string[] = []
      const unstableNames: string[] = []
      const untestedNames: string[] = []

      for (const [name, spec] of Object.entries(effectGlobals) as any[]) {
        if (!spec.uniform) continue
        // A param the UI does not show (ui.control: false, ui.hidden) is not
        // a user control: remap's per-zone vertices, a palette's internal
        // offsets. It is neither measured nor used as a context.
        if (!visible(spec)) continue
        const defaultVal = startOf(name)

        // A compile-time define changes only on recompile, never through
        // setUniform; report it rather than measure it.
        if (spec.define !== undefined) {
          gatedNames.push(name)
          tested.push(`${name}:gated`)
          uniforms.push({ name, uniform: spec.uniform, default_value: defaultVal, test_value: null,
            luma_diff: null, max_channel_diff: null, responds: null, gated: true, define: spec.define })
          continue
        }
        const reason = untestedReason(name, spec)
        if (reason) {
          untestedNames.push(name)
          tested.push(`${name}:untested`)
          uniforms.push({ name, uniform: spec.uniform, default_value: defaultVal, test_value: null,
            luma_diff: null, max_channel_diff: null, responds: null, untested: reason })
          continue
        }
        const testValues = testValuesOf(name, spec) as unknown[]

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
          try {
            measured = await measure(spec, assign, testValues)
          } finally {
            await restore([name, ...Object.keys(assign)])
          }
          // A control can act only in combination with another (a range that
          // selects what an adjustment changes, a transform of a feedback
          // that is mixed out at defaults). Retry with one other control at a
          // time at its first test value (a gated one with its gate opened),
          // the control's own gate on top. Moving every other control at once
          // can push the content off-screen (pan and scale at their 25%
          // points), and then nothing is tested.
          if (measured && !measured.responds && !measured.unstable) {
            const others = (Object.entries(effectGlobals) as any[])
              .map(([other, otherSpec], index) => ({ other, otherSpec, index, rank: retryRank(name, spec, other, otherSpec) }))
              .filter(({ other }) => other !== name && !(other in assign))
              .sort((a, b) => a.rank - b.rank || a.index - b.index)
            let retries = 0
            let unstableRetry: Awaited<ReturnType<typeof measure>> = null
            retrying: for (const { other, otherSpec } of others) {
              for (const value of contextValuesOf(other, otherSpec)) {
                if (retries >= MAX_CONTEXT_RETRIES) break retrying
                const varied: Record<string, unknown> = {}
                if (otherSpec.ui?.enabledBy !== undefined && !satisfy(otherSpec.ui.enabledBy, varied)) continue retrying
                // When the other is gated by this control (an adjustment behind
                // an enable toggle), the toggle stays where it started in the
                // reference and its test value opens the gate.
                delete varied[name]
                varied[other] = value
                Object.assign(varied, assign)
                retries++
                let retry: Awaited<ReturnType<typeof measure>> = null
                try {
                  retry = await measure(spec, varied, testValues)
                } finally {
                  await restore([name, ...Object.keys(varied)])
                }
                if (retry?.responds) { measured = retry; context = varied; break retrying }
                if (retry?.unstable && !unstableRetry) unstableRetry = retry
              }
            }
            // A context that sets the output changing between renders (a
            // feedback mixed in) cannot show a response either way: when no
            // context made the control respond and one was unstable, the
            // control gets no verdict rather than a fail.
            if (!measured.responds && unstableRetry) measured = { ...measured, unstable: true, noise: unstableRetry.noise }
          }
        } catch (err) {
          measureError = err instanceof Error ? err.message : String(err)
          measured = null
        }

        if (measured && !measured.responds && measured.unstable) {
          // The output changes between renders by more than the thresholds on
          // its own and the control did not move it beyond that: no verdict.
          unstableNames.push(name)
          tested.push(`${name}:unstable`)
          uniforms.push({ name, uniform: spec.uniform, default_value: defaultVal, test_value: measured.value,
            luma_diff: measured.luma, max_channel_diff: measured.channel, pixel_diff: measured.pixel,
            strong_fraction: measured.strong, responds: null, unstable: true, noise: measured.noise,
            ...(Object.keys(assign).length > 0 ? { enabled_with: assign } : {}) })
        } else if (measured) {
          uniforms.push({
            name,
            uniform: spec.uniform,
            default_value: defaultVal,
            test_value: measured.value,
            luma_diff: measured.luma,
            max_channel_diff: measured.channel,
            pixel_diff: measured.pixel,
            strong_fraction: measured.strong,
            responds: measured.responds,
            ...(measured.unstable ? { unstable: true, noise: measured.noise } : {}),
            ...(Object.keys(assign).length > 0 ? { enabled_with: assign } : {}),
            ...(context ? { context } : {}),
          })
          if (measured.responds) {
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
      // Every control the check set and captured counts, including one that
      // got no verdict (unstable). Only gated and untested controls, which
      // cannot be set at run time, are left out.
      const measuredCount = tested.length - gatedNames.length - untestedNames.length
      if (measuredCount === 0) {
        status = 'skipped'
        details = 'No uniform could be measured'
      } else {
        const problems: string[] = []
        if (errorNames.length > 0) problems.push(`could not be measured: ${errorNames.join(', ')}`)
        if (unstableNames.length > 0) problems.push(`gave no verdict (the output changes between renders on its own): ${unstableNames.join(', ')}`)
        if (failedNames.length > 0) problems.push(`did not affect output: ${failedNames.join(', ')}`)
        if (problems.length > 0) {
          // A uniform that was measured and did not move the output is a
          // negative verdict (fail). One that could not be measured, or whose
          // effect cannot be told apart from the output's own change between
          // renders (unstable), leaves the check without a verdict (error):
          // the effect is never reported ok with a control left unjudged.
          status = errorNames.length > 0 || unstableNames.length > 0 ? 'error' : 'fail'
          details = `Uniforms ${problems.join('; ')}`
        } else {
          status = 'ok'
          details = 'Uniforms affect output'
        }
      }
      if (gatedNames.length > 0) details += `; gated (not testable at run time): ${gatedNames.join(', ')}`
      if (untestedNames.length > 0) details += `; untested: ${untestedNames.join(', ')}`
      if (settleTimedOut) details += `; an async overlay did not settle within ${settleMs} ms`

      return {
        status,
        tested_uniforms: tested,
        uniforms,
        threshold: 0.002,
        strong_threshold: 0.0005,
        details,
        ...(settleTimedOut ? { settle_timed_out: true } : {}),
        ...(reshape ? { measured_size: [sizeBefore.width, Math.max(1, Math.round(sizeBefore.height * 0.625))] } : {}),
      }
      } finally {
        if (reshape) {
          renderer.resize(sizeBefore.width, sizeBefore.height)
          await settle()
        }
      }
    }, { globals: session.globals, settleMs: session.timeoutMs })

    // Resume animation
    await page.evaluate((globals) => {
      const w = window as any
      if (w[globals.setPaused]) w[globals.setPaused](false)
    }, session.globals)

    // Report the identity (issue #34): the requested effect id, the effect id
    // the page confirms (page_effect_id), and the backend the page actually
    // rendered on.
    return {
      ...result,
      backend: selection.backend,
      ...requestIdentity(effectId, selection.effectId),
    }
  })
}

export function registerTestUniformResponsiveness(server: McpServer): void {
  server.tool(
    'testUniformResponsiveness',
    "For each uniform control the tool finds two values that differ from the value the loaded program set: a range control's farther 25%/75% point and its 38.2% point, a dropdown's other choices, a boolean's opposite, or a vector moved a quarter of its range. It first opens the control's ui.enabledBy gate by setting the gate params (enabled_with). It captures the output twice (the second against the first measures how much the output changes between renders on its own), then sets each value and compares at paused t=0 and t=0.37. A control responds when the luma, a per-channel mean or the per-pixel mean (64x64 grid) changes by more than 0.002, or more than 0.05% of all pixels change by more than 16/255 (strong_fraction); when the output changes on its own, only well beyond that change. A control that does not respond is retried with one other control moved (context). Results per uniform: pass, fail, error, gated (a compile-time define or a gate that cannot be opened), unstable (no verdict: the output changes between renders by more than the thresholds), or untested (no other value can be set at run time). Status is ok when at least one control was measured and every measured control responded; error when one could not be measured or got no verdict (unstable); otherwise fail when one did not respond; skipped when no control could be set at run time (every control gated or untested). Async overlays are awaited, up to the session timeout (settle_timed_out).",
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
            // The verb labels its result with the requested id (issue #34).
            results.push(await testUniformResponsiveness(session, id))
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
