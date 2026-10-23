import { describe, it, expect } from 'vitest'
import { SEARCHABLE_KNOWLEDGE } from '../knowledge/shader-knowledge.js'
import { GLSL_RECIPES } from '../knowledge/glsl-reference.js'

const TAU = Math.PI * 2
// The time-circle the advice teaches, evaluated where a loop wraps.
const timeCircle = (time: number, radius: number) => [Math.cos(time * TAU) * radius, Math.sin(time * TAU) * radius]

describe('seamless loop advice', () => {
  it('closes the circle at the seam for a non-integer radius', () => {
    for (const radius of [0.37, 1.7, 2.5]) {
      const [x0, y0] = timeCircle(0, radius)
      const [x1, y1] = timeCircle(1, radius)
      expect(x1).toBeCloseTo(x0, 12)
      expect(y1).toBeCloseTo(y0, 12)
    }
  })

  it('a radius inside the angle would open the seam', () => {
    const radius = 1.7
    const wrong = (time: number) => [Math.cos(time * TAU * radius), Math.sin(time * TAU * radius)]
    expect(Math.hypot(wrong(1)[0] - wrong(0)[0], wrong(1)[1] - wrong(0)[1])).toBeGreaterThan(0.1)
  })

  it('every retrieved passage teaches the radius outside the angle', () => {
    const texts = SEARCHABLE_KNOWLEDGE.map(d => d.content).concat(GLSL_RECIPES)
    for (const text of texts) {
      expect(text).not.toMatch(/time\s*\*\s*TAU\s*\*\s*radius/)
      expect(text).not.toMatch(/time\s*\*\s*TAU\s*\*\s*speed\b/)
    }
    const seamless = SEARCHABLE_KNOWLEDGE.find(d => d.title === 'Seamless Animation Patterns')!
    expect(seamless.content).toContain('vec2(cos(time*TAU), sin(time*TAU)) * radius')
    expect(seamless.content).toMatch(/integer cycle count/)
  })
})
