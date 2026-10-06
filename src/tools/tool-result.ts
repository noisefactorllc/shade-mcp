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
  if (e.status === 'error' || typeof e.error === 'string') return 'error'
  if (typeof e.status === 'string' && FAIL_STATUSES.has(e.status)) return 'fail'
  if (e.meets_target === false) return 'fail'
  if (e.status === 'warning') return 'warning'
  if (e.status === 'skipped') return 'skipped'
  return 'ok'
}

function withOutcome(entry: unknown): unknown {
  if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) return entry
  return { outcome: classifyOutcome(entry), ...(entry as object) }
}

/**
 * Wraps a tool payload as MCP content in the shared result envelope.
 *
 * Every text payload is JSON. A single result gains a top-level `outcome`.
 * A batch (an array payload) becomes `{ outcome, summary, results }`: each
 * entry gains its own `outcome`, `summary` counts the entries per outcome, and
 * the batch outcome is `error` when no entry produced a verdict, otherwise
 * the worst entry outcome.
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

/**
 * Routes every tool registered on `server` through the envelope, including
 * errors thrown before a handler reaches its own per-effect try block (for
 * example an unresolvable effect selector). Without this the MCP SDK turns
 * such a throw into a bare-text error a client cannot parse as JSON.
 */
export function guardToolErrors<S extends { tool: (...args: any[]) => any }>(server: S): S {
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
