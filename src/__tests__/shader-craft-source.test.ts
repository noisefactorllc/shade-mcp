import { describe, it, expect } from 'vitest'
import { readFile } from 'node:fs/promises'
import {
  checkShaderSource, bundleShaderSource, searchShaderLibrary,
  SHADER_CRAFT_LIBRARY as library, SHADER_CRAFT_LIBRARY_MODULES as modules,
  SHADER_CRAFT_CREDITS as creditTable,
} from '../knowledge/index.js'
import type { ShaderCraftLanguage } from '../knowledge/index.js'

const languages: ShaderCraftLanguage[] = ['glsl', 'wgsl']
const program = (body: string, lang: ShaderCraftLanguage) => lang === 'glsl'
  ? `precision highp float;\nvoid main() { ${body} }`
  : `@fragment fn main(@builtin(position) position: vec4f) -> @location(0) vec4f { ${body} return vec4f(1.0); }`
const rules = (source: string, lang: ShaderCraftLanguage) => checkShaderSource(source, lang).map(f => f.rule)

for (const lang of languages) describe(`shader-craft checker ${lang}`, () => {
  it.each([
    ['sine-hash', 'fract(sin(x) * 43758.5453)', 'fract(x * 437.0)'],
    ['sine-hash', 'fract(1e4 * sin(dot(p,p)))', 'fract(cos(x))'],
    ['reversed-smoothstep', 'smoothstep(1.0, -0.08, x)', '1.0 - smoothstep(-0.08, 1.0, x)'],
    ['reversed-smoothstep', 'smoothstep(0.0, 0.0, x)', 'smoothstep(lo, hi, x)'],
    ['nan-risk', 'pow(x, 0.5)', 'pow(max(x, 0.001), 0.5)'],
    ['nan-risk', 'sqrt(x)', 'sqrt(max(x, 0.0))'],
    ['nan-risk', 'log(x)', 'log(clamp(x, 0.001, 1.0))'],
    ['nan-risk', 'normalize(p)', 'normalize(max(p, vec3(0.001)))'],
    ['nan-risk', lang === 'glsl' ? 'atan(x,y)' : 'atan2(x,y)', lang === 'glsl' ? 'atan(1.0,y)' : 'atan2(1.0,y)'],
    ['round', 'round(x)', 'floor(x + 0.5)'],
  ])('%s detects %s but accepts %s', (rule, positive, negative) => {
    expect(rules(program(`${positive};`, lang), lang)).toContain(rule)
    expect(rules(program(`${negative};`, lang), lang)).not.toContain(rule)
  })
  it.each(['mainImage', 'iTime', 'iResolution', 'iFrame', 'iMouse', 'iChannel0', 'iChannel12', 'gl_FragColor', 'texture2D', 'iGlobalTime'])('explains the Noisemaker replacement for %s', name => {
    const findings = checkShaderSource(program(`${name};`, lang), lang).filter(f => f.rule === 'shadertoy-contract')
    expect(findings).toHaveLength(1)
    expect(findings[0].message).toContain('Noisemaker')
    expect(rules(program(`// ${name}\nfloat customTime = 1.0;`, lang), lang)).not.toContain('shadertoy-contract')
  })
  it('reports input fragCoord only, with accurate lines and advisory findings', () => {
    const code = lang === 'glsl' ? '\nvoid f(in vec2 fragCoord) {}' : '\nfn f(fragCoord: vec2f) {}'
    expect(checkShaderSource(code, lang)).toContainEqual(expect.objectContaining({ rule: 'shadertoy-contract', line: 2, severity: 'error' }))
    expect(rules(program(lang === 'glsl' ? 'vec2 fragCoord = gl_FragCoord.xy;' : 'let fragCoord = position.xy;', lang), lang)).not.toContain('shadertoy-contract')
  })
  it('checks derivative control flow and accepts uniform branches', () => {
    const derivative = lang === 'glsl' ? 'dFdx' : 'dpdxFine'
    const uniform = lang === 'glsl' ? 'uniform float time;' : '@group(0) @binding(0) var<uniform> time: f32;'
    const ifVarying = lang === 'glsl' ? 'if (gl_FragCoord.x > 0.0)' : 'if (position.x > 0.0)'
    expect(rules(program(`${ifVarying} { ${derivative}(x); }`, lang), lang)).toContain('derivative-control-flow')
    expect(rules(`${uniform}\n${program(`if (time > 0.0) { ${derivative}(x); }`, lang)}`, lang)).not.toContain('derivative-control-flow')
    expect(rules(program(`for (int i=0; i<4; i++) { ${derivative}(x); }`, lang), lang)).toContain('derivative-control-flow')
    expect(rules(program(`${derivative}(x);`, lang), lang)).not.toContain('derivative-control-flow')
  })
  it('warns about missing loop bounds and accepts explicit bounds', () => {
    expect(rules(program('for (;;) {}', lang), lang)).toContain('unbounded-loop')
    expect(rules(program('while (true) {}', lang), lang)).toContain('unbounded-loop')
    expect(rules(program('for (int i=0; i<4; i++) {}', lang), lang)).not.toContain('unbounded-loop')
    if (lang === 'wgsl') {
      expect(rules(program('loop {}', lang), lang)).toContain('unbounded-loop')
      expect(rules(program('loop { continuing { break if i >= 4; } }', lang), lang)).not.toContain('unbounded-loop')
    }
  })
  it('has no errors in every library module', () => {
    for (const m of modules) expect(checkShaderSource(m[lang], lang).filter(f => f.severity === 'error'), m.module).toEqual([])
  })
})

it('checks GLSL integer literals with float operands, without confusing integer arithmetic or explicit casts', () => {
  for (const expr of ['2 * PI', 'clamp(x, 0, 1)', 'x + 1']) {
    expect(rules(`const float PI = 3.14; void main(){ float x=0.5; ${expr}; }`, 'glsl')).toContain('integer-float-mix')
  }
  for (const expr of ['2.0 * PI', 'clamp(x, 0.0, 1.0)', 'float(2) * PI', '2 * 4']) {
    expect(rules(`const float PI = 3.14; void main(){ float x=0.5; ${expr}; }`, 'glsl')).not.toContain('integer-float-mix')
  }
  expect(rules('fn f(x: f32) { let y = 2 * x; }', 'wgsl')).not.toContain('integer-float-mix')
  expect(rules('#version 300 es\nvoid main() {}', 'glsl')).toEqual([])
})

for (const lang of languages) describe(`shader-craft bundler ${lang}`, () => {
  const calls = lang === 'glsl' ? 'float n = fbm(vec2(0.1), 4); float d = sdBox(vec2(0.1), vec2(1.0)); vec3 c = tonemapAgX(vec3(n+d));'
    : 'let n = fbm_f2i(vec2f(0.1), 4); let d = sdBox_f2f2(vec2f(0.1), vec2f(1.0)); let c = tonemapAgX(vec3f(n+d));'
  it('adds exactly the dependency closure in declaration order, with all GLSL overloads', () => {
    const roots = library.filter(e => (lang === 'glsl' ? ['fbm', 'sdBox', 'tonemapAgX'] : ['fbm_f2i', 'sdBox_f2f2', 'tonemapAgX']).includes(e[lang].name))
    const ids = new Set<string>()
    const visit = (id: string) => {
      if (ids.has(id)) return
      const e = library.find(x => x.id === id)!
      ids.add(id)
      for (const dep of e[lang].dependencies) visit(dep)
      if (lang === 'glsl') for (const overload of library.filter(x => x.glsl.name === e.glsl.name)) if (!ids.has(overload.id)) visit(overload.id)
    }
    roots.forEach(e => visit(e.id))
    const result = bundleShaderSource(program(calls, lang), lang)
    expect(result.added).toEqual(library.filter(e => ids.has(e.id)).map(e => e.id))
    const credits = [...new Set(library.filter(e => ids.has(e.id)).flatMap(e => e.credits))]
    expect(result.credits).toEqual(credits)
    expect(result.source).toContain('shader-skills')
    expect(result.source).toContain('Copyright (c) 2026 gokayfem')
    expect(result.source).toContain('e09bc993bf04201f26c03c87c89210e9b472f526')
    for (const c of creditTable.techniques) expect(result.source.includes(c.source)).toBe(credits.includes(c.key))
    expect(bundleShaderSource(result.source, lang)).toEqual({ source: result.source, added: [], credits: [] })
  })
  it('keeps self-defined functions, ignores comments and fields, and leaves unused code out', () => {
    const source = lang === 'glsl' ? 'vec3 tonemapAgX(vec3 c) { return c; } void main(){tonemapAgX(vec3(1.0));}'
      : 'fn tonemapAgX(c: vec3f) -> vec3f { return c; } fn main(){tonemapAgX(vec3f(1.0));}'
    expect(bundleShaderSource(source, lang)).toEqual({ source, added: [], credits: [] })
    expect(bundleShaderSource(program('// fbm tonemapAgX\nobj.tonemapAgX;', lang), lang).added).toEqual([])
  })
  it('requires the program scene contract rather than inventing it', () => {
    const call = 'raymarch(vec3(0.0), vec3(1.0), 0.0, 10.0, 1.0);'
    expect(() => bundleShaderSource(program(call, lang), lang)).toThrow(/map|ZERO/)
    const source = lang === 'glsl'
      ? 'precision highp float;\nuniform int frame;\n#define ZERO (min(frame, 0))\nvec2 map(vec3 p){return vec2(length(p)-1.0,1.0);}\nvoid main(){raymarch(vec3(0.0),vec3(1.0),0.0,10.0,1.0);}'
      : 'var<private> ZERO: i32; fn map(p: vec3f)->vec2f{return vec2f(length(p)-1.0,1.0);} @fragment fn main()->@location(0) vec4f { ZERO = min(0, 0); return vec4f(raymarch(vec3f(0.0),vec3f(1.0),0.0,10.0,1.0),1.0);}'
    const result = bundleShaderSource(source, lang)
    expect(result.added).toContain('raymarch(vec3,vec3,float,float,float)')
    if (lang === 'glsl') {
      expect(result.source.indexOf('#define ZERO')).toBeLessThan(result.source.indexOf('vec2 map(vec3 p);'))
      expect(result.source.indexOf('vec2 map(vec3 p);')).toBeLessThan(result.source.indexOf('vec3 raymarch('))
    }
  })
})

it('searches language-specific names and metadata with bounded results', () => {
  expect(searchShaderLibrary('fbm', { language: 'wgsl', limit: 1 })).toEqual([expect.objectContaining({ name: expect.stringMatching(/^fbm_/), signature: expect.stringMatching(/^fn /), module: 'noise', summary: expect.any(String) })])
  expect(searchShaderLibrary('nonexistentword')).toEqual([])
  expect(searchShaderLibrary('noise', { limit: 0 })).toEqual([])
})

it('exports the pure APIs from the built knowledge drop without Node imports in their modules', async () => {
  const built = await import('../../dist/knowledge/index.js')
  for (const name of ['checkShaderSource', 'bundleShaderSource', 'searchShaderLibrary'] as const) expect(typeof built[name]).toBe('function')
  expect(built.checkShaderSource('round(x)', 'glsl')[0].rule).toBe('round')
  expect(built.bundleShaderSource('tonemapAgX(vec3(1.0));', 'glsl').added).toContain('tonemapAgX(vec3)')
  for (const file of ['checker', 'bundler', 'source', 'search-library']) {
    expect(await readFile(new URL(`../knowledge/shader-craft/${file}.ts`, import.meta.url), 'utf8')).not.toMatch(/(?:from\s*|import\s*\()['"](?:node:|fs|path)/)
  }
})


it('ships a browser entry with no imports, sharing the aggregate API', async () => {
  const browser = await import('../../dist/knowledge/shader-craft.js')
  expect(browser.bundleShaderSource('tonemapAgX(vec3(1.0));', 'glsl')).toEqual(bundleShaderSource('tonemapAgX(vec3(1.0));', 'glsl'))
  const source = await readFile(new URL('../../dist/knowledge/shader-craft.js', import.meta.url), 'utf8')
  expect(source).not.toMatch(/^import\s|\bimport\(/m)
})

for (const lang of languages) it(`handles split hashes, explicit nonzero vectors and divergent helper calls in ${lang}`, () => {
  const split = lang === 'glsl' ? 'float h = sin(x) * 43758.5453; fract(h);' : 'let h = sin(x) * 43758.5453; fract(h);'
  expect(rules(program(split, lang), lang)).toContain('sine-hash')
  const vector = lang === 'glsl' ? 'vec3(1.0, 0.0, 0.0)' : 'vec3f(1.0, 0.0, 0.0)'
  expect(rules(program(`normalize(${vector});`, lang), lang)).not.toContain('nan-risk')
  const helper = lang === 'glsl' ? 'float slope(float x) { return dFdy(x); }' : 'fn slope(x:f32)->f32 { return dpdyCoarse(x); }'
  expect(rules(helper + program('if (varyingValue > 0.0) { slope(x); }', lang), lang)).toContain('derivative-control-flow')
  const changed = lang === 'glsl' ? 'float condition = 1.0; condition = gl_FragCoord.x; if (condition > 0.0) { fwidth(x); }'
    : 'var condition = 1.0; condition = position.x; if (condition > 0.0) { fwidth(x); }'
  expect(rules(program(changed, lang), lang)).toContain('derivative-control-flow')
})
it('preserves a ZERO macro following program constants and keeps dependencies out of conditional functions', () => {
  const scene = 'vec2 map(vec3 p){return vec2(length(p)-1.0,1.0);} void main(){calcNormal(vec3(1.0),0.001);}'
  const result = bundleShaderSource('precision highp float;\nconst float sceneScale=1.0;\nuniform int frame;\n#define ZERO min(frame,0)\n' + scene, 'glsl')
  expect(result.added).toContain('calcNormal(vec3,float)')
  expect(result.source.indexOf('#define ZERO')).toBeLessThan(result.source.indexOf('vec2 map(vec3 p);'))
  const conditional = bundleShaderSource('precision highp float;\n#if PRESET\nvoid helper(){tonemapAgX(vec3(1.0));}\n#endif\nvoid main(){}', 'glsl')
  expect(conditional.source.indexOf('vec3 tonemapAgX(')).toBeLessThan(conditional.source.indexOf('#if PRESET'))
})

for (const lang of languages) it(`checks conditional expressions and vector mutation without flagging branch predicates in ${lang}`, () => {
  const derivative = lang === 'glsl' ? 'dFdx' : 'dpdx'
  const varying = lang === 'glsl' ? 'gl_FragCoord.x' : 'position.x'
  expect(rules(program(`if (${derivative}(x) > 0.0) {}`, lang), lang)).not.toContain('derivative-control-flow')
  expect(rules(program(`${varying} > 0.0 && ${derivative}(x) > 0.0;`, lang), lang)).toContain('derivative-control-flow')
  if (lang === 'glsl') expect(rules(program(`${varying} > 0.0 ? dFdx(x) : 0.0;`, lang), lang)).toContain('derivative-control-flow')
  const declaration = lang === 'glsl' ? 'vec2 condition=vec2(1.0);' : 'var condition=vec2f(1.0);'
  expect(rules(program(`${declaration} condition.x=${varying}; if(condition.x>0.0){${derivative}(x);}`, lang), lang)).toContain('derivative-control-flow')
})
it('checks Shadertoy identifiers in GLSL macros while ignoring commented identifiers', () => {
  expect(rules('#define CLOCK iTime\nvoid main(){}', 'glsl')).toContain('shadertoy-contract')
  expect(rules('#define CLOCK time // iTime\nvoid main(){}', 'glsl')).not.toContain('shadertoy-contract')
})

it('checks float arithmetic in GLSL global initializers and source fragments', () => {
  expect(rules('const float doubled = 2 * PI; void main(){}', 'glsl')).toContain('integer-float-mix')
  expect(rules('2 * PI', 'glsl')).toContain('integer-float-mix')
  expect(rules('const float doubled = 2.0 * PI; void main(){}', 'glsl')).not.toContain('integer-float-mix')
})

it('prototypes caller-owned GLSL dependencies before inserted library functions', () => {
  const own = 'float hash12(vec2 p){return p.x;}'
  const bundled = bundleShaderSource(`precision highp float;\n${own}\nvoid main(){valueNoiseD(vec2(0.3));}`, 'glsl')
  expect(bundled.added).toContain('valueNoiseD(vec2)')
  expect(bundled.added).not.toContain('hash12(vec2)')
  expect(bundled.source).toContain(own)
  expect(bundled.source.indexOf('float hash12(vec2 p);')).toBeGreaterThan(-1)
  expect(bundled.source.indexOf('float hash12(vec2 p);')).toBeLessThan(bundled.source.indexOf('vec3 valueNoiseD('))
  const withPrototype = bundleShaderSource(`precision highp float;\nfloat hash12(vec2 p);\n${own}\nvoid main(){valueNoiseD(vec2(0.3));}`, 'glsl')
  expect(withPrototype.source.match(/float hash12\(vec2 p\);/g)).toHaveLength(1)
  expect(bundleShaderSource(bundled.source, 'glsl').added).toEqual([])
})
it('preserves GLSL macro definitions of library functions and dependencies', () => {
  const source = '#define tonemapAgX(c) (c)\nvoid main(){tonemapAgX(vec3(1.0));}'
  expect(bundleShaderSource(source, 'glsl')).toEqual({ source, added: [], credits: [] })
  const dependency = bundleShaderSource('#define hash12(p) ((p).x)\nvoid main(){valueNoiseD(vec2(0.3));}', 'glsl')
  expect(dependency.added).toContain('valueNoiseD(vec2)')
  expect(dependency.added).not.toContain('hash12(vec2)')
  expect(dependency.source).not.toMatch(/float hash12\(/)
})
it('checks GLSL macro expressions on their physical source lines, excluding directive syntax', () => {
  const source = '#define HASH(x) fract(sin(x)*43758.5453)\n#define ROUND(x) \\\n    round(x)\n#define iTime(mainImage) 1.0\n#ifdef iMouse\n#endif'
  const findings = checkShaderSource(source, 'glsl')
  expect(findings).toContainEqual(expect.objectContaining({ rule: 'sine-hash', line: 1 }))
  expect(findings).toContainEqual(expect.objectContaining({ rule: 'round', line: 3 }))
  expect(findings.filter(f => f.rule === 'shadertoy-contract')).toEqual([])
  expect(rules('#define HASH(x) fract(x)\n#define ROUND(x) floor(x+0.5)', 'glsl')).toEqual([])
})
for (const lang of languages) it(`treats custom helper conditions as potentially varying in ${lang}`, () => {
  const helper = lang === 'glsl' ? 'bool visible(){return gl_FragCoord.x>0.0;}'
    : 'var<private> pixel: vec4f; fn visible()->bool{return pixel.x>0.0;}'
  const body = lang === 'glsl' ? 'if(visible()){float x=dFdx(gl_FragCoord.y);}'
    : 'pixel=position; if(visible()){let x=dpdx(pixel.y);}'
  expect(rules(helper + program(body, lang), lang)).toContain('derivative-control-flow')
  expect(rules(helper.replaceAll('visible', 'all') + program(body.replaceAll('visible', 'all'), lang), lang)).toContain('derivative-control-flow')
  const uniform = lang === 'glsl' ? 'uniform float time;' : '@group(0) @binding(0) var<uniform> time:f32;'
  const derivative = lang === 'glsl' ? 'dFdx' : 'dpdx'
  expect(rules(uniform + program(`if(sin(time)>0.0){${derivative}(time);}`, lang), lang)).not.toContain('derivative-control-flow')
})
