import { resolve } from 'node:path'

export type Backend = 'webgl2' | 'webgpu'

const VALID_BACKENDS: readonly Backend[] = ['webgl2', 'webgpu']

export interface Config {
  effectsDir: string
  viewerPort: number
  defaultBackend: Backend
  projectRoot: string
  globalsPrefix: string | undefined
  viewerPath: string | undefined
  maxBrowsers: number
  timeoutMs: number
  aiTimeoutMs: number
  aiModel: string | undefined
  dslRendererModule: string
  dslAssetsBase: string
  dslUseBundles: boolean
}

function parseCount(value: string | undefined, fallback: number): number {
  const parsed = parseInt(value ?? '', 10)
  return Number.isFinite(parsed) ? parsed : fallback
}

/** Durations must be positive; 0 or a typo would disable the guard entirely. */
function parseDuration(value: string | undefined, fallback: number): number {
  const parsed = parseInt(value ?? '', 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

function parseBackend(value: string | undefined): Backend {
  if (value && VALID_BACKENDS.includes(value as Backend)) {
    return value as Backend
  }
  return 'webgl2'
}

/** A browser module/asset URL, either within the harness server or HTTPS. */
function parseDslUrl(value: string | undefined, fallback: string, key: string, module: boolean): string {
  const input = value ?? fallback
  const path = input.startsWith('https://') ? new URL(input).pathname : input
  const segments = path.split('/')
  const validPath = /^\/[A-Za-z0-9._/-]+$/.test(path)
    && !path.includes('//')
    && segments.every(segment => segment !== '.' && segment !== '..')
  const validModule = !module || path.endsWith('.js')
  if (!validPath || !validModule) throw new Error(`${key} must be a root-relative path or HTTPS URL${module ? ' ending in .js' : ''}`)
  if (input.startsWith('https://')) {
    const url = new URL(input)
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) {
      throw new Error(`${key} must be an HTTPS URL without credentials, query, or fragment`)
    }
  } else if (!input.startsWith('/') || input.startsWith('//')) {
    throw new Error(`${key} must be a root-relative path or HTTPS URL`)
  }
  return input.replace(/\/$/, '')
}

function parseDslBundles(value: string | undefined): boolean {
  if (value === undefined || value === 'false' || value === '0') return false
  if (value === 'true' || value === '1') return true
  throw new Error('SHADE_DSL_USE_BUNDLES must be true or false')
}

export function getConfig(): Config {
  const projectRoot = process.env.SHADE_PROJECT_ROOT || process.cwd()
  return {
    effectsDir: process.env.SHADE_EFFECTS_DIR || resolve(projectRoot, 'effects'),
    viewerPort: parseCount(process.env.SHADE_VIEWER_PORT, 0),
    defaultBackend: parseBackend(process.env.SHADE_BACKEND),
    projectRoot,
    globalsPrefix: process.env.SHADE_GLOBALS_PREFIX || undefined,
    viewerPath: process.env.SHADE_VIEWER_PATH || undefined,
    maxBrowsers: parseCount(process.env.SHADE_MAX_BROWSERS, 1),
    timeoutMs: parseDuration(process.env.SHADE_TIMEOUT_MS, 120000),
    aiTimeoutMs: parseDuration(process.env.SHADE_AI_TIMEOUT_MS, 120000),
    aiModel: process.env.SHADE_AI_MODEL || undefined,
    dslRendererModule: parseDslUrl(process.env.SHADE_DSL_RENDERER_MODULE, '/shaders/src/index.js', 'SHADE_DSL_RENDERER_MODULE', true),
    dslAssetsBase: parseDslUrl(process.env.SHADE_DSL_ASSETS_BASE, '/shaders', 'SHADE_DSL_ASSETS_BASE', false),
    dslUseBundles: parseDslBundles(process.env.SHADE_DSL_USE_BUNDLES),
  }
}
