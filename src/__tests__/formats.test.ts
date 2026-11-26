import { describe, it, expect, afterEach } from 'vitest'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadEffectDefinition, parseDefinitionJson } from '../formats/index.js'
import type { EffectDefinition } from '../formats/index.js'

// A version 2 package written from the Portable package schema, valid under
// the engine's own version 2 normalizer. It declares every top-level, pass,
// parameter, control and texture field of the schema, and a uniform layout in
// each form the engine reads, so each can be followed through the reader.
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

describe('loadEffectDefinition on a version 2 package', () => {
  it('reads a fixture that declares every top-level, pass, parameter, control and texture field of the package schema', () => {
    const raw = portableV2()
    const fieldsOf = (records: unknown[]) => [...new Set(records.flatMap(record => Object.keys(record as object)))].sort()
    expect(Object.keys(raw).sort()).toEqual([
      'builtinMeshes', 'defaultProgram', 'deprecatedBy', 'description', 'externalMesh', 'externalTexture',
      'feature', 'format', 'func', 'globals', 'hidden', 'name', 'namespace', 'openCategories', 'outputGeo',
      'outputTex3d', 'passes', 'starter', 'tags', 'textures', 'textures3d', 'uniformLayout', 'uniformLayouts',
      'version',
    ])
    // storageBuffers is left out: a version 2 package refuses it, because it has no effect.
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
    // A uniform layout is a map of uniform names to slots, a list of entries or a byte layout.
    expect(Array.isArray(raw.uniformLayout)).toBe(false)
    expect(raw.uniformLayout.time).toHaveProperty('slot')
    expect(Array.isArray(raw.uniformLayouts.advect)).toBe(true)
    expect(raw.uniformLayouts.draw.type).toBe('byte')
  })

  it('keeps every top-level field the package declares', () => {
    const raw = portableV2()
    const def = loadEffectDefinition(PORTABLE_V2_DIR) as unknown as Record<string, unknown>
    // The fields the 1.x projection drops, named so the fixture cannot lose one.
    for (const field of ['textures', 'outputTex3d', 'outputGeo', 'uniformLayout', 'uniformLayouts', 'defaultProgram']) {
      expect(raw, field).toHaveProperty([field])
      expect(def[field], field).toEqual(raw[field])
    }
    for (const field of Object.keys(raw)) {
      if (['format', 'version', 'globals', 'passes'].includes(field)) continue
      expect(def[field], field).toEqual(raw[field])
    }
    expect(def.format).toBe('json')
    expect(def.effectDir).toBe(PORTABLE_V2_DIR)
    expect(def.partial).toBeUndefined()
  })

  it('types a uniform layout in each form the fixture uses: a map, a list and a byte layout', () => {
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

  it('reads passes keyed by name as a list in declaration order, each with every pass control, its name, and no other field that the pass leaves out', () => {
    const raw = portableV2()
    const def = loadEffectDefinition(PORTABLE_V2_DIR)
    expect(def.passes.map(pass => pass.name)).toEqual(Object.keys(raw.passes))
    for (const [index, [name, pass]] of Object.entries(raw.passes).entries()) {
      expect(def.passes[index], name).toStrictEqual({ ...(pass as object), name })
    }
  })

  it('keeps every field of each parameter, and adds only its name, and its uniform where the parameter leaves that out', () => {
    const raw = portableV2()
    const def = loadEffectDefinition(PORTABLE_V2_DIR)
    expect(Object.keys(def.globals)).toEqual(Object.keys(raw.globals))
    for (const [name, spec] of Object.entries(raw.globals)) {
      expect(def.globals[name], name).toStrictEqual({ ...(spec as object), name, uniform: (spec as any).uniform ?? name })
    }
  })

  it('adds no top-level field that a package leaves out', () => {
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

  it('takes func from name when the package leaves func out', () => {
    const { func, ...raw } = portableV2()
    raw.name = 'volumeTrailsByName'
    expect(parseDefinitionJson(raw, '/test').func).toBe('volumeTrailsByName')
  })

  it('leaves the parsed package unchanged', () => {
    const raw = portableV2()
    parseDefinitionJson(raw, '/test')
    expect(raw).toEqual(portableV2())
  })

  it('refuses a format marker or a version it does not read, and passes that are not keyed by name', () => {
    const raw = portableV2()
    expect(() => loadEffectDefinition(writeJsonDef({ ...raw, format: 'other-format' }))).toThrow(/format "other-format" is not supported/)
    expect(() => loadEffectDefinition(writeJsonDef({ ...raw, version: 3 }))).toThrow(/version 3 is not supported/)
    const { version, ...unversioned } = raw
    expect(() => loadEffectDefinition(writeJsonDef(unversioned))).toThrow('definition.json: a package with a format marker states version 2')
    expect(() => loadEffectDefinition(writeJsonDef({ ...raw, passes: [{ name: 'main', program: 'main' }] }))).toThrow(/passes must be an object keyed by pass name/)
  })

  it('refuses a parameter or a pass named with a key of the object prototype, as the engine does', () => {
    const raw = portableV2()
    for (const name of ['__proto__', 'constructor', 'prototype']) {
      const globals = JSON.parse(`{${JSON.stringify(name)}: {"type": "float", "default": 0}}`)
      const passes = JSON.parse(`{${JSON.stringify(name)}: {"program": "main"}}`)
      expect(() => parseDefinitionJson({ ...raw, globals }, '/test'), name).toThrow(`globals.${name}: a parameter name may not be a reserved name`)
      expect(() => parseDefinitionJson({ ...raw, passes }, '/test'), name).toThrow(`passes.${name}: a pass name may not be a reserved name`)
    }
  })
})

describe('loadEffectDefinition on a 1.x definition.json', () => {
  it('reads the same projection as before: the fields a version 2 package adds stay out', () => {
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
