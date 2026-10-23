import { readdir, stat } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { basename, join } from 'node:path'
import { loadEffectDefinition, type EffectDefinition } from '../formats/index.js'

export class EffectIndex {
  private effects = new Map<string, EffectDefinition>()
  private initialized = false

  async initialize(effectsDir: string): Promise<void> {
    if (this.initialized) return
    if (!existsSync(effectsDir)) return

    // Flat layout: the effects directory is itself one effect, known by the
    // directory's name everywhere else (resolveEffectDir, the viewer server).
    if (existsSync(join(effectsDir, 'definition.json')) || existsSync(join(effectsDir, 'definition.js'))) {
      const id = basename(effectsDir) || 'effect'
      try {
        this.effects.set(id, loadEffectDefinition(effectsDir))
      } catch (err) {
        console.warn(`[shade-mcp] skipping unparseable effect ${id}: ${err instanceof Error ? err.message : String(err)}`)
      }
      this.initialized = true
      return
    }

    const entries = await readdir(effectsDir)
    for (const ns of entries) {
      const nsDir = join(effectsDir, ns)
      if (!(await stat(nsDir)).isDirectory()) continue

      const effects = await readdir(nsDir)
      for (const effect of effects) {
        const effectDir = join(nsDir, effect)
        if (!(await stat(effectDir)).isDirectory()) continue

        try {
          const def = loadEffectDefinition(effectDir)
          const id = `${ns}/${effect}`
          this.effects.set(id, { ...def, namespace: ns })
        } catch (err) {
          // An effect that will not parse is invisible to every search and
          // listing, so say which one rather than dropping it silently.
          console.warn(`[shade-mcp] skipping unparseable effect ${ns}/${effect}: ${err instanceof Error ? err.message : String(err)}`)
        }
      }
    }

    this.initialized = true
  }

  search(query: string, limit = 10): Array<{ id: string; def: EffectDefinition; score: number }> {
    const lower = query.toLowerCase()
    const keywords = lower.split(/\s+/).filter(k => k.length > 1)
    const results: Array<{ id: string; def: EffectDefinition; score: number }> = []

    for (const [id, def] of this.effects) {
      let score = 0

      if (id.toLowerCase().includes(lower)) score += 20
      for (const kw of keywords) {
        if (id.toLowerCase().includes(kw)) score += 8
        if (def.name?.toLowerCase().includes(kw)) score += 15
        if (def.description?.toLowerCase().includes(kw)) score += 5
        if (def.tags?.some(t => t.toLowerCase().includes(kw))) score += 8
        if (def.namespace?.toLowerCase().includes(kw)) score += 12
      }

      if (score > 0) {
        results.push({ id, def, score })
      }
    }

    results.sort((a, b) => b.score - a.score)
    return results.slice(0, limit)
  }

  get(effectId: string): EffectDefinition | undefined {
    return this.effects.get(effectId)
  }

  list(namespace?: string): Array<{ id: string; def: EffectDefinition }> {
    const results: Array<{ id: string; def: EffectDefinition }> = []
    for (const [id, def] of this.effects) {
      if (namespace && def.namespace !== namespace) continue
      results.push({ id, def })
    }
    return results
  }

  get size(): number {
    return this.effects.size
  }
}
