import { describe, it, expect, vi, afterEach } from 'vitest'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { registerAnalyzeEffect } from '../tools/knowledge/analyze-effect.js'
import { toolResult } from '../tools/tool-result.js'
import { createShadeServer } from '../server.js'

describe('toolResult', () => {
  it('marks a failed result as an error', () => {
    expect(toolResult({ status: 'error', error: 'boom' }).isError).toBe(true)
  })

  it('marks an error-shaped payload with no status field as an error', () => {
    expect(toolResult({ error: 'Effect not found' }).isError).toBe(true)
  })

  it('leaves a successful result unmarked', () => {
    expect(toolResult({ status: 'ok', findings: [] }).isError).toBeUndefined()
  })

  it('leaves a partly failed batch unmarked but counts the failures', () => {
    // A batch that partly succeeded is not a failed call.
    const result = toolResult([{ status: 'ok' }, { status: 'error', error: 'x' }])
    expect(result.isError).toBeUndefined()
    const body = JSON.parse(result.content[0].text)
    expect(body.outcome).toBe('fail')
    expect(body.summary).toEqual({ total: 2, ok: 1, fail: 0, warning: 0, skipped: 0, error: 1 })
    expect(body.results.map((r: any) => r.outcome)).toEqual(['ok', 'error'])
  })

  // Issue #32: a batch with no successful entry is a failed call.
  it('marks a batch in which every entry failed as an error', () => {
    const result = toolResult([{ status: 'error', error: 'a' }, { status: 'error', error: 'b' }])
    expect(result.isError).toBe(true)
    const body = JSON.parse(result.content[0].text)
    expect(body.outcome).toBe('error')
    expect(body.summary.error).toBe(2)
  })

  it('maps verb-specific verdicts onto the common outcome field', () => {
    const outcome = (payload: unknown) => JSON.parse(toolResult(payload).content[0].text).outcome
    expect(outcome({ status: 'mismatch', mismatchPercent: 40 })).toBe('fail')
    expect(outcome({ status: 'passthrough', isFilterEffect: true })).toBe('fail')
    expect(outcome({ status: 'ok', achieved_fps: 20, meets_target: false })).toBe('fail')
    expect(outcome({ status: 'divergent' })).toBe('fail')
    expect(outcome({ status: 'warning' })).toBe('warning')
    expect(outcome({ status: 'skipped' })).toBe('skipped')
    expect(outcome({ status: 'ok', meets_target: true })).toBe('ok')
    expect(outcome({ count: 3 })).toBe('ok')
    // A negative verdict is a successful call: it is not isError.
    expect(toolResult({ status: 'mismatch' }).isError).toBeUndefined()
    // Detail fields are kept beside the outcome.
    expect(JSON.parse(toolResult({ status: 'mismatch', mismatchPercent: 40 }).content[0].text))
      .toEqual({ outcome: 'fail', status: 'mismatch', mismatchPercent: 40 })
  })

  it('keeps the computed outcome when the payload carries its own outcome or error field', () => {
    // analyzeBranching spreads AI JSON into its result; neither field may
    // overwrite the verdict the tool computed.
    const forged = toolResult({ status: 'warning', outcome: 'ok', error: 'model said so', totalOpportunities: 3 })
    expect(JSON.parse(forged.content[0].text).outcome).toBe('warning')
    expect(forged.isError).toBeUndefined()
    // A payload with no status still reports a string error as an error.
    expect(JSON.parse(toolResult({ error: 'Effect not found' }).content[0].text).outcome).toBe('error')
  })

  it('still serializes the payload as text content', () => {
    const result = toolResult({ status: 'ok', value: 1 })
    expect(JSON.parse(result.content[0].text)).toEqual({ outcome: 'ok', status: 'ok', value: 1 })
  })

  it('returns PNG bytes as MCP image content beside metadata', () => {
    const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJ'
    const result = toolResult(
      { status: 'ok', surfaces: ['o0', 'o1'], frames: [1, 120, 600] },
      [{ data: png, mimeType: 'image/png' }],
    )
    expect(result.content).toEqual([
      { type: 'text', text: JSON.stringify({ outcome: 'ok', status: 'ok', surfaces: ['o0', 'o1'], frames: [1, 120, 600] }, null, 2) },
      { type: 'image', data: png, mimeType: 'image/png' },
    ])
    expect(result.content[0].text).not.toContain(png)
  })
})

describe('a failing tool call over MCP', () => {
  it('reports isError to the client', async () => {
    const server = new McpServer({ name: 'test', version: '0.0.0' })
    registerAnalyzeEffect(server)
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
    const client = new Client({ name: 'test-client', version: '1.0.0' })
    await server.connect(serverTransport)
    await client.connect(clientTransport)

    const result = await client.callTool({
      name: 'analyzeEffect',
      arguments: { effect_id: 'nope/does-not-exist' },
    })

    expect(result.isError).toBe(true)

    await client.close()
    await server.close()
  })

  afterEach(() => { vi.unstubAllEnvs() })

  // Issue #32: a throw before the per-effect loop used to reach the client as
  // bare text. The shipped server wiring now returns the JSON envelope.
  it('returns a JSON error envelope when a browser tool cannot resolve its selector', async () => {
    vi.stubEnv('SHADE_EFFECTS_DIR', '/nonexistent/shade-effects-dir')
    const server = createShadeServer()
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
    const client = new Client({ name: 'test-client', version: '1.0.0' })
    await server.connect(serverTransport)
    await client.connect(clientTransport)

    const result: any = await client.callTool({ name: 'renderEffectFrame', arguments: {} })

    expect(result.isError).toBe(true)
    const body = JSON.parse(result.content[0].text)
    expect(body).toEqual({ outcome: 'error', status: 'error', error: expect.stringContaining('Effects directory not found') })

    await client.close()
    await server.close()
  })

  // Issue #32: an argument the input schema rejects never reaches the
  // handler. The SDK turns it into an isError result, and its text must be
  // the same JSON envelope, not bare text.
  async function connectShadeServer() {
    const server = createShadeServer()
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
    const client = new Client({ name: 'test-client', version: '1.0.0' })
    await server.connect(serverTransport)
    await client.connect(clientTransport)
    return { client, close: async () => { await client.close(); await server.close() } }
  }

  it('returns a JSON error envelope when the argument schema rejects a call', async () => {
    const { client, close } = await connectShadeServer()

    const result: any = await client.callTool({
      name: 'renderEffectFrame',
      arguments: { effect_id: 'synth/noise', backend: 'vulkan' },
    })

    expect(result.isError).toBe(true)
    let body: any
    expect(() => { body = JSON.parse(result.content[0].text) }).not.toThrow()
    expect(body).toEqual({
      outcome: 'error',
      status: 'error',
      error: expect.stringMatching(/Input validation error.*backend/),
    })

    await close()
  })

  it('returns a JSON error envelope from every tool for an argument of the wrong type', async () => {
    const { client, close } = await connectShadeServer()
    const { tools } = await client.listTools()
    expect(tools).toHaveLength(18)

    const checked: string[] = []
    for (const tool of tools) {
      // A value of the wrong JSON type for the first typed property: the
      // schema rejects it before the tool runs.
      const props = Object.entries((tool.inputSchema as any).properties ?? {}) as Array<[string, any]>
      const typed = props.find(([, schema]) => typeof schema.type === 'string')
      if (!typed) continue
      const [name, schema] = typed
      const wrong = schema.type === 'object' ? 42 : { not: 'valid' }
      const result: any = await client.callTool({ name: tool.name, arguments: { [name]: wrong } })
      expect(result.isError, tool.name).toBe(true)
      let body: any
      expect(() => { body = JSON.parse(result.content[0].text) }, tool.name).not.toThrow()
      expect(body, tool.name).toEqual({ outcome: 'error', status: 'error', error: expect.stringContaining('Input validation error') })
      checked.push(tool.name)
    }
    // Every tool with a parameter took part, so no tool is left out.
    const withParams = tools.filter((t) => Object.keys((t.inputSchema as any).properties ?? {}).length > 0)
    expect(checked).toEqual(withParams.map((t) => t.name))

    await close()
  })

  it('returns a JSON error envelope for a tool the server does not have', async () => {
    const { client, close } = await connectShadeServer()

    const result: any = await client.callTool({ name: 'noSuchTool', arguments: {} })

    expect(result.isError).toBe(true)
    expect(JSON.parse(result.content[0].text)).toEqual({
      outcome: 'error',
      status: 'error',
      error: expect.stringContaining('noSuchTool'),
    })

    await close()
  })
})
