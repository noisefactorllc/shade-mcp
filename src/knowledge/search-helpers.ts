import { ShaderKnowledgeDB } from './vector-db.js'
import type { KnowledgeDocument, SearchResult } from './vector-db.js'
import { expandQueryWithSynonyms, SEARCHABLE_KNOWLEDGE } from './shader-knowledge.js'
import { SHADER_CRAFT_CATEGORY } from './shader-craft/index.js'
import { CRITICAL_RULES } from './innate-knowledge.js'

let dbInstance: ShaderKnowledgeDB | null = null

/**
 * Get the shader knowledge database singleton.
 * Initializes from the curated knowledge and the shader-craft references on first call.
 */
export function getShaderKnowledgeDB(): ShaderKnowledgeDB {
  if (!dbInstance) {
    dbInstance = new ShaderKnowledgeDB()
    dbInstance.addDocuments(SEARCHABLE_KNOWLEDGE)
    dbInstance.buildIndex()
  }
  return dbInstance
}

/**
 * Search shader knowledge with synonym expansion.
 */
export function searchShaderKnowledge(
  query: string,
  options: { limit?: number; category?: string; minScore?: number } = {}
): SearchResult[] {
  const db = getShaderKnowledgeDB()
  const expandedQuery = expandQueryWithSynonyms(query)
  return db.search(expandedQuery, options)
}

/**
 * Get knowledge documents by topic category.
 */
export function getKnowledgeByTopic(topic: string): KnowledgeDocument[] {
  const db = getShaderKnowledgeDB()
  return db.getByCategory(topic)
}

// -- Helper functions for retrieveForAgent --

function extractCodeBlocks(text: string): string[] {
  const codeBlocks: string[] = []
  const glslRegex = /```glsl\s*([\s\S]*?)```/gi
  let match
  while ((match = glslRegex.exec(text)) !== null) {
    if (match[1].trim().length > 20) codeBlocks.push(match[1].trim())
  }
  const genericRegex = /```\s*([\s\S]*?)```/gi
  while ((match = genericRegex.exec(text)) !== null) {
    const code = match[1].trim()
    if ((code.includes('vec') || code.includes('float') || code.includes('fragColor'))
        && code.length > 20 && !codeBlocks.includes(code)) {
      codeBlocks.push(code)
    }
  }
  return codeBlocks
}

function extractUniformsSummary(content: string): string {
  const uniformsMatch = content.match(/globals["\s:]+\{([\s\S]*?)\}/i)
  if (!uniformsMatch) return ''
  const uniformsSection = uniformsMatch[1]
  const uniforms: string[] = []
  const uniformPattern = /"?(\w+)"?\s*:\s*\{\s*"?type"?\s*:\s*"?(\w+)"?/g
  let match
  while ((match = uniformPattern.exec(uniformsSection)) !== null) {
    uniforms.push(`${match[1]}: ${match[2]}`)
  }
  return uniforms.length > 0 ? `Uniforms: ${uniforms.join(', ')}` : ''
}

/**
 * Smart RAG retrieval for agent system prompts.
 * Returns phase-specific context with critical rules and relevant examples.
 */
export function retrieveForAgent(
  query: string,
  phase: 'generate' | 'fix',
  context: { technique?: string; error?: string } = {}
): string {
  const db = getShaderKnowledgeDB()
  let result = CRITICAL_RULES[phase] || ''

  const expandedQuery = expandQueryWithSynonyms(query)
  let searchQuery = expandedQuery
  if (context.technique) searchQuery += ` ${context.technique}`
  if (context.error) searchQuery += ` fix ${context.error}`

  const categoryBoosts = phase === 'generate'
    ? { effect: 1.5, glsl: 1.3, technique: 1.2 } as Record<string, number>
    : { errors: 1.5, documentation: 1.2, glsl: 1.1 } as Record<string, number>

  // Shader-craft references are read on demand through searchShaderKnowledge,
  // never injected into a prompt unasked, so they are left out here.
  const rawResults = db.search(searchQuery, { limit: Number.MAX_SAFE_INTEGER, minScore: 0.03 })
    .filter(r => r.category !== SHADER_CRAFT_CATEGORY)
    .slice(0, 8)

  const boostedResults = rawResults
    .map(r => ({ ...r, boostedScore: r.score * (categoryBoosts[r.category] || 1.0) }))
    .sort((a, b) => b.boostedScore - a.boostedScore)
    .slice(0, 4)

  if (boostedResults.length === 0) return result

  result += '\n## RELEVANT EXAMPLES & PATTERNS\n\n'

  for (const r of boostedResults) {
    result += `### ${r.title || r.id} (${r.category})\n`

    const uniforms = extractUniformsSummary(r.content)
    if (uniforms) result += `${uniforms}\n`

    const dslMatch = r.content.match(/## Usage in DSL\s*```\s*([\s\S]*?)```/i)
    if (dslMatch) result += `DSL: \`${dslMatch[1].trim().replace(/\n/g, ' → ')}\`\n`

    const codeBlocks = extractCodeBlocks(r.content)
    if (codeBlocks.length > 0) {
      result += `\`\`\`glsl\n${codeBlocks.slice(0, 2).join('\n\n')}\n\`\`\`\n`
    } else {
      const paragraphs = r.content.split(/\n\n+/).filter((p: string) =>
        p.length > 30 && !p.startsWith('#') && !p.startsWith('```')
      )
      if (paragraphs.length > 0) result += `${paragraphs[0].substring(0, 400)}\n`
    }

    result += '\n'
  }

  return result
}
