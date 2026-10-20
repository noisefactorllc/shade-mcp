// Render parity of the shader-craft library, GLSL against WGSL, through Noisemaker's own renderer.
//
// For every library function (and constant) this builds a probe effect: a definition plus a GLSL and a WGSL
// program that contain only the symbol's dependency closure from SHADER_CRAFT_LIBRARY, map each pixel to one
// output word of one sample of inputs, and write that 32-bit word into the pixel's four 8-bit channels. Inputs mix
// a spread of values with edge values (zeros of both signs, boundaries, tiny and large magnitudes) and are built
// from integer hashes and float bit patterns, so both languages see bit-identical arguments. The probes are
// registered as authored Portable effects (CanvasRenderer.registerPortableEffect, the runDslProgram path), compiled
// from a DSL program, rendered on WebGL2 and on WebGPU, and read back from the output surface.
//
// The default tolerance is zero: every word must hold the same value in both languages. Words that differ only in
// the sign of a zero or in the bits of a NaN count as equal, because neither language defines those bits. A function
// whose index entry records a parity tolerance may differ in its float words by at most that tolerance, measured as
// |a - b| / max(1, |a|, |b|): an absolute difference below 1 and a relative one above. Integer words must always
// match. Where a probe's inputs drove GLSL into undefined behaviour that renderers resolve differently (a NaN reaching
// min or max, a point exactly on a sector boundary), its overrides below avoid those inputs and say why. Any GLSL or
// WGSL compile failure fails the run, and so does the full library compiled as one program in each language.
//
// Add --bundled-only to run only calibration and the complete bundled programs (five representative pipelines and one caller-definition regression).
// Usage: NOISEMAKER=/path/to/noisemaker node scripts/craft-library-parity.mjs [--only id,id] [--json report.json]
// Set SHADE_SWIFTSHADER=1 on machines without a GPU. Build dist/ first (npm run build).
import { existsSync, writeFileSync, readFileSync } from 'node:fs'

const NM = process.env.NOISEMAKER
if (!NM || !existsSync(`${NM}/shaders/src/index.js`)) {
  console.error(`craft-library-parity: set NOISEMAKER to a noisemaker checkout (got ${NM || 'unset'})`)
  process.exit(2)
}
const args = process.argv.slice(2)
const option = name => {
  const i = args.indexOf(name)
  return i >= 0 ? args[i + 1] : undefined
}
// Ids contain commas, so split only on commas outside parentheses.
const only = option('--only')?.match(/(?:[^,(]|\([^)]*\))+/g)?.map(s => s.trim()).filter(Boolean)
const jsonPath = option('--json')
const bundledOnly = args.includes('--bundled-only')

const {
  SHADER_CRAFT_LIBRARY: LIBRARY,
  SHADER_CRAFT_LIBRARY_MODULES: MODULES,
  getShaderCraftSymbolSource: sourceOf,
  bundleShaderSource,
} = await import(new URL('../dist/knowledge/index.js', import.meta.url).href)
const { BrowserSession, getServerUrl } = await import(new URL('../dist/harness/index.js', import.meta.url).href)

const W = 64, H = 64, PIXELS = W * H
const BY_ID = new Map(LIBRARY.map(entry => [entry.id, entry]))
const ORDER = new Map(LIBRARY.map((entry, i) => [entry.id, i]))

// ---------------------------------------------------------------------------------------------- inputs
const f32 = new Float32Array(1)
const u32 = new Uint32Array(f32.buffer)
const bits = value => { f32[0] = value; return u32[0] }
const hex = n => `0x${(n >>> 0).toString(16)}u`
const fbits = value => ({ glsl: `uintBitsToFloat(${hex(bits(value))})`, wgsl: `bitcast<f32>(${hex(bits(value))})` })

// Edge values for floats; every generator mixes them half and half with uniform values from its range.
const EDGE = [0, -0, 1, -1, 0.5, -0.5, 2, -2, 0.25, 1e-7, -1e-7, 1e-30, 3, -3.7, 0.999999, 1.000001,
  Math.PI, 2 * Math.PI, 10, -10, 100, -100]
const UNIT_EDGE = [0, -0, 1, -1, 0.5, -0.5, 1e-7, -1e-7, 0.999999, -0.999999, 0.707107, -0.707107]
const POSITIVE_EDGE = [0, -0, 1e-30, 1e-7, 1e-4, 0.01, 0.5, 1, 2, 10, 100]
const CELL_EDGE = [0, -0, 0.5, -0.5, 0.999999, -0.999999, 1, -1, 2, -2, 255.5, 65536, -65536, 1048575, -1048576,
  16777216, -16777216]
// Generator specs: { float: [lo, hi, edges] } | { int: [lo, hi, edges] } | { uint: edges } | named shapes.
const F = (lo, hi, edges = EDGE) => ({ float: [lo, hi, edges] })
const I = (lo, hi, edges) => ({ int: [lo, hi, edges] })
const DEFAULT = {
  float: F(-4, 4), int: I(0, 12, [0, 1, 2, 3, 12]), uint: { uint: [0, 1, 0x7fffffff, 0x80000000, 0xffffffff] },
}
const OCTAVES = I(0, 12, [-1, 0, 1, 2, 5, 12, 13, 100])
const FRAME = I(0, 1000000, [0, 1, 63, 64, 65, 1023, 1024, 1025, 2147483647])
const PIXEL = { cell: [0, 4096, [0, 0.5, 1, 63, 64, 1919.5, 4095]] }
const CELL = { cell: [-100000, 100000, CELL_EDGE] }
const NONZERO_UNIT_EDGE = [1, -1, 0.5, -0.5, 1e-7, -1e-7, 0.999999, -0.999999, 0.707107, -0.707107]
const UNIT3 = { unit: 3 }
const SINCOS = { sincos: [0, Math.PI] }
const POS = (hi = 4) => F(0, hi, POSITIVE_EDGE)
const COUNT = F(1, 16, [1, 2, 3, 4, 5, 6, 7, 8, 12, 16])
// Uniform values only: edge values put points exactly on sector boundaries, a tie either sector id answers.
const NO_TIES = F(-4, 4, [])
// Exactly representable values that change linearly across each 2x2 pixel quad, so screen derivatives are exact and
// do not depend on which pixels of the quad a GPU differences (coarse or fine derivatives, flipped y).
const QUAD_LINEAR = { quad: true }

// Overrides by parameter name, for every function that has one; then by function id.
const BY_NAME = { octaves: OCTAVES, frame: FRAME, pixel: PIXEL, sc: SINCOS }
const OVERRIDES = {
  'hash11(float)': { p: CELL }, 'hash12(vec2)': { p: CELL }, 'hash13(vec3)': { p: CELL },
  'hash22(vec2)': { p: CELL }, 'hash33(vec3)': { p: CELL }, 'hash44(vec4)': { p: CELL }, 'hash32(vec2)': { p: CELL },
  'latticeGradient(vec2)': { cell: CELL }, 'latticeGradDot(vec3,vec3,vec3)': { cell: CELL, corner: F(0, 1, [0, 1]) },
  'quinticFade(vec2)': { f: F(-0.5, 1.5, UNIT_EDGE) }, 'quinticFade(vec3)': { f: F(-0.5, 1.5, UNIT_EDGE) },
  'quinticFadeDeriv(vec2)': { f: F(-0.5, 1.5, UNIT_EDGE) }, 'quinticFadeDeriv(vec3)': { f: F(-0.5, 1.5, UNIT_EDGE) },
  'fbm(vec2,int,float,float)': { p: F(-50, 50), lacunarity: F(1.5, 3, [1, 2, 2.01, 3]), persistence: F(0.2, 0.8, [0, 0.5, 1]) },
  'fbm(vec3,int,float,float)': { p: F(-50, 50), lacunarity: F(1.5, 3, [1, 2, 2.01, 3]), persistence: F(0.2, 0.8, [0, 0.5, 1]) },
  'warpedFbm(vec2,float,int,vec2,vec2)': { strength: POS(4), octaves: I(1, 6, [0, 1, 6]) },
  'voronoi(vec2,float)': { p: F(-50, 50), jitter: F(0, 1, [0, 1, 0.5]) },
  'voronoiBorder(vec2,float)': { p: F(-50, 50), jitter: F(0, 1, [0, 1, 0.5]) },
  'smoothVoronoi(vec2,float)': { p: F(-50, 50), k: F(1, 64, [1, 8, 32, 64]) },
  'hybridTerrainHeight(vec2,int)': { p: F(-50, 50) },
  'aaOffset(int)': { i: I(0, 100000, [0, 1, 2, 3, 15, 16, 255, 1000]) },
  'filteredChecker(vec2,vec2)': { p: F(-20, 20), w: POS(3) },
  'filteredGrid(vec2,vec2,float)': { p: F(-20, 20), w: POS(3), n: COUNT },
  'filteredStripes(float,float)': { x: F(-20, 20), w: POS(3) },
  'hexGrid(vec2)': { p: F(-20, 20) }, 'truchetArcs(vec2,float)': { p: F(-20, 20), w: POS(0.5) },
  'sdRegularPolygon(vec2,float,int)': { r: POS(2), n: I(3, 16, [1, 2, 3, 4, 5, 6, 8, 12]) },
  'sdStar(vec2,float,int,float)': { r: POS(2), n: I(3, 12, [2, 3, 5, 6, 12]), m: F(2, 12, [2, 3, 5, 12]) },
  'sdEgg(vec2,float,float)': { ra: POS(2), rb: POS(2) },
  'sdVesica(vec2,float,float)': { r: POS(2), d: POS(1) },
  'sdMoon(vec2,float,float,float)': { d: F(0.05, 2, [0.5, 1]), ra: POS(2), rb: POS(2) },
  'sdParabolaSegment(vec2,float,float)': { w: F(0.05, 3, [0.5, 1, 2]), h: F(0.05, 3, [0.5, 1, 2]) },
  'sdHorseshoe(vec2,vec2,float,float,float)': { r: POS(2), legLength: POS(2), w: POS(0.5) },
  'sdCutHollowSphere(vec3,float,float,float)': { r: F(0.5, 2, [1]), h: F(-0.5, 0.5, [0, 0.25]), t: POS(0.2) },
  'sdCutSphere(vec3,float,float)': { r: F(0.5, 2, [1]), h: F(-0.5, 0.5, [0, 0.25]) },
  'sdDeathStar(vec3,float,float,float)': { ra: F(0.5, 2, [1]), rb: F(0.2, 1.5, [0.5, 1]), d: F(0.2, 2, [0.5, 1]) },
  'sdGyroid(vec3,float,float)': { scale: F(0.5, 10, [1, 2]), t: POS(0.3) },
  // r = 0 makes the stair period 0, so mod divides by zero and min receives a NaN.
  'opStairsUnion(float,float,float,float)': { r: F(0.01, 1, [0.1, 0.5, 1]), n: COUNT },
  'domPolar(vec2,float)': { n: COUNT }, 'domPolarId(vec2,float)': { p: NO_TIES, n: COUNT },
  'domPolarPair(vec2,float)': { p: NO_TIES, n: COUNT },
  'domPolarSector(vec2,float,float)': { id: F(0, 16, [0, 1, 2, 15]), n: COUNT },
  'domFold(vec3,vec3)': { n: UNIT3 }, 'sdPlane(vec3,vec3,float)': { n: UNIT3 },
  'buildingProfile(vec2,vec2,vec2)': { parcel: CELL, heightRange: F(0, 100), halfWidthRange: F(0, 10) },
  'facadeWindowMask(vec2,vec2,vec2)': { uv: F(-20, 20), fill: F(-0.5, 1.5, UNIT_EDGE), footprint: POS(4) },
  'raymarch(vec3,vec3,float,float,float)': { rd: UNIT3, tmin: F(0, 0.1, [0]), tmax: F(1, 30, [1, 10]), stepScale: F(0.5, 1, [1]) },
  'calcNormal(vec3,float)': { p: F(-2.5, 2.5), eps: F(1e-4, 1e-2, [1e-4, 1e-3]) },
  'softShadow(vec3,vec3,float,float,float)': { rd: UNIT3, tmin: F(0.001, 0.1, [0.01]), tmax: F(1, 10, [5]), k: F(2, 32, [8, 32]) },
  'calcAO(vec3,vec3,float)': { p: F(-2.5, 2.5), n: UNIT3, scale: F(0.05, 0.5, [0.12]) },
  'sdfThickness(vec3,vec3,float)': { p: F(-2.5, 2.5), n: UNIT3, maxDepth: F(0.05, 2, [0.5]) },
  'iPlane(vec3,vec3,vec3,float)': { rd: UNIT3, n: UNIT3 }, 'iSphere(vec3,vec3,vec3,float)': { rd: UNIT3, r: POS(3) },
  // An rd component of exactly 0 makes the slab distances NaN, which GLSL min and max leave undefined.
  'iBox(vec3,vec3,vec3)': { rd: { unit: 3, edges: NONZERO_UNIT_EDGE }, b: POS(3) },
  'cameraMatrix(vec3,vec3,float)': { roll: F(-Math.PI, Math.PI, [0]) },
  'fovToFocal(float)': { fovDegrees: F(1, 179, [1, 45, 90, 120]) },
  'cameraRay(mat3,vec2,float)': { cam: F(-1, 1, UNIT_EDGE), focal: F(0.5, 3, [1, 2]) },
  'thinLensRay(mat3,vec2,float,float,float,vec2,vec3,vec3)': {
    cam: F(-1, 1, UNIT_EDGE), focal: F(0.5, 3, [1, 2]), aperture: POS(0.5), focusDist: F(0.5, 20, [1, 5]),
    xi: F(0, 0.9999999, [0, 0.5, 0.9999999]),
  },
  'orthoRay(mat3,vec2,float,vec3,vec3)': { cam: F(-1, 1, UNIT_EDGE), size: POS(10) },
  'fresnelSchlick(float,vec3)': { u: F(-0.5, 1.5, UNIT_EDGE), f0: F(0, 1, UNIT_EDGE) },
  'distributionGGX(float,float)': { NoH: F(0, 1, UNIT_EDGE), alpha: F(0, 1, UNIT_EDGE) },
  'visibilitySmithGGX(float,float,float)': { NoV: F(0, 1, UNIT_EDGE), NoL: F(0, 1, UNIT_EDGE), alpha: F(0, 1, UNIT_EDGE) },
  'specularGGX(vec3,vec3,vec3,float,vec3)': { n: UNIT3, v: UNIT3, l: UNIT3, roughness: F(0, 1, UNIT_EDGE), f0: F(0, 1, UNIT_EDGE) },
  'shadePBR(vec3,vec3,vec3,vec3,float,float)': {
    n: UNIT3, v: UNIT3, l: UNIT3, albedo: F(0, 1, UNIT_EDGE), roughness: F(0, 1, UNIT_EDGE), metallic: F(0, 1, UNIT_EDGE),
  },
  'envBRDFApprox(vec3,float,float)': { f0: F(0, 1, UNIT_EDGE), NoV: F(0, 1, UNIT_EDGE), roughness: F(0, 1, UNIT_EDGE) },
  'wrapDiffuse(vec3,vec3,float)': { n: UNIT3, l: UNIT3, w: F(0, 1, UNIT_EDGE) },
  'hemisphereLight(vec3,vec3,vec3)': { n: UNIT3 },
  'translucency(vec3,vec3,vec3,float,float,float)': { n: UNIT3, v: UNIT3, l: UNIT3, power: F(0.5, 16, [1, 4]), thickness: F(0, 1, UNIT_EDGE) },
  'rimLight(vec3,vec3,float)': { n: UNIT3, v: UNIT3, power: F(0.5, 16, [1, 4]) },
  'waterDispersion(float,float,float)': { k: F(-1, 50, POSITIVE_EDGE), depth: F(-1, 50, POSITIVE_EDGE), gravity: F(-1, 20, [9.81, 0]) },
  'waterWaveD(vec2,float,vec2,float,float,float,float)': {
    xz: F(-100, 100), time: F(0, 100, [0, 1]), wavelength: F(-1, 100, POSITIVE_EDGE), amplitude: F(0, 2, [0, 1]),
    depth: F(-1, 50, POSITIVE_EDGE), footprint: F(0, 10, POSITIVE_EDGE),
  },
  'fresnelDielectric(float,float,float)': {
    cosIncident: F(-1, 1, UNIT_EDGE), etaIncident: F(0.5, 2.5, [1, 1.333, 1.5, 0]), etaTransmitted: F(0.5, 2.5, [1, 1.333, 1.5, 0]),
  },
  'beerTransmittance(vec3,float)': { extinction: F(-1, 5, POSITIVE_EDGE), pathLength: F(-1, 20, POSITIVE_EDGE) },
  'srgbToLinear(vec3)': { c: F(-0.2, 1.2, [0, 0.04045, 0.0031308, 1, 0.5]) },
  'linearToSrgb(vec3)': { c: F(-0.2, 1.2, [0, 0.04045, 0.0031308, 1, 0.5]) },
  'linearSrgbToOklab(vec3)': { c: F(-0.2, 1.5, UNIT_EDGE) }, 'oklabToLinearSrgb(vec3)': { lab: F(-0.5, 1.2, UNIT_EDGE) },
  'mixOklab(vec3,vec3,float)': { a: F(0, 1, UNIT_EDGE), b: F(0, 1, UNIT_EDGE), t: F(0, 1, UNIT_EDGE) },
  'oklchToLinearSrgb(vec3)': { lch: F(0, 1, UNIT_EDGE) },
  'blackbody(float)': { kelvin: F(0, 20000, [0, 1000, 6500, 15000, 40000]) },
  'tonemapAgX(vec3)': { c: F(0, 20, POSITIVE_EDGE) }, 'tonemapAgXPunchy(vec3)': { c: F(0, 20, POSITIVE_EDGE) },
  'tonemapNeutral(vec3)': { c: F(0, 20, POSITIVE_EDGE) }, 'tonemapACES(vec3)': { c: F(0, 20, POSITIVE_EDGE) },
  'tonemapReinhard(vec3,float)': { c: F(0, 20, POSITIVE_EDGE), white: F(0.5, 20, [1, 4]) },
  'phaseRayleigh(float)': { mu: F(-1, 1, UNIT_EDGE) }, 'phaseHG(float,float)': { mu: F(-1, 1, UNIT_EDGE), g: F(-0.95, 0.95, UNIT_EDGE) },
  'phaseDualHG(float,float,float,float)': { mu: F(-1, 1, UNIT_EDGE), gF: F(0, 0.95), gB: F(-0.95, 0), w: F(0, 1, UNIT_EDGE) },
  'phaseCornetteShanks(float,float)': { mu: F(-1, 1, UNIT_EDGE), g: F(-0.95, 0.95, UNIT_EDGE) },
  'beerPowder(float)': { d: F(0, 10, POSITIVE_EDGE) },
  'volumeStep(vec3,vec3,vec3,vec3,float)': {
    radiance: F(0, 2, POSITIVE_EDGE), transmittance: F(0, 1, UNIT_EDGE), sigmaT: F(0, 5, POSITIVE_EDGE),
    inScatter: F(0, 2, POSITIVE_EDGE), ds: F(0, 2, POSITIVE_EDGE),
  },
  'distanceFog(float,float)': { t: F(0, 100, POSITIVE_EDGE), density: F(0, 1, POSITIVE_EDGE) },
  'heightFog(vec3,vec3,float,float,float)': { ro: F(-5, 5), rd: UNIT3, t: F(0, 100, POSITIVE_EDGE), a: F(0, 1, POSITIVE_EDGE), b: F(0, 2, POSITIVE_EDGE) },
  'simpleSky(vec3,vec3)': { rd: UNIT3, sunDir: UNIT3 },
  'sunDisk(vec3,vec3,float,float)': { rd: UNIT3, sunDir: UNIT3, angularRadius: F(0.001, 0.2, [0.00476, 0.05]), pixelAngle: F(0.0001, 0.01, [0.001]) },
  'atmosphereDensity(float)': { h: F(-10, 120, [0, 25, 10, 40, 100]) },
  'atmosphereExtinction(vec3)': { density: F(0, 1, UNIT_EDGE) },
  'atmosphereSky(vec3,vec3,float,float)': { rd: UNIT3, sunDir: UNIT3, viewHeightKm: F(-1, 120, [0, 0.001, 10, 100]), sunIntensity: F(0, 30, [20]) },
  'fillAA(float)': { d: QUAD_LINEAR }, 'fillAA(float,float)': { d: F(-2, 2, UNIT_EDGE), px: POS(0.1) },
  'strokeAA(float,float,float)': { d: F(-2, 2, UNIT_EDGE), hw: POS(0.5), px: POS(0.1) },
  'vignette(vec2,float)': { uv: F(-2, 2), focal: F(0.5, 3, [1, 2]) },
  'filmGrain(vec3,float,float)': { col: F(-0.5, 4, POSITIVE_EDGE), amount: POS(0.2), n: F(-1, 1, UNIT_EDGE) },
  'debugHeat(float)': { t: F(-0.5, 1.5, UNIT_EDGE) },
}

// ---------------------------------------------------------------------------------------------- types
const TYPE = {
  float: { n: 1, base: 'float', wgsl: 'f32' }, int: { n: 1, base: 'int', wgsl: 'i32' }, uint: { n: 1, base: 'uint', wgsl: 'u32' },
  vec2: { n: 2, base: 'float', wgsl: 'vec2f' }, vec3: { n: 3, base: 'float', wgsl: 'vec3f' }, vec4: { n: 4, base: 'float', wgsl: 'vec4f' },
  uvec2: { n: 2, base: 'uint', wgsl: 'vec2u' }, uvec3: { n: 3, base: 'uint', wgsl: 'vec3u' }, uvec4: { n: 4, base: 'uint', wgsl: 'vec4u' },
  mat2: { n: 4, cols: 2, base: 'float', wgsl: 'mat2x2f' }, mat3: { n: 9, cols: 3, base: 'float', wgsl: 'mat3x3f' },
}

function parseSignature(signature) {
  const m = /^(\w+) (\w+)\((.*)\)$/.exec(signature)
  if (!m) throw new Error(`Unparsed GLSL signature: ${signature}`)
  const params = m[3].trim() ? m[3].split(',').map(part => {
    const tokens = part.trim().split(/\s+/)
    const qualifier = tokens.length === 3 ? tokens[0] : ''
    return { qualifier, type: tokens.at(-2), name: tokens.at(-1) }
  }) : []
  return { ret: m[1], name: m[2], params }
}

// Builds the probe's input generators and their helper code, per language.
class ProbeInputs {
  constructor() { this.tables = []; this.salt = 0 }
  table(values, kind) {
    const key = `${kind}:${values.join(',')}`
    let index = this.tables.findIndex(t => t.key === key)
    if (index < 0) { index = this.tables.length; this.tables.push({ key, kind, values }) }
    return index
  }
  nextSalt() { return this.salt++ }
  scalarFloat([lo, hi, edges]) {
    const t = this.table(edges.map(bits), 'f'), salt = this.nextSalt()
    const l = fbits(lo), h = fbits(hi)
    return { glsl: `probeF${t}(s, ${salt}u, ${l.glsl}, ${h.glsl})`, wgsl: `probeF${t}(s, ${salt}u, ${l.wgsl}, ${h.wgsl})` }
  }
  scalarInt([lo, hi, edges]) {
    const t = this.table(edges, 'i'), salt = this.nextSalt()
    return { glsl: `probeI${t}(s, ${salt}u, ${lo}, ${hi})`, wgsl: `probeI${t}(s, ${salt}u, ${lo}, ${hi})` }
  }
  scalarUint(edges) {
    const t = this.table(edges.map(v => v >>> 0), 'u'), salt = this.nextSalt()
    return { glsl: `probeU${t}(s, ${salt}u)`, wgsl: `probeU${t}(s, ${salt}u)` }
  }
  value(type, spec) {
    const info = TYPE[type]
    if (!info) throw new Error(`No input generator for type ${type}`)
    const ctor = { glsl: type, wgsl: info.wgsl }
    const many = (n, make) => {
      const parts = Array.from({ length: n }, make)
      return n === 1 ? parts[0] : {
        glsl: `${ctor.glsl}(${parts.map(p => p.glsl).join(', ')})`,
        wgsl: `${ctor.wgsl}(${parts.map(p => p.wgsl).join(', ')})`,
      }
    }
    if (spec.quad) {
      if (info.n !== 1) throw new Error('Quad-linear inputs are scalar')
      this.usesQuad = true
      const salt = this.nextSalt()
      return { glsl: `probeQuadLinear(${salt}u)`, wgsl: `probeQuadLinear(${salt}u)` }
    }
    if (spec.unit) {
      const v = many(info.n, () => this.scalarFloat([-1, 1, spec.edges ?? UNIT_EDGE]))
      return { glsl: `normalize(${v.glsl})`, wgsl: `normalize(${v.wgsl})` }
    }
    if (spec.sincos) {
      const a = this.scalarFloat([spec.sincos[0], spec.sincos[1], [0, Math.PI / 2, Math.PI, 0.001]])
      return { glsl: `vec2(sin(${a.glsl}), cos(${a.glsl}))`, wgsl: `vec2f(sin(${a.wgsl}), cos(${a.wgsl}))` }
    }
    if (spec.cell) {
      return many(info.n, () => {
        const v = this.scalarFloat(spec.cell)
        return { glsl: `floor(${v.glsl})`, wgsl: `floor(${v.wgsl})` }
      })
    }
    if (info.base === 'float') return many(info.n, () => this.scalarFloat(spec.float ?? DEFAULT.float.float))
    if (info.base === 'int') return many(info.n, () => this.scalarInt(spec.int ?? DEFAULT.int.int))
    return many(info.n, () => this.scalarUint(spec.uint ?? DEFAULT.uint.uint))
  }
  helpers(language) {
    const glsl = language === 'glsl'
    const out = [glsl ? `uint probeHash(uint s, uint salt) {
    uint x = (s * 0x9E3779B9u) ^ (salt * 0x85EBCA6Bu + 0x632BE5ABu);
    x ^= x >> 16u; x *= 0x7FEB352Du; x ^= x >> 15u; x *= 0x846CA68Bu; x ^= x >> 16u;
    return x;
}` : `fn probeHash(s: u32, salt: u32) -> u32 {
    var x = (s * 0x9E3779B9u) ^ ((salt * 0x85EBCA6Bu) + 0x632BE5ABu);
    x ^= x >> 16u; x *= 0x7FEB352Du; x ^= x >> 15u; x *= 0x846CA68Bu; x ^= x >> 16u;
    return x;
}`]
    this.tables.forEach(({ kind, values }, t) => {
      const n = values.length
      if (kind === 'f' && n === 0) {
        out.push(glsl
          ? `float probeF${t}(uint s, uint salt, float lo, float hi) {
    uint h = probeHash(s, salt);
    return lo + (hi - lo) * (float(h >> 8u) * (1.0 / 16777216.0));
}`
          : `fn probeF${t}(s: u32, salt: u32, lo: f32, hi: f32) -> f32 {
    let h = probeHash(s, salt);
    return lo + (hi - lo) * (f32(h >> 8u) * (1.0 / 16777216.0));
}`)
      } else if (kind === 'f') {
        out.push(glsl
          ? `const uint PROBE_T${t}[${n}] = uint[${n}](${values.map(hex).join(', ')});
float probeF${t}(uint s, uint salt, float lo, float hi) {
    uint h = probeHash(s, salt);
    float edge = uintBitsToFloat(PROBE_T${t}[(h >> 1u) % ${n}u]);
    float r = lo + (hi - lo) * (float(h >> 8u) * (1.0 / 16777216.0));
    return ((h & 1u) == 0u) ? edge : r;
}`
          : `var<private> PROBE_T${t}: array<u32, ${n}> = array<u32, ${n}>(${values.map(hex).join(', ')});
fn probeF${t}(s: u32, salt: u32, lo: f32, hi: f32) -> f32 {
    let h = probeHash(s, salt);
    let edge = bitcast<f32>(PROBE_T${t}[(h >> 1u) % ${n}u]);
    let r = lo + (hi - lo) * (f32(h >> 8u) * (1.0 / 16777216.0));
    return select(r, edge, (h & 1u) == 0u);
}`)
      } else if (kind === 'i') {
        out.push(glsl
          ? `const int PROBE_T${t}[${n}] = int[${n}](${values.join(', ')});
int probeI${t}(uint s, uint salt, int lo, int hi) {
    uint h = probeHash(s, salt);
    int edge = PROBE_T${t}[(h >> 1u) % ${n}u];
    int r = lo + int((h >> 8u) % uint(hi - lo + 1));
    return ((h & 1u) == 0u) ? edge : r;
}`
          : `var<private> PROBE_T${t}: array<i32, ${n}> = array<i32, ${n}>(${values.join(', ')});
fn probeI${t}(s: u32, salt: u32, lo: i32, hi: i32) -> i32 {
    let h = probeHash(s, salt);
    let edge = PROBE_T${t}[(h >> 1u) % ${n}u];
    let r = lo + i32((h >> 8u) % u32(hi - lo + 1));
    return select(r, edge, (h & 1u) == 0u);
}`)
      } else {
        out.push(glsl
          ? `const uint PROBE_T${t}[${n}] = uint[${n}](${values.map(hex).join(', ')});
uint probeU${t}(uint s, uint salt) {
    uint h = probeHash(s, salt);
    return ((h & 1u) == 0u) ? PROBE_T${t}[(h >> 1u) % ${n}u] : probeHash(h, salt + 1u);
}`
          : `var<private> PROBE_T${t}: array<u32, ${n}> = array<u32, ${n}>(${values.map(hex).join(', ')});
fn probeU${t}(s: u32, salt: u32) -> u32 {
    let h = probeHash(s, salt);
    return select(probeHash(h, salt + 1u), PROBE_T${t}[(h >> 1u) % ${n}u], (h & 1u) == 0u);
}`)
      }
    })
    if (this.usesQuad) {
      out.push(glsl ? `float probeQuadLinear(uint salt) {
    uint quad = uint((probePixel.y / 2) * ${W / 2} + probePixel.x / 2);
    float a = float(int(probeHash(quad, salt) % 2049u) - 1024) / 512.0;
    float b = float(int(probeHash(quad, salt + 1u) % 129u) - 64) / 256.0;
    float c = float(int(probeHash(quad, salt + 2u) % 129u) - 64) / 256.0;
    return a + b * float(probePixel.x & 1) + c * float(probePixel.y & 1);
}` : `fn probeQuadLinear(salt: u32) -> f32 {
    let quad = u32((probePixel.y / 2) * ${W / 2} + probePixel.x / 2);
    let a = f32(i32(probeHash(quad, salt) % 2049u) - 1024) / 512.0;
    let b = f32(i32(probeHash(quad, salt + 1u) % 129u) - 64) / 256.0;
    let c = f32(i32(probeHash(quad, salt + 2u) % 129u) - 64) / 256.0;
    return a + b * f32(probePixel.x & 1) + c * f32(probePixel.y & 1);
}`)
    }
    return out.join('\n\n')
  }
}

// The scene the raymarch probes march: a sphere, a ground plane and a box, with material ids.
const MAP = {
  glsl: `vec2 map(vec3 p) {
    float sphere = length(p) - 1.0;
    float ground = p.y + 1.0;
    vec3 q = abs(p - vec3(2.0, 0.0, 0.0)) - vec3(0.5);
    float box = length(max(q, 0.0)) + min(max(q.x, max(q.y, q.z)), 0.0);
    float d = min(min(sphere, ground), box);
    return vec2(d, (d == sphere) ? 1.0 : ((d == ground) ? 2.0 : 3.0));
}`,
  wgsl: `fn map(p: vec3f) -> vec2f {
    let sphere = length(p) - 1.0;
    let ground = p.y + 1.0;
    let q = abs(p - vec3f(2.0, 0.0, 0.0)) - vec3f(0.5);
    let box = length(max(q, vec3f(0.0))) + min(max(q.x, max(q.y, q.z)), 0.0);
    let d = min(min(sphere, ground), box);
    return vec2f(d, select(select(3.0, 2.0, d == ground), 1.0, d == sphere));
}`,
}

function closure(entry, language) {
  const seen = new Set([entry.id])
  const stack = [...entry[language].dependencies]
  while (stack.length) {
    const id = stack.pop()
    if (seen.has(id)) continue
    seen.add(id)
    stack.push(...BY_ID.get(id)[language].dependencies)
  }
  return [...seen].sort((a, b) => ORDER.get(a) - ORDER.get(b)).map(id => BY_ID.get(id))
}

function wordsOf(type, expr, language) {
  const info = TYPE[type]
  const component = k => info.cols ? `${expr}[${Math.floor(k / info.cols)}][${k % info.cols}]` : info.n === 1 ? expr : `${expr}[${k}]`
  return Array.from({ length: info.n }, (_, k) => {
    const c = component(k)
    if (info.base === 'uint') return { word: c, kind: 'uint' }
    if (info.base === 'int') return { word: language === 'glsl' ? `uint(${c})` : `bitcast<u32>(${c})`, kind: 'int' }
    return { word: language === 'glsl' ? `floatBitsToUint(${c})` : `bitcast<u32>(${c})`, kind: 'float' }
  })
}

// Assembles the GLSL and WGSL probe programs for one library symbol.
function buildProbe(entry) {
  const inputs = new ProbeInputs()
  const lines = { glsl: [], wgsl: [] }
  const words = { glsl: [], wgsl: [] }
  let kinds = []
  if (entry.kind === 'const') {
    const type = /^const (\w+)/.exec(entry.glsl.signature)[1]
    for (const language of ['glsl', 'wgsl']) words[language] = wordsOf(type, entry[language].name, language).map(w => w.word)
    kinds = wordsOf(type, 'x', 'glsl').map(w => w.kind)
  } else {
    const sig = parseSignature(entry.glsl.signature)
    const overrides = OVERRIDES[entry.id] || {}
    const callArgs = { glsl: [], wgsl: [] }
    sig.params.forEach((param, k) => {
      const spec = overrides[param.name] ?? BY_NAME[param.name] ?? DEFAULT[TYPE[param.type].base]
      const local = `a${k}`
      if (param.qualifier === 'out') {
        lines.glsl.push(`${param.type} ${local} = ${param.type}(0.0);`)
        lines.wgsl.push(`var ${local} = ${TYPE[param.type].wgsl}(0.0);`)
      } else {
        const value = inputs.value(param.type, spec)
        lines.glsl.push(`${param.type} ${local} = ${value.glsl};`)
        lines.wgsl.push(`${param.qualifier ? 'var' : 'let'} ${local}: ${TYPE[param.type].wgsl} = ${value.wgsl};`)
      }
      callArgs.glsl.push(local)
      callArgs.wgsl.push(param.qualifier ? `&${local}` : local)
    })
    const call = { glsl: `${entry.glsl.name}(${callArgs.glsl.join(', ')})`, wgsl: `${entry.wgsl.name}(${callArgs.wgsl.join(', ')})` }
    if (sig.ret === 'void') {
      lines.glsl.push(`${call.glsl};`)
      lines.wgsl.push(`${call.wgsl};`)
    } else {
      lines.glsl.push(`${sig.ret} result = ${call.glsl};`)
      lines.wgsl.push(`let result = ${call.wgsl};`)
      for (const language of ['glsl', 'wgsl']) words[language].push(...wordsOf(sig.ret, 'result', language).map(w => w.word))
      kinds.push(...wordsOf(sig.ret, 'x', 'glsl').map(w => w.kind))
    }
    sig.params.forEach((param, k) => {
      if (!param.qualifier) return
      for (const language of ['glsl', 'wgsl']) words[language].push(...wordsOf(param.type, `a${k}`, language).map(w => w.word))
      kinds.push(...wordsOf(param.type, 'x', 'glsl').map(w => w.kind))
    })
  }
  const C = words.glsl.length
  const samples = Math.floor(PIXELS / C)
  const required = new Set(['glsl', 'wgsl'].flatMap(language => closure(entry, language).flatMap(e => e[language].requires)))
  const library = language => closure(entry, language).map(e => sourceOf(e.id, language)).join('\n\n')
  const glsl = `#version 300 es
precision highp float;
precision highp int;
out vec4 fragColor;
ivec2 probePixel;
${required.has('ZERO') ? '#define ZERO (min(int(gl_FragCoord.x), 0))' : ''}
${required.has('map') ? 'vec2 map(vec3 p);' : ''}

${library('glsl')}

${required.has('map') ? MAP.glsl : ''}

${inputs.helpers('glsl')}

uint probeWord(uint s, int c) {
    ${lines.glsl.join('\n    ')}
    uint words[${C}];
    ${words.glsl.map((w, k) => `words[${k}] = ${w};`).join('\n    ')}
    return words[c];
}

void main() {
    probePixel = ivec2(gl_FragCoord.xy);
    int index = probePixel.y * ${W} + probePixel.x;
    int sampleIndex = index / ${C};
    uint word = probeWord(uint(sampleIndex), index - sampleIndex * ${C});
    word = (sampleIndex < ${samples}) ? word : 0u;
    fragColor = vec4(float(word & 255u), float((word >> 8u) & 255u), float((word >> 16u) & 255u), float(word >> 24u)) / 255.0;
}
`
  const wgsl = `@group(0) @binding(0) var<uniform> resolution: vec2<f32>;
var<private> probePixel: vec2i;
${required.has('ZERO') ? 'var<private> ZERO: i32;' : ''}

${library('wgsl')}

${required.has('map') ? MAP.wgsl : ''}

${inputs.helpers('wgsl')}

fn probeWord(s: u32, c: i32) -> u32 {
    ${lines.wgsl.join('\n    ')}
    var words: array<u32, ${C}>;
    ${words.wgsl.map((w, k) => `words[${k}] = ${w};`).join('\n    ')}
    return words[c];
}

@fragment
fn main(@builtin(position) position: vec4<f32>) -> @location(0) vec4<f32> {
    ${required.has('ZERO') ? 'ZERO = min(i32(position.x), 0);' : ''}
    probePixel = vec2i(i32(position.x), i32(resolution.y) - 1 - i32(position.y));
    let index = probePixel.y * ${W} + probePixel.x;
    let sampleIndex = index / ${C};
    var word = probeWord(u32(sampleIndex), index - sampleIndex * ${C});
    word = select(0u, word, sampleIndex < ${samples});
    return vec4f(f32(word & 255u), f32((word >> 8u) & 255u), f32((word >> 16u) & 255u), f32(word >> 24u)) / 255.0;
}
`
  return { id: entry.id, kind: entry.kind, words: C, samples, kinds, glsl, wgsl }
}

// Writes a known word into every pixel, so a run proves the encoding and the pixel order of each backend.
function calibrationProbe() {
  const word = { glsl: 'uint(index) | (uint(index) << 12u) | ((uint(index) & 255u) << 24u)', wgsl: 'u32(index) | (u32(index) << 12u) | ((u32(index) & 255u) << 24u)' }
  return {
    id: '(calibration)', kind: 'calibration', words: 1, samples: PIXELS, kinds: ['uint'],
    glsl: `#version 300 es
precision highp float;
precision highp int;
out vec4 fragColor;
void main() {
    int index = int(gl_FragCoord.y) * ${W} + int(gl_FragCoord.x);
    uint word = ${word.glsl};
    fragColor = vec4(float(word & 255u), float((word >> 8u) & 255u), float((word >> 16u) & 255u), float(word >> 24u)) / 255.0;
}
`,
    wgsl: `@group(0) @binding(0) var<uniform> resolution: vec2<f32>;
@fragment
fn main(@builtin(position) position: vec4<f32>) -> @location(0) vec4<f32> {
    let index = (i32(resolution.y) - 1 - i32(position.y)) * ${W} + i32(position.x);
    let word = ${word.wgsl};
    return vec4f(f32(word & 255u), f32((word >> 8u) & 255u), f32((word >> 16u) & 255u), f32(word >> 24u)) / 255.0;
}
`,
  }
}
const expectedCalibration = index => ((index | (index << 12) | ((index & 255) << 24)) >>> 0)

// Every module of the library compiled as one program per language, with the program symbols defined.
function fullLibraryProbe() {
  return {
    id: '(full library)', kind: 'library', words: 0, samples: 0, kinds: [],
    glsl: `#version 300 es
precision highp float;
precision highp int;
out vec4 fragColor;
#define ZERO (min(int(gl_FragCoord.x), 0))
${MODULES.map(m => m.glsl).join('\n')}
${MAP.glsl}
void main() { fragColor = vec4(raymarch(vec3(0.0, 0.0, -3.0), vec3(0.0, 0.0, 1.0), 0.0, 10.0, 1.0), 1.0); }
`,
    wgsl: `@group(0) @binding(0) var<uniform> resolution: vec2<f32>;
var<private> ZERO: i32;
${MODULES.map(m => m.wgsl).join('\n')}
${MAP.wgsl}
@fragment
fn main(@builtin(position) position: vec4<f32>) -> @location(0) vec4<f32> {
    ZERO = min(i32(position.x), 0);
    return vec4f(raymarch(vec3f(0.0, 0.0, -3.0), vec3f(0.0, 0.0, 1.0), 0.0, 10.0 + 0.0 * resolution.x, 1.0), 1.0);
}
`,
  }
}

// Complete programs exercise dependency composition rather than isolated library calls. Results are
// encoded float words, so the comparison retains 32-bit precision instead of accepting 8-bit color rounding.
function bundledProbes() {
  const programs = [
    { id: 'caller-definitions',
      helpers: {
        glsl: '#define tonemapAgX(c) (c)\nfloat hash12(vec2 p){return p.x;}',
        wgsl: 'fn tonemapAgX(c:vec3f)->vec3f{return c;} fn hash12(p:vec2f)->f32{return p.x;}',
      },
      // Exact quarter-cell inputs isolate declaration/macro handling without introducing rounding tolerance.
      glsl: 'float value = tonemapAgX(valueNoiseD(vec2(0.25, 0.5))).x;',
      wgsl: 'let value = tonemapAgX(valueNoiseD(vec2f(0.25, 0.5))).x;' },
    { id: 'noise-fbm',
      glsl: 'float value = fbm(uv * 3.0, 5);',
      wgsl: 'let value = fbm_f2i(uv * 3.0, 5);' },
    { id: 'sdf-raymarch', scene: true,
      glsl: 'vec3 ro = vec3(0.0, 0.0, -3.0); vec3 rd = normalize(vec3(uv * 0.2, 1.0)); vec3 hit = raymarch(ro, rd, 0.0, 10.0, 1.0); float value = hit.x + dot(calcNormal(ro + rd * hit.x, 0.001), vec3(0.02, 0.03, 0.04));',
      wgsl: 'let ro = vec3f(0.0, 0.0, -3.0); let rd = normalize(vec3f(uv * 0.2, 1.0)); let hit = raymarch(ro, rd, 0.0, 10.0, 1.0); let value = hit.x + dot(calcNormal(ro + rd * hit.x, 0.001), vec3f(0.02, 0.03, 0.04));' },
    { id: 'sdf-2d',
      // Compare the library's signed distance, including corners and the interior. Coverage via
      // builtin smoothstep adds backend-specific interpolation rounding to this library proof.
      glsl: 'float value = sdBox(uv, vec2(0.375, 0.25));',
      wgsl: 'let value = sdBox_f2f2(uv, vec2f(0.375, 0.25));' },
    { id: 'cloud-volume',
      glsl: 'vec3 radiance = vec3(0.0); vec3 transmittance = vec3(1.0); for (int i=0; i<8; i++) { float density = max(fbm(vec3(uv, float(i) * 0.1), 3, 2.0, 0.5), 0.0) + 0.1; volumeStep(radiance, transmittance, vec3(density), vec3(0.5, 0.7, 0.9) * beerPowder(density), 0.125); } float value = dot(radiance, vec3(0.2, 0.3, 0.5)) + transmittance.x;',
      wgsl: 'var radiance = vec3f(0.0); var transmittance = vec3f(1.0); for (var i=0; i<8; i++) { let density = max(fbm_f3iff(vec3f(uv, f32(i) * 0.1), 3, 2.0, 0.5), 0.0) + 0.1; volumeStep(&radiance, &transmittance, vec3f(density), vec3f(0.5, 0.7, 0.9) * beerPowder(density), 0.125); } let value = dot(radiance, vec3f(0.2, 0.3, 0.5)) + transmittance.x;' },
    { id: 'tonemap-pipeline',
      glsl: 'vec3 color = linearToSrgb(tonemapAgX(vec3(uv + 1.0, 0.4) * 4.0)); float value = dot(color, vec3(0.2, 0.3, 0.5));',
      wgsl: 'let color = linearToSrgb(tonemapAgX(vec3f(uv + vec2f(1.0), 0.4) * 4.0)); let value = dot(color, vec3f(0.2, 0.3, 0.5));' },
  ]
  return programs.map(program => {
    const glsl = bundleShaderSource(`#version 300 es
precision highp float;
precision highp int;
out vec4 fragColor;
${program.scene ? '#define ZERO (min(int(gl_FragCoord.x), 0))' : ''}
${program.helpers?.glsl ?? ''}
${program.scene ? MAP.glsl : ''}
void main() {
    vec2 uv = (gl_FragCoord.xy / vec2(${W}.0, ${H}.0)) * 2.0 - 1.0;
    ${program.glsl}
    uint word = floatBitsToUint(value);
    fragColor = vec4(float(word & 255u), float((word >> 8u) & 255u), float((word >> 16u) & 255u), float(word >> 24u)) / 255.0;
}`, 'glsl')
    const wgsl = bundleShaderSource(`@group(0) @binding(0) var<uniform> resolution: vec2f;
${program.scene ? 'var<private> ZERO: i32;' : ''}
${program.helpers?.wgsl ?? ''}
${program.scene ? MAP.wgsl : ''}
@fragment fn main(@builtin(position) position: vec4f) -> @location(0) vec4f {
    ${program.scene ? 'ZERO = min(i32(position.x), 0);' : ''}
    let pixel = vec2f(position.x, resolution.y - position.y);
    let uv = (pixel / vec2f(${W}.0, ${H}.0)) * 2.0 - vec2f(1.0);
    ${program.wgsl}
    let word = bitcast<u32>(value);
    return vec4f(f32(word & 255u), f32((word >> 8u) & 255u), f32((word >> 16u) & 255u), f32(word >> 24u)) / 255.0;
}`, 'wgsl')
    // Use the strictest bound compatible with every included primitive's established tolerance. The program's
    // aggregate result must stay within it too; failures require investigation, not a widened automatic bound.
    const included = [...new Set([...glsl.added, ...wgsl.added])]
    const tolerance = Math.max(0, ...included.map(id => BY_ID.get(id).parity?.tolerance ?? 0))
    return { id: `(bundled ${program.id})`, kind: 'bundled', words: 1, samples: PIXELS, kinds: ['float'],
      glsl: glsl.source, wgsl: wgsl.source, added: { glsl: glsl.added, wgsl: wgsl.added }, tolerance }
  })
}

// ---------------------------------------------------------------------------------------------- rendering
async function renderAll(backend, probes) {
  const session = new BrowserSession({ backend, blankPage: true, viewerRoot: NM, effectsDir: `${NM}/shaders/effects` })
  const results = []
  let rendererName = 'unknown'
  try {
    await session.setup()
    const page = session.page
    const base = getServerUrl()
    // Import and execute the shipped browser entry in a real page. No Node shims or external host is used.
    if (probes.some(p => p.kind === 'bundled')) {
      const moduleSource = readFileSync(new URL('../dist/knowledge/shader-craft.js', import.meta.url), 'utf8')
      await page.route(`${base}/craft-knowledge.js`, route => route.fulfill({ contentType: 'text/javascript', body: moduleSource }))
      const proof = await page.evaluate(async url => {
        const api = await import(url)
        return { rule: api.checkShaderSource('round(x)', 'glsl')[0]?.rule,
          added: api.bundleShaderSource('tonemapAgX(vec3(1.0));', 'glsl').added,
          found: api.searchShaderLibrary('tonemapAgX', { language: 'wgsl', limit: 1 })[0]?.name }
      }, `${base}/craft-knowledge.js`)
      if (proof.rule !== 'round' || !proof.added.includes('tonemapAgX(vec3)') || proof.found !== 'tonemapAgX') throw new Error('Browser knowledge entry failed its API proof')
      console.log(`craft-library-parity: ${backend} browser knowledge entry: 3/3 APIs passed`)
    }
    rendererName = await page.evaluate(async backend => {
      if (backend === 'webgpu') {
        const adapter = await navigator.gpu?.requestAdapter()
        const info = adapter?.info
        return info ? [info.vendor, info.architecture, info.description].filter(Boolean).join(' ') || 'unnamed adapter' : 'no adapter'
      }
      const gl = document.createElement('canvas').getContext('webgl2')
      const debug = gl?.getExtension('WEBGL_debug_renderer_info')
      return gl ? String(gl.getParameter(debug ? debug.UNMASKED_RENDERER_WEBGL : gl.RENDERER)) : 'no context'
    }, backend)
    console.log(`craft-library-parity: ${backend} renders on ${rendererName}`)
    await page.evaluate(async ({ base, backend, W, H }) => {
      const { CanvasRenderer } = await import(`${base}/shaders/src/index.js`)
      const canvas = document.createElement('canvas')
      canvas.width = W
      canvas.height = H
      document.body.appendChild(canvas)
      const state = { failure: null }
      const renderer = new CanvasRenderer({
        canvas, width: W, height: H, basePath: `${base}/shaders`, bundlePath: `${base}/shaders/effects`,
        useBundles: false, preferWebGPU: backend === 'webgpu',
        onError: error => { state.failure = error?.message || String(error) },
      })
      await renderer.loadManifest()
      window.__craftParity = { renderer, state }
    }, { base, backend, W, H })
    const chunk = 16
    for (let start = 0; start < probes.length; start += chunk) {
      const batch = probes.slice(start, start + chunk).map((probe, i) => ({
        func: `craftProbe${start + i}`, source: probe[backend === 'webgpu' ? 'wgsl' : 'glsl'], render: probe.kind !== 'library',
      }))
      const out = await page.evaluate(async ({ batch, backend }) => {
        const { renderer, state } = window.__craftParity
        const language = backend === 'webgpu' ? 'wgsl' : 'glsl'
        const results = []
        for (const { func, source, render } of batch) {
          try {
            state.failure = null
            await renderer.registerPortableEffect({
              func, namespace: 'user', globals: {},
              passes: [{ name: 'main', program: func, inputs: {}, outputs: { color: 'outputTex' } }],
              shaders: { [func]: { [language]: source } },
            })
            await renderer.compile(`search user\n${func}().write(o0)\nrender(o0)`)
            renderer.stop()
            const pipeline = renderer.pipeline
            const actual = String(pipeline.backend.getName?.() || '').toLowerCase()
            if (actual !== backend) throw new Error(`Requested backend ${backend}, renderer used ${actual}`)
            if (!render) { results.push({ func, ok: true }); continue }
            const frame = renderer.frameCount
            renderer.render(0)
            if (state.failure) throw new Error(`Render failed: ${state.failure}`)
            if (renderer.frameCount !== frame + 1) throw new Error('Renderer did not advance')
            await pipeline.backend.device?.queue.onSubmittedWorkDone()
            const raw = await pipeline.backend.readPixels(pipeline.surfaces.get('o0').read)
            const bytes = raw.data instanceof Uint8Array ? raw.data
              : Uint8Array.from(raw.data, value => Math.round(Math.max(0, Math.min(1, value)) * 255))
            let binary = ''
            for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
            results.push({ func, ok: true, width: raw.width, height: raw.height, pixels: btoa(binary) })
          } catch (error) {
            results.push({ func, ok: false, error: [error?.message, error?.detail].filter(Boolean).join('\n') || String(error) })
          }
        }
        return results
      }, { batch, backend })
      results.push(...out)
      if (process.stdout.isTTY) {
        process.stdout.write(`\rcraft-library-parity: ${backend} ${Math.min(start + chunk, probes.length)}/${probes.length}`)
      }
    }
    if (process.stdout.isTTY) process.stdout.write('\n')
    await page.evaluate(async () => { await window.__craftParity?.renderer.dispose().catch(() => {}) })
  } finally {
    await session.teardown()
  }
  return { results, rendererName }
}

function decode(result) {
  const bytes = Buffer.from(result.pixels, 'base64')
  if (result.width !== W || result.height !== H || bytes.length !== PIXELS * 4) {
    throw new Error(`unexpected readback ${result.width}x${result.height}, ${bytes.length} bytes`)
  }
  const words = new Uint32Array(PIXELS)
  for (let i = 0; i < PIXELS; i++) words[i] = bytes.readUInt32LE(i * 4)
  return words
}

const asFloat = word => { u32[0] = word; return f32[0] }
// |a - b| / max(1, |a|, |b|) for two float words: absolute below 1, relative above. NaN against NaN and -0 against +0
// are 0 apart; a NaN against a number, or infinities that differ, are infinitely far apart.
function scaledDifference(x, y) {
  const a = asFloat(x), b = asFloat(y)
  if (Number.isNaN(a) || Number.isNaN(b)) return Number.isNaN(a) && Number.isNaN(b) ? 0 : Infinity
  if (a === b) return 0
  if (!Number.isFinite(a) || !Number.isFinite(b)) return Infinity
  return Math.abs(a - b) / Math.max(1, Math.abs(a), Math.abs(b))
}

// ---------------------------------------------------------------------------------------------- main
const entries = only ? LIBRARY.filter(entry => only.includes(entry.id)) : LIBRARY
if (!bundledOnly && only && entries.length !== only.length) {
  console.error(`craft-library-parity: unknown ids: ${only.filter(id => !BY_ID.has(id)).join(', ')}`)
  process.exit(2)
}
const bundles = bundledProbes().filter(p => !bundledOnly || !only || only.includes(p.id.slice(9, -1)))
if (bundledOnly && only && bundles.length !== only.length) throw new Error('Unknown bundled program in --only')
const probes = [calibrationProbe(), ...bundledOnly ? [] : [fullLibraryProbe(), ...entries.map(buildProbe)], ...bundles]
const rendered = {}
const renderers = {}
for (const backend of ['webgl2', 'webgpu']) ({ results: rendered[backend], rendererName: renderers[backend] } = await renderAll(backend, probes))

const failures = []
const report = { backends: {}, symbols: [] }
let order = null
for (const backend of ['webgl2', 'webgpu']) {
  const results = rendered[backend]
  const compiled = results.filter(r => r.ok).length
  report.backends[backend] = { renderer: renderers[backend], probes: probes.length, compiled }
  results.forEach((r, i) => { if (!r.ok) failures.push(`${backend} ${probes[i].id}: ${r.error}`) })
  // The calibration probe fixes the pixel order: buffer position -> pixel index.
  const calibration = results[0]
  if (calibration.ok) {
    const words = decode(calibration)
    const map = new Int32Array(PIXELS).fill(-1)
    for (let i = 0; i < PIXELS; i++) {
      const index = words[i] & 0xfff
      if (expectedCalibration(index) !== words[i] || map[index] >= 0) {
        failures.push(`${backend} calibration: pixel ${i} holds ${words[i].toString(16)}, which no pixel index encodes`)
        break
      }
      map[index] = i
    }
    if (order && map.some((position, index) => position !== order[index])) failures.push(`${backend}: pixel order differs from webgl2`)
    order = order || map
  }
}

let functions = 0, constants = 0, exact = 0, equal = 0, tolerated = 0
if (failures.length === 0) {
  probes.forEach((probe, i) => {
    if (!['function', 'const', 'bundled'].includes(probe.kind)) return
    const entry = BY_ID.get(probe.id)
    if (probe.kind === 'function') functions++
    else if (probe.kind === 'const') constants++
    const a = decode(rendered.webgl2[i]), b = decode(rendered.webgpu[i])
    let differing = 0, maxDifference = 0, firstDifference = null, nonzero = false
    for (let sample = 0; sample < probe.samples; sample++) {
      for (let k = 0; k < probe.words; k++) {
        const index = sample * probe.words + k
        const x = a[order[index]], y = b[order[index]]
        if (x !== 0 || y !== 0) nonzero = true
        if (x === y) continue
        differing++
        const distance = probe.kinds[k] === 'float' ? scaledDifference(x, y) : Infinity
        maxDifference = Math.max(maxDifference, distance)
        if (distance > 0 && !firstDifference) {
          firstDifference = { sample, word: k, webgl2: x.toString(16), webgpu: y.toString(16),
            values: probe.kinds[k] === 'float' ? [asFloat(x), asFloat(y)] : [x, y] }
        }
      }
    }
    const tolerance = probe.kind === 'bundled' ? probe.tolerance : entry.parity?.tolerance ?? 0
    report.symbols.push({ id: probe.id, ...probe.added ? { added: probe.added } : {}, samples: probe.samples, words: probe.words, differing, maxDifference, tolerance })
    if (!nonzero) failures.push(`${probe.id}: both backends wrote only zero words; the probe did not render`)
    else if (differing === 0) exact++
    else if (maxDifference === 0) equal++
    else if (maxDifference <= tolerance) tolerated++
    else failures.push(`${probe.id}: ${differing} of ${probe.samples * probe.words} words differ, scaled difference up to ${maxDifference}, tolerance ${tolerance}; first ${JSON.stringify(firstDifference)}`)
  })
}

for (const backend of ['webgl2', 'webgpu']) {
  const { probes: total, compiled } = report.backends[backend]
  console.log(`craft-library-parity: ${backend} compiled and ran ${compiled}/${total} probes (calibration, ${bundledOnly ? 0 : 1} full library, ${bundledOnly ? 0 : entries.length} symbols, ${bundles.length} bundled programs)`)
}
console.log(`craft-library-parity: compared ${functions} functions, ${constants} constants and ${bundles.length} bundled programs: ${exact} bit-identical, ` +
  `${equal} equal apart from the sign of zero or NaN bits, ${tolerated} within a recorded tolerance`)
if (jsonPath) writeFileSync(jsonPath, JSON.stringify({ ...report, failures }, null, 2))
if (failures.length) {
  for (const failure of failures) console.error(`craft-library-parity: FAIL ${failure}`)
  process.exit(1)
}
console.log('craft-library-parity: all symbols match')
process.exit(0)
