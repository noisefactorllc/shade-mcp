// Adapted for Noisemaker effects from gokayfem/shader-skills skills/shader-art-coding/references/noise-use-cases.md
// at e09bc993bf04201f26c03c87c89210e9b472f526 (MIT, Copyright (c) 2026 gokayfem).
// The licence text is in ./license.ts; the upstream record is ./provenance.json.

export const NOISE_USE_CASES = `# Noise learning progression and use cases

A code-backed companion to the ten entries in the **Noise Learning Progression** reference image. The image is a
learning aid, not a specification: base noise, octave accumulation, coordinate transformations and material recipes
are different layers. Start with a scalar field, inspect it, then compose it for a particular subject.

## Contents

- Find the code
- What the labels mean
- Ten small recipes
- Putting it together
- Complete starting structures
- Tuning and production use
- Primary sources and external code

## Find the code

All implementations are in the shader-craft library's noise module (\`shader-craft-library-noise\`). Hashes come
from its hash module (\`shader-craft-library-hash\`). The snippets below call the tested library; bundle them with
\`bundleShader\` before use.

| Image entry | Library functions | Dimensions shipped | Practical use cases |
|---|---|---|---|
| Perlin noise | \`gradientNoise\`, \`gradientNoiseD\` | 2D, 3D | Broad hills, wind/weather masks, roughness breakup; analytic derivatives for normals |
| Voronoi noise | \`voronoi\`, \`voronoiBorder\`, \`smoothVoronoi\` | 2D | Rock plates, cracks, cell walls, stained glass, regions |
| Simplex noise | \`simplexNoise\`, \`simplexNoiseD\` | 2D | Ripples, flowing lava, animated surface detail; rotating gradients for churning flow |
| Fractal noise / fBm | \`fbm\`, \`erodedFbm\` | 2D, 3D fBm; 2D eroded | Multiscale terrain, cloud/dirt masks, rocky detail; slope-damped landscape detail |
| Domain warping | \`warpedFbm\` | 2D | Marble, agate, distorted cloud bands, alien terrain; use returned \`q\`/\`r\` for color |
| Value noise | \`valueNoise\`, \`valueNoiseD\` | 2D, 3D values; 2D derivatives | Cheap smooth masks, soft blotches; quantized coordinates for retro blocks |
| Cellular / Worley | \`voronoi\` F1/F2 and cell ID | 2D | Foam/cells, biome regions, scales, per-stone variation |
| Ridged noise | \`ridgedFbm\` | 2D | Mountain crests, canyons, veins, rocky heightfields |
| Billow noise | \`billowFbm\` | 2D, 3D | Puffy smoke, cumulus-like lobes, foam clumps, rounded terrain |
| Hybrid noise | \`hybridTerrainHeight\` | 2D | Bounded game heightmaps mixing broad hills, warped ridges and cellular detail |

Need a missing dimension, tiling, or different cellular metrics? See the external code table below. A 2D-only
function should not be advertised as a volumetric 3D implementation.

## What the labels mean

- **Perlin-style is gradient noise.** This library uses PCG-hashed gradients and a quintic interpolation curve;
  it does not reproduce the exact samples from Perlin's fixed-permutation reference implementation.
- **Voronoi and Worley overlap.** They describe the same nearest-feature-point family here, not two independent
  algorithms to add together. F1, F2, region IDs, F2−F1 and exact border distance produce different appearances.
- **fBm is an octave recipe**, not a separate base noise. More octaves add frequency bands; they do not add
  erosion, drainage, or a physically simulated cloud.
- **Domain warping transforms coordinates:** evaluate \`f(p + strength * warp(p))\`. It can distort any base field.
  A river-shaped mask or cave threshold still needs a separate shaping/carving step.
- **Simplex is not universally faster or smoother.** Lattice geometry and evaluation cost differ; benchmark the
  specific implementation, dimension and target GPU. Neither base algorithm automatically produces a layered cloud.
- **Value noise can be smooth.** The library interpolates random corner values with a quintic fade. Blocky values
  come from omitting interpolation or deliberately quantizing the coordinates.
- **Billow and ridges reshape signed noise per octave.** Taking \`abs\` after the entire fBm sum gives a different
  field. This library's billow also rounds lobes and weights later octaves.
- **Hybrid is a composition strategy.** \`hybridTerrainHeight\` is the library's artistic bounded mixture (from the
  upstream shader-skills repository). It is not an implementation of Musgrave's specific hybrid-multifractal
  recurrence.

## Ten small recipes

Each function is a separate usable recipe. Inputs are world/texture coordinates, not pixel coordinates.
\`bundleShader\` resolves all library dependencies. Samples intended as masks are clamped into [0,1]; height, density
and material values can then use their own units. Upstream compile-checks these examples with its references.
Recipes that take a \`time\` argument expect the 0..1 loop phase and loop seamlessly (see recipes 3 and 4).

### 1. Perlin-style: broad hills

Start with one octave so scale is easy to understand. A low frequency controls large landforms. Multiply the
returned value by the desired world-space height. Use \`gradientNoiseD\` when analytical slope is needed.

\`\`\`glsl
float studyBroadHills(vec2 world) {
    return clamp(0.5 + 0.7 * gradientNoise(world * 0.35), 0.0, 1.0);
}
\`\`\`

### 2. Voronoi: constant-width cracks

Use distance to the cell border, not just F2−F1, when a crack must keep a consistent width. \`pixelWidth\` and
\`crackWidth\` below are in cell-coordinate units. For a sample at \`world * 3.0\`, scale its footprint by 3 too.

\`\`\`glsl
float studyCracks(vec2 world, float crackWidth, float pixelWidth) {
    float border = voronoiBorder(world * 3.0, 0.85).x;
    float aa = max(pixelWidth * 3.0, 0.0001);
    return 1.0 - smoothstep(crackWidth - aa, crackWidth + aa, border);
}
\`\`\`

Mix a dark crack material with a per-cell rock color. Extruding or displacing this mask creates actual geometry;
the noise alone is only a scalar texture.

### 3. Simplex: churning water or lava

Rotate the lattice gradients to change the pattern in place. The \`.yz\` derivatives can perturb a normal. This is
flow-like animation; it does not solve fluid dynamics or conserve transported material. A rotation of
\`TAU * k * time\` with integer k turns every gradient a whole number of times per loop, so the surface loops
seamlessly.

\`\`\`glsl
vec3 studyChurningSurface(vec2 world, float time) {
    return simplexNoiseD(world * 2.0, 6.2831853 * 2.0 * time);   // two turns per loop
}
\`\`\`

The returned gradient is with respect to the scaled input. Multiply \`.yz\` by 2.0 for derivatives with respect to
\`world\`. Add more octaves explicitly if the surface needs multiple detail scales.

### 4. fBm: cloud coverage

Combine several frequency bands, then threshold the result into a coverage mask. For a volume, sample the 3D
\`fbm\` overload and multiply it by a height profile before integrating density and light. Upstream drifts the field
by \`time * 0.03\` seconds; with a 0..1 loop phase a linear drift pops at the seam, so drift around a small circle
instead.

\`\`\`glsl
float studyCloudCoverage(vec2 world, float time) {
    vec2 drift = 0.3 * vec2(cos(6.2831853 * time), sin(6.2831853 * time));
    float n = 0.5 + 0.5 * fbm(world * 0.8 + drift, 5);
    return smoothstep(0.43, 0.65, n);
}
\`\`\`

Use \`erodedFbm\` for a terrain-specific slope-damped look. Its result suggests erosion visually; it is not a
simulation of rainfall, sediment transport or drainage.

### 5. Domain warp: marble veins

Warp the field, then feed it into a band pattern. This gives controllable veins rather than assuming the warped
scalar itself looks like marble. Stronger warp and extra octaves cost more and can alias.

\`\`\`glsl
float studyMarbleVeins(vec2 world) {
    vec2 q, r;
    float field = warpedFbm(world * 1.2, 3.0, 5, q, r);
    float bands = 0.5 + 0.5 * sin(world.x * 4.0 + 8.0 * field);
    return smoothstep(0.25, 0.8, bands);
}
\`\`\`

Blend cream/charcoal materials with this mask. Use \`q\` and \`r\` separately for mineral color variation. The upstream
pattern swatches structure demonstrates a colored warped material.

### 6. Value: smooth masks and retro blocks

Compare the interpolated field against deliberately blocky cells. \`hash12\` takes integer cell IDs. The blocky
version is intentionally discontinuous and unsuitable for smooth geometric displacement.

\`\`\`glsl
vec2 studyValueVariants(vec2 world) {
    return vec2(valueNoise(world * 4.0), hash12(floor(world * 4.0)));
}
\`\`\`

Use the first channel for cheap roughness or weather masks; use the second for per-tile random colors, pixel art
or quick region prototypes. A hash and interpolated value noise have different spatial continuity.

### 7. Cellular / Worley: regions and foam

The same point distribution can drive several effects. \`voronoi(...).zw\` is a cell ID for stable region choices;
\`.x\` is F1, \`.y\` is F2. F2−F1 is useful for stylized boundaries but is not exact border distance.

\`\`\`glsl
vec3 studyCellularChannels(vec2 world) {
    vec4 cell = voronoi(world * 3.0, 0.85);
    float region = hash12(cell.zw);
    float foam = 1.0 - smoothstep(0.03, 0.16, cell.y - cell.x);
    return vec3(clamp(cell.x, 0.0, 1.0), foam, region);
}
\`\`\`

The fast 3×3 search is a neighborhood approximation; F2 can miss a candidate at high jitter, as documented on
\`voronoi\`. Use \`voronoiBorder\` for the library's two-pass boundary treatment. For Manhattan/Chebyshev metrics or
3D cellular fields, consult FastNoise Lite's implementation instead of silently reinterpreting Euclidean F1/F2.

### 8. Ridged: mountain crests

Use \`ridgedFbm\` as a terrain detail layer or as a thresholded vein mask. The inverted absolute-value construction
creates crests; octave weighting gathers fine detail along them.

\`\`\`glsl
float studyMountainCrests(vec2 world) {
    return ridgedFbm(world * 1.6, 6);
}
\`\`\`

Mix this with a lower-frequency base so every region is not equally mountainous. Displacement still needs normals,
bounded march steps and distance-dependent detail filtering.

### 9. Billow: puffy density

Use the 3D overload for a solid density field. Combine it with a vertical envelope and a threshold. The envelope
below is zero outside a chosen cloud layer; the result still needs volume integration to look like a cloud.

\`\`\`glsl
float studyPuffyDensity(vec3 world) {
    float layer = smoothstep(0.0, 0.4, world.y) * (1.0 - smoothstep(1.4, 2.0, world.y));
    return layer * smoothstep(0.08, 0.4, billowFbm(world * 0.9, 5));
}
\`\`\`

See the volumetric clouds structure in \`shader-craft-rendering-pipeline\` (Volumes) for a complete
lighting/integration pipeline; this recipe supplies an alternative density shape, not a replacement for that
pipeline.

### 10. Hybrid: a reusable terrain height

The library helper warps coordinates, combines broad fBm, ridged detail and cellular breakup, then clamps
the artistic height into [0,1]. It clamps octave count to [1,12] so zero octaves cannot divide by zero.

\`\`\`glsl
float studyHybridHeight(vec2 world) {
    return hybridTerrainHeight(world * 0.8, 5);
}
\`\`\`

This is a practical recipe with editable weights, not a universal definition of hybrid noise. Bake it into a game
heightmap or multiply it by a vertical scale for geometry. Biome/material masks should use slope as well as height.

## Putting it together

Build fields with separate jobs: broad hills for silhouette, ridges for mountains, cells for material breakup,
warping for less regular placement, and a shaped contour for a river. Adding every field with equal weight tends
to make a busy surface with no visual hierarchy.

\`\`\`glsl
vec2 studyTerrainAndRiver(vec2 world) {
    float height = hybridTerrainHeight(world, 5);
    float bend = 0.9 * fbm(vec2(world.y * 0.36, 2.7), 4);
    float riverDistance = abs(world.x - bend);
    float water = 1.0 - smoothstep(0.10, 0.175, riverDistance);
    height = mix(height, 0.19, water);
    return vec2(height, water);
}
\`\`\`

The river is a designed warped channel; it does not find downhill drainage. Noise cannot promise a traversable
game level, connected cave system or physically valid river network without additional constraints.

## Complete starting structures

The upstream skill ships these as render-verified template shaders; rebuild them as effects from the library.

- Noise progression: ten grayscale tiles, matching the table's order. Top row: gradient, Voronoi borders, simplex,
  fBm, marble warp. Bottom: smooth value, F2−F1 cellular, ridged, billow, hybrid height. White ticks identify
  columns 1–5. These are representative studies, not reconstructions of the image's exact random seeds or artistic
  treatment.
- Noise terrain map: a colored relief map with rocky elevations, slope-dependent material, a sandy bank and a carved
  turquoise river. Debug modes expose height, normals and the water mask.
- The terrain, volumetric clouds and pattern swatches structures show full terrain, cloud and material pipelines.

Bundle each program with \`bundleShader\`, run \`checkShader\` on the result, and render it on both backends.

## Tuning and production use

| Control | Effect | Starting point / caution |
|---|---|---|
| Input frequency | Feature size | Multiply coordinates; larger numbers make smaller features |
| Octaves | Number of detail bands | 4–6 to start; reduce distant or tiny detail; existing octave helpers expect at least 1 |
| Lacunarity | Frequency multiplier per octave | About 2; noninteger values and rotations reduce aligned repetition |
| Persistence | Amplitude multiplier per octave | About 0.5; larger values add roughness; do not feed negative/nonfinite values |
| Warp strength | Amount of coordinate displacement | 0 for comparison; about 1–3 for exploration; steep warps need filtering |
| Jitter | Cell irregularity | [0,1]; smaller is more regular; changing it moves feature points |
| Threshold / smoothstep | Occupancy and transition | Separate scalar fields from their masks; never use equal smoothstep edges |
| World-space scale | Geometric height or density | Keep normalized noise distinct from meters or extinction coefficients |

For normals, account for the input frequency in the chain rule. For raymarching, noise-displaced or warped fields
are generally not exact SDFs: bound derivatives or use conservative steps. For materials, evaluate colors in linear
space, tonemap HDR once, then encode to sRGB once. Grayscale previews here intentionally display normalized values
directly, so the scalar distributions remain easy to compare.

For games, evaluate in stable world/chunk coordinates to avoid seams, bake expensive static combinations when
appropriate, and use LOD for distant octaves. Do not assume this library's noise tiles at arbitrary periods. In an
effect, a field that never changes can be rendered into an internal texture by its own pass and sampled afterwards,
instead of being re-evaluated in every pixel of every frame.

## Primary sources and external code

The library stays original MIT code. These are primary sources and independently usable implementations, not
vendored dependencies. Preserve each project's notices if reusing its actual code; an article being readable does
not grant permission to copy its shader. Upstream checked these sources on 2026-10-18.

| Technique | Author-maintained source / actual code | Terms and role |
|---|---|---|
| Classic Perlin | Ken Perlin's improved-noise reference; Stefan Gustavson's classicnoise2D.glsl in webgl-noise | Perlin's page is the algorithm reference; webgl-noise code is MIT, with different sample values from this library |
| Simplex | webgl-noise noise2D.glsl; psrdnoise (Gustavson and McEwan) | MIT implementations; rotating/periodic and higher-dimensional variants differ from this library's API |
| Voronoi / Worley | Gustavson's cellular2D.glsl in webgl-noise; FastNoise Lite GLSL (Auburn) | MIT; cellular return modes and distance metrics vary |
| Value | FastNoise Lite GLSL (Auburn) | MIT; value and value-cubic implementations |
| fBm, ridges, warping | The Book of Shaders (Patricio Gonzalez Vivo and Jen Lowe), chapter 13 "Fractal Brownian Motion"; FastNoise Lite GLSL | Author-written explanation; MIT code alternative in FastNoise Lite; no book code copied |
| Cellular construction | The Book of Shaders, chapter 12 "Cellular Noise" | Author-written explanation of feature points, nearest distances and borders; no code copied |
| Billow | libnoise Billow module documentation | Explains absolute-value-per-octave billow; its signed/scaled output differs from this library's [0,1] weighted variant |
| Domain warp theory | Inigo Quilez, "Domain Warping" article | Existing library technique credit; chapter 13 above provides an accessible explanation |
| Hybrid composition | \`hybridTerrainHeight\` and the upstream noise terrain map | Original MIT example composing the cited primitives; no single canonical algorithm matches the image's generic label |

For external code covering multiple host languages, FastNoise Lite ships Perlin, value, cellular, fractal modes and
domain warping. Its OpenSimplex2 variants should not be described as the same implementation as classic simplex.
webgl-noise also ships classic and simplex 3D/4D variants. Their performance claims refer to their own code and
tests, not this library.
`
