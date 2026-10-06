import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { BrowserSession, effectSelectionProblem } from '../../harness/browser-session.js'
import type { EffectSelectionResult, BenchmarkResult } from '../../harness/types.js'
import { getConfig } from '../../config.js'
import { resolveEffectIds } from '../resolve-effects.js'
import { toolResult } from '../tool-result.js'

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

export const benchmarkEffectFPSSchema = {
  effect_id: z.string().optional().describe('One effect ID, such as "synth/noise"'),
  effects: z.string().optional().describe('Comma-separated effect IDs'),
  backend: z.enum(['webgl2', 'webgpu']).default('webgl2').describe('Rendering backend'),
  target_fps: z.number().optional().default(60).describe('Target FPS'),
  duration_seconds: z.number().optional().default(5).describe('Benchmark duration in seconds'),
  resolution: z.tuple([z.number(), z.number()]).optional().describe('Viewport resolution as [width, height]'),
}

export async function benchmarkEffectFPS(
  session: BrowserSession,
  effectId: string,
  options: { targetFps?: number; durationSeconds?: number; resolution?: [number, number] } = {},
): Promise<BenchmarkResult> {
  const targetFps = options.targetFps ?? 60
  const duration = options.durationSeconds ?? 5

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
        status: 'error' as const,
        backend: failed.backend ?? 'unknown',
        achieved_fps: 0,
        meets_target: false,
        stats: { frame_count: 0, avg_frame_time_ms: 0, jitter_ms: 0, min_frame_time_ms: 0, max_frame_time_ms: 0 },
        error: `Backend switch failed: ${errorMessage(err)}`,
        ...(failed.effectId ? { effect_id: failed.effectId } : {}),
      }
    }

    // Set viewport resolution if specified
    if (options.resolution) {
      await page.setViewportSize({ width: options.resolution[0], height: options.resolution[1] })
    }

    // Select and wait until the page finished building THIS effect (issue
    // #34) — status text is not a readiness signal.
    const selection: EffectSelectionResult = await session.selectEffect(effectId)
    const problem = effectSelectionProblem(selection, effectId, session.backend)
    if (problem) {
      return {
        status: 'error' as const,
        backend: selection.backend,
        achieved_fps: 0,
        meets_target: false,
        stats: { frame_count: 0, avg_frame_time_ms: 0, jitter_ms: 0, min_frame_time_ms: 0, max_frame_time_ms: 0 },
        error: problem,
        ...(selection.effectId ? { effect_id: selection.effectId } : {}),
      }
    }

    // Best-effort honor of the requested resolution (same as renderEffectFrame):
    // the viewport alone does not size the render canvas. Prefer the viewer's
    // resize hook, else size the canvas directly; the measured frame size is
    // reported below either way.
    if (options.resolution) {
      await page.evaluate(({ width, height, globals }) => {
        const renderer = (window as any)[globals.canvasRenderer]
        if (!renderer) return
        try {
          if (typeof renderer.resize === 'function') renderer.resize(width, height)
          else if (renderer.canvas) { renderer.canvas.width = width; renderer.canvas.height = height }
        } catch (e) { /* fixed-size canvas: reported below */ }
      }, { width: options.resolution[0], height: options.resolution[1], globals: session.globals })
    }

    // Run benchmark with per-frame timing
    const result = await page.evaluate(({ duration }) => {
      return new Promise<any>((resolve) => {
        const frameTimes: number[] = []
        let lastTime = performance.now()
        let running = true

        function onFrame() {
          if (!running) return
          const now = performance.now()
          frameTimes.push(now - lastTime)
          lastTime = now
          requestAnimationFrame(onFrame)
        }

        requestAnimationFrame(onFrame)

        setTimeout(() => {
          running = false
          const frameCount = frameTimes.length
          const totalMs = frameTimes.reduce((a, b) => a + b, 0)
          const fps = frameCount / (totalMs / 1000)
          const avgFrameTime = totalMs / Math.max(frameCount, 1)

          let minFrameTime = Infinity, maxFrameTime = 0
          for (const t of frameTimes) {
            if (t < minFrameTime) minFrameTime = t
            if (t > maxFrameTime) maxFrameTime = t
          }

          // Jitter = standard deviation of frame times
          let sumSq = 0
          for (const t of frameTimes) sumSq += (t - avgFrameTime) ** 2
          const jitter = frameCount > 1 ? Math.sqrt(sumSq / (frameCount - 1)) : 0

          resolve({
            frame_count: frameCount,
            achieved_fps: Math.round(fps * 100) / 100,
            avg_frame_time_ms: Math.round(avgFrameTime * 100) / 100,
            min_frame_time_ms: Math.round((minFrameTime === Infinity ? 0 : minFrameTime) * 100) / 100,
            max_frame_time_ms: Math.round(maxFrameTime * 100) / 100,
            jitter_ms: Math.round(jitter * 100) / 100,
          })
        }, duration * 1000)
      })
    }, { duration })

    // Report the size the pipeline rendered at. The presented canvas is sized
    // by the viewer's layout and can be smaller than the render (noisemaker's
    // demo viewer presents a 512x512 render in a 179x179 canvas), so it is
    // only the fallback when the pipeline does not expose its size.
    const frame = await page.evaluate((globals) => {
      const w = window as any
      const pipeline = w[globals.renderingPipeline]
      if (Number.isFinite(pipeline?.width) && Number.isFinite(pipeline?.height) && pipeline.width > 0 && pipeline.height > 0) {
        return { width: pipeline.width, height: pipeline.height }
      }
      const canvas = w[globals.canvasRenderer]?.canvas
      return canvas ? { width: canvas.width, height: canvas.height } : null
    }, session.globals)

    const resolutionMismatch = options.resolution !== undefined && frame !== null
      && (frame.width !== options.resolution[0] || frame.height !== options.resolution[1])
    return {
      status: 'ok' as const,
      // The backend the page reported, not the requested value (issue #34).
      backend: selection.backend,
      ...(selection.effectId ? { effect_id: selection.effectId } : {}),
      ...(options.resolution ? { requested_resolution: options.resolution } : {}),
      ...(frame ? { frame } : {}),
      ...(resolutionMismatch ? {
        warning: `Requested resolution ${options.resolution![0]}x${options.resolution![1]} but measured ${frame!.width}x${frame!.height}; the viewer did not honor the requested resolution`,
      } : {}),
      achieved_fps: result.achieved_fps,
      meets_target: result.achieved_fps >= targetFps,
      stats: {
        frame_count: result.frame_count,
        avg_frame_time_ms: result.avg_frame_time_ms,
        jitter_ms: result.jitter_ms,
        min_frame_time_ms: result.min_frame_time_ms,
        max_frame_time_ms: result.max_frame_time_ms,
      }
    }
  })
}

export function registerBenchmarkEffectFPS(server: McpServer): void {
  server.tool(
    'benchmarkEffectFPS',
    'Measure achieved FPS, jitter, and frame timing statistics against a target frame rate.',
    benchmarkEffectFPSSchema,
    async (args: any) => {
      const config = getConfig()
      const effectIds = resolveEffectIds(args, config.effectsDir)
      const session = new BrowserSession({ backend: args.backend })
      try {
        await session.setup()
        const results = []
        for (const id of effectIds) {
          try {
            results.push({ effect_id: id, ...await benchmarkEffectFPS(session, id, {
              targetFps: args.target_fps,
              durationSeconds: args.duration_seconds,
              resolution: args.resolution,
            }) })
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
