import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { BrowserSession, effectSelectionProblem } from '../../harness/browser-session.js'
import type { EffectSelectionResult, RenderResult } from '../../harness/types.js'
import { getConfig } from '../../config.js'
import { resolveEffectIds } from '../resolve-effects.js'
import { toolResult } from '../tool-result.js'
import { computeImageMetrics } from '../../harness/pixel-reader.js'

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

export const renderEffectFrameSchema = {
  effect_id: z.string().optional().describe('One effect ID, such as "synth/noise"'),
  effects: z.string().optional().describe('Comma-separated effect IDs'),
  backend: z.enum(['webgl2', 'webgpu']).default('webgl2').describe('Rendering backend'),
  warmup_frames: z.number().optional().default(10).describe('Frames to wait before capture'),
  capture_image: z.boolean().optional().default(false).describe('Capture the frame as a PNG data URI'),
  uniforms: z.record(z.string(), z.number()).optional().describe('Values that override uniforms'),
  time: z.number().optional().describe('Time in seconds at which to pause and render the frame'),
  resolution: z.tuple([z.number(), z.number()]).optional().describe('Viewport resolution as [width, height]'),
}

export async function renderEffectFrame(
  session: BrowserSession,
  effectId: string,
  options: { warmupFrames?: number; captureImage?: boolean; uniforms?: Record<string, number>; time?: number; resolution?: [number, number] } = {},
): Promise<RenderResult> {
  return session.runWithConsoleCapture(async () => {
    const page = session.page!

    // The switch must actually take effect: setBackend rejects when the page
    // backend never reaches the target (issue #34).
    let selection: EffectSelectionResult
    try {
      await session.setBackend(session.backend)
    } catch (err) {
      // Bind even this failure to what the page actually holds (issue #34).
      const failed = await session.readPageIdentity()
      return {
        status: 'error' as const,
        backend: failed.backend ?? 'unknown',
        error: `Backend switch failed: ${errorMessage(err)}`,
        ...(failed.effectId ? { effect_id: failed.effectId } : {}),
        ...(options.resolution ? { requested_resolution: options.resolution } : {}),
      }
    }

    // Set viewport resolution if specified
    if (options.resolution) {
      await page.setViewportSize({ width: options.resolution[0], height: options.resolution[1] })
    }

    // Select and wait until the page finished building THIS effect (issue
    // #34) — status text is not a readiness signal.
    selection = await session.selectEffect(effectId)
    const problem = effectSelectionProblem(selection, effectId, session.backend)
    if (problem) {
      return {
        status: 'error' as const,
        backend: selection.backend,
        error: problem,
        ...(selection.effectId ? { effect_id: selection.effectId } : {}),
        ...(options.resolution ? { requested_resolution: options.resolution } : {}),
      }
    }

    // Apply uniforms
    if (options.uniforms) {
      await page.evaluate(({ unis, globals }) => {
        const pipeline = (window as any)[globals.renderingPipeline]
        if (!pipeline) return
        for (const [k, v] of Object.entries(unis)) {
          if (pipeline.setUniform) pipeline.setUniform(k, v)
          else if (pipeline.globalUniforms) pipeline.globalUniforms[k] = v
        }
      }, { unis: options.uniforms, globals: session.globals })
    }

    // Best-effort honor of the requested resolution: the viewport alone does
    // not size the render canvas — the viewer's own layout logic does, and a
    // viewer whose canvas does not follow the window would otherwise capture
    // at a different size and return a silent `ok`. Prefer the viewer's
    // resize hook when it exposes one, else size the render canvas directly.
    // The capture below verifies the actual size and reports a mismatch, so a
    // viewer that ignores both paths is never silently accepted.
    if (options.resolution) {
      await page.evaluate(({ width, height, globals }) => {
        const renderer = (window as any)[globals.canvasRenderer]
        if (!renderer) return
        try {
          if (typeof renderer.resize === 'function') renderer.resize(width, height)
          else if (renderer.canvas) { renderer.canvas.width = width; renderer.canvas.height = height }
        } catch (e) { /* fixed-size canvas: the capture reports the mismatch */ }
      }, { width: options.resolution[0], height: options.resolution[1], globals: session.globals })
    }

    // Warm up while the render loop is still live. A timed render pauses the
    // viewer below, and a paused viewer freezes the frame counter, so warming
    // up after the pause would stall for the whole timeout on every
    // `time:`-specified capture. The wait is also bounded: the frame counter
    // lives in the viewer, and when it never advances (a session left paused,
    // a viewer that does not publish the global, a backgrounded tab) this rAF
    // poll would otherwise hang the whole tool call — page.setDefaultTimeout
    // does not apply to evaluate, so SHADE_TIMEOUT_MS would never fire.
    const warmup = options.warmupFrames ?? 10
    await page.evaluate(({ frames, globals, timeout }) => {
      return new Promise<void>((resolve, reject) => {
        const start = (window as any)[globals.frameCount] || 0
        let settled = false
        const timer = setTimeout(() => {
          if (settled) return
          settled = true
          reject(new Error(`Warmup timed out after ${timeout} ms waiting for ${frames} frames (frame counter stuck at ${(window as any)[globals.frameCount] || 0})`))
        }, timeout)
        const poll = () => {
          if (settled) return
          const current = (window as any)[globals.frameCount] || 0
          if (current - start >= frames) {
            settled = true
            clearTimeout(timer)
            resolve()
          } else {
            requestAnimationFrame(poll)
          }
        }
        poll()
      })
    }, { frames: warmup, globals: session.globals, timeout: session.timeoutMs })

    // If time is specified, pause and set time — only after the warmup above.
    // Unpausing happens in a finally: a throwing capture must not leak a paused
    // session into the next effect of the batch, where a paused viewer freezes
    // the frame counter and every subsequent warmup wait would stall.
    let paused = false
    if (options.time !== undefined) {
      await page.evaluate(({ time, globals }) => {
        const w = window as any
        if (w[globals.setPaused]) w[globals.setPaused](true)
        if (w[globals.setPausedTime]) w[globals.setPausedTime](time)
      }, { time: options.time, globals: session.globals })
      paused = true
    }

    try {
      // Read pixels in the page; the metrics are computed in Node below.
      const result = await page.evaluate(async ({ captureImage, globals, time, requested }) => {
        const toBase64 = (bytes: Uint8Array): string => {
          let binary = ''
          for (let offset = 0; offset < bytes.length; offset += 0x8000) {
            binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000))
          }
          return btoa(binary)
        }
        const pipeline = (window as any)[globals.renderingPipeline]
        // Error paths echo the requested resolution too: the caller must be
        // able to see the request was made even when rendering fails.
        const withRequested = (base: { status: 'error'; backend: string; error: string }) =>
          requested ? { ...base, requested_resolution: requested } : base
        if (!pipeline) return withRequested({ status: 'error', backend: 'unknown', error: 'No renderer' })

        const backend = pipeline.backend
        const backendName = backend?.getName?.() || 'unknown'

        const renderer = (window as any)[globals.canvasRenderer]
        if (!renderer) return withRequested({ status: 'error', backend: backendName, error: `No renderer on ${backendName}` })

        const canvas = renderer.canvas

        // Timed capture only: after the pause the frame loop is stopped, so the
        // framebuffer still holds the last warmup frame rather than the
        // requested paused time. Redraw explicitly at that time — the same
        // value handed to setPausedTime, which is what a paused single-frame
        // render draws (the parity capture redraws the same way before its
        // readback). renderer.render takes the time to draw as its argument in
        // this viewer family, so a hardcoded 0 would silently pin every timed
        // capture to time 0. Untimed captures keep the historical live-frame
        // readback: the loop is still running and the framebuffer already
        // holds the current frame.
        if (time !== null && typeof renderer.render === 'function') renderer.render(time)

        let pixels: Uint8Array | null = null
        let width = canvas.width, height = canvas.height
        // Backend-neutral readbacks are already normalized to screen
        // orientation below; the WebGL default-framebuffer read is bottom-up.
        let topDown = false

        const gl = backend?.gl
        if (gl) {
          pixels = new Uint8Array(width * height * 4)
          gl.bindFramebuffer(gl.FRAMEBUFFER, null)
          gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels)
        } else if (backend?.readPixels && backend?.textures) {
          // No GL context (WebGPU): read the offscreen render surface through
          // the backend's async texture reader — the same surface and
          // candidate fallback the parity capture uses. Each retry redraws at
          // the requested time, because the async copy may still deliver the
          // previous frame right after a draw.
          const surf = pipeline.graph?.renderSurface
          if (surf) {
            const candidates = ['global_' + surf + '_read']
            try {
              const nodes: string[] = []
              for (const k of backend.textures.keys()) if (/node_\d+_out/.test(k)) nodes.push(k)
              nodes.sort((a: string, c: string) => parseInt(a.match(/node_(\d+)/)![1], 10) - parseInt(c.match(/node_(\d+)/)![1], 10))
              if (nodes.length) candidates.push(nodes[nodes.length - 1])
            } catch (e) { /* textures map not iterable */ }
            // The parity capture draws twice before its first readback; mirror
            // that here so an async in-flight copy cannot deliver the frame
            // before the requested one.
            if (time !== null && typeof renderer.render === 'function') renderer.render(time)
            for (let attempt = 0; attempt < 6 && !pixels; attempt++) {
              if (attempt > 0 && time !== null && typeof renderer.render === 'function') renderer.render(time)
              // A read issued right after a draw can return the previous
              // frame; drain the submitted work first (same as runDslProgram).
              await backend.device?.queue?.onSubmittedWorkDone?.()
              for (const id of candidates) {
                try {
                  const px = await backend.readPixels(id)
                  if (px && px.width && px.height && px.data) {
                    width = px.width; height = px.height
                    const raw = px.data instanceof Float32Array
                      ? Uint8Array.from(px.data, (v: number) => Math.round(Math.max(0, Math.min(1, v)) * 255))
                      : new Uint8Array(px.data)
                    // WebGPU readback is bottom-up; flip the rows to top-down
                    // so the capture orientation matches the WebGL2 read.
                    pixels = new Uint8Array(width * height * 4)
                    const rowBytes = width * 4
                    for (let y = 0; y < height; y++) {
                      pixels.set(raw.subarray((height - 1 - y) * rowBytes, (height - y) * rowBytes), y * rowBytes)
                    }
                    topDown = true
                    break
                  }
                } catch (e) { /* try next candidate */ }
              }
              if (!pixels) await new Promise((res) => setTimeout(res, 80))
            }
          }
        }

        if (!pixels) {
          return withRequested({
            status: 'error' as const,
            backend: backendName,
            error: `Failed to read pixels on ${backendName}: no readable render surface`,
          })
        }

        // Screen orientation (top-down) for both the metrics and the capture.
        // Bottom-up WebGL reads are flipped here; backend-neutral reads
        // already are top-down.
        let screen = pixels
        if (!topDown) {
          screen = new Uint8Array(width * height * 4)
          const rowBytes = width * 4
          for (let y = 0; y < height; y++) {
            screen.set(pixels.subarray((height - 1 - y) * rowBytes, (height - y) * rowBytes), y * rowBytes)
          }
        }

        let imageUri: string | null = null
        if (captureImage) {
          const tmpCanvas = document.createElement('canvas')
          tmpCanvas.width = width; tmpCanvas.height = height
          const ctx = tmpCanvas.getContext('2d')!
          const imgData = ctx.createImageData(width, height)
          imgData.data.set(screen)
          ctx.putImageData(imgData, 0, 0)
          imageUri = tmpCanvas.toDataURL('image/png')
        }

        // A viewer that did not honor the requested resolution must never
        // return a silent `ok`: echo the request and warn with both sizes.
        const resolutionMismatch = requested !== null && (width !== requested[0] || height !== requested[1])
        return {
          status: 'ok' as const,
          backend: pipeline.backend?.getName?.() || 'unknown',
          ...(requested ? { requested_resolution: requested } : {}),
          ...(resolutionMismatch ? {
            warning: `Requested resolution ${requested[0]}x${requested[1]} but rendered ${width}x${height}; the viewer did not honor the requested resolution`,
          } : {}),
          frame: { image_uri: imageUri, width, height },
          // The metrics are computed in Node by computeImageMetrics, the one
          // definition every verb and the library export share (issue #29).
          // page.evaluate cannot call a Node import, so the bytes travel back.
          pixels: toBase64(screen),
        }
      }, { captureImage: options.captureImage ?? false, globals: session.globals, time: options.time ?? null, requested: options.resolution ?? null })

      // The page-confirmed effect id travels with the capture result.
      const { pixels, ...captured } = result as RenderResult & { pixels?: string }
      if (pixels !== undefined && captured.frame) {
        captured.metrics = computeImageMetrics(Buffer.from(pixels, 'base64'), captured.frame.width, captured.frame.height)
      }
      return {
        ...captured,
        ...(selection.effectId ? { effect_id: selection.effectId } : {}),
      } as RenderResult
    } finally {
      // Unpause even when the warmup wait or the capture threw, so a failure
      // cannot leak a paused session into the next effect of the batch.
      if (paused) {
        await page.evaluate((globals) => {
          const w = window as any
          if (w[globals.setPaused]) w[globals.setPaused](false)
        }, session.globals).catch(() => {})
      }
    }
  })
}

export function registerRenderEffectFrame(server: McpServer): void {
  server.tool(
    'renderEffectFrame',
    'Render one frame. Compute mean RGB, variance, and monochrome/blank detection. Optionally capture a PNG.',
    renderEffectFrameSchema,
    async (args: any) => {
      const config = getConfig()
      const effectIds = resolveEffectIds(args, config.effectsDir)
      const session = new BrowserSession({ backend: args.backend })
      try {
        await session.setup()
        const results = []
        for (const id of effectIds) {
          try {
            results.push({ effect_id: id, ...await renderEffectFrame(session, id, {
              warmupFrames: args.warmup_frames,
              captureImage: args.capture_image,
              uniforms: args.uniforms,
              time: args.time,
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
