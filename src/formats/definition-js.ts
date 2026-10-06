import { readFileSync } from 'node:fs'
import { parse } from 'acorn'
import type { EffectDefinition } from './types.js'
import { normalizeGlobal, normalizePass } from './normalize.js'

// Reads a definition.js without running it. The module is parsed into an
// AST, the effect's config is located — the object literal passed to
// `new Effect(...)` or `super(...)`, a default-exported object, or the class
// fields of a class that extends Effect — and its literal values are read
// directly. Comments never contribute, and nothing
// from the effect's project is imported or executed.
//
// A value that only exists at run time — a spread, an `Array.from`, a call, a
// reference to another binding such as `stdEnums.x` — cannot be read this way.
// Such a value is left out and the definition is marked `partial`, with a
// reason naming the path, so a caller never mistakes an incomplete projection
// for the whole definition.

type Node = { type: string; start: number; end: number; [key: string]: any }

class Unreadable {
  constructor(readonly reason: string) {}
}

export function parseDefinitionJs(filePath: string, effectDir: string): EffectDefinition {
  const source = readFileSync(filePath, 'utf-8')
  const reasons: string[] = []

  let ast: Node
  try {
    ast = parse(source, { ecmaVersion: 'latest', sourceType: 'module' }) as unknown as Node
  } catch (err) {
    return {
      func: 'unknown',
      globals: {},
      passes: [],
      format: 'js',
      effectDir,
      partial: true,
      partialReasons: [`definition.js does not parse: ${err instanceof Error ? err.message : String(err)}`],
    }
  }

  const props = findConfig(ast, reasons)
  if (!props) {
    return {
      func: 'unknown',
      globals: {},
      passes: [],
      format: 'js',
      effectDir,
      partial: true,
      partialReasons: ['no effect config (an object literal or class fields with a func, globals or passes key) was found'],
    }
  }

  const read = (key: string): unknown => {
    const node = props.get(key)
    if (!node) return undefined
    return readValue(node, key, reasons)
  }

  const func = asString(read('func')) || 'unknown'
  const name = asString(read('name'))
  const namespace = asString(read('namespace'))
  const description = asString(read('description'))
  const starterVal = read('starter')
  const starter = typeof starterVal === 'boolean' ? starterVal : undefined
  const tagsVal = read('tags')
  const tags = Array.isArray(tagsVal) ? tagsVal.filter((t): t is string => typeof t === 'string') : undefined

  const globals: EffectDefinition['globals'] = {}
  const globalsNode = props.get('globals')
  if (globalsNode) {
    if (globalsNode.type !== 'ObjectExpression') {
      reasons.push(`globals: ${describe(globalsNode)} is computed at run time`)
    } else {
      for (const [key, specNode] of objectProperties(globalsNode, 'globals', reasons)) {
        const spec = readValue(specNode, `globals.${key}`, reasons)
        if (spec && typeof spec === 'object' && !Array.isArray(spec)) {
          globals[key] = normalizeGlobal(key, spec as Record<string, unknown>)
        }
      }
    }
  }

  let passes: EffectDefinition['passes'] = []
  const passesNode = props.get('passes')
  if (!passesNode) {
    passes = [{ program: 'main' }]
  } else if (passesNode.type !== 'ArrayExpression') {
    reasons.push(`passes: ${describe(passesNode)} is computed at run time`)
  } else {
    passesNode.elements.forEach((el: Node | null, i: number) => {
      if (!el) return
      if (el.type === 'SpreadElement') {
        reasons.push(`passes[${i}]: spread of ${describe(el.argument)} is computed at run time`)
        return
      }
      const pass = readValue(el, `passes[${i}]`, reasons)
      if (pass && typeof pass === 'object' && !Array.isArray(pass)) {
        passes.push(normalizePass(pass as Record<string, unknown>))
      }
    })
  }

  return {
    func,
    name,
    namespace,
    description,
    starter,
    tags,
    globals,
    passes,
    format: 'js',
    effectDir,
    ...(reasons.length > 0 && { partial: true, partialReasons: reasons }),
  }
}

// The config is the first object literal or class body, in source order, that
// carries one of the keys every effect config has. Class bodies contribute
// their instance fields (`func = 'noise'`), the form several effects use
// instead of passing an object to `super()`.
function findConfig(ast: Node, reasons: string[]): Map<string, Node> | null {
  let found: Node | null = null
  walk(ast, node => {
    if (found && found.start <= node.start) return
    let keys: Array<string | undefined>
    if (node.type === 'ObjectExpression') {
      keys = node.properties
        .filter((p: Node) => p.type === 'Property' && !p.computed)
        .map((p: Node) => propertyKey(p))
    } else if (node.type === 'ClassBody') {
      keys = node.body
        .filter((p: Node) => p.type === 'PropertyDefinition' && !p.static && !p.computed && p.value)
        .map((p: Node) => propertyKey(p))
    } else {
      return
    }
    if (keys.includes('func') || (keys.includes('globals') && keys.includes('passes'))) found = node
  })
  if (!found) return null
  const config = found as Node
  if (config.type === 'ObjectExpression') return objectProperties(config, '', reasons)
  const out = new Map<string, Node>()
  for (const p of config.body as Node[]) {
    if (p.type !== 'PropertyDefinition' || p.static || p.computed || !p.value) continue
    const key = propertyKey(p)
    if (key !== undefined) out.set(key, p.value)
  }
  return out
}

function walk(node: Node, visit: (n: Node) => void): void {
  visit(node)
  for (const value of Object.values(node)) {
    if (Array.isArray(value)) {
      for (const child of value) if (child && typeof child.type === 'string') walk(child, visit)
    } else if (value && typeof value === 'object' && typeof (value as Node).type === 'string') {
      walk(value as Node, visit)
    }
  }
}

function propertyKey(p: Node): string | undefined {
  if (p.key.type === 'Identifier' || p.key.type === 'PrivateIdentifier') return p.key.name
  if (p.key.type === 'Literal') return String(p.key.value)
  return undefined
}

function objectProperties(obj: Node, path: string, reasons: string[]): Map<string, Node> {
  const out = new Map<string, Node>()
  for (const p of obj.properties as Node[]) {
    const where = path ? `${path}.` : ''
    if (p.type === 'SpreadElement') {
      reasons.push(`${path || 'config'}: spread of ${describe(p.argument)} is computed at run time`)
      continue
    }
    const key = p.computed ? undefined : propertyKey(p)
    if (key === undefined) {
      reasons.push(`${where}[${describe(p.key)}]: computed key`)
      continue
    }
    if (p.kind !== 'init' || p.method) continue
    out.set(key, p.value)
  }
  return out
}

function readValue(node: Node, path: string, reasons: string[]): unknown {
  const value = evaluate(node, path, reasons)
  if (value instanceof Unreadable) {
    reasons.push(`${path}: ${value.reason}`)
    return undefined
  }
  return value
}

// Literal-only evaluation. Object members that cannot be read are dropped and
// reported individually, so one computed field does not hide its siblings.
function evaluate(node: Node, path: string, reasons: string[]): unknown {
  switch (node.type) {
    case 'Literal':
      if (node.regex) return new Unreadable('regular expression literal')
      return node.value
    case 'TemplateLiteral':
      if (node.expressions.length > 0) return new Unreadable('template literal with expressions')
      return node.quasis.map((q: Node) => q.value.cooked).join('')
    case 'Identifier':
      if (node.name === 'undefined') return undefined
      if (node.name === 'Infinity') return Infinity
      if (node.name === 'NaN') return NaN
      return new Unreadable(`references ${node.name}`)
    case 'UnaryExpression': {
      const arg = evaluate(node.argument, path, reasons)
      if (arg instanceof Unreadable) return arg
      if (node.operator === '-' && typeof arg === 'number') return -arg
      if (node.operator === '+' && typeof arg === 'number') return +arg
      if (node.operator === '!') return !arg
      return new Unreadable(`unary ${node.operator}`)
    }
    case 'BinaryExpression': {
      const left = evaluate(node.left, path, reasons)
      if (left instanceof Unreadable) return left
      const right = evaluate(node.right, path, reasons)
      if (right instanceof Unreadable) return right
      if (typeof left === 'number' && typeof right === 'number') {
        switch (node.operator) {
          case '+': return left + right
          case '-': return left - right
          case '*': return left * right
          case '/': return left / right
        }
      }
      if (node.operator === '+' && typeof left === 'string' && typeof right === 'string') return left + right
      return new Unreadable(`expression ${describe(node)}`)
    }
    case 'ArrayExpression': {
      const out: unknown[] = []
      for (const [i, el] of (node.elements as Array<Node | null>).entries()) {
        if (!el) { out.push(undefined); continue }
        if (el.type === 'SpreadElement') return new Unreadable(`spread of ${describe(el.argument)} at [${i}]`)
        const v = evaluate(el, `${path}[${i}]`, reasons)
        if (v instanceof Unreadable) return v
        out.push(v)
      }
      return out
    }
    case 'ObjectExpression': {
      const out: Record<string, unknown> = {}
      for (const [key, valueNode] of objectProperties(node, path, reasons)) {
        const v = readValue(valueNode, `${path}.${key}`, reasons)
        if (v !== undefined) out[key] = v
      }
      return out
    }
    default:
      return new Unreadable(`${describe(node)} is computed at run time`)
  }
}

function describe(node: Node): string {
  switch (node.type) {
    case 'Identifier': return node.name
    case 'MemberExpression': {
      const prop = node.computed ? '[…]' : `.${node.property.name}`
      return `${describe(node.object)}${prop}`
    }
    case 'CallExpression': return `${describe(node.callee)}(…)`
    default: return node.type
  }
}

function asString(v: unknown): string | undefined {
  return typeof v === 'string' ? v : undefined
}
