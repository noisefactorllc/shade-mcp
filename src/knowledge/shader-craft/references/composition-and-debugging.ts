// Adapted for Noisemaker effects from gokayfem/shader-skills skills/shader-art-coding/references/composition-and-debugging.md
// at e09bc993bf04201f26c03c87c89210e9b472f526 (MIT, Copyright (c) 2026 gokayfem).
// The licence text is in ./license.ts; the upstream record is ./provenance.json.

export const COMPOSITION_AND_DEBUGGING = `# Composition and Debugging

## Contents

- Composition Rules for Procedural Effects
- Debugging Ritual
- Formula Verification From Visual Sources
- Common Failure Modes
- Quality Passes
- Response Pattern

## Composition Rules for Procedural Effects

Make the image readable before making it detailed:

- Use one dominant silhouette or value mass.
- Reserve high contrast for the focal area.
- Separate foreground, midground, and background by value and saturation.
- Use atmosphere, scale, and texture frequency to show depth.
- Let repeated elements vary in size, color, angle, or phase.
- Keep large forms stable; animate small details unless the scene is about motion.

For bilateral organic carrier scenes (characters, creatures, faces, figurines):

- Establish dominant/secondary lobe proportions first.
- Use symmetry only as a starting point; break it with pose, anisotropic strands, shell layers, or expression parameters.
- Detail focal bilateral features more than distant or peripheral shapes.
- Use material contrast to separate subsurface, woven, filament, metallic, accumulation, or prop materials.

For heightfield scenes (landscapes, dunes, oceans):

- Build the heightfield silhouette first.
- Place the sun and horizon early.
- Use distance fog before adding tiny density-field details.
- Use instance/material IDs for variation but keep clump structure coherent.

For constructed objects (buildings, machines, tiled and modular props):

- Define the base primitive and repetition system.
- Keep local coordinates and cell IDs available for color variation.
- Add seams, interstitial fields, bevels, or edge wear after the major tiling reads correctly.

## Debugging Ritual

When an effect fails visually, inspect fields instead of guessing. While building, every effect declares an
agent-only global \`debugMode\` with \`define: "DEBUG_MODE"\` (default 0), so each view is a compiled variant you switch
from the DSL, and uses one numbering. Render the view you inspect and show it to the person. Remove the global and
every \`DEBUG_MODE\` branch before delivery.

| Mode | Shows | Library helper | Look for |
|---|---|---|---|
| 0 | final render | | |
| 1 | distance field / contours (2D slice through a 3D scene) | \`debugDistance(d)\` | wrong signs, kinked blends, bad scale |
| 2 | normals | \`debugNormal(n)\` | seams, noise, flipped faces |
| 3 | material / cell ids | \`debugIdColor(id)\` | lost ids, repetition errors |
| 4 | step count or depth | \`debugHeat(steps / maxSteps)\` | overshooting fields, wasted steps |
| 5 | masks / density | grayscale or RGB-packed masks | hard edges, noisy masks |
| 6 | lighting terms | key, fill, specular in R, G, B | missing shadows, AO on the sun |

Order of inspection: coordinates, raw field, ids, normals, steps, lighting terms, then re-enable composition in
layers. Do not debug a full shaded image when the broken term can be displayed directly. In a multi-pass effect,
inspect each pass's output on its own before judging the composite.

## Formula Verification From Visual Sources

When learning from a video, screenshot, or visual derivation, sample more than the final frame:

- Early frames reveal the primitive and coordinate system.
- Middle frames reveal IDs, local coordinates, repetition, and masking.
- Late frames reveal material, lighting, and detail breakup.
- Final frames often reveal temporal polish: subtle camera drift, procedural background blur, atmospheric motion, or tiny pose changes.
- Top-ranked code/formula frames often overrepresent final code, so also inspect chronological sheets.

Record the verified formula families, not copied source. For each family, capture:

- visual stage,
- coordinate space,
- scalar/vector field,
- IDs retained,
- visible debug output,
- final material/rendering use.

This prevents the common mistake of remembering the final image but missing the controllable formulas that built it.

## Common Failure Modes

- Aspect distortion: coordinates divide by \`resolution.x\` and \`resolution.y\` inconsistently.
- Dead noise: high-frequency noise is added before the large form works.
- Mushy SDFs: smooth unions use a radius larger than the feature scale.
- Lost material IDs: geometry distance and material assignment are separated incorrectly.
- Shadow acne: epsilon is too small or not scaled by hit distance.
- Flat composition: all objects have similar value and saturation.
- Expensive loops: nested fbm inside raymarching inside shadow calls.
- Temporal shimmer: noise or thresholds change abruptly with time or distance.
- Loop pop: a time-driven value is not equal at time 0 and time 1 (a non-integer cycle count, or noise sampled along a line in time instead of a circle).

## Quality Passes

Run these passes in order:

- Shape pass: show only silhouettes and major masks.
- Value pass: convert mentally to grayscale; focal contrast should survive.
- Material pass: each material should be identifiable under simple light.
- Light pass: key direction, fill, shadow softness, and rim are deliberate.
- Atmosphere pass: distance, scale, and depth are clear.
- Motion pass: animation has stable phase and loops seamlessly over the 0..1 time phase.
- Performance pass: reduce octaves, step counts, shadow calls, and repeated map evaluations.

## Response Pattern

When presenting an effect, include:

- What the effect renders.
- The definition and the GLSL and WGSL programs, or the precise patch.
- The debug views you rendered while building (removed from the delivered effect).
- Tuning knobs: the globals and what each controls.
- Performance notes if raymarching, fbm, shadows, or volumetrics are involved.
- Whether it was checked (\`checkShader\`) and rendered on both backends, and how.
`
