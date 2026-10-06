import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { registerCompileEffect } from './tools/browser/compile.js'
import { registerRenderEffectFrame } from './tools/browser/render.js'
import { registerDescribeEffectFrame } from './tools/browser/describe.js'
import { registerBenchmarkEffectFPS } from './tools/browser/benchmark.js'
import { registerTestUniformResponsiveness } from './tools/browser/uniforms.js'
import { registerTestNoPassthrough } from './tools/browser/passthrough.js'
import { registerTestPixelParity } from './tools/browser/parity.js'
import { registerRunDslProgram } from './tools/browser/dsl.js'

// Analysis tools
import { registerCheckEffectStructure } from './tools/analysis/structure.js'
import { registerCheckAlgEquiv } from './tools/analysis/alg-equiv.js'
import { registerCompareShaders } from './tools/analysis/compare.js'
import { registerAnalyzeBranching } from './tools/analysis/branching.js'

// Knowledge tools
import { registerSearchEffects } from './tools/knowledge/search-effects.js'
import { registerAnalyzeEffect } from './tools/knowledge/analyze-effect.js'
import { registerSearchShaderSource } from './tools/knowledge/search-source.js'
import { registerSearchShaderKnowledge } from './tools/knowledge/search-knowledge.js'

// Utility tools
import { registerListEffects } from './tools/utility/list-effects.js'
import { registerGenerateManifest } from './tools/utility/generate-manifest.js'
import { VERSION } from './version.js'
import { guardToolErrors } from './tools/tool-result.js'

// Builds the MCP server with every tool registered behind the shared result
// envelope. index.ts connects it to stdio; tests connect it in memory, so they
// exercise the same wiring the shipped server uses.
export function createShadeServer(): McpServer {
  const server = guardToolErrors(new McpServer({
    name: 'shade-mcp',
    version: VERSION,
  }))

  // Register all 18 tools
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
  registerListEffects(server)
  registerGenerateManifest(server)

  return server
}
