import { EffectIndex } from './effect-index.js'
import { getConfig } from '../config.js'

/**
 * How long a built index is trusted.
 *
 * Effects are edited while the server runs — an agent that writes a new effect
 * and then searches for it has to find it — so the index is rebuilt on a short
 * interval instead of being cached for the life of the process.
 */
const INDEX_TTL_MS = 5000

let effectIndex: EffectIndex | null = null
let builtAt = 0
let building: Promise<EffectIndex> | null = null
// Incremented on every invalidation. A build that scanned the directory
// before an invalidation must not publish its stale result into the cache
// when it finishes.
let epoch = 0
let buildEpoch = 0

export async function getSharedEffectIndex(): Promise<EffectIndex> {
  if (effectIndex && Date.now() - builtAt < INDEX_TTL_MS) return effectIndex
  // Concurrent callers share one build rather than each scanning the
  // directory, but only a build from the current epoch: invalidation
  // supersedes anything still in flight.
  if (building && buildEpoch === epoch) return building

  const current = epoch
  building = (async () => {
    const index = new EffectIndex()
    await index.initialize(getConfig().effectsDir)
    // Publish only while this build's epoch is still current: if
    // invalidation happened while scanning — even before any newer build
    // started — this index is already stale and must not enter the cache.
    if (epoch === current) {
      effectIndex = index
      builtAt = Date.now()
    }
    return index
  })()
  // Set after the promise is created but before it can be awaited: the body
  // suspends at its first await, so the publish check above can only run
  // once buildEpoch is in place.
  buildEpoch = current
  const promise = building

  try {
    return await promise
  } finally {
    if (building === promise) building = null
  }
}

/** Forces the next lookup to rescan, for callers that just changed the library. */
export function invalidateSharedEffectIndex(): void {
  effectIndex = null
  builtAt = 0
  epoch++
}
