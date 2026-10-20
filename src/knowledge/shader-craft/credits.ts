// Technique credits for the shader-craft knowledge, from gokayfem/shader-skills
// CREDITS.md at e09bc993bf04201f26c03c87c89210e9b472f526. Sources are named by
// author and title rather than linked, so nothing here points the reader at a
// web address.

export interface ShaderCraftTechniqueCredit {
  /** What the technique is used for in the shader-craft knowledge and library. */
  technique: string
  /** The original source of the technique: author and title. */
  source: string
  /** The terms of the source, or how the technique was reimplemented, as upstream records it. */
  terms: string
}

export interface ShaderCraftCredits {
  /** The adapted work, its licence and its copyright line. */
  adaptedFrom: string
  /** How upstream treats third-party sources. */
  policy: string
  techniques: ShaderCraftTechniqueCredit[]
}

export const SHADER_CRAFT_CREDITS: ShaderCraftCredits = {
  adaptedFrom:
    'The shader-art-coding skill of shader-skills by gokayfem (gokayfem/shader-skills, commit ' +
    'e09bc993bf04201f26c03c87c89210e9b472f526, 2026-10-19), MIT licence, Copyright (c) 2026 gokayfem. ' +
    'Adapted for Noisemaker effects by Noise Factor.',
  policy:
    'All GLSL in shader-skills is an original implementation released under the MIT licence. The techniques come ' +
    'from the published work below. Numeric constants (matrices, fit coefficients, physical coefficients) are facts ' +
    'reproduced from their sources. No third-party shader source is copied; Shadertoy shaders default to ' +
    'CC BY-NC-SA 3.0, which is incompatible with MIT.',
  techniques: [
    {
      technique: 'SDF primitives, operators, smooth minimum, domain repetition, normals, soft shadows, intersectors, fog, palettes, filtered patterns, Voronoi borders, noise derivatives, domain warping',
      source: 'Inigo Quilez, articles on distance functions, smooth minimum, soft shadows, intersectors, fog, palettes, filtering and noise',
      terms: 'articles state no license; ideas reimplemented',
    },
    {
      technique: 'Chamfer, stairs and engrave combinators, polar and mirrored repetition',
      source: 'Mercury demogroup, hg_sdf',
      terms: 'MIT OR CC BY-NC 4.0',
    },
    {
      technique: 'PCG hashes (pcgHash, pcg3d, pcg4d) and hash quality data',
      source: 'Jarzynski and Olano, "Hash Functions for GPU Rendering", JCGT 9(3), 2020',
      terms: 'paper CC BY-ND 3.0; arithmetic reimplemented',
    },
    {
      technique: 'Interleaved gradient noise',
      source: 'Jorge Jimenez, "Next Generation Post Processing in Call of Duty: Advanced Warfare", SIGGRAPH 2014',
      terms: 'constants are facts',
    },
    {
      technique: 'R2 low-discrepancy sequence',
      source: 'Martin Roberts, "The Unreasonable Effectiveness of Quasirandom Sequences"',
      terms: 'constants are facts',
    },
    {
      technique: 'Curl noise',
      source: 'Bridson, Hourihan and Nordenstam, "Curl-Noise for Procedural Fluid Flow", SIGGRAPH 2007',
      terms: 'math',
    },
    {
      technique: 'Enhanced (over-relaxed) sphere tracing (documented, not shipped)',
      source: 'Keinert et al., "Enhanced Sphere Tracing", STAG 2014',
      terms: 'math',
    },
    {
      technique: 'AgX tonemapping (minimal polynomial version)',
      source: 'Troy Sobotka (AgX); Benjamin Wrensch / iolite (polynomial fit)',
      terms: 'MIT',
    },
    {
      technique: 'Khronos PBR Neutral tonemapping',
      source: 'Khronos Group, PBR Neutral tone mapper (KhronosGroup ToneMapping repository)',
      terms: 'Apache-2.0 (constants)',
    },
    {
      technique: 'ACES fitted (RRT+ODT)',
      source: "Stephen Hill, via MJP's BakingLab",
      terms: 'MIT',
    },
    {
      technique: 'Oklab / OkLCh',
      source: 'Bjorn Ottosson, "A perceptual color space for image processing" (Oklab)',
      terms: 'public domain / MIT',
    },
    {
      technique: 'Blackbody chromaticity',
      source: 'Krystek 1985 Planckian-locus fit',
      terms: 'math',
    },
    {
      technique: 'GGX, height-correlated Smith visibility, Schlick Fresnel',
      source: 'Filament documentation (Google)',
      terms: 'Apache-2.0 (formulas)',
    },
    {
      technique: 'Environment BRDF approximation',
      source: 'Brian Karis, "Physically Based Shading on Mobile" (after Lazarov)',
      terms: 'constants are facts',
    },
    {
      technique: 'Energy-conserving wrap lighting',
      source: 'Stephen Hill, "Righting Wrap" (2011)',
      terms: 'math',
    },
    {
      technique: 'Fast translucency',
      source: 'Barre-Brisebois and Bouchard, GDC 2011',
      terms: 'math',
    },
    {
      technique: 'Energy-conserving volume integration, sky constants',
      source: 'Sebastien Hillaire, Frostbite (SIGGRAPH 2015/2016) and "A Scalable and Production Ready Sky and Atmosphere Rendering Technique" (EGSR 2020)',
      terms: 'math, constants are facts',
    },
    {
      technique: 'Beer-Powder cloud lighting, dual-lobe phase',
      source: 'Andrew Schneider, Horizon Zero Dawn clouds (SIGGRAPH 2015)',
      terms: 'math',
    },
    {
      technique: 'Sun limb darkening',
      source: 'Neckel 1996',
      terms: 'constants are facts',
    },
    {
      technique: 'Cornette-Shanks phase function',
      source: 'Cornette and Shanks 1992',
      terms: 'math',
    },
    {
      technique: 'Simplex noise and its analytic gradient',
      source: 'Stefan Gustavson, "Simplex noise demystified" (2005); Gustavson and McEwan, "Tiling simplex noise and flow noise in two and three dimensions", JCGT 11(1), 2022',
      terms: 'papers; math reimplemented, the psrdnoise reference code is not used',
    },
    {
      technique: 'Flow noise (rotating gradients)',
      source: 'Perlin and Neyret, "Flow Noise", SIGGRAPH 2001 technical sketch',
      terms: 'math',
    },
    {
      technique: 'Turbulence',
      source: 'Ken Perlin, "An Image Synthesizer", SIGGRAPH 1985',
      terms: 'math',
    },
    {
      technique: 'Gradient-noise learning reference',
      source: "Ken Perlin, improved noise reference",
      terms: 'reference only; fixed-permutation Java code not copied',
    },
    {
      technique: 'Noise progression: fBm, ridges, cellular construction, domain warping',
      source: 'Gonzalez Vivo and Lowe, The Book of Shaders, chapters 12 ("Cellular Noise") and 13 ("Fractal Brownian Motion")',
      terms: 'explanatory sources; no source code copied',
    },
    {
      technique: 'External noise code catalog',
      source: 'Gustavson / Ashima, webgl-noise; Gustavson and McEwan, psrdnoise; Auburn, FastNoise Lite',
      terms: 'MIT alternatives named in the noise use-case reference; not vendored',
    },
    {
      technique: 'Billow terminology',
      source: 'libnoise Billow module documentation',
      terms: 'reference only; code not copied; the library\'s weighted [0,1] billow differs',
    },
    {
      technique: 'Hybrid terrain height and designed river composition',
      source: 'shader-skills, hybridTerrainHeight and the noise terrain map template',
      terms: "original MIT composition; not a claim to implement Musgrave's hybrid multifractal or hydrological erosion",
    },
    {
      technique: 'Sum-of-sines water with sharpened crests, deep-water dispersion',
      source: 'Mark Finch, "Effective Water Simulation from Physical Models", GPU Gems (2004), chapter 1',
      terms: 'math',
    },
    {
      technique: 'Filtering vanished normal detail into roughness',
      source: 'Toksvig, "Mipmapping Normal Maps" (2005); Olano and Baker, "LEAN Mapping" (I3D 2010)',
      terms: 'math',
    },
    {
      technique: 'Four-arc (Moss) egg',
      source: 'classical compass construction',
      terms: 'geometry',
    },
    {
      technique: 'Procedural building massing hierarchy',
      source: 'Müller et al., "Procedural Modeling of Buildings", SIGGRAPH 2006; SIGGRAPH 2011 course on urban modeling',
      terms: 'concepts reimplemented; not a CGA engine or copied grammar/code',
    },
    {
      technique: 'Filtered facade window coverage',
      source: 'Inigo Quilez, filterable procedurals / analytic footprint integration',
      terms: 'original periodic rectangle integral; no source copied',
    },
    {
      technique: 'Terrain representation and density/meshing distinction',
      source: 'Ryan Geiss, "Generating Complex Procedural Terrains Using the GPU", GPU Gems 3, chapter 1',
      terms: "explanatory source; the heightfield structures do not implement the chapter's meshing pipeline",
    },
    {
      technique: 'Finite-depth gravity-wave dispersion',
      source: 'MIT 2.20 Marine Hydrodynamics, lecture 20',
      terms: 'mathematical relation, original implementation',
    },
    {
      technique: 'Exact dielectric Fresnel and Beer-Lambert attenuation',
      source: 'Physically Based Rendering (PBRT), "Specular Reflection and Transmission" and "Transmittance"',
      terms: 'equations reimplemented; no PBRT source copied',
    },
    {
      technique: 'Coastal refraction pipeline comparison',
      source: 'GPU Gems 2, chapter 19, "Generic Refraction Simulation"',
      terms: 'reference for scene-buffer alternatives; the coastal structure traces a procedural heightfield instead',
    },
  ],
}
