import type { KnowledgeDocument } from '../vector-db.js'
import { SHADER_CRAFT_WORKFLOW } from './workflow.js'
import { SHADER_CRAFT_VIDEO_TO_EFFECT } from './video-to-effect.js'
import { SHADER_CRAFT_PROVENANCE } from './provenance.js'
import { LIBRARY_INDEX_OVERVIEW, LIBRARY_INDEX_MODULES } from './references/library-index.js'
import { COMPOSITION_AND_DEBUGGING } from './references/composition-and-debugging.js'
import { FORMULA_CODE_COUPLES_MATERIALS } from './references/formula-code-couples-materials.js'
import { FORMULA_CODE_COUPLES_SDF } from './references/formula-code-couples-sdf.js'
import { FORMULA_CODE_COUPLES_TERRAIN } from './references/formula-code-couples-terrain.js'
import { FORMULA_COOKBOOK } from './references/formula-cookbook.js'
import { NOISE_USE_CASES } from './references/noise-use-cases.js'
import { PROCEDURAL_BUILDINGS } from './references/procedural-buildings.js'
import { RENDERING_PIPELINE } from './references/rendering-pipeline.js'
import { SDF_LIBRARY_GUIDE } from './references/sdf-library-guide.js'
import { SHADER_WORKFLOW } from './references/shader-workflow.js'
import { SUBJECT_ROUTING } from './references/subject-routing.js'
import { TERRAIN_PRODUCTION } from './references/terrain-production.js'
import { WATER_QUALITY } from './references/water-quality.js'

export { SHADER_CRAFT_WORKFLOW } from './workflow.js'
export { SHADER_CRAFT_VIDEO_TO_EFFECT } from './video-to-effect.js'
export { SHADER_CRAFT_PROVENANCE } from './provenance.js'
export type { ShaderCraftProvenance } from './provenance.js'
export { SHADER_CRAFT_CREDITS } from './credits.js'
export type { ShaderCraftCredits, ShaderCraftTechniqueCredit } from './credits.js'
export { SHADER_CRAFT_LICENSE } from './license.js'
export {
  SHADER_CRAFT_LIBRARY,
  SHADER_CRAFT_LIBRARY_MODULES,
  SHADER_CRAFT_LIBRARY_PROGRAM_SYMBOLS,
  SHADER_CRAFT_LIBRARY_CONVENTIONS,
  getShaderCraftSymbolSource,
} from './library/index.js'
export type {
  ShaderCraftModuleName,
  ShaderCraftLanguage,
  ShaderCraftSymbolKind,
  ShaderCraftExactness,
  ShaderCraftLanguageSymbol,
  ShaderCraftParityTolerance,
  ShaderCraftLibrarySymbol,
  ShaderCraftLibraryModule,
  ShaderCraftProgramSymbol,
} from './library/index.js'

/** Category of every shader-craft knowledge document. */
export const SHADER_CRAFT_CATEGORY = 'shader-craft'

const UPSTREAM = SHADER_CRAFT_PROVENANCE.upstream
const REFERENCES = 'skills/shader-art-coding/references/'

// Each document names the upstream file it adapts and the original sources of
// the techniques it teaches. SHADER_CRAFT_CREDITS has the full table.
function source(path: string, techniques: string): string {
  return `shader-skills by gokayfem (${UPSTREAM.license}, ${UPSTREAM.copyright}), ${path} at ${UPSTREAM.commit}; ` +
    `techniques: ${techniques}`
}

function doc(
  id: string,
  title: string,
  content: string,
  path: string,
  techniques: string,
  tags: string[],
): KnowledgeDocument {
  return { id, title, content, category: SHADER_CRAFT_CATEGORY, source: source(path, techniques), tags }
}

const QUILEZ_SDF = 'Inigo Quilez (distance-function, smooth minimum and repetition articles)'

// Technique sources for each library module, from the upstream credits.
const LIBRARY_MODULE_SOURCES: Record<string, string> = {
  common: 'Inigo Quilez (shaping functions); rotation renormalized for GLSL ES precision (shader-skills)',
  hash: 'Jarzynski and Olano, "Hash Functions for GPU Rendering", JCGT 2020 (PCG hashes)',
  noise: 'Inigo Quilez (noise derivatives, domain warping, Voronoi borders, smooth Voronoi); Stefan Gustavson, ' +
    '"Simplex noise demystified"; Gustavson and McEwan (JCGT 2022); Perlin and Neyret, "Flow Noise"; Ken Perlin, ' +
    '"An Image Synthesizer" (turbulence); Bridson, Hourihan and Nordenstam (curl noise); Jorge Jimenez ' +
    '(interleaved gradient noise); Martin Roberts (R2 sequence)',
  pattern: 'Inigo Quilez (checkerboard filtering, filterable procedurals)',
  sdf3d: `${QUILEZ_SDF}`,
  sdf2d: `${QUILEZ_SDF}; classical four-arc (Moss) egg construction`,
  operators: `${QUILEZ_SDF}; Mercury demogroup, hg_sdf (chamfer, stairs and engrave combinators)`,
  domain: `${QUILEZ_SDF}; Mercury demogroup, hg_sdf (polar and mirrored repetition)`,
  architecture: 'Müller et al., "Procedural Modeling of Buildings" (SIGGRAPH 2006); Inigo Quilez (filterable procedurals)',
  raymarch: 'Inigo Quilez (normals, soft shadows, ambient occlusion)',
  intersect: 'Inigo Quilez (ray-surface intersectors)',
  camera: 'pinhole and thin-lens camera models (shader-skills)',
  shading: 'Filament documentation (GGX, Smith visibility, Schlick Fresnel); Brian Karis after Lazarov (environment ' +
    'BRDF); Stephen Hill, "Righting Wrap"; Barre-Brisebois and Bouchard (fast translucency)',
  water: 'Mark Finch, GPU Gems chapter 1; MIT 2.20 Marine Hydrodynamics lecture 20 (dispersion); Physically Based ' +
    'Rendering (dielectric Fresnel, Beer-Lambert)',
  color: 'Bjorn Ottosson (Oklab); Krystek 1985 (blackbody); Inigo Quilez (cosine palettes)',
  tonemap: 'Troy Sobotka and Benjamin Wrensch (AgX); Khronos Group (PBR Neutral); Stephen Hill via BakingLab (ACES fit)',
  volume: 'Sebastien Hillaire (Frostbite volume integration); Andrew Schneider (Horizon Zero Dawn clouds); Cornette and ' +
    'Shanks (phase function); Inigo Quilez (fog)',
  atmosphere: 'Sebastien Hillaire, "A Scalable and Production Ready Sky and Atmosphere Rendering Technique" (EGSR 2020); ' +
    'Neckel 1996 (limb darkening)',
  post: 'Martin Roberts (R2 sequence); shader-skills (TPDF dither, film grain, vignette)',
  debug: 'shader-skills debug-view convention',
}

const LIBRARY_DOCUMENTS: KnowledgeDocument[] = [
  doc(
    'shader-craft-library-index',
    'Shader-craft library index: modules and exactness tags',
    LIBRARY_INDEX_OVERVIEW,
    `${REFERENCES}library-index.md`,
    'see each library module document (shader-craft-library-*)',
    ['library', 'index', 'functions', 'exact', 'bound', 'approx', 'glsl', 'wgsl'],
  ),
  ...LIBRARY_INDEX_MODULES.map(({ module, summary, content }) => doc(
    `shader-craft-library-${module}`,
    `Shader-craft library: ${module} (${summary})`,
    `Shader-craft library index, module ${module}. Signatures are the upstream GLSL ones; the shader-craft library ` +
    `provides them in GLSL and WGSL and its own index is authoritative.\n\n${content}`,
    `${REFERENCES}library-index.md`,
    LIBRARY_MODULE_SOURCES[module] ?? 'shader-skills',
    ['library', module, 'functions'],
  )),
]

/** Every shader-craft knowledge document, searchable through searchShaderKnowledge. */
export const SHADER_CRAFT_DOCUMENTS: KnowledgeDocument[] = [
  doc(
    'shader-craft-workflow',
    'Shader craft workflow, conventions and hard rules for Noisemaker effects',
    SHADER_CRAFT_WORKFLOW,
    'skills/shader-art-coding/SKILL.md',
    'Jarzynski and Olano (PCG hashes); Troy Sobotka and Benjamin Wrensch (AgX); Inigo Quilez (SDF conventions)',
    ['workflow', 'conventions', 'hard rules', 'debug views', 'color pipeline', 'loop', 'porting'],
  ),
  doc(
    'shader-craft-subject-routing',
    'Subject routing: rendering models and building blocks by subject',
    SUBJECT_ROUTING,
    `${REFERENCES}subject-routing.md`,
    `${QUILEZ_SDF}; Mercury hg_sdf; Sebastien Hillaire; Andrew Schneider; Mark Finch (GPU Gems water); ` +
      'Bjorn Ottosson (Oklab)',
    ['routing', 'subject', 'characters', 'plants', 'landscape', 'buildings', 'materials', '2d', 'motion design'],
  ),
  doc(
    'shader-craft-shader-workflow',
    'Shader workflow: visual contract, layering order and review checklist',
    SHADER_WORKFLOW,
    `${REFERENCES}shader-workflow.md`,
    'the shader-skills workflow guidance',
    ['workflow', 'planning', 'layering', 'review', 'checklist', 'debug views'],
  ),
  doc(
    'shader-craft-composition-and-debugging',
    'Composition and debugging: debug views, failure modes and quality passes',
    COMPOSITION_AND_DEBUGGING,
    `${REFERENCES}composition-and-debugging.md`,
    'the shader-skills composition and debugging guidance; Inigo Quilez (distance-field inspection)',
    ['composition', 'debug', 'debug view', 'DEBUG_MODE', 'raymarch', 'sdf', 'normals', 'step count', 'failure modes'],
  ),
  doc(
    'shader-craft-sdf-library-guide',
    'Modeling with the shader-craft library: SDF exactness, blends, repetition and pitfalls',
    SDF_LIBRARY_GUIDE,
    `${REFERENCES}sdf-library-guide.md`,
    `${QUILEZ_SDF}; Mercury demogroup, hg_sdf; Jarzynski and Olano (PCG hashes); Stefan Gustavson (simplex); ` +
      'Perlin and Neyret (flow noise); Bridson, Hourihan and Nordenstam (curl noise); Ken Perlin (turbulence)',
    ['sdf', 'raymarch', 'modeling', 'smooth minimum', 'repetition', 'lipschitz', 'deformation', 'hash', 'pitfalls'],
  ),
  doc(
    'shader-craft-rendering-pipeline',
    'Rendering pipeline: lighting, shadows, sky and fog, volumes, tonemapping and antialiasing',
    RENDERING_PIPELINE,
    `${REFERENCES}rendering-pipeline.md`,
    'Inigo Quilez (soft shadows, AO, fog, filtered patterns); Filament documentation (GGX); Brian Karis (environment ' +
      'BRDF); Stephen Hill (wrap lighting, ACES fit); Barre-Brisebois and Bouchard (translucency); Sebastien Hillaire ' +
      '(volumes, sky); Andrew Schneider (clouds); Troy Sobotka and Benjamin Wrensch (AgX); Khronos Group (PBR ' +
      'Neutral); Bjorn Ottosson (Oklab); Krystek (blackbody); Neckel (limb darkening); Jorge Jimenez (interleaved ' +
      'gradient noise); Martin Roberts (R2); Keinert et al. (enhanced sphere tracing)',
    ['rendering', 'lighting', 'pbr', 'shadows', 'sky', 'fog', 'volumes', 'clouds', 'tonemap', 'agx', 'linear', 'srgb',
      'antialiasing', 'performance'],
  ),
  doc(
    'shader-craft-noise-use-cases',
    'Noise use cases: Perlin, Voronoi, simplex, fBm, domain warping, ridged, billow and hybrid recipes',
    NOISE_USE_CASES,
    `${REFERENCES}noise-use-cases.md`,
    'Ken Perlin (gradient noise, turbulence); Stefan Gustavson; Gustavson and McEwan (simplex, psrdnoise); Gonzalez Vivo and ' +
      'Lowe, The Book of Shaders chapters 12 and 13; libnoise (billow); Auburn, FastNoise Lite; Inigo Quilez (domain ' +
      'warping); Perlin and Neyret (flow noise)',
    ['noise', 'perlin', 'voronoi', 'simplex', 'fbm', 'domain warp', 'ridged', 'billow', 'hybrid', 'terrain', 'river'],
  ),
  doc(
    'shader-craft-procedural-buildings',
    'Procedural buildings and cities: parcels, massing, filtered facades',
    PROCEDURAL_BUILDINGS,
    `${REFERENCES}procedural-buildings.md`,
    'Müller et al., "Procedural Modeling of Buildings" (SIGGRAPH 2006); Aliaga, Wonka et al., SIGGRAPH 2011 urban ' +
      'modeling course; Inigo Quilez (filterable procedurals)',
    ['buildings', 'city', 'architecture', 'facade', 'windows', 'parcel', 'skyscraper', 'massing'],
  ),
  doc(
    'shader-craft-terrain-production',
    'Procedural terrain from silhouette to production: representations, fields, tracing, LOD',
    TERRAIN_PRODUCTION,
    `${REFERENCES}terrain-production.md`,
    'Ryan Geiss, GPU Gems 3 chapter 1; Inigo Quilez (noise derivatives, eroded fBm); The Book of Shaders chapter 13',
    ['terrain', 'heightfield', 'landscape', 'mountains', 'valley', 'snow', 'erosion', 'lod', 'tracing'],
  ),
  doc(
    'shader-craft-water-quality',
    'High-quality water: waves, dispersion, Fresnel, refraction, absorption, foam',
    WATER_QUALITY,
    `${REFERENCES}water-quality.md`,
    'Mark Finch, "Effective Water Simulation from Physical Models" (GPU Gems chapter 1); MIT 2.20 Marine ' +
      'Hydrodynamics lecture 20; Physically Based Rendering (Fresnel, transmittance); GPU Gems 2 chapter 19; Toksvig; ' +
      'Olano and Baker (LEAN mapping)',
    ['water', 'ocean', 'coast', 'waves', 'dispersion', 'fresnel', 'refraction', 'absorption', 'foam', 'caustics'],
  ),
  doc(
    'shader-craft-formula-cookbook',
    'Formula cookbook: modular cell lattices, heightfield synthesis, organic SDFs, clouds and composition',
    FORMULA_COOKBOOK,
    `${REFERENCES}formula-cookbook.md`,
    `${QUILEZ_SDF}; Inigo Quilez (fBm and domain warping); Jarzynski and Olano (PCG hashes)`,
    ['formulas', 'recipes', 'cell lattice', 'heightfield', 'organic', 'vegetation', 'clouds', 'volumetric',
      'composition'],
  ),
  doc(
    'shader-craft-formula-code-couples-sdf',
    'Formula-code couples: implicit geometry and SDF operators',
    FORMULA_CODE_COUPLES_SDF,
    `${REFERENCES}formula-code-couples-sdf.md`,
    `${QUILEZ_SDF}; Jarzynski and Olano (PCG hashes)`,
    ['sdf', 'formulas', 'primitives', 'smooth minimum', 'booleans', 'radial cells', 'organic', 'strands', 'cones'],
  ),
  doc(
    'shader-craft-formula-code-couples-terrain',
    'Formula-code couples: heightfields, density fields and atmosphere',
    FORMULA_CODE_COUPLES_TERRAIN,
    `${REFERENCES}formula-code-couples-terrain.md`,
    'Inigo Quilez (value noise interpolation, fBm octave rotation, fog); Jarzynski and Olano (PCG hashes)',
    ['terrain', 'heightfield', 'fbm', 'normals', 'shadow', 'fog', 'sky', 'coverage', 'clouds', 'instances',
      'accumulation'],
  ),
  doc(
    'shader-craft-formula-code-couples-materials',
    'Formula-code couples: materials, color, composition and polish',
    FORMULA_CODE_COUPLES_MATERIALS,
    `${REFERENCES}formula-code-couples-materials.md`,
    'Inigo Quilez (cosine palettes, antialiased masks); Troy Sobotka and Benjamin Wrensch (AgX); Khronos Group (PBR ' +
      'Neutral); Stephen Hill (ACES fit)',
    ['materials', 'color', 'masks', 'antialiasing', 'palette', 'lighting', 'tonemap', 'srgb', 'dither', 'loop',
      'motion'],
  ),
  ...LIBRARY_DOCUMENTS,
  doc(
    'shader-craft-video-to-effect',
    'Recreate a reference video as a Noisemaker effect',
    SHADER_CRAFT_VIDEO_TO_EFFECT,
    'prompts/video-to-shader-prompt.md',
    'the shader-skills video-to-shader workflow; closed-form springs, critically damped follow and ballistic motion',
    ['video', 'reference video', 'recreate', 'clip', 'footage', 'breakdown', 'timeline', 'renderAt',
      'setLoopDuration'],
  ),
]
