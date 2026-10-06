import { describe, it, expect } from 'vitest'
import { computeImageMetrics } from '../harness/pixel-reader.js'

describe('computeImageMetrics', () => {
  it('detects all-black image', () => {
    const data = new Uint8Array(4 * 100) // 10x10 black RGBA
    const metrics = computeImageMetrics(data, 10, 10)
    expect(metrics.is_all_zero).toBe(true)
    expect(metrics.is_essentially_blank).toBe(true)
    expect(metrics.mean_rgb).toEqual([0, 0, 0])
  })

  it('detects monochrome image', () => {
    const data = new Uint8Array(4 * 100)
    for (let i = 0; i < data.length; i += 4) {
      data[i] = 128; data[i+1] = 64; data[i+2] = 32; data[i+3] = 255
    }
    const metrics = computeImageMetrics(data, 10, 10)
    expect(metrics.is_monochrome).toBe(true)
    expect(metrics.unique_sampled_colors).toBe(1)
    expect(metrics.is_all_zero).toBe(false)
  })

  it('detects colorful image', () => {
    const data = new Uint8Array(4 * 100)
    for (let i = 0; i < data.length; i += 4) {
      data[i] = (i * 7) % 256
      data[i+1] = (i * 13) % 256
      data[i+2] = (i * 23) % 256
      data[i+3] = 255
    }
    const metrics = computeImageMetrics(data, 10, 10)
    expect(metrics.is_monochrome).toBe(false)
    expect(metrics.is_essentially_blank).toBe(false)
    expect(metrics.unique_sampled_colors).toBeGreaterThan(1)
  })

  it('detects transparent image', () => {
    const data = new Uint8Array(4 * 100) // all zeros including alpha
    const metrics = computeImageMetrics(data, 10, 10)
    expect(metrics.is_all_transparent).toBe(true)
    expect(metrics.mean_alpha).toBe(0)
  })

  it('handles Float32Array input', () => {
    const data = new Float32Array(4 * 4) // 2x2
    data[0] = 1.0; data[1] = 0.0; data[2] = 0.0; data[3] = 1.0 // red
    data[4] = 0.0; data[5] = 1.0; data[6] = 0.0; data[7] = 1.0 // green
    data[8] = 0.0; data[9] = 0.0; data[10] = 1.0; data[11] = 1.0 // blue
    data[12] = 1.0; data[13] = 1.0; data[14] = 1.0; data[15] = 1.0 // white
    const metrics = computeImageMetrics(data, 2, 2)
    expect(metrics.is_monochrome).toBe(false)
    expect(metrics.mean_alpha).toBe(1)
    expect(metrics.unique_sampled_colors).toBeGreaterThan(1)
  })

  it('calls a flat bright frame essentially blank (issue #29)', () => {
    const data = new Uint8Array(4 * 100)
    for (let i = 0; i < data.length; i += 4) {
      data[i] = 200; data[i+1] = 200; data[i+2] = 200; data[i+3] = 255
    }
    const metrics = computeImageMetrics(data, 10, 10)
    expect(metrics.is_essentially_blank).toBe(true)
    expect(metrics.is_all_zero).toBe(false)
  })
})
