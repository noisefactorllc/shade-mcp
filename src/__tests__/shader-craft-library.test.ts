import { describe, it, expect } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import {
  SHADER_CRAFT_LIBRARY,
  SHADER_CRAFT_LIBRARY_MODULES,
  SHADER_CRAFT_LIBRARY_PROGRAM_SYMBOLS,
  SHADER_CRAFT_LIBRARY_CONVENTIONS,
  SHADER_CRAFT_CREDITS,
  SHADER_CRAFT_PROVENANCE,
  getShaderCraftSymbolSource,
} from '../knowledge/index.js'
import type { ShaderCraftLanguage } from '../knowledge/index.js'

// Spelled out rather than imported: the upstream declaration order, in which a module uses only earlier modules.
const MODULE_ORDER = [
  'common', 'hash', 'noise', 'pattern', 'sdf3d', 'sdf2d', 'operators', 'domain', 'architecture', 'raymarch',
  'intersect', 'camera', 'shading', 'water', 'color', 'tonemap', 'volume', 'atmosphere', 'post', 'debug',
]
const LANGUAGES: ShaderCraftLanguage[] = ['glsl', 'wgsl']
const PROGRAM_SYMBOLS = new Set(['map', 'ZERO'])
const SHADERTOY_CONTRACT = ['mainImage', 'iTime', 'iResolution', 'iFrame', 'iMouse', 'iChannel', 'iDate',
  'fragCoord', 'gl_FragColor']

function stripComments(code: string): string {
  return code.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, '')
}

function identifiers(code: string): Set<string> {
  return new Set(stripComments(code).match(/\b[A-Za-z_]\w*\b/g) ?? [])
}

interface Declaration {
  kind: 'function' | 'const' | 'prototype'
  name: string
  signature: string
  params: string[]
  doc: string[]
}

// Reads the top-level declarations of a module source independently of the library's own helpers. Every
// declaration starts at column 0 on one line; anything else at column 0 is reported so it cannot slip past.
function declarations(source: string, language: ShaderCraftLanguage): { found: Declaration[]; unparsed: string[] } {
  const found: Declaration[] = []
  const unparsed: string[] = []
  let doc: string[] = []
  for (const line of source.split('\n')) {
    if (line.startsWith('///')) { doc.push(line.slice(3).trim()); continue }
    if (!line.trim()) { doc = []; continue }
    if (/^(\/\/|\s|\})/.test(line)) continue
    let m: RegExpExecArray | null
    if (language === 'glsl' && (m = /^(\w+) (\w+)\((.*)\) \{/.exec(line))) {
      const params = m[3].trim() ? m[3].split(',').map(p => p.trim().split(/\s+/).at(-2)!) : []
      found.push({ kind: 'function', name: m[2], signature: `${m[1]} ${m[2]}(${m[3]})`, params, doc })
    } else if (language === 'glsl' && (m = /^(\w+) (\w+)\((.*)\);$/.exec(line))) {
      found.push({ kind: 'prototype', name: m[2], signature: line, params: [], doc })
    } else if (language === 'glsl' && (m = /^const (\w+) (\w+) = .+;$/.exec(line))) {
      found.push({ kind: 'const', name: m[2], signature: line, params: [], doc })
    } else if (language === 'wgsl' && (m = /^fn (\w+)\((.*)\)( -> \S+)? \{/.exec(line))) {
      found.push({ kind: 'function', name: m[1], signature: `fn ${m[1]}(${m[2]})${m[3] ?? ''}`, params: [], doc })
    } else if (language === 'wgsl' && (m = /^const (\w+): \w+ = .+;$/.exec(line))) {
      found.push({ kind: 'const', name: m[1], signature: line, params: [], doc })
    } else {
      unparsed.push(line)
    }
    doc = []
  }
  return { found, unparsed }
}

// smoothstep calls whose two edges are numeric literals: GLSL and WGSL leave edge0 >= edge1 undefined, so library
// code writes a falling ramp as 1.0 - smoothstep(lo, hi, x).
function literalSmoothsteps(source: string): Array<{ call: string; ascending: boolean }> {
  const code = stripComments(source)
  const found: Array<{ call: string; ascending: boolean }> = []
  const literal = /^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?f?$/
  for (const match of code.matchAll(/\bsmoothstep\s*\(/g)) {
    const args = ['']
    let depth = 1, i = match.index + match[0].length
    for (; i < code.length; i++) {
      const c = code[i]
      if (c === '(') depth++
      if (c === ')' && --depth === 0) break
      if (c === ',' && depth === 1) args.push('')
      else args[args.length - 1] += c
    }
    const [lo, hi] = args.map(arg => arg.trim())
    if (literal.test(lo) && literal.test(hi)) {
      found.push({ call: code.slice(match.index, i + 1), ascending: parseFloat(lo) < parseFloat(hi) })
    }
  }
  return found
}

const BY_ID = new Map(SHADER_CRAFT_LIBRARY.map(entry => [entry.id, entry]))
const INDEX = new Map(SHADER_CRAFT_LIBRARY.map((entry, i) => [entry.id, i]))

describe('shader-craft library modules', () => {
  it('has the twenty upstream modules in declaration order', () => {
    expect(SHADER_CRAFT_LIBRARY_MODULES.map(m => m.module)).toEqual(MODULE_ORDER)
    for (const module of SHADER_CRAFT_LIBRARY_MODULES) {
      expect(module.summary.length, module.module).toBeGreaterThan(10)
      expect(module.glsl, module.module).toContain(`//! ${module.module}:`)
      expect(module.wgsl, module.module).toContain(`//! ${module.module}:`)
    }
  })

  it('records the upstream blob of every GLSL module it adapts', () => {
    for (const module of MODULE_ORDER) {
      const file = SHADER_CRAFT_PROVENANCE.files.find(f => f.path === `skills/shader-art-coding/glsl/${module}.glsl`)
      expect(file?.blob, module).toMatch(/^[0-9a-f]{40}$/)
      expect(file?.adaptedAs, module).toContain(`SHADER_CRAFT_LIBRARY_MODULES.${module}`)
    }
  })
})

describe('shader-craft library index', () => {
  it('has one entry per upstream symbol with unique ids and names', () => {
    expect(SHADER_CRAFT_LIBRARY.filter(e => e.kind === 'function')).toHaveLength(211)
    expect(SHADER_CRAFT_LIBRARY.filter(e => e.kind === 'const')).toHaveLength(6)
    expect(new Set(SHADER_CRAFT_LIBRARY.map(e => e.id)).size).toBe(SHADER_CRAFT_LIBRARY.length)
    expect(new Set(SHADER_CRAFT_LIBRARY.map(e => e.wgsl.name)).size).toBe(SHADER_CRAFT_LIBRARY.length)
    for (const entry of SHADER_CRAFT_LIBRARY) {
      expect(entry.summary.length, entry.id).toBeGreaterThan(5)
      expect(entry.summary, entry.id).not.toContain('\n')
    }
  })

  it('gives every GLSL symbol a WGSL twin and every WGSL symbol a GLSL twin, with signatures from the sources', () => {
    for (const module of SHADER_CRAFT_LIBRARY_MODULES) {
      const entries = SHADER_CRAFT_LIBRARY.filter(e => e.module === module.module)
      for (const language of LANGUAGES) {
        const { found, unparsed } = declarations(module[language], language)
        expect(unparsed, `${module.module}.${language}`).toEqual([])
        const symbols = found.filter(d => d.kind !== 'prototype')
        expect(symbols.map(d => d.signature), `${module.module}.${language}`)
          .toEqual(entries.map(e => e[language].signature))
        expect(symbols.map(d => d.name), `${module.module}.${language}`).toEqual(entries.map(e => e[language].name))
      }
    }
  })

  it('derives ids and kinds from the GLSL declarations', () => {
    for (const module of SHADER_CRAFT_LIBRARY_MODULES) {
      const symbols = declarations(module.glsl, 'glsl').found.filter(d => d.kind !== 'prototype')
      for (const d of symbols) {
        const id = d.kind === 'function' ? `${d.name}(${d.params.join(',')})` : d.name
        expect(BY_ID.get(id)?.kind, id).toBe(d.kind)
        expect(BY_ID.get(id)?.module, id).toBe(module.module)
      }
    }
  })

  it('names overloads in WGSL by the documented rule', () => {
    const counts = new Map<string, number>()
    for (const e of SHADER_CRAFT_LIBRARY) counts.set(e.glsl.name, (counts.get(e.glsl.name) ?? 0) + 1)
    const codes = SHADER_CRAFT_LIBRARY_CONVENTIONS.wgslTypeCodes
    const renamed: string[] = []
    for (const e of SHADER_CRAFT_LIBRARY) {
      const types = e.kind === 'function' ? e.id.slice(e.id.indexOf('(') + 1, -1).split(',').filter(Boolean) : []
      const expected = counts.get(e.glsl.name) === 1 ? e.glsl.name : `${e.glsl.name}_${types.map(t => codes[t]).join('')}`
      expect(e.wgsl.name, e.id).toBe(expected)
      if (expected !== e.glsl.name) renamed.push(`${e.id} -> ${e.wgsl.name}`)
    }
    expect(renamed).toContain('fbm(vec2,int) -> fbm_f2i')
    expect(renamed).toContain('sdBox(vec3,vec3) -> sdBox_f3f3')
    expect(renamed).toContain('sdBox(vec2,vec2) -> sdBox_f2f2')
    expect(renamed).toHaveLength(45)
  })

  it('records where code departs from upstream', () => {
    const adapted = SHADER_CRAFT_LIBRARY.filter(e => e.adaptation)
    for (const entry of adapted) expect(entry.adaptation!.length, entry.id).toBeGreaterThan(20)
    expect(BY_ID.get('simpleSky(vec3,vec3)')?.adaptation).toContain('1.0 - smoothstep(-0.08, 0.0, rd.y)')
    expect(BY_ID.get('ditherTPDF(vec2,int)')?.adaptation).toContain('pixel')
    expect(adapted.filter(e => e.glsl.requires.includes('ZERO')).length).toBe(5)
  })

  it('takes exactness tags from the upstream doc comments', () => {
    for (const module of SHADER_CRAFT_LIBRARY_MODULES) {
      for (const d of declarations(module.glsl, 'glsl').found.filter(x => x.kind === 'function')) {
        const tags = d.doc.filter(line => /^@(exact|bound|approx)$/.test(line)).map(line => line.slice(1))
        const entry = BY_ID.get(`${d.name}(${d.params.join(',')})`)!
        expect(entry.exactness, entry.id).toBe(tags[0])
      }
    }
    expect(BY_ID.get('sdEllipsoid(vec3,vec3)')?.exactness).toBe('approx')
    expect(BY_ID.get('sdOctahedron(vec3,float)')?.exactness).toBe('bound')
  })
})

describe('shader-craft library dependencies', () => {
  it('extracts every symbol\'s source in both languages', () => {
    for (const entry of SHADER_CRAFT_LIBRARY) {
      for (const language of LANGUAGES) {
        const code = getShaderCraftSymbolSource(entry.id, language)
        expect(code.startsWith(entry[language].signature), `${entry.id} ${language}`).toBe(true)
        expect(code.endsWith(entry.kind === 'const' ? ';' : '}'), `${entry.id} ${language}`).toBe(true)
        const braces = stripComments(code).split('').reduce((n, c) => n + (c === '{' ? 1 : c === '}' ? -1 : 0), 0)
        expect(braces, `${entry.id} ${language}`).toBe(0)
      }
    }
    expect(() => getShaderCraftSymbolSource('noSuchSymbol(float)', 'glsl')).toThrow(/Unknown/)
  })

  it('lists exactly the library and program symbols each body uses, per language', () => {
    const names = {
      glsl: new Set(SHADER_CRAFT_LIBRARY.map(e => e.glsl.name)),
      wgsl: new Set(SHADER_CRAFT_LIBRARY.map(e => e.wgsl.name)),
    }
    const problems: string[] = []
    for (const entry of SHADER_CRAFT_LIBRARY) {
      for (const language of LANGUAGES) {
        const code = getShaderCraftSymbolSource(entry.id, language)
        // The body only: a constant's name and a function's parameter list are not uses.
        const body = entry.kind === 'const' ? code.slice(code.indexOf('=') + 1) : code.slice(code.indexOf('{'))
        const used = identifiers(body)
        const library = [...used].filter(n => names[language].has(n) && (language === 'glsl' || n !== entry.wgsl.name))
        const declared = entry[language].dependencies.map(id => BY_ID.get(id)?.[language].name)
        // GLSL overloads share a name, so GLSL is checked by name; WGSL names are unique, so WGSL is exact.
        if ([...new Set(declared)].sort().join() !== library.sort().join()) {
          problems.push(`${entry.id} ${language}: uses ${library.sort()} but lists ${declared}`)
        }
        const program = [...used].filter(n => PROGRAM_SYMBOLS.has(n)).sort()
        if (program.join() !== [...entry[language].requires].sort().join()) {
          problems.push(`${entry.id} ${language}: needs ${program} but requires ${entry[language].requires}`)
        }
      }
    }
    expect(problems).toEqual([])
  })

  it('resolves every dependency, in declaration order, with no cycles in either language', () => {
    for (const language of LANGUAGES) {
      for (const entry of SHADER_CRAFT_LIBRARY) {
        for (const id of entry[language].dependencies) {
          const dependency = BY_ID.get(id)
          expect(dependency, `${entry.id} ${language} -> ${id}`).toBeDefined()
          expect(INDEX.get(id)!, `${entry.id} ${language} -> ${id}`).toBeLessThan(INDEX.get(entry.id)!)
          expect(MODULE_ORDER.indexOf(dependency!.module), `${entry.id} -> ${id}`)
            .toBeLessThanOrEqual(MODULE_ORDER.indexOf(entry.module))
        }
      }
      // Depth-first search for a cycle, independent of the ordering check above.
      const state = new Map<string, 'visiting' | 'done'>()
      const cycles: string[] = []
      const visit = (id: string, path: string[]): void => {
        if (state.get(id) === 'done') return
        if (state.get(id) === 'visiting') { cycles.push([...path, id].join(' -> ')); return }
        state.set(id, 'visiting')
        for (const next of BY_ID.get(id)![language].dependencies) visit(next, [...path, id])
        state.set(id, 'done')
      }
      for (const entry of SHADER_CRAFT_LIBRARY) visit(entry.id, [])
      expect(cycles, language).toEqual([])
    }
  })

  it('leaves only the raymarch scene contract to the program', () => {
    expect(SHADER_CRAFT_LIBRARY_PROGRAM_SYMBOLS.map(s => s.name).sort()).toEqual(['ZERO', 'map'])
    const requiring = SHADER_CRAFT_LIBRARY.filter(e => e.glsl.requires.length || e.wgsl.requires.length)
    expect(requiring.map(e => e.glsl.name).sort())
      .toEqual(['calcAO', 'calcNormal', 'raymarch', 'sdfThickness', 'softShadow'])
    for (const entry of requiring) {
      expect(entry.glsl.requires, entry.id).toEqual(['ZERO', 'map'])
      expect(entry.wgsl.requires, entry.id).toEqual(['ZERO', 'map'])
    }
    const map = SHADER_CRAFT_LIBRARY_PROGRAM_SYMBOLS.find(s => s.name === 'map')!
    const raymarch = SHADER_CRAFT_LIBRARY_MODULES.find(m => m.module === 'raymarch')!
    expect(declarations(raymarch.glsl, 'glsl').found.filter(d => d.kind === 'prototype').map(d => d.signature))
      .toEqual([map.glslPrototype])
  })
})

describe('shader-craft library credits', () => {
  const keys = SHADER_CRAFT_CREDITS.techniques.map(t => t.key)

  it('credits every symbol to technique sources that exist', () => {
    const known = new Set(keys)
    for (const entry of SHADER_CRAFT_LIBRARY) {
      expect(entry.credits.length, entry.id).toBeGreaterThan(0)
      for (const key of entry.credits) expect(known.has(key), `${entry.id}: ${key}`).toBe(true)
    }
    const credited = (key: string) => SHADER_CRAFT_LIBRARY.filter(e => e.credits.includes(key)).map(e => e.id)
    expect(credited('pcg-hash')).toContain('pcg3d(uvec3)')
    expect(credited('agx')).toEqual(['tonemapAgX(vec3)', 'tonemapAgXPunchy(vec3)'])
    expect(credited('hg-sdf')).toContain('opChamferUnion(float,float,float)')
  })
})

describe('shader-craft library follows the Noisemaker effect contract', () => {
  const sources = SHADER_CRAFT_LIBRARY_MODULES.flatMap(m => [
    [`${m.module}.glsl`, m.glsl, 'glsl'], [`${m.module}.wgsl`, m.wgsl, 'wgsl'],
  ] as Array<[string, string, ShaderCraftLanguage]>)

  it('names no part of the Shadertoy contract', () => {
    const offenders = sources.flatMap(([label, text]) =>
      SHADERTOY_CONTRACT.filter(token => text.includes(token)).map(token => `${label}: ${token}`))
    expect(offenders).toEqual([])
  })

  it('reads no uniforms, built-ins or textures, only parameters', () => {
    const banned: Record<ShaderCraftLanguage, RegExp> = {
      glsl: /\buniform\b|\bgl_\w+|\btexture\w*\s*\(|\bsampler\w*|#\s*(version|define)|\bprecision\b|\bout vec4\b/,
      wgsl: /\bvar\s*<\s*uniform|@binding|@group|@builtin|\btexture\w*|\bsampler\b|@fragment/,
    }
    const offenders = sources
      .filter(([, text, language]) => banned[language].test(stripComments(text)))
      .map(([label, text, language]) => `${label}: ${stripComments(text).match(banned[language])![0]}`)
    expect(offenders).toEqual([])
  })

  it('writes smoothstep edges in ascending order, as both languages require', () => {
    // The check catches upstream's simpleSky form and passes its rewrite.
    expect(literalSmoothsteps('mix(col, ground, smoothstep(0.0, -0.08, rd.y))'))
      .toEqual([{ call: 'smoothstep(0.0, -0.08, rd.y)', ascending: false }])
    expect(literalSmoothsteps('mix(col, ground, 1.0 - smoothstep(-0.08, 0.0, rd.y))'))
      .toEqual([{ call: 'smoothstep(-0.08, 0.0, rd.y)', ascending: true }])
    const calls = sources.flatMap(([label, text]) => literalSmoothsteps(text).map(c => ({ ...c, label })))
    expect(calls.filter(c => !c.ascending).map(c => `${c.label}: ${c.call}`)).toEqual([])
    // simpleSky, debugDistance and waterWaveD, in both languages: the check is not vacuous.
    expect(calls.length).toBeGreaterThanOrEqual(6)
  })

  it('hashes with integers, never fract(sin())', () => {
    const sineHash = /\bfract\s*\(\s*[-+]?\s*(?:[\d.]+(?:[eE][-+]?\d+)?\s*\*\s*)?sin\s*\(|43758\.5453/
    const offenders = sources.filter(([, text]) => sineHash.test(stripComments(text))).map(([label]) => label)
    expect(offenders).toEqual([])
  })

  it('cites sources by name, with no web addresses', () => {
    const offenders = sources.filter(([, text]) => /https?:\/\/|www\./.test(text)).map(([label]) => label)
    expect(offenders).toEqual([])
  })

  it('records a measurement and a reason with every parity tolerance', () => {
    for (const entry of SHADER_CRAFT_LIBRARY) {
      if (!entry.parity) continue
      expect(entry.kind, entry.id).toBe('function')
      expect(entry.parity.tolerance, entry.id).toBeGreaterThan(0)
      expect(entry.parity.tolerance, entry.id).toBeLessThan(1e-4)
      expect(entry.parity.reason.length, entry.id).toBeGreaterThan(20)
      expect(entry.parity.measured.length, entry.id).toBeGreaterThan(0)
      for (const { renderer, difference } of entry.parity.measured) {
        expect(renderer.length, entry.id).toBeGreaterThan(3)
        expect(difference, `${entry.id} on ${renderer}`).toBeGreaterThan(0)
        expect(difference, `${entry.id} on ${renderer}`).toBeLessThanOrEqual(entry.parity.tolerance)
      }
    }
  })
})

describe('shader-craft library in the dist/knowledge bundle', () => {
  it('reaches Shade and Foundry through the knowledge drop alone', async () => {
    // Build the knowledge entry exactly as the release does (tsup.config.ts), into a scratch directory, and
    // import the bundle there: Shade and Foundry vendor only dist/knowledge.
    const { build } = await import('tsup')
    const { default: config } = await import('../../tsup.config.js')
    const outDir = await mkdtemp(join(tmpdir(), 'shade-knowledge-'))
    try {
      await build({ ...(config as object), entry: { 'knowledge/index': 'src/knowledge/index.ts' }, outDir,
        clean: false, sourcemap: false, silent: true, config: false })
      const bundle = await import(pathToFileURL(join(outDir, 'knowledge/index.js')).href)
      expect(bundle.SHADER_CRAFT_LIBRARY).toEqual(SHADER_CRAFT_LIBRARY)
      expect(bundle.SHADER_CRAFT_LIBRARY_MODULES).toEqual(SHADER_CRAFT_LIBRARY_MODULES)
      expect(bundle.SHADER_CRAFT_LIBRARY_PROGRAM_SYMBOLS).toEqual(SHADER_CRAFT_LIBRARY_PROGRAM_SYMBOLS)
      expect(bundle.SHADER_CRAFT_LIBRARY_CONVENTIONS).toEqual(SHADER_CRAFT_LIBRARY_CONVENTIONS)
      expect(bundle.getShaderCraftSymbolSource('fbm(vec2,int)', 'wgsl'))
        .toBe(getShaderCraftSymbolSource('fbm(vec2,int)', 'wgsl'))
      expect(bundle.SHADER_CRAFT_CREDITS.techniques.map((t: { key: string }) => t.key))
        .toEqual(SHADER_CRAFT_CREDITS.techniques.map(t => t.key))
    } finally {
      await rm(outDir, { recursive: true, force: true })
    }
  }, 60000)
})
