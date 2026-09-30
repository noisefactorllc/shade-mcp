import { describe, expect, it } from 'vitest'
import { runDslProgram } from '../tools/browser/dsl.js'
import type { BrowserSession } from '../harness/browser-session.js'

describe('runDslProgram batch inputs', () => {
  const session = {
    backend: 'webgl2',
    runWithConsoleCapture: () => { throw new Error('renderer opened') },
  } as unknown as BrowserSession

  it('rejects unsorted capture frames before opening the renderer', async () => {
    await expect(runDslProgram(session, 'noise().write(o0)', { frames: [120, 1] }))
      .rejects.toThrow('Capture frames must be strictly increasing')
  })

  it('bounds the contact-sheet allocation before opening the renderer', async () => {
    await expect(runDslProgram(session, 'noise().write(o0)', {
      frames: [1, 2, 3], cellResolution: [1920, 1080],
    })).rejects.toThrow('Contact sheet exceeds the 4 million pixel limit')
  })
})
