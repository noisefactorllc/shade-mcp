import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { lstat, readFile, realpath, writeFile } from 'node:fs/promises'
import { resolve, relative, isAbsolute, sep, extname } from 'node:path'
import { getConfig } from '../../config.js'
import { checkShaderSource } from '../../knowledge/shader-craft/checker.js'
import { bundleShaderSource } from '../../knowledge/shader-craft/bundler.js'
import { searchShaderLibrary } from '../../knowledge/shader-craft/search-library.js'
import type { ShaderCraftLanguage } from '../../knowledge/shader-craft/library/types.js'
import { toolResult } from '../tool-result.js'

export const searchShaderLibrarySchema = {
  query: z.string().describe('Words to match against local shader library names, signatures, modules and summaries.'),
  language: z.enum(['glsl', 'wgsl']).optional().describe('Signature language; defaults to glsl.'),
  limit: z.number().int().min(0).max(217).optional().describe('Maximum results; defaults to 15.'),
}
export const checkShaderSchema = {
  source: z.string().optional().describe('Shader source text. Provide exactly one of source or file.'),
  file: z.string().optional().describe('Existing shader file inside SHADE_EFFECTS_DIR or SHADE_PROJECT_ROOT. Relative paths use the project root.'),
  language: z.enum(['glsl', 'wgsl']).optional().describe('Required for source text; otherwise inferred from .wgsl, .glsl, .frag or .vert.'),
}
export const bundleShaderSchema = {
  ...checkShaderSchema,
  write: z.boolean().optional().default(false).describe('Write the bundled source back to file only when explicitly true. Requires file input.'),
}
export interface ShaderSourceInput { source?: string; file?: string; language?: ShaderCraftLanguage }

async function shaderInput(args: ShaderSourceInput): Promise<{ source: string; language: ShaderCraftLanguage; file?: string }> {
  if ((args.source === undefined) === (args.file === undefined)) throw new Error('Provide exactly one of source or file.')
  if (args.source !== undefined) {
    if (!args.language) throw new Error('Source text requires language: glsl or wgsl.')
    return { source: args.source, language: args.language }
  }
  const config = getConfig(), target = resolve(config.projectRoot, args.file!)
  const ext = extname(target).toLowerCase()
  if (!['.wgsl', '.glsl', '.frag', '.vert'].includes(ext)) throw new Error('Shader file must use .wgsl, .glsl, .frag or .vert.')
  const inside = (root: string, file: string) => {
    const part = relative(root, file)
    return part !== '' && part !== '..' && !part.startsWith(`..${sep}`) && !isAbsolute(part)
  }
  let file: string | undefined
  for (const configured of [config.effectsDir, config.projectRoot]) {
    const root = resolve(configured)
    if (!inside(root, target)) continue
    const realRoot = await realpath(root)
    let cursor = root
    for (const segment of relative(root, target).split(sep)) {
      cursor = resolve(cursor, segment)
      if ((await lstat(cursor)).isSymbolicLink()) throw new Error('Shader paths must contain regular files and directories, without symbolic links.')
    }
    const canonical = await realpath(target)
    if (inside(realRoot, canonical) && (await lstat(canonical)).isFile()) { file = canonical; break }
  }
  if (!file) throw new Error('Shader file must be a regular file inside SHADE_EFFECTS_DIR or SHADE_PROJECT_ROOT.')
  return { source: await readFile(file, 'utf8'), language: args.language ?? (ext === '.wgsl' ? 'wgsl' : 'glsl'), file }
}

export async function checkShader(args: ShaderSourceInput) {
  const { source, language } = await shaderInput(args)
  return { language, advisory: true, findings: checkShaderSource(source, language) }
}
export async function bundleShader(args: ShaderSourceInput & { write?: boolean }) {
  if (args.write && args.file === undefined) throw new Error('write: true requires a file input.')
  const { source, language, file } = await shaderInput(args)
  const result = bundleShaderSource(source, language)
  if (args.write) await writeFile(file!, result.source, 'utf8')
  return { ...result, language, written: args.write === true }
}
export function registerShaderCraft(server: McpServer): void {
  server.tool('searchShaderLibrary', 'Search the local shader-craft library for GLSL or WGSL building blocks, signatures and summaries.', searchShaderLibrarySchema,
    async args => toolResult(searchShaderLibrary(args.query, args)))
  server.tool('checkShader', 'Advisory GLSL/WGSL source findings for Noisemaker effects. Findings never block compilation or change a file.', checkShaderSchema,
    async args => toolResult(await checkShader(args)))
  server.tool('bundleShader', 'Inline only the shader library symbols used by a program and their dependencies, with upstream and technique credits. Return source; write back only with explicit write: true.', bundleShaderSchema,
    async args => toolResult(await bundleShader(args)))
}
