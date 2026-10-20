// Adapted for Noisemaker effects from gokayfem/shader-skills skills/shader-art-coding/references/shader-workflow.md
// at e09bc993bf04201f26c03c87c89210e9b472f526 (MIT, Copyright (c) 2026 gokayfem).
// The licence text is in ./license.ts; the upstream record is ./provenance.json.

export const SHADER_WORKFLOW = `# Shader Workflow

Use this workflow when creating or revising procedural effects.

## Contents

- 1. Visual Contract
- 2. First Visible Pass
- 3. Layering Order
- 4. Debug Views
- 5. Refinement Strategy
- 6. Review Checklist

## 1. Visual Contract

Before coding, define the image in operational terms:

- Subject: what the viewer should recognize first.
- Camera: orthographic, perspective, low angle, portrait, macro, wide heightfield, flythrough.
- Spatial model: 2D masks, heightfield, SDF scene, volumetric field, post effect (a filter on \`inputTex\`).
- Materials: matte, waxy, stone, subsurface, glass, metal, mist, density-field, painted ink.
- Composition: silhouette, foreground/midground/background, focal contrast, empty space.
- Motion: camera drift, object motion, environmental motion, and how each completes whole cycles in one loop.

If the person only gives a vague style, choose a small concrete scene and state it.

## 2. First Visible Pass

Make the effect visible before making it clever:

1. Normalize coordinates with aspect preservation.
2. Draw a background gradient or sky.
3. Add one primitive, mask, SDF, or height profile.
4. Add a single color ramp or diffuse light.
5. Confirm orientation and scale with debug colors.

The first pass should answer: "Is this the right visual family?"

## 3. Layering Order

Build in layers that can be debugged independently:

1. Domain and camera.
2. Large forms.
3. Repetition or variation IDs.
4. Secondary forms and cuts.
5. Material assignment.
6. Lighting and shadows.
7. Atmosphere and depth cues.
8. Surface detail.
9. Color grade and antialiasing.

For 3D SDF scenes, keep geometry and material ID decisions close together. For 2D drawings, keep masks named by visual role rather than math trick.

## 4. Debug Views

Add cheap debug modes while developing:

- Raw SDF distance as grayscale.
- \`abs(d)\` contour bands for surface inspection.
- Normal direction as \`0.5 + 0.5*n\`.
- Material ID as flat colors.
- Raymarch step count heatmap.
- Height/noise octave contribution.
- Masks for foreground, midground, atmosphere, and highlights.

Gate them behind an agent-only \`debugMode\` global with \`define: "DEBUG_MODE"\`, using the shader-craft numbering
(0 final, 1 distance, 2 normals, 3 ids, 4 steps, 5 masks, 6 lighting terms); see \`shader-craft-composition-and-debugging\`.
Render each view for the person while building, and remove the global and its branches before delivery.

## 5. Refinement Strategy

Refine from global to local:

- Proportions before details.
- Silhouette before material texture.
- Value structure before hue variation.
- Lighting direction before shadow polish.
- One noise layer before many octaves.
- Performance after the visual target is clear.

Avoid adding noise to hide weak structure. Noise should express a material or natural process.

## 6. Review Checklist

Before finalizing:

- The code has a clear coordinate/camera section.
- Art controls are globals with visual names, ranges and defaults; remaining constants have comments where useful.
- Loops are bounded and have escape conditions.
- Main objects read in silhouette.
- Materials differ in value, roughness, or lighting response, not only hue.
- The effect has antialiasing for sharp masks or edges.
- Lighting happens in linear color; picked colors are decoded with \`srgbToLinear\`.
- The final color is exposed, tonemapped (per AA sample), then encoded once with \`linearToSrgb\` and dithered.
- No sine hashes, no \`?:\` on structs, no hardwired \`o0\` to \`o7\`, no global named after an engine uniform.
- Every time-driven value is equal at time 0 and time 1 (whole cycles per loop).
- The GLSL and WGSL programs render the same image.
- The bundled programs pass \`checkShader\`.
- The agent-only debug and time controls are gone.
- The response explains the globals a person can tune.
`
