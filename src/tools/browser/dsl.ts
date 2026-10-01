import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { BrowserSession } from '../../harness/browser-session.js'
import { getServerUrl } from '../../harness/server-manager.js'
import { computeImageMetrics } from '../../harness/pixel-reader.js'
import { toolResult } from '../tool-result.js'
import { getConfig } from '../../config.js'
import { resolveEffectIds } from '../resolve-effects.js'

const resolution = z.tuple([z.number().int().min(1).max(1920), z.number().int().min(1).max(1080)])
const frames = z.array(z.number().int().min(1).max(1200)).min(1).max(6)
  .refine(values => values.every((value, index) => index === 0 || value > values[index - 1]),
    'Capture frames must be strictly increasing')

export const runDslProgramSchema = {
  dsl: z.string().min(1).max(100_000).describe('Noisemaker DSL program'),
  effects: z.string().min(1).max(4096)
    .refine(value => value.split(',').every(id => /^[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*$/.test(id.trim())), 'Invalid authored effect ID')
    .refine(value => value.split(',').length <= 16, 'Select at most 16 authored effects')
    .optional().describe('Comma-separated Portable package IDs under SHADE_EFFECTS_DIR; omitted means built-in effects only'),
  backend: z.enum(['webgl2', 'webgpu']).default('webgl2').describe('Rendering backend'),
  warmup_frames: z.number().int().min(0).max(120).default(10).describe('Frames before the first capture frame'),
  frames: frames.default([1, 120, 600]).describe('Frames to capture after warmup'),
  resolution: resolution.default([960, 540]).describe('Full rendering resolution [width, height]'),
  cell_resolution: resolution.default([320, 180]).describe('Contact-sheet cell resolution [width, height]'),
  // Retained for callers of the old one-frame tool. The grid is always sent
  // as MCP image content, regardless of this legacy flag.
  capture_image: z.boolean().optional().describe('Legacy option; the grid is always returned as an image'),
  uniforms: z.record(z.string(), z.number().finite()).optional().describe('Values that override uniforms'),
}

type Capture = { surface: string; frame: number; width: number; height: number; pixels: string }
type BatchResult = {
  status: 'ok' | 'error'
  error?: string
  backend?: string
  surfaces?: string[]
  render_target?: string
  captures?: Capture[]
  image_data?: string
  grid?: { width: number; height: number; cell_width: number; cell_height: number; rows: string[]; columns: number[] }
  console_errors?: string[]
}

export async function runDslProgram(
  session: BrowserSession,
  dsl: string,
  options: {
    effects?: string
    warmupFrames?: number
    frames?: number[]
    resolution?: [number, number]
    cellResolution?: [number, number]
    captureImage?: boolean
    uniforms?: Record<string, number>
  } = {},
): Promise<any> {
  const input = z.object(runDslProgramSchema).parse({
    dsl, effects: options.effects, backend: session.backend, warmup_frames: options.warmupFrames,
    frames: options.frames, resolution: options.resolution,
    cell_resolution: options.cellResolution, uniforms: options.uniforms,
  })
  const captureFrames = input.frames
  const [width, height] = input.resolution
  const [cellWidth, cellHeight] = input.cell_resolution
  const warmupFrames = input.warmup_frames
  const config = getConfig()
  const effectIds = input.effects ? [...new Set(resolveEffectIds({ effects: input.effects }, config.effectsDir))] : []
  if (width * height * captureFrames.length > 16_000_000) {
    throw new Error('Requested captures exceed the 16 million pixel batch limit')
  }
  if (cellWidth * cellHeight * captureFrames.length > 4_000_000) {
    throw new Error('Contact sheet exceeds the 4 million pixel limit')
  }
  return session.runWithConsoleCapture(async () => {
    const page = session.page!
    // page.evaluate is not governed by Playwright's default page timeout. A
    // timed-out call closes its private browser in the tool's finally block.
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      const batch = await Promise.race<BatchResult>([
        page.evaluate(async ({ rendererModule, assetsBase, useBundles, effectUrls, dsl, backend, width, height, cellWidth, cellHeight, captureFrames, warmupFrames, uniforms }) => {
          const { CanvasRenderer, compile } = await import(rendererModule)
          const canvas = document.createElement('canvas')
          canvas.width = width
          canvas.height = height
          document.body.appendChild(canvas)
          let renderFailure: string | null = null
          const renderer = new CanvasRenderer({
            canvas, width, height, basePath: assetsBase,
            bundlePath: `${assetsBase}/effects`, useBundles,
            preferWebGPU: backend === 'webgpu',
            onError: (error: any) => { renderFailure = error?.message || String(error) },
          })
          try {
            const manifest = await renderer.loadManifest()
            await renderer.loadEffects(Object.keys(manifest))
            if (effectUrls.length && typeof renderer.registerPortableEffect !== 'function') {
              throw new Error('Configured Noisemaker renderer does not support registerPortableEffect; use a qualified renderer with authored-effect registration')
            }
            for (const baseUrl of effectUrls) {
              const definitionUrl = `${baseUrl}/definition.json`
              const response = await fetch(definitionUrl)
              if (!response.ok) throw new Error(`${definitionUrl}: HTTP ${response.status}`)
              const definition = await response.json()
              if (!Array.isArray(definition?.passes) || definition.passes.length === 0) {
                throw new Error(`Portable effect ${baseUrl}: passes must be a nonempty array`)
              }
              // Keep the raw Portable definition: the analysis parser intentionally
              // omits render metadata, enum paths, and some pass attributes.
              definition.shaders = Object.create(null)
              const language = backend === 'webgpu' ? 'wgsl' : 'glsl'
              for (const pass of definition.passes) {
                const program = pass?.program
                if (typeof program !== 'string' || !/^[A-Za-z0-9_-]+$/.test(program)) {
                  throw new Error(`Portable effect ${baseUrl}: invalid pass program`)
                }
                if (definition.shaders[program]) continue
                const url = `${baseUrl}/${language}/${program}.${language}`
                const source = await fetch(url)
                if (!source.ok) throw new Error(`${url}: HTTP ${source.status}`)
                definition.shaders[program] = { [language]: await source.text() }
              }
              await renderer.registerPortableEffect(definition)
            }
            await renderer.compile(dsl)
            renderer.stop()

            const pipeline = renderer.pipeline
            const actualBackend = pipeline.backend.getName?.() || 'unknown'
            if (actualBackend.toLowerCase() !== backend) {
              throw new Error(`Requested backend ${backend}, renderer used ${actualBackend}`)
            }
            const compiled = compile(dsl)
            const written = new Set<string>()
            const visit = (value: any): void => {
              if (!value || typeof value !== 'object') return
              if (value.write?.kind === 'output' && typeof value.write.name === 'string') written.add(value.write.name)
              for (const [key, child] of Object.entries(value)) {
                if (key !== 'write') {
                  if (Array.isArray(child)) child.forEach(visit)
                  else if (typeof child === 'object') visit(child)
                }
              }
            }
            visit(compiled.plans)
            const renderTarget = pipeline.graph?.renderSurface || compiled.render
            if (renderTarget) written.add(renderTarget)
            const surfaces = [...written].sort()
            if (surfaces.length === 0) throw new Error('Program writes no output surfaces')
            if (width * height * captureFrames.length * surfaces.length > 16_000_000) {
              throw new Error('Requested captures exceed the 16 million pixel batch limit')
            }
            for (const surface of surfaces) {
              if (!pipeline.surfaces.has(surface)) throw new Error(`Written surface ${surface} is missing from the renderer`)
            }

            if (uniforms) {
              for (const [name, value] of Object.entries(uniforms)) {
                if (pipeline.setUniform) pipeline.setUniform(name, value)
                else if (pipeline.globalUniforms) pipeline.globalUniforms[name] = value
              }
            }

            const cols = captureFrames.length
            const gap = 4, top = 24, left = 38
            const grid = document.createElement('canvas')
            grid.width = left + cols * (cellWidth + gap) + gap
            grid.height = top + surfaces.length * (cellHeight + gap) + gap
            if (grid.width * grid.height > 4_000_000) {
              throw new Error('Contact sheet exceeds the 4 million pixel limit')
            }
            const ctx = grid.getContext('2d')!
            ctx.fillStyle = '#202020'
            ctx.fillRect(0, 0, grid.width, grid.height)
            ctx.font = '14px sans-serif'
            ctx.fillStyle = 'white'
            captureFrames.forEach((frame: number, col: number) => ctx.fillText(`f${frame}`, left + gap + col * (cellWidth + gap), 17))
            surfaces.forEach((surface, row) => ctx.fillText(surface, 4, top + 18 + row * (cellHeight + gap)))
            const scratch = document.createElement('canvas')
            const scratchCtx = scratch.getContext('2d')!
            const captures: Capture[] = []
            const selectedFrames = new Set(captureFrames)
            const lastFrame = warmupFrames + captureFrames.at(-1)!
            for (let absoluteFrame = 1; absoluteFrame <= lastFrame; absoluteFrame++) {
              const previousFrame = renderer.frameCount
              renderer.render(((absoluteFrame / 60) % 10) / 10)
              if (renderFailure) throw new Error(`Render failed at frame ${absoluteFrame}: ${renderFailure}`)
              if (renderer.frameCount !== previousFrame + 1) {
                throw new Error(`Renderer did not advance at frame ${absoluteFrame}`)
              }
              const relativeFrame = absoluteFrame - warmupFrames
              if (!selectedFrames.has(relativeFrame)) continue
              await pipeline.backend.device?.queue.onSubmittedWorkDone()
              const col = captureFrames.indexOf(relativeFrame)
              for (let row = 0; row < surfaces.length; row++) {
                const surface = surfaces[row]
                const texture = pipeline.surfaces.get(surface)?.read
                if (!texture) throw new Error(`Written surface ${surface} has no readable texture`)
                const raw = await pipeline.backend.readPixels(texture)
                if (!raw || !raw.width || !raw.height || raw.data.length !== raw.width * raw.height * 4) {
                  throw new Error(`Invalid pixels for surface ${surface}`)
                }
                const pixels = raw.data instanceof Float32Array
                  ? Uint8Array.from(raw.data, (value: number) => Math.round(Math.max(0, Math.min(1, value)) * 255))
                  : raw.data
                if (!(pixels instanceof Uint8Array)) throw new Error(`Unsupported pixel type for surface ${surface}`)
                const image = new ImageData(new Uint8ClampedArray(pixels), raw.width, raw.height)
                scratch.width = raw.width
                scratch.height = raw.height
                scratchCtx.putImageData(image, 0, 0)
                const x = left + gap + col * (cellWidth + gap)
                const y = top + gap + row * (cellHeight + gap)
                ctx.fillStyle = '#555'
                ctx.fillRect(x, y, cellWidth, cellHeight)
                ctx.drawImage(scratch, x, y, cellWidth, cellHeight)
                let binary = ''
                for (let offset = 0; offset < pixels.length; offset += 0x8000) {
                  binary += String.fromCharCode(...pixels.subarray(offset, offset + 0x8000))
                }
                captures.push({ surface, frame: relativeFrame, width: raw.width, height: raw.height, pixels: btoa(binary) })
              }
            }
            return {
              status: 'ok' as const,
              backend: actualBackend,
              surfaces,
              render_target: renderTarget,
              captures,
              image_data: grid.toDataURL('image/png').split(',')[1],
              grid: { width: grid.width, height: grid.height, cell_width: cellWidth, cell_height: cellHeight, rows: surfaces, columns: captureFrames },
            }
          } catch (error: any) {
            return { status: 'error' as const, error: error?.message || error?.detail || JSON.stringify(error) || String(error) }
          } finally {
            await renderer.dispose().catch(() => {})
            canvas.remove()
          }
        }, {
          rendererModule: config.dslRendererModule.startsWith('/') ? `${getServerUrl()}${config.dslRendererModule}` : config.dslRendererModule,
          assetsBase: config.dslAssetsBase.startsWith('/') ? `${getServerUrl()}${config.dslAssetsBase}` : config.dslAssetsBase,
          useBundles: config.dslUseBundles,
          effectUrls: effectIds.map(id => `${getServerUrl()}/effects/${id}`),
          dsl, backend: session.backend, width, height,
          cellWidth, cellHeight, captureFrames, warmupFrames, uniforms: options.uniforms,
        }) as Promise<BatchResult>,
        new Promise<BatchResult>((_, reject) => {
          timer = setTimeout(() => reject(new Error(`DSL batch timed out after ${session.timeoutMs} ms`)), session.timeoutMs)
        }),
      ])
      if (batch.status === 'error') return batch
      const captures = (batch.captures || []).map(({ pixels, ...capture }) => ({
        ...capture,
        metrics: computeImageMetrics(Buffer.from(pixels, 'base64'), capture.width, capture.height),
      }))
      const finalCapture = captures.find(capture =>
        capture.surface === batch.render_target && capture.frame === captureFrames.at(-1)) || captures.at(-1)
      return {
        status: 'ok', backend: batch.backend, resolution: { width, height },
        warmup_frames: warmupFrames, frames: captureFrames, surfaces: batch.surfaces,
        render_target: batch.render_target, captures, grid: batch.grid,
        frame: finalCapture ? { width: finalCapture.width, height: finalCapture.height, image_uri: null } : undefined,
        metrics: finalCapture?.metrics,
        image_data: batch.image_data,
      }
    } finally {
      if (timer) clearTimeout(timer)
    }
  })
}

export function registerRunDslProgram(server: McpServer): void {
  server.tool(
    'runDslProgram',
    'Compile Noisemaker DSL with optional authored Portable packages in a fresh renderer and return a multi-frame, per-surface PNG grid with metrics.',
    runDslProgramSchema,
    async (args: any) => {
      const session = new BrowserSession({ backend: args.backend, blankPage: true })
      try {
        await session.setup()
        const result = await runDslProgram(session, args.dsl, {
          effects: args.effects,
          warmupFrames: args.warmup_frames,
          frames: args.frames,
          resolution: args.resolution,
          cellResolution: args.cell_resolution,
          uniforms: args.uniforms,
        })
        const { image_data, ...metadata } = result
        return toolResult(metadata, image_data ? [{ data: image_data, mimeType: 'image/png' }] : [])
      } finally {
        await session.teardown()
      }
    },
  )
}
