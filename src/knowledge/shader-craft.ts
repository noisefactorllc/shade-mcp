// Browser-safe entry for consumers that vendor dist/knowledge. The aggregate knowledge index also exports
// Node-based effect indexes; this entry contains only the local shader-craft source tools and their types.
export { checkShaderSource } from './shader-craft/checker.js'
export type { ShaderSourceFinding, ShaderSourceRule } from './shader-craft/checker.js'
export { bundleShaderSource } from './shader-craft/bundler.js'
export type { BundledShaderSource } from './shader-craft/bundler.js'
export { searchShaderLibrary } from './shader-craft/search-library.js'
export type { ShaderLibrarySearchOptions, ShaderLibrarySearchResult } from './shader-craft/search-library.js'
export type { ShaderCraftLanguage } from './shader-craft/library/types.js'

export { SHADER_CRAFT_EXAMPLES, getShaderCraftExample } from './shader-craft/examples.js'
export type { ShaderCraftExample, ShaderCraftExampleDefinition, ShaderCraftExamplePackage } from './shader-craft/examples.js'
