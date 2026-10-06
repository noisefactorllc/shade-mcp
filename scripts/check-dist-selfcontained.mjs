// Asserts the built dist still works when it is nothing but a file drop.
//
// check-dist-externals covers what dist *imports*; this covers what it
// *reads*. They are the same contract — the drop must not reach outside
// itself — and a reach through the filesystem slips past a scan for bare
// specifiers.
//
// That is how it shipped: 0.2.0 started reading the advertised version out of
// `../package.json` at runtime (createRequire, not an import, so the externals
// scan saw nothing). It resolves in this repo, and for npm consumers, because
// `dist/` sits one level under a package.json in both. The release tarball is
// `tar -C dist .` — the contents of dist, with no package.json above them — so
// portable's `vendor/shade-mcp/index.js` looked for `vendor/package.json`,
// which cannot exist, and its MCP server died at import for 17 days.
//
// Staging under the repo (rather than /tmp) is deliberate: node still walks up
// to our node_modules for the declared externals, exactly as a consumer
// resolves them from its own, while `../package.json` is absent — which is the
// shape of a real vendor drop.
//
// Takes an optional source directory, so the same check covers both ends of
// the pipeline: `dist/` after a build, and the extracted release tarball
// before it is published. The tarball is the artifact consumers actually
// receive, and `tar -C dist .` is a separate step from the build that nothing
// was verifying.
//
// Usage:
//   node scripts/check-dist-selfcontained.mjs            # checks dist/
//   node scripts/check-dist-selfcontained.mjs <dir>      # checks an extracted drop
import { readdirSync, readlinkSync, rmSync, mkdirSync, existsSync, readFileSync, copyFileSync, symlinkSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve } from 'node:path'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const source = process.argv[2] ? resolve(process.argv[2]) : join(root, 'dist')
const label = process.argv[2] ? source : 'dist'
const stage = join(root, '.dist-selfcheck')
const drop = join(stage, 'shade-mcp')

// A recursive copy in plain JS rather than fs.cpSync(..., { recursive: true }):
// Node ≥26's native cpSyncCopyDir fails with EACCES on some filesystems
// (observed on overlayfs) where every other fs call succeeds. Same result,
// portable across Node versions and mount types.
function copyTree(src, dest) {
  mkdirSync(dest, { recursive: true })
  for (const entry of readdirSync(src, { withFileTypes: true })) {
    const from = join(src, entry.name)
    const to = join(dest, entry.name)
    if (entry.isDirectory()) {
      copyTree(from, to)
    } else if (entry.isSymbolicLink()) {
      symlinkSync(readlinkSync(from), to)
    } else {
      copyFileSync(from, to)
    }
  }
}

if (!existsSync(join(source, 'index.js'))) {
  console.error(`check-dist-selfcontained: ${label}/index.js is missing — build first, or point at an extracted drop`)
  process.exit(2)
}

// Staged under the repo even when the source is elsewhere: node must still
// walk up to a node_modules for the declared externals, the way a consumer
// resolves them from its own.
rmSync(stage, { recursive: true, force: true })
mkdirSync(stage, { recursive: true })
copyTree(source, drop)

const request = JSON.stringify({
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'check-dist-selfcontained', version: '1' },
  },
})

const child = spawn(process.execPath, [join(drop, 'index.js')], {
  cwd: stage,
  env: {
    ...process.env,
    SHADE_EFFECTS_DIR: 'effects',
    SHADE_PROJECT_ROOT: '.',
    SHADE_VIEWER_ROOT: '.',
  },
  stdio: ['pipe', 'pipe', 'pipe'],
})

let stdout = ''
let stderr = ''
child.stdout.on('data', d => { stdout += d })
child.stderr.on('data', d => { stderr += d })
child.stdin.write(request + '\n')

const done = new Promise(resolve => {
  const finish = code => resolve(code)
  child.on('exit', finish)
  setTimeout(() => { child.kill('SIGKILL'); finish(null) }, 20000)
  // The server stays up after answering; the handshake is all we need.
  const poll = setInterval(() => {
    if (stdout.includes('"serverInfo"')) { clearInterval(poll); child.kill('SIGKILL'); finish(0) }
  }, 100)
})

await done
rmSync(stage, { recursive: true, force: true })

const line = stdout.split('\n').find(l => l.includes('"serverInfo"'))
if (!line) {
  console.error('check-dist-selfcontained: FAIL — the drop did not complete an MCP handshake.')
  console.error('This is what a vendoring consumer sees when it runs the shipped files.')
  if (stderr.trim()) console.error('\n' + stderr.trim().split('\n').slice(0, 12).join('\n'))
  process.exit(1)
}

const version = JSON.parse(line).result?.serverInfo?.version
if (version !== pkg.version) {
  console.error(`check-dist-selfcontained: FAIL — handshake advertised "${version}", package.json says "${pkg.version}"`)
  process.exit(1)
}

console.log(`check-dist-selfcontained: ok ${label} runs as a bare file drop and advertises ${version}`)
