import { describe, it, expect, vi, beforeEach } from 'vitest'

describe('getAIProvider', () => {
  beforeEach(() => {
    vi.unstubAllEnvs()
    vi.resetModules()
  })

  it('returns null when no keys available', async () => {
    const { getAIProvider } = await import('../ai/provider.js')
    const provider = getAIProvider({ projectRoot: '/nonexistent' })
    expect(provider).toBeNull()
  })

  it('prefers anthropic when ANTHROPIC_API_KEY env is set', async () => {
    vi.stubEnv('ANTHROPIC_API_KEY', 'test-key')
    const { getAIProvider } = await import('../ai/provider.js')
    const provider = getAIProvider({ projectRoot: '/nonexistent' })
    expect(provider?.provider).toBe('anthropic')
    expect(provider?.apiKey).toBe('test-key')
  })

  it('falls back to openai when only OPENAI_API_KEY is set', async () => {
    vi.stubEnv('OPENAI_API_KEY', 'test-openai-key')
    const { getAIProvider } = await import('../ai/provider.js')
    const provider = getAIProvider({ projectRoot: '/nonexistent' })
    expect(provider?.provider).toBe('openai')
  })

  it('anthropic env takes priority over openai env', async () => {
    vi.stubEnv('ANTHROPIC_API_KEY', 'anthropic-key')
    vi.stubEnv('OPENAI_API_KEY', 'openai-key')
    const { getAIProvider } = await import('../ai/provider.js')
    const provider = getAIProvider({ projectRoot: '/nonexistent' })
    expect(provider?.provider).toBe('anthropic')
  })

  it('defaults to undated model ids', async () => {
    // Current model ids are complete as written; a trailing date pins a
    // snapshot that ages out and silently keeps serving an old model.
    const dated = /-\d{8}$/
    const { getAIProvider } = await import('../ai/provider.js')

    vi.stubEnv('ANTHROPIC_API_KEY', 'test-key')
    expect(getAIProvider({ projectRoot: '/nonexistent' })?.model).not.toMatch(dated)

    vi.unstubAllEnvs()
    vi.stubEnv('OPENAI_API_KEY', 'test-key')
    expect(getAIProvider({ projectRoot: '/nonexistent' })?.model).not.toMatch(dated)
  })

  it('honours an explicit model override', async () => {
    vi.stubEnv('ANTHROPIC_API_KEY', 'test-key')
    vi.stubEnv('SHADE_AI_MODEL', 'claude-custom')
    const { getAIProvider } = await import('../ai/provider.js')
    expect(getAIProvider({ projectRoot: '/nonexistent' })?.model).toBe('claude-custom')
  })
})

describe('AI request bounds', () => {
  beforeEach(() => {
    vi.unstubAllEnvs()
    vi.resetModules()
  })

  it('bounds every call with the configured timeout', async () => {
    const { aiClientOptions } = await import('../ai/provider.js')
    expect(aiClientOptions().timeout).toBe(120000)
  })

  it('takes the timeout from SHADE_AI_TIMEOUT_MS', async () => {
    vi.stubEnv('SHADE_AI_TIMEOUT_MS', '9000')
    const { aiClientOptions } = await import('../ai/provider.js')
    expect(aiClientOptions().timeout).toBe(9000)
  })

  it('keeps retries low so a stall cannot multiply the wait', async () => {
    const { aiClientOptions } = await import('../ai/provider.js')
    expect(aiClientOptions().maxRetries).toBeLessThanOrEqual(1)
  })
})

describe('Anthropic telemetry', () => {
  it('does not propagate process-wide tracing into provider requests', async () => {
    const { propagation } = await import('@opentelemetry/api')
    const requests: Headers[] = []
    propagation.setGlobalPropagator({
      inject(_context, carrier, setter) {
        setter.set(carrier, 'traceparent', '00-0123456789abcdef0123456789abcdef-0123456789abcdef-01')
      },
      extract: context => context,
      fields: () => ['traceparent'],
    })
    vi.stubEnv('ANTHROPIC_OPEN_TELEMETRY', 'true')
    vi.stubGlobal('fetch', async (_input: unknown, init: RequestInit) => {
      requests.push(new Headers(init.headers))
      return Response.json({
        id: 'message-test', type: 'message', role: 'assistant', model: 'test-model',
        content: [{ type: 'text', text: 'result' }], stop_reason: 'end_turn', stop_sequence: null,
        usage: { input_tokens: 1, output_tokens: 1 },
      })
    })
    try {
      const { callAI } = await import('../ai/provider.js')
      expect(await callAI({
        system: 'test', userContent: [{ type: 'text', text: 'test' }],
        ai: { provider: 'anthropic', apiKey: 'test-key', model: 'test-model' },
      })).toBe('result')
      expect(requests).toHaveLength(1)
      expect(requests[0].has('traceparent')).toBe(false)
    } finally {
      propagation.disable()
      vi.unstubAllGlobals()
      vi.unstubAllEnvs()
    }
  })
})
