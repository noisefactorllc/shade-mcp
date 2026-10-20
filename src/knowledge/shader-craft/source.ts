// Lexing, top-level scanning and expression and statement parsing for GLSL ES 3.00 and WGSL, shared by the
// shader-craft checker and bundler. The parser is tolerant: it never throws on malformed source, and it gives up on a
// construct it does not understand by skipping to the next statement, so the checks built on it stay advisory.
// Plain functions with no imports beyond types, so they run unchanged in Node and in the browser.

import type { ShaderCraftLanguage } from './library/types.js'

export interface Token {
  kind: 'ident' | 'number' | 'punct' | 'directive'
  text: string
  /** Offset of the first character in the source. */
  start: number
  /** Offset just past the last character. */
  end: number
  /** 1-based line and column of the first character. */
  line: number
  column: number
}

const PUNCT = [
  '<<=', '>>=', '->', '++', '--', '<<', '>>', '<=', '>=', '==', '!=', '&&', '||', '^^',
  '+=', '-=', '*=', '/=', '%=', '&=', '|=', '^=',
]

/** Tokens of a source, without comments. GLSL preprocessor lines become one `directive` token each. */
export function tokenize(source: string, language: ShaderCraftLanguage): Token[] {
  const tokens: Token[] = []
  const n = source.length
  let i = 0
  let line = 1
  let lineStart = 0
  let atLineStart = true
  const push = (kind: Token['kind'], start: number, end: number, startLine: number, startColumn: number) => {
    tokens.push({ kind, text: source.slice(start, end), start, end, line: startLine, column: startColumn })
  }
  while (i < n) {
    const c = source[i]
    if (c === '\n') { i++; line++; lineStart = i; atLineStart = true; continue }
    if (c === ' ' || c === '\t' || c === '\r' || c === '\f' || c === '\v') { i++; continue }
    if (c === '/' && source[i + 1] === '/') {
      while (i < n && source[i] !== '\n') i++
      continue
    }
    if (c === '/' && source[i + 1] === '*') {
      // WGSL block comments nest; GLSL block comments do not.
      let depth = 1
      i += 2
      while (i < n && depth > 0) {
        if (source[i] === '\n') { line++; lineStart = i + 1 }
        if (language === 'wgsl' && source[i] === '/' && source[i + 1] === '*') { depth++; i += 2; continue }
        if (source[i] === '*' && source[i + 1] === '/') { depth--; i += 2; continue }
        i++
      }
      continue
    }
    const startLine = line
    const startColumn = i - lineStart + 1
    if (c === '#' && atLineStart && language === 'glsl') {
      const start = i
      while (i < n) {
        if (source[i] === '\\' && source[i + 1] === '\n') { i += 2; line++; lineStart = i; continue }
        if (source[i] === '\\' && source[i + 1] === '\r' && source[i + 2] === '\n') { i += 3; line++; lineStart = i; continue }
        if (source[i] === '\n') break
        i++
      }
      push('directive', start, i, startLine, startColumn)
      continue
    }
    atLineStart = false
    if (/[A-Za-z_]/.test(c)) {
      const start = i
      while (i < n && /[A-Za-z0-9_]/.test(source[i])) i++
      push('ident', start, i, startLine, startColumn)
      continue
    }
    if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(source[i + 1] ?? ''))) {
      const start = i
      if (c === '0' && (source[i + 1] === 'x' || source[i + 1] === 'X')) {
        i += 2
        while (i < n && /[0-9A-Fa-f.]/.test(source[i])) i++
        if (source[i] === 'p' || source[i] === 'P') {
          i++
          if (source[i] === '+' || source[i] === '-') i++
          while (i < n && /[0-9]/.test(source[i])) i++
        }
      } else {
        while (i < n && /[0-9]/.test(source[i])) i++
        if (source[i] === '.') { i++; while (i < n && /[0-9]/.test(source[i])) i++ }
        if (source[i] === 'e' || source[i] === 'E') {
          let k = i + 1
          if (source[k] === '+' || source[k] === '-') k++
          if (/[0-9]/.test(source[k] ?? '')) { i = k; while (i < n && /[0-9]/.test(source[i])) i++ }
        }
      }
      while (i < n && /[A-Za-z]/.test(source[i])) i++
      push('number', start, i, startLine, startColumn)
      continue
    }
    const op = PUNCT.find(p => source.startsWith(p, i)) ?? c
    i += op.length
    push('punct', i - op.length, i, startLine, startColumn)
  }
  return tokens
}

/** The source with every comment replaced by spaces (line breaks kept), so offsets and lines stay valid. */
export function maskComments(source: string, language: ShaderCraftLanguage): string {
  const out = source.split('')
  const n = source.length
  let i = 0
  while (i < n) {
    if (source[i] === '/' && source[i + 1] === '/') {
      while (i < n && source[i] !== '\n') out[i++] = ' '
      continue
    }
    if (source[i] === '/' && source[i + 1] === '*') {
      let depth = 1
      out[i] = out[i + 1] = ' '
      i += 2
      while (i < n && depth > 0) {
        if (language === 'wgsl' && source[i] === '/' && source[i + 1] === '*') { depth++; out[i] = out[i + 1] = ' '; i += 2; continue }
        if (source[i] === '*' && source[i + 1] === '/') { depth--; out[i] = out[i + 1] = ' '; i += 2; continue }
        if (source[i] !== '\n') out[i] = ' '
        i++
      }
      continue
    }
    i++
  }
  return out.join('')
}

export type NumericType = 'int' | 'uint' | 'float'

/** The type of a numeric literal: GLSL and WGSL spell them alike apart from suffixes. */
export function literalType(text: string): NumericType {
  if (/^0[xX]/.test(text)) {
    if (/[.pP]/.test(text)) return 'float'
    return /[uU]$/.test(text) ? 'uint' : 'int'
  }
  if (/[uU]$/.test(text)) return 'uint'
  if (/[.eE]/.test(text) || /[fFh]$/.test(text)) return 'float'
  return 'int'
}

export function literalValue(text: string): number {
  if (/^0[xX]/.test(text) && !/[.pP]/.test(text)) return parseInt(text.replace(/[uUi]$/, ''), 16)
  return parseFloat(text)
}

// ------------------------------------------------------------------------------------------------ top level

export interface Param {
  name: string
  type: string
  /** in, out, inout, or a WGSL attribute such as builtin or location. */
  qualifier?: string
}

export interface Declarator {
  name: string
  type?: string
  /** Token range of the initializer, [first, end). */
  init?: [number, number]
}

export interface TopItem {
  kind: 'directive' | 'function' | 'prototype' | 'struct' | 'declaration'
  /** Character offsets: start of the item (attributes included) and just past its end. */
  start: number
  end: number
  /** Token range, [first, last] inclusive. */
  first: number
  last: number
  /** GLSL preprocessor conditional depth at the item. */
  depth: number
  name?: string
  /** Directive name (define, if, ifdef, endif, version, ...). */
  directive?: string
  /** For #define: the macro body, and the parameters of a function-like macro. */
  macroBody?: string
  macroParams?: string[]
  returnType?: string
  params?: Param[]
  /** Token indices of a function body's braces. */
  bodyOpen?: number
  bodyClose?: number
  /** WGSL entry point stage. */
  stage?: string
  /** GLSL: uniform, const, in, out, global, precision, layout. WGSL: const, var, override, alias, enable, ... */
  storage?: string
  /** WGSL var address space (private, uniform, storage, workgroup, function). */
  addressSpace?: string
  declarators?: Declarator[]
  /** Struct and interface-block members. */
  members?: Declarator[]
}

const GLSL_QUALIFIERS = new Set([
  'const', 'uniform', 'in', 'out', 'inout', 'highp', 'mediump', 'lowp', 'flat', 'smooth', 'centroid', 'invariant',
  'precise', 'buffer', 'shared', 'readonly', 'writeonly', 'coherent', 'volatile', 'restrict', 'attribute', 'varying',
])

function matching(tokens: Token[], open: number, openText: string, closeText: string): number {
  let depth = 0
  for (let i = open; i < tokens.length; i++) {
    if (tokens[i].kind !== 'punct') continue
    if (tokens[i].text === openText) depth++
    else if (tokens[i].text === closeText && --depth === 0) return i
  }
  return tokens.length - 1
}

/** Splits the token range [first, end) at commas outside brackets. */
export function splitTopLevel(tokens: Token[], first: number, end: number): Array<[number, number]> {
  const parts: Array<[number, number]> = []
  let depth = 0
  let start = first
  for (let i = first; i < end; i++) {
    const t = tokens[i]
    if (t.kind !== 'punct') continue
    if (t.text === '(' || t.text === '[' || t.text === '{') depth++
    else if (t.text === ')' || t.text === ']' || t.text === '}') depth--
    else if (t.text === ',' && depth === 0) { parts.push([start, i]); start = i + 1 }
  }
  if (end > start) parts.push([start, end])
  return parts
}

function glslParams(tokens: Token[], open: number, close: number): Param[] {
  const params: Param[] = []
  for (const [a, b] of splitTopLevel(tokens, open + 1, close)) {
    const words = tokens.slice(a, b).filter(t => t.kind === 'ident')
    let qualifier: string | undefined
    const rest = words.filter(w => {
      if (w.text === 'in' || w.text === 'out' || w.text === 'inout') { qualifier = w.text; return false }
      return !GLSL_QUALIFIERS.has(w.text)
    })
    if (rest.length === 0 || (rest.length === 1 && rest[0].text === 'void')) continue
    const array = tokens.slice(a, b).some(t => t.text === '[')
    params.push({ type: rest[0].text + (array ? '[]' : ''), name: rest[1]?.text ?? '', qualifier })
  }
  return params
}

/** Parses `type name [N] = init, name2 = init2` declarators of a GLSL declaration in [first, end). */
function glslDeclarators(tokens: Token[], first: number, end: number): { type?: string; declarators: Declarator[] } {
  let i = first
  while (i < end && tokens[i].kind === 'ident' && GLSL_QUALIFIERS.has(tokens[i].text)) i++
  if (i < end && tokens[i].text === 'layout') {
    i++
    if (tokens[i]?.text === '(') i = matching(tokens, i, '(', ')') + 1
    while (i < end && tokens[i].kind === 'ident' && GLSL_QUALIFIERS.has(tokens[i].text)) i++
  }
  if (i >= end || tokens[i].kind !== 'ident') return { declarators: [] }
  let type = tokens[i++].text
  if (tokens[i]?.text === '[') { i = matching(tokens, i, '[', ']') + 1; type += '[]' }
  const declarators: Declarator[] = []
  for (const [a, b] of splitTopLevel(tokens, i, end)) {
    if (tokens[a]?.kind !== 'ident') continue
    let k = a + 1
    let declType = type
    if (tokens[k]?.text === '[') { k = matching(tokens, k, '[', ']') + 1; if (!declType.endsWith('[]')) declType += '[]' }
    const init: [number, number] | undefined = tokens[k]?.text === '=' && k + 1 < b ? [k + 1, b] : undefined
    declarators.push({ name: tokens[a].text, type: declType, init })
  }
  return { type, declarators }
}

/** Reads a WGSL type starting at token i; returns its text and the index after it. */
function wgslType(tokens: Token[], i: number, end: number): { type: string; next: number } {
  let type = ''
  if (i >= end) return { type, next: i }
  type = tokens[i].text
  i++
  if (tokens[i]?.text === '<') {
    let depth = 0
    for (; i < end; i++) {
      const t = tokens[i].text
      type += t
      if (t === '<') depth++
      else if (t === '>') depth--
      else if (t === '>>') depth -= 2
      if (depth <= 0) { i++; break }
    }
  }
  return { type, next: i }
}

function skipWgslAttributes(tokens: Token[], i: number): { next: number; attributes: string[] } {
  const attributes: string[] = []
  while (tokens[i]?.text === '@' && tokens[i + 1]?.kind === 'ident') {
    attributes.push(tokens[i + 1].text)
    i += 2
    if (tokens[i]?.text === '(') i = matching(tokens, i, '(', ')') + 1
  }
  return { next: i, attributes }
}

function directiveParts(text: string): { directive: string; name?: string; params?: string[]; body?: string } {
  const clean = text.replace(/\\\r?\n/g, ' ').replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/.*$/, '')
  const m = /^#\s*(\w*)\s*(.*)$/s.exec(clean)
  if (!m) return { directive: '' }
  const directive = m[1]
  if (directive !== 'define') return { directive, body: m[2].trim() }
  const d = /^(\w+)(\(([^)]*)\))?\s*(.*)$/s.exec(m[2])
  if (!d) return { directive }
  return {
    directive,
    name: d[1],
    params: d[2] ? d[3].split(',').map(p => p.trim()).filter(Boolean) : undefined,
    body: d[4].trim(),
  }
}

/** The top-level items of a program, in source order. */
export function scanTopLevel(source: string, language: ShaderCraftLanguage, tokens = tokenize(source, language)): TopItem[] {
  return language === 'glsl' ? scanGlsl(tokens) : scanWgsl(tokens)
}

function scanGlsl(tokens: Token[]): TopItem[] {
  const items: TopItem[] = []
  let depth = 0
  let i = 0
  while (i < tokens.length) {
    const t = tokens[i]
    if (t.kind === 'directive') {
      const parts = directiveParts(t.text)
      let itemDepth = depth
      if (parts.directive === 'if' || parts.directive === 'ifdef' || parts.directive === 'ifndef') depth++
      else if (parts.directive === 'endif') { depth = Math.max(0, depth - 1); itemDepth = depth }
      else if (parts.directive === 'else' || parts.directive === 'elif') itemDepth = Math.max(0, depth - 1)
      items.push({
        kind: 'directive', start: t.start, end: t.end, first: i, last: i, depth: itemDepth,
        directive: parts.directive, name: parts.name, macroParams: parts.params, macroBody: parts.body,
      })
      i++
      continue
    }
    if (t.text === ';') { i++; continue }
    // A statement: up to ';' at depth 0, or a braced body.
    let j = i
    let paren = 0
    let firstParen = -1
    let sawAssign = false
    let item: TopItem | null = null
    for (; j < tokens.length; j++) {
      const u = tokens[j]
      if (u.kind === 'directive') continue
      if (u.text === '(') { if (paren === 0 && firstParen < 0) firstParen = j; paren++; continue }
      if (u.text === ')') { paren--; continue }
      if (paren > 0) continue
      if (u.text === '=') sawAssign = true
      if (u.text === ';') {
        const isPrototype = firstParen > i + 1 && !sawAssign && tokens[firstParen - 1].kind === 'ident' &&
          tokens[firstParen - 2]?.kind === 'ident' && tokens[firstParen - 2].text !== 'layout' &&
          tokens[i].text !== 'precision' && !GLSL_QUALIFIERS.has(tokens[i].text)
        if (isPrototype) {
          const close = matching(tokens, firstParen, '(', ')')
          item = {
            kind: 'prototype', start: t.start, end: u.end, first: i, last: j, depth,
            name: tokens[firstParen - 1].text, returnType: tokens[firstParen - 2].text,
            params: glslParams(tokens, firstParen, close),
          }
        } else {
          item = glslDeclaration(tokens, i, j, depth)
        }
        break
      }
      if (u.text === '{') {
        const close = matching(tokens, j, '{', '}')
        const isFunction = firstParen > i && !sawAssign && tokens[j - 1]?.text === ')' &&
          tokens[firstParen - 1].kind === 'ident' && tokens[firstParen - 2]?.kind === 'ident'
        if (isFunction) {
          const parenClose = matching(tokens, firstParen, '(', ')')
          item = {
            kind: 'function', start: t.start, end: tokens[close].end, first: i, last: close, depth,
            name: tokens[firstParen - 1].text, returnType: tokens[firstParen - 2].text,
            params: glslParams(tokens, firstParen, parenClose), bodyOpen: j, bodyClose: close,
          }
          j = close
        } else {
          // struct S { ... } [name];   or an interface block   uniform B { ... } [name];
          let k = close + 1
          while (k < tokens.length && tokens[k].text !== ';' && tokens[k].kind !== 'directive') k++
          const members: Declarator[] = []
          let s = j + 1
          for (let m = j + 1; m < close; m++) {
            if (tokens[m].text === ';') { members.push(...glslDeclarators(tokens, s, m).declarators); s = m + 1 }
          }
          const isStruct = tokens[i].text === 'struct'
          const last = k < tokens.length && tokens[k].text === ';' ? k : close
          item = {
            kind: isStruct ? 'struct' : 'declaration', start: t.start, end: tokens[last].end, first: i, last, depth,
            name: isStruct ? tokens[i + 1]?.text : tokens[close + 1]?.kind === 'ident' ? tokens[close + 1].text : undefined,
            storage: isStruct ? undefined : tokens.slice(i, j).some(x => x.text === 'uniform') ? 'uniform' : 'block',
            members,
          }
          j = last
        }
        break
      }
    }
    if (!item) {
      // Unterminated statement at the end of the source.
      const last = tokens.length - 1
      item = glslDeclaration(tokens, i, tokens.length, depth)
      item.last = last
      item.end = tokens[last].end
      items.push(item)
      break
    }
    items.push(item)
    i = item.last + 1
  }
  return items
}

function glslDeclaration(tokens: Token[], first: number, semi: number, depth: number): TopItem {
  const words = tokens.slice(first, semi).filter(t => t.kind === 'ident').map(t => t.text)
  const storage = words[0] === 'precision' ? 'precision'
    : words.includes('uniform') ? 'uniform'
    : words.includes('const') ? 'const'
    : words.includes('in') ? 'in'
    : words.includes('out') ? 'out'
    : words[0] === 'layout' ? 'layout'
    : 'global'
  const { declarators } = storage === 'precision' ? { declarators: [] } : glslDeclarators(tokens, first, semi)
  const end = semi < tokens.length ? tokens[semi].end : tokens[tokens.length - 1].end
  return {
    kind: 'declaration', start: tokens[first].start, end, first, last: Math.min(semi, tokens.length - 1), depth,
    storage, declarators, name: declarators[0]?.name,
  }
}

function scanWgsl(tokens: Token[]): TopItem[] {
  const items: TopItem[] = []
  let i = 0
  while (i < tokens.length) {
    const first = i
    if (tokens[i].text === ';') { i++; continue }
    const { next, attributes } = skipWgslAttributes(tokens, i)
    i = next
    const t = tokens[i]
    if (!t) break
    if (t.text === 'fn') {
      const name = tokens[i + 1]?.text
      const open = i + 2
      const close = tokens[open]?.text === '(' ? matching(tokens, open, '(', ')') : open
      const params: Param[] = []
      if (tokens[open]?.text === '(') {
        for (const [a, b] of splitTopLevel(tokens, open + 1, close)) {
          const attrs = skipWgslAttributes(tokens, a)
          const p = attrs.next
          if (tokens[p]?.kind !== 'ident' || tokens[p + 1]?.text !== ':') continue
          params.push({ name: tokens[p].text, type: wgslType(tokens, p + 2, b).type, qualifier: attrs.attributes[0] })
        }
      }
      let k = close + 1
      let returnType: string | undefined
      if (tokens[k]?.text === '->') {
        k = skipWgslAttributes(tokens, k + 1).next
        const ret = wgslType(tokens, k, tokens.length)
        returnType = ret.type
        k = ret.next
      }
      while (k < tokens.length && tokens[k].text !== '{') k++
      const bodyClose = matching(tokens, k, '{', '}')
      const stage = attributes.find(a => a === 'fragment' || a === 'vertex' || a === 'compute')
      items.push({
        kind: 'function', start: tokens[first].start, end: tokens[bodyClose].end, first, last: bodyClose, depth: 0,
        name, returnType, params, bodyOpen: k, bodyClose, stage,
      })
      i = bodyClose + 1
      continue
    }
    if (t.text === 'struct') {
      let k = i + 2
      while (k < tokens.length && tokens[k].text !== '{') k++
      const close = matching(tokens, k, '{', '}')
      const members: Declarator[] = []
      for (const [a, b] of splitTopLevel(tokens, k + 1, close)) {
        const p = skipWgslAttributes(tokens, a).next
        if (tokens[p]?.kind === 'ident' && tokens[p + 1]?.text === ':') {
          members.push({ name: tokens[p].text, type: wgslType(tokens, p + 2, b).type })
        }
      }
      const last = tokens[close + 1]?.text === ';' ? close + 1 : close
      items.push({
        kind: 'struct', start: tokens[first].start, end: tokens[last].end, first, last, depth: 0,
        name: tokens[i + 1]?.text, members,
      })
      i = last + 1
      continue
    }
    // const / var / override / alias / enable / requires / diagnostic / const_assert, up to ';'.
    let k = i
    let depth = 0
    for (; k < tokens.length; k++) {
      const u = tokens[k].text
      if (u === '(' || u === '[' || u === '{') depth++
      else if (u === ')' || u === ']' || u === '}') depth--
      else if (u === ';' && depth <= 0) break
    }
    const last = Math.min(k, tokens.length - 1)
    const item: TopItem = {
      kind: 'declaration', start: tokens[first].start, end: tokens[last].end, first, last, depth: 0, storage: t.text,
    }
    let p = i + 1
    if (t.text === 'var' && tokens[p]?.text === '<') {
      const close = matching(tokens, p, '<', '>')
      item.addressSpace = tokens[p + 1]?.text
      p = close + 1
    }
    if (tokens[p]?.kind === 'ident' && ['const', 'var', 'override', 'alias', 'let'].includes(t.text)) {
      const declarator: Declarator = { name: tokens[p].text }
      let q = p + 1
      if (tokens[q]?.text === ':') {
        const type = wgslType(tokens, q + 1, k)
        declarator.type = type.type
        q = type.next
      }
      if (tokens[q]?.text === '=' && q + 1 < k) declarator.init = [q + 1, k]
      item.name = declarator.name
      item.declarators = [declarator]
    }
    items.push(item)
    i = last + 1
  }
  return items
}

// ------------------------------------------------------------------------------------------------ expressions

export type Expr =
  | { kind: 'number'; tok: number; text: string; type: NumericType; value: number }
  | { kind: 'ident'; tok: number; name: string }
  | { kind: 'call'; tok: number; callee: string; args: Expr[] }
  | { kind: 'member'; tok: number; object: Expr; name: string }
  | { kind: 'index'; tok: number; object: Expr; index: Expr }
  | { kind: 'unary'; tok: number; op: string; arg: Expr; postfix: boolean }
  | { kind: 'binary'; tok: number; op: string; left: Expr; right: Expr }
  | { kind: 'ternary'; tok: number; cond: Expr; then: Expr; else: Expr }
  | { kind: 'assign'; tok: number; op: string; target: Expr; value: Expr }
  | { kind: 'paren'; tok: number; inner: Expr }
  | { kind: 'unknown'; tok: number }

const BINARY_PRECEDENCE: Record<string, number> = {
  '||': 3, '^^': 4, '&&': 5, '|': 6, '^': 7, '&': 8, '==': 9, '!=': 9, '<': 10, '>': 10, '<=': 10, '>=': 10,
  '<<': 11, '>>': 11, '+': 12, '-': 12, '*': 13, '/': 13, '%': 13,
}
const ASSIGNMENT = new Set(['=', '+=', '-=', '*=', '/=', '%=', '<<=', '>>=', '&=', '|=', '^='])
const PREFIX = new Set(['-', '+', '!', '~', '++', '--', '&', '*'])
const PREFIX_PRECEDENCE = 14
const WGSL_TEMPLATED = new Set([
  'vec2', 'vec3', 'vec4', 'mat2x2', 'mat2x3', 'mat2x4', 'mat3x2', 'mat3x3', 'mat3x4', 'mat4x2', 'mat4x3', 'mat4x4',
  'array', 'bitcast', 'ptr', 'atomic',
])
const STOP = new Set([',', ')', ']', ';', ':', '{', '}'])

/** Walks every node of an expression tree, parents first. */
export function walkExpr(expr: Expr | undefined, visit: (e: Expr) => void): void {
  if (!expr) return
  visit(expr)
  switch (expr.kind) {
    case 'call': for (const a of expr.args) walkExpr(a, visit); break
    case 'member': walkExpr(expr.object, visit); break
    case 'index': walkExpr(expr.object, visit); walkExpr(expr.index, visit); break
    case 'unary': walkExpr(expr.arg, visit); break
    case 'binary': walkExpr(expr.left, visit); walkExpr(expr.right, visit); break
    case 'ternary': walkExpr(expr.cond, visit); walkExpr(expr.then, visit); walkExpr(expr.else, visit); break
    case 'assign': walkExpr(expr.target, visit); walkExpr(expr.value, visit); break
    case 'paren': walkExpr(expr.inner, visit); break
  }
}

/** Strips parentheses. */
export function unparen(expr: Expr): Expr {
  while (expr.kind === 'paren') expr = expr.inner
  return expr
}

class ExprParser {
  i: number
  constructor(readonly tokens: Token[], start: number, readonly end: number, readonly language: ShaderCraftLanguage) {
    this.i = start
  }

  peek(offset = 0): Token | undefined {
    const k = this.i + offset
    return k < this.end ? this.tokens[k] : undefined
  }

  /** Parses one expression (no top-level comma). */
  expression(minPrecedence = 0): Expr {
    let left = this.unary()
    for (;;) {
      const t = this.peek()
      if (!t || t.kind !== 'punct') break
      const op = t.text
      if (ASSIGNMENT.has(op)) {
        if (minPrecedence > 1) break
        const tok = this.i++
        const value = this.expression(1)
        left = { kind: 'assign', tok, op, target: left, value }
        continue
      }
      if (op === '?' && this.language === 'glsl') {
        if (minPrecedence > 2) break
        const tok = this.i++
        const then = this.expression(0)
        if (this.peek()?.text === ':') this.i++
        const otherwise = this.expression(2)
        left = { kind: 'ternary', tok, cond: left, then, else: otherwise }
        continue
      }
      const precedence = BINARY_PRECEDENCE[op]
      if (precedence === undefined || precedence < minPrecedence || precedence <= minPrecedence - 1) break
      if (precedence < minPrecedence) break
      const tok = this.i++
      const right = this.expression(precedence + 1)
      left = { kind: 'binary', tok, op, left, right }
    }
    return left
  }

  unary(): Expr {
    const t = this.peek()
    if (t && t.kind === 'punct' && PREFIX.has(t.text)) {
      const tok = this.i++
      return { kind: 'unary', tok, op: t.text, arg: this.unaryOperand(), postfix: false }
    }
    return this.postfix(this.primary())
  }

  unaryOperand(): Expr {
    // Prefix operators bind tighter than every binary operator.
    const t = this.peek()
    if (t && t.kind === 'punct' && PREFIX.has(t.text)) return this.unary()
    return this.postfix(this.primary())
  }

  arguments(): Expr[] {
    // At '('.
    const args: Expr[] = []
    this.i++
    if (this.peek()?.text === ')') { this.i++; return args }
    while (this.i < this.end) {
      const before = this.i
      args.push(this.expression(0))
      const t = this.peek()
      if (t?.text === ',') { this.i++; continue }
      if (t?.text === ')') { this.i++; break }
      if (this.i === before) this.i++
      if (!t) break
      // Unexpected token: skip to the closing parenthesis of this call.
      let depth = 0
      while (this.i < this.end) {
        const u = this.tokens[this.i].text
        if (u === '(' || u === '[') depth++
        else if (u === ')' || u === ']') { if (depth === 0) { this.i++; return args } depth-- }
        this.i++
      }
    }
    return args
  }

  primary(): Expr {
    const tok = this.i
    const t = this.peek()
    if (!t) return { kind: 'unknown', tok }
    if (t.kind === 'number') {
      this.i++
      return { kind: 'number', tok, text: t.text, type: literalType(t.text), value: literalValue(t.text) }
    }
    if (t.kind === 'ident') {
      this.i++
      let callee = t.text
      if (this.language === 'wgsl' && this.peek()?.text === '<' && WGSL_TEMPLATED.has(t.text)) {
        // vec3<f32>(...), array<f32, 4>(...), bitcast<u32>(...)
        let depth = 0
        let k = this.i
        for (; k < this.end; k++) {
          const u = this.tokens[k].text
          if (u === '<') depth++
          else if (u === '>') depth--
          else if (u === '>>') depth -= 2
          if (depth <= 0) break
        }
        callee += this.tokens.slice(this.i, k + 1).map(x => x.text).join('')
        this.i = k + 1
      } else if (this.language === 'glsl' && this.peek()?.text === '[') {
        // float[3](...): an array constructor, unlike a[3].
        let depth = 0
        let k = this.i
        for (; k < this.end; k++) {
          const u = this.tokens[k].text
          if (u === '[') depth++
          else if (u === ']' && --depth === 0) break
        }
        if (this.tokens[k + 1]?.text === '(' && k + 1 < this.end) {
          callee += '[]'
          this.i = k + 1
        }
      }
      if (this.peek()?.text === '(') return { kind: 'call', tok, callee, args: this.arguments() }
      return { kind: 'ident', tok, name: t.text }
    }
    if (t.text === '(') {
      this.i++
      const inner = this.expression(0)
      // A GLSL comma expression: keep the last operand.
      let last = inner
      while (this.peek()?.text === ',') { this.i++; last = this.expression(0) }
      if (this.peek()?.text === ')') this.i++
      return { kind: 'paren', tok, inner: last }
    }
    if (!STOP.has(t.text)) this.i++
    return { kind: 'unknown', tok }
  }

  postfix(expr: Expr): Expr {
    for (;;) {
      const t = this.peek()
      if (!t || t.kind !== 'punct') return expr
      if (t.text === '[') {
        const tok = this.i++
        const index = this.expression(0)
        if (this.peek()?.text === ']') this.i++
        expr = { kind: 'index', tok, object: expr, index }
      } else if (t.text === '.') {
        const tok = this.i++
        const name = this.peek()?.kind === 'ident' ? this.tokens[this.i++].text : ''
        if (this.peek()?.text === '(') {
          // a.length()
          this.arguments()
          expr = { kind: 'call', tok, callee: `.${name}`, args: [expr] }
        } else {
          expr = { kind: 'member', tok, object: expr, name }
        }
      } else if (t.text === '++' || t.text === '--') {
        const tok = this.i++
        expr = { kind: 'unary', tok, op: t.text, arg: expr, postfix: true }
      } else {
        return expr
      }
    }
  }
}

/** Parses the expression in the token range [start, end). */
export function parseExpression(tokens: Token[], start: number, end: number, language: ShaderCraftLanguage): Expr {
  const parser = new ExprParser(tokens, start, end, language)
  const expr = parser.expression(0)
  let last = expr
  while (parser.peek()?.text === ',') { parser.i++; last = parser.expression(0) }
  return parser.i >= end || last === expr ? expr : last
}

// ------------------------------------------------------------------------------------------------ statements

export type Stmt =
  | { kind: 'block'; tok: number; body: Stmt[] }
  | { kind: 'if'; tok: number; cond: Expr; then: Stmt; else?: Stmt }
  | { kind: 'for'; tok: number; init?: Stmt; cond?: Expr; update: Expr[]; body: Stmt }
  | { kind: 'while'; tok: number; cond: Expr; body: Stmt; doWhile: boolean }
  | { kind: 'loop'; tok: number; body: Stmt }
  | { kind: 'switch'; tok: number; selector: Expr; cases: Expr[]; body: Stmt[] }
  | { kind: 'decl'; tok: number; declarators: Array<{ name: string; type?: string; init?: Expr; tok: number }> }
  | { kind: 'expr'; tok: number; expr: Expr }
  | { kind: 'return'; tok: number; value?: Expr }
  | { kind: 'breakIf'; tok: number; cond: Expr }
  | { kind: 'other'; tok: number }

const GLSL_DECL_QUALIFIERS = new Set(['const', 'highp', 'mediump', 'lowp', 'precise', 'invariant'])

class StmtParser {
  i: number
  constructor(readonly tokens: Token[], start: number, readonly end: number, readonly language: ShaderCraftLanguage) {
    this.i = start
  }

  text(offset = 0): string | undefined {
    const k = this.i + offset
    return k < this.end ? this.tokens[k].text : undefined
  }

  /** Index of the first token at depth 0 in [i, end) whose text is one of `stops`. */
  find(stops: string[], from = this.i): number {
    let depth = 0
    for (let k = from; k < this.end; k++) {
      const t = this.tokens[k]
      if (t.kind !== 'punct') continue
      if (depth === 0 && stops.includes(t.text)) return k
      if (t.text === '(' || t.text === '[' || t.text === '{') depth++
      else if (t.text === ')' || t.text === ']' || t.text === '}') { if (depth === 0) return k; depth-- }
    }
    return this.end
  }

  expr(start: number, end: number): Expr {
    return parseExpression(this.tokens, start, end, this.language)
  }

  /** Parses a parenthesized condition at i (GLSL) or the expression up to '{' (WGSL). */
  condition(): Expr {
    if (this.text() === '(' && this.language === 'glsl') {
      const close = matching(this.tokens, this.i, '(', ')')
      const cond = this.expr(this.i + 1, Math.min(close, this.end))
      this.i = close + 1
      return cond
    }
    const stop = this.find(['{'])
    const cond = this.expr(this.i, stop)
    this.i = stop
    return cond
  }

  block(): Stmt[] {
    const body: Stmt[] = []
    while (this.i < this.end && this.text() !== '}') {
      const before = this.i
      body.push(this.statement())
      if (this.i === before) this.i++
    }
    return body
  }

  statement(): Stmt {
    const tok = this.i
    const t = this.tokens[this.i]
    if (!t || this.i >= this.end) return { kind: 'other', tok }
    if (t.kind === 'directive') { this.i++; return { kind: 'other', tok } }
    if (t.text === ';') { this.i++; return { kind: 'other', tok } }
    if (t.text === '{') {
      this.i++
      const body = this.block()
      if (this.text() === '}') this.i++
      return { kind: 'block', tok, body }
    }
    if (t.kind === 'ident') {
      switch (t.text) {
        case 'if': {
          this.i++
          const cond = this.condition()
          const then = this.statement()
          let otherwise: Stmt | undefined
          if (this.text() === 'else') { this.i++; otherwise = this.statement() }
          return { kind: 'if', tok, cond, then, else: otherwise }
        }
        case 'for': {
          this.i++
          if (this.text() !== '(') return this.skip(tok)
          const close = matching(this.tokens, this.i, '(', ')')
          const semi1 = this.find([';'], this.i + 1)
          const semi2 = semi1 < close ? this.find([';'], semi1 + 1) : close
          const initParser = new StmtParser(this.tokens, this.i + 1, semi1 + 1, this.language)
          const init = semi1 > this.i + 1 ? initParser.statement() : undefined
          const cond = semi2 > semi1 + 1 ? this.expr(semi1 + 1, semi2) : undefined
          const update = splitTopLevel(this.tokens, semi2 + 1, close).map(([a, b]) => this.expr(a, b))
          this.i = close + 1
          const body = this.statement()
          return { kind: 'for', tok, init, cond, update, body }
        }
        case 'while': {
          this.i++
          const cond = this.condition()
          const body = this.statement()
          return { kind: 'while', tok, cond, body, doWhile: false }
        }
        case 'do': {
          this.i++
          const body = this.statement()
          let cond: Expr = { kind: 'unknown', tok }
          if (this.text() === 'while') {
            this.i++
            if (this.text() === '(') {
              const close = matching(this.tokens, this.i, '(', ')')
              cond = this.expr(this.i + 1, close)
              this.i = close + 1
            } else {
              const stop = this.find([';'])
              cond = this.expr(this.i, stop)
              this.i = stop
            }
            if (this.text() === ';') this.i++
          }
          return { kind: 'while', tok, cond, body, doWhile: true }
        }
        case 'loop':
          if (this.language === 'wgsl') {
            this.i++
            while (this.text() === '@') { this.i += 2; if (this.text() === '(') this.i = matching(this.tokens, this.i, '(', ')') + 1 }
            return { kind: 'loop', tok, body: this.statement() }
          }
          break
        case 'continuing':
          if (this.language === 'wgsl') { this.i++; return this.statement() }
          break
        case 'switch': {
          this.i++
          const selector = this.condition()
          const cases: Expr[] = []
          const body: Stmt[] = []
          if (this.text() !== '{') return { kind: 'switch', tok, selector, cases, body }
          this.i++
          while (this.i < this.end && this.text() !== '}') {
            const word = this.text()
            if (word === 'case' || word === 'default') {
              this.i++
              const stop = this.find([':', '{'])
              if (word === 'case') for (const [a, b] of splitTopLevel(this.tokens, this.i, stop)) cases.push(this.expr(a, b))
              this.i = stop
              if (this.text() === ':') this.i++
              continue
            }
            const before = this.i
            body.push(this.statement())
            if (this.i === before) this.i++
          }
          if (this.text() === '}') this.i++
          return { kind: 'switch', tok, selector, cases, body }
        }
        case 'return': {
          this.i++
          const stop = this.find([';'])
          const value = stop > this.i ? this.expr(this.i, stop) : undefined
          this.i = stop < this.end ? stop + 1 : stop
          return { kind: 'return', tok, value }
        }
        case 'break': {
          if (this.language === 'wgsl' && this.text(1) === 'if') {
            this.i += 2
            const stop = this.find([';'])
            const cond = this.expr(this.i, stop)
            this.i = stop < this.end ? stop + 1 : stop
            return { kind: 'breakIf', tok, cond }
          }
          return this.skip(tok)
        }
        case 'continue': case 'discard': case 'fallthrough':
          return this.skip(tok)
        case 'let': case 'var': case 'const':
          if (this.language === 'wgsl') return this.wgslDeclaration(tok)
          break
      }
      if (this.language === 'glsl') {
        let k = this.i
        while (k < this.end && GLSL_DECL_QUALIFIERS.has(this.tokens[k].text)) k++
        let after = k + 1
        if (this.tokens[after]?.text === '[' && after < this.end) after = matching(this.tokens, after, '[', ']') + 1
        if (this.tokens[k]?.kind === 'ident' && this.tokens[after]?.kind === 'ident' && after < this.end) {
          return this.glslDeclaration(tok)
        }
      }
    }
    const stop = this.find([';'])
    const expr = this.expr(this.i, stop)
    this.i = stop < this.end ? stop + 1 : stop
    return { kind: 'expr', tok, expr }
  }

  skip(tok: number): Stmt {
    const stop = this.find([';'])
    this.i = stop < this.end ? stop + 1 : Math.max(stop, this.i + 1)
    return { kind: 'other', tok }
  }

  glslDeclaration(tok: number): Stmt {
    const stop = this.find([';'])
    const { declarators } = glslDeclarators(this.tokens, this.i, stop)
    this.i = stop < this.end ? stop + 1 : stop
    return {
      kind: 'decl',
      tok,
      declarators: declarators.map(d => ({
        name: d.name,
        type: d.type,
        init: d.init ? this.expr(d.init[0], d.init[1]) : undefined,
        tok: this.tokens.findIndex((x, k) => k >= tok && x.text === d.name),
      })),
    }
  }

  wgslDeclaration(tok: number): Stmt {
    let k = this.i + 1
    if (this.tokens[k]?.text === '<') k = matching(this.tokens, k, '<', '>') + 1
    const stop = this.find([';'])
    const nameTok = k
    const name = this.tokens[k]?.text ?? ''
    k++
    let type: string | undefined
    if (this.tokens[k]?.text === ':') {
      const parsed = wgslType(this.tokens, k + 1, stop)
      type = parsed.type
      k = parsed.next
    }
    const init = this.tokens[k]?.text === '=' && k + 1 < stop ? this.expr(k + 1, stop) : undefined
    this.i = stop < this.end ? stop + 1 : stop
    return { kind: 'decl', tok, declarators: [{ name, type, init, tok: nameTok }] }
  }
}

/** Parses the statements of a function body whose braces are at token indices open and close. */
export function parseBody(tokens: Token[], open: number, close: number, language: ShaderCraftLanguage): Stmt[] {
  const parser = new StmtParser(tokens, open + 1, close, language)
  return parser.block()
}

/** Parses the expression of a declarator's initializer token range. */
export function parseRange(tokens: Token[], range: [number, number], language: ShaderCraftLanguage): Expr {
  return parseExpression(tokens, range[0], range[1], language)
}

/** Walks statements depth first, giving each statement its enclosing statements, innermost last. */
export function walkStmts(stmts: Stmt[], visit: (stmt: Stmt, parents: Stmt[]) => void, parents: Stmt[] = []): void {
  for (const stmt of stmts) {
    visit(stmt, parents)
    const inner = [...parents, stmt]
    switch (stmt.kind) {
      case 'block': walkStmts(stmt.body, visit, inner); break
      case 'if': walkStmts(stmt.else ? [stmt.then, stmt.else] : [stmt.then], visit, inner); break
      case 'for': walkStmts(stmt.init ? [stmt.init, stmt.body] : [stmt.body], visit, inner); break
      case 'while': case 'loop': walkStmts([stmt.body], visit, inner); break
      case 'switch': walkStmts(stmt.body, visit, inner); break
    }
  }
}

// smoothstep calls whose two edges are numeric literals: GLSL and WGSL leave edge0 >= edge1 undefined, so library
// code writes a falling ramp as 1.0 - smoothstep(lo, hi, x).
export function literalSmoothsteps(source: string, language: ShaderCraftLanguage = 'glsl'): Array<{ call: string; ascending: boolean; offset: number }> {
  const code = maskComments(source, language)
  const found: Array<{ call: string; ascending: boolean; offset: number }> = []
  const literal = /^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?f?$/
  for (const match of code.matchAll(/\bsmoothstep\s*\(/g)) {
    const args = ['']
    let depth = 1, i = match.index + match[0].length
    for (; i < code.length; i++) {
      const c = code[i]
      if (c === '(') depth++
      if (c === ')' && --depth === 0) break
      if (c === ',' && depth === 1) args.push('')
      else args[args.length - 1] += c
    }
    const [lo, hi] = args.map(arg => arg.trim())
    if (literal.test(lo) && literal.test(hi)) {
      found.push({ call: code.slice(match.index, i + 1), ascending: parseFloat(lo) < parseFloat(hi), offset: match.index })
    }
  }
  return found
}

