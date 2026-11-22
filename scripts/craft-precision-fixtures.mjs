// Independent integer oracle: represent finite binary32 values in units of the
// smallest subnormal, then round the exact sum once to nearest, ties to even.
export const ADD_CASES = [
  [0x3f800000, 0xbf7fffff, 0x33800000],
  [0x7f7fffff, 0x73000000, 0x7f800000],
  [0x7f7fffff, 0x72ffffff, 0x7f7fffff],
  [0xbf800000, 0xb3800000, 0xbf800000],
  [0xbf800001, 0xb3800000, 0xbf800002],
  [0x7f800000, 0x7f800000, 0x7f800000],
  [0xff800000, 0xff800000, 0xff800000],
  [0x3f800000, 0x7f800000, 0x7f800000],
  [0x3f800000, 0x33800000, 0x3f800000],
  [0x3f800001, 0x33800000, 0x3f800002],
  [0x3fffffff, 0x33800000, 0x40000000],
  [0x3f800000, 0xbf800000, 0x00000000],
  [0x3f800001, 0xbf800000, 0x34000000],
  [0xbf800001, 0x3f800000, 0xb4000000],
  [0x00800000, 0x807fffff, 0x00000001],
  [0x007fffff, 0x00000001, 0x00800000],
  [0x80000000, 0x80000000, 0x80000000],
  [0x80000000, 0x00000000, 0x00000000],
  [0x7f7fffff, 0x7f7fffff, 0x7f800000],
  [0xff7fffff, 0xff7fffff, 0xff800000],
  [0x7f800000, 0xff800000, 0x7fc00000],
  [0x7fc01234, 0x3f800000, 0x7fc00000],
  [0x3f800000, 0x00000001, 0x3f800000],
  [0xbf800000, 0x00000001, 0xbf800000],
]

export function addWordOracle(a, b) {
  const aa = a & 0x7fffffff, bb = b & 0x7fffffff
  if (aa > 0x7f800000 || bb > 0x7f800000) return 0x7fc00000
  if (aa === 0x7f800000 && bb === aa && (a >>> 31) !== (b >>> 31)) return 0x7fc00000
  if (aa === 0x7f800000) return a >>> 0
  if (bb === 0x7f800000) return b >>> 0
  const exact = word => {
    const exponent = (word >>> 23) & 255
    const mantissa = BigInt((word & 0x7fffff) | (exponent ? 0x800000 : 0))
    const magnitude = mantissa << BigInt(Math.max(exponent - 1, 0))
    return word >>> 31 ? -magnitude : magnitude
  }
  const value = exact(a) + exact(b)
  if (!value) return a === 0x80000000 && b === a ? a : 0
  const sign = value < 0 ? 0x80000000 : 0
  const magnitude = value < 0 ? -value : value
  if (magnitude < 0x800000n) return (sign | Number(magnitude)) >>> 0
  let shift = Math.max(magnitude.toString(2).length - 24, 0)
  let mantissa = magnitude >> BigInt(shift)
  if (shift) {
    const remainder = magnitude - (mantissa << BigInt(shift))
    const half = 1n << BigInt(shift - 1)
    if (remainder > half || (remainder === half && (mantissa & 1n))) mantissa++
  }
  if (mantissa === 0x1000000n) { mantissa >>= 1n; shift++ }
  return (sign | (shift >= 254 ? 0x7f800000 : ((shift + 1) << 23) | (Number(mantissa) & 0x7fffff))) >>> 0
}

export function precisionCases() {
  const rows = ADD_CASES.flatMap(([a, b, result]) => [[a, b, result], [b, a, result]])
  let state = 0x5eeda11
  const next = () => { state ^= state << 13; state ^= state >>> 17; state ^= state << 5; return state >>> 0 }
  for (let i = 0; i < 16384; i++) {
    const a = next(), b = next()
    rows.push([a, b, addWordOracle(a, b)])
    // Cancellation and opposite-sign adjacent mantissas need more density
    // than uniformly distributed exponent/sign fields provide.
    const c = ((a ^ 0x80000000) + (i % 3 - 1)) >>> 0
    rows.push([a, c, addWordOracle(a, c)])
  }
  return rows
}

// Binary32 products have at most 48 significant bits, so binary64 evaluates
// these finite products exactly before the single binary32 rounding.
export function productCases() {
  const bits = new Uint32Array(1), values = new Float32Array(bits.buffer)
  const square = word => { bits[0] = word; values[0] = values[0] * values[0]; return bits[0] }
  let state = 0x50a7cafe
  const next = () => { state ^= state << 13; state ^= state >>> 17; state ^= state << 5; return state >>> 0 }
  const rows = [[0, 0], [0x80000000, 0], [0x3f800000, 0x3f800000], [0x3f800001, 0x3f7fffff]]
  for (let i = 0; i < 8192; i++) {
    const a = next(), b = next()
    // Finite normal operands and products cover the signed shader domain
    // without making a claim about optional subnormal arithmetic support.
    rows.push([((a & 0x807fffff) | ((117 + a % 21) << 23)) >>> 0,
      ((b & 0x807fffff) | ((117 + b % 21) << 23)) >>> 0])
  }
  return rows.map(([a, b]) => [a, b, addWordOracle(square(a), square(b))])
}
