import alpineValley from './examples/alpine-valley.js'
import coastalWater from './examples/coastal-water.js'
import noiseProgression from './examples/noise-progression.js'
import noiseTerrainMap from './examples/noise-terrain-map.js'
import ocean from './examples/ocean.js'
import patternSwatches from './examples/pattern-swatches.js'
import proceduralCity from './examples/procedural-city.js'
import raymarchSdf from './examples/raymarch-sdf.js'
import sdf2dPoster from './examples/sdf-2d-poster.js'
import terrain from './examples/terrain.js'
import volumetricClouds from './examples/volumetric-clouds.js'
import { bundleShaderSource } from './bundler.js'
import type { BundledShaderSource } from './bundler.js'
import { SHADER_CRAFT_PROVENANCE } from './provenance.js'
import { SHADER_CRAFT_LICENSE } from './license.js'

export interface ShaderCraftExample {
  id: string
  func: string
  name: string
  summary: string
  upstreamPath: string
}
export interface ShaderCraftExampleDefinition {
  name: string
  namespace: 'user'
  func: string
  description: string
  tags: string[]
  starter: true
  uniformLayout: Record<string, { slot: number; components: string }>
  globals: { seed: { type: 'int'; default: number; uniform: 'seed'; min: number; max: number } }
  passes: Array<{ name: string; program: string; inputs: Record<string, string>; outputs: { fragColor: 'outputTex' } }>
}
export interface ShaderCraftExamplePackage {
  example: ShaderCraftExample
  definition: ShaderCraftExampleDefinition
  shaders: { glsl: BundledShaderSource; wgsl: BundledShaderSource }
  /** Files relative to a Noisemaker shaders/effects/user/<func>/ directory. */
  files: Record<string, string>
}
const programs = {
  'alpine-valley': alpineValley,
  'coastal-water': coastalWater,
  'noise-progression': noiseProgression,
  'noise-terrain-map': noiseTerrainMap,
  ocean,
  'pattern-swatches': patternSwatches,
  'procedural-city': proceduralCity,
  'raymarch-sdf': raymarchSdf,
  'sdf-2d-poster': sdf2dPoster,
  terrain,
  'volumetric-clouds': volumetricClouds,
}
const entries: Array<[keyof typeof programs, string, string, string]> = [
  ['alpine-valley', 'craftAlpineValley', 'Alpine valley', 'Designed valley heightfield, multiscale ridges, snow, strata, terrain shadows and aerial depth.'],
  ['coastal-water', 'craftCoastalWater', 'Coastal water', 'Finite-depth waves, refracted seabed, reflected land, dielectric Fresnel, Beer-Lambert extinction and shore foam.'],
  ['noise-progression', 'craftNoiseProgression', 'Noise progression', 'Ten noise studies: gradient, Voronoi borders, simplex, fBm, domain warp, value, Worley, ridged, billow and hybrid terrain.'],
  ['noise-terrain-map', 'craftNoiseTerrainMap', 'Noise terrain map', 'Top-down hybrid relief, warped river contour, slope lighting and biome masks.'],
  ['ocean', 'craftOcean', 'Ocean', 'Dispersive exp-sine waves, analytic slope and curvature, footprint filtering, GGX glints, crest foam and atmospheric sky.'],
  ['pattern-swatches', 'craftPatternSwatches', 'Pattern swatches', 'Six filtered material studies: warped marble, cracked earth, hex tiles, Truchet, organic cells and checker.'],
  ['procedural-city', 'craftProceduralCity', 'Procedural city', 'Parcel massing, setbacks, roofs, filtered facade windows, emissive occupancy, shadows and blue-hour haze.'],
  ['raymarch-sdf', 'craftRaymarchSdf', 'Raymarch SDF', 'Smooth-blended sculpture and gold ring on a plinth, PBR, soft shadows, AO and sky reflections.'],
  ['sdf-2d-poster', 'craftSdf2dPoster', 'SDF 2D poster', 'Layered dusk poster with striped sun, ridges, vesica foliage, twinkling stars and Oklab palette.'],
  ['terrain', 'craftTerrain', 'Terrain', 'Derivative-damped eroded mountains, slope and altitude materials, snow, shadows and atmospheric scattering.'],
  ['volumetric-clouds', 'craftVolumetricClouds', 'Volumetric clouds', 'Coverage-remapped cumulus density, height profile, energy-conserving integration, dual-lobe phase and light marching.'],
]

/** On-demand complete examples. No runtime filesystem access or network fetch is needed. */
export const SHADER_CRAFT_EXAMPLES: readonly ShaderCraftExample[] = entries.map(([id, func, name, summary]) => ({
  id, func, name, summary, upstreamPath: `skills/shader-art-coding/templates/${id}.glsl`,
}))

/** Return fresh copyable definition.js and paired sources, with the actual minimal library closure and credits. */
export function getShaderCraftExample(id: string): ShaderCraftExamplePackage {
  const example = SHADER_CRAFT_EXAMPLES.find(example => example.id === id)
  if (!example) throw new Error(`Unknown shader-craft example: ${id}`)
  const program = programs[id as keyof typeof programs]
  const upstream = SHADER_CRAFT_PROVENANCE.upstream
  const credit = `/* Adapted from ${upstream.repository}, ${example.upstreamPath} at ${upstream.commit}.\n` +
    `${upstream.copyright}; ${upstream.license}. See LICENSE.\n` +
    `Scene and material formulas retained; Noisemaker bindings, final-only branches, fixed-seed sampling and seamless normalized-time motion.\n` +
    `Physical wave frequencies are quantized to integer loop harmonics; advection follows closed orbits. */\n`
  const definition: ShaderCraftExampleDefinition = {
    name: example.name, namespace: 'user', func: example.func, description: example.summary,
    tags: ['shader-craft', 'example', example.id], starter: true,
    uniformLayout: {
      resolution: { slot: 0, components: 'xy' }, time: { slot: 0, components: 'z' },
      aspectRatio: { slot: 0, components: 'w' }, seed: { slot: 1, components: 'x' },
    },
    globals: { seed: { type: 'int', default: 42, uniform: 'seed', min: 0, max: 65535 } },
    passes: [{ name: 'render', program: example.func, inputs: {}, outputs: { fragColor: 'outputTex' } }],
  }
  const glsl = bundleShaderSource(`#version 300 es
precision highp float;
precision highp int;
uniform vec2 resolution;
uniform float time;
uniform float seed;
out vec4 fragColor;
#define ZERO (min(int(seed), 0))
${credit}${program.glsl}`, 'glsl')
  const wgsl = bundleShaderSource(`struct Uniforms { data: array<vec4f, 2>, };
@group(0) @binding(0) var<uniform> uniforms: Uniforms;
var<private> resolution: vec2f;
var<private> time: f32;
var<private> seed: f32;
var<private> pixel: vec2f;
var<private> fragColor: vec4f;
var<private> ZERO: i32;
${credit}${program.wgsl}
@fragment fn main(@builtin(position) position: vec4f) -> @location(0) vec4f {
    resolution = uniforms.data[0].xy;
    time = fract(uniforms.data[0].z);
    seed = uniforms.data[1].x;
    ZERO = min(i32(seed), 0);
    pixel = position.xy;
    exampleMain();
    return fragColor;
}`, 'wgsl')
  return {
    example: { ...example }, definition, shaders: { glsl, wgsl },
    files: {
      'definition.js': `import { Effect } from '../../../src/runtime/effect.js'\n\nexport default new Effect(${JSON.stringify(definition, null, 2)})\n`,
      [`glsl/${example.func}.glsl`]: glsl.source,
      [`wgsl/${example.func}.wgsl`]: wgsl.source,
      LICENSE: SHADER_CRAFT_LICENSE,
    },
  }
}
