// A type alias rather than an interface: the SDK's CallToolResult carries an
// index signature, and only aliases pick up the implicit one needed to match it.
export type ToolResult = {
  content: [{ type: 'text'; text: string }, ...Array<{ type: 'image'; data: string; mimeType: string }>]
  isError?: true
}

/**
 * The common domain outcome every tool result carries in `outcome`.
 *
 * - `ok`: the check ran and passed, or the query returned its answer.
 * - `fail`: the check ran and its verdict is negative — a parity `mismatch`,
 *   a `passthrough` filter, `divergent` algorithms, `meets_target: false`.
 * - `warning`: the check ran and reported findings to review (structure
 *   issues, branching opportunities).
 * - `skipped`: nothing was testable.
 * - `error`: the call could not produce a verdict.
 *
 * Verb-specific fields (`status`, `mismatchPercent`, `meets_target`, …) stay
 * as they are; `outcome` is the one field a client can gate on without
 * knowing each verb.
 */
export type Outcome = 'ok' | 'fail' | 'warning' | 'skipped' | 'error'

const FAIL_STATUSES = new Set(['mismatch', 'passthrough', 'divergent', 'fail', 'failed'])

export function classifyOutcome(entry: unknown): Outcome {
  if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) return 'ok'
  const e = entry as { status?: unknown; error?: unknown; meets_target?: unknown }
  // A tool-set status is authoritative. An `error` string decides only for
  // payloads that carry no status (`{ error }`), so a field merged in from
  // AI output cannot turn a verdict into an error.
  if (e.status === 'error' || (e.status === undefined && typeof e.error === 'string')) return 'error'
  if (typeof e.status === 'string' && FAIL_STATUSES.has(e.status)) return 'fail'
  if (e.meets_target === false) return 'fail'
  if (e.status === 'warning') return 'warning'
  if (e.status === 'skipped') return 'skipped'
  return 'ok'
}

function withOutcome(entry: unknown): unknown {
  if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) return entry
  // The computed outcome always wins over an `outcome` key in the payload
  // (for example one merged in from AI output).
  const { outcome: _ignored, ...fields } = entry as Record<string, unknown>
  return { outcome: classifyOutcome(entry), ...fields }
}

/**
 * Wraps a tool payload as MCP content in the shared result envelope.
 *
 * Every text payload is JSON. A single result gains a top-level `outcome`.
 * A batch (an array payload) becomes `{ outcome, summary, results }`: each
 * entry gains its own `outcome`, `summary` counts the entries per outcome, and
 * the batch outcome is `error` when every entry is an `error`, `fail` when any
 * entry is a `fail` or an `error`, `warning` when any is a `warning`,
 * `skipped` when every entry is `skipped`, and `ok` otherwise.
 *
 * `isError` marks a call that failed as a whole: a single `error` result, or
 * a batch in which every entry is an `error`. A negative verdict (`fail`) is
 * a successful call and is reported through `outcome`, not `isError`.
 */
export function toolResult(payload: unknown, images: Array<{ data: string; mimeType: string }> = []): ToolResult {
  let body: unknown
  let failed: boolean
  if (Array.isArray(payload)) {
    const results = payload.map(withOutcome)
    const outcomes = payload.map(classifyOutcome)
    const summary: Record<Outcome, number> & { total: number } = {
      total: outcomes.length, ok: 0, fail: 0, warning: 0, skipped: 0, error: 0,
    }
    for (const o of outcomes) summary[o]++
    failed = outcomes.length > 0 && summary.error === outcomes.length
    const outcome: Outcome = failed ? 'error'
      : summary.error > 0 || summary.fail > 0 ? 'fail'
      : summary.warning > 0 ? 'warning'
      : outcomes.length > 0 && summary.skipped === outcomes.length ? 'skipped'
      : 'ok'
    body = { outcome, summary, results }
  } else {
    body = withOutcome(payload)
    failed = classifyOutcome(payload) === 'error'
  }

  return {
    content: [
      { type: 'text', text: JSON.stringify(body, null, 2) },
      ...images.map(image => ({ type: 'image' as const, ...image })),
    ],
    ...(failed ? { isError: true as const } : {}),
  }
}

/** Whether a tool result's text is already the JSON envelope (an object with an `outcome`). */
function isEnvelope(result: { content?: Array<{ type?: string; text?: unknown }> }): boolean {
  const first = result.content?.[0]
  if (first?.type !== 'text' || typeof first.text !== 'string') return false
  try {
    const body = JSON.parse(first.text)
    return typeof body === 'object' && body !== null && !Array.isArray(body) && typeof body.outcome === 'string'
  } catch {
    return false
  }
}

/**
 * Puts an error result the MCP SDK built itself into the envelope. The SDK
 * answers some calls without running a handler: an argument the tool's input
 * schema rejects ("MCP error -32602: Input validation error: ..."), an
 * unknown or disabled tool. It returns their message as bare `isError` text.
 */
function envelopeSdkError(result: unknown): unknown {
  if (typeof result !== 'object' || result === null) return result
  const r = result as { isError?: unknown; content?: Array<{ type?: string; text?: unknown }> }
  if (r.isError !== true || !Array.isArray(r.content) || isEnvelope(r)) return result
  const message = r.content
    .filter((c) => c?.type === 'text' && typeof c.text === 'string')
    .map((c) => c.text as string)
    .join('\n')
  return toolResult({ status: 'error', error: message || 'Tool call failed' })
}

/** The JSON-RPC method a request schema handles, without importing the SDK. */
function requestMethod(schema: unknown): unknown {
  return (schema as { shape?: { method?: { value?: unknown } } } | null)?.shape?.method?.value
}

/**
 * Routes every tool result on `server` through the envelope, so a client can
 * parse every result text as JSON with an `outcome`:
 *
 * - errors thrown before a handler reaches its own per-effect try block (for
 *   example an unresolvable effect selector);
 * - calls the MCP SDK rejects before any handler runs: an argument that fails
 *   the tool's input schema, or an unknown tool.
 *
 * Without this the SDK turns both into bare-text errors. Apply it before
 * registering any tool: the SDK installs its `tools/call` handler on the
 * first registration, and that is where the SDK's own errors are wrapped.
 * This module does not import the SDK, because the vendored harness bundles
 * it (scripts/check-dist-externals.mjs).
 */
export function guardToolErrors<S extends { tool: (...args: any[]) => any }>(server: S): S {
  const protocol = (server as { server?: { setRequestHandler?: (...args: any[]) => any } }).server
  if (protocol && typeof protocol.setRequestHandler === 'function') {
    const setRequestHandler = protocol.setRequestHandler.bind(protocol)
    protocol.setRequestHandler = (schema: unknown, handler: (...args: any[]) => unknown) => {
      if (requestMethod(schema) !== 'tools/call') return setRequestHandler(schema, handler)
      return setRequestHandler(schema, async (...callArgs: any[]) => envelopeSdkError(await handler(...callArgs)))
    }
  }

  const register = server.tool.bind(server)
  server.tool = ((...args: any[]) => {
    const handler = args[args.length - 1]
    if (typeof handler === 'function') {
      args[args.length - 1] = async (...callArgs: any[]) => {
        try {
          return await handler(...callArgs)
        } catch (err) {
          return toolResult({ status: 'error', error: err instanceof Error ? err.message : String(err) })
        }
      }
    }
    return register(...args)
  }) as S['tool']
  return server
}
