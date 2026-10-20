import { readFile } from 'node:fs/promises'
import { describe, it, expect } from 'vitest'
const parityModule = new URL('../../scripts/craft-examples-parity.mjs', import.meta.url).href
const api = await import(parityModule)
describe('example-only parity verification', () => {
  it('keeps hardware qualification as the default and requires explicit software mode', () => {
    expect(api).toHaveProperty('parseExampleParityOptions')
    expect(api.parseExampleParityOptions(['--out', '/tmp/example-proof'], false)).toMatchObject({ software: false, out: '/tmp/example-proof' })
    expect(() => api.parseExampleParityOptions(['--out', '/tmp/example-proof'], true)).toThrow('explicit --software')
    expect(api.parseExampleParityOptions(['--software', '--out', '/tmp/example-proof'], true)).toMatchObject({ software: true })
    expect(() => api.parseExampleParityOptions(['--out', 'relative'], false)).toThrow('absolute')
  })
  it('fails drift beyond one attachment quantization level and reports every differing channel', () => {
    expect(api).toHaveProperty('compareExamplePixels')
    const reference = new Uint8Array(192 * 128 * 4).fill(128)
    const small = reference.slice(); small[0]++; small[1]--; small[2]++
    expect(api.compareExamplePixels(reference, small)).toMatchObject({ pass: true, maxByteDifference: 1, differingChannels: 3 })
    const broad = small.slice(); broad[3]++
    expect(api.compareExamplePixels(reference, broad)).toMatchObject({ pass: true, differingChannels: 4 })
    const large = reference.slice(); large[0] += 2
    expect(api.compareExamplePixels(reference, large).pass).toBe(false)
    expect(() => api.compareExamplePixels(reference, new Uint8Array(4))).toThrow('dimensions')
  })
  it('runs the examples-only selector in the existing browser CI job', async () => {
    const workflow = await readFile(new URL('../../.github/workflows/quality.yml', import.meta.url), 'utf8')
    const step = workflow.indexOf('name: Shader-craft example parity')
    expect(step).toBeGreaterThan(workflow.indexOf('run: node scripts/craft-library-parity.mjs'))
    expect(workflow.slice(step)).toContain('node scripts/craft-examples-parity.mjs --software --out')
  })
})
