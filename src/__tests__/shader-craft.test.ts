import { describe, it, expect } from 'vitest'
import {
  SHADER_CRAFT_CATEGORY,
  SHADER_CRAFT_WORKFLOW,
  SHADER_CRAFT_VIDEO_TO_EFFECT,
  SHADER_CRAFT_DOCUMENTS,
  SHADER_CRAFT_PROVENANCE,
  SHADER_CRAFT_CREDITS,
  SHADER_CRAFT_LICENSE,
  SEARCHABLE_KNOWLEDGE,
  CURATED_KNOWLEDGE,
  searchShaderKnowledge,
  retrieveForAgent,
} from '../knowledge/index.js'
import { registerSearchShaderKnowledge } from '../tools/knowledge/search-knowledge.js'

const COMMIT = 'e09bc993bf04201f26c03c87c89210e9b472f526'
// Spelled out rather than imported, so a missing export cannot make an
// undefined category match an empty result.
const CRAFT = 'shader-craft'

const UPSTREAM_REFERENCES = [
  'composition-and-debugging.md',
  'formula-code-couples-materials.md',
  'formula-code-couples-sdf.md',
  'formula-code-couples-terrain.md',
  'formula-cookbook.md',
  'library-index.md',
  'noise-use-cases.md',
  'procedural-buildings.md',
  'rendering-pipeline.md',
  'sdf-library-guide.md',
  'shader-workflow.md',
  'subject-routing.md',
  'terrain-production.md',
  'water-quality.md',
].map(name => `skills/shader-art-coding/references/${name}`)

// The only place the Shadertoy contract may be named: a section that maps it
// onto the effect format for someone porting an existing shader.
const PORTING_HEADING = '## Porting a Shadertoy shader into an effect'
const SHADERTOY_CONTRACT = ['mainImage', 'iTime', 'iResolution', 'iFrame', 'fragCoord', 'gl_FragColor']

function withoutPortingSection(text: string): string {
  const start = text.indexOf(PORTING_HEADING)
  if (start < 0) return text
  const next = text.indexOf('\n## ', start + PORTING_HEADING.length)
  return text.slice(0, start) + (next < 0 ? '' : text.slice(next))
}

function allCraftText(): Array<[string, string]> {
  return [
    ['SHADER_CRAFT_WORKFLOW', SHADER_CRAFT_WORKFLOW],
    ['SHADER_CRAFT_VIDEO_TO_EFFECT', SHADER_CRAFT_VIDEO_TO_EFFECT],
    ['SHADER_CRAFT_CREDITS', JSON.stringify(SHADER_CRAFT_CREDITS)],
    ['SHADER_CRAFT_PROVENANCE', JSON.stringify(SHADER_CRAFT_PROVENANCE)],
    ...SHADER_CRAFT_DOCUMENTS.map((d): [string, string] =>
      [d.id, `${d.title}\n${d.content}\n${d.source}\n${(d.tags || []).join(' ')}`]),
  ]
}

function craftIds(results: Array<{ id: string; category: string }>): string[] {
  return results.filter(r => r.category === CRAFT).map(r => r.id)
}

// Calls the MCP tool's own handler, so the test covers the tool's database
// rather than the exported one Shade vendors.
async function searchViaTool(query: string, limit = 5, category?: string): Promise<Array<{ title: string; category: string }>> {
  let handler: ((args: any) => Promise<any>) | null = null
  const server = { tool: (_n: string, _d: string, _s: unknown, h: (args: any) => Promise<any>) => { handler = h } }
  registerSearchShaderKnowledge(server as any)
  const response = await handler!({ query, limit, category })
  return JSON.parse(response.content[0].text).results
}

describe('shader-craft provenance', () => {
  it('pins the upstream repository, commit, date and licence', () => {
    expect(SHADER_CRAFT_PROVENANCE.upstream.repository).toBe('gokayfem/shader-skills')
    expect(SHADER_CRAFT_PROVENANCE.upstream.commit).toBe(COMMIT)
    expect(SHADER_CRAFT_PROVENANCE.upstream.date).toBe('2026-10-19T15:42:26Z')
    expect(SHADER_CRAFT_PROVENANCE.upstream.license).toBe('MIT')
    expect(SHADER_CRAFT_PROVENANCE.upstream.copyright).toBe('Copyright (c) 2026 gokayfem')
  })

  it('records a git blob hash for every adapted upstream file', () => {
    const paths = SHADER_CRAFT_PROVENANCE.files.map(f => f.path)
    for (const path of [
      'skills/shader-art-coding/SKILL.md',
      'prompts/video-to-shader-prompt.md',
      'CREDITS.md',
      'LICENSE',
      ...UPSTREAM_REFERENCES,
    ]) {
      expect(paths, path).toContain(path)
    }
    for (const file of SHADER_CRAFT_PROVENANCE.files) {
      expect(file.blob, file.path).toMatch(/^[0-9a-f]{40}$/)
    }
  })

  it('maps every searchable document to the upstream file it adapts', () => {
    const adapted = new Set(SHADER_CRAFT_PROVENANCE.files.flatMap(f => f.adaptedAs))
    for (const doc of SHADER_CRAFT_DOCUMENTS) {
      expect(adapted.has(doc.id), doc.id).toBe(true)
    }
  })
})

describe('shader-craft documents', () => {
  it('are well-formed knowledge documents with an upstream source', () => {
    expect(SHADER_CRAFT_DOCUMENTS.length).toBeGreaterThanOrEqual(16)
    const ids = new Set<string>()
    for (const doc of SHADER_CRAFT_DOCUMENTS) {
      expect(doc.id, doc.id).toMatch(/^shader-craft-[a-z0-9-]+$/)
      expect(ids.has(doc.id), `duplicate ${doc.id}`).toBe(false)
      ids.add(doc.id)
      expect(doc.title.trim().length, doc.id).toBeGreaterThan(3)
      expect(doc.content.length, doc.id).toBeGreaterThan(400)
      expect(doc.category, doc.id).toBe(CRAFT)
      expect(doc.category, doc.id).toBe(SHADER_CRAFT_CATEGORY)
      expect(doc.tags?.length ?? 0, doc.id).toBeGreaterThan(0)
      expect(doc.source, doc.id).toContain('shader-skills')
      expect(doc.source, doc.id).toContain(COMMIT.slice(0, 7))
      expect(doc.source, doc.id).toMatch(/(skills\/shader-art-coding|prompts)\/[\w/.-]+\.md/)
    }
  })

  it('adapts all fourteen references and the video workflow', () => {
    const sources = SHADER_CRAFT_DOCUMENTS.map(d => d.source || '')
    for (const path of [...UPSTREAM_REFERENCES, 'prompts/video-to-shader-prompt.md']) {
      expect(sources.some(s => s.includes(path)), path).toBe(true)
    }
  })

  it('names the technique sources each document draws on', () => {
    // Inigo Quilez's articles underlie the SDF catalog; Jarzynski and Olano
    // the PCG hashes the hard rules require.
    const sdf = SHADER_CRAFT_DOCUMENTS.find(d => d.id === 'shader-craft-sdf-library-guide')
    expect(sdf?.source).toContain('Inigo Quilez')
    const hash = SHADER_CRAFT_DOCUMENTS.find(d => d.id === 'shader-craft-library-hash')
    expect(hash?.source).toContain('Jarzynski and Olano')
  })

  it('joins the curated knowledge in one searchable list', () => {
    expect(SEARCHABLE_KNOWLEDGE).toEqual([...CURATED_KNOWLEDGE, ...SHADER_CRAFT_DOCUMENTS])
  })
})

describe('shader-craft text targets Noisemaker effects', () => {
  it('names no part of the Shadertoy contract outside the porting section', () => {
    const offenders: string[] = []
    for (const [label, text] of allCraftText()) {
      const kept = withoutPortingSection(text)
      for (const token of SHADERTOY_CONTRACT) {
        if (kept.includes(token)) offenders.push(`${label}: ${token}`)
      }
    }
    expect(offenders).toEqual([])
  })

  it('names only documents that exist', () => {
    const ids = new Set(SHADER_CRAFT_DOCUMENTS.map(d => d.id))
    const missing = new Set<string>()
    for (const [, text] of allCraftText()) {
      for (const [ref, wildcard] of text.matchAll(/shader-craft-[a-z0-9-]*[a-z0-9](-\*)?/g)) {
        // `shader-craft-library-*` names the family of library module documents.
        if (!wildcard && !ids.has(ref)) missing.add(ref)
      }
    }
    expect([...missing]).toEqual([])
  })

  it('keeps the porting section explicitly named', () => {
    expect(SHADER_CRAFT_WORKFLOW).toContain(PORTING_HEADING)
  })

  it('cites sources by name, with no web addresses', () => {
    const offenders = allCraftText()
      .filter(([, text]) => /https?:\/\//.test(text))
      .map(([label]) => label)
    expect(offenders).toEqual([])
  })

  it('teaches the Noisemaker time contract and the agent commands', () => {
    expect(SHADER_CRAFT_WORKFLOW).toContain('TAU')
    expect(SHADER_CRAFT_WORKFLOW).toContain('DEBUG_MODE')
    for (const command of ['renderAt', 'setLoopDuration', 'setBackend', 'checkShader', 'bundleShader']) {
      expect(SHADER_CRAFT_VIDEO_TO_EFFECT, command).toContain(command)
    }
  })
})

describe('shader-craft licence and credits', () => {
  it('exports the upstream MIT licence with its copyright line', () => {
    expect(SHADER_CRAFT_LICENSE).toContain('MIT License')
    expect(SHADER_CRAFT_LICENSE).toContain('Copyright (c) 2026 gokayfem')
    expect(SHADER_CRAFT_LICENSE).toContain(
      'The above copyright notice and this permission notice shall be included in all\ncopies or substantial portions of the Software.')
  })

  it('credits shader-skills and the original source of each technique', () => {
    const text = JSON.stringify(SHADER_CRAFT_CREDITS)
    expect(SHADER_CRAFT_CREDITS.adaptedFrom).toContain('shader-skills')
    expect(SHADER_CRAFT_CREDITS.adaptedFrom).toContain('Copyright (c) 2026 gokayfem')
    for (const author of ['Inigo Quilez', 'Jarzynski and Olano', 'Hillaire', 'Schneider', 'Ottosson', 'Gustavson']) {
      expect(text, author).toContain(author)
    }
    for (const credit of SHADER_CRAFT_CREDITS.techniques) {
      expect(credit.technique.length, JSON.stringify(credit)).toBeGreaterThan(2)
      expect(credit.source.length, JSON.stringify(credit)).toBeGreaterThan(2)
    }
  })
})

describe('shader-craft search', () => {
  // Short curated notes can outrank a long reference on shared words (the
  // curated SDF note leads "raymarch sdf ..."), so each query must surface one
  // of its craft documents near the top rather than first.
  const cases: Array<[string, string[]]> = [
    ['raymarch sdf debug view', ['shader-craft-composition-and-debugging', 'shader-craft-library-debug', 'shader-craft-sdf-library-guide']],
    ['domain warp fbm terrain', ['shader-craft-noise-use-cases', 'shader-craft-formula-code-couples-terrain', 'shader-craft-terrain-production']],
    ['volumetric clouds', ['shader-craft-rendering-pipeline', 'shader-craft-library-volume', 'shader-craft-formula-cookbook']],
    ['recreate a reference video', ['shader-craft-video-to-effect']],
    ['tonemap agx linear', ['shader-craft-rendering-pipeline', 'shader-craft-library-tonemap']],
    // Found only through the shader-craft synonyms: no stemming, other spellings.
    ['tone mapping', ['shader-craft-library-tonemap', 'shader-craft-rendering-pipeline']],
    ['mountain landscape', ['shader-craft-terrain-production', 'shader-craft-formula-code-couples-terrain']],
    ['match footage', ['shader-craft-video-to-effect']],
    ['gamma correction', ['shader-craft-library-color', 'shader-craft-rendering-pipeline']],
  ]

  for (const [query, expected] of cases) {
    it(`finds craft documents for "${query}" in the exported database`, () => {
      const found = craftIds(searchShaderKnowledge(query, { limit: 5 }))
      expect(expected.some(id => found.includes(id)), `${query}: ${found.join(', ')}`).toBe(true)
    })

    it(`finds craft documents for "${query}" through the searchShaderKnowledge tool`, async () => {
      const results = await searchViaTool(query)
      expect(results.some(r => r.category === CRAFT), query).toBe(true)
    })
  }

  it('lets the tool filter to the shader-craft category', async () => {
    const results = await searchViaTool('smooth union blend', 5, CRAFT)
    expect(results.length).toBeGreaterThan(0)
    expect(results.every(r => r.category === CRAFT)).toBe(true)
  })

  it('leaves craft references out of the automatic prompt context', () => {
    // Agents read craft references on demand. retrieveForAgent injects its
    // results into a system prompt unasked, so it skips them.
    expect(searchShaderKnowledge('recreate a reference video')[0]?.id).toBe('shader-craft-video-to-effect')
    const context = retrieveForAgent('recreate a reference video', 'generate')
    for (const doc of SHADER_CRAFT_DOCUMENTS) {
      expect(context, doc.id).not.toContain(`### ${doc.title} (`)
    }
  })
})
