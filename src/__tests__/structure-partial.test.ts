import { describe, it, expect, afterEach, vi } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { checkEffectStructure } from '../tools/analysis/structure.js'

// A definition whose passes are built at run time (flatMap) has no static
// pass list, so checkEffectStructure must not call its shader files unused.
// noisemaker's render/pointsRender and render/pointsBillboardRender have this
// shape; v0.4.0 flagged every one of their files.

const roots: string[] = []

function makeEffects(defSource: string, programs: string[]): string {
  const root = mkdtempSync(join(tmpdir(), 'shade-structure-'))
  roots.push(root)
  const dir = join(root, 'render', 'points')
  mkdirSync(join(dir, 'glsl'), { recursive: true })
  mkdirSync(join(dir, 'wgsl'), { recursive: true })
  writeFileSync(join(dir, 'definition.js'), defSource)
  for (const p of programs) {
    writeFileSync(join(dir, 'glsl', `${p}.glsl`), 'void main() {}\n')
    writeFileSync(join(dir, 'wgsl', `${p}.wgsl`), '@fragment fn main() {}\n')
  }
  vi.stubEnv('SHADE_EFFECTS_DIR', root)
  return root
}

afterEach(() => {
  vi.unstubAllEnvs()
  while (roots.length) rmSync(roots.pop()!, { recursive: true, force: true })
})

describe('checkEffectStructure with computed passes', () => {
  it('does not flag shader files as unused when the passes are computed at run time', async () => {
    makeEffects(`export default new Effect({
      func: 'points', name: 'Points', description: 'd',
      globals: {},
      passes: ['a', 'b'].flatMap(k => [{ name: k, program: k }])
    })`, ['a', 'b'])
    const result = await checkEffectStructure('render/points')
    expect(result.unusedFiles).toEqual([])
    expect(result.unusedFilesUnchecked).toMatch(/^passes are computed at run time: passes: /)
    expect(result.status).toBe('ok')
  })

  it('still flags an unused file when the passes are literal', async () => {
    makeEffects(`export default new Effect({
      func: 'points', name: 'Points', description: 'd',
      globals: {},
      passes: [{ name: 'a', program: 'a' }]
    })`, ['a', 'orphan'])
    const result = await checkEffectStructure('render/points')
    expect(result.unusedFiles.sort()).toEqual(['glsl/orphan.glsl', 'wgsl/orphan.wgsl'])
    expect(result.unusedFilesUnchecked).toBeUndefined()
    expect(result.status).toBe('warning')
  })
})
