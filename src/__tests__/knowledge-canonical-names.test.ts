import { describe, it, expect } from 'vitest'
import { DSL_EXEMPLAR_PROGRAMS, DSL_EXEMPLAR_PATTERNS } from '../knowledge/dsl-exemplars.js'
import { EFFECT_CATALOG } from '../knowledge/effect-catalog.js'

// The knowledge modules teach DSL programs that agents copy into Noisemaker.
// Noisemaker retired the paramAliases mechanism (1.0.289): every unknown
// argument now fails compilation with S001, and several ops were renamed or
// removed outright (see noisemaker shaders/tests/test_param_aliases.js).
// A knowledge program that teaches a retired name makes the model copy a
// program the engine refuses.
//
// Every pattern below was verified against the engine registry at noisemaker
// commit 6cb1a3c3e21010db956d41e7a6d57a02b0be1e7d: each banned name is absent
// from every op's argument list (global list) or from the named op's argument
// list (op-scoped list), or the op itself no longer exists. Keep this list in
// sync when Noisemaker retires more names.

// Retired parameter names, rejected by every op in the engine.
const RETIRED_KW = [
  'noiseType', 'fractalType', 'gradientType', 'paletteType',
  'skewAmt', 'lineWidth', 'backgroundType', 'opacity',
  'loopAAmp', 'loopBAmp', 'mixAmt', 'cellVariation', 'aberrationAmt',
]

// Names that survive elsewhere in the engine but are retired on this op.
const RETIRED_OP_KW: Array<[RegExp, string]> = [
  [/pattern\([^()]*\b(?:color1|color2|sharpness)\s*:/, 'pattern'],
  [/fractal\([^()]*\b(?:power|zoom)\s*:/, 'fractal'],
  [/palette\([^()]*\b(?:ampR|ampG|ampB|offsetR|offsetG|offsetB|phaseR|phaseG|phaseB|paletteType|freq)\s*:/, 'palette'],
  [/mnca\([^()]*\b(?:ruleIndex|stateSize)\s*:/, 'mnca'],
]

// Ops the engine no longer registers (canonical replacements in parentheses):
// background (gradient, pattern), ca (cellularAutomata), rd (reactionDiffusion),
// ca3d (cellularAutomata3d), rd3d (reactionDiffusion3d). synth/shape still
// exists (loopAOffset/loopBOffset), so shape( is NOT banned.
const RETIRED_OPS = /(?:^|[^.\w])(background|ca3d|rd3d|ca|rd)\s*\(/g

// The catalog also lists bare op names in its comma-separated sections. Detect
// retired ops as standalone list items so a catalog line like "... rd, roll, ca,
// ..." fails too. Short tokens (rd, ca, rd3d, ca3d) do not occur as prose words;
// background as a list item is matched against comma/line boundaries so prose
// like "background color" still passes.
const RETIRED_OPS_BARE = /(?:^|\n|,\s*)(?:rd3d|ca3d|rd|ca)\s*(?=$|,|\n)/gm
const RETIRED_OP_BACKGROUND_BARE = /(?:^|\n|,\s*)background\s*(?=$|,|\n)/gm

// The catalog's classicNoisedeck section must list only ops that namespace
// registers. Verified against the 20 classicNoisedeck effect directories at
// noisemaker 6cb1a3c: these ops live only in other namespaces (synth, filter)
// or are gone, and a catalog-guided program with
// `search classicNoisedeck` plus one of them fails S001 Unknown effect.
const CLASSIC_SECTION = /### CLASSIC EFFECTS \(classicNoisedeck namespace\)\n(?:(?!###)[\s\S])*/
const NOT_IN_CLASSIC = /\b(pattern|palette|quadTap|tunnel|warp|depthOfField|displaceMixer)\b/
const PHANTOM_NAMESPACE = /classicNoisemaker/

const sources: Array<[string, string]> = [
  ['DSL_EXEMPLAR_PATTERNS', DSL_EXEMPLAR_PATTERNS],
  ['EFFECT_CATALOG', EFFECT_CATALOG],
  ...DSL_EXEMPLAR_PROGRAMS.map((p): [string, string] => [`program ${p.name}`, p.dsl]),
]

const globalKwRe = new RegExp(`\\w+\\s*\\([^()]*\\b(?:${RETIRED_KW.join('|')})\\s*:`)

function findOffenders(text: string): string[] {
  const hits: string[] = []
  const kw = text.match(globalKwRe)
  if (kw) hits.push(`retired kw in: ${kw[0].slice(0, 80)}`)
  for (const [re, op] of RETIRED_OP_KW) {
    const m = text.match(re)
    if (m) hits.push(`retired kw on ${op} in: ${m[0].slice(0, 80)}`)
  }
  for (const m of text.matchAll(RETIRED_OPS)) {
    hits.push(`retired op '${m[1]}(' in: ${m[0].slice(0, 60)}`)
  }
  for (const m of text.matchAll(RETIRED_OPS_BARE)) {
    hits.push(`retired bare op '${m[0].trim()}' in: ${m[0].slice(0, 60)}`)
  }
  for (const m of text.matchAll(RETIRED_OP_BACKGROUND_BARE)) {
    hits.push(`retired bare op 'background' in: ${m[0].slice(0, 60)}`)
  }
  return hits
}

describe('knowledge programs use engine-current DSL names', () => {
  it('no exemplar program, pattern, or catalog entry teaches retired names', () => {
    const offenders: string[] = []
    for (const [label, text] of sources) {
      offenders.push(...findOffenders(text).map(h => `${label}: ${h}`))
    }
    expect(offenders).toEqual([])
  })

  it('classicNoisedeck catalog section lists only registered ops', () => {
    const section = EFFECT_CATALOG.match(CLASSIC_SECTION)?.[0] ?? ''
    expect(section).not.toEqual('')
    const listed = section.match(NOT_IN_CLASSIC)
    expect(listed).toBeNull()
    const phantom = EFFECT_CATALOG.match(PHANTOM_NAMESPACE)
    expect(phantom).toBeNull()
  })
})