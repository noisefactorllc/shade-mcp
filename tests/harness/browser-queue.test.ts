import { describe, it, expect, beforeEach } from 'vitest'
import {
  acquireBrowserSlot,
  releaseBrowserSlot,
  resetBrowserQueue,
  setMaxBrowsers,
  getActiveBrowsers,
  getMaxBrowsers,
  getQueueDepth,
} from '../../src/harness/browser-queue.js'

describe('browser-queue', () => {
  beforeEach(() => {
    resetBrowserQueue()
  })

  it('allows one slot by default', async () => {
    await acquireBrowserSlot()
    expect(getActiveBrowsers()).toBe(1)
    releaseBrowserSlot()
    expect(getActiveBrowsers()).toBe(0)
  })

  it('queues when at capacity', async () => {
    await acquireBrowserSlot()
    expect(getQueueDepth()).toBe(0)

    // Second acquire should queue
    let secondResolved = false
    const second = acquireBrowserSlot().then(() => { secondResolved = true })

    // Let microtasks flush
    await Promise.resolve()
    expect(secondResolved).toBe(false)
    expect(getQueueDepth()).toBe(1)

    // Release first slot — should transfer to second waiter
    releaseBrowserSlot()
    await second
    expect(secondResolved).toBe(true)
    expect(getActiveBrowsers()).toBe(1)
    expect(getQueueDepth()).toBe(0)

    releaseBrowserSlot()
    expect(getActiveBrowsers()).toBe(0)
  })

  it('never exceeds maxConcurrency under concurrent load', async () => {
    setMaxBrowsers(1)
    let maxSeen = 0

    const work = async (id: number) => {
      await acquireBrowserSlot()
      const current = getActiveBrowsers()
      if (current > maxSeen) maxSeen = current
      // Simulate async work
      await new Promise(r => setTimeout(r, 5))
      releaseBrowserSlot()
    }

    await Promise.all([work(1), work(2), work(3), work(4)])
    expect(maxSeen).toBe(1)
    expect(getActiveBrowsers()).toBe(0)
  })

  it('respects setMaxBrowsers > 1', async () => {
    setMaxBrowsers(2)
    let maxSeen = 0

    const work = async () => {
      await acquireBrowserSlot()
      const current = getActiveBrowsers()
      if (current > maxSeen) maxSeen = current
      await new Promise(r => setTimeout(r, 10))
      releaseBrowserSlot()
    }

    await Promise.all([work(), work(), work(), work()])
    expect(maxSeen).toBe(2)
    expect(getActiveBrowsers()).toBe(0)
  })

  it('processes waiters in FIFO order', async () => {
    setMaxBrowsers(1)
    const order: number[] = []

    await acquireBrowserSlot()

    const p1 = acquireBrowserSlot().then(() => { order.push(1); releaseBrowserSlot() })
    const p2 = acquireBrowserSlot().then(() => { order.push(2); releaseBrowserSlot() })
    const p3 = acquireBrowserSlot().then(() => { order.push(3); releaseBrowserSlot() })

    releaseBrowserSlot()
    await Promise.all([p1, p2, p3])

    expect(order).toEqual([1, 2, 3])
  })

  it('active never goes negative', () => {
    releaseBrowserSlot()
    releaseBrowserSlot()
    expect(getActiveBrowsers()).toBe(0)
  })

  it('setMaxBrowsers floors at 1', () => {
    setMaxBrowsers(0)
    expect(getMaxBrowsers()).toBe(1)
    setMaxBrowsers(-5)
    expect(getMaxBrowsers()).toBe(1)
  })

  it('setMaxBrowsers falls back to 1 for a non-numeric limit', () => {
    setMaxBrowsers(NaN)
    expect(getMaxBrowsers()).toBe(1)
  })

  it('still admits sessions after a non-numeric limit is set', async () => {
    setMaxBrowsers(NaN)
    await acquireBrowserSlot()
    expect(getActiveBrowsers()).toBe(1)
    releaseBrowserSlot()
  })

  it('resetBrowserQueue resolves waiters instead of stranding them', async () => {
    setMaxBrowsers(1)
    await acquireBrowserSlot()
    let admitted = false
    const waiter = acquireBrowserSlot().then(() => { admitted = true })
    await Promise.resolve()
    expect(admitted).toBe(false)

    resetBrowserQueue()
    await waiter
    expect(admitted).toBe(true)
  })

  it('a fractional browser limit admits only its whole-number capacity', async () => {
    setMaxBrowsers(2.9)
    expect(getMaxBrowsers()).toBe(2)
    await acquireBrowserSlot()
    await acquireBrowserSlot()
    let admitted = false
    const pending = acquireBrowserSlot().then(() => { admitted = true })
    await Promise.resolve()
    expect(admitted).toBe(false)
    expect(getQueueDepth()).toBe(1)
    releaseBrowserSlot()
    await pending
    expect(getActiveBrowsers()).toBe(2)
    releaseBrowserSlot()
    releaseBrowserSlot()
    expect(getActiveBrowsers()).toBe(0)
  })

  it('reset clears active slots and custom capacity before the next session', async () => {
    setMaxBrowsers(3)
    await acquireBrowserSlot()
    await acquireBrowserSlot()
    resetBrowserQueue()
    expect(getActiveBrowsers()).toBe(0)
    expect(getQueueDepth()).toBe(0)
    expect(getMaxBrowsers()).toBe(1)
    await acquireBrowserSlot()
    expect(getActiveBrowsers()).toBe(1)
    releaseBrowserSlot()
  })
})
