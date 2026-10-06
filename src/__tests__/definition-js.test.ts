import { describe, it, expect, afterEach } from 'vitest'
import { parseDefinitionJs, parseDefinitionJson } from '../formats/index.js'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const dirs: string[] = []

function writeDef(source: string): { file: string; dir: string } {
  const dir = mkdtempSync(join(tmpdir(), 'shade-def-'))
  dirs.push(dir)
  const file = join(dir, 'definition.js')
  writeFileSync(file, source)
  return { file, dir }
}

afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true })
})

describe('parseDefinitionJs', () => {
  it('parses basic fields', () => {
    const { file, dir } = writeDef(`export default {
      func: 'plasma',
      name: 'Plasma',
      namespace: 'synth',
      description: 'A plasma effect',
      globals: {},
      passes: [{ program: 'main' }],
    }`)
    const def = parseDefinitionJs(file, dir)
    expect(def.func).toBe('plasma')
    expect(def.name).toBe('Plasma')
    expect(def.namespace).toBe('synth')
    expect(def.description).toBe('A plasma effect')
    expect(def.format).toBe('js')
    expect(def.passes).toEqual([{ program: 'main' }])
  })

  it('preserves apostrophes in name and description', () => {
    const { file, dir } = writeDef(`export default {
      func: 'life',
      name: "Conway's Game",
      description: "Don't truncate this text",
      globals: {},
      passes: [{ program: 'main' }],
    }`)
    const def = parseDefinitionJs(file, dir)
    expect(def.name).toBe("Conway's Game")
    expect(def.description).toBe("Don't truncate this text")
  })

  it('parses globals specs that contain nested objects', () => {
    const { file, dir } = writeDef(`export default {
      func: 'x',
      globals: {
        mode: { type: 'int', uniform: 'u_mode', choices: { a: 0, b: 1 }, default: 2, min: 0, max: 5 },
        speed: { type: 'float', uniform: 'u_speed', default: 1, min: 0, max: 10 }
      },
      passes: [{ program: 'main' }]
    }`)
    const def = parseDefinitionJs(file, dir)
    // mode has a nested `choices` object before later keys
    expect(def.globals.mode).toBeDefined()
    expect(def.globals.mode.uniform).toBe('u_mode')
    expect(def.globals.mode.default).toBe(2)
    expect(def.globals.mode.max).toBe(5)
    // sibling spec after a nested object must still parse
    expect(def.globals.speed).toBeDefined()
    expect(def.globals.speed.uniform).toBe('u_speed')
    expect(def.globals.speed.max).toBe(10)
  })

  it('does not drop a spec whose uniform key follows a nested object', () => {
    const { file, dir } = writeDef(`export default {
      func: 'x',
      globals: {
        hue: { choices: { x: 1, y: 2 }, type: 'int', uniform: 'u_hue', default: 0 }
      },
      passes: [{ program: 'main' }]
    }`)
    const def = parseDefinitionJs(file, dir)
    expect(def.globals.hue).toBeDefined()
    expect(def.globals.hue.uniform).toBe('u_hue')
  })

  it('still parses flat single-line globals specs (existing behavior)', () => {
    const { file, dir } = writeDef(`export default {
      func: 'x',
      globals: {
        speed: { type: 'float', uniform: 'u_speed', default: 1.0, min: 0, max: 10 }
      },
      passes: [{ program: 'main' }]
    }`)
    const def = parseDefinitionJs(file, dir)
    expect(def.globals.speed.uniform).toBe('u_speed')
    expect(def.globals.speed.default).toBe(1.0)
    expect(def.globals.speed.min).toBe(0)
    expect(def.globals.speed.max).toBe(10)
  })

  it('parses multi-line globals specs (closing brace on its own line)', () => {
    const { file, dir } = writeDef(`export default {
      func: 'x',
      globals: {
        speed: {
          type: 'float',
          uniform: 'u_speed',
          default: 1.0,
          min: 0,
          max: 10
        }
      },
      passes: [{ program: 'main' }]
    }`)
    const def = parseDefinitionJs(file, dir)
    expect(def.globals.speed.uniform).toBe('u_speed')
    expect(def.globals.speed.default).toBe(1.0)
    expect(def.globals.speed.max).toBe(10)
  })

  it('reads spec fields from the spec itself, not from a nested object', () => {
    const { file, dir } = writeDef(`export default {
      func: 'x',
      globals: {
        mode: { type: 'int', uniform: 'u_mode', choices: { min: 99, max: 1, default: 7 }, min: 0, max: 5, default: 2 }
      },
      passes: [{ program: 'main' }]
    }`)
    const def = parseDefinitionJs(file, dir)
    expect(def.globals.mode.uniform).toBe('u_mode')
    expect(def.globals.mode.min).toBe(0)
    expect(def.globals.mode.max).toBe(5)
    expect(def.globals.mode.default).toBe(2)
  })

  it('unescapes an escaped quote inside a single-quoted value', () => {
    const { file, dir } = writeDef(`export default {
      func: 'x',
      name: 'Don\\'t Panic',
      globals: {},
      passes: [{ program: 'main' }]
    }`)
    const def = parseDefinitionJs(file, dir)
    expect(def.name).toBe("Don't Panic")
  })

  it('does not match a value on a longer key (word boundary)', () => {
    const { file, dir } = writeDef(`export default {
      func: 'x',
      filename: 'palette.png',
      name: 'Real Name',
      globals: {},
      passes: [{ program: 'main' }]
    }`)
    const def = parseDefinitionJs(file, dir)
    expect(def.name).toBe('Real Name')
  })

  it('returns undefined for an unterminated quoted value', () => {
    const { file, dir } = writeDef(`export default {
      func: 'x',
      name: 'unterminated
      description: 'ok',
      globals: {},
      passes: [{ program: 'main' }]
    }`)
    const def = parseDefinitionJs(file, dir)
    expect(def.name).toBeUndefined()
  })

  // Issue #30: the projection used to drop define-only globals, most spec
  // fields and computed passes, and count `program:` literals in comments.
  it('keeps every global and field, and marks computed passes as partial', () => {
    const { file, dir } = writeDef(`export default new Effect({
      name: 'Example', namespace: 'filter', func: 'example',
      globals: {
        noiseType: { type: 'int', define: 'NOISE_TYPE', default: 1, choices: { simplex: 0, value: 1 } },
        amount: { type: 'float', uniform: 'amount', default: 0.5, min: 0, max: 1, ui: { label: 'Amount' } },
        enabled: { type: 'boolean', uniform: 'enabled', default: true }
      },
      passes: [
        { name: 'prep', program: 'prep', inputs: { inputTex: 'inputTex' }, outputs: { fragColor: 'tmp0' } },
        ...Array.from({ length: 3 }, (_, i) => ({ name: 'blur' + i, program: i % 2 ? 'blurV' : 'blurH', inputs: { inputTex: 'tmp0' }, outputs: { fragColor: 'tmp0' } })),
        { name: 'final', program: 'final', inputs: { inputTex: 'tmp0' }, outputs: { fragColor: 'outputTex' } }
      ]
    })`)
    const def = parseDefinitionJs(file, dir)
    expect(def.globals.noiseType).toMatchObject({ type: 'int', define: 'NOISE_TYPE', default: 1, choices: { simplex: 0, value: 1 } })
    expect(def.globals.amount.ui).toEqual({ label: 'Amount' })
    expect(def.globals.enabled.default).toBe(true)
    expect(def.passes.map(p => p.name)).toEqual(['prep', 'final'])
    expect(def.passes[0]).toEqual({ name: 'prep', program: 'prep', inputs: { inputTex: 'inputTex' }, outputs: { fragColor: 'tmp0' } })
    expect(def.partial).toBe(true)
    expect(def.partialReasons).toEqual([expect.stringMatching(/^passes\[1\]: spread of Array\.from\(…\)/)])
  })

  it('reads the config passed to super() in a class that extends Effect', () => {
    const { file, dir } = writeDef(`import { Effect } from '../../../src/runtime/effect.js'
    class Fibers extends Effect {
      constructor() {
        super({ name: 'Fibers', namespace: 'filter', func: 'fibers', tags: ['noise'],
          globals: { seed: { type: 'int', default: 1, uniform: 'seed', min: 1, max: 100 } },
          passes: [{ name: 'render', program: 'fibers', inputs: { inputTex: 'inputTex' }, outputs: { fragColor: 'outputTex' } }] })
      }
      async asyncInit() { const program = 'notAPass'; return program }
    }
    export default new Fibers()`)
    const def = parseDefinitionJs(file, dir)
    expect(def.func).toBe('fibers')
    expect(def.tags).toEqual(['noise'])
    expect(def.passes.map(p => p.program)).toEqual(['fibers'])
    expect(def.partial).toBeUndefined()
  })

  it('reads the class fields of a class that extends Effect', () => {
    const { file, dir } = writeDef(`import { Effect } from '../../../src/runtime/effect.js'
    export default class Noise extends Effect {
      static helper = { func: 'notTheConfig' }
      name = "Noise"
      namespace = "classicNoisedeck"
      func = "noise"
      globals = {
        noiseType: { type: "int", default: 10, define: "NOISE_TYPE", choices: { cubic: 3, simplex: 10 } },
        speed: { type: "float", default: 1, uniform: "speed", min: 0, max: 5 }
      }
      passes = [{ name: "render", program: "noise", inputs: {}, outputs: { fragColor: "outputTex" } }]
    }`)
    const def = parseDefinitionJs(file, dir)
    expect(def.func).toBe('noise')
    expect(Object.keys(def.globals)).toEqual(['noiseType', 'speed'])
    expect(def.globals.noiseType.define).toBe('NOISE_TYPE')
    expect(def.passes).toEqual([{ name: 'render', program: 'noise', inputs: {}, outputs: { fragColor: 'outputTex' } }])
    expect(def.partial).toBeUndefined()
  })

  it('does not count a program literal inside a comment as a pass', () => {
    const { file, dir } = writeDef(`export default {
      func: 'x',
      globals: {},
      // passes used to include { program: 'oldPass' }
      /* program: 'another' */
      passes: [{ program: 'main' }]
    }`)
    const def = parseDefinitionJs(file, dir)
    expect(def.passes).toEqual([{ program: 'main' }])
  })

  it('keeps sibling fields and names the path when a value references another binding', () => {
    const { file, dir } = writeDef(`import { stdEnums } from '../../../src/lang/std_enums.js'
    export default new Effect({
      func: 'osc',
      globals: { kind: { type: 'int', uniform: 'kind', default: 0, choices: stdEnums.oscKind } },
      passes: [{ program: 'osc' }]
    })`)
    const def = parseDefinitionJs(file, dir)
    expect(def.globals.kind).toMatchObject({ type: 'int', uniform: 'kind', default: 0 })
    expect(def.globals.kind.choices).toBeUndefined()
    expect(def.partial).toBe(true)
    expect(def.partialReasons).toEqual(['globals.kind.choices: stdEnums.oscKind is computed at run time'])
  })

  it('returns the same globals and passes as parseDefinitionJson for an equivalent definition', () => {
    const config = {
      func: 'eq', name: 'Eq', namespace: 'filter', description: 'd', tags: ['a'],
      globals: {
        mode: { type: 'int', define: 'MODE', default: 2, choices: { a: 0, b: 2 } },
        amount: { type: 'float', uniform: 'amount', default: 0.25, min: -1, max: 1, step: 0.01, ui: { label: 'Amount', control: 'slider' } },
        color: { type: 'vec3', uniform: 'color', default: [1, 0.5, 0] },
        on: { type: 'boolean', uniform: 'on', default: false, control: false },
      },
      passes: [
        { name: 'a', program: 'a', inputs: { inputTex: 'inputTex' }, outputs: { fragColor: 't0' } },
        { name: 'b', program: 'b', type: 'compute', inputs: { inputTex: 't0' }, outputs: { fragColor: 'outputTex' } },
      ],
    }
    const { file, dir } = writeDef(`export default new Effect(${JSON.stringify(config)})`)
    const js = parseDefinitionJs(file, dir)
    const json = parseDefinitionJson(config, dir)
    expect(js.globals).toEqual(json.globals)
    expect(js.passes).toEqual(json.passes)
    expect(js.partial).toBeUndefined()
  })
})
