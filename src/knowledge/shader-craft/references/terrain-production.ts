// Adapted for Noisemaker effects from gokayfem/shader-skills skills/shader-art-coding/references/terrain-production.md
// at e09bc993bf04201f26c03c87c89210e9b472f526 (MIT, Copyright (c) 2026 gokayfem).
// The licence text is in ./license.ts; the upstream record is ./provenance.json.

export const TERRAIN_PRODUCTION = `# Procedural terrain: silhouette to production

Start from the upstream alpine valley structure for a designed valley with ridged/eroded detail, altitude/slope
snow, rock strata, grass and aerial depth. Use the terrain structure for the physically based sky example, and the
noise terrain map structure for a top-down height/river map. Rebuild each as an effect from the shader-craft
library. These are heightfields, not arbitrary 3D geology.

## Contents

- Choose the representation
- Build independent fields
- Tracing and normals
- Materials and atmosphere
- Game integration and LOD
- Quality checks
- Sources

## Choose the representation

| Need | Representation | Cost / limitation |
|---|---|---|
| Mountains, valleys, dunes, islands | Heightfield \`y - h(xz)\` | One height per horizontal point; no caves or overhangs |
| Caves, arches, undercuts | 3D density / SDF composition | More sampling and stricter distance bounds; meshing needs an extraction stage |
| Interactive terrain in a game | Chunked mesh/clipmap generated from fields | Requires LOD, seams, normals, colliders, streaming and stable coordinates |
| Real drainage/erosion | Separate simulation or constrained graph | A noise warp does not compute sediment transport or connected drainage |

The GPU Gems 3 density-terrain chapter discusses a meshing pipeline. These structures raymarch fields in a
fragment program; they do not implement that chapter's marching-cubes extraction or GPU block streamer.

## Build independent fields

Choose the valley/canyon/island silhouette first. Add broad variation, then ridged or slope-damped detail. Reserve
river, road and settlement masks before adding high-frequency surface noise. Keep gameplay constraints independent
from aesthetic detail. A structure's coordinate scale and altitude are artistic scene units unless explicitly
declared in meters/kilometers. Expose the silhouette scale, relief and snow line as globals.

\`\`\`glsl
vec2 terrainPlanningFields(vec2 world) {
    float corridor = 1.0 - exp(-0.085 * world.x * world.x);
    float relief = 0.8 + 1.4 * erodedFbm(world * 0.3, 6);
    float elevation = 0.18 + max(relief, 0.1) * corridor;
    return vec2(elevation, 1.0 - corridor);
}
\`\`\`

The second channel is a planned lowland corridor. It is not guaranteed to drain downhill or connect to a river
outlet. See \`shader-craft-noise-use-cases\` for a deliberately designed river mask and the hybrid height helper.

\`erodedFbm\` damps detail using accumulated noise slope; it gives an eroded appearance without simulating erosion.
\`ridgedFbm\` emphasizes crests, while billow gives rounded lobes. Mix different roles rather than assigning all
octaves equal importance everywhere.

## Tracing and normals

\`p.y - h(p.xz)\` is a vertical gap, not a signed distance. A safe global conversion requires a bound \`L\` on the
height gradient: divide the gap by \`sqrt(1 + L*L)\`. An underestimated gradient bound can skip a thin ridge. The
upstream alpine example uses an artistic scale of 0.12 for secondary shadows/AO. It is not a proven global Lipschitz bound
for arbitrary noise amplitudes or warp strengths. Its primary intersection uses distance-proportional sampling
with 320 iterations and ten bisection steps after a crossing. That eliminates the small-gap tracer's horizon
stalling, but a sufficiently narrow feature can still be missed between coarse samples.

For strict intersection guarantees, derive bounds for every composition or use a bracketed/refined heightfield
tracer with a sampling resolution matched to the smallest feature. For coarse-to-fine traversal, use min/max
height pyramids or hierarchical bounds. Do not increase displacement amplitude without updating traversal.

Normals should come from the same field and filtering as geometry. Analytic \`gradientNoiseD\` derivatives are
useful when every transform's chain rule is included. Otherwise use a finite-difference epsilon proportional to
the world-space pixel footprint; a fixed tiny epsilon makes distant snow/rock shimmer.

## Materials and atmosphere

| Field | Material use | Important control |
|---|---|---|
| Altitude | Snow line, tree line, sediment bands | World units; add a small low-frequency breakup |
| Upward normal | Snow accumulation, grass on flats, exposed rock on steep faces | Smooth transitions instead of binary masks |
| Slope / aspect | Wetness, sun-exposed versus sheltered terrain | Use the geometric normal and consistent sun direction |
| Surface grain | Rock color, roughness and fine detail | Fade frequencies that fall below a pixel |
| Planned corridor | Grass valley, river or road reservation | Carve/flatten geometry separately from painting a mask |
| Distance / height fog | Atmospheric depth between ridges | Match fog to the sky; avoid a separate grey horizon strip |

The alpine structure uses analytic sky color and height fog for a compact reference. The terrain structure
demonstrates the more expensive physical atmosphere. Snow is a material mask in both; neither simulates accumulation, melting
or wind transport. Rock strata affect color, not geological layers of separate geometry.

## Game integration and LOD

- Derive coordinates from stable global/chunk IDs. Camera-relative rendering can improve precision, but the
  procedural seed and phase must stay tied to the world.
- Sample the same boundary coordinates on neighboring chunks. Skirts alone hide gaps but do not make different
  height samples agree. Shared edge samples, transition meshes or geomorphing are needed for correct LOD seams.
- Evaluate geometric displacement at the mesh's resolvable scale. Put smaller detail into filtered normal or
  roughness fields. Generate colliders at a suitable gameplay resolution, not necessarily render resolution.
- Bake static expensive masks when appropriate. Update terrain, biome, water, foliage and collision data together
  when the base field changes. A rendered effect is not an exported terrain asset.
- Heights alone do not guarantee navigability. Slope limits, road connectivity, playable areas and water outlets
  should be explicit constraints.

## Quality checks

Upstream's harness compiles and renders beauty plus elevation, normal, material and step-cost views; do the same
with the agent-only \`DEBUG_MODE\` views on both backends. Inspect foreground, silhouette, grazing views and multiple
camera positions (several \`renderAt\` times when the camera moves over the loop). No-NaN/nonblack rendering is a smoke test; it does not
prove intersection correctness or aesthetic quality. Inspect images after each field/lighting change.

For close views, add supersampling and shadow detail only after silhouettes and material separation read well.
For an engine, test across LOD transitions and chunk borders. For water/shore coupling, compare the actual surface
heights before choosing the visible material; sea-level altitude alone is insufficient when waves move.

## Sources

- Ryan Geiss, "Generating Complex Procedural Terrains Using the GPU", GPU Gems 3, chapter 1: density functions,
  caves/overhangs, GPU blocks and surface extraction; different from a simple heightfield.
- Inigo Quilez, "advanced noise" article (noise derivatives): derivative/slope-aware detail, credited by the
  library's \`erodedFbm\` implementation.
- The Book of Shaders (Gonzalez Vivo and Lowe), chapter 13 "Fractal Brownian Motion": octave composition and ridged
  shaping.

The structures compose original MIT library functions; no external shader source is copied.
`
