// Examples only: compile and render the eleven adapted scenes through the Noisemaker runtime.
// This script never runs library symbol probes or updates reference images.
// Hardware qualification is the default; CI can explicitly request --software.
// Cross-backend output may differ by one 8-bit attachment quantization level; any larger drift fails.
// Usage: NOISEMAKER=/path/to/noisemaker node scripts/craft-examples-parity.mjs --out /private/tmp/craft-examples [--only terrain,ocean]
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, isAbsolute, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/** Parse verification mode without launching a browser. Software rendering must be explicit. */
export function parseExampleParityOptions(args, softwareEnvironment = ['1', 'true'].includes(process.env.SHADE_SWIFTSHADER)) {
  const option = name => args.includes(name) ? args[args.indexOf(name) + 1] : undefined
  const software = args.includes('--software')
  if (softwareEnvironment && !software) throw new Error('Software rendering requires explicit --software; default qualification requires a real GPU')
  const out = option('--out')
  if (!out || !isAbsolute(out)) throw new Error('--out must name an absolute evidence directory')
  return { out, software, only: option('--only')?.split(',') }
}

/** One 8-bit attachment level is the ceiling, independent of which pixels a GPU rounds. */
export function compareExamplePixels(a, b) {
  if (a.length !== b.length) throw new Error('Pixel dimensions differ')
  let maxByteDifference = 0, sum = 0, differingChannels = 0
  for (let i = 0; i < a.length; i++) {
    const difference = Math.abs(a[i] - b[i])
    maxByteDifference = Math.max(maxByteDifference, difference)
    sum += difference
    differingChannels += Number(difference !== 0)
  }
  return { pass: maxByteDifference <= 1, maxByteDifference, meanByteDifference: sum / a.length, differingChannels, channels: a.length }
}

async function main() {
  const { SHADER_CRAFT_EXAMPLES } = await import('../dist/knowledge/shader-craft.js')
  const { BrowserSession, getServerUrl } = await import('../dist/harness/index.js')
  const { out, software, only } = parseExampleParityOptions(process.argv.slice(2))
  if (software) process.env.SHADE_SWIFTSHADER = '1'
  const NM = process.env.NOISEMAKER
  if (!NM || !existsSync(`${NM}/shaders/src/index.js`)) throw new Error('Set NOISEMAKER to the runtime checkout')
  mkdirSync(out, { recursive: true })
  const examples = SHADER_CRAFT_EXAMPLES.filter(e => !only || only.includes(e.id))
  if (!examples.length || only?.some(id => !examples.some(e => e.id === id))) throw new Error('Unknown example selector')
  const width = 192, height = 128, seed = 42, times = [0, 0.25, 1]
  const report = { width, height, seed, times, software, comparisonPolicy: { maxByteDifference: 1, reason: "One 8-bit output attachment quantization level; all differing channel counts and means remain reported." }, backends: {}, comparisons: [], failures: [] }
  const pixels = {}
  for (const backend of ['webgl2', 'webgpu']) {
    const session = new BrowserSession({ backend, blankPage: true, viewerRoot: NM, effectsDir: `${NM}/shaders/effects` })
    pixels[backend] = {}
    try {
      await session.setup()
      const page = session.page, base = getServerUrl()
      const errors = []
      page.on('console', event => { if (event.type() === 'error') errors.push(event.text()) })
      page.on('pageerror', error => errors.push(error.message))
      await page.route(`${base}/craft-examples.js`, route => route.fulfill({ contentType: 'text/javascript', body: readFileSync(new URL('../dist/knowledge/shader-craft.js', import.meta.url), 'utf8') }))
      const renderer = await page.evaluate(async ({ base, backend, width, height }) => {
        window.craftExamplesAPI = await import(`${base}/craft-examples.js`)
        const { CanvasRenderer } = await import(`${base}/shaders/src/index.js`)
        const canvas = document.createElement('canvas')
        canvas.width = width; canvas.height = height; document.body.append(canvas)
        const renderer = new CanvasRenderer({ canvas, width, height, basePath: `${base}/shaders`, bundlePath: `${base}/shaders/effects`, useBundles: false, preferWebGPU: backend === 'webgpu' })
        await renderer.loadManifest()
        window.craftExampleRenderer = renderer
        window.craftExampleCanvas = canvas
        if (backend === 'webgpu') {
          const adapter = await navigator.gpu?.requestAdapter()
          return [adapter?.info?.vendor, adapter?.info?.architecture, adapter?.info?.description].filter(Boolean).join(' ')
        }
        const gl = document.createElement('canvas').getContext('webgl2')
        const ext = gl?.getExtension('WEBGL_debug_renderer_info')
        return String(gl?.getParameter(ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER))
      }, { base, backend, width, height })
      if (!renderer || (!software && /swiftshader|llvmpipe|software/i.test(renderer))) throw new Error(`Real GPU unavailable: ${renderer}`)
      report.backends[backend] = { renderer, examples: [] }
      console.log(`${backend}: ${renderer}; examples only (${examples.length})`)
      for (const example of examples) {
        const start = Date.now(), errorStart = errors.length
        const result = await page.evaluate(async ({ id, backend, seed, times }) => {
          try {
            const pkg = window.craftExamplesAPI.getShaderCraftExample(id)
            const renderer = window.craftExampleRenderer
            const language = backend === 'webgpu' ? 'wgsl' : 'glsl'
            await renderer.registerPortableEffect({ ...pkg.definition, shaders: { [pkg.example.func]: { [language]: pkg.shaders[language].source } } })
            await renderer.compile(`search user\n${pkg.example.func}(seed: ${seed}).write(o0)\nrender(o0)`)
            renderer.stop()
            const pipeline = renderer.pipeline
            if (pipeline.backend.getName().toLowerCase() !== backend) throw new Error('Backend fallback')
            const frames = []
            for (const time of times) {
              const frame = renderer.frameCount
              renderer.render(time)
              if (renderer.frameCount !== frame + 1) throw new Error('Render did not advance')
              const canvas = window.craftExampleCanvas
              const copy = new OffscreenCanvas(canvas.width, canvas.height)
              const context = copy.getContext('2d')
              context.drawImage(canvas, 0, 0)
              const displayed = context.getImageData(0, 0, canvas.width, canvas.height).data
              await pipeline.backend.device?.queue.onSubmittedWorkDone()
              const raw = await pipeline.backend.readPixels(pipeline.surfaces.get('o0').read)
              const data = raw.data instanceof Uint8Array ? raw.data : Uint8Array.from(raw.data, value => Math.round(Math.max(0, Math.min(1, value)) * 255))
              let identityError = 0, flippedError = 0
              for (let y = 0; y < raw.height; y++) for (let x = 0; x < raw.width * 4; x++) {
                identityError += Math.abs(displayed[y * raw.width * 4 + x] - data[y * raw.width * 4 + x])
                flippedError += Math.abs(displayed[y * raw.width * 4 + x] - data[(raw.height - 1 - y) * raw.width * 4 + x])
              }
              frames.push({ time, width: raw.width, height: raw.height, nativeReadbackFlipY: flippedError < identityError,
                pixels: Array.from(displayed), nativePixels: Array.from(data) })
            }
            return { ok: true, added: pkg.shaders[language].added, credits: pkg.shaders[language].credits, frames }
          } catch (error) { return { ok: false, error: [error.message, error.detail].filter(Boolean).join('\n') } }
        }, { id: example.id, backend, seed, times })
        result.milliseconds = Date.now() - start
        result.errors = errors.slice(errorStart)
        if (!result.ok) {
          report.failures.push(`${backend} ${example.id}: ${result.error}`)
          console.error(`FAIL ${backend} ${example.id}: ${result.error}`)
        } else {
          pixels[backend][example.id] = result.frames
          for (const frame of result.frames) {
            const data = Buffer.from(frame.pixels)
            writeFileSync(join(out, `${backend}-${example.id}-${frame.time}.native.rgba`), Buffer.from(frame.nativePixels))
            writeFileSync(join(out, `${backend}-${example.id}-${frame.time}.rgba`), data)
            const rgb = Buffer.alloc(width * height * 3)
            for (let i = 0; i < width * height; i++) data.copy(rgb, i * 3, i * 4, i * 4 + 3)
            writeFileSync(join(out, `${backend}-${example.id}-${frame.time}.ppm`), Buffer.concat([Buffer.from(`P6\n${width} ${height}\n255\n`), rgb]))
            const unique = new Set(Array.from({ length: width * height }, (_, i) => data.readUInt32LE(i * 4)))
            if (unique.size < 16) report.failures.push(`${backend} ${example.id} time=${frame.time}: only ${unique.size} colors`)
          }
          const first = result.frames[0].pixels, last = result.frames.at(-1).pixels
          const loopDifference = Math.max(...first.map((v, i) => Math.abs(v - last[i])))
          result.loopDifference = loopDifference
          result.nativeReadbackFlipY = result.frames[0].nativeReadbackFlipY
          if (loopDifference) report.failures.push(`${backend} ${example.id}: loop endpoint difference ${loopDifference}/255`)
          await page.locator('canvas').first().screenshot({ path: join(out, `${backend}-${example.id}.png`) })
          console.log(`OK ${backend} ${example.id}: ${result.milliseconds}ms; ${result.added.length} bundled symbols; loop difference ${loopDifference}/255`)
          delete result.frames
        }
        report.backends[backend].examples.push({ id: example.id, ...result })
      }
      writeFileSync(join(out, `${backend}-console.json`), JSON.stringify(errors, null, 2))
      await page.evaluate(async () => { await window.craftExampleRenderer.dispose() })
    } finally { await session.teardown() }
  }
  for (const example of examples) {
    const gl = pixels.webgl2[example.id], gpu = pixels.webgpu[example.id]
    if (!gl || !gpu) continue
    for (let f = 0; f < times.length; f++) {
      const a = gl[f].pixels, b = gpu[f].pixels
      const comparison = compareExamplePixels(a, b)
      report.comparisons.push({ id: example.id, time: times[f], ...comparison })
      console.log(`COMPARE ${example.id} time=${times[f]}: max ${comparison.maxByteDifference}/255; mean ${comparison.meanByteDifference.toPrecision(5)}/255; ${comparison.differingChannels}/${a.length} channels differ`)
      if (!comparison.pass) report.failures.push(`${example.id} time=${times[f]}: cross-backend drift ${comparison.maxByteDifference}/255 exceeds one output quantization level`)

    }
  }
  writeFileSync(join(out, 'results.json'), JSON.stringify(report, null, 2))
  if (report.failures.length) { console.error(report.failures.join('\n')); process.exit(1) }
  console.log('All selected examples compiled, rendered and closed their loops on both backends. Cross-backend differences are measurements, not a claim of exact parity.')
  process.exit(0)

}
if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) await main()
