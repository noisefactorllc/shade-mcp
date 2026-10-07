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

export const testNoPassthroughSchema = {
  effect_id: z.string().optional().describe('One effect ID, such as "synth/noise"'),
  effects: z.string().optional().describe('Comma-separated effect IDs'),
  backend: z.enum(['webgl2', 'webgpu']).default('webgl2').describe('Rendering backend'),
}

export async function testNoPassthrough(
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
        isFilterEffect: false,
        similarity: null,
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
        isFilterEffect: false,
        similarity: null,
        backend: selection.backend,
        details: problem,
        ...(selection.effectId ? { effect_id: selection.effectId } : {}),
      }
    }

    // Check if filter effect and test passthrough
    const result = await page.evaluate(async ({ globals, settleMs }) => {
      const w = window as any
      const pipeline = w[globals.renderingPipeline]
      const effect = w[globals.currentEffect]
      if (!pipeline || !effect) return { status: 'error', isFilterEffect: false, similarity: null, details: 'No effect loaded' }

      const renderer = w[globals.canvasRenderer]
      const backend = pipeline.backend
      const backendName = backend?.getName?.() || 'unknown'
      if (!renderer) return { status: 'error', isFilterEffect: false, similarity: null, details: 'No renderer' }
      if (!(backend?.readPixels && backend?.textures)) {
        return { status: 'error', isFilterEffect: false, similarity: null, backend: backendName, details: `No readable pixels on ${backendName} backend` }
      }

      // A filter consumes a pipeline input (inputTex, inputTex3d, o0..o7).
      // Classify by the pass input KEY (the pipeline input name) or by a value
      // that names a pipeline input — never by a substring of the bound
      // texture id: in a compiled graph the values are texture ids such as
      // node_0_out, so a substring test on values matches nothing (every
      // effect reported "Not a filter effect") or misclassifies a generator
      // whose texture ids happen to contain "input" (issue #31).
      const PIPELINE_INPUTS = ['inputTex', 'inputTex3d', 'o0', 'o1', 'o2', 'o3', 'o4', 'o5', 'o6', 'o7']
      const isPipelineInput = (name: string) => PIPELINE_INPUTS.includes(name) || renderer.isStarterEffect?.(name) === true

      // A pass that reads a texture this pass or a later one writes is
      // reading the effect's own previous output (a feedback loop such as
      // convolutionFeedback's selfTex), not its input.
      const passes: any[] = pipeline.graph?.passes || []
      const writtenAt = new Map<string, number>()
      passes.forEach((pass: any, index: number) => {
        for (const id of Object.values(pass.outputs || {})) if (!writtenAt.has(String(id))) writtenAt.set(String(id), index)
      })
      let consumedInput: { key: string; id: string } | null = null
      for (const [index, pass] of passes.entries()) {
        const inputs = pass.inputs || {}
        for (const key of Object.keys(inputs)) {
          const id = String(inputs[key])
          if ((writtenAt.get(id) ?? -1) >= index) continue
          if (isPipelineInput(key) || isPipelineInput(id)) {
            consumedInput = { key, id }
            break
          }
        }
        if (consumedInput) break
      }

      if (!consumedInput) return { status: 'skipped', isFilterEffect: false, similarity: null, details: 'Not a filter effect' }

      // Read a texture through the backend's async reader — the same path
      // testPixelParity uses — so the capture works on WebGL2 and WebGPU
      // alike, instead of a default-framebuffer gl.readPixels that only
      // exists on WebGL2 and is unreliable when paused.
      async function readTexture(id: string): Promise<{ pixels: Uint8Array; width: number; height: number } | null> {
        try {
          // A read issued right after a draw can return the previous frame;
          // drain the submitted work first (same as runDslProgram).
          await backend.device?.queue?.onSubmittedWorkDone?.()
          const px = await backend.readPixels(id)
          if (!px || !px.width || !px.height || !px.data) return null
          const raw = px.data instanceof Float32Array
            ? Uint8Array.from(px.data, (v: number) => Math.round(Math.max(0, Math.min(1, v)) * 255))
            : new Uint8Array(px.data)
          return { pixels: raw, width: px.width, height: px.height }
        } catch (e) {
          return null
        }
      }

      // The consumed input. A global surface id (global_<name>) names a
      // ping-pong pair, not a texture: read the half the frame presented
      // (frameReadTextures), then global_<name>_read, then the id itself.
      async function readInput(id: string): Promise<{ pixels: Uint8Array; width: number; height: number } | null> {
        const candidates: string[] = []
        const surface = id.startsWith('global_') ? id.slice('global_'.length) : null
        if (surface) {
          const frameRead = pipeline.frameReadTextures?.get?.(surface)
          if (frameRead) candidates.push(frameRead)
          candidates.push(`global_${surface}_read`)
        }
        candidates.push(id)
        for (const candidate of candidates) {
          const frame = await readTexture(candidate)
          if (frame) return frame
        }
        return null
      }

      // The rendered output: prefer the fresh read half of the render
      // surface's ping-pong pair (frameReadTextures tracks the half the last
      // present used — a fixed global_<surface>_read guess can pick the
      // stale half after the swap), then the conventional
      // global_<surface>_read name, then the last node output.
      async function readOutput(): Promise<{ pixels: Uint8Array; width: number; height: number } | null> {
        const surf = pipeline.graph?.renderSurface
        const candidates: string[] = []
        const frameRead = surf != null ? pipeline.frameReadTextures?.get?.(surf) : null
        if (frameRead) candidates.push(frameRead)
        if (surf) candidates.push('global_' + surf + '_read')
        try {
          const nodes: string[] = []
          for (const k of backend.textures.keys()) if (/node_\d+_out/.test(k)) nodes.push(k)
          nodes.sort((a: string, c: string) => parseInt(a.match(/node_(\d+)/)![1], 10) - parseInt(c.match(/node_(\d+)/)![1], 10))
          if (nodes.length) candidates.push(nodes[nodes.length - 1])
        } catch (e) { /* textures map not iterable */ }
        for (const id of candidates) {
          const frame = await readTexture(id)
          if (frame) return frame
        }
        return null
      }

      // Compare the rendered output with the input texture the effect
      // actually consumes, at one fixed paused time. The verdict does not
      // depend on animation or color count: a static copy of a varied input
      // is a passthrough even though it is colorful, and a filter that
      // changes its input but produces a static, low-color output still
      // modifies its input (issue #31).
      if (w[globals.setPaused]) w[globals.setPaused](true)
      if (w[globals.setPausedTime]) w[globals.setPausedTime](0)

      // Compare at two paused times: a time-driven filter (a scroll, a
      // drift) can be the identity at t=0 and still modify its input.
      const COMPARE_TIMES = [0, 0.37]
      // Pixel indices of a 64x64 grid at cell centers. A flat stride of
      // count/4096 lands on the same few columns of a power-of-two frame
      // (x = 0, 256, 512, 768 at 1024x1024) and can miss a periodic pattern.
      const sampleGrid = (width: number, height: number): number[] => {
        const nx = Math.min(64, width), ny = Math.min(64, height), out: number[] = []
        for (let gy = 0; gy < ny; gy++) {
          for (let gx = 0; gx < nx; gx++) {
            out.push(Math.floor((gy + 0.5) * height / ny) * width + Math.floor((gx + 0.5) * width / nx))
          }
        }
        return out
      }
      type Frame = { pixels: Uint8Array; width: number; height: number }
      type Measured = { meanDiff: number; changedFraction: number; strongFraction: number }
      // A passthrough leaves nearly every pixel as it was: the mean
      // difference stays within the threshold AND at most 1% of the sampled
      // pixels change. A filter that subtly changes most pixels (a mild
      // blur) modifies its input even when its mean difference is small.
      const threshold = 0.01
      // A sparse overlay is not a passthrough: more than 0.05% of all pixels
      // changed strongly means the filter drew something.
      const unchanged = (m: Measured) => m.meanDiff <= threshold && m.changedFraction <= threshold && m.strongFraction <= 0.0005

      // The largest output-to-input change over the compare times; an error
      // result when a frame cannot be read.
      const inputId: string = consumedInput.id
      async function measure(): Promise<Measured | { error: Record<string, unknown> }> {
        let worst: Measured | null = null
        for (const t of COMPARE_TIMES) {
          if (w[globals.setPausedTime]) w[globals.setPausedTime](t)
          let inputFrame: Frame | null = null
          let outputFrame: Frame | null = null
          // Cold reads can come back blank or the surface may not be
          // registered yet; retry a bounded number of times (same pattern as
          // the parity capture).
          for (let attempt = 0; attempt < 6 && (!inputFrame || !outputFrame); attempt++) {
            renderer.render(t)
            renderer.render(t)
            inputFrame = await readInput(inputId)
            outputFrame = await readOutput()
            if ((!inputFrame || !outputFrame) && attempt < 5) await new Promise((res) => setTimeout(res, 80))
          }
          if (!inputFrame) {
            return { error: { status: 'error', isFilterEffect: true, similarity: null, backend: backendName, inputTexture: inputId, details: `Failed to read input texture ${inputId} on ${backendName}` } }
          }
          if (!outputFrame) {
            return { error: { status: 'error', isFilterEffect: true, similarity: null, backend: backendName, details: `Failed to read pixels on ${backendName}` } }
          }

          // The comparison is per pixel position: frames of different sizes
          // cannot be compared index by index.
          if (inputFrame.width !== outputFrame.width || inputFrame.height !== outputFrame.height) {
            return { error: { status: 'error', isFilterEffect: true, similarity: null, backend: backendName,
              inputTexture: inputId,
              details: `Input ${inputFrame.width}x${inputFrame.height} and output ${outputFrame.width}x${outputFrame.height} differ in size on ${backendName}` } }
          }

          // Mean absolute per-channel difference between output and input,
          // normalized to 0..1, and the fraction of sampled pixels that
          // changed by more than 2/255 in any channel. Only RGB counts: alpha
          // is a present detail, not effect output.
          const count = inputFrame.width * inputFrame.height
          let diffSum = 0, changed = 0, samples = 0
          for (const i of sampleGrid(inputFrame.width, inputFrame.height)) {
            const idx = i * 4
            const dr = Math.abs(outputFrame.pixels[idx] - inputFrame.pixels[idx])
            const dg = Math.abs(outputFrame.pixels[idx + 1] - inputFrame.pixels[idx + 1])
            const db = Math.abs(outputFrame.pixels[idx + 2] - inputFrame.pixels[idx + 2])
            diffSum += dr + dg + db
            if (dr > 2 || dg > 2 || db > 2) changed++
            samples++
          }
          // A sparse overlay (a few stray hairs) changes too few pixels for
          // the sample to see, but changes them strongly: count every pixel
          // that moved by more than 16/255 in any channel.
          let strong = 0
          for (let i = 0; i < count; i++) {
            const idx = i * 4
            if (Math.abs(outputFrame.pixels[idx] - inputFrame.pixels[idx]) > 16 ||
                Math.abs(outputFrame.pixels[idx + 1] - inputFrame.pixels[idx + 1]) > 16 ||
                Math.abs(outputFrame.pixels[idx + 2] - inputFrame.pixels[idx + 2]) > 16) strong++
          }
          const meanDiff = diffSum / (samples * 3 * 255)
          const changedFraction = changed / samples
          const strongFraction = strong / count
          // Each measure is the larger over the compare times.
          worst = worst
            ? { meanDiff: Math.max(worst.meanDiff, meanDiff), changedFraction: Math.max(worst.changedFraction, changedFraction),
                strongFraction: Math.max(worst.strongFraction, strongFraction) }
            : { meanDiff, changedFraction, strongFraction }
        }
        return worst!
      }

      // Many filters are the identity at their defaults by design (a glitch
      // at zero glitchiness, a mix of zero). A filter is a passthrough only
      // when it also leaves its input unchanged with its controls moved: each
      // ungated runtime control at the farther of its 25% and 75% points.
      const specs = (effect.instance?.globals ?? {}) as Record<string, any>
      const effectFunc = effect.instance?.func ?? effect.name
      const ownPasses = passes.filter((pass) =>
        pass.effectFunc === effectFunc && (pass.effectNamespace == null || pass.effectNamespace === effect.namespace))
      // The viewer writes program values into the passes' uniforms, not the
      // pipeline's global uniforms: read the effect's own passes first.
      const programValue = (uniform: string): unknown => {
        for (const pass of [...ownPasses, ...passes]) {
          const v = pass.uniforms?.[uniform]
          if (typeof v === 'number') return v
        }
        return pipeline.globalUniforms?.[uniform]
      }
      const varied: Record<string, number> = {}
      // Each control's value as the loaded program set it, restored after.
      const start: Record<string, unknown> = {}
      for (const [name, spec] of Object.entries(specs)) {
        if (!spec.uniform || spec.define !== undefined || spec.ui?.enabledBy !== undefined) continue
        if (spec.type === 'boolean' || spec.type === 'button') continue
        if (typeof spec.min !== 'number' || typeof spec.max !== 'number' || spec.min === spec.max) continue
        const current = programValue(spec.uniform)
        start[name] = typeof current === 'number' ? current : (spec.default ?? spec.min)
        const d = start[name] as number
        const range = spec.max - spec.min
        const round = (v: number) => (spec.type === 'int' ? Math.round(v) : v)
        const quarter = round(spec.min + range * 0.25), threeQuarter = round(spec.min + range * 0.75)
        varied[name] = Math.abs(threeQuarter - d) > Math.abs(quarter - d) ? threeQuarter : quarter
      }
      const setAll = async (values: Record<string, number> | null) => {
        for (const name of Object.keys(varied)) {
          pipeline.setUniform?.(specs[name].uniform, values ? values[name] : start[name])
        }
        // Wait for async CPU overlays to redraw, but never longer than the
        // session timeout.
        if (typeof pipeline.whenAsyncInitsSettled === 'function') {
          let timer: any
          await Promise.race([
            pipeline.whenAsyncInitsSettled(),
            new Promise((resolve) => { timer = setTimeout(resolve, settleMs) }),
          ])
          clearTimeout(timer)
        }
      }

      let atDefaults: Measured
      let withVaried: Measured | null = null
      try {
        const first = await measure()
        if ('error' in first) return first.error
        atDefaults = first
        if (unchanged(atDefaults) && Object.keys(varied).length > 0) {
          await setAll(varied)
          try {
            const second = await measure()
            if ('error' in second) return second.error
            withVaried = second
          } finally {
            await setAll(null)
          }
        }
      } finally {
        if (w[globals.setPausedTime]) w[globals.setPausedTime](0)
        if (w[globals.setPaused]) w[globals.setPaused](false)
      }

      const identityAtDefaults = unchanged(atDefaults)
      const reported = withVaried && !unchanged(withVaried) ? withVaried : atDefaults
      const meanDiff = reported.meanDiff
      const changedFraction = reported.changedFraction
      const isPassthrough = unchanged(reported)

      return {
        status: isPassthrough ? 'passthrough' : 'ok',
        isFilterEffect: true,
        similarity: meanDiff,
        changed_fraction: changedFraction,
        strong_fraction: reported.strongFraction,
        threshold,
        inputTexture: consumedInput.id,
        ...(identityAtDefaults && !isPassthrough ? { identity_at_defaults: true, varied } : {}),
        details: isPassthrough
          ? `Output matches input (mean diff ${meanDiff.toFixed(4)}, ${(changedFraction * 100).toFixed(1)}% of pixels changed${withVaried ? ', also with its controls moved' : ''})`
          : `Effect modifies input (mean diff ${meanDiff.toFixed(4)}, ${(changedFraction * 100).toFixed(1)}% of pixels changed${identityAtDefaults ? '; identity at its defaults' : ''})`
      }
    }, { globals: session.globals, settleMs: session.timeoutMs })

    // Report the page-confirmed identity (issue #34): the backend the page
    // actually rendered on, and the effect id the page confirms.
    return {
      ...result,
      backend: selection.backend,
      ...(selection.effectId ? { effect_id: selection.effectId } : {}),
    }
  })
}

export function registerTestNoPassthrough(server: McpServer): void {
  server.tool(
    'testNoPassthrough',
    "Check that a filter effect modifies the input it consumes. Compares the rendered output with the bound input texture (skipping a feedback read of the effect's own output) at paused t=0 and t=0.37: similarity (mean RGB difference on a 64x64 grid), changed_fraction (grid pixels changed by more than 2/255) and strong_fraction (all pixels changed by more than 16/255). Output is unchanged when similarity and changed_fraction are at most 0.01 and strong_fraction at most 0.0005 at both times. A filter unchanged at its defaults is measured again with its ungated controls moved (identity_at_defaults, varied); only a filter unchanged both ways is a passthrough.",
    testNoPassthroughSchema,
    async (args: any) => {
      const config = getConfig()
      const effectIds = resolveEffectIds(args, config.effectsDir)
      const session = new BrowserSession({ backend: args.backend })
      try {
        await session.setup()
        const results = []
        for (const id of effectIds) {
          try {
            results.push({ effect_id: id, ...await testNoPassthrough(session, id) })
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
