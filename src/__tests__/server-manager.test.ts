import { describe, it, expect, afterEach, vi } from 'vitest'
import { acquireServer, releaseServer, getServerUrl, getRefCount } from '../harness/server-manager.js'
import { resolve } from 'node:path'
import { mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { connect, createServer as createNetServer } from 'node:net'

/** Sends a request with a literal path, bypassing client-side URL normalization. */
function rawGet(port: number, rawPath: string): Promise<string> {
  return new Promise((resolveRaw, reject) => {
    let data = ''
    const socket = connect(port, '127.0.0.1', () => {
      socket.write(`GET ${rawPath} HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n`)
    })
    socket.setTimeout(4000, () => { socket.destroy(); resolveRaw(data) })
    socket.on('data', (chunk) => { data += chunk })
    socket.on('end', () => resolveRaw(data))
    socket.on('error', reject)
  })
}

describe('server-manager', () => {
  it('getServerUrl returns correct URL format', () => {
    const url = getServerUrl()
    expect(url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/)
  })

  it('starts with refCount 0', () => {
    expect(getRefCount()).toBe(0)
  })

  it('releaseServer does not go below 0', () => {
    releaseServer()
    expect(getRefCount()).toBe(0)
  })

  describe('acquireServer with routes', () => {
    // 0 lets the OS assign a free port per acquire. A fixed port made these
    // tests order-dependent: close() is async, so re-binding the same port
    // while the previous socket was still tearing down reset the next
    // connection — which the old traversal test caught and mistook for the
    // server refusing the request.
    const testPort = 0
    const tmpDir = resolve('/tmp/shade-mcp-test-viewer')
    const tmpEffects = resolve('/tmp/shade-mcp-test-effects')

    afterEach(async () => {
      while (getRefCount() > 0) releaseServer()
      rmSync(tmpDir, { recursive: true, force: true })
      rmSync(tmpEffects, { recursive: true, force: true })
    })

    it('serves viewer root at /', async () => {
      mkdirSync(tmpDir, { recursive: true })
      writeFileSync(resolve(tmpDir, 'index.html'), '<h1>test</h1>')
      mkdirSync(tmpEffects, { recursive: true })

      const url = await acquireServer(testPort, tmpDir, tmpEffects)
      const res = await fetch(`${url}/index.html`)
      expect(res.ok).toBe(true)
      const text = await res.text()
      expect(text).toContain('<h1>test</h1>')
    })

    it('falls through the bind candidate chain when the requested bind fails', async () => {
      mkdirSync(tmpDir, { recursive: true })
      writeFileSync(resolve(tmpDir, 'index.html'), '<h1>test</h1>')
      mkdirSync(tmpEffects, { recursive: true })

      // Hold the chain's first fixed candidate so the requested bind fails and
      // the server must serve through the fallthrough — exactly what a
      // co-resident process does to the chain in a restricted runner, where
      // an ephemeral listen(0) is refused with EPERM and only fixed ports
      // bind. Hold a fixed port too: an ephemeral held socket would itself
      // fail EPERM there, uncaught, before the chain is ever exercised.
      const held = createNetServer((socket) => socket.destroy())
      const heldReady = new Promise<void>((resolveHold, rejectHold) => {
        held.once('error', rejectHold)
        held.listen(43117, '127.0.0.1', () => resolveHold())
      })
      await heldReady
      held.on('error', () => {})

      vi.stubEnv('NM_TS_PORT', '43117')
      try {
        const url = await acquireServer(0, tmpDir, tmpEffects)
        expect(url).not.toBe('http://127.0.0.1:43117')
        const res = await fetch(`${url}/index.html`)
        expect(res.ok).toBe(true)
        expect(await res.text()).toContain('<h1>test</h1>')
      } finally {
        vi.unstubAllEnvs()
        // Drain the held socket's close fully so the next test's acquire
        // never re-binds a port whose previous listener is still tearing
        // down — the exact reset the traversal canary below catches.
        await new Promise<void>((resolveHold) => held.close(() => resolveHold()))
      }
    })

    it('serves effects dir at /effects/', async () => {
      mkdirSync(tmpDir, { recursive: true })
      writeFileSync(resolve(tmpDir, 'index.html'), '<h1>test</h1>')
      mkdirSync(resolve(tmpEffects, 'synth/noise'), { recursive: true })
      writeFileSync(resolve(tmpEffects, 'synth/noise/definition.json'), '{"name":"test"}')

      const url = await acquireServer(testPort, tmpDir, tmpEffects)
      const res = await fetch(`${url}/effects/synth/noise/definition.json`)
      expect(res.ok).toBe(true)
      const json = await res.json()
      expect(json.name).toBe('test')
    })

    it('returns 404 for missing files', async () => {
      mkdirSync(tmpDir, { recursive: true })
      writeFileSync(resolve(tmpDir, 'index.html'), '')
      mkdirSync(tmpEffects, { recursive: true })

      const url = await acquireServer(testPort, tmpDir, tmpEffects)
      const res = await fetch(`${url}/nonexistent.html`)
      expect(res.status).toBe(404)
    })

    it('serves flat layout effects via virtual nested path', async () => {
      mkdirSync(tmpDir, { recursive: true })
      writeFileSync(resolve(tmpDir, 'index.html'), '')
      // Create a flat layout in tmpEffects (definition.json at root)
      mkdirSync(tmpEffects, { recursive: true })
      writeFileSync(resolve(tmpEffects, 'definition.json'), '{"name":"flat"}')
      mkdirSync(resolve(tmpEffects, 'glsl'), { recursive: true })
      writeFileSync(resolve(tmpEffects, 'glsl/main.glsl'), 'void main(){}')

      const url = await acquireServer(testPort, tmpDir, tmpEffects)
      // The basename of tmpEffects is the virtual path component
      const effectName = tmpEffects.split('/').pop()

      // Should serve via virtual nested path
      const defRes = await fetch(`${url}/effects/${effectName}/definition.json`)
      expect(defRes.ok).toBe(true)
      const def = await defRes.json()
      expect(def.name).toBe('flat')

      const glslRes = await fetch(`${url}/effects/${effectName}/glsl/main.glsl`)
      expect(glslRes.ok).toBe(true)
      const glsl = await glslRes.text()
      expect(glsl).toContain('void main')

      // Should also serve at root /effects/ path
      const rootDef = await fetch(`${url}/effects/definition.json`)
      expect(rootDef.ok).toBe(true)
    })

    it('ref-counts correctly', async () => {
      mkdirSync(tmpDir, { recursive: true })
      writeFileSync(resolve(tmpDir, 'index.html'), '')
      mkdirSync(tmpEffects, { recursive: true })

      await acquireServer(testPort, tmpDir, tmpEffects)
      expect(getRefCount()).toBe(1)
      await acquireServer(testPort, tmpDir, tmpEffects)
      expect(getRefCount()).toBe(2)
      releaseServer()
      expect(getRefCount()).toBe(1)
      releaseServer()
      expect(getRefCount()).toBe(0)
    })

    it('does not escape the served roots when a client normalizes a traversal', async () => {
      mkdirSync(tmpDir, { recursive: true })
      writeFileSync(resolve(tmpDir, 'index.html'), '')
      mkdirSync(tmpEffects, { recursive: true })

      const url = await acquireServer(testPort, tmpDir, tmpEffects)
      // A compliant client collapses the dot segments before sending, so this
      // arrives as /etc/passwd and resolves inside the viewer root rather than
      // at the filesystem root. The encoded-slash case below is the one that
      // actually reaches the containment check.
      const res = await fetch(`${url}/effects/../../etc/passwd`)

      expect(res.ok).toBe(false)
      expect(await res.text()).not.toContain('root:')
    })

    it('does not send a wildcard CORS header', async () => {
      mkdirSync(tmpDir, { recursive: true })
      writeFileSync(resolve(tmpDir, 'index.html'), '<h1>test</h1>')
      mkdirSync(tmpEffects, { recursive: true })

      const url = await acquireServer(testPort, tmpDir, tmpEffects)
      const res = await fetch(`${url}/index.html`)
      expect(res.ok).toBe(true)
      expect(res.headers.get('access-control-allow-origin')).toBeNull()
    })

    // Consumers load the renderer as an ES module from a page built with
    // page.setContent(), whose origin is the string "null". Refusing that
    // origin is indistinguishable from the server being down: the import
    // fails, the renderer global never appears, and the caller waits out its
    // timeout. noisemaker's whole shader suite works this way.
    it('answers an opaque origin so setContent pages can import modules', async () => {
      mkdirSync(tmpDir, { recursive: true })
      writeFileSync(resolve(tmpDir, 'index.html'), '<h1>test</h1>')
      mkdirSync(tmpEffects, { recursive: true })

      const url = await acquireServer(testPort, tmpDir, tmpEffects)
      const res = await fetch(`${url}/index.html`, { headers: { Origin: 'null' } })
      expect(res.ok).toBe(true)
      expect(res.headers.get('access-control-allow-origin')).toBe('null')
    })

    it('answers a loopback origin with that same origin', async () => {
      mkdirSync(tmpDir, { recursive: true })
      writeFileSync(resolve(tmpDir, 'index.html'), '<h1>test</h1>')
      mkdirSync(tmpEffects, { recursive: true })

      const url = await acquireServer(testPort, tmpDir, tmpEffects)
      const res = await fetch(`${url}/index.html`, { headers: { Origin: 'http://localhost:5173' } })
      expect(res.ok).toBe(true)
      expect(res.headers.get('access-control-allow-origin')).toBe('http://localhost:5173')
    })

    it('refuses a remote origin the response', async () => {
      mkdirSync(tmpDir, { recursive: true })
      writeFileSync(resolve(tmpDir, 'index.html'), '<h1>test</h1>')
      mkdirSync(tmpEffects, { recursive: true })

      const url = await acquireServer(testPort, tmpDir, tmpEffects)
      const res = await fetch(`${url}/index.html`, { headers: { Origin: 'https://evil.example' } })
      // The body still goes over the wire — this is a plain file server, not an
      // authenticated one — but with no matching header the browser will not
      // hand it to the page that asked.
      expect(res.headers.get('access-control-allow-origin')).toBeNull()
    })

    it('survives malformed percent-encoding in the URL', async () => {
      mkdirSync(tmpDir, { recursive: true })
      writeFileSync(resolve(tmpDir, 'index.html'), '<h1>test</h1>')
      mkdirSync(tmpEffects, { recursive: true })

      const url = await acquireServer(testPort, tmpDir, tmpEffects)
      const bad = await fetch(`${url}/%`)
      expect(bad.status).toBe(400)

      // The server must still be alive for subsequent requests
      const good = await fetch(`${url}/index.html`)
      expect(good.ok).toBe(true)
    })

    it('rejects raw traversal into a sibling directory sharing the root prefix', async () => {
      mkdirSync(tmpDir, { recursive: true })
      writeFileSync(resolve(tmpDir, 'index.html'), '')
      mkdirSync(tmpEffects, { recursive: true })
      // Sibling whose path starts with the effects root string
      const sibling = tmpEffects + '-backup'
      mkdirSync(sibling, { recursive: true })
      writeFileSync(resolve(sibling, 'secret.json'), '{"key":"SHOULD-NOT-LEAK"}')

      const url = await acquireServer(testPort, tmpDir, tmpEffects)
      const port = Number(new URL(url).port)
      const siblingName = sibling.split('/').pop()
      // Encoded slashes keep this from being parsed as a dot segment, so the
      // traversal reappears when the handler decodes the path after parsing.
      const raw = await rawGet(port, `/effects/..%2f${siblingName}%2fsecret.json`)
      expect(raw).not.toContain('SHOULD-NOT-LEAK')

      rmSync(sibling, { recursive: true, force: true })
    })

    it('serves viewer assets whose extension is not in the MIME table', async () => {
      mkdirSync(tmpDir, { recursive: true })
      writeFileSync(resolve(tmpDir, 'index.html'), '')
      writeFileSync(resolve(tmpDir, 'bundle.chunk'), 'CHUNK-PAYLOAD')
      mkdirSync(tmpEffects, { recursive: true })

      const url = await acquireServer(testPort, tmpDir, tmpEffects)
      const res = await fetch(`${url}/bundle.chunk`)
      expect(res.ok).toBe(true)
      expect(await res.text()).toContain('CHUNK-PAYLOAD')
    })

    it('refuses to serve dotfiles from the viewer root', async () => {
      mkdirSync(tmpDir, { recursive: true })
      writeFileSync(resolve(tmpDir, 'index.html'), '')
      writeFileSync(resolve(tmpDir, '.anthropic'), 'sk-ant-SHOULD-NOT-LEAK')
      mkdirSync(tmpEffects, { recursive: true })

      const url = await acquireServer(testPort, tmpDir, tmpEffects)
      const res = await fetch(`${url}/.anthropic`)
      expect(res.ok).toBe(false)
      expect(await res.text()).not.toContain('SHOULD-NOT-LEAK')
    })

    it('strips query strings from URLs', async () => {
      mkdirSync(tmpDir, { recursive: true })
      writeFileSync(resolve(tmpDir, 'index.html'), '<h1>test</h1>')
      mkdirSync(tmpEffects, { recursive: true })

      const url = await acquireServer(testPort, tmpDir, tmpEffects)
      const res = await fetch(`${url}/index.html?v=123`)
      expect(res.ok).toBe(true)
      const text = await res.text()
      expect(text).toContain('<h1>test</h1>')
    })
  })
})
