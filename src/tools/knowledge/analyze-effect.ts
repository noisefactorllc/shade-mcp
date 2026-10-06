import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { loadEffectDefinition } from '../../formats/index.js'
import { getConfig } from '../../config.js'
import { resolveEffectDir } from '../resolve-effects.js'
import { toolResult } from '../tool-result.js'

export const analyzeEffectSchema = {
  effect_id: z.string().describe('Effect ID (e.g., "synth/noise")'),
}

export function registerAnalyzeEffect(server: McpServer): void {
  server.tool(
    'analyzeEffect',
    'Return the full definition, shader source, uniforms, and passes for an effect.',
    analyzeEffectSchema,
    async (args: any) => {
      const config = getConfig()
      const effectDir = resolveEffectDir(args.effect_id, config.effectsDir)

      if (!existsSync(effectDir)) {
        return toolResult({ error: `Effect not found: ${args.effect_id}` })
      }

      let def: any
      try {
        def = loadEffectDefinition(effectDir)
      } catch (err: any) {
        return toolResult({ error: err.message })
      }

      // Read shader sources
      const shaders: Record<string, string> = {}
      const glslDir = join(effectDir, 'glsl')
      const wgslDir = join(effectDir, 'wgsl')

      if (existsSync(glslDir)) {
        for (const f of readdirSync(glslDir).filter(f => f.endsWith('.glsl'))) {
          shaders[`glsl/${f}`] = readFileSync(join(glslDir, f), 'utf-8')
        }
      }
      if (existsSync(wgslDir)) {
        for (const f of readdirSync(wgslDir).filter(f => f.endsWith('.wgsl'))) {
          shaders[`wgsl/${f}`] = readFileSync(join(wgslDir, f), 'utf-8')
        }
      }

      const output = {
        effectId: args.effect_id,
        name: def.name,
        description: def.description,
        namespace: def.namespace,
        tags: def.tags || [],
        globals: def.globals,
        passes: def.passes,
        format: def.format,
        ...(def.partial && { partial: true, partialReasons: def.partialReasons }),
        shaders,
      }

      return toolResult(output)
    }
  )
}
