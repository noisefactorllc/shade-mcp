import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { EffectIndex } from '../knowledge/effect-index.js'
import { resolveEffectDir } from '../tools/resolve-effects.js'

// Portable keeps one effect directly in its effects directory (a flat
// layout). Every other tool knows it by the directory's name, so the index
// must list and search it under that id, apart from its DSL function name.
const flatDir = resolve('/tmp/shade-mcp-test-flat-index/effect')

describe('effect index with a flat layout', () => {
  beforeEach(() => {
    rmSync(resolve(flatDir, '..'), { recursive: true, force: true })
    mkdirSync(join(flatDir, 'glsl'), { recursive: true })
    writeFileSync(join(flatDir, 'definition.json'), JSON.stringify({
      name: 'Gradient Sweep',
      func: 'gradientSweep',
      description: 'A diagonal color gradient that rotates over time',
      tags: ['color'],
      passes: [{ name: 'main', program: 'gradientSweep', inputs: {}, outputs: { color: 'outputTex' } }],
    }))
    writeFileSync(join(flatDir, 'glsl', 'gradientSweep.glsl'), 'void main() {}')
  })

  afterEach(() => {
    rmSync(resolve(flatDir, '..'), { recursive: true, force: true })
  })

  it('lists the effect under the directory name the other tools accept', async () => {
    const index = new EffectIndex()
    await index.initialize(flatDir)
    expect(index.list().map(e => e.id)).toEqual(['effect'])
    expect(index.get('effect')?.func).toBe('gradientSweep')
    expect(resolveEffectDir('effect', flatDir)).toBe(flatDir)
  })

  it('finds it by search', async () => {
    const index = new EffectIndex()
    await index.initialize(flatDir)
    expect(index.search('gradient').map(r => r.id)).toEqual(['effect'])
  })
})
