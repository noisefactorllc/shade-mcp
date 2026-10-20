/** Library modules, in declaration order: a module uses only the modules before it. */
export type ShaderCraftModuleName =
  | 'common' | 'hash' | 'noise' | 'pattern' | 'sdf3d' | 'sdf2d' | 'operators' | 'domain' | 'architecture'
  | 'raymarch' | 'intersect' | 'camera' | 'shading' | 'water' | 'color' | 'tonemap' | 'volume' | 'atmosphere'
  | 'post' | 'debug'

export type ShaderCraftLanguage = 'glsl' | 'wgsl'

export type ShaderCraftSymbolKind = 'function' | 'const' | 'struct'

/**
 * exact: true Euclidean distance. bound: never overestimates, so it is safe to march.
 * approx: exact zero set, but may overestimate in places.
 */
export type ShaderCraftExactness = 'exact' | 'bound' | 'approx'

/** One symbol as it is spelled in one language. */
export interface ShaderCraftLanguageSymbol {
  /** Name in this language. WGSL has no overloading, so overloads have distinct WGSL names. */
  name: string
  /** Function signature without its body, or the whole constant or struct declaration. */
  signature: string
  /** Ids of the library symbols this one uses directly, in declaration order. */
  dependencies: string[]
  /** Program symbols (SHADER_CRAFT_LIBRARY_PROGRAM_SYMBOLS) this one needs the effect program to define. */
  requires: string[]
}

/**
 * A measured GLSL/WGSL difference that a function's float results are allowed. Without one, every word must hold the
 * same value on WebGL2 and WebGPU (only the sign of a zero or the bits of a NaN may differ). Differences are scaled:
 * |a - b| / max(1, |a|, |b|), an absolute difference below 1 and a relative one above.
 */
export interface ShaderCraftParityTolerance {
  /** Largest scaled difference allowed between a float word rendered on WebGL2 and on WebGPU. */
  tolerance: number
  /** The largest scaled difference the parity script measured, per renderer it ran on. */
  measured: Array<{ renderer: string; difference: number }>
  reason: string
}

/** One entry of the library index. */
export interface ShaderCraftLibrarySymbol {
  /** Unique id: the GLSL name with its parameter types, e.g. fbm(vec2,int), or the constant's name. */
  id: string
  kind: ShaderCraftSymbolKind
  module: ShaderCraftModuleName
  summary: string
  /** Distance-field exactness, where the upstream library tags it. */
  exactness?: ShaderCraftExactness
  /** Keys of SHADER_CRAFT_CREDITS.techniques: the sources of the technique. */
  credits: string[]
  glsl: ShaderCraftLanguageSymbol
  wgsl: ShaderCraftLanguageSymbol
  parity?: ShaderCraftParityTolerance
}

/** One library module: its GLSL source and the WGSL twin of every symbol in it, in the same order. */
export interface ShaderCraftLibraryModule {
  module: ShaderCraftModuleName
  summary: string
  glsl: string
  wgsl: string
}

/** A symbol the effect program defines for the library to use (the raymarch scene contract). */
export interface ShaderCraftProgramSymbol {
  name: string
  summary: string
  /** What the program defines in GLSL. */
  glsl: string
  /** What the program declares in WGSL. */
  wgsl: string
  /** Statement the WGSL entry point runs before calling the library, when the declaration alone is not enough. */
  wgslEntryPoint?: string
  /** Declaration the GLSL library carries so its functions can call the program's definition. */
  glslPrototype?: string
}
