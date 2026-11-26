import type { EffectDefinition } from './types.js'
import { normalizeGlobal, normalizePass } from './normalize.js'

// The marker of a version 2 Portable package. A definition.json with no
// `format` field is a 1.x definition, and its reading is unchanged.
export const PORTABLE_FORMAT = 'noisemaker-portable-effect'
export const PORTABLE_VERSION = 2

// The top-level fields of a version 2 package that the reader keeps as the
// package states them, in addition to the fields every definition has.
const PACKAGE_FIELDS = [
  'feature', 'hidden', 'deprecatedBy', 'openCategories',
  'textures', 'textures3d', 'uniformLayout', 'uniformLayouts', 'defaultProgram',
  'externalTexture', 'externalMesh', 'builtinMeshes', 'outputTex3d', 'outputGeo',
] as const

export function parseDefinitionJson(json: Record<string, unknown>, effectDir: string): EffectDefinition {
  if (json.format !== undefined) return parsePortablePackage(json, effectDir)

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

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

// A version 2 package keeps every field it declares. Its passes are an object
// keyed by pass name, in declaration order, and are read as a list in that
// order, each with its name. Each parameter and each pass keeps all of its
// fields, with the shared projection's defaults applied on top.
function parsePortablePackage(json: Record<string, unknown>, effectDir: string): EffectDefinition {
  if (json.format !== PORTABLE_FORMAT) {
    throw new Error(`definition.json: format ${JSON.stringify(json.format)} is not supported; a version ${PORTABLE_VERSION} package states "format": "${PORTABLE_FORMAT}"`)
  }
  if (json.version !== PORTABLE_VERSION) {
    throw new Error(`definition.json: version ${String(JSON.stringify(json.version))} is not supported; this reader reads version ${PORTABLE_VERSION}`)
  }
  if (!isRecord(json.passes)) {
    throw new Error(`definition.json: passes must be an object keyed by pass name in a version ${PORTABLE_VERSION} package`)
  }

  const globals: EffectDefinition['globals'] = {}
  const rawGlobals = json.globals === undefined ? {} : json.globals
  if (!isRecord(rawGlobals)) throw new Error('definition.json: globals must be an object of parameters')
  for (const [key, spec] of Object.entries(rawGlobals)) {
    if (!isRecord(spec)) throw new Error(`definition.json: globals.${key} must be a parameter object`)
    globals[key] = { ...spec, ...normalizeGlobal(key, spec) }
  }

  const passes: EffectDefinition['passes'] = []
  for (const [name, pass] of Object.entries(json.passes)) {
    if (!isRecord(pass)) throw new Error(`definition.json: passes.${name} must be a pass object`)
    passes.push({ ...pass, ...normalizePass({ ...pass, name }) })
  }

  const fields: Record<string, unknown> = {}
  for (const field of PACKAGE_FIELDS) {
    if (Object.hasOwn(json, field)) fields[field] = json[field]
  }

  return {
    // A version 2 package may leave func out; its name is then the func.
    func: (json.func ?? json.name) as string,
    name: json.name as string | undefined,
    namespace: json.namespace as string | undefined,
    description: json.description as string | undefined,
    starter: json.starter as boolean | undefined,
    tags: json.tags as string[] | undefined,
    globals,
    passes,
    ...fields,
    format: 'json',
    effectDir,
  }
}
