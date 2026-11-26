import { describe, it, expect, afterEach } from 'vitest'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadEffectDefinition, parseDefinitionJson } from '../formats/index.js'
import type { EffectDefinition } from '../formats/index.js'

// A version 2 package written from the Portable package schema. The first
// test below lists the fields it declares.
const PORTABLE_V2_DIR = fileURLToPath(new URL('./fixtures/portable-v2', import.meta.url))
const portableV2 = (): Record<string, any> => JSON.parse(readFileSync(join(PORTABLE_V2_DIR, 'definition.json'), 'utf-8'))

const dirs: string[] = []

function writeJsonDef(json: unknown): string {
  const dir = mkdtempSync(join(tmpdir(), 'shade-def-json-'))
  dirs.push(dir)
  writeFileSync(join(dir, 'definition.json'), JSON.stringify(json))
  return dir
}

afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true })
})

describe('parseDefinitionJson', () => {
  it('parses a minimal definition', () => {
    const json = {
      func: 'myEffect',
      name: 'My Effect',
      globals: {},
      passes: [{ program: 'main' }]
    }
    const def = parseDefinitionJson(json, '/test/effect')
    expect(def.func).toBe('myEffect')
    expect(def.format).toBe('json')
    expect(def.passes).toHaveLength(1)
    expect(def.passes[0].program).toBe('main')
    expect(def.effectDir).toBe('/test/effect')
  })

  it('parses globals with uniform specs', () => {
    const json = {
      func: 'test',
      globals: {
        speed: { type: 'float', uniform: 'u_speed', default: 1.0, min: 0, max: 10 }
      },
      passes: []
    }
    const def = parseDefinitionJson(json, '/test')
    expect(def.globals.speed).toBeDefined()
    expect(def.globals.speed.uniform).toBe('u_speed')
    expect(def.globals.speed.default).toBe(1.0)
    expect(def.globals.speed.min).toBe(0)
    expect(def.globals.speed.max).toBe(10)
  })

  it('parses tags and description', () => {
    const json = {
      func: 'test',
      description: 'A test effect',
      tags: ['noise', 'pattern'],
      globals: {},
      passes: []
    }
    const def = parseDefinitionJson(json, '/test')
    expect(def.description).toBe('A test effect')
    expect(def.tags).toEqual(['noise', 'pattern'])
  })
})

describe('reading a version 2 definition.json', () => {
  it('uses a fixture that declares the listed top-level, pass, parameter, ui and texture fields, and uniform layouts in map, list and byte form', () => {
    const raw = portableV2()
    const fieldsOf = (records: unknown[]) => [...new Set(records.flatMap(record => Object.keys(record as object)))].sort()
    expect(Object.keys(raw).sort()).toEqual([
      'builtinMeshes', 'defaultProgram', 'deprecatedBy', 'description', 'externalMesh', 'externalTexture',
      'feature', 'format', 'func', 'globals', 'hidden', 'name', 'namespace', 'openCategories', 'outputGeo',
      'outputTex3d', 'passes', 'starter', 'tags', 'textures', 'textures3d', 'uniformLayout', 'uniformLayouts',
      'version',
    ])
    // The list has no storageBuffers, which the engine refuses in a version 2 package.
    expect(fieldsOf(Object.values(raw.passes))).toEqual([
      'blend', 'clear', 'conditions', 'count', 'countUniform', 'defines', 'drawBuffers', 'drawMode',
      'entryPoint', 'inputs', 'name', 'outputs', 'program', 'repeat', 'samplerTypes', 'storageTextures',
      'type', 'uniforms', 'viewport', 'workgroups',
    ])
    expect(fieldsOf(Object.values(raw.globals))).toEqual([
      'choices', 'colorModeUniform', 'default', 'define', 'enum', 'inheritsSeed', 'max', 'min', 'randChance',
      'randChoices', 'randMax', 'randMin', 'step', 'type', 'ui', 'uniform', 'zero',
    ])
    expect(fieldsOf(Object.values(raw.globals).map((spec: any) => spec.ui ?? {}))).toEqual([
      'buttonLabel', 'category', 'control', 'enabledBy', 'format', 'hidden', 'hint', 'label', 'multiline', 'resetOnChange',
    ])
    expect(fieldsOf([...Object.values(raw.textures), ...Object.values(raw.textures3d)])).toEqual([
      'depth', 'filter', 'format', 'height', 'is3D', 'mipmaps', 'persistent', 'width',
    ])
    // uniformLayout is in map form. uniformLayouts holds a list form and a byte form.
    expect(Array.isArray(raw.uniformLayout)).toBe(false)
    expect(raw.uniformLayout.time).toHaveProperty('slot')
    expect(Array.isArray(raw.uniformLayouts.advect)).toBe(true)
    expect(raw.uniformLayouts.draw.type).toBe('byte')
  })

  it('keeps each top-level field of the fixture other than format, version, globals and passes, drops version, and sets format and effectDir', () => {
    const raw = portableV2()
    const def = loadEffectDefinition(PORTABLE_V2_DIR) as unknown as Record<string, unknown>
    // Some of the fields that the 1.x projection drops, named so that the fixture keeps them.
    for (const field of ['textures', 'outputTex3d', 'outputGeo', 'uniformLayout', 'uniformLayouts', 'defaultProgram']) {
      expect(raw, field).toHaveProperty([field])
      expect(def[field], field).toEqual(raw[field])
    }
    for (const field of Object.keys(raw)) {
      if (['format', 'version', 'globals', 'passes'].includes(field)) continue
      expect(def[field], field).toEqual(raw[field])
    }
    expect(def).not.toHaveProperty('version')
    expect(def.format).toBe('json')
    expect(def.effectDir).toBe(PORTABLE_V2_DIR)
    expect(def.partial).toBeUndefined()
  })

  it('accepts a uniform layout in map, list and byte form under the uniformLayout and uniformLayouts types, and reads each form from the fixture', () => {
    type ProgramLayout = NonNullable<EffectDefinition['uniformLayouts']>[string]
    const def = loadEffectDefinition(PORTABLE_V2_DIR)
    const mapForm = {
      resolution: { slot: 0, components: 'xy' },
      time: { slot: 0, components: 'z' },
      density: { slot: 0, components: 'w' },
    }
    const listForm = [
      { name: 'curl', slot: 0, components: 'x' },
      { name: 'steps', slot: 0, components: 'y' },
    ]
    const byteForm = {
      type: 'byte',
      layout: [
        { name: 'trailCount', offset: 0, size: 4, type: 'int' },
        { name: 'density', offset: 4, size: 4, type: 'float' },
      ],
    }
    // Each assignment fails the type check if the type does not hold that form.
    const layouts: Array<EffectDefinition['uniformLayout']> = [mapForm, listForm, byteForm]
    const programLayouts: ProgramLayout[] = [mapForm, listForm, byteForm]
    expect(layouts).toStrictEqual(programLayouts)
    expect(def.uniformLayout).toStrictEqual(mapForm)
    expect(def.uniformLayouts?.advect).toStrictEqual(listForm)
    expect(def.uniformLayouts?.draw).toStrictEqual(byteForm)
  })

  it('reads the fixture\'s passes as a list in the order of their keys, each equal to its own fields with name set to its key', () => {
    const raw = portableV2()
    const def = loadEffectDefinition(PORTABLE_V2_DIR)
    expect(def.passes.map(pass => pass.name)).toEqual(Object.keys(raw.passes))
    for (const [index, [name, pass]] of Object.entries(raw.passes).entries()) {
      expect(def.passes[index], name).toStrictEqual({ ...(pass as object), name })
    }
  })

  it('reads each of the fixture\'s parameters as its own fields with name set to its key, and uniform set to its key where the parameter has none', () => {
    const raw = portableV2()
    const def = loadEffectDefinition(PORTABLE_V2_DIR)
    expect(Object.keys(def.globals)).toEqual(Object.keys(raw.globals))
    for (const [name, spec] of Object.entries(raw.globals)) {
      expect(def.globals[name], name).toStrictEqual({ ...(spec as object), name, uniform: (spec as any).uniform ?? name })
    }
  })

  it('reads a minimal package as its func and name, its pass with name set to its key, globals {}, format and effectDir, and no other field', () => {
    const minimal = { format: 'noisemaker-portable-effect', version: 2, name: 'minimal', func: 'minimal', passes: { main: { program: 'main' } } }
    expect(parseDefinitionJson(minimal, '/test')).toStrictEqual({
      func: 'minimal',
      name: 'minimal',
      globals: {},
      passes: [{ name: 'main', program: 'main' }],
      format: 'json',
      effectDir: '/test',
    })
  })

  it('sets func to the name when the package leaves func out', () => {
    const { func, ...raw } = portableV2()
    raw.name = 'volumeTrailsByName'
    expect(parseDefinitionJson(raw, '/test').func).toBe('volumeTrailsByName')
  })

  it('leaves the parsed package unchanged', () => {
    const raw = portableV2()
    parseDefinitionJson(raw, '/test')
    expect(raw).toEqual(portableV2())
  })

  it('throws for another format, for version 3, for a missing version and for passes given as an array', () => {
    const raw = portableV2()
    expect(() => loadEffectDefinition(writeJsonDef({ ...raw, format: 'other-format' }))).toThrow(/format "other-format" is not supported/)
    expect(() => loadEffectDefinition(writeJsonDef({ ...raw, version: 3 }))).toThrow(/version 3 is not supported/)
    const { version, ...unversioned } = raw
    expect(() => loadEffectDefinition(writeJsonDef(unversioned))).toThrow('definition.json: a package with a format marker states version 2')
    expect(() => loadEffectDefinition(writeJsonDef({ ...raw, passes: [{ name: 'main', program: 'main' }] }))).toThrow(/passes must be an object keyed by pass name/)
  })

  it('throws for a parameter or a pass named __proto__, constructor or prototype', () => {
    const raw = portableV2()
    for (const name of ['__proto__', 'constructor', 'prototype']) {
      const globals = JSON.parse(`{${JSON.stringify(name)}: {"type": "float", "default": 0}}`)
      const passes = JSON.parse(`{${JSON.stringify(name)}: {"program": "main"}}`)
      expect(() => parseDefinitionJson({ ...raw, globals }, '/test'), name).toThrow(`globals.${name}: a parameter name may not be a reserved name`)
      expect(() => parseDefinitionJson({ ...raw, passes }, '/test'), name).toThrow(`passes.${name}: a pass name may not be a reserved name`)
    }
  })
})

describe('reading a 1.x definition.json', () => {
  it('reads a definition.json with no format field as the reduced projection, with only the listed fields of the definition, its parameters and its passes', () => {
    const raw = portableV2()
    const { format, version, ...legacy } = raw
    legacy.version = '1.0.0'
    legacy.passes = Object.entries(raw.passes).map(([name, pass]) => ({ ...(pass as object), name }))
    const def = loadEffectDefinition(writeJsonDef(legacy))
    expect(def).toStrictEqual({
      func: legacy.func,
      name: legacy.name,
      namespace: legacy.namespace,
      description: legacy.description,
      starter: legacy.starter,
      tags: legacy.tags,
      globals: Object.fromEntries(Object.entries(raw.globals).map(([name, spec]: [string, any]) => [name, {
        name,
        type: spec.type,
        uniform: spec.uniform ?? name,
        default: spec.default,
        min: spec.min,
        max: spec.max,
        step: spec.step,
        choices: spec.choices,
        control: undefined,
        define: spec.define,
        ui: spec.ui,
      }])),
      passes: legacy.passes.map((pass: any) => ({
        name: pass.name,
        program: pass.program,
        type: pass.type,
        inputs: pass.inputs,
        outputs: pass.outputs,
      })),
      format: 'json',
      effectDir: def.effectDir,
    })
  })
})
