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

// Names that reach an object's prototype. The engine refuses a package that
// uses one as a key, and a parameter so named would replace the prototype of
// the parameters object here.
const RESERVED_NAMES = [...Object.getOwnPropertyNames(Object.prototype), 'prototype']

// The shared projection sets every field it knows, and a field that it has
// no value or default for is set to undefined. Those fields are dropped, so a
// version 2 definition, its parameters and its passes carry no field that is
// set to undefined.
function declaredFields<T extends object>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, field]) => field !== undefined)) as T
}

// A version 2 package keeps every field it declares. Its passes are an object
// keyed by pass name, in declaration order, and are read as a list in that
// order, each with its name. Each parameter and each pass keeps all of its
// fields, with the shared projection's values on top: a parameter's name,
// its uniform and its type, and a pass's name and its program. The
// projection adds no other field that the package leaves out.
function parsePortablePackage(json: Record<string, unknown>, effectDir: string): EffectDefinition {
  if (json.format !== PORTABLE_FORMAT) {
    throw new Error(`definition.json: format ${JSON.stringify(json.format)} is not supported; a version ${PORTABLE_VERSION} package states "format": "${PORTABLE_FORMAT}"`)
  }
  if (json.version === undefined) {
    throw new Error(`definition.json: a package with a format marker states version ${PORTABLE_VERSION}`)
  }
  if (json.version !== PORTABLE_VERSION) {
    throw new Error(`definition.json: version ${JSON.stringify(json.version)} is not supported; this reader reads version ${PORTABLE_VERSION}`)
  }
  if (!isRecord(json.passes)) {
    throw new Error(`definition.json: passes must be an object keyed by pass name in a version ${PORTABLE_VERSION} package`)
  }

  const globals: EffectDefinition['globals'] = {}
  const rawGlobals = json.globals === undefined ? {} : json.globals
  if (!isRecord(rawGlobals)) throw new Error('definition.json: globals must be an object of parameters')
  for (const [key, spec] of Object.entries(rawGlobals)) {
    if (RESERVED_NAMES.includes(key)) throw new Error(`definition.json: globals.${key}: a parameter name may not be a reserved name`)
    if (!isRecord(spec)) throw new Error(`definition.json: globals.${key} must be a parameter object`)
    globals[key] = declaredFields({ ...spec, ...normalizeGlobal(key, spec) })
  }

  const passes: EffectDefinition['passes'] = []
  for (const [name, pass] of Object.entries(json.passes)) {
    if (RESERVED_NAMES.includes(name)) throw new Error(`definition.json: passes.${name}: a pass name may not be a reserved name`)
    if (!isRecord(pass)) throw new Error(`definition.json: passes.${name} must be a pass object`)
    passes.push(declaredFields({ ...pass, ...normalizePass({ ...pass, name }) }))
  }

  const fields: Record<string, unknown> = {}
  for (const field of PACKAGE_FIELDS) {
    if (Object.hasOwn(json, field)) fields[field] = json[field]
  }

  return declaredFields({
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
    format: 'json' as const,
    effectDir,
  })
}
