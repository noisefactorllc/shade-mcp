import { beforeAll, afterAll, describe, it, expect } from 'vitest'
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { createShadeServer } from '../server.js'

const server = createShadeServer()
const client = new Client({ name: 'craft-tests', version: '1' })
let project: string, effects: string, outside: string
const prior = { project: process.env.SHADE_PROJECT_ROOT, effects: process.env.SHADE_EFFECTS_DIR }
beforeAll(async () => {
  project = await mkdtemp(join(tmpdir(), 'shade-craft-'))
  effects = await mkdtemp(join(tmpdir(), 'shade-effects-'))
  outside = await mkdtemp(join(tmpdir(), 'shade-outside-'))
  process.env.SHADE_PROJECT_ROOT = project
  process.env.SHADE_EFFECTS_DIR = effects
  await mkdir(join(project, 'shaders'))
  const [ct, st] = InMemoryTransport.createLinkedPair()
  await server.connect(st)
  await client.connect(ct)
})
afterAll(async () => {
  await client.close(); await server.close()
  await Promise.all([project, effects, outside].map(p => rm(p, { recursive: true, force: true })))
  for (const [key, value] of [['SHADE_PROJECT_ROOT', prior.project], ['SHADE_EFFECTS_DIR', prior.effects]]) {
    if (value === undefined) delete process.env[key!]; else process.env[key!] = value
  }
})
const call = async (name: string, args: Record<string, unknown>) => {
  const result = await client.callTool({ name, arguments: args })
  const content = result.content as Array<{ type: string; text: string }>
  return { result, data: JSON.parse(content[0].text) }
}
describe('shader-craft MCP tools', () => {
  it('registers all three schemas', async () => {
    const { tools } = await client.listTools()
    expect(tools).toHaveLength(21)
    for (const name of ['searchShaderLibrary', 'checkShader', 'bundleShader']) expect(tools.find(t => t.name === name)).toBeDefined()
    const bundle = tools.find(t => t.name === 'bundleShader')!
    expect(bundle.inputSchema.properties).toHaveProperty('write')
    expect(bundle.inputSchema.properties).toHaveProperty('file')
  })
  it('keeps source findings advisory and searches without a viewer', async () => {
    const { result, data } = await call('checkShader', { source: 'fract(sin(x) * 43758.5453)', language: 'glsl' })
    expect(result.isError).not.toBe(true)
    expect(data.findings).toContainEqual(expect.objectContaining({ rule: 'sine-hash', severity: 'error' }))
    expect((await call('searchShaderLibrary', { query: 'tonemapAgX', language: 'wgsl', limit: 1 })).data.results[0].name).toBe('tonemapAgX')
  })
  it('infers file language and writes only with explicit write true', async () => {
    const file = join(project, 'shaders', 'craft.wgsl')
    const source = 'fn f()->vec3f {return tonemapAgX(vec3f(1.0));}'
    await writeFile(file, source)
    expect((await call('checkShader', { file })).data.language).toBe('wgsl')
    const bundled = await call('bundleShader', { file })
    expect(bundled.data.added).toContain('tonemapAgX(vec3)')
    expect(await readFile(file, 'utf8')).toBe(source)
    const written = await call('bundleShader', { file, write: true })
    expect(written.data.written).toBe(true)
    expect(await readFile(file, 'utf8')).toBe(written.data.source)
    expect((await call('bundleShader', { source, language: 'wgsl', write: true })).result.isError).toBe(true)
  })
  it('accepts either configured root, relative project paths, and rejects escaped or ambiguous inputs', async () => {
    const effectFile = join(effects, 'craft.glsl')
    await writeFile(effectFile, 'void main() {}')
    expect((await call('checkShader', { file: effectFile })).result.isError).not.toBe(true)
    expect((await call('checkShader', { file: 'shaders/craft.wgsl' })).result.isError).not.toBe(true)
    const outsideFile = join(outside, 'craft.glsl')
    await writeFile(outsideFile, 'private source')
    for (const args of [{ file: outsideFile }, { file: '../craft.glsl' }, { source: 'x' }, {}, { source: 'x', file: effectFile, language: 'glsl' }]) {
      expect((await call('checkShader', args)).result.isError, JSON.stringify(args)).toBe(true)
    }
  })
})
