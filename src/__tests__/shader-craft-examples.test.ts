import { describe, it, expect } from 'vitest'
import * as api from '../knowledge/shader-craft.js'
import { SHADER_CRAFT_DOCUMENTS, SHADER_CRAFT_PROVENANCE } from '../knowledge/shader-craft/index.js'
import { SHADER_CRAFT_LIBRARY, SHADER_CRAFT_CREDITS, searchShaderKnowledge } from '../knowledge/index.js'

const ids = ['alpine-valley', 'coastal-water', 'noise-progression', 'noise-terrain-map', 'ocean', 'pattern-swatches', 'procedural-city', 'raymarch-sdf', 'sdf-2d-poster', 'terrain', 'volumetric-clouds']
describe('shader-craft Noisemaker examples', () => {
  it('exports all eleven unique packages through the browser entry', () => {
    expect(api.SHADER_CRAFT_EXAMPLES.map(e => e.id)).toEqual(ids)
    expect(new Set(api.SHADER_CRAFT_EXAMPLES.map(e => e.func)).size).toBe(11)
  })
  it.each(ids)('%s returns complete sources, copyable files and runtime bindings', id => {
    const pkg = api.getShaderCraftExample(id)
    expect(pkg.definition.func).toBe(pkg.example.func)
    expect(pkg.definition.namespace).toBe('user')
    expect(pkg.definition.starter).toBe(true)
    expect(pkg.definition.globals.seed).toEqual({ type: 'int', default: 42, uniform: 'seed', min: 0, max: 65535 })
    expect(pkg.definition.uniformLayout).toEqual({
      resolution: { slot: 0, components: 'xy' }, time: { slot: 0, components: 'z' },
      aspectRatio: { slot: 0, components: 'w' }, seed: { slot: 1, components: 'x' },
    })
    expect(pkg.definition.passes).toEqual([{ name: 'render', program: pkg.example.func, inputs: {}, outputs: { fragColor: 'outputTex' } }])
    expect(pkg.files['definition.js']).toContain('new Effect(')
    expect(pkg.files.LICENSE).toContain('Copyright (c) 2026 gokayfem')
    expect(pkg.files.LICENSE).toContain('Permission is hereby granted')
    for (const language of ['glsl', 'wgsl'] as const) {
      const shader = pkg.shaders[language]
      expect(pkg.files[`${language}/${pkg.example.func}.${language}`]).toBe(shader.source)
      expect(shader.source).not.toMatch(/\b(mainImage|iTime|iResolution|iFrame|DEBUG_MODE)\b|#include/)
      expect(shader.added.length).toBeGreaterThan(0)
      expect(shader.added).not.toContain('aaOffset(int)')
      expect(shader.source).not.toMatch(/\b(lightAcc|ambientAcc)\b/)
      expect(shader.source).toContain('shader-craft credits')
      if (language === 'wgsl') expect(shader.source).toContain('pixel = position.xy;')
      expect(shader.source).toContain(`templates/${id}.glsl at e09bc993bf04201f26c03c87c89210e9b472f526`)
      expect(api.checkShaderSource(shader.source, language).filter(f => f.severity === 'error')).toEqual([])
      expect(api.bundleShaderSource(shader.source, language).added).toEqual([])
      const symbols = SHADER_CRAFT_LIBRARY.filter(e => shader.added.includes(e.id))
      const credits = new Set(symbols.flatMap(e => e.credits))
      expect(shader.credits).toEqual([...credits])
      const block = /\/\* shader-craft credits\n[\s\S]*?\*\//.exec(shader.source)![0]
      expect(shader.source.match(/\/\* shader-craft credits\n/g)).toHaveLength(1)
      for (const credit of SHADER_CRAFT_CREDITS.techniques) {
        expect(block.includes(`${credit.key}:`), credit.key).toBe(credits.has(credit.key))
      }
      for (const symbol of symbols) for (const dependency of symbol[language].dependencies) {
        expect(shader.added, `${symbol.id} requires ${dependency}`).toContain(dependency)
      }
      if (symbols.some(e => e[language].requires.includes('ZERO'))) {
        expect(shader.source).toContain(language === 'glsl' ? '#define ZERO (min(int(seed), 0))' : 'ZERO = min(i32(seed), 0);')
        expect(shader.source).toMatch(language === 'glsl' ? /vec2 map\(vec3 p\)/ : /fn map\(p_arg: vec3f\)/)
      }
    }
  })
  it.each(ids)('%s is discoverable on demand and has pinned provenance', id => {
    const docId = `shader-craft-example-${id}`
    expect(SHADER_CRAFT_DOCUMENTS.find(d => d.id === docId)?.content).toContain('getShaderCraftExample')
    expect(searchShaderKnowledge(`${id} example`, { category: 'shader-craft', limit: 10 }).map(d => d.id)).toContain(docId)
    const file = SHADER_CRAFT_PROVENANCE.files.find(f => f.path.endsWith(`/templates/${id}.glsl`))!
    expect(file.blob).toMatch(/^[0-9a-f]{40}$/)
    expect(file.adaptedAs).toContain(docId)
    expect(file.adaptedAs).toContain('getShaderCraftExample')
  })
  it('returns independently editable effect packages', () => {
    const first = api.getShaderCraftExample('terrain')
    first.definition.globals.seed.default = 7
    first.files['definition.js'] = 'changed'
    expect(api.getShaderCraftExample('terrain').definition.globals.seed.default).toBe(42)
    expect(api.getShaderCraftExample('terrain').files['definition.js']).toContain('new Effect(')
  })
  it('rejects unknown example identifiers', () => {
    expect(() => api.getShaderCraftExample('../terrain')).toThrow('Unknown shader-craft example')
  })
})
