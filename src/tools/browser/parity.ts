import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { BrowserSession, effectSelectionProblem } from '../../harness/browser-session.js'
import type { EffectSelectionResult, ParityResult } from '../../harness/types.js'
import { getConfig } from '../../config.js'
import { resolveEffectIds } from '../resolve-effects.js'
import { toolResult } from '../tool-result.js'

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

export const testPixelParitySchema = {
  effect_id: z.string().optional().describe('One effect ID, such as "synth/noise"'),
  effects: z.string().optional().describe('Comma-separated effect IDs'),
  epsilon: z.number().optional().default(1).describe('Allowed per-channel difference (0-255)'),
  seed: z.number().optional().default(42).describe('Random seed for reproducible noise'),
}

// Let the live render loop draw real frames so the backend/effect is fully warm
// before the paused capture. A freshly compiled effect needs a few real frames
// before a paused render(0) yields a complete frame — cold reads come back
// blank or partial (the source of the old non-deterministic 73%/100% numbers).
async function warmUp(session: BrowserSession, frames = 6): Promise<void> {
  const start = await session.page!.evaluate((globals: any) => {
    const w = window as any
    if (w[globals.setPaused]) w[globals.setPaused](false) // ensure the loop runs
    return (w[globals.frameCount] as number) || 0
  }, session.globals)
  await session.page!.waitForFunction(
    ({ globals, target }: any) => (((window as any)[globals.frameCount] as number) || 0) >= target,
    { globals: session.globals, target: start + frames },
    { timeout: 30000, polling: 30 }
  )
}

// Capture the rendered frame by reading the OFFSCREEN render surface that
// pipeline.render() presents (`global_<renderSurface>_read`, falling back to the
// last node output). Reading the offscreen texture — not the canvas / default
// framebuffer — is the key reliability fix: when paused/headless the WebGL2
// present blit to the canvas does not commit, so canvas readback (gl.readPixels
// OR drawImage) returns a blank/partial buffer, while the offscreen surface
// holds the true render. Both ping-pong buffers carry the rendered content, so
// the _read buffer is read deterministically. WebGPU readback is bottom-up, so
// its rows are flipped to top-down to match WebGL2 (which flips internally) —
// both end up in screen orientation, the same normalization the old canvas
// capture used, keeping the comparison + Y-flip detector below valid.
async function captureSurface(
  session: BrowserSession,
  seed: number,
): Promise<{ data: number[]; width: number; height: number } | null> {
  return await session.page!.evaluate(async ({ globals, seed }) => {
    const w = window as any
    if (w[globals.setPaused]) w[globals.setPaused](true)
    if (w[globals.setPausedTime]) w[globals.setPausedTime](0)
    const p = w[globals.renderingPipeline]
    if (!p) return null
    if (p.globalUniforms) p.globalUniforms.seed = seed
    for (const pass of (p.graph?.passes || [])) if (pass.uniforms) pass.uniforms.seed = seed
    const r = w[globals.canvasRenderer]
    const b = p.backend
    if (!r || !b || !b.readPixels || !b.textures) return null
    const surf = p.graph?.renderSurface
    if (!surf) return null

    const readSurface = async () => {
      const candidates = ['global_' + surf + '_read']
      try {
        const nodes: string[] = []
        for (const k of b.textures.keys()) if (/node_\d+_out/.test(k)) nodes.push(k)
        nodes.sort((a: string, c: string) => parseInt(a.match(/node_(\d+)/)![1], 10) - parseInt(c.match(/node_(\d+)/)![1], 10))
        if (nodes.length) candidates.push(nodes[nodes.length - 1])
      } catch (e) { /* textures map not iterable */ }
      for (const id of candidates) {
        try {
          const px = await b.readPixels(id)
          if (px && px.width && px.height && px.data) return px
        } catch (e) { /* try next candidate */ }
      }
      return null
    }

    let px: any = null
    for (let attempt = 0; attempt < 6 && !px; attempt++) {
      r.render(0); r.render(0)
      px = await readSurface()
      if (!px) await new Promise(res => setTimeout(res, 80))
    }
    if (!px) return null

    let data: Uint8Array = px.data
    if (!b.gl) {
      // WebGPU readback is bottom-up; flip to top-down to match WebGL2.
      const flipped = new Uint8Array(px.width * px.height * 4)
      const rowBytes = px.width * 4
      for (let y = 0; y < px.height; y++) {
        flipped.set(data.subarray((px.height - 1 - y) * rowBytes, (px.height - y) * rowBytes), y * rowBytes)
      }
      data = flipped
    }
    return { data: Array.from(data), width: px.width, height: px.height }
  }, { globals: session.globals, seed })
}

export async function testPixelParity(
  session: BrowserSession,
  effectId: string,
  options: { epsilon?: number; seed?: number } = {},
): Promise<ParityResult> {
  const epsilon = options.epsilon ?? 1
  const seed = options.seed ?? 42

  // Each leg must confirm the request on the page (issue #34): the backend
  // switch actually takes effect, and the selection completes only when the
  // page finished building this effect after it was selected.
  const parityError = (leg: string, problem: string, backend: string, effectId2: string | null, resolution: [number, number]): ParityResult => ({
    status: 'error',
    maxDiff: 0,
    meanDiff: 0,
    mismatchCount: 0,
    mismatchPercent: 0,
    resolution,
    details: `${leg}: ${problem}`,
    ...(effectId2 ? { effect_id: effectId2 } : {}),
    ...(backend !== 'unknown' ? { backend } : {}),
  })
  const legProblem = (selection: EffectSelectionResult, requestedBackend: 'webgl2' | 'webgpu'): string | null =>
    effectSelectionProblem(selection, effectId, requestedBackend)

  // Capture with WebGL2
  try {
    await session.setBackend('webgl2')
  } catch (err) {
    // Bind even this failure to what the page actually holds (issue #34).
    const failed = await session.readPageIdentity()
    return parityError('WebGL2 leg', `Backend switch failed: ${errorMessage(err)}`, failed.backend ?? 'unknown', failed.effectId, [0, 0])
  }
  let leg: EffectSelectionResult = await session.selectEffect(effectId)
  let problem = legProblem(leg, 'webgl2')
  if (problem) return parityError('WebGL2 leg', problem, leg.backend, leg.effectId, [0, 0])
  await warmUp(session)
  const glslPixels = await captureSurface(session, seed)

  if (!glslPixels) {
    return parityError('WebGL2 leg', 'Failed to capture WebGL2', leg.backend, leg.effectId, [0, 0])
  }

  // Switch to WebGPU and capture. Re-select the effect after the backend switch
  // so uniforms re-initialize from effect defaults under the new backend;
  // otherwise WebGL2-side state leaks and we compare drifted uniforms.
  try {
    await session.setBackend('webgpu')
  } catch (err) {
    // Bind even this failure to what the page actually holds (issue #34).
    const failed = await session.readPageIdentity()
    return parityError('WebGPU leg', `Backend switch failed: ${errorMessage(err)}`, failed.backend ?? 'unknown', failed.effectId ?? leg.effectId, [glslPixels.width, glslPixels.height])
  }
  leg = await session.selectEffect(effectId)
  problem = legProblem(leg, 'webgpu')
  if (problem) return parityError('WebGPU leg', problem, leg.backend, leg.effectId, [glslPixels.width, glslPixels.height])
  await warmUp(session)
  const wgslPixels = await captureSurface(session, seed)

  // Resume
  await session.page!.evaluate((globals) => {
    const w = window as any
    if (w[globals.setPaused]) w[globals.setPaused](false)
  }, session.globals)

  if (!wgslPixels) {
    return parityError('WebGPU leg', 'Failed to capture WebGPU', leg.backend, leg.effectId, [glslPixels.width, glslPixels.height])
  }

  // Guard against comparing mismatched capture dimensions (would corrupt the
  // per-channel diff and Y-flip loops by indexing past the smaller buffer).
  // The result still reports the final leg's page-confirmed identity (issue
  // #34): every browser result binds to the page.
  if (glslPixels.width !== wgslPixels.width || glslPixels.height !== wgslPixels.height) {
    return {
      status: 'error', maxDiff: 0, meanDiff: 0, mismatchCount: 0, mismatchPercent: 0,
      resolution: [glslPixels.width, glslPixels.height],
      ...(leg.effectId ? { effect_id: leg.effectId } : {}),
      ...(leg.backend !== 'unknown' ? { backend: leg.backend } : {}),
      details: `Capture size mismatch: glsl ${glslPixels.width}x${glslPixels.height} vs wgsl ${wgslPixels.width}x${wgslPixels.height}`,
    }
  }

  // Compare pixels
  let maxDiff = 0
  let totalDiff = 0
  let mismatchCount = 0
  const totalChannels = glslPixels.data.length

  for (let i = 0; i < totalChannels; i++) {
    const diff = Math.abs(glslPixels.data[i] - wgslPixels.data[i])
    if (diff > maxDiff) maxDiff = diff
    totalDiff += diff
    if (diff > epsilon) mismatchCount++
  }

  const meanDiff = totalDiff / totalChannels
  const mismatchPercent = (mismatchCount / totalChannels) * 100
  const w = glslPixels.width, h = glslPixels.height

  // Solid color detection: check variance for each backend
  function checkSolid(pixels: { data: number[], width: number, height: number }, label: string) {
    const n = pixels.width * pixels.height
    let rS = 0, gS = 0, bS = 0
    for (let i = 0; i < pixels.data.length; i += 4) { rS += pixels.data[i]; gS += pixels.data[i+1]; bS += pixels.data[i+2] }
    const rM = rS/n, gM = gS/n, bM = bS/n
    let rV = 0, gV = 0, bV = 0
    for (let i = 0; i < pixels.data.length; i += 4) {
      rV += (pixels.data[i]-rM)**2; gV += (pixels.data[i+1]-gM)**2; bV += (pixels.data[i+2]-bM)**2
    }
    rV /= n; gV /= n; bV /= n
    const isSolid = rV < 5 && gV < 5 && bV < 5
    return { label, isSolid, variance: [Math.round(rV), Math.round(gV), Math.round(bV)], mean: [Math.round(rM), Math.round(gM), Math.round(bM)] }
  }

  const glslSolid = checkSolid(glslPixels, 'glsl')
  const wgslSolid = checkSolid(wgslPixels, 'wgsl')

  // Y-flip detection.
  //
  // Compare GLSL against a VERTICALLY FLIPPED WGSL using BOTH a continuous
  // metric (mean absolute difference) and the thresholded channel count.
  // The count metric alone (diff > epsilon) is too noisy for noise fields and
  // its old `< mismatchPercent * 0.5` cutoff missed real inversions that also
  // carried minor coord/aspect differences. The MAD ratio is the reliable
  // signal: if flipping WGSL makes the average per-channel difference
  // substantially smaller than the un-flipped comparison, the render is
  // vertically inverted (fully or partially) between the two backends.
  let yFlipMismatch = 0
  let yFlipTotalDiff = 0
  const rowBytes = w * 4
  for (let y = 0; y < h; y++) {
    const glslRow = y
    const wgslFlippedRow = h - 1 - y
    for (let x = 0; x < rowBytes; x++) {
      const diff = Math.abs(glslPixels.data[glslRow * rowBytes + x] - wgslPixels.data[wgslFlippedRow * rowBytes + x])
      yFlipTotalDiff += diff
      if (diff > epsilon) yFlipMismatch++
    }
  }
  const yFlipPercent = (yFlipMismatch / totalChannels) * 100
  const yFlipMeanDiff = yFlipTotalDiff / totalChannels

  // meanDiff = average abs diff of the NORMAL (un-flipped) comparison.
  // Ratio < 1 means flipping improves the match. A real Y-flip drives the
  // flipped MAD far below the normal MAD; uncorrelated noise gives ratio ~1.
  const yFlipRatio = meanDiff > 0 ? yFlipMeanDiff / meanDiff : 1
  const isYFlipped =
    meanDiff > 2 &&                       // there is a real difference to explain
    yFlipMeanDiff < meanDiff &&           // flipping must actually help
    yFlipRatio < 0.7                      // and help substantially (>=30% lower MAD)
  const isCleanYFlip = meanDiff > 2 && yFlipRatio < 0.25

  const issues: string[] = []
  if (glslSolid.isSolid) issues.push(`GLSL SOLID COLOR (mean=${glslSolid.mean})`)
  if (wgslSolid.isSolid) issues.push(`WGSL SOLID COLOR (mean=${wgslSolid.mean})`)
  if (isYFlipped) {
    issues.push(
      `${isCleanYFlip ? 'Y-FLIP' : 'PARTIAL Y-FLIP'} DETECTED ` +
      `(flipped meanDiff=${yFlipMeanDiff.toFixed(2)} vs normal meanDiff=${meanDiff.toFixed(2)}, ` +
      `ratio=${yFlipRatio.toFixed(2)}, flip mismatch=${yFlipPercent.toFixed(1)}% vs normal=${mismatchPercent.toFixed(1)}%)`
    )
  }

  const status = mismatchPercent < 1 ? 'ok' : 'mismatch'

  return {
    status,
    maxDiff,
    meanDiff: Math.round(meanDiff * 100) / 100,
    mismatchCount,
    mismatchPercent: Math.round(mismatchPercent * 100) / 100,
    resolution: [w, h],
    // Page-confirmed identity of the final (WebGPU) leg (issue #34).
    ...(leg.effectId ? { effect_id: leg.effectId } : {}),
    ...(leg.backend !== 'unknown' ? { backend: leg.backend } : {}),
    glslSolid: glslSolid.isSolid,
    wgslSolid: wgslSolid.isSolid,
    glslVariance: glslSolid.variance,
    wgslVariance: wgslSolid.variance,
    yFlipDetected: isYFlipped,
    yFlipCleanFlip: isCleanYFlip,
    yFlipMismatchPercent: Math.round(yFlipPercent * 100) / 100,
    yFlipMeanDiff: Math.round(yFlipMeanDiff * 100) / 100,
    yFlipRatio: Math.round(yFlipRatio * 1000) / 1000,
    issues,
    details: issues.length > 0
      ? issues.join('; ')
      : mismatchPercent < 1
        ? `Pixel parity OK (maxDiff=${maxDiff}, meanDiff=${meanDiff.toFixed(2)})`
        : `Pixel mismatch: ${mismatchPercent.toFixed(1)}% channels differ by >${epsilon}`
  }
}

export function registerTestPixelParity(server: McpServer): void {
  server.tool(
    'testPixelParity',
    'Render with both WebGL2 and WebGPU. Compare the output pixel by pixel within the epsilon tolerance.',
    testPixelParitySchema,
    async (args: any) => {
      const config = getConfig()
      const effectIds = resolveEffectIds(args, config.effectsDir)
      const session = new BrowserSession({ backend: 'webgl2' })
      try {
        await session.setup()
        const results = []
        for (const id of effectIds) {
          try {
            results.push({ effect_id: id, ...await testPixelParity(session, id, { epsilon: args.epsilon, seed: args.seed }) })
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
