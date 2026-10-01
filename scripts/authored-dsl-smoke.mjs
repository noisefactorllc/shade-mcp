// Real MCP/browser coverage of authored Portable packages against source Noisemaker.
// Usage: NOISEMAKER=/path/to/noisemaker PORTABLE=/path/to/portable node scripts/authored-dsl-smoke.mjs
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises'
import { join, dirname, basename } from 'node:path'
import { tmpdir } from 'node:os'
import { pathToFileURL } from 'node:url'

const { NOISEMAKER: noisemaker, PORTABLE: portable } = process.env
assert.ok(noisemaker && portable, 'Set NOISEMAKER and PORTABLE to source checkouts')
const { parseWorkspace } = await import(pathToFileURL(join(portable, 'workspace.mjs')).href)
const workspace = parseWorkspace(await readFile(join(portable, 'fixtures/two-effect-workspace.json'), 'utf8'))
const effectsRoot = await mkdtemp(join(tmpdir(), 'shade-authored-dsl-'))

async function hasWebGpuDevice() {
  const { BrowserSession } = await import('../dist/harness/index.js')
  const probe = new BrowserSession({ backend: 'webgpu', blankPage: true,
    viewerRoot: noisemaker, effectsDir: effectsRoot })
  try {
    await probe.setup()
    return await probe.page.evaluate(async () => {
      try {
        const adapter = await navigator.gpu?.requestAdapter()
        if (!adapter) return false
        const device = await adapter.requestDevice()
        device.destroy()
        return true
      } catch { return false }
    })
  } finally { await probe.teardown() }
}

function startMcp(effectsDir) {
  const server = spawn('node', ['dist/index.js'], {
    stdio: ['pipe', 'pipe', 'inherit'],
    env: { ...process.env, SHADE_PROJECT_ROOT: noisemaker, SHADE_VIEWER_ROOT: noisemaker,
      SHADE_EFFECTS_DIR: effectsDir, SHADE_DSL_RENDERER_MODULE: '/shaders/src/index.js',
      SHADE_DSL_ASSETS_BASE: '/shaders', SHADE_DSL_USE_BUNDLES: 'false', SHADE_HEADLESS: '1' },
  })
  let nextId = 0, buffer = ''
  const pending = new Map()
  server.stdout.on('data', chunk => {
    buffer += chunk
    let end
    while ((end = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, end)
      buffer = buffer.slice(end + 1)
      try {
        const message = JSON.parse(line)
        pending.get(message.id)?.(message)
      } catch { /* Non-protocol stdout. */ }
    }
  })
  const rpc = (method, params) => new Promise((resolve, reject) => {
    const id = ++nextId
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`${method} timed out`)) }, 180000)
    pending.set(id, message => { clearTimeout(timer); pending.delete(id); resolve(message) })
    server.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n')
  })
  return { server, rpc }
}

async function initialize(client) {
  const reply = await client.rpc('initialize', {
    protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'authored-dsl-smoke', version: '0' },
  })
  assert.ok(reply.result?.serverInfo, JSON.stringify(reply))
  client.server.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n')
  const listed = await client.rpc('tools/list', {})
  assert.ok(listed.result?.tools.find(tool => tool.name === 'runDslProgram'))
  console.log(`authored-dsl: initialized ${JSON.stringify(reply.result.serverInfo)} protocol ${reply.result.protocolVersion}`)
}

async function render(client, args, errorPattern) {
  const reply = await client.rpc('tools/call', { name: 'runDslProgram', arguments: {
    dsl: workspace.composition.dsl, effects: 'user/gradient,user/tint', backend: 'webgl2',
    frames: [1, 3, 6], warmup_frames: 1, resolution: [64, 64], cell_resolution: [32, 32], ...args,
  } })
  const blocks = reply.result?.content || []
  const text = blocks.find(block => block.type === 'text')?.text || '{}'
  const image = blocks.find(block => block.type === 'image')
  if (errorPattern) {
    assert.equal(reply.result?.isError, true, text)
    assert.match(text, errorPattern)
    assert.equal(image, undefined)
    return
  }
  const payload = JSON.parse(text)
  assert.notEqual(reply.result?.isError, true, text)
  assert.equal(payload.status, 'ok', text)
  assert.equal(payload.backend.toLowerCase(), args.backend || 'webgl2')
  assert.deepEqual(payload.frames, [1, 3, 6])
  assert.equal(payload.captures.length, 3)
  assert.ok(payload.captures.every(c => c.metrics.unique_sampled_colors > 1 && !c.metrics.is_all_zero), text)
  assert.equal(image?.mimeType, 'image/png')
  assert.ok(Buffer.from(image.data, 'base64').subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex')))
  return image.data
}

let client
try {
  for (const effect of workspace.effects) {
    for (const [file, content] of Object.entries(effect.files)) {
      if (file !== 'definition.json' && !/^(glsl|wgsl)\//.test(file)) continue
      const target = join(effectsRoot, 'user', effect.id, file)
      await mkdir(dirname(target), { recursive: true })
      await writeFile(target, content.data, content.encoding === 'utf8' ? 'utf8' : 'base64')
    }
  }
  // Portable's existing two-effect fixture supplies GLSL for tint only. Its
  // direct WGSL equivalent exercises the same authored filter on WebGPU here.
  await mkdir(join(effectsRoot, 'user/tint/wgsl'), { recursive: true })
  await writeFile(join(effectsRoot, 'user/tint/wgsl/tintFilter.wgsl'), `
@group(0) @binding(0) var inputTex: texture_2d<f32>;
@group(0) @binding(1) var inputSampler: sampler;
@group(0) @binding(2) var<uniform> resolution: vec2<f32>;
@group(0) @binding(3) var<uniform> amount: f32;
@fragment
fn main(@builtin(position) position: vec4<f32>) -> @location(0) vec4<f32> {
    let source = textureSample(inputTex, inputSampler, position.xy / resolution);
    return vec4<f32>(mix(source.rgb, source.rgb * vec3<f32>(1.0, 0.5, 0.8), amount), source.a);
}
`)
  client = startMcp(effectsRoot)
  await initialize(client)
  const webgpuAvailable = await hasWebGpuDevice()
  for (const backend of ['webgl2', 'webgpu']) {
    if (backend === 'webgpu' && !webgpuAvailable) {
      // Native driver messages vary (including Dawn's external-instance error).
      // An unavailable device must yield an error response and no image.
      await render(client, { backend }, /"status":\s*"error"/)
      console.log('authored-dsl: SKIP WebGPU positive render (no device); PASS fallback rejected')
      continue
    }
    const tinted = await render(client, { backend })
    const untinted = await render(client, { backend, dsl: workspace.composition.dsl.replace('amount: 0.4', 'amount: 0') })
    assert.notEqual(tinted, untinted, `${backend}: the second effect must change pixels`)
    assert.equal(await render(client, { backend }), tinted, `${backend}: a fresh call reproduces the composition`)
    assert.equal(await render(client, { backend, effects: 'user/gradient,user/tint,user/gradient' }), tinted,
      `${backend}: repeated package IDs select the package once`)
    console.log(`authored-dsl: PASS ${backend} two-effect grid, filter contribution, repeatability`)
  }
  await render(client, { effects: undefined }, /gradientSweep|Unknown|unknown|not found/)
  await render(client, { effects: 'user/missing' }, /definition.json.*404/)
  await render(client, { effects: '../outside' }, /Invalid.*effect/i)

  const gradient = workspace.effects.find(effect => effect.id === 'gradient')
  const definitionPath = join(effectsRoot, 'user/gradient/definition.json')
  await writeFile(definitionPath, JSON.stringify({ func: 'gradientSweep', passes: null }))
  await render(client, {}, /passes/)
  await writeFile(definitionPath, gradient.files['definition.json'].data)
  const shaderPath = join(effectsRoot, 'user/gradient/glsl/gradientSweep.glsl')
  const originalShader = await readFile(shaderPath, 'utf8')
  await rm(shaderPath)
  await render(client, {}, /gradientSweep.glsl.*404/)
  await writeFile(shaderPath, '#version 300 es\ninvalid shader source')
  await render(client, {}, /compile|syntax|ERROR/i)
  await writeFile(shaderPath, originalShader)
  await render(client, {})
  console.log('authored-dsl: PASS fresh isolation, invalid package/path/shader, missing source, recovery')
  client.server.kill()

  client = startMcp(join(portable, 'effect'))
  await initialize(client)
  await render(client, { effects: basename(join(portable, 'effect')),
    dsl: 'search user\ngradientSweep(speed: 2).write(o0)\nrender(o0)' })
  console.log('authored-dsl: PASS single-effect flat layout')
} finally {
  client?.server.kill()
  await rm(effectsRoot, { recursive: true, force: true })
}
