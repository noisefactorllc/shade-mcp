import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { BrowserSession, effectSelectionProblem } from '../../harness/browser-session.js'
import type { CompileResult } from '../../harness/types.js'
import { getConfig } from '../../config.js'
import { resolveEffectIds } from '../resolve-effects.js'
import { toolResult } from '../tool-result.js'

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}


export const compileEffectSchema = {
  effect_id: z.string().optional().describe('One effect ID, such as "synth/noise"'),
  effects: z.string().optional().describe('Comma-separated effect IDs'),
  backend: z.enum(['webgl2', 'webgpu']).default('webgl2').describe('Rendering backend'),
}

export async function compileEffect(
  session: BrowserSession,
  effectId: string,
): Promise<CompileResult> {
  return session.runWithConsoleCapture(async () => {
    // The switch must actually take effect: setBackend rejects when the page
    // backend never reaches the target (issue #34).
    try {
      await session.setBackend(session.backend)
    } catch (err) {
      // Bind even this failure to what the page actually holds (issue #34).
      const page = await session.readPageIdentity()
      return {
        status: 'error' as const,
        passes: [],
        message: `Backend switch failed: ${errorMessage(err)}`,
        backend: page.backend ?? 'unknown',
        ...(page.effectId ? { effect_id: page.effectId } : {}),
      }
    }

    // Select and wait until the page finished building THIS effect (issue
    // #34). The old wait matched viewer status text — "loaded/compiled/ready"
    // — which still describes the previous effect right after a selection, so
    // the verb could report the previous graph as a fresh ok.
    const selection = await session.selectEffect(effectId)
    const problem = effectSelectionProblem(selection, effectId, session.backend)
    if (problem) {
      return {
        status: 'error' as const,
        passes: selection.passes ?? [],
        message: problem,
        backend: selection.backend,
        ...(selection.effectId ? { effect_id: selection.effectId } : {}),
      }
    }

    return {
      status: 'ok' as const,
      passes: selection.passes ?? [{ id: 'main', status: 'ok' as const }],
      message: 'Compiled successfully',
      // The backend the page reported, not the requested value.
      backend: selection.backend,
      ...(selection.effectId ? { effect_id: selection.effectId } : {}),
    }
  })
}

export function registerCompileEffect(server: McpServer): void {
  server.tool(
    'compileEffect',
    'Compile a shader effect. Return diagnostics for each pass. Use comma-separated effect IDs for a batch.',
    compileEffectSchema,
    async (args: any) => {
      const config = getConfig()
      const session = new BrowserSession({ backend: args.backend })
      try {
        await session.setup()
        const effectIds = resolveEffectIds(args, config.effectsDir)

        const results = []
        for (const id of effectIds) {
          try {
            results.push({ effect_id: id, ...await compileEffect(session, id) })
          } catch (err) {
            results.push({ effect_id: id, status: 'error', error: err instanceof Error ? err.message : String(err) })
          }
        }
        return toolResult(results.length === 1 ? results[0] : results)
      } finally {
        await session.teardown()
      }
    }
  )
}
