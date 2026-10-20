// Adapted for Noisemaker effects from gokayfem/shader-skills skills/shader-art-coding/references/water-quality.md
// at e09bc993bf04201f26c03c87c89210e9b472f526 (MIT, Copyright (c) 2026 gokayfem).
// The licence text is in ./license.ts; the upstream record is ./provenance.json.

export const WATER_QUALITY = `# High-quality water: surface, optics and integration

Start from the upstream coastal water structure for shallow water with a visible seabed and shoreline, and from the
ocean structure for open-water swell, filtered microdetail, curvature foam and atmospheric sun glitter; rebuild
either as an effect. Reusable wave/optics functions are in the shader-craft library's water module
(\`shader-craft-library-water\`). Quality depends on the target scene, resolution and rendering budget; there is no
single effect that is highest quality in every setting.

## Contents

- Choose a water target
- What the coastal structure implements
- Wave geometry and normals
- Optical paths
- Filtering, foam and caustics
- Quality presets and debug views
- Production upgrades
- Validation and sources

## Choose a water target

| Target | Start from | Features that matter most |
|---|---|---|
| Clear coast / lagoon | coastal water structure | Correct seabed intersections, refraction, depth absorption, shore contact |
| Open ocean | ocean structure | Wave spectrum, distance filtering, wide glints, whitecaps, atmosphere |
| Calm reflective lake | Coastal optics + low wave amplitudes | Reflected surroundings, low-frequency ripples, depth tint |
| River | Terrain corridor + flow-oriented waves | Surface slope, varying velocity, bank interaction, foam advection |
| Underwater view | Separate inside-medium camera path | Correct IOR direction, TIR, fog/scattering, shafts and surface underside |
| Film/export still | Quality 3 plus engine/path-tracer extensions, or accumulation over frames in a state texture | More samples, scene reflection/transmission, GI and coherent detail |

The coastal camera is above water. Changing its height to a negative value does not create a correct underwater
renderer: the medium, normal orientation, refraction ratio and absorption segments must be changed deliberately.

## What the coastal structure implements

- An animated sum of sine waves with analytic height, horizontal derivatives and Laplacian.
- Gravity-wave dispersion at a fixed 3 m reference depth. This avoids an incorrect spatially varying phase term;
  it is not bathymetric wave refraction/shoaling or a breaking-wave solver.
- Primary intersection against the higher of water and terrain, so exposed land occludes the water.
- A refracted ray to the same procedural seabed used by the primary scene, with optical path-length attenuation.
- A reflected ray to exposed land in quality 2/3; sky reflection in every preset.
- Exact unpolarized air-water Fresnel, GGX sun glints and separate reflected/transmitted contributions.
- RGB Beer-Lambert attenuation and an artistic approximation to in-scattered water-body light.
- Filtered fine waves, increased unresolved-wave roughness, shoreline/curvature foam, and an artistic seabed
  caustic pattern. These last terms are not simulated spray, transported foam, or photon-traced caustics.
- A bounded ray budget with a distant mean-water-plane fallback; waves far below pixel size become a smooth
  rough reflection instead of a broken sky/water checker pattern.

The primary/secondary tracer takes a distance-dependent minimum step and refines detected crossings by ten
bisection steps. This avoids grazing-angle stalls; it is a sampled heightfield method, not a proof that an
arbitrarily narrow changed feature cannot be skipped. Keep displacement and trace resolution consistent.

Land in this small scene is an analytic island heightfield. It is included to exercise reflected/refracted
geometry and shore contact, not to claim a photoreal island asset or a coupled coastal simulation.

## Wave geometry and normals

\`waterDispersion(k, depth, g)\` evaluates \`sqrt(g*k*tanh(k*depth))\`. \`waterWaveD\` returns
\`vec4(height, dh/dx, dh/dz, Laplacian)\` for one wave. Wavelength/amplitude/depth are meters, time is seconds,
gravity is m/s², and input direction is normalized internally. A zero direction uses +X.

**Seconds in an effect.** An effect sees only the 0..1 loop phase \`time\`. Expose a global for the loop's nominal
length in seconds (\`loopSeconds\`, default 10, the app's default loop) and pass \`time * loopSeconds\` as the wave
time (\`seconds\` below). A wave loops only when it completes a whole number of cycles per loop, so choose each wave's cycle count n
first: its angular frequency is \`TAU * n / loopSeconds\`, and its wavelength is the one whose dispersion gives that
frequency (deep water: \`k = omega * omega / g\`, wavelength \`TAU / k\`; finite depth: solve
\`omega * omega = g * k * tanh(k * depth)\` for k with a few Newton steps, once per wave). Every wave then repeats
exactly over the loop, whatever loop length the app sets; the motion speed is physical when \`loopSeconds\` matches
that length. The wavelengths in the sample below are upstream's; snap them this way before relying on a seamless
loop.

\`\`\`glsl
vec4 coastalWaveSample(vec2 worldXZ, float seconds, float pixelFootprintMeters) {
    vec4 swell = waterWaveD(worldXZ, seconds, vec2(0.8,0.6), 4.5, 0.075, 3.0, pixelFootprintMeters);
    vec4 chop = waterWaveD(worldXZ, seconds, vec2(-0.3,0.9), 1.2, 0.018, 3.0, pixelFootprintMeters);
    return swell + chop;
}
\`\`\`

Convert the summed slope to \`normalize(vec3(-dh_dx, 1, -dh_dz))\`. The analytic derivatives treat footprint as
constant locally. If amplitude, depth or direction varies with position, include the derivatives of that envelope
or phase, or use finite differences on the complete field. Applying spatial shoaling to height while ignoring it
in normals produces inconsistent glints.

Finite-depth dispersion alone does not solve shoaling, wave refraction around bathymetry, horizontal Gerstner
displacement or breaking. The upstream ocean structure uses a sharpened exp-sine profile rather than this sine
helper; those profiles should not be conflated.

## Optical paths

Use the refracted path to the bottom, not vertical water depth, for absorption. \`EXTINCTION\` is RGB extinction
per meter. Red attenuating faster than green/blue can give clear water its depth-dependent hue. Make it a \`vec3\`
global. The values in the upstream demo are artistic coefficients, not measured ocean-water data.

\`\`\`glsl
vec3 coastalOpticalMix(vec3 reflectedLight, vec3 bottomLight, vec3 scatterColor,
                     vec3 extinctionPerMeter, float refractedPath, float cosIncident) {
    float F = fresnelDielectric(cosIncident, 1.0, 1.333);
    vec3 T = beerTransmittance(extinctionPerMeter, refractedPath);
    vec3 transmittedLight = bottomLight * T + scatterColor * (1.0 - T);
    return reflectedLight * F + transmittedLight * (1.0 - F);
}
\`\`\`

This is a compact radiance composition with approximate scattering, not a full participating-medium integrator.
The bottom's sunlight is also attenuated along its light path in the coastal structure. Environment reflection, direct sun
specular and foam remain separate so they can be inspected for double-counting and tuned deliberately.

For total internal reflection use \`fresnelDielectric(cosIncident, 1.333, 1.0)\` when the incident medium is water.
The helper returns 1 above the critical angle. Do not blindly use the above-air eta ratio for underwater rays.

## Filtering, foam and caustics

Remove geometric/normal waves as their wavelengths approach 2–6 pixel footprints. Add unresolved slope energy to
roughness rather than leaving subpixel normals active. The coastal structure uses a compact roughness ramp; the
open-ocean structure has more detailed directional footprint and lost-slope-variance tracking.

Shore foam compares moving surface height against the seabed and uses a patterned shallow band. Crest foam uses
negative Laplacian as an artistic coverage cue. Both are instantaneous fields. A production foam system should
advect, accumulate and decay foam, with separate spray if required; in an effect, that history lives in a
\`global_*\` state texture updated by its own pass, and then depends on earlier frames rather than on time alone.

The bright seabed pattern is filtered and attenuated by depth/light direction, but it is not generated from the
surface-to-bottom refraction Jacobian. For physically meaningful caustics, use photon mapping, refracted light
tracing or a controlled projected-caustic method that accounts for energy/area changes.

## Quality presets and debug views

Make the preset a \`define\` global (\`quality\` with \`define: "QUALITY"\`), so each preset compiles without the code
the others need.

| \`QUALITY\` | Samples / waves / primary iteration cap | Reflection |
|---|---|---|
| 1 | 1 / 8 / 180 | Sky only; still traces refraction to seabed |
| 2 (default) | 1 / 8 / 180 | Sky plus exposed-land ray |
| 3 | 4 / 12 / 240 | Sky plus exposed-land ray; more surface detail and AA |

These are budgets, not promised FPS. Upstream's harness renders all three presets on the current GPU and in CI;
render each preset on both backends. Secondary rays use the same bounded iteration cap. Four samples are useful for
a still but do not equal a converged path-traced image. More waves change detail, not the underlying fluid model.

Agent-only \`DEBUG_MODE\` views: 1 optical path, 2 water normals, 3 foam, 4 primary cost, 5 Fresnel, 6 RGB
transmittance. Render every preset and every debug view while building, then remove the debug views before
delivery. Diagnostic masks can be legitimately mostly black; checking for NaN still matters.

## Production upgrades

| Goal | Add beyond the coastal structure (extra passes and state textures in the effect cover some of these) |
|---|---|
| Large wind-driven ocean | Measured/specified spectral model, FFT cascades, stable patch blending and floating origin |
| Hero breaking surf | Coupled shallow-water/fluid simulation, displacement/velocity fields, foam transport and spray |
| Reliable scene reflections | Ray tracing or planar reflection plus SSR/probe fallbacks, rough-reflection filtering |
| Temporal stability | Jittered sampling, motion vectors, history rejection, TAA/accumulation and exposure control |
| Underwater realism | Medium-aware ray segments, multiple scattering approximations, shafts and surface underside |
| Interactive shores | Scene-depth intersections, object displacement, wetness/foam history and bathymetry coupling |
| Export-quality film | More samples and light bounces, spectral/volume treatment when needed, denoising and measured validation |

Pick improvements from the target and budget rather than turning every setting up. “Highest quality” needs a
reference image, target resolution/frame time and host renderer to be a measurable requirement. The skill should
state which of these features are actually implemented whenever proposing a production water solution.

## Validation and sources

GPU properties check wave derivatives against finite differences, Laplacian identity, dispersion limits, Fresnel
normal incidence/reciprocity/TIR, and attenuation bounds/zero path/composition over segments. Images are also
inspected for shore leaks, missing horizon samples, aliasing and reflected-land placement.

- Mark Finch, "Effective Water Simulation from Physical Models", GPU Gems, chapter 1: wave sums, analytic
  normals, surface detail and Gerstner alternatives.
- MIT 2.20 Marine Hydrodynamics, lecture 20: finite-depth gravity-wave dispersion and deep/shallow limits.
- Pharr, Jakob and Humphreys, Physically Based Rendering (4th edition), "Specular Reflection and Transmission" and
  "Transmittance": dielectric Fresnel and Beer attenuation.
- GPU Gems 2, chapter 19, "Generic Refraction Simulation": scene-buffer refraction as an engine-side alternative; not
  the ray-to-heightfield method used here.

All library implementations are original MIT code, with technique credits in SHADER_CRAFT_CREDITS.
`
