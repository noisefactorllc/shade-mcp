// Real MCP/browser regression for Portable's existing viewer and CDN renderer.
// Usage: PORTABLE=/path/to/portable node scripts/portable-browser-smoke.mjs
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'

const portable = process.env.PORTABLE
if (!portable || !existsSync(`${portable}/viewer/index.html`)) {
  throw new Error('PORTABLE must name a Portable checkout with viewer/index.html')
}

const cdnBase = 'https://shaders.noisedeck.app/1'
async function readDeployment() {
  const response = await fetch(`${cdnBase}/deployment-meta.json`, { cache: 'no-store' })
  if (!response.ok) throw new Error(`CDN deployment metadata returned ${response.status}`)
  return response.json()
}
const deployment = await readDeployment()
console.log(`Portable renderer deployment: ${JSON.stringify(deployment)}`)

const server = spawn('node', ['dist/index.js'], {
  stdio: ['pipe', 'pipe', 'inherit'],
  env: {
    ...process.env,
    SHADE_EFFECTS_DIR: `${portable}/effect`,
    SHADE_PROJECT_ROOT: portable,
    SHADE_VIEWER_ROOT: portable,
    SHADE_VIEWER_PATH: '/viewer/index.html',
    SHADE_GLOBALS_PREFIX: '__portable',
    SHADE_DSL_RENDERER_MODULE: `${cdnBase}/noisemaker-shaders-core.esm.js`,
    SHADE_DSL_ASSETS_BASE: cdnBase,
    SHADE_DSL_USE_BUNDLES: 'true',
    SHADE_HEADLESS: '1',
  },
})

let buffer = ''
let nextId = 0
const pending = new Map()
server.stdout.on('data', chunk => {
  buffer += chunk
  let end
  while ((end = buffer.indexOf('\n')) >= 0) {
    const line = buffer.slice(0, end)
    buffer = buffer.slice(end + 1)
    if (!line.trim()) continue
    try {
      const message = JSON.parse(line)
      const finish = pending.get(message.id)
      if (finish) { pending.delete(message.id); finish(message) }
    } catch { /* Ignore non-protocol stdout. */ }
  }
})

function rpc(method, params) {
  return new Promise((resolve, reject) => {
    const id = ++nextId
    const timer = setTimeout(() => {
      pending.delete(id)
      reject(new Error(`${method} timed out`))
    }, 180000)
    pending.set(id, message => { clearTimeout(timer); resolve(message) })
    server.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n')
  })
}

async function callTool(name, args) {
  const reply = await rpc('tools/call', { name, arguments: args })
  const content = reply.result?.content || []
  const payload = JSON.parse(content.find(block => block.type === 'text')?.text || '{}')
  if (reply.result?.isError || payload.status !== 'ok') {
    throw new Error(`${name} failed: ${JSON.stringify(payload).slice(0, 800)}`)
  }
  return { payload, content }
}

try {
  const init = await rpc('initialize', {
    protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'portable-browser-smoke', version: '0' },
  })
  if (init.error) throw new Error(`MCP initialize failed: ${JSON.stringify(init.error)}`)
  server.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n')

  const compiled = await callTool('compileEffect', { backend: 'webgl2' })
  console.log(`Portable compileEffect: ${compiled.payload.status} (${compiled.payload.effect_id})`)
  const rendered = await callTool('renderEffectFrame', { backend: 'webgl2', warmup_frames: 1 })
  if (!Number.isFinite(rendered.payload.metrics?.mean_alpha)) throw new Error('Portable renderEffectFrame has no metrics')
  console.log(`Portable renderEffectFrame: ${rendered.payload.status}`)

  const dsl = 'search synth\nnoise().write(o0)\ncell().write(o1)\nrender(o1)'
  const { payload, content } = await callTool('runDslProgram', {
    dsl, backend: 'webgl2', frames: [1, 3, 6], warmup_frames: 1,
    resolution: [96, 54], cell_resolution: [48, 27],
  })
  const image = content.find(block => block.type === 'image')
  const png = Buffer.from(image?.data || '', 'base64')
  if (image?.mimeType !== 'image/png' || !png.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))
    || JSON.stringify(payload.surfaces) !== JSON.stringify(['o0', 'o1'])
    || JSON.stringify(payload.frames) !== JSON.stringify([1, 3, 6])
    || payload.captures?.length !== 6
    || !payload.captures.every(c => Number.isFinite(c.metrics?.mean_alpha) && !c.metrics.is_all_zero)) {
    throw new Error(`Portable DSL batch response invalid: ${JSON.stringify(payload).slice(0, 800)}`)
  }
  console.log(`Portable runDslProgram: ${payload.captures.length} captures, ${png.length} PNG bytes`)
  const deploymentAfter = await readDeployment()
  if (deploymentAfter.git_hash !== deployment.git_hash || deploymentAfter.version !== deployment.version) {
    throw new Error(`CDN deployment changed during smoke: ${JSON.stringify(deployment)} -> ${JSON.stringify(deploymentAfter)}`)
  }
  console.log(`Portable renderer deployment after checks: ${JSON.stringify(deploymentAfter)}`)
} finally {
  server.kill()
}
