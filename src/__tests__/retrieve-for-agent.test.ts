import { describe, it, expect } from 'vitest'
import { createHash } from 'node:crypto'
import { retrieveForAgent, CURATED_KNOWLEDGE } from '../knowledge/index.js'

// retrieveForAgent builds the RAG section of Shade's in-app system prompt. Its
// output must not move when the searchable corpus grows (shader-craft added 36
// documents and new synonyms): a larger corpus changes IDF, which reorders and
// drops curated results.
//
// Every expected value below was produced by running retrieveForAgent at
// shade-mcp 531ae0c4ebbb07c56614e0ec0e7b510e356a0c9b, the commit before the
// shader-craft knowledge, on the same queries. `ids` are the retrieved curated
// documents in order; `sha256` covers the whole returned string.
const BASELINE: Array<{
  query: string
  phase: 'generate' | 'fix'
  context: { technique?: string; error?: string }
  ids: string[]
  sha256: string
}> = [
  { query: 'blur the input', phase: 'generate', context: {},
    ids: ['filter-effects', 'noise-techniques', 'sdf-techniques'],
    sha256: 'd6586d11f414515d57f9839c840d8ca37507d15909b6a2439adb2123752bced0' },
  { query: 'voronoi cells', phase: 'generate', context: {},
    ids: ['noise-techniques', 'domain-warping'],
    sha256: 'ba39f3a5836a500b6e0dfb647d1fa2f53e9cef4c67f1d966801f62a8c6392d0b' },
  { query: 'particles flow field', phase: 'generate', context: {},
    ids: ['sdf-techniques', 'compute-shaders', 'glsl-uniforms'],
    sha256: '79cf57e80c5d983fdea91473c752834111ecb0f9edf4c5c0a14a8dfae8ba0833' },
  { query: 'noise animation', phase: 'generate', context: {},
    ids: ['noise-techniques', 'animation-patterns', 'domain-warping', 'common-errors'],
    sha256: '6f1e23ba1f4295bcdfd0b1e148e086f5a59362ca37f0299b476780735f13aa8f' },
  { query: 'kaleidoscope mirror symmetry', phase: 'generate', context: {},
    ids: [],
    sha256: '4419ced9f9cf39d850259a58dfbc57b7d93454e04d2c473cdd37e5c1826cf942' },
  { query: 'linear gradient with fog', phase: 'generate', context: {},
    ids: ['color-manipulation', 'common-errors'],
    sha256: '6fab2848e80bd0afe106611d030667d9ea81c73bbcfe70499dfcc798376a555f' },
  { query: 'random hash per cell', phase: 'generate', context: {},
    ids: ['noise-techniques'],
    sha256: 'bb350a6807548149e8747b9ac3aa5bc2b6797beb8c0510ec73103d970b39c38b' },
  { query: 'water ripple terrain', phase: 'generate', context: {},
    ids: [],
    sha256: '4419ced9f9cf39d850259a58dfbc57b7d93454e04d2c473cdd37e5c1826cf942' },
  { query: 'tonemap glow over volumetric clouds', phase: 'generate', context: {},
    ids: [],
    sha256: '4419ced9f9cf39d850259a58dfbc57b7d93454e04d2c473cdd37e5c1826cf942' },
  { query: 'domain warp', phase: 'generate', context: { technique: 'fbm' },
    ids: ['domain-warping', 'noise-techniques', 'filter-effects'],
    sha256: '4cec184022f8bd9398030186cd440615c51001a4f137f694506d6fe072a480a1' },
  { query: 'shader is blank', phase: 'fix', context: { error: 'blank output' },
    ids: ['common-errors', 'dsl-basics', 'filter-effects'],
    sha256: '79822f64b685451cce31b1b5411389fa54983b9e7c2e19a8bc936dddc0883eac' },
  { query: 'compile error', phase: 'fix', context: { error: 'undeclared identifier' },
    ids: ['common-errors'],
    sha256: 'd85cb2caf4307c7803c4a860be269c5e7719c1139ab5d02b3febc944d41bf738' },
]

const EXAMPLES_MARKER = '## RELEVANT EXAMPLES & PATTERNS'

// The phase rules carry their own ### headings, so read only the retrieved section.
function retrievedIds(text: string): string[] {
  const byTitle = new Map(CURATED_KNOWLEDGE.map(d => [d.title, d.id]))
  const at = text.indexOf(EXAMPLES_MARKER)
  if (at < 0) return []
  return [...text.slice(at).matchAll(/^### (.+) \(([^()]+)\)$/gm)].map(m => byTitle.get(m[1]) ?? `?${m[1]}`)
}

describe('retrieveForAgent matches its output before shader-craft', () => {
  for (const { query, phase, context, ids, sha256 } of BASELINE) {
    it(`"${query}" (${phase}) retrieves the baseline documents in order`, () => {
      const text = retrieveForAgent(query, phase, context)
      expect(retrievedIds(text)).toEqual(ids)
      expect(createHash('sha256').update(text).digest('hex')).toBe(sha256)
    })
  }
})
