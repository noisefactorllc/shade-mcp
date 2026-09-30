// Drives the built MCP server against a real viewer and asserts the browser
// tools actually work end to end.
//
// The unit suite covers the harness in isolation with Playwright mocked, so it
// cannot catch a broken viewer configuration — the failure that motivated this
// script was a documented SHADE_VIEWER_ROOT that made every browser tool time
// out while every unit test stayed green.
//
// Usage: NOISEMAKER=/path/to/noisemaker node scripts/browser-smoke.mjs
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'

const NM = process.env.NOISEMAKER
if (!NM || !existsSync(`${NM}/demo/shaders/index.html`)) {
  console.error(`browser-smoke: set NOISEMAKER to a noisemaker checkout (got ${NM || 'unset'})`)
  process.exit(2)
}

const server = spawn('node', ['dist/index.js'], {
  stdio: ['pipe', 'pipe', 'inherit'],
  env: {
    ...process.env,
    SHADE_EFFECTS_DIR: `${NM}/shaders/effects`,
    SHADE_PROJECT_ROOT: NM,
    // The viewer page lives in demo/shaders but imports the engine from
    // shaders/src at the repository root, so the root is what gets served.
    SHADE_VIEWER_ROOT: NM,
    SHADE_VIEWER_PATH: '/demo/shaders/',
    SHADE_GLOBALS_PREFIX: '__noisemaker',
    SHADE_HEADLESS: '1',
  },
})

let buf = ''
let nextId = 0
const pending = new Map()
server.stdout.on('data', chunk => {
  buf += chunk
  let i
  while ((i = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, i)
    buf = buf.slice(i + 1)
    if (!line.trim()) continue
    try {
      const msg = JSON.parse(line)
      if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id) }
    } catch { /* not a protocol line */ }
  }
})

const rpc = (method, params) => new Promise((resolve, reject) => {
  const id = ++nextId
  const timer = setTimeout(() => reject(new Error(`${method} timed out`)), 180000)
  pending.set(id, msg => { clearTimeout(timer); resolve(msg) })
  server.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n')
})

const init = await rpc('initialize', {
  protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'browser-smoke', version: '0' },
})
console.log(`browser-smoke: connected to ${init.result?.serverInfo?.name} ${init.result?.serverInfo?.version}`)
server.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n')

const checks = [
  ['compileEffect', { effect_id: 'synth/cell', backend: 'webgl2' }],
  ['renderEffectFrame', { effect_id: 'synth/cell', backend: 'webgl2' }],
]

let failed = 0
for (const [name, args] of checks) {
  const started = Date.now()
  const res = await rpc('tools/call', { name, arguments: args })
  const secs = ((Date.now() - started) / 1000).toFixed(1)
  const text = res.result?.content?.[0]?.text ?? ''
  let payload
  try { payload = JSON.parse(text) } catch { payload = null }
  const ok = res.result?.isError !== true && payload?.status === 'ok'
  if (!ok) failed++
  console.log(`browser-smoke: ${ok ? 'PASS' : 'FAIL'} ${name} (${secs}s) ${ok ? '' : text.slice(0, 200)}`)
}

// A DSL program with two independently written surfaces must deliver a real
// PNG contact sheet, with a metric record for each surface at each time.
const dsl = 'search synth\nnoise().write(o0)\ncell().write(o1)\nrender(o1)'
const dslResponse = await rpc('tools/call', {
  name: 'runDslProgram',
  arguments: { dsl, backend: 'webgl2', frames: [1, 3, 6], warmup_frames: 1, resolution: [96, 54], cell_resolution: [48, 27] },
})
const dslBlocks = dslResponse.result?.content ?? []
const dslMetadata = JSON.parse(dslBlocks.find(block => block.type === 'text')?.text ?? '{}')
const dslImage = dslBlocks.find(block => block.type === 'image')
const pngBytes = dslImage?.data ? Buffer.from(dslImage.data, 'base64') : Buffer.alloc(0)
const dslOk = dslResponse.result?.isError !== true && dslMetadata.status === 'ok'
  && JSON.stringify(dslMetadata.surfaces) === JSON.stringify(['o0', 'o1'])
  && JSON.stringify(dslMetadata.frames) === JSON.stringify([1, 3, 6])
  && dslMetadata.render_target === 'o1'
  && dslMetadata.captures?.length === 6
  && dslMetadata.captures.every(c => c.metrics && Number.isFinite(c.metrics.mean_alpha))
  && dslMetadata.captures.every(c => c.metrics.unique_sampled_colors > 1 && !c.metrics.is_all_zero)
  && dslImage?.mimeType === 'image/png'
  && pngBytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))
  && pngBytes.readUInt32BE(16) >= 144 && pngBytes.readUInt32BE(20) >= 54
if (!dslOk) failed++
console.log(`browser-smoke: ${dslOk ? 'PASS' : 'FAIL'} runDslProgram grid ${dslOk ? '' : JSON.stringify({ metadata: dslMetadata, contentTypes: dslBlocks.map(b => b.type) }).slice(0, 500)}`)

const badDsl = await rpc('tools/call', {
  name: 'runDslProgram',
  arguments: { dsl: 'missingEffect().write(o0)', frames: [1], resolution: [96, 54] },
})
const badPayload = JSON.parse(badDsl.result?.content?.find(block => block.type === 'text')?.text ?? '{}')
const badOk = badDsl.result?.isError === true && badPayload.status === 'error'
  && !badDsl.result?.content?.some(block => block.type === 'image')
if (!badOk) failed++
console.log(`browser-smoke: ${badOk ? 'PASS' : 'FAIL'} invalid DSL cleanup`)

const defaultResponse = await rpc('tools/call', {
  name: 'runDslProgram',
  arguments: { dsl: 'search synth\nnoise().write(o0)\nrender(o0)' },
})
const defaultBlocks = defaultResponse.result?.content ?? []
const defaultMetadata = JSON.parse(defaultBlocks.find(block => block.type === 'text')?.text ?? '{}')
const defaultOk = defaultResponse.result?.isError !== true && defaultMetadata.status === 'ok'
  && defaultMetadata.resolution?.width === 960 && defaultMetadata.resolution?.height === 540
  && JSON.stringify(defaultMetadata.frames) === JSON.stringify([1, 120, 600])
  && defaultMetadata.captures?.length === 3
  && defaultMetadata.frame?.width === 960 && defaultMetadata.frame?.height === 540
  && Number.isFinite(defaultMetadata.metrics?.mean_alpha)
  && defaultBlocks.some(block => block.type === 'image' && block.mimeType === 'image/png')
if (!defaultOk) failed++
console.log(`browser-smoke: ${defaultOk ? 'PASS' : 'FAIL'} runDslProgram defaults after failure ${defaultOk ? '' : JSON.stringify(defaultMetadata).slice(0, 500)}`)

const concurrent = await Promise.all(['noise', 'cell'].map(effect => rpc('tools/call', {
  name: 'runDslProgram',
  arguments: { dsl: `search synth\n${effect}().write(o0)\nrender(o0)`, frames: [1], warmup_frames: 0, resolution: [96, 54] },
})))
const concurrentImages = concurrent.map(reply => reply.result?.content?.find(block => block.type === 'image')?.data)
const concurrentOk = concurrent.every(reply => reply.result?.isError !== true)
  && concurrentImages.every(Boolean) && concurrentImages[0] !== concurrentImages[1]
if (!concurrentOk) failed++
console.log(`browser-smoke: ${concurrentOk ? 'PASS' : 'FAIL'} concurrent DSL calls stay isolated`)

server.kill()

// The consumer pattern, which the MCP tools above do not exercise.
//
// noisemaker and portable do not call tools over stdio — they import
// dist/harness directly, build their own page with page.setContent(), and
// import the renderer from the harness server as an ES module. A setContent
// page's origin is the string "null", so that import is a cross-origin
// request. Dropping the server's CORS header in 0.2.0 made every one of their
// tests hang on a renderer global that never appeared, while shade-mcp's own
// suite stayed green.
const { acquireServer, releaseServer } = await import('../dist/harness/index.js')
const { chromium } = await import('playwright')

let consumerOk = false
let gridPixelsOk = false
const baseUrl = await acquireServer(0, NM, `${NM}/shaders/effects`)
const browser = await chromium.launch({ headless: true })
try {
  const page = await browser.newPage()
  await page.setContent(
    `<canvas id="canvas"></canvas><script type="module">
       import { CanvasRenderer } from '${baseUrl}/shaders/src/index.js'
       window.__consumerLoaded = typeof CanvasRenderer === 'function'
     </script>`,
    { waitUntil: 'load' },
  )
  await page.waitForFunction(() => window.__consumerLoaded === true, null, { timeout: 30000 })
  consumerOk = true
  if (dslImage?.data) {
    gridPixelsOk = await page.evaluate(async ({ data }) => {
      const img = new Image()
      img.src = `data:image/png;base64,${data}`
      await img.decode()
      const canvas = document.createElement('canvas')
      canvas.width = img.width
      canvas.height = img.height
      const ctx = canvas.getContext('2d')
      ctx.drawImage(img, 0, 0)
      const colors = (y) => {
        const pixels = ctx.getImageData(42, y, 48, 27).data
        const found = new Set()
        for (let i = 0; i < pixels.length; i += 4) {
          found.add(`${pixels[i] >> 3},${pixels[i + 1] >> 3},${pixels[i + 2] >> 3}`)
        }
        return found.size
      }
      return colors(28) > 4 && colors(59) > 4
    }, { data: dslImage.data })
  }
} catch (err) {
  console.log(`browser-smoke: FAIL module import from a setContent page — ${String(err).split('\n')[0]}`)
} finally {
  await browser.close()
  await releaseServer()
}
if (!consumerOk) failed++
else console.log('browser-smoke: PASS module import from a setContent page')
if (!gridPixelsOk) failed++
else console.log('browser-smoke: PASS contact-sheet cells contain rendered pixels')

// CanvasRenderer.render catches its own exceptions. Force that path in a real
// browser so the DSL tool cannot report a successful grid of stale pixels.
const { BrowserSession, runDslProgram } = await import('../dist/harness/index.js')
const faultSession = new BrowserSession({
  backend: 'webgl2', blankPage: true, viewerRoot: NM, effectsDir: `${NM}/shaders/effects`,
})
let runtimeFailureOk = false
try {
  await faultSession.setup()
  await faultSession.page.route('**/shaders/src/renderer/canvas.js', async route => {
    const response = await route.fetch()
    const body = await response.text()
    await route.fulfill({ response, body: `${body}\nconst originalRender = CanvasRenderer.prototype.render; CanvasRenderer.prototype.render = function(time) { if (this.pipeline) this.pipeline.render = () => { throw new Error('injected frame failure') }; return originalRender.call(this, time) }` })
  })
  const result = await runDslProgram(faultSession, 'search synth\nnoise().write(o0)\nrender(o0)', {
    frames: [1], warmupFrames: 0, resolution: [96, 54],
  })
  runtimeFailureOk = result.status === 'error' && /injected frame failure/.test(result.error)
} finally {
  await faultSession.teardown()
}
if (!runtimeFailureOk) failed++
console.log(`browser-smoke: ${runtimeFailureOk ? 'PASS' : 'FAIL'} swallowed renderer error fails DSL batch`)

const fallbackSession = new BrowserSession({
  backend: 'webgl2', blankPage: true, viewerRoot: NM, effectsDir: `${NM}/shaders/effects`,
})
let backendMismatchOk = false
try {
  await fallbackSession.setup()
  await fallbackSession.page.route('**/shaders/src/renderer/canvas.js', async route => {
    const response = await route.fetch()
    const body = await response.text()
    await route.fulfill({ response, body: `${body}\nconst originalCompile = CanvasRenderer.prototype.compile; CanvasRenderer.prototype.compile = async function(...args) { const result = await originalCompile.apply(this, args); this.pipeline.backend.getName = () => 'WebGPU'; return result }` })
  })
  const result = await runDslProgram(fallbackSession, 'search synth\nnoise().write(o0)\nrender(o0)', {
    frames: [1], warmupFrames: 0, resolution: [96, 54],
  })
  backendMismatchOk = result.status === 'error' && /requested backend webgl2.*WebGPU/i.test(result.error)
} finally {
  await fallbackSession.teardown()
}
if (!backendMismatchOk) failed++
console.log(`browser-smoke: ${backendMismatchOk ? 'PASS' : 'FAIL'} backend fallback fails DSL batch`)

// The DSL page must have a trustworthy loopback origin for WebGPU without
// loading the consumer's viewer. Exercise the real renderer when Chromium can
// provide a device; otherwise, a WebGL fallback must still fail the request.
const webgpuSession = new BrowserSession({
  backend: 'webgpu', blankPage: true, viewerRoot: NM, effectsDir: `${NM}/shaders/effects`,
})
let isolatedPageOk = false
let webgpuRenderOk = false
let webgpuUnavailable = false
let webgpuCapability = ''
let virtualRouteRemoved = false
try {
  await webgpuSession.setup()
  const page = webgpuSession.page
  const state = await page.evaluate(async () => {
    let capability = 'no-gpu'
    try {
      if (navigator.gpu) {
        capability = 'no-adapter'
        const adapter = await navigator.gpu.requestAdapter()
        if (adapter) {
          capability = 'no-device'
          const device = await adapter.requestDevice()
          device.destroy()
          capability = 'device'
        }
      }
    } catch (error) {
      capability = `device-error: ${String(error)}`
    }
    return {
      url: location.href,
      secure: isSecureContext,
      viewerLoaded: typeof window.__noisemakerCanvasRenderer !== 'undefined',
      canvasCount: document.querySelectorAll('canvas').length,
      capability,
    }
  })
  isolatedPageOk = /^http:\/\/127\.0\.0\.1:\d+$/.test(new URL(state.url).origin)
    && new URL(state.url).pathname === '/.shade-mcp-blank.html'
    && state.secure && !state.viewerLoaded && state.canvasCount === 0
  webgpuCapability = state.capability

  const result = await runDslProgram(webgpuSession, 'search synth\nnoise().write(o0)\nrender(o0)', {
    frames: [1], warmupFrames: 0, resolution: [64, 64], cellResolution: [64, 64],
  })
  if (state.capability === 'device') {
    webgpuRenderOk = result.status === 'ok' && result.backend?.toLowerCase() === 'webgpu'
      && result.captures?.length === 1
      && result.captures[0].metrics.unique_sampled_colors > 1
      && !result.captures[0].metrics.is_all_zero
      && result.image_data && Buffer.from(result.image_data, 'base64').subarray(0, 8)
        .equals(Buffer.from('89504e470d0a1a0a', 'hex'))
  } else {
    webgpuUnavailable = true
    webgpuRenderOk = result.status === 'error' && !result.image_data
  }

  // The virtual document route is only active for setup navigation. The
  // server refuses the dotfile path after the route is removed.
  virtualRouteRemoved = (await page.goto(state.url))?.status() === 403
} finally {
  await webgpuSession.teardown()
}
if (!isolatedPageOk) failed++
if (!webgpuRenderOk) failed++
if (!virtualRouteRemoved) failed++
console.log(`browser-smoke: ${isolatedPageOk ? 'PASS' : 'FAIL'} isolated secure loopback DSL page`)
console.log(`browser-smoke: ${webgpuRenderOk ? webgpuUnavailable ? 'SKIP' : 'PASS' : 'FAIL'} genuine WebGPU DSL render${webgpuUnavailable ? ` (${webgpuCapability}; fallback rejected)` : ''}`)
console.log(`browser-smoke: ${virtualRouteRemoved ? 'PASS' : 'FAIL'} virtual blank-page route removed`)

if (failed) {
  console.error(`browser-smoke: ${failed} check(s) failed`)
  process.exit(1)
}
console.log('browser-smoke: all available checks OK')
process.exit(0)
