// Adapted for Noisemaker effects from gokayfem/shader-skills skills/shader-art-coding/SKILL.md
// at e09bc993bf04201f26c03c87c89210e9b472f526 (MIT, Copyright (c) 2026 gokayfem).
// The licence text is in ./license.ts; the upstream record is ./provenance.json.

export const SHADER_CRAFT_WORKFLOW = `# Shader Craft for Noisemaker Effects

Writes, debugs and art-directs procedural Noisemaker effects: SDF raymarching, procedural buildings and cities, 2D
distance-field graphics, noise, fBm and domain warping, terrain, ocean and coastal water optics, clouds and other
volumes, PBR lighting, color and tonemapping. Builds on the shader-craft library of GLSL and WGSL building blocks, with
the bundleShader and checkShader commands. Adapted from the shader-art-coding skill in shader-skills by gokayfem
(MIT, Copyright (c) 2026 gokayfem); the technique credits are in SHADER_CRAFT_CREDITS.

Treat effect work as visual engineering: start from the intended image, choose the smallest mathematical model that
can produce it, build it in inspectable stages, and verify each stage with a debug view.

## Workflow

1. **Target.** State the image: subject, camera and framing, dominant forms, materials, light, motion, and what
   changes over one loop.
2. **Route.** Pick the rendering model and starting structure from the subject routing reference
   (\`shader-craft-subject-routing\`): 2D distance fields (posters, icons, patterns), SDF raymarching (objects,
   characters), heightfield marching (landscapes), volume integration (clouds, smoke, fire). Decide the passes: one
   program, or several passes with internal textures for blurs, state and feedback.
3. **Assemble from the library.** Find building blocks in the shader-craft library index references
   (\`shader-craft-library-*\`) and call them by name. Do not paste or re-derive library code; it is tested.
4. **First image fast.** Coordinates, background, one primitive, one light. Then add the debug views.
5. **Refine in order:** proportions, composition, material separation, lighting, atmosphere, color, antialiasing,
   performance.
6. **Bundle and check.** \`bundleShader\` inlines exactly the library functions each program uses, in GLSL and WGSL.
   \`checkShader\` lints the bundled programs. Fix every error, render both backends (\`setBackend\`), remove the
   agent-only controls, then deliver the effect.

## Conventions

- **Effect format:** a definition (globals, each with \`uniform:\` or \`define:\`; passes with \`program\`, \`inputs\`,
  \`outputs\` and \`repeat\`; internal \`textures\` for state) plus \`glsl/<program>.glsl\` and \`wgsl/<program>.wgsl\` for
  every program. Both backends render the same image; check the y direction when comparing them.
- **Coordinates:** \`vec2 uv = (2.0 * gl_FragCoord.xy - resolution) / resolution.y;\`, so one pixel is
  \`2.0 / resolution.y\`. The WGSL program does the same with its position builtin. A tile-aware program uses
  \`gl_FragCoord.xy + tileOffset\` and \`fullResolution\` in place of the pixel and \`resolution\`.
- **Time and loops:** \`time\` is a loop phase from 0 to 1, not seconds. The app sets the loop length (10 seconds by
  default) and the effect cannot read it. Drive motion with whole cycles per loop: \`sin(TAU * k * time)\` with
  integer k, and sample noise on a circle in time (\`vec2(cos(TAU * time), sin(TAU * time)) * radius\`). Every
  time-driven value must be equal at time 0 and time 1. \`frame\` counts frames, never wraps, and does not loop.
  Feedback and state textures carry earlier frames, so their output depends on history, not on time alone.
- **Art controls are globals:** every value a person should tune becomes a global. Use \`uniform:\` for values that
  move live and \`define:\` for choices that remove code (a \`define\` global compiles another program when it changes).
  Append new globals at the end, declare every uniform a program reads, and never name a global after an engine
  uniform (\`time\`, \`deltaTime\`, \`frame\`, \`resolution\`, \`aspect\`, \`aspectRatio\`, \`aspectInv\`, \`tileOffset\`,
  \`fullResolution\`, \`invFullResolution\`, \`renderScale\`).
- **Scene contract:** \`vec2 map(vec3 p)\` returns \`vec2(distance, materialId)\`. \`raymarch\`, \`calcNormal\`,
  \`softShadow\`, \`calcAO\` and \`sdfThickness\` all use it.
- **Debug views (agent-only):** while building, add a global \`debugMode\` with \`define: "DEBUG_MODE"\`, default 0,
  and \`choices: { final: 0, distance: 1, normals: 2, ids: 3, steps: 4, masks: 5, lighting: 6 }\` (distance field,
  normals, material or cell ids, step count, masks, lighting terms). Render each view you inspect and show it to the
  person. Remove the global and every \`DEBUG_MODE\` branch before delivery.
- **Color pipeline:** light in linear and decode picked colors with \`srgbToLinear\`. Then exposure, then the
  tonemap (\`tonemapAgX\` by default, per AA sample), then the average, then \`linearToSrgb\` once, then
  \`ditherTPDF\`. Treat a chain input (\`inputTex\` or a \`surface\` global) as display-encoded: decode it before lighting
  or averaging it, and encode once at the end.
- **Distances:** respect the \`@exact\` / \`@bound\` / \`@approx\` tags. If a deformation pushes Lipschitz above 1,
  divide the distance or lower the \`stepScale\` of \`raymarch\`.
- **Surfaces:** \`o0\` to \`o7\` belong to the person's program. A definition never hardwires them; it keeps state in
  its own \`textures\` or in \`global_*\` names.
- **Pruning:** the compiler runs every pass of every chain. Code you want gone is removed by a \`define\` global, or a
  pass is skipped with \`conditions.runIf\` / \`skipIf\`.

## Hard rules (these break Noisemaker effects)

- Follow the effect contract. The engine adds \`#version 300 es\`, precision and the define lines to every GLSL
  program and removes any version line in the source. Write \`out vec4 fragColor;\` and \`void main()\`, use
  \`texture()\`, and declare every uniform the program reads. The WGSL program returns \`@location(0) vec4<f32>\`.
- No \`?:\` on structs. Use \`vec2(distance, id)\` or \`if\`.
- Write float literals: \`2.0 * PI\`, \`clamp(x, 0.0, 1.0)\`. WGSL does not convert between integer and float types
  either.
- No \`fract(sin(...) * 43758.5453)\` hashes. Use \`hash12\` / \`hash22\` / \`hash33\` (integer PCG) from the shader-craft
  library. Replace them even when porting with "keep the look": the sine hash's exact pattern already differs
  between GPUs, and a PCG hash on the same integer cell ids gives the noise the same look. \`checkShader\` reports a
  sine hash as an error.
- Guard NaN sources: \`atan(0, 0)\`, \`pow\` of negatives, \`sqrt\` of negatives, \`normalize(vec3(0))\`.
- Keep \`dFdx\` / \`fwidth\` (WGSL \`dpdx\` / \`fwidth\`) out of non-uniform branches and loops, or use an explicit pixel
  size. WGSL rejects a derivative in non-uniform control flow when it compiles.
- Never hardwire \`o0\` to \`o7\` in a definition, and never name a global after an engine uniform.

## Reference routing

Read only what the task needs. Search with \`searchShaderKnowledge\` (category \`shader-craft\`) and read the matching
document; never load every reference at once.

| Document | Read when |
|---|---|
| \`shader-craft-subject-routing\` | starting from a subject ("a jellyfish", "mountains"); maps formal names to subjects |
| \`shader-craft-library-*\` | choosing functions: every shader-craft library function with exactness and uses, one document per module |
| \`shader-craft-sdf-library-guide\` | modeling: exactness tiers, blends, neighbor-checked repetition, deformation limits, GLSL and WGSL pitfalls |
| \`shader-craft-rendering-pipeline\` | lighting rigs, shadows/AO, sky and fog, volumes, tonemapping, AA, performance |
| \`shader-craft-noise-use-cases\` | choosing Perlin/value/simplex/cellular noise, fBm/ridged/billow/warp/hybrid recipes, game use cases and primary sources |
| \`shader-craft-procedural-buildings\` | parcel IDs, building massing, setbacks/roofs, facade filtering, city repetition and game integration |
| \`shader-craft-terrain-production\` | terrain representations, designed valleys, slope/altitude materials, tracing limits, chunks and LOD |
| \`shader-craft-water-quality\` | high-quality ocean/coastal water, wave derivatives, Fresnel/refraction/absorption, foam, presets and engine-side upgrades |
| \`shader-craft-shader-workflow\` | planning a complex effect end to end; review checklist |
| \`shader-craft-composition-and-debugging\` | the image reads poorly, or something is visually wrong |
| \`shader-craft-formula-cookbook\` | multi-step recipes: modular cell lattices, terrain synthesis, organic composition |
| \`shader-craft-formula-code-couples-sdf\` | equation-to-code for organic and modular SDF features |
| \`shader-craft-formula-code-couples-terrain\` | heightfields, density fields, accumulation, atmosphere |
| \`shader-craft-formula-code-couples-materials\` | masks, palettes, lighting terms, polish, motion |
| \`shader-craft-video-to-effect\` | recreating a reference video as an effect (a person's own agent only) |

The upstream skill ships render-verified starting shaders for these subjects: raymarched SDF scene, terrain, ocean,
volumetric clouds, 2D SDF poster, pattern swatches, noise progression, noise terrain map, procedural city, alpine
valley and coastal water. The subject routing reference names them as starting structures; build the equivalent
effect from the shader-craft library.

## Output expectations

When writing an effect:

- Deliver the effect: its definition plus the GLSL and WGSL source of every program, bundled with \`bundleShader\`
  and passing \`checkShader\`.
- Avoid textures unless the person provides them (a \`surface\` global or the chain input).
- Name the art controls as globals with ranges and defaults that already make a good image.
- Remove the agent-only controls (\`debugMode\` and any time-freezing control) and their branches before delivery.
- End with a short tuning guide in the conversation: which globals control scale, softness, color, light and
  motion.
- Say whether each program was checked and rendered, on which backends, and how.
- For buildings/terrain/water, separate implemented features from engine-side upgrades. Do not call a heightfield
  a cave generator, a material window a modeled recess, or a procedural foam/caustic mask a fluid/light simulation.
- For quality requests, state the target and budget, expose presets as a \`define\` global (for example \`quality\` with
  \`define: "QUALITY"\`), render every preset on both backends, and inspect rendered output. Preserve horizon/shore
  contact and temporal filtering before adding detail.

When improving an existing effect:

- Identify its rendering model and bottlenecks.
- Preserve its intent and interface: global names, order, ranges and defaults are the effect's DSL arguments.
- Fix correctness first, then readability, visual quality and speed.
- Call out risky changes (coordinate scale, material ids, loop counts, removed or renamed globals).

## Porting a Shadertoy shader into an effect

Only this section names the Shadertoy contract, to map an existing shader onto the effect format. The deliverable is
still an effect, never Shadertoy code.

- Check the licence first. Shadertoy shaders default to CC BY-NC-SA 3.0, which MIT code cannot absorb. Port only code
  whose licence allows it; otherwise reimplement the technique from its published source.
- \`mainImage(out vec4 fragColor, in vec2 fragCoord)\` becomes \`void main()\` writing \`out vec4 fragColor\`, with
  \`gl_FragCoord.xy\` in place of \`fragCoord\`. Write the WGSL program too.
- \`iResolution.xy\` becomes \`resolution\`. \`iTime\` (seconds) becomes \`time\` (a 0..1 loop phase): re-express every
  rate as whole cycles per loop. \`iFrame\` becomes the engine's \`int frame\`, which never wraps and does not loop.
- \`iChannel0\` and the other channels become pass inputs: the chain input \`inputTex\`, or a \`surface\` global. Buffer
  passes become effect passes with internal textures; a buffer that reads itself becomes a \`global_*\` feedback
  texture.
- \`iMouse\` has no engine equivalent; make the point it controls a global.
- \`#define\` constants a person should tune become globals: \`uniform:\` for live values, \`define:\` for choices that
  remove code.
- Replace \`fract(sin(...))\` hashes with the library's PCG hashes, as the hard rules require.
`
