import type { EffectPass, EffectUniform } from './types.js'

// One projection of a raw global spec and a raw pass, shared by the JSON and
// JS parsers so the same effect yields the same EffectDefinition in either
// file format.

export function normalizeGlobal(key: string, spec: Record<string, unknown>): EffectUniform {
  return {
    name: key,
    type: (spec.type as EffectUniform['type']) || 'float',
    uniform: (spec.uniform as string) || key,
    default: spec.default,
    min: spec.min as number | undefined,
    max: spec.max as number | undefined,
    step: spec.step as number | undefined,
    choices: spec.choices as Record<string, unknown> | undefined,
    control: spec.control as boolean | undefined,
    define: spec.define as string | undefined,
    ui: spec.ui as Record<string, unknown> | undefined,
  }
}

export function normalizePass(p: Record<string, unknown>): EffectPass {
  return {
    name: p.name as string | undefined,
    program: (p.program as string) || 'main',
    type: p.type as EffectPass['type'],
    inputs: p.inputs as Record<string, string> | undefined,
    outputs: p.outputs as Record<string, string> | undefined,
  }
}
