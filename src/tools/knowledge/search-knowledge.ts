import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { ShaderKnowledgeDB } from '../../knowledge/vector-db.js'
import { SEARCHABLE_KNOWLEDGE, expandQueryWithSynonyms } from '../../knowledge/shader-knowledge.js'
import { toolResult } from '../tool-result.js'

let db: ShaderKnowledgeDB | null = null

function getDB(): ShaderKnowledgeDB {
  if (!db) {
    db = new ShaderKnowledgeDB()
    db.addDocuments(SEARCHABLE_KNOWLEDGE)
    db.buildIndex()
  }
  return db
}

export const searchShaderKnowledgeSchema = {
  query: z.string().describe('Natural language query'),
  category: z.string().optional().describe('Filter by category (dsl, glsl, technique, errors, shader-craft, etc.)'),
  limit: z.number().optional().default(5).describe('Maximum results'),
}

export function registerSearchShaderKnowledge(server: McpServer): void {
  server.tool(
    'searchShaderKnowledge',
    'Search curated shader documentation by meaning: DSL grammar, GLSL techniques, effect patterns, common errors, and the shader-craft references (workflow, subject routing, SDF modeling, noise, terrain, water, rendering pipeline, library functions, recreating a reference video).',
    searchShaderKnowledgeSchema,
    async (args: any) => {
      const database = getDB()
      const expanded = expandQueryWithSynonyms(args.query)
      const results = database.search(expanded, {
        limit: args.limit,
        category: args.category,
        minScore: 0.05,
      })

      const output = {
        query: args.query,
        category: args.category || 'all',
        matchCount: results.length,
        databaseStats: database.getStats(),
        results: results.map((r, i) => ({
          title: r.title,
          category: r.category,
          score: r.score,
          snippet: r.snippet,
          tags: r.tags,
          content: i < 3 ? r.content : undefined,
        })),
      }
      return toolResult(output)
    }
  )
}
