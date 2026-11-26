import type { EffectDefinition } from './types.js'
import { normalizeGlobal, normalizePass } from './normalize.js'

// The marker of a version 2 Portable package. A definition.json with no
// `format` field is read as a 1.x definition, by the reduced projection in
// parseDefinitionJson.
export const PORTABLE_FORMAT = 'noisemaker-portable-effect'
export const PORTABLE_VERSION = 2

// The top-level fields that the version 2 reader keeps, beside func, name,
// namespace, description, starter and tags, which the 1.x projection reads too.
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

// The keys of Object.prototype, and "prototype". A parameter named __proto__
// would replace the prototype of the parameters object.
const RESERVED_NAMES = [...Object.getOwnPropertyNames(Object.prototype), 'prototype']

// A copy of the object without its fields whose value is undefined.
function declaredFields<T extends object>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, field]) => field !== undefined)) as T
}

// Reads a version 2 package: a definition.json whose `format` field is set.
//
// It throws when:
// - format is not PORTABLE_FORMAT;
// - version is left out, or is not PORTABLE_VERSION;
// - passes is not an object, or is an array;
// - globals is set and is not an object, or is an array;
// - a parameter or a pass is not an object, or is an array;
// - a parameter or a pass is named with a RESERVED_NAMES entry.
//
// The definition it returns:
// - Keeps, as the package's own values: name, namespace, description,
//   starter, tags, the PACKAGE_FIELDS, and func unless func is null.
// - Drops version, and every top-level field that no item of this list names.
// - Sets format to 'json' and effectDir to the effect directory.
// - Sets func to the value of name when func is null or left out.
// - Sets globals to {} when the package leaves globals out.
// - Gives each parameter every field it declares, with these set on top by
//   normalizeGlobal: name, set to the parameter's key; uniform, set to the key
//   when uniform is falsy; and type, set to 'float' when type is falsy.
// - Reads passes as a list, in the order of Object.entries: names that are
//   array indices first, in numeric order, then the other names in
//   declaration order.
// - Gives each pass every field it declares, with these set on top by
//   normalizePass: name, set to the pass's key; and program, set to 'main'
//   when program is falsy.
// - Carries no field whose value is undefined, at the top level, in a
//   parameter or in a pass. Such fields come from the projection and the
//   object literal below, for what the package leaves out. JSON holds no
//   undefined value, so a package parsed from JSON loses no field this way.
// Nested values, such as a parameter's ui or a texture, are the package's own
// objects. The package itself is not changed.
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
