// Adapted for Noisemaker effects from gokayfem/shader-skills prompts/video-to-shader-prompt.md
// at e09bc993bf04201f26c03c87c89210e9b472f526 (MIT, Copyright (c) 2026 gokayfem).
// The licence text is in ./license.ts; the upstream record is ./provenance.json.

export const SHADER_CRAFT_VIDEO_TO_EFFECT = `# Recreate a reference video as a Noisemaker effect

Follow the shader-craft workflow (\`SHADER_CRAFT_WORKFLOW\`) to recreate the reference clip below as a Noisemaker
effect: a definition plus a GLSL and a WGSL program for every pass. Multiple passes, internal textures and
feedback/state textures are available; nothing has to fit in one pass.

**Scope:** This workflow creates procedural interpretations of reference videos. It is not intended for
photographic-quality reproductions.

**Who runs this workflow:** a person's own coding agent, connected to the app's agent commands. Shade's in-app model
does not run it.

**App commands this workflow uses:**

- \`renderAt({ time, maxDimension, format })\` renders a fresh frame at normalized time \`time\` (0..1) and returns an
  image.
- \`setLoopDuration({ seconds })\` sets the loop length.
- \`setBackend({ backend: 'webgl2' | 'webgpu' })\` switches the rendering backend.
- \`checkShader\` runs the shader-craft checker on a program; \`bundleShader\` inlines the shader-craft library
  functions a program uses.

To sample the effect at second s of a clip of length L: call \`setLoopDuration({ seconds: L })\` once, then
\`renderAt({ time: s / L })\`.

Fill these in before starting (leave a line blank to let the agent measure it from the video):

- **Reference video:** \`<a path or link the person provides>\`
- **Effect name:** \`<func name>\` (the effect's DSL function name; the effect is \`user.<func>\`)
- **Must keep:** \`<the beats or objects you care about most, or blank>\`
- **Allowed to skip:** \`<anything you already know you do not want, or blank>\`
- **Target machine for fps:** \`<e.g. Apple M1, 1280×720>\`

The video is the spec. Nothing in this document describes its content; you derive all of it from the frames
(section 1) and get the breakdown approved before building.

## 0. Quality bar (read first; overrides anything below that conflicts)

This is a showcase piece. **Visual and motion quality outrank performance.** Report fps, but do not trade detail or
smoothness for speed without asking. Nothing is simplified without approval (section 9).

**Done means every check below passes.** A check that fails is listed as failing. It is never "good enough".

- **Motion**
  - Pose, speed and camera never jump at a transition. Prove it with 10-frame strips at 1/60 s spacing around each
    one: every change of gait or state (walk, run, stop, hop takeoff and landing, fall, turn), every camera move,
    and the loop seam. A frame at second s of the clip is \`renderAt({ time: s / L })\`.
  - Planted feet (or any contact: wheels, paws, hands) never slide. Prove it with a close-up strip of one full gait
    cycle per gait.
  - Gait phase is integrated (phase = ∫ speed / stride dt, computed analytically), so changing speed never jumps the
    phase.
  - Every state blends into the next: walk, run, stand and jump are weights eased over time, never 0/1 switches.
  - Secondary motion (hair, ears, cloth, tails, antennae, foliage) is spring-damped: it lags, overshoots and settles.
    Compute it analytically (damped responses to the body's acceleration events), so a fresh frame at any time
    shows it correctly. A state texture can integrate it instead, but its output then depends on the frames rendered
    before it, not on time alone, so a single \`renderAt\` frame cannot be trusted to show it; prove it on rendered
    sequences.
  - Jumps and thrown objects are ballistic under one gravity consistent with the scene's scale: anticipation squash,
    stretch on the rise, squash on contact, a settle afterwards. Bouncing objects lose height (restitution below 1),
    and their spin matches the distance they roll.
  - The camera follows with critical damping, computed analytically. Never stepped, never averaged samples, no
    jitter.
- **Detail**
  - At 1280×720, anything covering more than 10 % of the frame shows three levels: silhouette, secondary forms
    (folds, seams, ledges, lobes, clumps), and surface detail.
  - Close-ups at 4× zoom of every hero object: characters at 8 gait phases plus mid-action, and props, terrain and
    vegetation at near and mid distance.
- **Reference**
  - Every object is localized: list its visible parts (a flower has a head, stem and leaves; a tree has roots, trunk,
    limbs and a crown) and build each part. An object reduced to its most obvious part fails.
  - Colors are measured, not guessed: crop the same region in the reference and the render and compare mean RGB and
    spread (section 3). Report the numbers.
  - Every timeline row (section 1) has a side-by-side at the same time, with the remaining differences written down.
- **Backends**
  - The GLSL and WGSL programs render the same image: compare side-by-sides from both backends (\`setBackend\`) at the
    timeline rows.

**Process.** Work in milestones (section 7). After each milestone, critique your own renders against the reference,
fix the 5 biggest differences and re-render, at least 3 passes. Show the strips, close-ups and side-by-sides before
moving on. Judge motion as frame sequences; stills hide motion bugs. Do not stop or summarize while a check fails,
and do not invent content the video does not show.

---

## 1. Reference breakdown (do this first, then stop for approval)

Extract frames before writing any shader code. Draw the video into a canvas at exact times; upscaling first helps
inspection. Then write the breakdown in the conversation with the items below and get the person's approval there.
It is not a file in any repository.

1. **Clip facts:** duration L, resolution and aspect, cuts or one continuous shot, whether it loops.
2. **Shot timeline.** Sample every 0.5 s (finer around fast action). For each row: time, beat name, what the frame
   shows, and where the subject is (on what, doing what). Beats must later land within ±0.25 s.
3. **Object inventory.** For every object that is ever larger than about 2 % of the frame: its parts, shape language,
   size relative to a known reference (the main character's height is usually the best ruler), position relative to
   other objects, and the frames where it is best seen. Measure sizes and positions from several frames, and check
   that they agree.
4. **Character or subject sheet:** parts, proportions, colors, materials, and how each part moves (primary motion,
   secondary motion).
5. **Motion log:** speeds, gait (stride, cadence), pauses, jumps (takeoff, apex, landing times), and the props it
   interacts with, with times. Note where the timing is uneven (pauses, settling), since that is easy to miss.
6. **Camera log per beat:** position relative to the subject (behind, above, side; distance as subject heights),
   framing (subject size and position in frame), tilt, how it moves between beats (follows, holds, pulls back,
   rushes in), and an estimate of the field of view.
7. **Light and palette:** sun direction in frame terms, key, fill and shadow colors, sky gradient, fog or haze, and
   sampled sRGB values for the main surfaces (character parts, ground, vegetation, rock, sky top and horizon).
8. **Style notes:** the look (toon, stylized PBR, clay), edge softness, saturation, grade, bloom, depth of field.
9. **What you cannot reproduce exactly,** and the substitute you propose for each (section 9 decides).

## 2. Goal and priorities

- **Goal:** a real-time interpretation that reads as the same shot: the same beats at the same times, the same
  composition and camera moves, the same palette and light, believable motion.
- **Not the goal:** a pixel match. Offline-rendered references have millions of blades and leaves. Match the richness
  with clumped geometry near the camera and detailed shading farther away, not by dropping detail.
- **When you must trade off:** (1) smooth, physical subject and camera motion, (2) composition and timing,
  (3) object detail, (4) light and palette, (5) particles and atmosphere effects. Performance comes after all of
  these.

## 3. Comparison tooling (build it before the first milestone)

Keep it in your scratch space, never in the deliverable or in a repository. It costs an hour and saves days. The
renders come from \`renderAt\`; the tools only read the images it returns and the reference frames.

- **Frame viewer:** renders the effect at chosen times (\`renderAt\` after \`setLoopDuration({ seconds: L })\`), a crop
  or zoom of them, and a live view with an fps readout.
- **Side-by-side:** the reference frame and the render at the same time, full frame or the same crop.
- **Pixel measurement:** mean RGB and 10/50/90 percentiles over a cropped region in both images, filtered by a simple
  class test (green-dominant for grass and foliage, red over green over blue for soil).
- **Probe:** raw animation signals (subject root, feet, camera, props) sampled densely over time, flagging jumps and
  kinks, so every motion change can be shown to be smooth, or to have only the kinks that are physical (takeoff,
  contact). Read them from an agent-only debug view that writes the signals as colors.
- **Position readout:** world positions of the subject, camera and key props at given times, read back as floats
  from an agent-only debug view. Use it to reason about framing in numbers instead of by eye.
- **Diff and bench:** before/after image difference per beat, and a median frame time per beat, for any change that
  should not alter the look.

**Test the comparison before trusting it.** Mean colour per region can match while the picture is wrong: a flat grey
frame with the measured patch colours painted on passes a colour-only check.

- **Score renders that must fail.** Before milestone 2, run the comparison on a flat frame painted with the measured
  colours, a single frozen reference frame, and the reference frames shuffled in time. Any check that passes one of
  them is not measuring what it claims.
- **Add a layout signal.** Classify a coarse grid of cells (water, rock, foliage, …) by colour and report the share of
  cells that match the reference at each timeline row. Measure it on the reference itself first (two different
  shots; the same shot 1 s apart) so the number has a scale.
- **Optional: a fresh reviewer.** When your tool can start a subagent, have one with no access to the conversation
  or the source judge the side-by-sides against the section 0 checklist.

## 4. Scene construction

- **Model:** SDF raymarching (the raymarched SDF scene structure; borrow ground marching and fog from the terrain
  structure, see \`shader-craft-subject-routing\`). Scene contract \`vec2 map(vec3 p)\` returning
  \`vec2(distance, materialId)\`, with material ids as named constants. Split work into passes where it helps (for
  example a half-resolution volume or bloom pass on an internal texture).
- **Scale:** the main subject's height is 1 unit unless the breakdown says otherwise. Place everything from the
  measured relative positions, then tune against the side-by-sides.
- **Bounds and LOD:** a bounding volume around every object group; evaluate detailed SDFs only inside it, and blend
  the bound into the detail near its margin so the field stays continuous (soft shadows read the bound). Reduce noise
  octaves with distance. Cull distant set pieces per ray with \`iSphere\` or \`iBox\`.
- **Vegetation and ground cover:** near the camera, real clumps (a traced shell over the ground, for example);
  farther out, shading with patches and streaks. Flowers, bushes and trees are built from their parts (section 0).
- **Static data:** precompute anything constant per frame or per object (heights props stand on, rotations, hashes)
  as \`const\` arrays, regenerated by an agent-only debug view, never recomputed per marching step. Data too large for
  constants can be rendered once into an internal texture by its own pass.
- Assemble from the shader-craft library by name (search the \`shader-craft-library-*\` references). Never paste or
  re-derive library code, and respect the hard rules (no sine hashes, float literals, NaN guards, no derivatives in
  non-uniform loops or branches).

## 5. Animation

- Key the timeline in clip seconds and convert once: \`float T = time * CLIP_SECONDS;\`, where \`time\` is the engine's
  0..1 loop phase and \`CLIP_SECONDS\` is a named constant equal to L, the loop length set with
  \`setLoopDuration({ seconds: L })\`. The effect cannot read the loop length, so the constant carries it. While
  building, an agent-only \`START_TIME\` offset shifts the clip (\`T = mod(time * CLIP_SECONDS + START_TIME,
  CLIP_SECONDS)\`), and an agent-only \`FREEZE_TIME\` (≥ 0 freezes on that second) holds a pose; both are removed before
  delivery.
- Everything is computed analytically from \`T\`: keyed speeds integrated exactly, foot planting by phase, closed-form
  springs for secondary motion, ballistic arcs for jumps and props, and a camera follow solved in closed form.
  Evaluate the subject state once per pixel before marching, not inside \`map\`.
- Key the timeline to the breakdown: speed keys (time, speed, cadence), event times (jumps, contacts, interactions),
  and camera holds per beat. A pause on the reference (settling on a ledge, gathering for a jump) is part of the
  timing; reproduce it.
- Props that interact with the subject (balls, doors, ropes) are keyed relative to the subject, so retiming the
  subject keeps them in place.
- Anything that cycles inside the clip (a gait, a flag, water) completes a whole number of cycles over the loop, or
  is matched across the seam (section 6).

## 6. Camera, light and atmosphere

- **Camera:** a damped follow with per-beat holds and offsets taken from the camera log (pull-backs, holds, rushes,
  height changes), blended with smooth weights. Check framing numerically: subject height in frame and horizon line
  against the reference at every timeline row.
- **Light:** key direction and color from the breakdown, sky and bounce fill, soft shadows that never go black, AO.
- **Sky, clouds, haze, god rays, particles:** as the breakdown shows. Cheap 2D or analytic versions are fine where
  the reference treats them as background (section 9).
- **Pipeline:** linear lighting, exposure, a tonemapper chosen by comparing measured saturation with the reference,
  \`linearToSrgb\`, vignette if the reference has one, and \`ditherTPDF\`. The loop seam is clean (fade or matched end
  state): render \`time\` 0 and just under 1 side by side.

## 7. Milestones

1. **Breakdown and tooling** (sections 1 and 3). Stop for approval in the conversation.
2. **Blockout and timeline:** stand-in shapes for everything, the subject moving through every beat, the camera
   following. Check every timeline row with \`renderAt\` (or the agent-only \`FREEZE_TIME\`) against the reference.
3. **Motion:** final gait, states, secondary motion, jumps and prop interactions. Prove smoothness with strips and the
   probe.
4. **Subject detail:** the sculpted character or subject, close-ups at 8 phases plus mid-action.
5. **Environment detail:** every object built from its parts, matched by side-by-side and measured color.
6. **Light, color and atmosphere:** matched by sampled pixels.
7. **Reference pass:** walk every timeline row and every object again, and fix the biggest remaining differences.
8. **Performance pass:** keep the look. First exact changes (precomputation, tighter culling, skipping detail that
   cannot win a min or smax), verified by the diff tool to change nothing; then near-exact ones with their measured
   difference reported. Report per-beat times before and after, on both backends.

At every milestone, render the timeline times next to the reference, plus the strips and close-ups from section 0;
then critique, fix and re-render, at least 3 passes, before moving on.

## 8. Controls and deliverables

- **Controls while building:** an agent-only \`debugMode\` global with \`define: "DEBUG_MODE"\` (the shader-craft views,
  plus a timeline overlay, motion curves and raw motion signals), \`START_TIME\` and \`FREEZE_TIME\`. Remove all three
  and their branches before delivery.
- **Delivered controls:** globals for the art controls a person should tune (camera offsets and FOV, sun, palette,
  fog, timing keys where retiming makes sense), an \`AA\` and quality choice as \`define\` globals, and toggles for
  expensive features. Named constants hold the rest of the keyed timeline, including \`CLIP_SECONDS\`.
- **Deliverable:** the effect: its definition plus the GLSL and WGSL source of every program, each bundled with
  \`bundleShader\` and passing \`checkShader\`, rendering the same image on both backends. Report in the conversation:
  a tuning guide, the simplifications and why, the section 0 checklist marked pass or fail with its evidence,
  measured color matches, and fps per beat on each backend. The breakdown stays in the conversation; there is no
  separate shader file or reference document in a repository.

## 9. Simplifications

Allowed without asking: no depth of field, no motion blur; background clouds and birds as 2D layers; faces left
unmodelled when the reference never shows them.

Everything else needs approval first. That includes shading-only ground cover, decal-only props, fewer or simpler
background objects, dropping shadows or detail for speed, and any change to the timeline or camera that departs from
the reference.
`
