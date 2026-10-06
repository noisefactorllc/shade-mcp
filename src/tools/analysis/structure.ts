import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join, basename } from 'node:path'
import { loadEffectDefinition } from '../../formats/index.js'
import { getConfig } from '../../config.js'
import { resolveEffectDir } from '../resolve-effects.js'
import { extractFunctionNames, extractUniforms } from './compare.js'
import { toolResult } from '../tool-result.js'

// GLSL reserved words and built-in functions that cannot be used as uniform names
const GLSL_RESERVED = new Set([
  // Type qualifiers
  'const', 'uniform', 'in', 'out', 'inout', 'centroid', 'flat', 'smooth',
  'layout', 'invariant', 'highp', 'mediump', 'lowp', 'precision',
  // Types
  'void', 'bool', 'int', 'uint', 'float',
  'vec2', 'vec3', 'vec4', 'bvec2', 'bvec3', 'bvec4',
  'ivec2', 'ivec3', 'ivec4', 'uvec2', 'uvec3', 'uvec4',
  'mat2', 'mat3', 'mat4', 'sampler2D', 'sampler3D', 'samplerCube',
  // Control flow
  'if', 'else', 'for', 'while', 'do', 'switch', 'case', 'default',
  'break', 'continue', 'return', 'discard', 'struct', 'true', 'false',
])

const GLSL_BUILTINS = new Set([
  // Trig
  'sin', 'cos', 'tan', 'asin', 'acos', 'atan',
  // Exponential
  'pow', 'exp', 'log', 'exp2', 'log2', 'sqrt', 'inversesqrt',
  // Common
  'abs', 'sign', 'floor', 'ceil', 'fract', 'mod', 'min', 'max', 'clamp',
  'mix', 'step', 'smoothstep',
  // Geometric
  'length', 'distance', 'dot', 'cross', 'normalize', 'faceforward',
  'reflect', 'refract',
  // Texture
  'texture', 'texelFetch', 'textureSize',
  // Derivative
  'dFdx', 'dFdy', 'fwidth',
])

export const checkEffectStructureSchema = {
  effect_id: z.string().describe('Effect ID (e.g., "synth/noise")'),
}

function checkCamelCase(name: string): boolean {
  return /^[a-z][a-zA-Z0-9]*$/.test(name)
}

export async function checkEffectStructure(effectId: string): Promise<any> {
  const config = getConfig()
  const effectDir = resolveEffectDir(effectId, config.effectsDir)

  if (!existsSync(effectDir)) {
    return { status: 'error', error: `Effect directory not found: ${effectDir}` }
  }

  const issues: any = {
    unusedFiles: [] as string[],
    namingIssues: [] as any[],
    nameCollisions: [] as any[],
    leakedInternalUniforms: [] as string[],
    missingDescription: false,
    structuralParityIssues: [] as any[],
    requiredUniformIssues: [] as any[],
    multiPass: false,
    passCount: 0,
  }

  // Parse definition
  let def: any
  try {
    def = loadEffectDefinition(effectDir)
  } catch (err: any) {
    return { status: 'error', error: `Failed to parse definition: ${err.message}` }
  }

  // Check description
  issues.missingDescription = !def.description

  // Check passes
  issues.passCount = def.passes.length
  issues.multiPass = def.passes.length > 1

  // Check naming
  if (def.func && !checkCamelCase(def.func)) {
    issues.namingIssues.push({ type: 'func', name: def.func, reason: 'Must be camelCase' })
  }

  // Check globals naming and leaked internals
  const INTERNAL = new Set(['channels', 'time', 'resolution', 'mouse'])
  for (const [name, spec] of Object.entries(def.globals || {}) as any[]) {
    if (!checkCamelCase(name)) {
      issues.namingIssues.push({ type: 'global', name, reason: 'Must be camelCase' })
    }
    if (INTERNAL.has(spec.uniform || name)) {
      issues.leakedInternalUniforms.push(name)
    }
  }

  // Check shader files (GLSL may use .glsl, .frag, or .vert extensions)
  const glslDir = join(effectDir, 'glsl')
  const wgslDir = join(effectDir, 'wgsl')
  const glslFiles = existsSync(glslDir) ? readdirSync(glslDir).filter(f =>
    f.endsWith('.glsl') || f.endsWith('.frag') || f.endsWith('.vert')
  ) : []
  const wgslFiles = existsSync(wgslDir) ? readdirSync(wgslDir).filter(f => f.endsWith('.wgsl')) : []

  // Extract program name from a shader filename (.glsl, .frag, .vert, .wgsl)
  function programName(filename: string): string {
    return filename.replace(/\.(glsl|frag|vert|wgsl)$/, '')
  }

  // Referenced programs from passes
  const referencedPrograms = new Set(def.passes.map((p: any) => p.program))

  // Unused files. When the definition builds its passes at run time (for
  // example with flatMap), the static projection cannot list every program,
  // so no file can be called unused; say so instead of flagging them all.
  const passReasons = (def.partialReasons || []).filter((r: string) => r.startsWith('passes'))
  if (passReasons.length > 0) {
    issues.unusedFilesUnchecked = `passes are computed at run time: ${passReasons.join('; ')}`
  } else {
    for (const f of glslFiles) {
      if (!referencedPrograms.has(programName(f))) {
        issues.unusedFiles.push(`glsl/${f}`)
      }
    }
    for (const f of wgslFiles) {
      if (!referencedPrograms.has(programName(f))) {
        issues.unusedFiles.push(`wgsl/${f}`)
      }
    }
  }

  // Structural parity: every GLSL program should have matching WGSL and vice versa
  const glslPrograms = new Set(glslFiles.map(f => programName(f)))
  const wgslPrograms = new Set(wgslFiles.map(f => programName(f)))

  for (const p of glslPrograms) {
    if (!wgslPrograms.has(p)) {
      issues.structuralParityIssues.push({ type: 'missing_wgsl', program: p, message: `GLSL program "${p}" has no WGSL counterpart` })
    }
  }
  for (const p of wgslPrograms) {
    if (!glslPrograms.has(p)) {
      issues.structuralParityIssues.push({ type: 'missing_glsl', program: p, message: `WGSL program "${p}" has no GLSL counterpart` })
    }
  }

  // Check for GLSL name collisions: uniforms vs functions, reserved words, built-ins
  for (const gf of glslFiles) {
    const source = readFileSync(join(glslDir, gf), 'utf-8')
    const uniforms = extractUniforms(source, 'glsl')
    const functions = extractFunctionNames(source, 'glsl')
    const functionSet = new Set(functions)

    for (const u of uniforms) {
      if (functionSet.has(u)) {
        issues.nameCollisions.push({
          type: 'uniform_function',
          name: u,
          file: `glsl/${gf}`,
          message: `Uniform "${u}" collides with function "${u}()" in the same file`
        })
      }
      if (GLSL_RESERVED.has(u)) {
        issues.nameCollisions.push({
          type: 'reserved_word',
          name: u,
          file: `glsl/${gf}`,
          message: `Uniform "${u}" is a GLSL reserved word`
        })
      }
      if (GLSL_BUILTINS.has(u)) {
        issues.nameCollisions.push({
          type: 'builtin_shadow',
          name: u,
          file: `glsl/${gf}`,
          message: `Uniform "${u}" shadows GLSL built-in function "${u}()"`
        })
      }
    }
  }

  const hasIssues = issues.unusedFiles.length > 0 || issues.namingIssues.length > 0 ||
    issues.nameCollisions.length > 0 ||
    issues.leakedInternalUniforms.length > 0 || issues.missingDescription ||
    issues.structuralParityIssues.length > 0

  return { ...issues, status: hasIssues ? 'warning' : 'ok' }
}

export function registerCheckEffectStructure(server: McpServer): void {
  server.tool(
    'checkEffectStructure',
    'Detect these effect issues:\n- unused files\n- broken references\n- naming violations\n- leaked or undefined uniforms\n- missing descriptions\n- structural parity issues\n- GLSL name collisions: uniforms versus functions, reserved words, or built-in shadowing.',
    checkEffectStructureSchema,
    async (args: any) => {
      const result = await checkEffectStructure(args.effect_id)
      return toolResult(result)
    }
  )
}
