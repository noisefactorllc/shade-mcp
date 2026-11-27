import { describe, it, expect, afterEach, vi } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { registerAnalyzeEffect } from '../tools/knowledge/analyze-effect.js'
import { loadEffectDefinition } from '../formats/index.js'

const PORTABLE_V2_DIR = fileURLToPath(new URL('./fixtures/portable-v2', import.meta.url))

const roots: string[] = []

async function analyzeEffect(effectId: string): Promise<any> {
  const server = new McpServer({ name: 'test', version: '0.0.0' })
  registerAnalyzeEffect(server)
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  const client = new Client({ name: 'test-client', version: '1.0.0' })
  await server.connect(serverTransport)
  await client.connect(clientTransport)
  try {
    const result: any = await client.callTool({ name: 'analyzeEffect', arguments: { effect_id: effectId } })
    return JSON.parse(result.content[0].text)
  } finally {
    await client.close()
    await server.close()
  }
}

afterEach(() => {
  vi.unstubAllEnvs()
  while (roots.length) rmSync(roots.pop()!, { recursive: true, force: true })
})

describe('analyzeEffect', () => {
  it('returns the fields of a version 2 definition.json with the values the package declares', async () => {
    vi.stubEnv('SHADE_EFFECTS_DIR', PORTABLE_V2_DIR)
    const pkg = JSON.parse(readFileSync(join(PORTABLE_V2_DIR, 'definition.json'), 'utf-8'))
    const output = await analyzeEffect('portable-v2')
    for (const key of ['uniformLayout', 'uniformLayouts', 'textures', 'textures3d', 'defaultProgram', 'outputTex3d', 'outputGeo']) {
      expect(output[key], key).toEqual(pkg[key])
    }
  })

  it('returns each field that loadEffectDefinition returns for a version 2 definition.json', async () => {
    vi.stubEnv('SHADE_EFFECTS_DIR', PORTABLE_V2_DIR)
    const output = await analyzeEffect('portable-v2')
    const definition = JSON.parse(JSON.stringify(loadEffectDefinition(PORTABLE_V2_DIR)))
    expect(output).toEqual({ outcome: 'ok', effectId: 'portable-v2', ...definition, shaders: {} })
  })

  it('returns each field that loadEffectDefinition returns for a definition.js', async () => {
    const root = mkdtempSync(join(tmpdir(), 'shade-analyze-'))
    roots.push(root)
    const dir = join(root, 'synth', 'solid')
    mkdirSync(join(dir, 'glsl'), { recursive: true })
    writeFileSync(join(dir, 'definition.js'), `export default new Effect({
      func: 'solid', name: 'Solid', namespace: 'synth', description: 'd', tags: ['color'],
      globals: { color: { type: 'color', default: [1, 0, 0] } },
      passes: [{ name: 'render', program: 'solid' }]
    })`)
    writeFileSync(join(dir, 'glsl', 'solid.glsl'), 'void main() {}\n')
    vi.stubEnv('SHADE_EFFECTS_DIR', root)
    const output = await analyzeEffect('synth/solid')
    const definition = JSON.parse(JSON.stringify(loadEffectDefinition(dir)))
    expect(output).toEqual({ outcome: 'ok', effectId: 'synth/solid', ...definition, shaders: { 'glsl/solid.glsl': 'void main() {}\n' } })
  })

  it('returns each field that loadEffectDefinition returns for a 1.x definition.json, with tags as an empty list when the definition has none', async () => {
    const root = mkdtempSync(join(tmpdir(), 'shade-analyze-'))
    roots.push(root)
    const dir = join(root, 'synth', 'solid')
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'definition.json'), JSON.stringify({
      func: 'solid', name: 'Solid', namespace: 'synth', description: 'd', starter: true,
      globals: { color: { type: 'color', default: [1, 0, 0] } },
      passes: [{ name: 'render', program: 'solid' }],
    }))
    vi.stubEnv('SHADE_EFFECTS_DIR', root)
    const output = await analyzeEffect('synth/solid')
    const definition = JSON.parse(JSON.stringify(loadEffectDefinition(dir)))
    expect(definition.tags).toBeUndefined()
    expect(output).toEqual({ outcome: 'ok', effectId: 'synth/solid', ...definition, tags: [], shaders: {} })
  })

  it('returns partial and partialReasons for a definition.js whose passes are computed at run time', async () => {
    const root = mkdtempSync(join(tmpdir(), 'shade-analyze-'))
    roots.push(root)
    const dir = join(root, 'render', 'points')
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'definition.js'), `export default new Effect({
      func: 'points', name: 'Points', description: 'd', tags: [],
      globals: {},
      passes: ['a', 'b'].flatMap(k => [{ name: k, program: k }])
    })`)
    vi.stubEnv('SHADE_EFFECTS_DIR', root)
    const output = await analyzeEffect('render/points')
    const definition = JSON.parse(JSON.stringify(loadEffectDefinition(dir)))
    expect(definition.partial).toBe(true)
    expect(output.partial).toBe(true)
    expect(output.partialReasons).toEqual(definition.partialReasons)
  })
})
