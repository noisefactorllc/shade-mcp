import { describe, it, expect } from 'vitest'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { registerAnalyzeEffect } from '../tools/knowledge/analyze-effect.js'
import { toolResult } from '../tools/tool-result.js'

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

  it('leaves a batch containing a failed entry unmarked', () => {
    // A batch that partly succeeded is not a failed call.
    expect(toolResult([{ status: 'ok' }, { status: 'error' }]).isError).toBeUndefined()
  })

  it('still serializes the payload as text content', () => {
    const result = toolResult({ status: 'ok', value: 1 })
    expect(JSON.parse(result.content[0].text)).toEqual({ status: 'ok', value: 1 })
  })

  it('returns PNG bytes as MCP image content beside metadata', () => {
    const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJ'
    const result = toolResult(
      { status: 'ok', surfaces: ['o0', 'o1'], frames: [1, 120, 600] },
      [{ data: png, mimeType: 'image/png' }],
    )
    expect(result.content).toEqual([
      { type: 'text', text: JSON.stringify({ status: 'ok', surfaces: ['o0', 'o1'], frames: [1, 120, 600] }, null, 2) },
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
})
