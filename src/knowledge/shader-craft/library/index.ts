// The shader-craft building-block library: the shader-skills GLSL library adapted to the Noisemaker effect
// contract, with a WGSL twin of every symbol, and a machine-readable index of both.
//
// Library code reads no uniforms, built-ins or textures, only its parameters, so it works in any pass of an
// effect.

import { LIBRARY_INDEX_MODULES } from '../references/library-index.js'
import { SHADER_CRAFT_LIBRARY } from './symbols.js'
import type {
  ShaderCraftLanguage,
  ShaderCraftLibraryModule,
  ShaderCraftLibrarySymbol,
  ShaderCraftModuleName,
  ShaderCraftProgramSymbol,
} from './types.js'
import { ARCHITECTURE_GLSL, ARCHITECTURE_WGSL } from './modules/architecture.js'
import { ATMOSPHERE_GLSL, ATMOSPHERE_WGSL } from './modules/atmosphere.js'
import { CAMERA_GLSL, CAMERA_WGSL } from './modules/camera.js'
import { COLOR_GLSL, COLOR_WGSL } from './modules/color.js'
import { COMMON_GLSL, COMMON_WGSL } from './modules/common.js'
import { DEBUG_GLSL, DEBUG_WGSL } from './modules/debug.js'
import { DOMAIN_GLSL, DOMAIN_WGSL } from './modules/domain.js'
import { HASH_GLSL, HASH_WGSL } from './modules/hash.js'
import { INTERSECT_GLSL, INTERSECT_WGSL } from './modules/intersect.js'
import { NOISE_GLSL, NOISE_WGSL } from './modules/noise.js'
import { OPERATORS_GLSL, OPERATORS_WGSL } from './modules/operators.js'
import { PATTERN_GLSL, PATTERN_WGSL } from './modules/pattern.js'
import { POST_GLSL, POST_WGSL } from './modules/post.js'
import { RAYMARCH_GLSL, RAYMARCH_WGSL } from './modules/raymarch.js'
import { SDF2D_GLSL, SDF2D_WGSL } from './modules/sdf2d.js'
import { SDF3D_GLSL, SDF3D_WGSL } from './modules/sdf3d.js'
import { SHADING_GLSL, SHADING_WGSL } from './modules/shading.js'
import { TONEMAP_GLSL, TONEMAP_WGSL } from './modules/tonemap.js'
import { VOLUME_GLSL, VOLUME_WGSL } from './modules/volume.js'
import { WATER_GLSL, WATER_WGSL } from './modules/water.js'

export { SHADER_CRAFT_LIBRARY } from './symbols.js'
export type * from './types.js'

const SOURCES: Array<[ShaderCraftModuleName, string, string]> = [
  ['common', COMMON_GLSL, COMMON_WGSL],
  ['hash', HASH_GLSL, HASH_WGSL],
  ['noise', NOISE_GLSL, NOISE_WGSL],
  ['pattern', PATTERN_GLSL, PATTERN_WGSL],
  ['sdf3d', SDF3D_GLSL, SDF3D_WGSL],
  ['sdf2d', SDF2D_GLSL, SDF2D_WGSL],
  ['operators', OPERATORS_GLSL, OPERATORS_WGSL],
  ['domain', DOMAIN_GLSL, DOMAIN_WGSL],
  ['architecture', ARCHITECTURE_GLSL, ARCHITECTURE_WGSL],
  ['raymarch', RAYMARCH_GLSL, RAYMARCH_WGSL],
  ['intersect', INTERSECT_GLSL, INTERSECT_WGSL],
  ['camera', CAMERA_GLSL, CAMERA_WGSL],
  ['shading', SHADING_GLSL, SHADING_WGSL],
  ['water', WATER_GLSL, WATER_WGSL],
  ['color', COLOR_GLSL, COLOR_WGSL],
  ['tonemap', TONEMAP_GLSL, TONEMAP_WGSL],
  ['volume', VOLUME_GLSL, VOLUME_WGSL],
  ['atmosphere', ATMOSPHERE_GLSL, ATMOSPHERE_WGSL],
  ['post', POST_GLSL, POST_WGSL],
  ['debug', DEBUG_GLSL, DEBUG_WGSL],
]

/** The library modules in declaration order, with the full GLSL and WGSL source of each. */
export const SHADER_CRAFT_LIBRARY_MODULES: ShaderCraftLibraryModule[] = SOURCES.map(([module, glsl, wgsl]) => ({
  module,
  summary: LIBRARY_INDEX_MODULES.find(entry => entry.module === module)?.summary ?? module,
  glsl,
  wgsl,
}))

/** Symbols the effect program defines for the raymarch functions, which call them. */
export const SHADER_CRAFT_LIBRARY_PROGRAM_SYMBOLS: ShaderCraftProgramSymbol[] = [
  {
    name: 'map',
    summary: 'The scene: returns vec2(distance to the nearest surface at p, material id).',
    glsl: 'vec2 map(vec3 p) { ... }',
    wgsl: 'fn map(p: vec3f) -> vec2f { ... }',
    glslPrototype: 'vec2 map(vec3 p);',
  },
  {
    name: 'ZERO',
    summary: 'An int zero the compiler cannot prove, built from the program\'s own int frame uniform. Loops that ' +
      'call map() start at it, so the compiler does not inline map() into every iteration. In GLSL, define it ' +
      'before the library code.',
    glsl: '#define ZERO (min(frame, 0))',
    wgsl: 'var<private> ZERO: i32;',
    wgslEntryPoint: 'ZERO = min(i32(frame), 0);',
  },
]

/** How the library is written and how a program uses it. */
export const SHADER_CRAFT_LIBRARY_CONVENTIONS = {
  /** GLSL programs that use the library declare these: the hashes need 32-bit uint. */
  glslPrecision: 'precision highp float;\nprecision highp int;',
  wgslNaming:
    'A GLSL name with a single signature keeps that name in WGSL. Every signature of an overloaded GLSL name ' +
    '(overloaded within one module or across modules) is named in WGSL by the GLSL name, an underscore, and one ' +
    'code per parameter in order: f, i, u, b for float, int, uint, bool; f2-f4, i2-i4, u2-u4, b2-b4 for vecN, ' +
    'ivecN, uvecN, bvecN; m2-m4 for matN. So fbm(vec2, int) is fbm_f2i and sdBox(vec3, vec3) is sdBox_f3f3.',
  wgslTypeCodes: {
    float: 'f', int: 'i', uint: 'u', bool: 'b',
    vec2: 'f2', vec3: 'f3', vec4: 'f4', ivec2: 'i2', ivec3: 'i3', ivec4: 'i4',
    uvec2: 'u2', uvec3: 'u3', uvec4: 'u4', bvec2: 'b2', bvec3: 'b3', bvec4: 'b4',
    mat2: 'm2', mat3: 'm3', mat4: 'm4',
  } as Record<string, string>,
  wgslParameters:
    'WGSL parameters are immutable: where a GLSL body assigns to a parameter, the WGSL twin works on a copy ' +
    'named with a trailing underscore. GLSL out and inout parameters are ptr<function, T> parameters in WGSL; ' +
    'pass the address of a function-scope var, e.g. warpedFbm(p, 4.0, 5, &q, &r).',
  noUniforms:
    'Library code reads no uniforms, built-ins or textures, only its parameters. Pass the pixel coordinate ' +
    '(gl_FragCoord.xy in GLSL, position.xy in WGSL) and the engine\'s frame as arguments where a function takes them.',
}

const BY_ID = new Map<string, ShaderCraftLibrarySymbol>(SHADER_CRAFT_LIBRARY.map(symbol => [symbol.id, symbol]))
const MODULES = new Map(SHADER_CRAFT_LIBRARY_MODULES.map(module => [module.module, module]))

function declarationEnd(source: string, start: number): number {
  let depth = 0
  for (let i = start; i < source.length; i++) {
    if (source.startsWith('//', i)) {
      const lineEnd = source.indexOf('\n', i)
      if (lineEnd < 0) break
      i = lineEnd
      continue
    }
    const c = source[i]
    if (c === '{') depth++
    else if (c === '}' && --depth === 0) return i + 1
    else if (c === ';' && depth === 0) return i + 1
  }
  throw new Error('Unterminated shader-craft library declaration')
}

/**
 * The source of one library symbol in one language: its declaration and body, without doc comments.
 * A bundler that copies symbols into a program emits SHADER_CRAFT_LIBRARY entries in index order, so every
 * dependency precedes its users, and adds the GLSL map() prototype before any symbol that requires map.
 */
export function getShaderCraftSymbolSource(id: string, language: ShaderCraftLanguage): string {
  const symbol = BY_ID.get(id)
  if (!symbol) throw new Error(`Unknown shader-craft library symbol: ${id}`)
  const source = MODULES.get(symbol.module)![language]
  const head = symbol.kind === 'const' ? symbol[language].signature : `${symbol[language].signature} {`
  const start = source.startsWith(head) ? 0 : source.indexOf(`\n${head}`) + 1
  if (start === 0 && !source.startsWith(head)) {
    throw new Error(`Shader-craft library symbol ${id} is missing from the ${language} source of ${symbol.module}`)
  }
  return source.slice(start, declarationEnd(source, start))
}
