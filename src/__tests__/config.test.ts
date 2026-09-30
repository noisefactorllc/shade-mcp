import { describe, it, expect, vi, beforeEach } from 'vitest'

describe('config', () => {
  beforeEach(() => {
    vi.unstubAllEnvs()
    vi.resetModules()
  })

  it('uses default values when no env vars set', async () => {
    const { getConfig } = await import('../config.js')
    const config = getConfig()
    expect(config.viewerPort).toBe(0)
    expect(config.defaultBackend).toBe('webgl2')
  })

  it('reads SHADE_EFFECTS_DIR from env', async () => {
    vi.stubEnv('SHADE_EFFECTS_DIR', '/custom/effects')
    const { getConfig } = await import('../config.js')
    const config = getConfig()
    expect(config.effectsDir).toBe('/custom/effects')
  })

  it('reads SHADE_VIEWER_PORT from env', async () => {
    vi.stubEnv('SHADE_VIEWER_PORT', '8080')
    const { getConfig } = await import('../config.js')
    const config = getConfig()
    expect(config.viewerPort).toBe(8080)
  })

  it('reads SHADE_BACKEND from env', async () => {
    vi.stubEnv('SHADE_BACKEND', 'webgpu')
    const { getConfig } = await import('../config.js')
    const config = getConfig()
    expect(config.defaultBackend).toBe('webgpu')
  })

  it('falls back to one browser when SHADE_MAX_BROWSERS is not a number', async () => {
    vi.stubEnv('SHADE_MAX_BROWSERS', 'abc')
    const { getConfig } = await import('../config.js')
    expect(getConfig().maxBrowsers).toBe(1)
  })

  it('falls back to an OS-assigned port when SHADE_VIEWER_PORT is not a number', async () => {
    vi.stubEnv('SHADE_VIEWER_PORT', 'abc')
    const { getConfig } = await import('../config.js')
    expect(getConfig().viewerPort).toBe(0)
  })

  it('defaults the browser and AI timeouts', async () => {
    const { getConfig } = await import('../config.js')
    const config = getConfig()
    expect(config.timeoutMs).toBe(120000)
    expect(config.aiTimeoutMs).toBe(120000)
  })

  it('reads SHADE_TIMEOUT_MS and SHADE_AI_TIMEOUT_MS from env', async () => {
    vi.stubEnv('SHADE_TIMEOUT_MS', '5000')
    vi.stubEnv('SHADE_AI_TIMEOUT_MS', '7000')
    const { getConfig } = await import('../config.js')
    const config = getConfig()
    expect(config.timeoutMs).toBe(5000)
    expect(config.aiTimeoutMs).toBe(7000)
  })

  it('ignores a non-positive or non-numeric timeout', async () => {
    vi.stubEnv('SHADE_TIMEOUT_MS', '0')
    vi.stubEnv('SHADE_AI_TIMEOUT_MS', 'soon')
    const { getConfig } = await import('../config.js')
    const config = getConfig()
    expect(config.timeoutMs).toBe(120000)
    expect(config.aiTimeoutMs).toBe(120000)
  })

  it('reads an AI model override from env', async () => {
    const { getConfig } = await import('../config.js')
    expect(getConfig().aiModel).toBeUndefined()
    vi.stubEnv('SHADE_AI_MODEL', 'some-model')
    const { getConfig: reload } = await import('../config.js')
    expect(reload().aiModel).toBe('some-model')
  })

  it('keeps DSL renderer defaults on the served Noisemaker source tree', async () => {
    const { getConfig } = await import('../config.js')
    expect(getConfig().dslRendererModule).toBe('/shaders/src/index.js')
    expect(getConfig().dslAssetsBase).toBe('/shaders')
    expect(getConfig().dslUseBundles).toBe(false)
  })

  it('accepts a separate HTTPS bundled renderer for Portable without changing viewer settings', async () => {
    vi.stubEnv('SHADE_DSL_RENDERER_MODULE', 'https://shaders.noisedeck.app/1/noisemaker-shaders-core.esm.js')
    vi.stubEnv('SHADE_DSL_ASSETS_BASE', 'https://shaders.noisedeck.app/1')
    vi.stubEnv('SHADE_DSL_USE_BUNDLES', 'true')
    vi.stubEnv('SHADE_VIEWER_PATH', '/viewer/index.html')
    const { getConfig } = await import('../config.js')
    const config = getConfig()
    expect(config.dslRendererModule).toBe('https://shaders.noisedeck.app/1/noisemaker-shaders-core.esm.js')
    expect(config.dslAssetsBase).toBe('https://shaders.noisedeck.app/1')
    expect(config.dslUseBundles).toBe(true)
    expect(config.viewerPath).toBe('/viewer/index.html')
  })

  it.each([
    ['SHADE_DSL_RENDERER_MODULE', 'javascript:alert(1)'],
    ['SHADE_DSL_RENDERER_MODULE', 'http://example.org/core.js'],
    ['SHADE_DSL_RENDERER_MODULE', '/shaders/../secret.js'],
    ['SHADE_DSL_RENDERER_MODULE', 'https://user:pass@example.org/core.js'],
    ['SHADE_DSL_ASSETS_BASE', '//example.org/assets'],
    ['SHADE_DSL_ASSETS_BASE', 'https://example.org/1?token=secret'],
    ['SHADE_DSL_USE_BUNDLES', 'sometimes'],
  ])('rejects invalid DSL renderer configuration %s=%s', async (key, value) => {
    vi.stubEnv(key, value)
    const { getConfig } = await import('../config.js')
    expect(() => getConfig()).toThrow(/SHADE_DSL_/)
  })
})
