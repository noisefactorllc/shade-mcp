import { SHADER_CRAFT_LIBRARY } from './library/index.js'
import type { ShaderCraftLanguage } from './library/types.js'
import {
  tokenize, scanTopLevel, parseBody, parseRange, parseExpression, walkExpr, walkStmts, unparen,
  literalSmoothsteps,
} from './source.js'
import type { Expr, Stmt, NumericType } from './source.js'

export type ShaderSourceRule = 'sine-hash' | 'reversed-smoothstep' | 'shadertoy-contract' |
  'derivative-control-flow' | 'nan-risk' | 'integer-float-mix' | 'round' | 'unbounded-loop'
/** Advisory only: severity describes the source problem, never a compilation or publication verdict. */
export interface ShaderSourceFinding {
  rule: ShaderSourceRule
  severity: 'error' | 'warning'
  /** 1-based source line; comments and blank lines count. */
  line: number
  message: string
}

const DERIVATIVES = /^(?:dFdx|dFdy|dpdx|dpdy|fwidth)(?:Coarse|Fine)?$/
const CONTRACT: Record<string, string> = {
  mainImage: 'use void main() in GLSL or an @fragment entry point in WGSL',
  iTime: 'use the time uniform declared by the effect pass',
  iGlobalTime: 'use the time uniform declared by the effect pass',
  iResolution: 'use the resolution uniform declared by the effect pass',
  iFrame: 'use the frame uniform declared by the effect pass',
  iMouse: 'declare and bind an effect-specific mouse control; there is no implicit mouse uniform',
  gl_FragColor: 'declare an out vec4 in GLSL or return @location(0) vec4f in WGSL',
  texture2D: 'use texture() in GLSL or textureSample() in WGSL with the pass-bound texture and sampler',
}
const numericType = (type?: string): NumericType | undefined => {
  if (!type) return
  if (/^(float|[d]?vec[234]|mat[234]|f32|f16|vec[234]f|vec[234]<f(?:32|16)>)/.test(type)) return 'float'
  if (/^(uint|uvec|u32|vec[234]u)/.test(type)) return 'uint'
  if (/^(int|ivec|i32|vec[234]i)/.test(type)) return 'int'
}
function number(expr: Expr): number | undefined {
  const e = unparen(expr)
  if (e.kind === 'number') return e.value
  if (e.kind === 'unary' && (e.op === '+' || e.op === '-')) {
    const n = number(e.arg)
    return n === undefined ? undefined : e.op === '-' ? -n : n
  }
}
function lowerBound(expr: Expr): number | undefined {
  const e = unparen(expr), n = number(e)
  if (n !== undefined) return n
  if (e.kind !== 'call') return
  if (/^(?:vec[234](?:f|<f32>)?|float|f32)$/.test(e.callee) && e.args.length) {
    const bounds = e.args.map(lowerBound)
    if (bounds.every(x => x !== undefined)) return Math.min(...bounds as number[])
  }
  if (e.callee === 'max') {
    const bounds = e.args.map(lowerBound).filter(x => x !== undefined) as number[]
    if (bounds.length) return Math.max(...bounds)
  }
  if (e.callee === 'clamp' && e.args[1]) return lowerBound(e.args[1])
  if (e.callee === 'abs' || e.callee === 'length') return 0
}
function nonzero(expr: Expr): boolean {
  const n = number(expr)
  if (n !== undefined) return n !== 0
  const e = unparen(expr)
  if (e.kind === 'call' && /^vec[234](?:f|<f32>)?$/.test(e.callee) && e.args.some(nonzero)) return true
  return (lowerBound(expr) ?? -Infinity) > 0
}
function typeOf(expr: Expr, types: Map<string, NumericType>): NumericType | undefined {
  const e = unparen(expr)
  if (e.kind === 'number') return e.type
  if (e.kind === 'ident') return types.get(e.name)
  if (e.kind === 'unary') return typeOf(e.arg, types)
  if (e.kind === 'member' || e.kind === 'index') return typeOf(e.object, types)
  if (e.kind === 'call') return numericType(e.callee) ?? (e.args.some(a => typeOf(a, types) === 'float') ? 'float' : undefined)
  if (e.kind === 'binary') return typeOf(e.left, types) === 'float' || typeOf(e.right, types) === 'float' ? 'float' : typeOf(e.left, types)
}
function intLiteral(expr: Expr): boolean {
  const e = unparen(expr)
  return e.kind === 'number' ? e.type === 'int' : e.kind === 'unary' && ['-', '+'].includes(e.op) && intLiteral(e.arg)
}
function uniformExpr(expr: Expr, uniforms: Set<string>): boolean {
  let uniform = true
  walkExpr(expr, e => {
    if (e.kind === 'ident' && !['true', 'false'].includes(e.name) && !uniforms.has(e.name)) uniform = false
    if (e.kind === 'call' && /^(?:texture|texelFetch|textureSample|textureLoad)/.test(e.callee)) uniform = false
  })
  return uniform
}
function bounded(cond?: Expr): boolean {
  if (!cond) return false
  let hasBound = false
  walkExpr(cond, e => { if (e.kind === 'binary' && ['<', '<=', '>', '>=', '!='].includes(e.op)) hasBound = true })
  return hasBound
}
function expressions(stmt: Stmt): Expr[] {
  switch (stmt.kind) {
    case 'decl': return stmt.declarators.flatMap(d => d.init ? [d.init] : [])
    case 'expr': return [stmt.expr]
    case 'return': return stmt.value ? [stmt.value] : []
    case 'if': case 'while': case 'breakIf': return [stmt.cond]
    case 'for': return [...stmt.cond ? [stmt.cond] : [], ...stmt.update]
    case 'switch': return [stmt.selector, ...stmt.cases]
    default: return []
  }
}

/** Conservatively lint GLSL/WGSL source. This tolerant, dependency-free checker is advisory, not a compiler. */
export function checkShaderSource(source: string, language: ShaderCraftLanguage): ShaderSourceFinding[] {
  const tokens = tokenize(source, language), items = scanTopLevel(source, language, tokens)
  const findings: ShaderSourceFinding[] = [], seen = new Set<string>()
  const add = (rule: ShaderSourceRule, severity: ShaderSourceFinding['severity'], tok: number, message: string) => {
    const line = tokens[tok]?.line ?? 1, key = `${rule}:${tok}`
    if (!seen.has(key)) { seen.add(key); findings.push({ rule, severity, line, message }) }
  }
  tokens.forEach((t, i) => {
    if (t.kind === 'directive') {
      for (const ref of tokenize(t.text.slice(1), 'wgsl')) {
        const replacement = CONTRACT[ref.text] ?? (/^iChannel\d+$/.test(ref.text) ? 'declare a texture input in the effect pass' : undefined)
        if (replacement) add('shadertoy-contract', 'error', i, `Noisemaker: ${replacement}; ${ref.text} is not its shader contract.`)
      }
    }
    if (t.kind === 'number' && /^43758\.5453(?:f|h)?$/.test(t.text)) add('sine-hash', 'error', i, 'The sine-hash multiplier 43758.5453 varies across GPUs; use the library PCG-based hash12, hash22 or hash33.')
    if (t.kind !== 'ident') return
    const replacement = CONTRACT[t.text] ?? (/^iChannel\d+$/.test(t.text) ? 'declare a texture input in the effect pass and use its bound texture/sampler' : undefined)
    if (replacement) add('shadertoy-contract', 'error', i, `Noisemaker: ${replacement}; ${t.text} is not its shader contract.`)
  })
  for (const item of items) for (const p of item.params ?? []) {
    if (p.name === 'fragCoord' && p.qualifier !== 'out') {
      const i = tokens.findIndex((t, k) => k >= item.first && k <= item.last && t.text === 'fragCoord')
      add('shadertoy-contract', 'error', i, 'Noisemaker: read gl_FragCoord.xy in GLSL or @builtin(position).xy in WGSL instead of a Shadertoy fragCoord input.')
    }
  }
  for (const ramp of literalSmoothsteps(source, language)) if (!ramp.ascending) {
    const tok = tokens.findIndex(t => t.start === ramp.offset)
    add('reversed-smoothstep', 'error', tok, 'smoothstep literal edges must ascend; use 1.0 - smoothstep(low, high, x) for a falling ramp.')
  }
  const globals = new Map<string, NumericType>(), uniformGlobals = new Set<string>()
  for (const e of SHADER_CRAFT_LIBRARY) if (e.kind === 'const') {
    const type = /^const (\w+)/.exec(e.glsl.signature)?.[1]
    if (numericType(type)) globals.set(e[language].name, numericType(type)!)
    uniformGlobals.add(e[language].name)
  }
  for (const item of items) {
    if (item.kind === 'function' && numericType(item.returnType)) globals.set(item.name!, numericType(item.returnType)!)
    for (const d of item.declarators ?? []) {
      const expr = d.init ? parseRange(tokens, d.init, language) : undefined
      const type = numericType(d.type) ?? (expr ? typeOf(expr, globals) : undefined)
      if (type) globals.set(d.name, type)
      if (item.storage === 'const' || item.storage === 'uniform' || item.addressSpace === 'uniform' || item.storage === 'override') uniformGlobals.add(d.name)
    }
    if (item.storage === 'uniform' || item.addressSpace === 'uniform') if (item.name) uniformGlobals.add(item.name)
  }
  const derivativeFunctions = new Set<string>()
  const bodies = items.filter(item => item.kind === 'function').map(item => ({ item, body: parseBody(tokens, item.bodyOpen!, item.bodyClose!, language) }))
  // A helper that evaluates derivatives is subject to its caller's control flow too.
  for (let changed = true; changed;) {
    changed = false
    for (const { item, body } of bodies) {
      if (derivativeFunctions.has(item.name!)) continue
      let uses = false
      walkStmts(body, stmt => expressions(stmt).forEach(expr => walkExpr(expr, e => {
        if (e.kind === 'call' && (DERIVATIVES.test(e.callee) || derivativeFunctions.has(e.callee))) uses = true
      })))
      if (uses) { derivativeFunctions.add(item.name!); changed = true }
    }
  }
  const checkExpr = (expr: Expr, types: Map<string, NumericType>, control = false, uniforms = uniformGlobals) => walkExpr(expr, e => {
    const checkControlled = (branch: Expr) => walkExpr(branch, call => {
      if (call.kind === 'call' && (DERIVATIVES.test(call.callee) || derivativeFunctions.has(call.callee))) add('derivative-control-flow', 'warning', call.tok, 'Evaluate derivatives before non-uniform conditional expressions or short-circuit branches.')
    })
    if (e.kind === 'ternary' && !uniformExpr(e.cond, uniforms)) { checkControlled(e.then); checkControlled(e.else) }
    if (e.kind === 'binary' && ['&&', '||'].includes(e.op) && !uniformExpr(e.left, uniforms)) checkControlled(e.right)
    if (language === 'glsl' && e.kind === 'binary' && ['+', '-', '*', '/', '%'].includes(e.op) &&
      ((intLiteral(e.left) && typeOf(e.right, types) === 'float') || (intLiteral(e.right) && typeOf(e.left, types) === 'float'))) {
      add('integer-float-mix', 'error', e.tok, 'GLSL float arithmetic needs float literals (for example 2.0 * PI), or an explicit float() conversion.')
    }
    if (e.kind !== 'call') return
    const name = e.callee, a = e.args[0]
    if (name === 'fract') {
      let sine = false
      walkExpr(a, x => { if (x.kind === 'call' && x.callee === 'sin') sine = true })
      if (sine) add('sine-hash', 'error', e.tok, 'Sine hashes vary across GPUs; use the library PCG-based hash12, hash22 or hash33 (WGSL names carry type suffixes).')
    }
    if (name === 'round') add('round', 'warning', e.tok, 'round() tie behavior differs across shader languages and GPUs; prefer floor(x + 0.5) when that tie rule is intended.')
    if (control && (DERIVATIVES.test(name) || derivativeFunctions.has(name))) add('derivative-control-flow', 'warning', e.tok, 'Evaluate derivatives outside loops and non-uniform branches, then pass the result into the controlled code.')
    let risk = false
    if (a) {
      if (name === 'pow') risk = (lowerBound(a) ?? -Infinity) < 0
      if (name === 'sqrt') risk = (lowerBound(a) ?? -Infinity) < 0
      if (name === 'log' || name === 'log2' || name === 'inversesqrt') risk = (lowerBound(a) ?? -Infinity) <= 0
      if (name === 'normalize') risk = !nonzero(a)
      if ((name === 'atan' || name === 'atan2') && e.args.length === 2) risk = !e.args.some(nonzero)
    }
    if (risk) add('nan-risk', 'warning', e.tok, `${name}() can receive a zero or negative argument; guard its domain with max/clamp or a nonzero fallback.`)
    if (language === 'glsl' && ['clamp', 'min', 'max', 'mix', 'step', 'smoothstep', 'pow', 'mod'].includes(name) &&
      e.args.some(x => typeOf(x, types) === 'float') && e.args.some(intLiteral)) {
      add('integer-float-mix', 'error', e.tok, `GLSL ${name}() mixes integer literals with float arguments; spell float literals with .0.`)
    }
  })
  for (const item of items) {
    if (item.kind !== 'declaration') continue
    for (const d of item.declarators ?? []) if (d.init) checkExpr(parseRange(tokens, d.init, language), globals)
    if (!item.declarators?.length && tokens[item.first]?.kind !== 'ident') checkExpr(parseRange(tokens, [item.first, item.last + 1], language), globals)
  }
  for (const { item, body } of bodies) {
    const types = new Map(globals), uniforms = new Set(uniformGlobals)
    for (const p of item.params ?? []) {
      const type = numericType(p.type)
      if (type) types.set(p.name, type)
      uniforms.delete(p.name)
    }
    walkStmts(body, (stmt, parents) => {
      const controls = ['for', 'while', 'loop'].includes(stmt.kind) ? [...parents, stmt] : parents
      const control = controls.some(p => ['for', 'while', 'loop'].includes(p.kind) ||
        (p.kind === 'if' && !uniformExpr(p.cond, uniforms)) || (p.kind === 'switch' && !uniformExpr(p.selector, uniforms)))
      expressions(stmt).forEach(expr => {
        checkExpr(expr, types, control, uniforms)
        walkExpr(expr, e => {
          if (e.kind === 'assign') {
            let target = e.target
            while (target.kind === 'member' || target.kind === 'index') target = target.object
            if (target.kind === 'ident') {
              if (e.target.kind === 'ident' && !control && uniformExpr(e.value, uniforms)) uniforms.add(target.name)
              else uniforms.delete(target.name)
            }
          }
        })
      })
      if (stmt.kind === 'decl') for (const d of stmt.declarators) {
        const type = numericType(d.type) ?? (d.init ? typeOf(d.init, types) : undefined)
        if (type) types.set(d.name, type)
        if (d.init && uniformExpr(d.init, uniforms)) uniforms.add(d.name)
        else uniforms.delete(d.name)
      }
      if ((stmt.kind === 'for' || stmt.kind === 'while') && !bounded(stmt.cond)) add('unbounded-loop', 'warning', stmt.tok, 'Loop condition has no explicit comparison bound; use a bounded iteration count.')
      if (stmt.kind === 'loop') {
        let bound = false
        walkStmts([stmt.body], s => { if ((s.kind === 'breakIf' || s.kind === 'if') && bounded(s.cond)) bound = true })
        if (!bound) add('unbounded-loop', 'warning', stmt.tok, 'WGSL loop has no visible bounded break; use a bounded iteration count.')
      }
    })
  }
  // Also accept source fragments and module-scope initializers, without treating function declarations as calls.
  const heads = new Set(items.filter(i => i.kind === 'function' || i.kind === 'prototype').map(i => tokens.findIndex((t, k) => k >= i.first && k <= i.last && t.text === i.name)))
  for (let i = 0; i < tokens.length; i++) {
    if (tokens[i].kind !== 'ident' || tokens[i + 1]?.text !== '(' || heads.has(i) || bodies.some(({ item }) => i > item.bodyOpen! && i < item.bodyClose!)) continue
    let depth = 0, end = i + 1
    for (; end < tokens.length; end++) {
      if (tokens[end].text === '(') depth++
      if (tokens[end].text === ')' && --depth === 0) { end++; break }
    }
    checkExpr(parseExpression(tokens, i, end, language), globals)
  }
  return findings.sort((a, b) => a.line - b.line || a.rule.localeCompare(b.rule))
}
