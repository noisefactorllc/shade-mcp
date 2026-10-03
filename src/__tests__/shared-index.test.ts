import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { resolve } from 'node:path'

const tmpEffects = resolve('/tmp/shade-mcp-test-shared-index')

function writeEffect(id: string) {
  const dir = resolve(tmpEffects, id)
  mkdirSync(dir, { recursive: true })
  writeFileSync(resolve(dir, 'definition.json'), JSON.stringify({
    func: id.split('/')[1],
    description: `${id} effect`,
    passes: [],
  }))
}

describe('shared effect index', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.unstubAllEnvs()
    rmSync(tmpEffects, { recursive: true, force: true })
    writeEffect('synth/noise')
    vi.stubEnv('SHADE_EFFECTS_DIR', tmpEffects)
  })

  afterEach(() => {
    vi.useRealTimers()
    rmSync(tmpEffects, { recursive: true, force: true })
  })

  it('picks up an effect added after the first lookup', async () => {
    const { getSharedEffectIndex } = await import('../knowledge/shared-instances.js')

    expect((await getSharedEffectIndex()).list()).toHaveLength(1)

    writeEffect('synth/plasma')
    vi.useFakeTimers()
    vi.advanceTimersByTime(60_000)

    expect((await getSharedEffectIndex()).list()).toHaveLength(2)
  })

  it('serves concurrent callers a single build', async () => {
    const { getSharedEffectIndex } = await import('../knowledge/shared-instances.js')

    const [a, b] = await Promise.all([getSharedEffectIndex(), getSharedEffectIndex()])

    expect(a).toBe(b)
  })

  it('supersedes an in-flight build when invalidated', async () => {
    const { EffectIndex } = await import('../knowledge/effect-index.js')
    const { getSharedEffectIndex, invalidateSharedEffectIndex } =
      await import('../knowledge/shared-instances.js')

    // Gate the first build: the scan sees one effect, then the build stays
    // in flight until release().
    let scanned!: () => void
    const scanDone = new Promise<void>(resolve => { scanned = resolve })
    let release!: () => void
    const gate = new Promise<void>(resolve => { release = resolve })
    const realInit = EffectIndex.prototype.initialize
    vi.spyOn(EffectIndex.prototype, 'initialize').mockImplementationOnce(
      async function (this: InstanceType<typeof EffectIndex>, dir: string) {
        await realInit.call(this, dir)
        scanned()
        await gate
      },
    )

    const first = getSharedEffectIndex()
    await scanDone

    writeEffect('filter/blur')
    invalidateSharedEffectIndex()
    const second = getSharedEffectIndex()
    release()

    const [built, rebuilt] = await Promise.all([first, second])
    // The lookup after invalidation saw the new effect...
    expect(rebuilt.list()).toHaveLength(2)
    // ...and the stale build did not repopulate the cache.
    expect(await getSharedEffectIndex()).toBe(rebuilt)
    expect(await getSharedEffectIndex()).not.toBe(built)
  })

  it('does not cache a build that finishes after invalidation', async () => {
    const { EffectIndex } = await import('../knowledge/effect-index.js')
    const { getSharedEffectIndex, invalidateSharedEffectIndex } =
      await import('../knowledge/shared-instances.js')

    let scanned!: () => void
    const scanDone = new Promise<void>(resolve => { scanned = resolve })
    let release!: () => void
    const gate = new Promise<void>(resolve => { release = resolve })
    const realInit = EffectIndex.prototype.initialize
    vi.spyOn(EffectIndex.prototype, 'initialize').mockImplementationOnce(
      async function (this: InstanceType<typeof EffectIndex>, dir: string) {
        await realInit.call(this, dir)
        scanned()
        await gate
      },
    )

    const stale = getSharedEffectIndex()
    await scanDone

    writeEffect('filter/blur')
    invalidateSharedEffectIndex()
    release()

    // The stale build finishes here, before any lookup follows the
    // invalidation: it must publish nothing into the cache.
    const built = await stale
    expect(built.list()).toHaveLength(1)

    const fresh = await getSharedEffectIndex()
    expect(fresh.list()).toHaveLength(2)
    expect(fresh).not.toBe(built)
  })

  it('rebuilds immediately when invalidated', async () => {
    const { getSharedEffectIndex, invalidateSharedEffectIndex } =
      await import('../knowledge/shared-instances.js')

    expect((await getSharedEffectIndex()).list()).toHaveLength(1)

    writeEffect('filter/blur')
    invalidateSharedEffectIndex()

    expect((await getSharedEffectIndex()).list()).toHaveLength(2)
  })
})
