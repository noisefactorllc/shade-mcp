import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { BrowserSession } from '../../harness/browser-session.js'
import { getConfig } from '../../config.js'
import { toolResult } from '../tool-result.js'

export const runDslProgramSchema = {
  dsl: z.string().describe('DSL program string'),
  backend: z.enum(['webgl2', 'webgpu']).default('webgl2').describe('Rendering backend'),
  warmup_frames: z.number().optional().default(10).describe('Number of frames to wait before measuring output'),
  capture_image: z.boolean().optional().default(false).describe('Capture the frame as a PNG data URI'),
  uniforms: z.record(z.string(), z.number()).optional().describe('Values that override uniforms'),
}

export async function runDslProgram(
  session: BrowserSession,
  dsl: string,
  options: { warmupFrames?: number; captureImage?: boolean; uniforms?: Record<string, number> } = {},
): Promise<any> {
  return session.runWithConsoleCapture(async () => {
    const page = session.page!

    await session.setBackend(session.backend)

    // Compile DSL
    const compileResult = await page.evaluate(({ dsl, timeout, globals }) => {
      return new Promise<any>((resolve) => {
        // Try to find DSL editor and run
        const editor = document.getElementById('dsl-editor') as HTMLTextAreaElement | null
        const runBtn = document.getElementById('dsl-run-btn') as HTMLButtonElement | null

        if (editor && runBtn) {
          editor.value = dsl
          editor.dispatchEvent(new Event('input'))
          runBtn.click()
        } else {
          // Fallback: compile directly via renderer
          const renderer = (window as any)[globals.canvasRenderer]
          if (renderer?.compile) {
            renderer.compile(dsl).then(() => {
              resolve({ status: 'ok', message: 'Compiled via renderer' })
            }).catch((err: any) => {
              resolve({ status: 'error', message: err?.message || String(err) })
            })
            return
          }
          resolve({ status: 'error', message: 'No DSL editor or renderer found' })
          return
        }

        const start = Date.now()
        const poll = () => {
          const status = document.getElementById('status')
          const text = (status?.textContent || '').toLowerCase()
          if (text.includes('error') || text.includes('failed')) {
            resolve({ status: 'error', message: status?.textContent })
            return
          }
          if (text.includes('loaded') || text.includes('compiled') || text.includes('ready')) {
            resolve({ status: 'ok', message: 'Compiled' })
            return
          }
          if (Date.now() - start > timeout) {
            resolve({ status: 'error', message: 'Compile timeout' })
            return
          }
          setTimeout(poll, 50)
        }
        poll()
      })
    }, { dsl, timeout: session.timeoutMs, globals: session.globals })

    if (compileResult.status === 'error') {
      return { status: 'error', error: compileResult.message }
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

    // Wait for warmup. Bounded like the render tool's wait: if the viewer's
    // frame counter never advances, this rAF poll would hang the tool call
    // forever, because page.setDefaultTimeout does not apply to evaluate.
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
          if (((window as any)[globals.frameCount] || 0) - start >= frames) {
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

    // Read pixels and compute metrics
    const result = await page.evaluate(({ captureImage, globals }) => {
      const renderer = (window as any)[globals.canvasRenderer]
      const pipeline = (window as any)[globals.renderingPipeline]
      if (!renderer || !pipeline) return { status: 'error', error: 'No renderer' }

      const canvas = renderer.canvas
      const gl = pipeline.backend?.gl
      if (!gl) return { status: 'error', error: 'No GL context' }

      const width = canvas.width, height = canvas.height
      const pixels = new Uint8Array(width * height * 4)
      gl.bindFramebuffer(gl.FRAMEBUFFER, null)
      gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels)

      // Compute metrics
      const count = width * height
      const stride = Math.max(1, Math.floor(count / 1000))
      let sumR = 0, sumG = 0, sumB = 0, samples = 0
      const colors = new Set<string>()

      for (let i = 0; i < count; i += stride) {
        const idx = i * 4
        sumR += pixels[idx] / 255; sumG += pixels[idx + 1] / 255; sumB += pixels[idx + 2] / 255
        colors.add(`${pixels[idx]},${pixels[idx + 1]},${pixels[idx + 2]}`)
        samples++
      }

      const meanR = sumR / samples, meanG = sumG / samples, meanB = sumB / samples

      let imageUri: string | null = null
      if (captureImage) {
        const tmp = document.createElement('canvas')
        tmp.width = width; tmp.height = height
        const ctx = tmp.getContext('2d')!
        const imgData = ctx.createImageData(width, height)
        for (let y = 0; y < height; y++) {
          for (let x = 0; x < width; x++) {
            const src = ((height - 1 - y) * width + x) * 4
            const dst = (y * width + x) * 4
            imgData.data[dst] = pixels[src]
            imgData.data[dst + 1] = pixels[src + 1]
            imgData.data[dst + 2] = pixels[src + 2]
            imgData.data[dst + 3] = pixels[src + 3]
          }
        }
        ctx.putImageData(imgData, 0, 0)
        imageUri = tmp.toDataURL('image/png')
      }

      return {
        status: 'ok',
        backend: pipeline.backend?.getName?.() || 'unknown',
        frame: { width, height, image_uri: imageUri },
        metrics: {
          mean_rgb: [meanR, meanG, meanB],
          unique_sampled_colors: colors.size,
          is_all_zero: meanR === 0 && meanG === 0 && meanB === 0,
          is_monochrome: colors.size <= 1,
        }
      }
    }, { captureImage: options.captureImage ?? false, globals: session.globals })

    return result
  })
}

export function registerRunDslProgram(server: McpServer): void {
  server.tool(
    'runDslProgram',
    'Compile arbitrary DSL code without predefined effect files. Execute the program. Return metrics and pass status.',
    runDslProgramSchema,
    async (args: any) => {
      const session = new BrowserSession({ backend: args.backend })
      try {
        await session.setup()
        const result = await runDslProgram(session, args.dsl, {
          warmupFrames: args.warmup_frames,
          captureImage: args.capture_image,
          uniforms: args.uniforms,
        })
        return toolResult(result)
      } finally {
        await session.teardown()
      }
    }
  )
}
