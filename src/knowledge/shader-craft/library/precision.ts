import type { ShaderCraftLibrarySymbol } from './types.js'

// Implementation dependencies use integer rounding so a compiler cannot fuse
// a caller's products into the addition. Finite results round to nearest even.
export const PRECISION_GLSL = `uint nmCraftAddWords(uint a, uint b) {
    uint aa = a & 0x7fffffffu;
    uint bb = b & 0x7fffffffu;
    if (aa > 0x7f800000u || bb > 0x7f800000u) return 0x7fc00000u;
    if (aa == 0x7f800000u && bb == aa && ((a ^ b) >> 31u) != 0u) return 0x7fc00000u;
    if (aa == 0x7f800000u) return a;
    if (bb == 0x7f800000u) return b;
    if (aa < bb) { uint t = a; a = b; b = t; t = aa; aa = bb; bb = t; }
    uint signBit = a & 0x80000000u;
    uint ea = aa >> 23u;
    uint eb = bb >> 23u;
    uint ma = ((aa & 0x7fffffu) | (ea == 0u ? 0u : 0x800000u)) << 3u;
    uint mb = ((bb & 0x7fffffu) | (eb == 0u ? 0u : 0x800000u)) << 3u;
    ea = max(ea, 1u); eb = max(eb, 1u);
    uint shift = ea - eb;
    if (shift >= 32u) mb = mb == 0u ? 0u : 1u;
    else if (shift > 0u) mb = (mb >> shift) | ((mb & ((1u << shift) - 1u)) == 0u ? 0u : 1u);
    bool subtract = ((a ^ b) >> 31u) != 0u;
    uint sum = subtract ? ma - mb : ma + mb;
    if (sum == 0u) return subtract ? 0u : signBit;
    if ((sum & 0x8000000u) != 0u) { sum = (sum >> 1u) | (sum & 1u); ea++; }
    uint norm = sum; uint leading = 0u;
    if (norm < 0x800u) { norm <<= 16u; leading += 16u; }
    if (norm < 0x80000u) { norm <<= 8u; leading += 8u; }
    if (norm < 0x800000u) { norm <<= 4u; leading += 4u; }
    if (norm < 0x2000000u) { norm <<= 2u; leading += 2u; }
    if (norm < 0x4000000u) leading++;
    uint normalizeShift = min(leading, ea - 1u);
    sum <<= normalizeShift; ea -= normalizeShift;
    uint mantissa = sum >> 3u;
    uint remainder = sum & 7u;
    if (remainder > 4u || (remainder == 4u && (mantissa & 1u) != 0u)) mantissa++;
    if ((mantissa & 0x1000000u) != 0u) { mantissa >>= 1u; ea++; }
    if (ea >= 255u) return signBit | 0x7f800000u;
    if (ea == 1u && mantissa < 0x800000u) ea = 0u;
    return signBit | (ea << 23u) | (mantissa & 0x7fffffu);
}

float nmCraftAdd(float a, float b) {
    return uintBitsToFloat(nmCraftAddWords(floatBitsToUint(a), floatBitsToUint(b)));
}`

export const PRECISION_WGSL = `fn nmCraftAddWords(a: u32, b: u32) -> u32 {
    var a_ = a; var b_ = b;
    var aa = a_ & 0x7fffffffu;
    var bb = b_ & 0x7fffffffu;
    if (aa > 0x7f800000u || bb > 0x7f800000u) { return 0x7fc00000u; }
    if (aa == 0x7f800000u && bb == aa && ((a_ ^ b_) >> 31u) != 0u) { return 0x7fc00000u; }
    if (aa == 0x7f800000u) { return a_; }
    if (bb == 0x7f800000u) { return b_; }
    if (aa < bb) { let t = a_; a_ = b_; b_ = t; let m = aa; aa = bb; bb = m; }
    let signBit = a_ & 0x80000000u;
    var ea = aa >> 23u;
    var eb = bb >> 23u;
    let ma = ((aa & 0x7fffffu) | select(0x800000u, 0u, ea == 0u)) << 3u;
    var mb = ((bb & 0x7fffffu) | select(0x800000u, 0u, eb == 0u)) << 3u;
    ea = max(ea, 1u); eb = max(eb, 1u);
    let shift = ea - eb;
    if (shift >= 32u) { mb = select(1u, 0u, mb == 0u); }
    else if (shift > 0u) { mb = (mb >> shift) | select(1u, 0u, (mb & ((1u << shift) - 1u)) == 0u); }
    let subtract = ((a_ ^ b_) >> 31u) != 0u;
    var sum = select(ma + mb, ma - mb, subtract);
    if (sum == 0u) { return select(signBit, 0u, subtract); }
    if ((sum & 0x8000000u) != 0u) { sum = (sum >> 1u) | (sum & 1u); ea += 1u; }
    let normalizeShift = min(countLeadingZeros(sum) - 5u, ea - 1u);
    sum <<= normalizeShift; ea -= normalizeShift;
    var mantissa = sum >> 3u;
    let remainder = sum & 7u;
    if (remainder > 4u || (remainder == 4u && (mantissa & 1u) != 0u)) { mantissa += 1u; }
    if ((mantissa & 0x1000000u) != 0u) { mantissa >>= 1u; ea += 1u; }
    if (ea >= 255u) { return signBit | 0x7f800000u; }
    if (ea == 1u && mantissa < 0x800000u) { ea = 0u; }
    return signBit | (ea << 23u) | (mantissa & 0x7fffffu);
}

fn nmCraftAdd(a: f32, b: f32) -> f32 {
    return bitcast<f32>(nmCraftAddWords(bitcast<u32>(a), bitcast<u32>(b)));
}`

export const PRECISION_SYMBOLS: ShaderCraftLibrarySymbol[] = [
  {
    id: 'nmCraftAddWords(uint,uint)', kind: 'function', module: 'common', internal: true,
    summary: 'Internal binary32 addition with explicit integer rounding.', credits: [],
    glsl: { name: 'nmCraftAddWords', signature: 'uint nmCraftAddWords(uint a, uint b)', dependencies: [], requires: [] },
    wgsl: { name: 'nmCraftAddWords', signature: 'fn nmCraftAddWords(a: u32, b: u32) -> u32', dependencies: [], requires: [] },
  },
  {
    id: 'nmCraftAdd(float,float)', kind: 'function', module: 'common', internal: true,
    summary: 'Internal floating-point addition with explicit rounding.', credits: [],
    glsl: { name: 'nmCraftAdd', signature: 'float nmCraftAdd(float a, float b)', dependencies: ['nmCraftAddWords(uint,uint)'], requires: [] },
    wgsl: { name: 'nmCraftAdd', signature: 'fn nmCraftAdd(a: f32, b: f32) -> f32', dependencies: ['nmCraftAddWords(uint,uint)'], requires: [] },
  },
]
