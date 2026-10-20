import { SHADER_CRAFT_LIBRARY } from './library/index.js'
import type { ShaderCraftLanguage, ShaderCraftModuleName } from './library/types.js'

export interface ShaderLibrarySearchOptions { language?: ShaderCraftLanguage; limit?: number }
export interface ShaderLibrarySearchResult {
  id: string
  language: ShaderCraftLanguage
  name: string
  signature: string
  summary: string
  module: ShaderCraftModuleName
}
/** Search the local symbol index by name, signature, module and summary. Default language GLSL, limit 15. */
export function searchShaderLibrary(query: string, options: ShaderLibrarySearchOptions = {}): ShaderLibrarySearchResult[] {
  const language = options.language ?? 'glsl', words = query.toLowerCase().match(/[\w]+/g) ?? []
  const limit = Number.isFinite(options.limit) ? Math.max(0, Math.floor(options.limit!)) : 15
  if (!words.length || !limit) return []
  return SHADER_CRAFT_LIBRARY.map(e => {
    const name = e[language].name.toLowerCase(), text = `${e[language].signature} ${e.summary} ${e.module}`.toLowerCase()
    const score = (e.kind === 'function' ? 0.1 : 0) + words.reduce((score, word) => score + (name === word ? 10 : name.includes(word) ? 5 : 0) + (text.includes(word) ? 1 : 0), 0)
    return { score, result: { id: e.id, language, name: e[language].name, signature: e[language].signature, summary: e.summary, module: e.module } }
  }).filter(e => e.score >= 1).sort((a, b) => b.score - a.score).slice(0, limit).map(e => e.result)
}
