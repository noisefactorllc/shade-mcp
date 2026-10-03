import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { resolve } from 'node:path'
import { mkdirSync, writeFileSync, rmSync } from 'node:fs'

// A launch failure is the cheapest way to exercise the error path in setup()
// without a real browser.
vi.mock('playwright', () => ({
  chromium: {
    launch: vi.fn(async () => { throw new Error('launch failed') }),
    executablePath: vi.fn(() => '/tmp/shade-mcp-test-vk-bundle/chrome-headless-shell'),
  },
}))

import { chromium } from 'playwright'
import { BrowserSession } from '../harness/browser-session.js'
import { DEFAULT_GLOBALS } from '../harness/types.js'
import { getRefCount, releaseServer } from '../harness/server-manager.js'
import {
  acquireBrowserSlot,
  releaseBrowserSlot,
  resetBrowserQueue,
  getActiveBrowsers,
} from '../harness/browser-queue.js'

const tmpDir = resolve('/tmp/shade-mcp-test-lifecycle-viewer')
const tmpEffects = resolve('/tmp/shade-mcp-test-lifecycle-effects')

function makeSession() {
  return new BrowserSession({
    backend: 'webgl2',
    headless: true,
    viewerPort: 0,
    viewerRoot: tmpDir,
    effectsDir: tmpEffects,
  })
}

describe('browser session lifecycle', () => {
  beforeEach(() => {
    resetBrowserQueue()
    while (getRefCount() > 0) releaseServer()
    mkdirSync(tmpDir, { recursive: true })
    writeFileSync(resolve(tmpDir, 'index.html'), '<h1>viewer</h1>')
    mkdirSync(tmpEffects, { recursive: true })
  })

  afterEach(() => {
    resetBrowserQueue()
    while (getRefCount() > 0) releaseServer()
    rmSync(tmpDir, { recursive: true, force: true })
    rmSync(tmpEffects, { recursive: true, force: true })
  })

  it('releases the server it acquired when setup fails', async () => {
    const session = makeSession()
    await expect(session.setup()).rejects.toThrow('launch failed')
    expect(getRefCount()).toBe(0)
  })

  it('releases the browser slot when setup fails', async () => {
    const session = makeSession()
    await expect(session.setup()).rejects.toThrow('launch failed')
    expect(getActiveBrowsers()).toBe(0)
  })

  it('teardown after a failed setup does not release anything twice', async () => {
    const session = makeSession()
    await expect(session.setup()).rejects.toThrow('launch failed')
    await session.teardown()
    expect(getRefCount()).toBe(0)
    expect(getActiveBrowsers()).toBe(0)
  })

  it('launches headless by default', async () => {
    const session = new BrowserSession({
      backend: 'webgl2',
      viewerPort: 0,
      viewerRoot: tmpDir,
      effectsDir: tmpEffects,
    })
    await expect(session.setup()).rejects.toThrow('launch failed')
    expect(vi.mocked(chromium.launch).mock.calls.at(-1)?.[0]).toMatchObject({ headless: true })
  })

  it('launches headed when SHADE_HEADLESS is 0', async () => {
    vi.stubEnv('SHADE_HEADLESS', '0')
    const session = new BrowserSession({
      backend: 'webgl2',
      viewerPort: 0,
      viewerRoot: tmpDir,
      effectsDir: tmpEffects,
    })
    await expect(session.setup()).rejects.toThrow('launch failed')
    expect(vi.mocked(chromium.launch).mock.calls.at(-1)?.[0]).toMatchObject({ headless: false })
    vi.unstubAllEnvs()
  })

  it('does not use the software rasterizer unless asked', async () => {
    const session = makeSession()
    await expect(session.setup()).rejects.toThrow('launch failed')
    const args = vi.mocked(chromium.launch).mock.calls.at(-1)?.[0]?.args ?? []
    expect(args).not.toContain('--enable-unsafe-swiftshader')
  })

  it('enables the software rasterizer when SHADE_SWIFTSHADER is set', async () => {
    // GPU-less machines (CI runners) have no hardware GL driver at all.
    vi.stubEnv('SHADE_SWIFTSHADER', '1')
    const session = makeSession()
    await expect(session.setup()).rejects.toThrow('launch failed')
    const args = vi.mocked(chromium.launch).mock.calls.at(-1)?.[0]?.args ?? []
    expect(args).toContain('--enable-unsafe-swiftshader')
    vi.unstubAllEnvs()
  })

  it('pins the bundled SwiftShader Vulkan ICD for WebGPU sessions', async () => {
    // Without an ICD the Vulkan loader finds no driver, Dawn's adapter
    // enumeration is erratic, and device requests die with "A valid external
    // Instance reference no longer exists". The browser bundle ships its own
    // SwiftShader ICD next to the binary; WebGPU sessions must point the
    // loader at it.
    const bundleDir = '/tmp/shade-mcp-test-vk-bundle'
    mkdirSync(bundleDir, { recursive: true })
    writeFileSync(resolve(bundleDir, 'vk_swiftshader_icd.json'), '{}')
    vi.stubEnv('SHADE_SWIFTSHADER', '1')
    const session = new BrowserSession({ backend: 'webgpu', headless: true,
      viewerPort: 0, viewerRoot: tmpDir, effectsDir: tmpEffects })
    await expect(session.setup()).rejects.toThrow('launch failed')
    const env = vi.mocked(chromium.launch).mock.calls.at(-1)?.[0]?.env
    expect(env?.VK_DRIVER_FILES).toBe(resolve(bundleDir, 'vk_swiftshader_icd.json'))
    expect(env?.VK_ICD_FILENAMES).toBe(resolve(bundleDir, 'vk_swiftshader_icd.json'))
    expect(env?.LD_LIBRARY_PATH).toContain(bundleDir)
    vi.unstubAllEnvs()
  })

  it('leaves the launch environment alone outside SwiftShader WebGPU', async () => {
    // WebGL2 sessions and non-SwiftShader WebGPU must not change which GL or
    // Vulkan stack renders.
    const session = makeSession()
    await expect(session.setup()).rejects.toThrow('launch failed')
    expect(vi.mocked(chromium.launch).mock.calls.at(-1)?.[0]?.env).toBeUndefined()
    expect(vi.mocked(chromium.executablePath)).not.toHaveBeenCalled()
    // A bundle without the ICD must also launch with no environment changes.
    vi.stubEnv('SHADE_SWIFTSHADER', '1')
    const emptyBundle = '/tmp/shade-mcp-test-vk-bundle-empty'
    mkdirSync(emptyBundle, { recursive: true })
    vi.mocked(chromium.executablePath).mockReturnValue(resolve(emptyBundle, 'chrome-headless-shell'))
    const webgpu = new BrowserSession({ backend: 'webgpu', headless: true,
      viewerPort: 0, viewerRoot: tmpDir, effectsDir: tmpEffects })
    await expect(webgpu.setup()).rejects.toThrow('launch failed')
    expect(vi.mocked(chromium.launch).mock.calls.at(-1)?.[0]?.env).toBeUndefined()
    vi.unstubAllEnvs()
    rmSync(emptyBundle, { recursive: true, force: true })
  })

  it('teardown on a session that was never set up releases nothing', async () => {
    // Stand in for a concurrent session holding the only slot and the server.
    await acquireBrowserSlot()
    expect(getActiveBrowsers()).toBe(1)

    const session = makeSession()
    await session.teardown()

    expect(getActiveBrowsers()).toBe(1)
    releaseBrowserSlot()
  })
})

describe('setBackend (issue #34)', () => {
  let originalWindow: any
  let originalDocument: any

  beforeEach(() => {
    originalWindow = (globalThis as any).window
    originalDocument = (globalThis as any).document
  })

  afterEach(() => {
    ;(globalThis as any).window = originalWindow
    ;(globalThis as any).document = originalDocument
  })

  // A session whose page runs evaluate payloads against a fake viewer.
  function fakePageSession(w: any): BrowserSession {
    ;(globalThis as any).window = w
    ;(globalThis as any).document = { querySelector: () => null }
    const session = new BrowserSession({
      backend: 'webgl2',
      timeoutMs: 200,
      viewerPort: 0,
      viewerRoot: tmpDir,
      effectsDir: tmpEffects,
      globals: DEFAULT_GLOBALS,
    })
    session.page = {
      evaluate: async (fn: (arg: any) => any, arg: any) => fn(arg),
    } as any
    return session
  }

  it('rejects when the fake page\'s current backend never reaches the target within timeoutMs', async () => {
    // No switchBackend, no backend controls: the page backend stays 'glsl'.
    const w: any = {}
    w[DEFAULT_GLOBALS.currentBackend] = () => 'glsl'
    const session = fakePageSession(w)

    await expect(session.setBackend('webgpu'))
      .rejects.toThrow(/Backend switch to webgpu did not take effect within 200 ms/)
    // ...and the page backend is still what it was.
    expect(w[DEFAULT_GLOBALS.currentBackend]()).toBe('glsl')
  })

  it('resolves when the viewer reaches the target backend through switchBackend', async () => {
    const w: any = {}
    w.__kind = 'glsl'
    w[DEFAULT_GLOBALS.currentBackend] = () => w.__kind
    w[DEFAULT_GLOBALS.canvasRenderer] = { switchBackend: async (b: string) => { w.__kind = b } }
    const session = fakePageSession(w)

    await expect(session.setBackend('webgpu')).resolves.toBeUndefined()
    expect(w[DEFAULT_GLOBALS.currentBackend]()).toBe('wgsl')
  })

  it('resolves immediately when the viewer is already on the target backend', async () => {
    const w: any = {}
    w[DEFAULT_GLOBALS.currentBackend] = () => 'glsl'
    const session = fakePageSession(w)

    await expect(session.setBackend('webgl2')).resolves.toBeUndefined()
  })
})
