import { describe, it, expect, afterEach } from 'vitest'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadEffectDefinition, parseDefinitionJson } from '../formats/index.js'

// A version 2 package written from the Portable package schema, valid under
// the engine's own version 2 normalizer. It declares every field of the
// schema, so each field can be followed through the reader.
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

  it('reads passes keyed by name as a list in declaration order, with every pass control', () => {
    const raw = portableV2()
    const def = loadEffectDefinition(PORTABLE_V2_DIR)
    expect(def.passes.map(pass => pass.name)).toEqual(Object.keys(raw.passes))
    for (const [index, [name, pass]] of Object.entries(raw.passes).entries()) {
      expect(def.passes[index], name).toEqual({ ...(pass as object), name })
    }
  })

  it('keeps every field of each parameter', () => {
    const raw = portableV2()
    const def = loadEffectDefinition(PORTABLE_V2_DIR)
    expect(Object.keys(def.globals)).toEqual(Object.keys(raw.globals))
    for (const [name, spec] of Object.entries(raw.globals)) {
      expect(def.globals[name], name).toEqual({ ...(spec as object), name, uniform: (spec as any).uniform ?? name })
    }
  })

  it('takes func from name when the package leaves func out', () => {
    const { func, ...raw } = portableV2()
    expect(parseDefinitionJson(raw, '/test').func).toBe(raw.name)
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
    expect(() => loadEffectDefinition(writeJsonDef(unversioned))).toThrow(/version undefined is not supported/)
    expect(() => loadEffectDefinition(writeJsonDef({ ...raw, passes: [{ name: 'main', program: 'main' }] }))).toThrow(/passes must be an object keyed by pass name/)
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
