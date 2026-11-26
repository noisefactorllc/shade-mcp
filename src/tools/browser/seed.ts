import { webcrypto } from 'node:crypto'
import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { BrowserSession } from '../../harness/browser-session.js'
import { getServerUrl } from '../../harness/server-manager.js'
import { toolResult } from '../tool-result.js'
import { getConfig } from '../../config.js'

// The seed tools read and write a program's `seed` directive through the
// engine's own seed API (CanvasRenderer.getSeed and setSeed). Like
// runDslProgram, each call takes a program's DSL and runs it in a private
// browser: no program stays open between calls. Setting the seed returns the
// whole program as the engine's unparser writes it back. Setting the seed
// compiles the program, with built-in effects only; reading it does not.

const MAX_SEED = 4294967295
const dsl = z.string().min(1).max(100_000).describe('Noisemaker DSL program')
const seed = z.number().int().min(0).max(MAX_SEED).describe('Program seed, a whole number from 0 to 4294967295')

export const getProgramSeedSchema = { dsl }
export const setProgramSeedSchema = { dsl, seed }
export const reseedProgramSchema = { dsl }

export type SeedResult =
  | { status: 'ok'; seed: number | null; dsl?: string }
  | { status: 'error'; error: string }

/** A fresh program seed, uniform over 0 to 4294967295. */
export function freshSeed(): number {
  return webcrypto.getRandomValues(new Uint32Array(1))[0]
}

/**
 * Read the program's seed, or, with `newSeed`, set it and return the program
 * as the engine writes it back.
 */
export async function runSeedOperation(session: BrowserSession, program: string, newSeed?: number): Promise<SeedResult> {
  const input = z.object({ dsl, seed: seed.optional() }).parse({ dsl: program, seed: newSeed })
  const config = getConfig()
  return session.runWithConsoleCapture(async () => {
    const page = session.page!
    // page.evaluate is not governed by Playwright's default page timeout. A
    // timed-out call closes its private browser in the tool's finally block.
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      return await Promise.race<SeedResult>([
        page.evaluate(async ({ rendererModule, assetsBase, useBundles, dsl, seed }) => {
          const { CanvasRenderer } = await import(rendererModule)
          const canvas = document.createElement('canvas')
          canvas.width = 16
          canvas.height = 16
          let renderer: any = null
          try {
            renderer = new CanvasRenderer({
              canvas, width: 16, height: 16, basePath: assetsBase,
              bundlePath: `${assetsBase}/effects`, useBundles,
            })
            if (typeof renderer.getSeed !== 'function' || typeof renderer.setSeed !== 'function') {
              throw new Error('Configured Noisemaker renderer does not support getSeed/setSeed; use a Noisemaker 2 renderer with the seed API')
            }
            const manifest = await renderer.loadManifest()
            await renderer.loadEffects(Object.keys(manifest))
            // Reading the directive needs no compiled program.
            if (seed === undefined) {
              renderer.currentDsl = dsl
              return { status: 'ok' as const, seed: renderer.getSeed() }
            }
            await renderer.compile(dsl)
            await renderer.setSeed(seed)
            return { status: 'ok' as const, seed: renderer.getSeed(), dsl: renderer.currentDsl }
          } catch (error: any) {
            // A compile rejection carries diagnostics or errors, not a
            // message. Its errors are written as the engine writes them, with
            // their place, and warnings are left out.
            const diagnostics = Array.isArray(error?.diagnostics)
              ? error.diagnostics.filter((d: any) => !d?.severity || d.severity === 'error').map((d: any) => {
                const text = [d?.code, d?.message].filter(Boolean).join(': ')
                return text && d?.location ? `${text} (line ${d.location.line}, col ${d.location.column})` : text
              }).filter(Boolean).join('; ')
              : ''
            const errors = Array.isArray(error?.errors)
              ? error.errors.map((e: any) => e?.message || String(e)).filter(Boolean).join('; ')
              : ''
            return { status: 'error' as const, error: error?.message || diagnostics || errors || error?.detail || JSON.stringify(error) || String(error) }
          } finally {
            await renderer?.dispose?.().catch(() => {})
            canvas.remove()
          }
        }, {
          rendererModule: config.dslRendererModule.startsWith('/') ? `${getServerUrl()}${config.dslRendererModule}` : config.dslRendererModule,
          assetsBase: config.dslAssetsBase.startsWith('/') ? `${getServerUrl()}${config.dslAssetsBase}` : config.dslAssetsBase,
          useBundles: config.dslUseBundles,
          dsl: input.dsl, seed: input.seed,
        }) as Promise<SeedResult>,
        new Promise<SeedResult>((_, reject) => {
          timer = setTimeout(() => reject(new Error(`Seed call timed out after ${session.timeoutMs} ms`)), session.timeoutMs)
        }),
      ])
    } finally {
      if (timer) clearTimeout(timer)
    }
  })
}

async function withSession<T>(fn: (session: BrowserSession) => Promise<T>): Promise<T> {
  const session = new BrowserSession({ backend: 'webgl2', blankPage: true })
  try {
    await session.setup()
    return await fn(session)
  } finally {
    await session.teardown()
  }
}

export function registerSeedTools(server: McpServer): void {
  server.tool(
    'getProgramSeed',
    'Read a Noisemaker DSL program\'s seed: the value of its seed directive, or null when it has none (it then draws from 0). It reads the directive without compiling or checking the program. Needs a Noisemaker 2 renderer.',
    getProgramSeedSchema,
    async (args: any) => toolResult(await withSession(session => runSeedOperation(session, args.dsl))),
  )
  server.tool(
    'setProgramSeed',
    'Set a Noisemaker DSL program\'s seed and return the seed and the program with its seed directive written or replaced. The whole program comes back as the engine\'s unparser writes it: comments before the search directive are dropped, and literal values are written as compiled, while random calls stay as written. Built-in effects only. Needs a Noisemaker 2 renderer.',
    setProgramSeedSchema,
    async (args: any) => toolResult(await withSession(session => runSeedOperation(session, args.dsl, args.seed))),
  )
  server.tool(
    'reseedProgram',
    'Give a Noisemaker DSL program a fresh random seed and return it as setProgramSeed does. Built-in effects only. Needs a Noisemaker 2 renderer.',
    reseedProgramSchema,
    async (args: any) => toolResult(await withSession(session => runSeedOperation(session, args.dsl, freshSeed()))),
  )
}
