import type { EffectDefinition } from './types.js'
import { normalizeGlobal, normalizePass } from './normalize.js'

export function parseDefinitionJson(json: Record<string, unknown>, effectDir: string): EffectDefinition {
  const globals: EffectDefinition['globals'] = {}
  const rawGlobals = (json.globals || {}) as Record<string, Record<string, unknown>>

  for (const [key, spec] of Object.entries(rawGlobals)) {
    globals[key] = normalizeGlobal(key, spec)
  }

  const rawPasses = (json.passes || []) as Array<Record<string, unknown>>
  const passes: EffectDefinition['passes'] = rawPasses.map(normalizePass)

  return {
    func: json.func as string,
    name: json.name as string | undefined,
    namespace: json.namespace as string | undefined,
    description: json.description as string | undefined,
    starter: json.starter as boolean | undefined,
    tags: json.tags as string[] | undefined,
    globals,
    passes,
    format: 'json',
    effectDir,
  }
}
