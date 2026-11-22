import { describe, expect, it } from 'vitest'
import { bundleShaderSource, searchShaderLibrary, getShaderCraftSymbolSource } from '../knowledge/index.js'
import { scanTopLevel } from '../knowledge/shader-craft/source.js'

const { ADD_CASES, addWordOracle } = await import(new URL('../../scripts/craft-precision-fixtures.mjs', import.meta.url).href)

describe('binary32 addition oracle', () => {
  it('rounds literal ties, cancellation, subnormals, signed zeros and overflow', () => {
    for (const [a, b, expected] of ADD_CASES) expect(addWordOracle(a, b), `${a.toString(16)} + ${b.toString(16)}`).toBe(expected)
  })
})

for (const language of ['glsl', 'wgsl'] as const) describe(`private precision dependencies in ${language}`, () => {
  const call = language === 'glsl' ? 'dot2(vec2(1.0))' : 'dot2_f2(vec2f(1.0))'
  const source = language === 'glsl' ? `void main() { float x = ${call}; }` : `fn main() { let x = ${call}; }`

  it('emits shared arithmetic once while keeping bundle summaries and discovery public', () => {
    const bundled = bundleShaderSource(source, language)
    const names = scanTopLevel(bundled.source, language).filter(item => item.kind === 'function').map(item => item.name)
    expect(names.filter(name => name === 'nmCraftAddWords')).toHaveLength(1)
    expect(names.filter(name => name === 'nmCraftAdd')).toHaveLength(1)
    expect(bundled.added).toEqual(language === 'glsl' ? ['dot2(vec2)', 'dot2(vec3)'] : ['dot2(vec2)'])
    expect(searchShaderLibrary('nmCraftAdd', { language })).toEqual([])
    expect(bundleShaderSource(bundled.source, language)).toEqual({ source: bundled.source, added: [], credits: [] })
  })

  it('rejects a caller replacing private rounding with different arithmetic', () => {
    const replacement = language === 'glsl' ? 'float nmCraftAdd(float a, float b) { return 0.0; }'
      : 'fn nmCraftAdd(a: f32, b: f32) -> f32 { return 0.0; }'
    expect(() => bundleShaderSource(`${replacement}\n${source}`, language)).toThrow(/private|internal/i)
  })

  it('retains canonical extracted helpers when inserting their callers before them', () => {
    const helper = getShaderCraftSymbolSource('nmCraftAdd(float,float)', language)
    const words = getShaderCraftSymbolSource('nmCraftAddWords(uint,uint)', language)
    const bundled = bundleShaderSource(`${words}\n${helper}\n${source}`, language)
    const names = scanTopLevel(bundled.source, language).filter(item => item.kind === 'function').map(item => item.name)
    expect(names.filter(name => name === 'nmCraftAddWords')).toHaveLength(1)
    expect(names.filter(name => name === 'nmCraftAdd')).toHaveLength(1)
    expect(bundleShaderSource(bundled.source, language).source).toBe(bundled.source)
    if (language === 'glsl') {
      const declarations = scanTopLevel(bundled.source, language)
      const caller = declarations.find(item => item.kind === 'function' && item.name === 'dot2')!
      expect(declarations.some(item => item.kind === 'prototype' && item.name === 'nmCraftAdd' && item.start < caller.start)).toBe(true)
    }
  })
})

it('rejects conditional private definitions that may disappear before their callers', () => {
  const words = getShaderCraftSymbolSource('nmCraftAddWords(uint,uint)', 'glsl')
  const helper = getShaderCraftSymbolSource('nmCraftAdd(float,float)', 'glsl')
  expect(() => bundleShaderSource(`#if 0\n${words}\n${helper}\n#endif\nvoid main() { float x = dot2(vec2(1.0)); }`, 'glsl')).toThrow(/private|internal/i)
})
