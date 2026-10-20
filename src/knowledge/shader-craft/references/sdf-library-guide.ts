// Adapted for Noisemaker effects from gokayfem/shader-skills skills/shader-art-coding/references/sdf-library-guide.md
// at e09bc993bf04201f26c03c87c89210e9b472f526 (MIT, Copyright (c) 2026 gokayfem).
// The licence text is in ./license.ts; the upstream record is ./provenance.json.

export const SDF_LIBRARY_GUIDE = `# Modeling With the Shader-Craft Library

How to build shapes and patterns with the shader-craft library: the scene contract, which distances can be trusted
for what, blending, repetition, deformation, noise, and the GLSL and WGSL pitfalls that break Noisemaker effects.

## Contents

- Workflow
- Coordinates and local spaces
- Exact, bound, approx
- Booleans and smooth blends
- Repetition
- Deformation, displacement and warps
- From 2D to 3D
- Noise and hashing
- Shaping functions
- GLSL and WGSL pitfalls
- Debugging fields

## Workflow

1. Find building blocks: search the \`shader-craft-library-*\` references (for example "petal leaf").
2. Write each program against library names (\`sdRoundCone\`, \`smin\`, \`fbm\`, \`softShadow\`, ...) without pasting them.
3. Bundle: \`bundleShader\` inlines exactly the library functions each GLSL and WGSL program uses, in declaration
   order, so the bundled program is the effect's source.
4. Check: \`checkShader\` lints the bundled programs for WebGL1 leftovers, sine hashes and the other hard-rule
   violations.

Scene contract for raymarching: define \`vec2 map(vec3 p)\` returning \`vec2(distance, materialId)\` (the same shape in
the WGSL program). \`raymarch\`, \`calcNormal\`, \`softShadow\`, \`calcAO\` and \`sdfThickness\` all call it. Combine objects
with plain comparisons:

\`\`\`glsl
vec2 map(vec3 p) {
    vec2 res = vec2(p.y, 1.0);                                  // ground, material 1
    float body = sdRoundCone(p - vec3(0.0, 0.3, 0.0), 0.35, 0.18, 0.6);
    if (body < res.x) res = vec2(body, 2.0);                     // material 2
    return res;
}
\`\`\`

## Coordinates and local spaces

- Screen: \`vec2 uv = (2.0 * gl_FragCoord.xy - resolution) / resolution.y;\` (y in [-1, 1], aspect preserved).
  One pixel is \`2.0 / resolution.y\` in these units.
- Move or rotate the point, never the shape: \`sdBox(p - center, size)\`, \`q.xz = rot2(angle) * q.xz\`.
  \`rot2(a) * v\` rotates v counter-clockwise by a. A hand-written \`mat2(c, -s, s, c)\` rotates the other way.
- Uniform scale keeps distances exact if you scale the result back: \`sdShape(p / s) * s\`.
  Non-uniform scale is only a bound: multiply by the smallest scale factor.
- Mirror for symmetry, then break it: \`p.x = abs(p.x)\` makes two eyes from one; add asymmetry after.

## Exact, bound, approx

Every SDF in the library is tagged and tested on the GPU (the upstream property tests):

| Tag | Meaning | Safe for |
|---|---|---|
| \`@exact\` | true Euclidean distance | marching, soft shadows, AO, offsets (\`opRound\`, \`opOnion\`), smooth blends with predictable width |
| \`@bound\` | never overestimates (Lipschitz <= 1) | marching (may take more steps), shadows; offsets come out uneven |
| \`@approx\` | exact surface, may overestimate | march with \`stepScale\` 0.7-0.8; avoid for offsets and onion shells |

Lipschitz constant L: how fast the field can change per unit of movement. Sphere tracing is safe only if L <= 1;
otherwise steps overshoot and punch holes or show striping. When L > 1 (displacement, warps, twist), either divide
the distance by L or pass \`stepScale = 1/L\` to \`raymarch\`.

## Booleans and smooth blends

- \`opUnion\` (min) is exact outside but too deep inside. \`opIntersect\` and \`opSubtract\` (max) are exact inside but
  underestimate outside. All are safe to march.
- When interior distances matter (inner-penumbra shadows, thickness, \`opOnion\` of a union), prefer an exact concave
  primitive: \`sdDeathStar\` (sphere minus sphere), \`sdCutHollowSphere\`, or 2D \`sdMoon\` / \`sdArc\` extruded or revolved.
- \`smin(a, b, k)\`: k is the blend width in distance units; shapes start blending when \`|a - b| < k\`, and the
  maximum bulge is \`k/4\`. Use \`sminCubic\` for close-up glossy surfaces (C2, no seam in highlights).
- \`sminBlend\` also returns a weight: use it to blend material colors across the join (skin into cloth, glaze into
  glaze), as the raymarched SDF scene structure does.
- Smooth unions are not associative. Blend in a fixed order (torso, then limbs, then details), and keep k smaller
  than the smallest feature being blended.
- \`opChamferUnion\`, \`opStairsUnion\`, \`opEngrave\` assume the surfaces meet at about 90 degrees. Keep r much smaller
  than the objects.

## Repetition

\`domRepeat(p, s)\` evaluates a single cell. That is exact only when every instance is identical and stays inside its
own cell. If instances vary (random height, radius, rotation, jitter), the nearest surface may belong to a neighbor
cell. Then you must check the neighbors on the side the point leans toward:

\`\`\`glsl
float sdPillarField(vec3 p, float spacing) {
    vec2 id = domRepeatId(p.xz, vec2(spacing));
    vec2 side = sign(p.xz - spacing * id);
    float d = 1e10;
    for (int j = 0; j < 2; j++)
    for (int i = 0; i < 2; i++) {
        vec2 cell = id + vec2(float(i), float(j)) * side;
        float h = mix(0.5, 2.0, hash12(cell));
        vec3 q = vec3(p.x - spacing * cell.x, p.y - h, p.z - spacing * cell.y);
        d = min(d, sdRoundBox(q, vec3(0.2, h, 0.2), 0.03));
    }
    return d;
}
\`\`\`

Polar repetition has the same rule. \`domPolar\` is exact for shapes symmetric about their sector's center line. For
asymmetric or varying petals, evaluate the sector and the neighbor p leans toward. \`domPolarPair\` returns both ids
and \`domPolarSector\` rotates into either one:

\`\`\`glsl
float sdPetalRing(vec2 p, float n) {
    vec2 ids = domPolarPair(p, n);
    float d = 1e10;
    for (int i = 0; i < 2; i++) {
        float k = (i == 0) ? ids.x : ids.y;
        vec2 q = domPolarSector(p, k, n);                  // this sector's center line on +X
        float len = 0.5 + 0.2 * hash11(k);                 // per-petal length
        d = min(d, sdUnevenCapsule(vec2(q.y, q.x - 0.15), 0.08, 0.02, len));
    }
    return d;
}
\`\`\`

Other repetition tools: \`domRepeatLimited\` (finite grids of windows, keys, posts), \`domRepeatMirror\` (neighbors
flipped so border-touching shapes join seamlessly), \`domFold\` (kaleidoscopes, KIFS fractals).

## Deformation, displacement and warps

| Operation | Lipschitz after the change | Fix |
|---|---|---|
| \`domTwist(p, k)\`, max radius R | \`L = a/2 + sqrt(1 + a*a/4)\`, a = kR | divide by L |
| \`domBend(p, k)\` | about \`1 + kR\` | divide by L |
| displacement \`d + A * n(p)\` | \`1 + A * Lip(n)\`; for \`sin(f x)\` terms Lip = f | stepScale = 1/L |
| domain warp \`d(p + A * w(p))\` | \`1 + A * Lip(w)\` | stepScale = 1/L; large warps fold space |

Get as close as possible with exact operations first, then add the smallest displacement that reads.

## From 2D to 3D

- \`opExtrude(p, d2(p.xy), h)\` turns any exact 2D shape into an exact slab: logos, coins, cookie cutters, petals with
  thickness.
- \`opRevolve(p, o)\` returns a 2D point for a profile: vases, bottles, chess pieces, mushrooms, wheels.
- \`opElongate(p, h)\` stretches a shape and keeps interior distances exact: \`sdSphere(e.xyz, r) + e.w\` is a capsule.

## Noise and hashing

- Hashes take integer-valued inputs (cell ids, pixel coordinates, frame numbers) and drop fractions, which avoids
  undefined negative float-to-uint conversion and the -0.0 vs 0.0 mismatch. Scale continuous values first.
- Never use \`fract(sin(dot(p, k)) * 43758.5453)\`: \`sin\` precision is undefined across GPUs, so the pattern changes
  between machines and degrades at large coordinates.
- Use noise in tiers: low frequency for silhouette and mass, mid for material breakup, high for grain. Do not use
  the same noise for shape, color and roughness. Offset or rotate the inputs so the controls stay independent.
- Picking a noise: \`gradientNoise\` / \`fbm\` for general use, \`simplexNoiseD\` for isotropic noise with a gradient (animate
  its rotation by \`TAU * k * time\` for flow noise that churns in place and loops), \`valueNoiseD\` / \`gradientNoiseD\` (2D and 3D) when you need
  analytic normals, \`erodedFbm\` for mountains, \`ridgedFbm\` for crests and veins, \`turbulence\` for creased fire and
  marble veins, \`billowFbm\` for puffy lobes, \`warpedFbm\` for marble and smoke, \`voronoi\` for cells and stones,
  \`voronoiBorder\` for constant-width cracks and leading, \`smoothVoronoi\` for soft organic cells, \`curlNoise\` (2D or
  3D) for divergence-free swirling flow.
- Keep coordinates bounded: float precision is about 0.001 at 1e4 and 0.008 at 1e5. \`time\` is already bounded to
  0..1; move through noise on a circle in time rather than along an ever-growing offset, and never feed \`frame\` into
  a coordinate.

## Shaping functions

The library's common module has the classic art-control curves: \`linearstep\`, \`cubicPulse\` (bands and rings), \`expImpulse\`
(impacts, heartbeats), \`gain\` (contrast around 0.5), \`parabola\` (petal and leaf width along length),
\`almostIdentity\` (soft floors). Name masks by their visual role (\`snowMask\`, \`rimMask\`) and show each as grayscale
before it drives color.

## GLSL and WGSL pitfalls

- No \`?:\` on structs (WebGL rejects it). Pack results into \`vec2\`/\`vec4\`, or use \`if\`. WGSL has no \`?:\`; use
  \`select\` or \`if\`.
- No implicit int to float: \`2 * PI\`, \`clamp(x, 0, 1)\` and \`sqrt(2)\` fail. Write \`2.0\`, \`0.0\`, \`1.0\`. WGSL does not
  mix integer and float variables either.
- \`mod(x, y)\` is floor-based (always >= 0 for y > 0); \`int()\` truncates toward zero, so floor before converting.
- \`round()\` at .5 is implementation-defined. Use \`floor(x + 0.5)\`.
- \`atan(y, x)\` is undefined at (0, 0); \`pow(negative, y)\`, \`sqrt(negative)\`, \`acos(|x| > 1)\`, \`log2(0)\` and
  \`normalize(vec3(0))\` produce NaN. Clamp or guard; one NaN poisons an AA average.
- \`smoothstep(e0, e1, x)\` with \`e0 >= e1\` is undefined in GLSL ES 3.00. Use \`1.0 - smoothstep(e1, e0, x)\`.
- \`dFdx\`/\`dFdy\`/\`fwidth\` are undefined inside non-uniform branches and loops, and WGSL's \`dpdx\`/\`dpdy\`/\`fwidth\`
  fail to compile there. Compute them before branching, or use an explicit pixel size (\`fillAA(d, px)\`).
- Large \`map()\` functions inlined into several loops can crash WebGL compilers. The library's GLSL loops start at
  \`ZERO\`, built from the engine's \`int frame\` uniform (\`min(frame, 0)\`), to prevent that; copy the trick into your
  own loops that call \`map\`, and declare \`uniform int frame;\`.
- The engine adds \`#version 300 es\`, precision and the define lines to every GLSL program and removes any version
  line in the source. Art controls are globals bound by \`uniform:\`; a debug or quality switch is a global with
  \`define:\` (for example \`define: "DEBUG_MODE"\`), which compiles a variant with the dead branches removed.
- Never name a global after an engine uniform (\`time\`, \`frame\`, \`resolution\`, \`aspect\`, ...): a pass uniform wins
  over the engine's value.

## Debugging fields

Use the shader-craft \`DEBUG_MODE\` convention (the library's debug module and \`shader-craft-composition-and-debugging\`):
\`0\` final, \`1\` distance field, \`2\` normals, \`3\` material ids, \`4\` step count, \`5\` masks, \`6\` lighting terms. The
\`debugMode\` global is agent-only: render the views while building and remove them before delivery.

- \`debugDistance(d)\` on a 2D slice through the scene reveals wrong signs, bad scale and kinked blends.
- \`debugHeat(steps / maxSteps)\` finds expensive regions and overshooting fields (bright speckle near edges).
- If a field is noisy in grayscale, it will be noisy after coloring. Fix the field, not the palette.
`
