import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { getSharedEffectIndex } from '../../knowledge/shared-instances.js'
import { toolResult } from '../tool-result.js'

export const listEffectsSchema = {
  namespace: z.string().optional().describe('Filter by namespace'),
}

export function registerListEffects(server: McpServer): void {
  server.tool(
    'listEffects',
    'List all effects, optionally filtered by namespace.',
    listEffectsSchema,
    async (args: any) => {
      const index = await getSharedEffectIndex()
      const effects = index.list(args.namespace)

      const output = {
        namespace: args.namespace || 'all',
        count: effects.length,
        effects: effects.map(e => ({
          id: e.id,
          name: e.def.name || e.def.func,
          description: e.def.description || '',
          tags: e.def.tags || [],
          passes: e.def.passes.length,
          ...(e.def.partial && { partial: true }),
        })),
      }
      return toolResult(output)
    }
  )
}
