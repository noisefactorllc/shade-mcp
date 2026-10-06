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

      async function captureMetrics() {
        if (!renderer) return null
        renderer.render(0)
        const read = await readFrame()
        if (!read) return null
        const { pixels, width, height } = read
        const count = width * height
        let sumR = 0, sumG = 0, sumB = 0
        for (let i = 0; i < pixels.length; i += 4) {
          sumR += pixels[i] / 255; sumG += pixels[i + 1] / 255; sumB += pixels[i + 2] / 255
        }
        return [sumR / count, sumG / count, sumB / count]
      }

      const baseline = await captureMetrics()
      if (!baseline) return { status: 'error', tested_uniforms: [], backend: backendName, details: `Failed to capture baseline on ${backendName}` }

      const effectGlobals = effect.instance.globals
      const tested: string[] = []
      const uniforms: Array<Record<string, any>> = []
      const failedNames: string[] = []
      const errorNames: string[] = []

      for (const [name, spec] of Object.entries(effectGlobals) as any[]) {
        if (!spec.uniform) continue
        if (spec.type === 'boolean' || spec.type === 'button') continue
        if (typeof spec.min !== 'number' || typeof spec.max !== 'number' || spec.min === spec.max) continue

        const defaultVal = spec.default ?? spec.min
        const range = spec.max - spec.min
        let testVal = defaultVal === spec.min ? spec.min + range * 0.75 : spec.min + range * 0.25
        if (spec.type === 'int') testVal = Math.round(testVal)

        if (pipeline.setUniform) pipeline.setUniform(spec.uniform, testVal)
        else if (pipeline.globalUniforms) pipeline.globalUniforms[spec.uniform] = testVal

        let testMetrics: number[] | null = null
        let measureError: string | null = null
        try {
          testMetrics = await captureMetrics()
        } catch (err) {
          measureError = err instanceof Error ? err.message : String(err)
        }

        if (testMetrics) {
          const lumaDiff = Math.abs(
            (testMetrics[0] + testMetrics[1] + testMetrics[2]) / 3 -
            (baseline[0] + baseline[1] + baseline[2]) / 3
          )
          const maxChannelDiff = Math.max(
            Math.abs(testMetrics[0] - baseline[0]),
            Math.abs(testMetrics[1] - baseline[1]),
            Math.abs(testMetrics[2] - baseline[2])
          )
          // This function is serialized into the page: the threshold must stay
          // a literal, kept in sync with UNIFORM_RESPONSE_THRESHOLD.
          const responds = lumaDiff > 0.002 || maxChannelDiff > 0.002
          uniforms.push({
            name,
            uniform: spec.uniform,
            default_value: defaultVal,
            test_value: testVal,
            luma_diff: lumaDiff,
            max_channel_diff: maxChannelDiff,
            responds,
          })
          if (responds) {
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
            test_value: testVal,
            luma_diff: null,
            max_channel_diff: null,
            responds: false,
            error: measureError ?? 'Failed to capture test render',
          })
        }

        // Restore default
        if (pipeline.setUniform) pipeline.setUniform(spec.uniform, defaultVal)
        else if (pipeline.globalUniforms) pipeline.globalUniforms[spec.uniform] = defaultVal
      }

      let status: string
      let details: string
      if (tested.length === 0) {
        status = 'skipped'
        details = 'No testable uniforms'
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
    'For each uniform:\n1. Render a baseline.\n2. Change the uniform value.\n3. Compare the output.\n' +
        'Status is ok only when at least one uniform was tested and every tested uniform affected output; ' +
        'fail when a measured uniform did not affect output, error when any tested uniform could not be measured (details names them); ' +
        'skipped when nothing was testable. Each tested uniform is reported with its test value, luma and ' +
        'max channel deltas against the 0.002 threshold.',
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
