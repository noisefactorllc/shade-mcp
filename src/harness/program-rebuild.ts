import type { ViewerGlobals } from './types.js'

/**
 * Page function (serialized by page.evaluate, so it stays self-contained):
 * give the page `window.__shadeRebuildProgram()`, which rebuilds the
 * renderer's current program into a fresh pipeline and resolves true, or
 * resolves false when the renderer cannot rebuild its program.
 *
 * A fresh pipeline holds no frame history and no feedback, temporal or
 * persistent texture contents, so a capture rendered from it starts from a
 * known state. The rebuild keeps what the page gave the old pipeline after
 * its own build:
 * - the uniform values that differ from the program's (the viewer's
 *   parameter values, a text or media size): global values through the
 *   pipeline's setUniform, which also resizes the textures a size value
 *   drives, then each pass's own values;
 * - the textures the page uploaded through the renderer (media and text
 *   inputs), recorded from here on and uploaded again from the same sources.
 * Install it before the selection whose uploads it must keep.
 */
export function installProgramRebuild({ globals, timeout }: { globals: ViewerGlobals; timeout: number }): boolean {
  const w = window as any
  const r = w[globals.canvasRenderer]
  if (!r || typeof r.dispose !== 'function' || typeof r.compile !== 'function') {
    w.__shadeRebuildProgram = undefined
    return false
  }
  if (!r.__shadeUploads && typeof r.updateTextureFromSource === 'function') {
    const uploads = new Map<string, { source: unknown; options: unknown }>()
    const upload = r.updateTextureFromSource
    r.updateTextureFromSource = function (texId: string, source: unknown, options?: unknown) {
      uploads.set(texId, { source, options })
      return upload.call(this, texId, source, options)
    }
    r.__shadeUploads = uploads
  }
  // Uniforms the pipeline writes on every frame: a rebuilt pipeline sets its own.
  const perFrame = new Set(['time', 'deltaTime', 'frame', 'resolution', 'tileOffset', 'fullResolution',
    'invFullResolution', 'aspect', 'aspectRatio', 'aspectInv', 'renderScale', 'audioSpectrum',
    'audioWaveform', 'midiClockCount'])
  const copy = (v: unknown) => (Array.isArray(v) ? v.slice() : v)
  const same = (a: unknown, b: unknown) =>
    a === b || (Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((x, i) => x === b[i]))
  w.__shadeRebuildProgram = async (): Promise<boolean> => {
    const program = r.currentDsl
    if (typeof program !== 'string' || program === '') return false
    const old = r.pipeline ?? w[globals.renderingPipeline]
    const savedGlobals = old?.globalUniforms
      ? Object.entries(old.globalUniforms).filter(([k]) => !perFrame.has(k)).map(([k, v]) => [k, copy(v)] as [string, unknown])
      : []
    const saved = (old?.graph?.passes || []).map((pass: any) => ({
      name: pass.name,
      uniforms: pass.uniforms ? Object.fromEntries(Object.entries(pass.uniforms).map(([k, v]) => [k, copy(v)])) : null,
    }))
    const oldTextures = old?.backend?.textures
    const reupload = r.__shadeUploads
      ? [...r.__shadeUploads].filter(([id]: [string, unknown]) => typeof oldTextures?.has === 'function' && oldTextures.has(id))
      : []
    await r.dispose({ loseContext: false, resetCanvas: false })
    await r.compile(program)
    const p = r.pipeline
    if (!p) throw new Error('Rebuilding the program produced no pipeline')
    // Keep the viewer's handle on the live pipeline.
    w[globals.renderingPipeline] = p
    for (const [key, value] of savedGlobals) {
      if (same(p.globalUniforms?.[key], value)) continue
      if (typeof p.setUniform === 'function') p.setUniform(key, copy(value))
      else if (p.globalUniforms) p.globalUniforms[key] = copy(value)
    }
    const passes = p.graph?.passes || []
    saved.forEach((s: any, i: number) => {
      const pass = passes[i]
      if (!pass || pass.name !== s.name || !pass.uniforms || !s.uniforms) return
      for (const [key, value] of Object.entries(s.uniforms)) {
        if (!perFrame.has(key) && !same(pass.uniforms[key], value)) pass.uniforms[key] = copy(value)
      }
    })
    for (const [id, { source, options }] of reupload) await r.updateTextureFromSource(id, source, options)
    if (typeof p.whenAsyncInitsSettled === 'function') {
      let timer: any
      await Promise.race([
        p.whenAsyncInitsSettled(),
        new Promise((resolve) => { timer = setTimeout(resolve, timeout) }),
      ])
      clearTimeout(timer)
    }
    return true
  }
  return true
}
