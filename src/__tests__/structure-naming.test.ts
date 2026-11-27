import { describe, it, expect, afterEach, vi } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { checkEffectStructure } from '../tools/analysis/structure.js'

// Noisemaker effects name some globals in the indexed form
// <camelCase><index>_<camelCase>: synth/remap has zone0_tex and zone0_count,
// and mixer/mashup has layer0_tex. The definition.json reader reads each one.

const roots: string[] = []

function makeEffect(globals: Record<string, unknown>): void {
  const root = mkdtempSync(join(tmpdir(), 'shade-naming-'))
  roots.push(root)
  const dir = join(root, 'synth', 'remap')
  mkdirSync(join(dir, 'glsl'), { recursive: true })
  mkdirSync(join(dir, 'wgsl'), { recursive: true })
  writeFileSync(join(dir, 'definition.json'), JSON.stringify({
    format: 'noisemaker-portable-effect',
    version: 2,
    func: 'remap',
    name: 'Remap',
    namespace: 'synth',
    description: 'd',
    globals,
    passes: { render: { program: 'main' } },
  }))
  writeFileSync(join(dir, 'glsl', 'main.glsl'), 'void main() {}\n')
  writeFileSync(join(dir, 'wgsl', 'main.wgsl'), '@fragment fn main() {}\n')
  vi.stubEnv('SHADE_EFFECTS_DIR', root)
}

afterEach(() => {
  vi.unstubAllEnvs()
  while (roots.length) rmSync(roots.pop()!, { recursive: true, force: true })
})

describe('checkEffectStructure naming of globals', () => {
  it('reports no naming issue for a global in the indexed form, and reports the other names that are not camelCase', async () => {
    makeEffect({
      zone0_tex: { type: 'surface', default: 'none' },
      zone0_count: { type: 'int', default: 1 },
      layer1_active: { type: 'boolean', default: true },
      zone3_v31: { type: 'float', default: 0 },
      speed: { type: 'float', default: 1 },
      snake_case: { type: 'float', default: 0 },
      MyParam: { type: 'float', default: 0 },
    })
    const result = await checkEffectStructure('synth/remap')
    expect(result.namingIssues).toEqual([
      { type: 'global', name: 'snake_case', reason: 'Must be camelCase' },
      { type: 'global', name: 'MyParam', reason: 'Must be camelCase' },
    ])
  })
})
