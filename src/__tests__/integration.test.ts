import { describe, it, expect } from 'vitest'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'

// Import all tool registration functions
import { registerCompileEffect } from '../tools/browser/compile.js'
import { registerRenderEffectFrame } from '../tools/browser/render.js'
import { registerDescribeEffectFrame } from '../tools/browser/describe.js'
import { registerBenchmarkEffectFPS } from '../tools/browser/benchmark.js'
import { registerTestUniformResponsiveness } from '../tools/browser/uniforms.js'
import { registerTestNoPassthrough } from '../tools/browser/passthrough.js'
import { registerTestPixelParity } from '../tools/browser/parity.js'
import { registerRunDslProgram } from '../tools/browser/dsl.js'
import { registerCheckEffectStructure } from '../tools/analysis/structure.js'
import { registerCheckAlgEquiv } from '../tools/analysis/alg-equiv.js'
import { registerCompareShaders } from '../tools/analysis/compare.js'
import { registerAnalyzeBranching } from '../tools/analysis/branching.js'
import { registerSearchEffects } from '../tools/knowledge/search-effects.js'
import { registerAnalyzeEffect } from '../tools/knowledge/analyze-effect.js'
import { registerSearchShaderSource } from '../tools/knowledge/search-source.js'
import { registerShaderCraft } from '../tools/knowledge/shader-craft.js'
import { registerSearchShaderKnowledge } from '../tools/knowledge/search-knowledge.js'
import { registerListEffects } from '../tools/utility/list-effects.js'
import { registerGenerateManifest } from '../tools/utility/generate-manifest.js'

const EXPECTED_TOOLS = [
  'searchShaderLibrary', 'checkShader', 'bundleShader',
  'compileEffect',
  'renderEffectFrame',
  'describeEffectFrame',
  'benchmarkEffectFPS',
  'testUniformResponsiveness',
  'testNoPassthrough',
  'testPixelParity',
  'runDslProgram',
  'checkEffectStructure',
  'checkAlgEquiv',
  'compareShaders',
  'analyzeBranching',
  'searchEffects',
  'analyzeEffect',
  'searchShaderSource',
  'searchShaderKnowledge',
  'listEffects',
  'generateManifest',
]

function createServer(): McpServer {
  const server = new McpServer({ name: 'shade-mcp', version: '0.1.0' })
  registerCompileEffect(server)
  registerRenderEffectFrame(server)
  registerDescribeEffectFrame(server)
  registerBenchmarkEffectFPS(server)
  registerTestUniformResponsiveness(server)
  registerTestNoPassthrough(server)
  registerTestPixelParity(server)
  registerRunDslProgram(server)
  registerCheckEffectStructure(server)
  registerCheckAlgEquiv(server)
  registerCompareShaders(server)
  registerAnalyzeBranching(server)
  registerSearchEffects(server)
  registerAnalyzeEffect(server)
  registerSearchShaderSource(server)
  registerSearchShaderKnowledge(server)
  registerShaderCraft(server)
  registerListEffects(server)
  registerGenerateManifest(server)
  return server
}

describe('MCP server integration', () => {
  it('registers all 21 tools', async () => {
    const server = createServer()
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()

    const client = new Client({ name: 'test-client', version: '1.0.0' })

    await server.connect(serverTransport)
    await client.connect(clientTransport)

    const { tools } = await client.listTools()
    const toolNames = tools.map(t => t.name).sort()

    expect(tools).toHaveLength(21)
    expect(toolNames).toEqual(EXPECTED_TOOLS.slice().sort())

    await client.close()
    await server.close()
  })

  it('each tool has a description', async () => {
    const server = createServer()
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()

    const client = new Client({ name: 'test-client', version: '1.0.0' })

    await server.connect(serverTransport)
    await client.connect(clientTransport)

    const { tools } = await client.listTools()

    for (const tool of tools) {
      expect(tool.description, `${tool.name} should have a description`).toBeTruthy()
      expect(tool.inputSchema, `${tool.name} should have an input schema`).toBeTruthy()
    }

    await client.close()
    await server.close()
  })

  it('searchShaderKnowledge returns results for valid query', async () => {
    const server = createServer()
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()

    const client = new Client({ name: 'test-client', version: '1.0.0' })

    await server.connect(serverTransport)
    await client.connect(clientTransport)

    const result = await client.callTool({ name: 'searchShaderKnowledge', arguments: { query: 'noise' } })

    expect(result.content).toBeDefined()
    expect(result.content).toHaveLength(1)

    const text = (result.content as any)[0].text
    const parsed = JSON.parse(text)
    expect(parsed.query).toBe('noise')
    expect(parsed.matchCount).toBeGreaterThan(0)

    await client.close()
    await server.close()
  })
})
