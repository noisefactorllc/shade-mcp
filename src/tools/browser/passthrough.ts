import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { BrowserSession } from '../../harness/browser-session.js'
import { getConfig } from '../../config.js'
import { resolveEffectIds } from '../resolve-effects.js'
import { toolResult } from '../tool-result.js'

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

    await session.setBackend(session.backend)

    // Select effect
    await page.evaluate((id) => {
      const select = document.getElementById('effect-select') as HTMLSelectElement
      if (select) { select.value = id; select.dispatchEvent(new Event('change')) }
    }, effectId)

    await page.waitForFunction(() => {
      const s = document.getElementById('status')
      const t = (s?.textContent || '').toLowerCase()
      return t.includes('loaded') || t.includes('compiled') || t.includes('ready') || t.includes('error')
    }, { timeout: session.timeoutMs })

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
      if (!backend?.gl && !(backend?.readPixels && backend?.textures)) {
        return { status: 'error', isFilterEffect: false, similarity: null, backend: backendName, details: `No readable pixels on ${backendName} backend` }
      }

      // Check if filter effect (has inputTex in passes)
      const passes = pipeline.graph?.passes || []
      const isFilter = passes.some((p: any) => {
        const inputs = p.inputs || {}
        return Object.values(inputs).some((v: any) => String(v).includes('input'))
      })

      if (!isFilter) return { status: 'skipped', isFilterEffect: false, similarity: null, details: 'Not a filter effect' }

      // Read the rendered frame through the backend. WebGL2 reads the default
      // framebuffer synchronously; a backend without a GL context (WebGPU)
      // reads the offscreen render surface through its async texture reader —
      // the same surface and candidate fallback the parity capture uses.
      async function readFrame(t: number): Promise<{ pixels: Uint8Array; width: number; height: number } | null> {
        renderer.render(t)
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
          const surf = pipeline.graph?.renderSurface
          if (!surf) return null
          const candidates = ['global_' + surf + '_read']
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

      // Render two frames at different times and compare
      const frame0 = await readFrame(0)
      const frame1 = await readFrame(1.0)
      if (!frame0 || !frame1) {
        return { status: 'error', isFilterEffect: true, similarity: null, backend: backendName, details: `Failed to read pixels on ${backendName}` }
      }
      const pixels0 = frame0.pixels, pixels1 = frame1.pixels
      const width = frame0.width, height = frame0.height

      // Compare output at two times
      const pixelCount = width * height
      const stride = Math.max(1, Math.floor(pixelCount / 1000))
      let diffSum = 0, samples = 0
      const colors = new Set<string>()

      for (let i = 0; i < pixelCount; i += stride) {
        const idx = i * 4
        diffSum += Math.abs(pixels0[idx] - pixels1[idx]) +
          Math.abs(pixels0[idx + 1] - pixels1[idx + 1]) +
          Math.abs(pixels0[idx + 2] - pixels1[idx + 2])
        colors.add(`${pixels0[idx]},${pixels0[idx + 1]},${pixels0[idx + 2]}`)
        samples++
      }

      const temporalDiff = diffSum / (samples * 3 * 255)
      const uniqueColors = colors.size
      // An effect that modifies input should either vary over time or produce varied output
      const isModifying = temporalDiff > 0.01 || uniqueColors > 5

      return {
        status: isModifying ? 'ok' : 'passthrough',
        isFilterEffect: true,
        temporalDiff,
        uniqueColors,
        details: isModifying ? 'Effect modifies input' : 'Effect may be passing through unchanged'
      }
    }, session.globals)

    return result
  })
}

export function registerTestNoPassthrough(server: McpServer): void {
  server.tool(
    'testNoPassthrough',
    'Check that filter effects change their input (>1% pixel difference).',
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
