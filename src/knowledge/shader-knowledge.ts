import type { KnowledgeDocument } from './vector-db.js'
import { SHADER_CRAFT_DOCUMENTS } from './shader-craft/index.js'

export const TECHNIQUE_SYNONYMS: Record<string, string[]> = {
  noise: ['perlin', 'simplex', 'value noise', 'fbm', 'fractal', 'organic', 'procedural'],
  voronoi: ['cellular', 'worley', 'cell noise', 'cells', 'diagram'],
  kaleidoscope: ['mirror', 'symmetry', 'radial', 'polar', 'reflection'],
  blur: ['gaussian', 'smooth', 'bokeh', 'defocus', 'bloom'],
  distortion: ['warp', 'twist', 'bend', 'deform', 'displace'],
  feedback: ['delay', 'echo', 'trail', 'persistence', 'accumulate'],
  particle: ['points', 'agent', 'emit', 'flow', 'swarm'],
  gradient: ['ramp', 'color ramp', 'palette', 'colormap', 'interpolation', 'blend', 'mix'],
  sdf: ['signed distance', 'distance field', 'raymarching', 'shapes'],
  glitch: ['digital', 'error', 'artifact', 'corruption', 'databend'],
  wave: ['sine', 'cosine', 'oscillation', 'ripple', 'interference'],
  pattern: ['tiling', 'grid', 'mosaic', 'tessellation', 'repeat'],
  color: ['hue', 'saturation', 'brightness', 'hsv', 'hsl', 'palette', 'rgb', 'mix', 'lerp'],
  '3d': ['tunnel', 'perspective', 'raymarching', 'volumetric'],
  edge: ['sobel', 'contour', 'outline', 'detection'],
  film: ['grain', 'halftone', 'dither', 'scanline', 'retro'],
  fbm: ['fractal brownian motion', 'octaves', 'layered noise', 'turbulence'],
  simplex: ['perlin', 'gradient noise', 'coherent noise'],
  polar: ['radial', 'angle', 'atan', 'circular', 'spiral'],
  geometric: ['shapes', 'sdf', 'distance field', 'circle', 'polygon', 'grid'],
  spiral: ['vortex', 'swirl', 'rotation', 'twist'],
  animation: ['time', 'motion', 'movement', 'animate', 'loop', 'sin', 'cos', 'TAU'],
  flow: ['curl', 'vector field', 'advection', 'fluid', 'stream'],
  warp: ['distort', 'displacement', 'domain warping', 'deform'],
  rainbow: ['spectrum', 'hsv rotation', 'hue cycle', 'chromatic'],
  filter: ['post-process', 'image effect', 'inputTex', 'texture'],
  synth: ['generator', 'procedural', 'synthesizer'],
}

/**
 * Synonyms for the shader-craft references. They join TECHNIQUE_SYNONYMS only
 * on the searchShaderKnowledge path (SEARCH_SYNONYMS), so retrieveForAgent's
 * expansion stays as it was. The search has no stemming and matches keys and
 * synonyms as substrings, so these bridge spellings and plurals, and avoid
 * short words that hide inside others ("aces" in "spaces", "sea" in "search").
 */
export const SHADER_CRAFT_SYNONYMS: Record<string, string[]> = {
  tonemap: ['tone mapping', 'tonemapping', 'tonemapper', 'agx', 'exposure', 'hdr'],
  gamma: ['srgb', 'linear', 'lineartosrgb', 'srgbtolinear'],
  colour: ['color'],
  raymarch: ['raymarching', 'sphere tracing', 'sdf', 'step count'],
  'debug view': ['debug_mode', 'debugmode', 'debug views', 'step count', 'contours'],
  cloud: ['clouds', 'volumetric', 'cumulus', 'beer powder', 'scattering'],
  volumetric: ['volume', 'volumes', 'fog', 'smoke', 'scattering', 'participating media'],
  terrain: ['heightfield', 'landscape', 'mountains', 'valley', 'erosion'],
  mountain: ['mountains', 'terrain', 'ridged', 'heightfield'],
  landscape: ['landscapes', 'terrain', 'heightfield', 'mountains'],
  water: ['ocean', 'coast', 'coastal', 'shoreline', 'foam', 'underwater'],
  architecture: ['buildings', 'facade', 'skyscraper', 'massing', 'parcel'],
  hash: ['pcg', 'random', 'hash12', 'integer hash'],
  video: ['reference video', 'footage', 'video clip', 'reference clip'],
  character: ['characters', 'creatures', 'creature', 'bilobed'],
}

/** The synonyms searchShaderKnowledge expands with: the technique synonyms plus the shader-craft ones. */
export const SEARCH_SYNONYMS: Record<string, string[]> = { ...TECHNIQUE_SYNONYMS, ...SHADER_CRAFT_SYNONYMS }

export function expandQueryWithSynonyms(
  query: string,
  synonymTable: Record<string, string[]> = SEARCH_SYNONYMS,
): string {
  const lower = query.toLowerCase()
  const expanded = [query]
  for (const [key, synonyms] of Object.entries(synonymTable)) {
    if (lower.includes(key)) {
      expanded.push(...synonyms)
    }
    for (const syn of synonyms) {
      if (lower.includes(syn)) {
        expanded.push(key)
        break
      }
    }
  }
  return expanded.join(' ')
}

export const CURATED_KNOWLEDGE: KnowledgeDocument[] = [
  {
    id: 'dsl-basics',
    title: 'DSL Basics',
    content: 'The shader DSL uses function chaining.\n1. Search the namespace.\n2. Call the effect function with arguments.\n3. Write to the output buffer (o0).\n4. Render.\nExample: search synth\\nnoise(seed: 1).write(o0)\\nrender(o0)',
    category: 'dsl',
    tags: ['dsl', 'syntax', 'basics'],
  },
  {
    id: 'effect-definition-format',
    title: 'Effect Definition Format',
    content: 'Effects use definition.json or definition.js files in namespace directories. Each file specifies:\n- func: the camelCase name\n- namespace\n- description\n- globals: uniforms with type/min/max/default\n- passes: shader programs with inputs/outputs',
    category: 'effect-definition',
    tags: ['definition', 'format', 'structure'],
  },
  {
    id: 'glsl-uniforms',
    title: 'GLSL Uniform Wiring',
    content: 'Declare GLSL uniforms with names that match the globals section. Common system uniforms are resolution (vec2), time (float), and aspect (float). Custom uniforms use the uniform field from globals.',
    category: 'glsl',
    tags: ['glsl', 'uniforms', 'wiring'],
  },
  {
    id: 'noise-techniques',
    title: 'Noise Generation Techniques',
    content: 'Common noise types include:\n- Perlin: smooth gradient noise\n- Simplex: improved Perlin\n- Voronoi/Worley: cellular patterns\n- Value noise: interpolated random values\n- FBM: fractal Brownian motion with layered octaves\nUse the timeCircle pattern for loops without visible seams: vec2 tc = vec2(cos(time*TAU), sin(time*TAU)) * radius.',
    category: 'technique',
    tags: ['noise', 'perlin', 'simplex', 'voronoi', 'fbm'],
  },
  {
    id: 'sdf-techniques',
    title: 'Signed Distance Field Techniques',
    content: 'Signed distance fields (SDFs) define shapes by distance to the surface. Common operations are union (min), intersection (max), subtraction, and smooth blend (smin). Raymarching advances along a ray and checks the SDF distance. Common shapes are spheres, boxes, tori, and cylinders.',
    category: 'technique',
    tags: ['sdf', 'raymarching', 'distance field', 'shapes'],
  },
  {
    id: 'color-manipulation',
    title: 'Color Manipulation',
    content: 'HSV conversion: rgb2hsv/hsv2rgb. Color grading: lift/gamma/gain, temperature/tint. Palette generation: cosine gradient (a + b*cos(2*PI*(c*t+d))). Tone mapping: ACES, Reinhard. Blending modes: multiply, screen, overlay, soft light.',
    category: 'technique',
    tags: ['color', 'hsv', 'palette', 'grading', 'blend'],
  },
  {
    id: 'domain-warping',
    title: 'Domain Warping',
    content: 'Domain warping deforms UV coordinates before sampling: warpedUV = uv + noise(uv) * amount. Layered warping applies noise multiple times. Feedback warping uses the previous frame as the warp source. Domain warping creates organic, fluid patterns.',
    category: 'technique',
    tags: ['warp', 'distortion', 'domain', 'organic'],
  },
  {
    id: 'filter-effects',
    title: 'Filter Effect Patterns',
    content: 'Filter effects process an input texture (inputTex). They receive the previous pass output and modify it. Common filters: blur (gaussian kernel), sharpen, edge detection (Sobel), color grading, distortion. Declare inputTex in the pass inputs.',
    category: 'effect-pattern',
    tags: ['filter', 'input', 'processing', 'post-processing'],
  },
  {
    id: 'compute-shaders',
    title: 'Compute Shader Patterns',
    content: 'Compute shaders run on the GPU without rasterization. They support GPGPU tasks: particle simulation, cellular automata, and physics. Declare the pass type as "compute" or "gpgpu". Access storage buffers and textures directly.',
    category: 'technique',
    tags: ['compute', 'gpgpu', 'simulation', 'particles'],
  },
  {
    id: 'animation-patterns',
    title: 'Seamless Animation Patterns',
    content: 'For loops without visible seams, use timeCircle (cos/sin of time*TAU*radius). Avoid raw time in noise. Use periodic functions. For the Bleuje pattern, set t = fract(time). Animate properties with sin/cos of t*TAU. Use integer transitions with floor(t) for discrete changes.',
    category: 'technique',
    tags: ['animation', 'loop', 'seamless', 'time'],
  },
  {
    id: 'pipeline-architecture',
    title: 'Rendering Pipeline Architecture',
    content: 'The rendering pipeline processes passes sequentially. Each pass has inputs (textures from previous passes or external sources), outputs (render targets), and a shader program. The pipeline manages texture allocation, uniform propagation, and frame timing.',
    category: 'pipeline',
    tags: ['pipeline', 'architecture', 'rendering', 'passes'],
  },
  {
    id: 'common-errors',
    title: 'Common Shader Errors',
    content: 'Blank output: the shader does not write the output color, or the output variable name is wrong.\nStatic animation: time is not connected or the shader does not use it.\nMonochrome: the shader uses one channel without color mapping.\nCompilation errors: types do not match, variables lack declarations, or precision qualifiers are missing.',
    category: 'errors',
    tags: ['errors', 'debug', 'troubleshooting', 'fix'],
  },
]

/**
 * Everything searchShaderKnowledge indexes: the curated notes above plus the
 * shader-craft references. Both the MCP tool's database and the exported one
 * that Shade vendors are built from this list.
 */
export const SEARCHABLE_KNOWLEDGE: KnowledgeDocument[] = [...CURATED_KNOWLEDGE, ...SHADER_CRAFT_DOCUMENTS]
