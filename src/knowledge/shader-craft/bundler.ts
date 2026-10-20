import { SHADER_CRAFT_LIBRARY, SHADER_CRAFT_LIBRARY_PROGRAM_SYMBOLS, getShaderCraftSymbolSource } from './library/index.js'
import type { ShaderCraftLanguage } from './library/types.js'
import { SHADER_CRAFT_CREDITS } from './credits.js'
import { tokenize, scanTopLevel } from './source.js'

export interface BundledShaderSource {
  /** Self-contained source, with one upstream and technique credit block when symbols were added. */
  source: string
  /** Newly inserted symbol IDs in dependency order; empty on an unchanged or already bundled program. */
  added: string[]
  /** Technique credit keys for the newly inserted symbols, in library order. */
  credits: string[]
}
const CREDIT_BLOCK = /\/\* shader-craft credits\n[\s\S]*?\*\//

/**
 * Inline only referenced library symbols and their dependencies. GLSL includes every overload of each required
 * name; WGSL uses exact names. Program definitions win. Throws when a required map/ZERO contract is absent;
 * it never invents scene geometry, frame uniforms or an entry-point initialization.
 */
export function bundleShaderSource(source: string, language: ShaderCraftLanguage): BundledShaderSource {
  const tokens = tokenize(source, language), items = scanTopLevel(source, language, tokens)
  const byId = new Map(SHADER_CRAFT_LIBRARY.map(e => [e.id, e]))
  const definitions = new Set<string>(), definedNames = new Set<string>()
  for (const item of items) {
    if (item.kind === 'prototype') continue
    if (item.kind === 'function') {
      definedNames.add(item.name!)
      definitions.add(language === 'glsl' ? `${item.name}(${item.params!.map(p => p.type).join(',')})` : item.name!)
    } else {
      if (item.name) { definedNames.add(item.name); definitions.add(item.name) }
      for (const d of item.declarators ?? []) { definedNames.add(d.name); definitions.add(d.name) }
    }
  }
  const own = (id: string) => {
    const e = byId.get(id)!
    return definitions.has(language === 'glsl' && e.kind === 'function' ? e.id : e[language].name)
  }
  const byName = new Map<string, typeof SHADER_CRAFT_LIBRARY>()
  for (const e of SHADER_CRAFT_LIBRARY) byName.set(e[language].name, [...byName.get(e[language].name) ?? [], e])
  const required = new Set<string>(), visiting = new Set<string>()
  const include = (id: string) => {
    if (own(id) || required.has(id) || visiting.has(id)) return
    visiting.add(id)
    const entry = byId.get(id)!
    for (const dep of entry[language].dependencies) include(dep)
    required.add(id)
    // GLSL overload resolution is compiler work: retain all signatures of a referenced name.
    if (language === 'glsl') for (const overload of byName.get(entry.glsl.name)!) include(overload.id)
    visiting.delete(id)
  }
  tokens.forEach((token, i) => {
    if (token.kind === 'directive') {
      const item = items.find(item => item.first === i)
      if (item?.macroBody) for (const ref of tokenize(item.macroBody, language)) for (const entry of byName.get(ref.text) ?? []) include(entry.id)
      return
    }
    if (token.kind !== 'ident' || tokens[i - 1]?.text === '.') return
    const entries = byName.get(token.text)
    if (!entries) return
    for (const entry of entries) {
      if (entry.kind === 'function' && tokens[i + 1]?.text !== '(') continue
      // A declaration itself is not a reference. Calls within its body are still scanned.
      const declaration = items.find(item => item.name === token.text && i >= item.first && i <= item.last &&
        (item.kind !== 'function' || i < item.bodyOpen!))
      if (declaration) continue
      include(entry.id)
    }
  })
  const added = SHADER_CRAFT_LIBRARY.filter(e => required.has(e.id)).map(e => e.id)
  if (!added.length) return { source, added: [], credits: [] }
  const requires = new Set(added.flatMap(id => byId.get(id)![language].requires))
  for (const name of requires) {
    if (!definedNames.has(name)) throw new Error(`Shader-craft requires program symbol ${name}: ${SHADER_CRAFT_LIBRARY_PROGRAM_SYMBOLS.find(p => p.name === name)?.[language]}`)
  }
  if (language === 'wgsl' && requires.has('ZERO') && !items.some(item => item.stage &&
    tokens.slice(item.bodyOpen! + 1, item.bodyClose).some((t, i, body) => t.text === 'ZERO' && body[i + 1]?.text === '='))) {
    throw new Error('Shader-craft requires ZERO initialization in the WGSL entry point: ZERO = min(i32(frame), 0); use the program frame uniform.')
  }
  const credits = [...new Set(added.flatMap(id => byId.get(id)!.credits))]
  const oldBlock = CREDIT_BLOCK.exec(source)
  const oldIds: string[] = oldBlock ? JSON.parse(/Included symbols: (\[[^\n]*\])/.exec(oldBlock[0])?.[1] ?? '[]') : []
  const allIds = SHADER_CRAFT_LIBRARY.filter(e => oldIds.includes(e.id) || required.has(e.id)).map(e => e.id)
  const allCredits = new Set(allIds.flatMap(id => byId.get(id)!.credits))
  const header = `/* shader-craft credits\n${SHADER_CRAFT_CREDITS.adaptedFrom}\nIncluded symbols: ${JSON.stringify(allIds)}\n` +
    SHADER_CRAFT_CREDITS.techniques.filter(c => allCredits.has(c.key)).map(c => `${c.key}: ${c.source}; ${c.terms}.`).join('\n') + '\n*/'
  const firstFunction = items.find(item => item.kind === 'function')
  let cut = firstFunction?.start ?? source.length
  // Never hide library declarations inside a program's preprocessor conditional.
  if (firstFunction?.depth) {
    const opening = items.find(item => item.start < cut && item.depth === 0 && ['if', 'ifdef', 'ifndef'].includes(item.directive ?? ''))
    if (opening) cut = opening.start
  }
  // GLSL module initializers may reference library constants. Keep ordinary declarations after the library,
  // while preserving version/precision/uniform/input/output directives and the ZERO program definition.
  const addedNames = new Set(added.map(id => byId.get(id)![language].name))
  if (language === 'glsl') for (const item of items) {
    if (item.start >= cut) break
    if (item.kind === 'declaration' && !['precision', 'uniform', 'in', 'out', 'layout'].includes(item.storage ?? '') && item.name !== 'ZERO' &&
      tokens.slice(item.first, item.last + 1).some(t => addedNames.has(t.text))) { cut = item.start; break }
  }
  if (language === 'glsl' && requires.has('ZERO')) {
    const zero = items.find(i => i.name === 'ZERO')!
    if (zero.start >= cut) throw new Error('Define ZERO in the GLSL preamble before the first function or library-dependent initializer.')
  }
  const prototype = language === 'glsl' && requires.has('map') && !items.some(i => i.kind === 'prototype' && i.name === 'map' && i.start < cut)
    ? 'vec2 map(vec3 p);\n\n' : ''
  const library = added.map(id => getShaderCraftSymbolSource(id, language)).join('\n\n')
  let result = source.slice(0, cut) + '\n' + (oldBlock ? '' : header + '\n\n') + prototype + library + '\n\n' + source.slice(cut)
  if (oldBlock) result = result.replace(CREDIT_BLOCK, header)
  return { source: result, added, credits }
}
