import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { getConfig } from './config.js'
import { setMaxBrowsers } from './harness/browser-queue.js'

import { createShadeServer } from './server.js'
import { closeAllSessions } from './harness/live-sessions.js'

// Configure browser concurrency from env
const config = getConfig()
setMaxBrowsers(config.maxBrowsers)

const server = createShadeServer()

// Close the browsers and the viewer server on the way out. Without this an
// MCP client that kills the process leaves Chromium running behind it.
let shuttingDown = false
async function shutdown(): Promise<void> {
  if (shuttingDown) return
  shuttingDown = true
  await closeAllSessions()
  await server.close().catch(() => {})
  process.exit(0)
}

process.on('SIGINT', () => { void shutdown() })
process.on('SIGTERM', () => { void shutdown() })

// Start server
const transport = new StdioServerTransport()
await server.connect(transport)
