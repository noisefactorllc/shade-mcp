// Real MCP/browser coverage of the seed tools against source Noisemaker.
// NOISEMAKER_2X is a Noisemaker 2 checkout, which has the seed API, and
// NOISEMAKER a 1.x checkout, which has none.
// Usage: NOISEMAKER=/path/to/noisemaker NOISEMAKER_2X=/path/to/noisemaker-2 node scripts/seed-smoke.mjs
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'

const { NOISEMAKER: noisemaker1, NOISEMAKER_2X: noisemaker2 } = process.env
assert.ok(noisemaker1 && noisemaker2, 'Set NOISEMAKER and NOISEMAKER_2X to source checkouts')

function startMcp(root) {
  const server = spawn('node', ['dist/index.js'], {
    stdio: ['pipe', 'pipe', 'inherit'],
    env: { ...process.env, SHADE_PROJECT_ROOT: root, SHADE_VIEWER_ROOT: root,
      SHADE_DSL_RENDERER_MODULE: '/shaders/src/index.js', SHADE_DSL_ASSETS_BASE: '/shaders',
      SHADE_DSL_USE_BUNDLES: 'false', SHADE_HEADLESS: '1' },
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
    protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'seed-smoke', version: '0' },
  })
  assert.ok(reply.result?.serverInfo, JSON.stringify(reply))
  client.server.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n')
  const listed = await client.rpc('tools/list', {})
  for (const name of ['getProgramSeed', 'setProgramSeed', 'reseedProgram']) {
    assert.ok(listed.result?.tools.find(tool => tool.name === name), `${name} is listed`)
  }
}

async function call(client, name, args) {
  const reply = await client.rpc('tools/call', { name, arguments: args })
  assert.ok(reply.result, JSON.stringify(reply.error || reply))
  return JSON.parse(reply.result.content[0].text)
}

// The mean colour of the program's output: a seed that draws another scale
// renders another frame.
async function meanOf(client, dsl) {
  const result = await call(client, 'runDslProgram', { dsl, backend: 'webgl2', frames: [1], warmup_frames: 0,
    resolution: [64, 64], cell_resolution: [32, 32] })
  assert.equal(result.status, 'ok', JSON.stringify(result))
  return JSON.stringify(result.metrics)
}

const SEEDED = 'search synth\nseed 42\nnoise(scaleX: rand(1, 100), scaleY: rand(1, 100)).write(o0)\nrender(o0)'
const UNSEEDED = 'search synth\nnoise(scaleX: rand(1, 100), scaleY: rand(1, 100)).write(o0)\nrender(o0)'
const seedLine = dsl => /^seed (\d+)$/m.exec(dsl)?.[1]

let client
try {
  client = startMcp(noisemaker2)
  await initialize(client)

  // Read.
  assert.deepEqual(await call(client, 'getProgramSeed', { dsl: SEEDED }), { status: 'ok', seed: 42, outcome: 'ok' })
  assert.deepEqual(await call(client, 'getProgramSeed', { dsl: UNSEEDED }), { status: 'ok', seed: null, outcome: 'ok' })
  console.log('seed: PASS getProgramSeed reads the seed directive, and null without one')

  // Set: the directive is written or replaced, and the program draws again.
  const set = await call(client, 'setProgramSeed', { dsl: SEEDED, seed: 7 })
  assert.equal(set.status, 'ok', JSON.stringify(set))
  assert.equal(set.seed, 7)
  assert.equal(seedLine(set.dsl), '7', set.dsl)
  assert.match(set.dsl, /rand\(1, 100\)/, 'random calls stay as written')
  assert.equal((await call(client, 'getProgramSeed', { dsl: set.dsl })).seed, 7)
  const added = await call(client, 'setProgramSeed', { dsl: UNSEEDED, seed: 4294967295 })
  assert.equal(seedLine(added.dsl), '4294967295', added.dsl)
  const before = await meanOf(client, SEEDED)
  assert.equal(await meanOf(client, SEEDED), before, 'the same seed renders the same frame')
  assert.notEqual(await meanOf(client, set.dsl), before, 'a new seed draws other values')
  console.log('seed: PASS setProgramSeed writes the directive, keeps random calls, and changes the draws')

  // Reseed: a fresh seed, written, that changes the draws.
  const reseeded = await call(client, 'reseedProgram', { dsl: SEEDED })
  assert.equal(reseeded.status, 'ok', JSON.stringify(reseeded))
  assert.ok(Number.isInteger(reseeded.seed) && reseeded.seed !== 42, JSON.stringify(reseeded))
  assert.equal(seedLine(reseeded.dsl), String(reseeded.seed), reseeded.dsl)
  assert.notEqual(await meanOf(client, reseeded.dsl), before, 'a fresh seed draws other values')
  console.log(`seed: PASS reseedProgram wrote seed ${reseeded.seed} and changed the draws`)

  // Out-of-range input is refused by the schema.
  const refused = await client.rpc('tools/call', { name: 'setProgramSeed', arguments: { dsl: SEEDED, seed: 4294967296 } })
  assert.ok(refused.error || refused.result?.isError, JSON.stringify(refused))
  client.server.kill()

  // A 1.x engine has no seed API.
  client = startMcp(noisemaker1)
  await initialize(client)
  for (const [name, args] of [['getProgramSeed', { dsl: UNSEEDED }], ['setProgramSeed', { dsl: UNSEEDED, seed: 7 }], ['reseedProgram', { dsl: UNSEEDED }]]) {
    const result = await call(client, name, args)
    assert.equal(result.status, 'error', `${name}: ${JSON.stringify(result)}`)
    assert.match(result.error, /does not support getSeed\/setSeed/, name)
  }
  console.log('seed: PASS each seed tool names the missing seed API on a 1.x engine')
} finally {
  client?.server.kill()
}
