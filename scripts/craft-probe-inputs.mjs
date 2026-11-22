const f32 = Math.fround
const floatCell = new Float32Array(1)
const wordCell = new Uint32Array(floatCell.buffer)
const bits = value => { floatCell[0] = value; return wordCell[0] }

function hash(sample, salt) {
  let x = Math.imul(sample, 0x9e3779b9) ^ (Math.imul(salt, 0x85ebca6b) + 0x632be5ab)
  x ^= x >>> 16; x = Math.imul(x, 0x7feb352d)
  x ^= x >>> 15; x = Math.imul(x, 0x846ca68b)
  return (x ^ (x >>> 16)) >>> 0
}

export function packArgumentWords(columns, samples, width) {
  const words = new Uint32Array(samples * columns.length)
  for (let sample = 0; sample < samples; sample++) {
    for (let column = 0; column < columns.length; column++) {
      if (sample >= columns[column].length) throw new Error('Argument sample exceeds its column length')
      words[sample * columns.length + column] = columns[column][sample]
    }
  }
  const height = Math.ceil(words.length / (width * 2))
  const data = new Float32Array(width * height * 4)
  for (let i = 0; i < words.length; i++) {
    data[i * 2] = words[i] & 0xffff
    data[i * 2 + 1] = words[i] >>> 16
  }
  return { words, data, width, height }
}

export function assertArgumentWords(expected, actual, backend) {
  if (actual.length !== expected.length) throw new Error(`${backend} argument readback length ${actual.length}, expected ${expected.length}`)
  for (let i = 0; i < expected.length; i++) {
    if (actual[i] !== expected[i]) throw new Error(`${backend} argument word ${i}: ${actual[i].toString(16)}, expected ${expected[i].toString(16)}`)
  }
}

// Compute argument values once. Texture lanes carry integer halves of their words,
// so uploading a NaN, signed zero or integer cannot change its representation.
export class ProbeInputs {
  constructor({ width, height, types, defaults, unitEdges }) {
    this.width = width
    this.samples = width * height
    this.types = types
    this.defaults = defaults
    this.unitEdges = unitEdges
    this.salt = 0
    this.columns = []
    this.typedColumns = []
    this.invalidSamples = []
    this.usesQuad = false
  }

  nextSalt() { return this.salt++ }

  floats([lo, hi, edges]) {
    const salt = this.nextSalt()
    lo = f32(lo); hi = f32(hi)
    return Array.from({ length: this.samples }, (_, sample) => {
      const h = hash(sample, salt)
      if (edges.length && (h & 1) === 0) return f32(edges[(h >>> 1) % edges.length])
      return f32(lo + f32(f32(hi - lo) * ((h >>> 8) / 16777216)))
    })
  }

  integers([lo, hi, edges]) {
    const salt = this.nextSalt()
    return Array.from({ length: this.samples }, (_, sample) => {
      const h = hash(sample, salt)
      return (h & 1) === 0 ? edges[(h >>> 1) % edges.length] : lo + (h >>> 8) % (hi - lo + 1)
    })
  }

  unsigned(edges) {
    const salt = this.nextSalt()
    return Array.from({ length: this.samples }, (_, sample) => {
      const h = hash(sample, salt)
      return (h & 1) === 0 ? edges[(h >>> 1) % edges.length] >>> 0 : hash(h, salt + 1)
    })
  }

  value(type, spec) {
    const info = this.types[type]
    if (!info) throw new Error(`No input generator for type ${type}`)
    if (spec.quad) {
      if (info.n !== 1) throw new Error('Quad-linear inputs are scalar')
      this.usesQuad = true
      const salt = this.nextSalt()
      this.typedColumns.push(Uint32Array.from({ length: this.samples }, (_, pixel) => {
        const x = pixel % this.width, y = Math.floor(pixel / this.width)
        const quad = Math.floor(y / 2) * (this.width / 2) + Math.floor(x / 2)
        const a = (hash(quad, salt) % 2049 - 1024) / 512
        const b = (hash(quad, salt + 1) % 129 - 64) / 256
        const c = (hash(quad, salt + 2) % 129 - 64) / 256
        return bits(a + b * (x & 1) + c * (y & 1))
      }))
      return { glsl: `probeQuadLinear(${salt}u)`, wgsl: `probeQuadLinear(${salt}u)` }
    }
    let values
    if (spec.unit) {
      values = Array.from({ length: info.n }, () => this.floats([-1, 1, spec.edges ?? this.unitEdges]))
      for (let sample = 0; sample < this.samples; sample++) {
        const length = Math.hypot(...values.map(column => column[sample]))
        if (length === 0) this.invalidSamples.push({ sample, column: this.columns.length, reason: 'zero-length unit input' })
        for (const column of values) column[sample] = f32(column[sample] / length)
      }
    } else if (spec.sincos) {
      const angle = this.floats([spec.sincos[0], spec.sincos[1], [0, Math.PI / 2, Math.PI, 0.001]])
      values = [angle.map(value => f32(Math.sin(value))), angle.map(value => f32(Math.cos(value)))]
    } else if (spec.cell) {
      values = Array.from({ length: info.n }, () => this.floats(spec.cell).map(Math.floor))
    } else if (info.base === 'float') {
      values = Array.from({ length: info.n }, () => this.floats(spec.float ?? this.defaults.float.float))
    } else if (info.base === 'int') {
      values = Array.from({ length: info.n }, () => this.integers(spec.int ?? this.defaults.int.int))
    } else {
      values = Array.from({ length: info.n }, () => this.unsigned(spec.uint ?? this.defaults.uint.uint))
    }
    const offset = this.columns.length
    const columns = values.map(column => Uint32Array.from(column, value => info.base === 'float' ? bits(value) : value >>> 0))
    this.columns.push(...columns)
    this.typedColumns.push(...columns)
    const result = {}
    for (const language of ['glsl', 'wgsl']) {
      const parts = values.map((_, k) => {
        const word = `probeInputWord(s, ${offset + k}u)`
        if (info.base === 'uint') return word
        if (language === 'glsl') return info.base === 'float' ? `uintBitsToFloat(${word})` : `int(${word})`
        return `bitcast<${info.base === 'float' ? 'f32' : 'i32'}>(${word})`
      })
      result[language] = info.n === 1 ? parts[0] : `${language === 'glsl' ? type : info.wgsl}(${parts.join(', ')})`
    }
    return result
  }

  pack(samples) { return packArgumentWords(this.columns, samples, this.width) }

  typedWords(samples) { return packArgumentWords(this.typedColumns, samples, this.width).words }

  helpers(language) {
    const glsl = language === 'glsl'
    const out = []
    if (this.columns.length) out.push(glsl ? `uniform highp sampler2D probeInputData;
uint probeInputWord(uint s, uint c) {
    uint index = s * ${this.columns.length}u + c;
    uint texel = index / 2u;
    vec4 lanes = texelFetch(probeInputData, ivec2(int(texel % ${this.width}u), int(texel / ${this.width}u)), 0);
    int lane = int(index % 2u) * 2;
    return uint(lanes[lane]) | (uint(lanes[lane + 1]) << 16u);
}` : `@group(0) @binding(1) var probeInputData: texture_2d<f32>;
fn probeInputWord(s: u32, c: u32) -> u32 {
    let index = s * ${this.columns.length}u + c;
    let texel = index / 2u;
    let lanes = textureLoad(probeInputData, vec2i(i32(texel % ${this.width}u), i32(texel / ${this.width}u)), 0);
    let lane = i32(index % 2u) * 2;
    return u32(lanes[lane]) | (u32(lanes[lane + 1]) << 16u);
}`)
    if (this.usesQuad) out.push(glsl ? `uint probeHash(uint s, uint salt) {
    uint x = (s * 0x9E3779B9u) ^ (salt * 0x85EBCA6Bu + 0x632BE5ABu);
    x ^= x >> 16u; x *= 0x7FEB352Du; x ^= x >> 15u; x *= 0x846CA68Bu; x ^= x >> 16u;
    return x;
}
float probeQuadLinear(uint salt) {
    uint quad = uint((probePixel.y / 2) * ${this.width / 2} + probePixel.x / 2);
    float a = float(int(probeHash(quad, salt) % 2049u) - 1024) / 512.0;
    float b = float(int(probeHash(quad, salt + 1u) % 129u) - 64) / 256.0;
    float c = float(int(probeHash(quad, salt + 2u) % 129u) - 64) / 256.0;
    return a + b * float(probePixel.x & 1) + c * float(probePixel.y & 1);
}` : `fn probeHash(s: u32, salt: u32) -> u32 {
    var x = (s * 0x9E3779B9u) ^ ((salt * 0x85EBCA6Bu) + 0x632BE5ABu);
    x ^= x >> 16u; x *= 0x7FEB352Du; x ^= x >> 15u; x *= 0x846CA68Bu; x ^= x >> 16u;
    return x;
}
fn probeQuadLinear(salt: u32) -> f32 {
    let quad = u32((probePixel.y / 2) * ${this.width / 2} + probePixel.x / 2);
    let a = f32(i32(probeHash(quad, salt) % 2049u) - 1024) / 512.0;
    let b = f32(i32(probeHash(quad, salt + 1u) % 129u) - 64) / 256.0;
    let c = f32(i32(probeHash(quad, salt + 2u) % 129u) - 64) / 256.0;
    return a + b * f32(probePixel.x & 1) + c * f32(probePixel.y & 1);
}`)
    return out.join('\n\n')
  }
}
