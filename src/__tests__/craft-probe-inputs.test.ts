import { describe, expect, it } from 'vitest'

const api = await import(new URL('../../scripts/craft-probe-inputs.mjs', import.meta.url).href)
const types = {
  float: { n: 1, base: 'float', wgsl: 'f32' },
  uint: { n: 1, base: 'uint', wgsl: 'u32' },
  int: { n: 1, base: 'int', wgsl: 'i32' },
  vec3: { n: 3, base: 'float', wgsl: 'vec3f' },
  mat3: { n: 9, base: 'float', wgsl: 'mat3x3f' },
}
const defaults = { float: { float: [-4, 4, [0, -0, 1, -1]] }, uint: { uint: [0, 0xffffffff] } }
const make = (unitEdges = [1]) => new api.ProbeInputs({ width: 64, height: 64, types, defaults, unitEdges })
const float = (word: number) => new Float32Array(new Uint32Array([word]).buffer)[0]

describe('canonical library probe inputs', () => {
  it('preserves every argument word through finite texture lanes, including integer and nonfinite bit patterns', () => {
    const columns = [new Uint32Array([0x80000000, 0x7fc01234, 0xffffffff]), new Uint32Array([0, 0x7f800000, 0x00800001])]
    const packed = api.packArgumentWords(columns, 3, 2)
    expect(packed.words).toEqual(new Uint32Array([0x80000000, 0, 0x7fc01234, 0x7f800000, 0xffffffff, 0x00800001]))
    expect(packed.height).toBe(2)
    expect(packed.data).toHaveLength(16)
    for (const lane of packed.data) {
      expect(Number.isInteger(lane)).toBe(true)
      expect(lane).toBeGreaterThanOrEqual(0)
      expect(lane).toBeLessThanOrEqual(65535)
    }
    const decoded = packed.words.map((_: number, index: number) => packed.data[index * 2] + 65536 * packed.data[index * 2 + 1])
    expect(decoded).toEqual(packed.words)
  })

  it('normalizes the original ray corpus once while retaining all requested samples and zero-vector cases', () => {
    const edges = [0, -0, 1, -1, 0.5, -0.5, 1e-7, -1e-7, 0.999999, -0.999999, 0.707107, -0.707107]
    const inputs = make(edges)
    inputs.value('vec3', defaults.float)
    inputs.value('vec3', { unit: 3 })
    inputs.value('vec3', { unit: 3 })
    inputs.value('float', defaults.float)
    const packed = inputs.pack(4096)
    expect(packed.words).toHaveLength(40960)
    expect(inputs.invalidSamples.map((entry: { sample: number }) => entry.sample).sort((a: number, b: number) => a - b))
      .toEqual([434, 2058, 2339, 2353, 2365])
    for (let sample = 0; sample < 4096; sample++) {
      for (const offset of [3, 6]) {
        const vector = [0, 1, 2].map(k => float(packed.words[sample * 10 + offset + k]))
        if (inputs.invalidSamples.some((entry: { sample: number; column: number }) => entry.sample === sample && entry.column === offset)) {
          expect(vector.every(Number.isNaN)).toBe(true)
        } else {
          expect(Math.abs(Math.hypot(...vector) - 1)).toBeLessThan(1e-7)
        }
      }
    }
  })

  it('rejects a truncated or corrupted argument readback instead of treating backend agreement as proof', () => {
    const expected = new Uint32Array([0, 0x80000000, 0xffffffff, 0x7fc01234])
    expect(() => api.assertArgumentWords(expected, expected.slice(), 'webgl2')).not.toThrow()
    expect(() => api.assertArgumentWords(expected, expected.slice(0, 3), 'webgpu')).toThrow(/length/)
    const corrupted = expected.slice(); corrupted[2] ^= 1
    expect(() => api.assertArgumentWords(expected, corrupted, 'webgpu')).toThrow(/webgpu.*word 2/)
  })

  it('retains signed boundaries and unsigned high bits in the deterministic integer corpus', () => {
    const signed = make()
    signed.value('int', { int: [-7, 7, [-2147483648, -1, 0, 2147483647]] })
    expect(Array.from(new Int32Array(signed.pack(12).words.buffer)))
      .toEqual([-1, -5, 3, -6, -2147483648, -1, 0, 2147483647, -5, -6, 6, -1])
    const unsigned = make()
    unsigned.value('uint', { uint: [0, 0x7fffffff, 0x80000000, 0xffffffff] })
    expect(Array.from(unsigned.pack(8).words))
      .toEqual([0x19b9bf67, 0xdd6482b6, 0x6e49fa5c, 0x2cfe0ac0, 0, 0x7fffffff, 0x80000000, 0xffffffff])
  })

  it('keeps matrix components in constructor order through a partial texture row', () => {
    const inputs = make()
    inputs.value('mat3', { float: [-4, 4, []] })
    const packed = inputs.pack(1)
    expect(Array.from(packed.words)).toEqual([
      0x3e2a2f40, 0x402c9b64, 0xbf5957b8, 0x3c7ab000, 0xbf3a3b38,
      0xbf917c98, 0xc0051faa, 0xbfb07944, 0xc06f29a8,
    ])
    expect(inputs.typedWords(1)).toEqual(packed.words)
    expect(packed.data.slice(18).every((lane: number) => lane === 0)).toBe(true)
  })

  it('preserves derivative quads across physical rows without a texture lookup', () => {
    const inputs = make()
    inputs.value('float', { quad: true })
    expect(inputs.pack(4096).height).toBe(0)
    const values = Array.from(inputs.typedWords(4096), float)
    expect([0, 1, 64, 65, 62, 63, 126, 127, 128, 129, 192, 193].map(pixel => values[pixel]))
      .toEqual([-0.935546875, -1.181640625, -0.916015625, -1.162109375,
        -1.365234375, -1.349609375, -1.228515625, -1.212890625,
        -1.578125, -1.59765625, -1.38671875, -1.40625])
    for (let y = 0; y < 64; y += 2) {
      for (let x = 0; x < 64; x += 2) {
        const at = y * 64 + x
        expect(values[at + 1] - values[at]).toBe(values[at + 65] - values[at + 64])
        expect(values[at + 64] - values[at]).toBe(values[at + 65] - values[at + 1])
      }
    }
  })
})
