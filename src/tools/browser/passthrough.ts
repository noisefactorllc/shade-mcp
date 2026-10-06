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
    const result = await page.evaluate(async (globals) => {
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

      let consumedInput: { key: string; id: string } | null = null
      for (const pass of (pipeline.graph?.passes || [])) {
        const inputs = pass.inputs || {}
        for (const key of Object.keys(inputs)) {
          const id = String(inputs[key])
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
      type Frame = { pixels: Uint8Array; width: number; height: number }
      let worst: { meanDiff: number; changedFraction: number } | null = null
      try {
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
            inputFrame = await readInput(consumedInput.id)
            outputFrame = await readOutput()
            if ((!inputFrame || !outputFrame) && attempt < 5) await new Promise((res) => setTimeout(res, 80))
          }
          if (!inputFrame) {
            return { status: 'error', isFilterEffect: true, similarity: null, backend: backendName, inputTexture: consumedInput.id, details: `Failed to read input texture ${consumedInput.id} on ${backendName}` }
          }
          if (!outputFrame) {
            return { status: 'error', isFilterEffect: true, similarity: null, backend: backendName, details: `Failed to read pixels on ${backendName}` }
          }

          // Mean absolute per-channel difference between output and input,
          // normalized to 0..1, and the fraction of sampled pixels that
          // changed by more than 2/255 in any channel. Only RGB counts: alpha
          // is a present detail, not effect output.
          const count = Math.min(inputFrame.width * inputFrame.height, outputFrame.width * outputFrame.height)
          const stride = Math.max(1, Math.floor(count / 4096))
          let diffSum = 0, changed = 0, samples = 0
          for (let i = 0; i < count; i += stride) {
            const idx = i * 4
            const dr = Math.abs(outputFrame.pixels[idx] - inputFrame.pixels[idx])
            const dg = Math.abs(outputFrame.pixels[idx + 1] - inputFrame.pixels[idx + 1])
            const db = Math.abs(outputFrame.pixels[idx + 2] - inputFrame.pixels[idx + 2])
            diffSum += dr + dg + db
            if (dr > 2 || dg > 2 || db > 2) changed++
            samples++
          }
          const meanDiff = diffSum / (samples * 3 * 255)
          const changedFraction = changed / samples
          if (!worst || changedFraction > worst.changedFraction ||
              (changedFraction === worst.changedFraction && meanDiff > worst.meanDiff)) {
            worst = { meanDiff, changedFraction }
          }
        }
      } finally {
        if (w[globals.setPausedTime]) w[globals.setPausedTime](0)
        if (w[globals.setPaused]) w[globals.setPaused](false)
      }

      // A passthrough leaves nearly every pixel as it was: the mean
      // difference stays within the threshold AND at most 1% of the sampled
      // pixels change. A filter that subtly changes most pixels (a mild
      // blur) modifies its input even when its mean difference is small.
      const meanDiff = worst!.meanDiff
      const changedFraction = worst!.changedFraction
      const threshold = 0.01
      const isPassthrough = meanDiff <= threshold && changedFraction <= threshold

      return {
        status: isPassthrough ? 'passthrough' : 'ok',
        isFilterEffect: true,
        similarity: meanDiff,
        changed_fraction: changedFraction,
        threshold,
        inputTexture: consumedInput.id,
        details: isPassthrough
          ? `Output matches input (mean diff ${meanDiff.toFixed(4)}, ${(changedFraction * 100).toFixed(1)}% of pixels changed)`
          : `Effect modifies input (mean diff ${meanDiff.toFixed(4)}, ${(changedFraction * 100).toFixed(1)}% of pixels changed)`
      }
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

export function registerTestNoPassthrough(server: McpServer): void {
  server.tool(
    'testNoPassthrough',
    'Check that a filter effect modifies the input it consumes: compares the rendered output with the bound input texture at one fixed paused time (>1% mean pixel difference means the effect modifies its input).',
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
