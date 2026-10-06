import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'node:http'
import { createReadStream, existsSync, realpathSync } from 'node:fs'
import { extname, join, resolve as pathResolve, normalize, basename, relative, sep } from 'node:path'

let httpServer: Server | null = null
let refCount = 0
let activePort = 0
let requestedPort = 0
let fixedFallbackCursor = 0
// Resolves when the last released server has fully drained. Binding a new
// server to a port whose previous listener is still tearing down resets the
// next connection (the reason these tests used ephemeral ports), so an
// acquire after a release waits for the drain first.
let lastReleaseDrain: Promise<void> | null = null

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.mjs': 'application/javascript',
  '.json': 'application/json',
  '.css': 'text/css',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.ico': 'image/x-icon',
  '.svg': 'image/svg+xml',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.wasm': 'application/wasm',
  '.map': 'application/json',
  '.txt': 'text/plain',
  '.csv': 'text/csv',
  '.xml': 'application/xml',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.wav': 'audio/wav',
  '.bin': 'application/octet-stream',
  '.data': 'application/octet-stream',
  '.glsl': 'text/plain',
  '.wgsl': 'text/plain',
  '.frag': 'text/plain',
  '.vert': 'text/plain',
  '.comp': 'text/plain',
}

function safePath(root: string, relPath: string): string | null {
  const rootResolved = pathResolve(root)
  const resolved = pathResolve(rootResolved, normalize(relPath))

  // Containment must respect segment boundaries: a sibling directory whose name
  // merely starts with the root's name is outside the root.
  if (resolved !== rootResolved && !resolved.startsWith(rootResolved + sep)) return null

  // Never serve dotfiles or anything beneath a dot-directory: that is where API
  // keys (.anthropic, .openai), .env files and .git internals live.
  const rel = relative(rootResolved, resolved)
  if (rel && rel.split(sep).some(segment => segment.startsWith('.'))) return null

  // Re-check containment after symlink resolution so links cannot escape the root.
  try {
    const realRoot = realpathSync(rootResolved)
    const realTarget = realpathSync(resolved)
    if (realTarget !== realRoot && !realTarget.startsWith(realRoot + sep)) return null
  } catch {
    // Path does not exist yet; serveFile reports 404 below.
  }

  return resolved
}

const LOOPBACK_ORIGIN = /^https?:\/\/(127\.0\.0\.1|\[::1\]|localhost)(:\d+)?$/

// Which Origin, if any, this server will answer cross-origin.
//
// Consumers drive the viewer from pages built with page.setContent(), which
// have an opaque origin, so importing /shaders/src/index.js as an ES module is
// a cross-origin request that needs CORS. 0.2.0 dropped the blanket
// `Access-Control-Allow-Origin: *` — any page open in the user's browser could
// read whatever the viewer root exposed — and took noisemaker's shader tests
// down with it, because every one of them loads the renderer exactly that way.
//
// Echoing only opaque and loopback origins keeps both properties: a page at
// https://evil.example still gets no header, so the browser refuses it the
// response, while setContent pages and the viewer's own pages work. The
// wildcard is not needed for either. What actually kept `.anthropic` and
// `.openai` unreadable is the dotfile refusal in safePath, which stands.
function allowedOrigin(req: IncomingMessage): string | null {
  const origin = req.headers.origin
  if (typeof origin !== 'string') return null
  if (origin === 'null') return 'null'
  return LOOPBACK_ORIGIN.test(origin) ? origin : null
}

function serveFile(filePath: string, res: ServerResponse, corsOrigin: string | null): void {
  const ext = extname(filePath).toLowerCase()
  const mime = MIME_TYPES[ext] || 'application/octet-stream'
  const stream = createReadStream(filePath)
  stream.on('error', (err) => {
    if (!res.headersSent) {
      const status = (err as NodeJS.ErrnoException).code === 'ENOENT' ? 404 : 500
      res.writeHead(status)
    }
    res.end()
  })
  stream.on('open', () => {
    const headers: Record<string, string> = {
      'Content-Type': mime,
      'Cache-Control': 'no-store',
      Vary: 'Origin',
    }
    if (corsOrigin) headers['Access-Control-Allow-Origin'] = corsOrigin
    res.writeHead(200, headers)
    stream.pipe(res)
  })
}

export async function acquireServer(
  port: number,
  viewerRoot: string,
  effectsDir: string,
): Promise<string> {
  if (refCount > 0) {
    if (port !== requestedPort) {
      throw new Error(`The server already runs on port ${activePort} (requested ${requestedPort}). It cannot switch to ${port}.`)
    }
    refCount++
    return getServerUrl()
  }
  requestedPort = port

  if (lastReleaseDrain) {
    const drain = lastReleaseDrain
    lastReleaseDrain = null
    await drain
  }

  // Detect flat layout (effectsDir itself contains definition.json/js)
  const isFlatLayout = existsSync(join(effectsDir, 'definition.json')) || existsSync(join(effectsDir, 'definition.js'))
  const flatEffectName = isFlatLayout ? basename(effectsDir) : null

  const route = (req: IncomingMessage, res: ServerResponse): void => {
    const corsOrigin = allowedOrigin(req)
    let url: string
    try {
      const parsedUrl = new URL(req.url || '/', `http://${req.headers.host || '127.0.0.1'}`)
      url = decodeURIComponent(parsedUrl.pathname)
    } catch {
      // Malformed request target or Host header. Without this the throw would
      // escape the request listener and take the whole MCP server down.
      res.writeHead(400)
      res.end('Bad Request')
      return
    }

    // Route: /effects/* → effectsDir
    if (url.startsWith('/effects/')) {
      const relPath = url.slice('/effects/'.length)

      // Flat layout: /effects/{basename}/* → effectsDir/*
      if (flatEffectName && relPath.startsWith(flatEffectName + '/')) {
        const innerPath = relPath.slice(flatEffectName.length + 1)
        const filePath = safePath(effectsDir, innerPath)
        if (!filePath) { res.writeHead(403); res.end('Forbidden'); return }
        serveFile(filePath, res, corsOrigin)
        return
      }

      // Normal nested layout: /effects/* → effectsDir/*
      const filePath = safePath(effectsDir, relPath)
      if (!filePath) {
        res.writeHead(403)
        res.end('Forbidden')
        return
      }
      serveFile(filePath, res, corsOrigin)
      return
    }

    // Route: everything else → viewerRoot
    let relPath = url === '/' ? 'index.html' : url.slice(1)
    // Resolve directory URLs to index.html
    if (relPath.endsWith('/')) {
      relPath += 'index.html'
    }
    const filePath = safePath(viewerRoot, relPath)
    if (!filePath) {
      res.writeHead(403)
      res.end('Forbidden')
      return
    }
    serveFile(filePath, res, corsOrigin)
  }

  const createHttpServer = (): Server => {
    const server = createServer((req: IncomingMessage, res: ServerResponse) => {
      try {
        route(req, res)
      } catch {
        if (!res.headersSent) res.writeHead(500)
        res.end()
      }
    })
    // Malformed HTTP framing must not surface as an uncaught exception either.
    server.on('clientError', (_err, socket) => {
      if (socket.writable) socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n')
      else socket.destroy()
    })
    return server
  }

  // Restricted runners (supervisor verification sandboxes, the macOS host
  // broker) refuse an ephemeral listen(0) on loopback with EPERM while
  // permitting explicit fixed ports. Bind through a candidate chain instead of
  // failing the whole acquisition: an NM_TS_PORT override first, then the
  // requested port, then a small fixed range — each attempt on a fresh server
  // with a one-shot error handler that closes and moves on, rejecting only
  // after every candidate fails. An explicitly requested nonzero port keeps
  // the old single-attempt semantics: it either binds or surfaces its error.
  const FIXED_FALLBACK_PORTS = [43117, 43118, 43119, 43120, 43121, 43122, 43123, 43124, 43125, 43126]
  const candidates: number[] = []
  if (port === 0) {
    const override = Number.parseInt(process.env.NM_TS_PORT ?? '', 10)
    if (Number.isInteger(override) && override > 0 && override <= 65535) candidates.push(override)
    // Rotate the fallback range so sequential acquires in the same process do
    // not all hammer the same port: a test suite that releases and re-acquires
    // per test would otherwise re-bind the first range port every time, right
    // after the previous socket's teardown.
    candidates.push(0)
    for (let i = 0; i < FIXED_FALLBACK_PORTS.length; i++) {
      candidates.push(FIXED_FALLBACK_PORTS[(fixedFallbackCursor + i) % FIXED_FALLBACK_PORTS.length])
    }
    fixedFallbackCursor = (fixedFallbackCursor + 1) % FIXED_FALLBACK_PORTS.length
  } else {
    candidates.push(port)
  }

  await new Promise<void>((resolve, reject) => {
    const attempt = (index: number, lastError?: Error): void => {
      if (index >= candidates.length) {
        reject(lastError ?? new Error(`Could not bind the viewer server on any candidate port (${candidates.join(', ')})`))
        return
      }
      const candidate = candidates[index]
      const server = createHttpServer()
      const onError = (err: Error): void => {
        server.close()
        attempt(index + 1, err)
      }
      server.once('error', onError)
      server.listen(candidate, '127.0.0.1', () => {
        server.removeListener('error', onError)
        httpServer = server
        const addr = server.address()
        activePort = typeof addr === 'object' && addr ? addr.port : candidate
        resolve()
      })
    }
    attempt(0)
  })

  refCount = 1
  return getServerUrl()
}

export function releaseServer(): void {
  if (refCount <= 0) return
  refCount--
  if (refCount === 0 && httpServer) {
    const server = httpServer
    httpServer = null
    activePort = 0
    requestedPort = 0
    lastReleaseDrain = new Promise<void>((resolve) => server.close(() => resolve()))
  }
}

export function getServerUrl(): string {
  return `http://127.0.0.1:${activePort}`
}

export function getRefCount(): number {
  return refCount
}
