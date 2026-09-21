/**
 * DSL Exemplar Programs and Patterns
 *
 * Canonical scaffolding patterns and curated example programs
 * for DSL jam mode. Programs sourced from Noisedeck basics and classic collections.
 */

// ═══════════════════════════════════════════════════════════════════════════
// CANONICAL DSL SCAFFOLDING PATTERNS
// ═══════════════════════════════════════════════════════════════════════════

export const DSL_EXEMPLAR_PATTERNS = `
## Canonical DSL Scaffolding Patterns

These patterns are MANDATORY. Always use the pattern for the given effect type.

### Points (particle systems)
\`\`\`
search points, synth, render
noise().pointsEmit().physical().pointsRender().write(o0)
render(o0)
\`\`\`

### Billboard Particles (textured particles)
\`\`\`
search points, synth, render
polygon(radius: 0.7, fgAlpha: 0.1, bgAlpha: 0).write(o0)
noise(ridges: true)
  .pointsEmit(stateSize: x64)
  .physical()
  .pointsBillboardRender(tex: read(o0), pointSize: 40, sizeVariation: 50, rotationVariation: 50)
  .write(o1)
render(o1)
\`\`\`

### Feedback Loop
\`\`\`
search synth, filter, render
noise(ridges: true)
  .loopBegin(alpha: 95, intensity: 95)
  .warp()
  .loopEnd()
  .write(o0)
render(o0)
\`\`\`

### 3D Volumetric
\`\`\`
search synth3d, filter3d, render
noise3d(volumeSize: x32).write3d(vol0, geo0)
read3d(vol0, geo0).render3d().write(o0)
render(o0)
\`\`\`

### Mixer (two-source blend)
\`\`\`
search synth, mixer
noise(seed: 1).write(o0)
gradient().blendMode(tex: read(o0), mode: multiply).write(o1)
render(o1)
\`\`\`

### Simple Starter
\`\`\`
search synth
noise(octaves: 4, ridges: true).write(o0)
render(o0)
\`\`\`

### Filter Chain
\`\`\`
search synth, filter
noise(ridges: true).blur(radiusX: 5).bloom(taps: 15).vignette().write(o0)
render(o0)
\`\`\`

### RULES
1. ALWAYS wrap points effects with pointsEmit()/pointsRender().
2. Put the sprite for billboard particles on a SEPARATE surface.
3. ALWAYS end 3D effect chains with render3d().
4. ALWAYS chain filters from a generator. Never use filters alone.
5. ALWAYS supply a tex: read(surface) parameter to mixers.
6. Put filter effects between loopBegin()/loopEnd() in feedback loops.
7. Always use noise() as the default starter. Set ridges: true for visual interest.
`

// ═══════════════════════════════════════════════════════════════════════════
// EXEMPLAR PROGRAM TYPE
// ═══════════════════════════════════════════════════════════════════════════

export interface ExemplarProgram {
  name: string
  dsl: string
  tags: string[]
  description: string
}

// ═══════════════════════════════════════════════════════════════════════════
// EXEMPLAR PROGRAMS
// ═══════════════════════════════════════════════════════════════════════════

export const DSL_EXEMPLAR_PROGRAMS: ExemplarProgram[] = [
  // ── Basics (all 8) ──────────────────────────────────────────────────────

  {
    name: 'background',
    dsl: 'search classicNoisedeck\n\nbackground(backgroundType: 10, rotation: 0, opacity: 100, color1: #000000, color2: #ffffff).write(o0)\nrender(o0)',
    tags: ['classic', 'basics', 'background', 'simple'],
    description: 'Simple background generator with two-color gradient',
  },
  {
    name: 'bit effects',
    dsl: 'search classicNoisedeck\n\nbitEffects(loopAmp: 50, formula: 0, n: 1, colorScheme: 20, interp: 0, scale: 75, rotation: 0, maskFormula: 10, tiles: 5, complexity: 57, maskColorScheme: 1, baseHueRange: 50, hueRotation: 180, hueRange: 25).write(o0)\nrender(o0)',
    tags: ['classic', 'basics', 'bitEffects', 'simple', 'math-art'],
    description: 'Bit manipulation math art with masked formula patterns and custom color scheme',
  },
  {
    name: 'cell noise',
    dsl: 'search classicNoisedeck\n\ncellNoise(scale: 75, cellScale: 87, cellSmooth: 11, cellVariation: 50, loopAmp: 1, colorMode: 0, palette: 0, cyclePalette: 1, rotatePalette: 0, repeatPalette: 1, paletteMode: 4).write(o0)\nrender(o0)',
    tags: ['classic', 'basics', 'cellNoise', 'simple', 'voronoi'],
    description: 'Voronoi cell noise with smoothed cell boundaries and cycling palette',
  },
  {
    name: 'fractal',
    dsl: 'search classicNoisedeck\n\nfractal(fractalType: 0, zoomAmt: 0, rotation: 0, speed: 30, offsetX: 70, offsetY: 50, centerX: 0, centerY: 0, iterations: 50, colorMode: 4, palette: dealerHat, cyclePalette: 0, rotatePalette: 0, hueRange: 100, levels: 0, backgroundColor: #000000, backgroundOpacity: 100, cutoff: 0).write(o0)\nrender(o0)',
    tags: ['classic', 'basics', 'fractal', 'simple', 'mandelbrot'],
    description: 'Mandelbrot fractal with dealerHat palette and animated zoom',
  },
  {
    name: 'noise',
    dsl: 'search classicNoisedeck\n\nnoise(noiseType: 10, octaves: 2, xScale: 75, yScale: 75, ridges: false, wrap: true, refractMode: 2, refractAmt: 0, loopOffset: 300, loopScale: 75, loopAmp: 25, kaleido: 1, metric: 0, colorMode: 6, hueRotation: 179, hueRange: 25, palette: afterimage, cyclePalette: 1, rotatePalette: 0, repeatPalette: 1, paletteMode: 3).write(o0)\nrender(o0)',
    tags: ['classic', 'basics', 'noise', 'simple'],
    description: 'Multi-octave noise with wrapping, afterimage palette, and HSV color rotation',
  },
  {
    name: 'noise 3d',
    dsl: 'search classicNoisedeck\n\nnoise3d(noiseType: 12, ridges: false, colorMode: 6).write(o0)\nrender(o0)',
    tags: ['classic', 'basics', 'noise3d', 'simple', '3d'],
    description: '3D noise generator with HSV color mode',
  },
  {
    name: 'pattern',
    dsl: 'search classicNoisedeck\n\npattern(patternType: 1, scale: 80, skewAmt: 0, rotation: 0, lineWidth: 100, animation: 0, speed: 1, sharpness: 100, color1: #ffea31, color2: #000000).write(o0)\nrender(o0)',
    tags: ['classic', 'basics', 'pattern', 'simple', 'geometric'],
    description: 'Dot pattern generator with yellow-black color scheme',
  },
  {
    name: 'shapes',
    dsl: 'search classicNoisedeck\n\nshapes(loopAOffset: 40, loopBOffset: 30, loopAScale: 1, loopBScale: 1, loopAAmp: 50, loopBAmp: 50, wrap: true, palette: sulphur, cyclePalette: 1, rotatePalette: 0, repeatPalette: 1).write(o0)\nrender(o0)',
    tags: ['classic', 'basics', 'shapes', 'simple', 'lissajous'],
    description: 'Lissajous shapes with dual loop oscillators and sulphur palette',
  },

  // ── Classic (curated ~35) ───────────────────────────────────────────────

  {
    name: '1980s shmoos',
    dsl: 'search classicNoisedeck\n\nshapes(loopAAmp: -32, loopAOffset: 200, loopAScale: 69, loopBAmp: -19, loopBOffset: 330, loopBScale: 47, palette: netOfGems, wrap: true, cyclePalette: 0, rotatePalette: 0).write(o0)\nshapes(loopAAmp: 32, loopAOffset: 200, loopAScale: 86, loopBAmp: -24, loopBOffset: 210, loopBScale: 18, palette: seventiesShirt, wrap: true, cyclePalette: 0, rotatePalette: 0).coalesce(tex: read(o0), blendMode: 6, mixAmt: 2, refractAAmt: 0, refractBAmt: 0).colorLab(colorMode: 2, dither: 0, hueRange: 100, hueRotation: 0, levels: 2, palette: seventiesShirt).palette(ampB: 43, ampG: 35, ampR: 91, freq: 4, offsetB: 17, offsetG: 66, offsetR: 90, phaseB: 100, phaseG: 33, phaseR: 58, paletteType: 0).write(o1)\nrender(o1)',
    tags: ['classic', 'multi-chain', 'shapes', 'coalesce', 'colorLab', 'palette'],
    description: 'Two shapes generators blended with coalesce, posterized with colorLab and custom palette remap',
  },
  {
    name: 'acid rinse',
    dsl: 'search classicNoisedeck\n\nnoise(hueRange: 75, hueRotation: 59, loopAmp: 29, octaves: 6, refractAmt: 35, ridges: true, noiseType: 10, colorMode: 6, kaleido: 1, xScale: 81, yScale: 81).write(o0)\nnoise(hueRange: 12, hueRotation: 28, loopAmp: 85, refractAmt: 33, ridges: false, wrap: false, xScale: 89, yScale: 92, noiseType: 2, colorMode: 6, kaleido: 1, octaves: 1).coalesce(tex: read(o0), blendMode: 8, mixAmt: 100, refractAAmt: 0, refractBAmt: 42).effects(effect: 4, effectAmt: 2, flip: 0, offsetX: 0, offsetY: 0, rotation: 0, scaleAmt: 100).lensDistortion(aberrationAmt: 100, blendMode: 0, hueRange: 100, hueRotation: 0, blendMode: 1, modulate: true, passthru: 57, opacity: 0, loopAmp: 0, distortion: 0).write(o1)\nrender(o1)',
    tags: ['classic', 'multi-chain', 'noise', 'coalesce', 'lens', 'chromatic-aberration', 'effects'],
    description: 'Two noise generators coalesced with mirror effects and full chromatic aberration',
  },
  {
    name: 'alien snowflake',
    dsl: 'search classicNoisedeck\n\nnoise(hueRotation: 45, kaleido: 7, metric: 0, palette: solaris, wrap: true, noiseType: 2, colorMode: 4, xScale: 89, yScale: 89, octaves: 1).write(o0)\nnoise(hueRotation: 45, kaleido: 7, metric: 0, palette: solaris, wrap: true, noiseType: 2, colorMode: 4, xScale: 51, yScale: 51, octaves: 1).coalesce(tex: read(o0), blendMode: 5, mixAmt: -27, refractAAmt: 0, refractBAmt: 0).lensDistortion(aberrationAmt: 48, blendMode: 0, hueRange: 0, hueRotation: 0, blendMode: 1, modulate: true, passthru: 71, opacity: 0, loopAmp: 0, distortion: 0).write(o1)\nrender(o1)',
    tags: ['classic', 'multi-chain', 'noise', 'kaleido', 'lens', 'coalesce'],
    description: 'Two kaleido noise layers at different scales blended with lens distortion modulation',
  },
  {
    name: 'and it burns, burns, burns',
    dsl: 'search classicNoisedeck\n\nnoise(hueRange: 35, hueRotation: 80, loopAmp: 33, octaves: 6, refractAmt: 63, ridges: true, noiseType: 10, colorMode: 6, kaleido: 1, xScale: 97, yScale: 97).write(o0)\ncellNoise(colorMode: 0, loopAmp: 5, palette: royal, scale: 21, cellScale: 75, cellSmooth: 0, cellVariation: 0, cyclePalette: 1, rotatePalette: 0).coalesce(tex: read(o0), blendMode: 7, mixAmt: -15, refractAAmt: 0, refractBAmt: 39).lensDistortion(aberrationAmt: 0, distortion: -48, loopAmp: 54, loopScale: 94, opacity: 12, shape: 0, tint: #b42f2d, vignetteAmt: -46).write(o1)\nrender(o1)',
    tags: ['classic', 'multi-chain', 'noise', 'cellNoise', 'coalesce', 'lens', 'vignette'],
    description: 'Ridged noise blended with cell noise, barrel distortion and warm-tinted vignette',
  },
  {
    name: 'bitmaskception',
    dsl: 'search classicNoisedeck\n\nbitEffects(baseHueRange: 30, colorScheme: 2, complexity: 34, formula: 20, hueRange: 0, hueRotation: 82, loopAmp: 79, tiles: 4, maskFormula: 20, maskColorScheme: 2).write(o0)\nbitEffects(baseHueRange: 95, colorScheme: 2, complexity: 50, formula: 11, hueRange: 12, hueRotation: 92, loopAmp: 31, tiles: 30, maskFormula: 11, maskColorScheme: 2).coalesce(tex: read(o0), blendMode: 11, mixAmt: 19, refractAAmt: 7, refractBAmt: 0).effects(effect: 100, effectAmt: 9, flip: 0, offsetX: 0, offsetY: 0, rotation: 0, scaleAmt: 100).write(o1)\nrender(o1)',
    tags: ['classic', 'multi-chain', 'bitEffects', 'coalesce', 'effects', 'math-art'],
    description: 'Two bit manipulation formulas coalesced with pixelation effects',
  },
  {
    name: 'beautiful garbage',
    dsl: 'search classicNoisedeck\n\nnoise(hueRange: 17, hueRotation: 52, loopAmp: 30, refractAmt: 43, ridges: false, wrap: true, xScale: 92, yScale: 90, noiseType: 3, colorMode: 6, kaleido: 1, octaves: 1).write(o0)\nnoise(hueRange: 27, hueRotation: 55, loopAmp: 34, refractAmt: 36, ridges: false, wrap: false, xScale: 94, yScale: 88, noiseType: 10, colorMode: 6, kaleido: 1, octaves: 1).coalesce(tex: read(o0), blendMode: 15, mixAmt: -60, refractAAmt: 67, refractBAmt: 21).lensDistortion(aberrationAmt: 28, distortion: -45, loopAmp: -100, loopScale: 73, opacity: 33, shape: 2, tint: #b39c4d, vignetteAmt: -100).lensDistortion(aberrationAmt: 80, blendMode: 0, hueRange: 77, hueRotation: 36, blendMode: 1, modulate: true, passthru: 91, opacity: 0, loopAmp: 0, distortion: 0).write(o1)\nrender(o1)',
    tags: ['classic', 'multi-chain', 'noise', 'coalesce', 'lens', 'refraction', 'vignette', 'dual-lens'],
    description: 'Two noise generators with heavy refraction, dual lens distortion with vignette and chromatic aberration',
  },
  {
    name: 'blue kaleido',
    dsl: 'search classicNoisedeck\n\nnoise(hueRange: 6, hueRotation: 62, loopAmp: -60, loopOffset: 80, loopScale: 17, refractAmt: 23, wrap: true, noiseType: 10, colorMode: 6, kaleido: 1, xScale: 30, yScale: 30, octaves: 1).kaleido(direction: 2, effectWidth: 5, kaleido: 5, kernel: 0, loopAmp: 4, loopOffset: 30, loopScale: 11, metric: 0, wrap: true).write(o1)\nrender(o1)',
    tags: ['classic', 'noise', 'kaleido', 'filter'],
    description: 'Noise generator piped through kaleido filter for five-fold symmetry pattern',
  },
  {
    name: 'candy crystal cloud',
    dsl: 'search classicNoisedeck\n\nnoise(hueRange: 98, hueRotation: 48, loopAmp: 9, loopOffset: 300, loopScale: 71, refractAmt: 37, wrap: true, noiseType: 3, colorMode: 6, kaleido: 1, xScale: 89, yScale: 89, octaves: 1).write(o0)\nnoise(hueRange: 49, hueRotation: 75, loopAmp: -2, loopOffset: 300, loopScale: 100, refractAmt: 71, wrap: true, noiseType: 0, colorMode: 6, kaleido: 1, xScale: 86, yScale: 86, octaves: 1).coalesce(tex: read(o0), blendMode: 12, mixAmt: 8, refractAAmt: 57, refractBAmt: 40).lensDistortion(aberrationAmt: 0, distortion: 0, loopAmp: 0, loopScale: 100, opacity: 30, shape: 0, tint: #c038ff, vignetteAmt: 0).refract().write(o1)\nrender(o1)',
    tags: ['classic', 'multi-chain', 'noise', 'coalesce', 'lens', 'refraction'],
    description: 'Two noise types coalesced with mutual refraction, purple tint overlay and refract filter',
  },
  {
    name: 'chromatic liquid',
    dsl: 'search classicNoisedeck\n\ncellNoise(colorMode: 1, loopAmp: 4, palette: justGreen, scale: 75, cellScale: 75, cellSmooth: 50, cellVariation: 0, cyclePalette: 1, rotatePalette: 0).write(o0)\nnoise(hueRange: 33, hueRotation: 82, loopAmp: 98, octaves: 1, refractAmt: 0, ridges: false, noiseType: 10, colorMode: 6, kaleido: 1, xScale: 74, yScale: 74).coalesce(tex: read(o0), blendMode: 15, mixAmt: 13, refractAAmt: 100, refractBAmt: 0).lensDistortion(aberrationAmt: 0, distortion: -35, loopAmp: 10, loopScale: 71, opacity: 34, shape: 0, tint: #ae5647, vignetteAmt: -60).lensDistortion(aberrationAmt: 69, blendMode: 0, hueRange: 100, hueRotation: 0, blendMode: 1, modulate: true, passthru: 52, opacity: 0, loopAmp: 0, distortion: 0).write(o1)\nrender(o1)',
    tags: ['classic', 'multi-chain', 'cellNoise', 'noise', 'coalesce', 'lens', 'dual-lens', 'chromatic-aberration'],
    description: 'Cell noise and smooth noise coalesced with full refraction, barrel distortion and chromatic aberration',
  },
  {
    name: 'circuits of time',
    dsl: 'search classicNoisedeck\n\nnoise(hueRange: 23, hueRotation: 26, loopAmp: 19, refractAmt: 100, ridges: true, wrap: false, xScale: 95, yScale: 92, noiseType: 3, colorMode: 6, kaleido: 1, octaves: 1).write(o0)\nnoise(hueRange: 46, hueRotation: 65, loopAmp: 21, refractAmt: 100, ridges: true, wrap: false, xScale: 99, yScale: 95, noiseType: 3, colorMode: 6, kaleido: 1, octaves: 1).coalesce(tex: read(o0), blendMode: 11, mixAmt: 49, refractAAmt: 100, refractBAmt: 100).lensDistortion(aberrationAmt: 16, distortion: -20, loopAmp: 0, loopScale: 60, opacity: 17, shape: 0, tint: #4986bc, vignetteAmt: -100).write(o1)\nrender(o1)',
    tags: ['classic', 'multi-chain', 'noise', 'coalesce', 'refraction', 'lens', 'vignette'],
    description: 'Two ridged noise generators with max refraction coalesced, blue-tinted vignette with barrel distortion',
  },
  {
    name: 'cool crystals',
    dsl: 'search classicNoisedeck\n\ncellNoise(colorMode: 1, loopAmp: 20, palette: santaCruz, scale: 90, cellScale: 75, cellSmooth: 0, cellVariation: 0, cyclePalette: 1, rotatePalette: 0).write(o0)\ncellNoise(colorMode: 2, loopAmp: 20, palette: tungsten, scale: 90, cellScale: 75, cellSmooth: 0, cellVariation: 0, cyclePalette: 1, rotatePalette: 0).coalesce(tex: read(o0), blendMode: 7, mixAmt: -61, refractAAmt: 46, refractBAmt: 25).lensDistortion(aberrationAmt: 30, distortion: -40, loopAmp: 10, loopScale: 71, opacity: 61, shape: 0, tint: #4052ba, vignetteAmt: -100).lensDistortion(aberrationAmt: 100, blendMode: 0, hueRange: 39, hueRotation: 16, blendMode: 1, modulate: true, passthru: 60, opacity: 0, loopAmp: 0, distortion: 0).write(o1)\nrender(o1)',
    tags: ['classic', 'multi-chain', 'cellNoise', 'coalesce', 'lens', 'dual-lens', 'vignette'],
    description: 'Two cell noise layers with different palettes coalesced with refraction, dual lens distortion and blue vignette',
  },
  {
    name: 'cutout hearts',
    dsl: 'search classicNoisedeck\n\npattern(color1: #000000, color2: #ff00f7, rotation: 25, scale: 97, skewAmt: 2, patternType: 3, speed: 1, animation: 0).write(o0)\nnoise(hueRange: 24, hueRotation: 60, loopAmp: 18, refractAmt: 77, ridges: false, wrap: true, xScale: 93, yScale: 67, noiseType: 3, colorMode: 6, kaleido: 1, octaves: 1).composite(tex: read(o0), blendMode: 1, inputColor: #000000, mixAmt: 0, range: 80).palette(ampB: 47, ampG: 2, ampR: 79, freq: 2, offsetB: 89, offsetG: 44, offsetR: 72, phaseB: 43, phaseG: 59, phaseR: 29, paletteType: 0).lensDistortion(aberrationAmt: 73, blendMode: 0, hueRange: 0, hueRotation: 77, blendMode: 1, modulate: false, passthru: 50, opacity: 0, loopAmp: 0, distortion: 0).write(o1)\nrender(o1)',
    tags: ['classic', 'multi-chain', 'pattern', 'noise', 'composite', 'palette', 'lens'],
    description: 'Heart pattern composited with refracted noise, custom RGB palette remap and chromatic aberration',
  },
  {
    name: 'cyber soup',
    dsl: 'search classicNoisedeck\n\npattern(color1: #4a88fb, color2: #000000, rotation: 111, scale: 61, skewAmt: 0, patternType: 2, speed: 1, animation: 4).write(o0)\nnoise(hueRange: 20, hueRotation: 58, loopAmp: 78, loopOffset: 300, loopScale: 100, refractAmt: 68, wrap: true, noiseType: 3, colorMode: 6, kaleido: 1, xScale: 81, yScale: 81, octaves: 1).composite(tex: read(o0), blendMode: 2, inputColor: #000000, mixAmt: 4, range: 71).colorLab(colorMode: 2, dither: 0, hueRange: 154, hueRotation: 0, levels: 0, palette: eventHorizon).write(o1)\nrender(o1)',
    tags: ['classic', 'multi-chain', 'pattern', 'noise', 'composite', 'colorLab'],
    description: 'Grid pattern composited with refracted noise, remapped through eventHorizon palette',
  },
  {
    name: 'double chess',
    dsl: 'search classicNoisedeck\n\npattern(color1: #6272e7, color2: #f98a35, rotation: 45, scale: 96, skewAmt: 0, patternType: 0, speed: 1, animation: 2).write(o0)\npattern(color1: #da8b56, color2: #520e28, rotation: 180, scale: 86, skewAmt: 0, patternType: 0, speed: 1, animation: 2).coalesce(tex: read(o0), blendMode: 8, mixAmt: -52).write(o1)\nrender(o1)',
    tags: ['classic', 'multi-chain', 'pattern', 'coalesce', 'mixer'],
    description: 'Two animated checkerboard patterns at different rotations blended together',
  },
  {
    name: 'double mask',
    dsl: 'search classicNoisedeck\n\nbitEffects(baseHueRange: 76, colorScheme: 0, complexity: 100, formula: 10, hueRange: 55, hueRotation: 94, loopAmp: 45, tiles: 10, maskFormula: 10, maskColorScheme: 0).write(o0)\nbitEffects(baseHueRange: 99, colorScheme: 2, complexity: 1, formula: 10, hueRange: 100, hueRotation: 7, loopAmp: 100, tiles: 1, maskFormula: 10, maskColorScheme: 2).coalesce(tex: read(o0), blendMode: 11, mixAmt: 1, refractAAmt: 0, refractBAmt: 0).write(o1)\nrender(o1)',
    tags: ['classic', 'multi-chain', 'bitEffects', 'coalesce', 'math-art'],
    description: 'Two bit effect formulas with different tile scales blended for layered mathematical patterns',
  },
  {
    name: 'dramatic pattern',
    dsl: 'search classicNoisedeck\n\npattern(color1: #ffffff, color2: #000000, rotation: 142, scale: 98, skewAmt: 12, patternType: 8, speed: 1, animation: 0).write(o0)\ncellNoise(loopAmp: 7, palette: brushedMetal, scale: 79, cellScale: 75, cellSmooth: 50, cellVariation: 0, cyclePalette: 0, rotatePalette: 0).coalesce(tex: read(o0), blendMode: 13, mixAmt: 60, refractAAmt: 1, refractBAmt: 100).lensDistortion(aberrationAmt: 27, distortion: -31, loopAmp: -59, loopScale: 60, opacity: 34, shape: 0, tint: #5849bc, vignetteAmt: -37).write(o1)\nrender(o1)',
    tags: ['classic', 'multi-chain', 'pattern', 'cellNoise', 'coalesce', 'lens', 'refraction'],
    description: 'Skewed geometric pattern blended with cell noise using heavy refraction and purple vignette',
  },
  {
    name: 'entranced',
    dsl: 'search classicNoisedeck\n\nshapes(loopAAmp: -21, loopAOffset: 410, loopAScale: 21, loopBAmp: 38, loopBOffset: 80, loopBScale: 78, palette: solaris, wrap: true, cyclePalette: 0, rotatePalette: 0).write(o0)\nshapes(loopAAmp: -67, loopAOffset: 410, loopAScale: 57, loopBAmp: 92, loopBOffset: 80, loopBScale: 1, palette: solaris, wrap: true, cyclePalette: 0, rotatePalette: 0).composite(tex: read(o0), blendMode: 3).colorLab(colorMode: 2, dither: 0, hueRange: 90, hueRotation: 0, levels: 0, palette: sulphur).write(o1)\nrender(o1)',
    tags: ['classic', 'multi-chain', 'shapes', 'composite', 'colorLab'],
    description: 'Two shapes generators composited and remapped through sulphur palette for warm tones',
  },
  {
    name: 'flashy fractal',
    dsl: 'search classicNoisedeck\n\nfractal(centerX: 12, centerY: -57, fractalType: 0, offsetX: 35, offsetY: 59, palette: royal, rotation: 0, speed: 2, zoomAmt: 33, cyclePalette: 0, rotatePalette: 0).write(o0)\nfractal(centerX: 0, centerY: -4, fractalType: 1, offsetX: 31, offsetY: 0, palette: royal, rotation: 0, speed: 81, symmetry: 5, zoomAmt: 0, cyclePalette: 0, rotatePalette: 0).coalesce(tex: read(o0), blendMode: 13, mixAmt: 2, refractAAmt: 47, refractBAmt: 61).lensDistortion(aberrationAmt: 0, distortion: 6, loopAmp: -14, loopScale: 88, opacity: 81, shape: 0, tint: #487b9d, vignetteAmt: 72).effects(effect: 4, effectAmt: 0, flip: 15, offsetX: 0, offsetY: 0, rotation: 0, scaleAmt: 100).write(o1)\nrender(o1)',
    tags: ['classic', 'multi-chain', 'fractal', 'coalesce', 'lens', 'effects'],
    description: 'Two fractal types (Mandelbrot + symmetry) coalesced with refraction, tinted vignette and mirror',
  },
  {
    name: 'fractal wave wash',
    dsl: 'search classicNoisedeck\n\nfractal(centerX: 21, centerY: -37, fractalType: 0, offsetX: 73, offsetY: 52, palette: blueSkies, rotation: 127, speed: 75, zoomAmt: 91, cyclePalette: 0, rotatePalette: 0).write(o0)\nfractal(centerX: 21, centerY: 0, fractalType: 0, offsetX: 13, offsetY: 69, palette: blueSkies, rotation: 0, speed: 75, zoomAmt: 83, cyclePalette: 1, rotatePalette: 0).coalesce(tex: read(o0), blendMode: 100, mixAmt: -13, refractAAmt: 0, refractBAmt: 15).lensDistortion(aberrationAmt: 91, blendMode: 0, hueRange: 100, hueRotation: 0, blendMode: 1, modulate: true, passthru: 42, opacity: 0, loopAmp: 0, distortion: 0).write(o1)\nrender(o1)',
    tags: ['classic', 'multi-chain', 'fractal', 'coalesce', 'lens', 'chromatic-aberration'],
    description: 'Two deep-zoom Mandelbrot fractals blended with high chromatic aberration modulation',
  },
  {
    name: 'glitched grid',
    dsl: 'search classicNoisedeck\n\nnoise(hueRange: 0, hueRotation: 45, loopAmp: 79, refractAmt: 100, ridges: false, wrap: true, xScale: 100, yScale: 99, noiseType: 3, colorMode: 6, kaleido: 1, octaves: 1).write(o0)\npattern(color1: #8480ff, color2: #000000, rotation: 104, scale: 71, skewAmt: 1, patternType: 2, speed: 1, animation: 4).coalesce(tex: read(o0), blendMode: 17, mixAmt: 100, refractAAmt: 0, refractBAmt: 100).lensDistortion(aberrationAmt: 22, distortion: 56, loopAmp: -20, loopScale: 60, opacity: 4, shape: 6, tint: #494abc, vignetteAmt: -69).write(o1)\nrender(o1)',
    tags: ['classic', 'multi-chain', 'noise', 'pattern', 'coalesce', 'lens', 'refraction'],
    description: 'Refracted noise blended with animated grid pattern, pincushion distortion and purple vignette',
  },
  {
    name: 'glitchy melted candy',
    dsl: 'search classicNoisedeck\n\nnoise(palette: cottonCandy, refractAmt: 34, ridges: false, noiseType: 10, colorMode: 4, kaleido: 1, xScale: 2, yScale: 2, octaves: 1).write(o0)\nnoise(palette: cottonCandy, refractAmt: 62, ridges: false, noiseType: 10, colorMode: 4, kaleido: 1, xScale: 3, yScale: 3, octaves: 1).composite(tex: read(o0), blendMode: 113).glitch(aberrationAmt: 32, distortion: 96, glitchiness: 6, scanlinesAmt: 69, vignetteAmt: 49, xChonk: 88, yChonk: 8).write(o1)\nrender(o1)',
    tags: ['classic', 'multi-chain', 'noise', 'composite', 'glitch'],
    description: 'Two low-scale noise layers composited with heavy glitch effect including scanlines and distortion',
  },
  {
    name: 'golden rings',
    dsl: 'search classicNoisedeck\n\nnoise(hueRange: 15, hueRotation: 47, loopAmp: 61, refractAmt: 8, ridges: true, wrap: true, xScale: 100, yScale: 89, noiseType: 0, colorMode: 6, kaleido: 1, octaves: 1).write(o0)\nshapes(loopAAmp: 100, loopAOffset: 10, loopAScale: 81, loopBAmp: -38, loopBOffset: 400, loopBScale: 75, palette: tungsten, wrap: true, cyclePalette: 0, rotatePalette: 0).coalesce(tex: read(o0), blendMode: 15, mixAmt: 19, refractAAmt: 45, refractBAmt: 0).lensDistortion(aberrationAmt: 60, distortion: -57, loopAmp: -8, loopScale: 55, opacity: 0, shape: 0, tint: #5ad2f2, vignetteAmt: 100).refract().write(o1)\nrender(o1)',
    tags: ['classic', 'multi-chain', 'noise', 'shapes', 'coalesce', 'lens', 'refraction'],
    description: 'Noise and shapes generators coalesced with refraction, barrel distortion and refract filter',
  },
  {
    name: 'hallucinogrid',
    dsl: 'search classicNoisedeck\n\npattern(color1: #00ffd5, color2: #000000, rotation: 130, scale: 75, skewAmt: 0, patternType: 2, speed: 1, animation: 4).write(o0)\nnoise(hueRange: 21, hueRotation: 43, loopAmp: 100, refractAmt: 100, ridges: true, wrap: true, xScale: 99, yScale: 97, noiseType: 3, colorMode: 6, kaleido: 1, octaves: 1).coalesce(tex: read(o0), blendMode: 9, mixAmt: -56, refractAAmt: 27, refractBAmt: 29).lensDistortion(aberrationAmt: 100, distortion: -64, loopAmp: -10, loopScale: 62, opacity: 11, shape: 0, tint: #75c5c7, vignetteAmt: -100).write(o1)\nrender(o1)',
    tags: ['classic', 'multi-chain', 'pattern', 'noise', 'coalesce', 'lens', 'chromatic-aberration', 'vignette'],
    description: 'Cyan animated grid blended with ridged refracted noise, full chromatic aberration and barrel distortion',
  },
  {
    name: 'holo-transmission',
    dsl: 'search classicNoisedeck\n\nnoise(hueRange: 9, hueRotation: 15, loopAmp: 73, loopOffset: 300, loopScale: 29, refractAmt: 71, wrap: true, noiseType: 3, colorMode: 6, kaleido: 1, xScale: 74, yScale: 74, octaves: 1).write(o0)\nbitEffects(colorScheme: 5, formula: 0, interp: 0, loopAmp: 34, n: 1, rotation: 0, scale: 88).glitch(aberrationAmt: 14).effects(effectAmt: 84, effect: 0).write(o1)\nrender(o1)',
    tags: ['classic', 'multi-chain', 'noise', 'bitEffects', 'glitch', 'effects'],
    description: 'Noise and bit effects on separate chains with glitch filter and zoom effects',
  },
  {
    name: 'holographic noodles',
    dsl: 'search classicNoisedeck\n\nnoise(hueRange: 9, hueRotation: 32, loopAmp: 17, refractAmt: 22, ridges: true, wrap: true, xScale: 90, yScale: 90, noiseType: 3, colorMode: 6, kaleido: 1, octaves: 1).write(o0)\nnoise(hueRange: 9, hueRotation: 67, loopAmp: 25, refractAmt: 0, ridges: true, wrap: true, xScale: 60, yScale: 60, noiseType: 3, colorMode: 6, kaleido: 1, octaves: 1).coalesce(tex: read(o0), blendMode: 9, mixAmt: 48, refractAAmt: 14, refractBAmt: 3).lensDistortion(aberrationAmt: 70, blendMode: 0, hueRange: 50, hueRotation: 34, blendMode: 1, modulate: false, passthru: 44, opacity: 0, loopAmp: 0, distortion: 0).refract().write(o1)\nrender(o1)',
    tags: ['classic', 'multi-chain', 'noise', 'coalesce', 'lens', 'refraction', 'chromatic-aberration'],
    description: 'Two ridged noise generators at different scales coalesced with chromatic aberration and refract filter',
  },
  {
    name: 'illuminatus',
    dsl: 'search classicNoisedeck\n\nshapes(loopAAmp: -22, loopAOffset: 410, loopAScale: 100, loopBAmp: 63, loopBOffset: 20, loopBScale: 61, palette: solaris, wrap: true, cyclePalette: 0, rotatePalette: 0).write(o0)\nshapes(loopAAmp: 50, loopAOffset: 410, loopAScale: 20, loopBAmp: 98, loopBOffset: 20, loopBScale: 1, palette: solaris, wrap: true, cyclePalette: 0, rotatePalette: 0).composite(tex: read(o0), blendMode: 3).colorLab(brightness: 4, colorMode: 2, dither: 0, hueRange: 200, hueRotation: 0, levels: 0, palette: sulphur, saturation: -6).write(o1)\nrender(o1)',
    tags: ['classic', 'multi-chain', 'shapes', 'composite', 'colorLab'],
    description: 'Two shapes oscillators composited with wide hue range colorLab remap and desaturation',
  },
  {
    name: 'kaleido-singularity',
    dsl: 'search classicNoisedeck\n\nnoise(hueRotation: 81, kaleido: 3, metric: 4, palette: eventHorizon, wrap: true, noiseType: 3, colorMode: 4, xScale: 81, yScale: 81, octaves: 1).coalesce(tex: read(o0), blendMode: 9, mixAmt: -100, refractAAmt: 100, refractBAmt: 0).glitch(aberrationAmt: 33, distortion: -62, glitchiness: 6, scanlinesAmt: 46, vignetteAmt: -57, xChonk: 100, yChonk: 75).write(o1)\nrender(o1)',
    tags: ['classic', 'noise', 'kaleido', 'coalesce', 'glitch'],
    description: 'Kaleido noise with self-refraction coalesce and heavy glitch scanline effects',
  },
  {
    name: 'kaleidopalooze',
    dsl: 'search classicNoisedeck\n\nnoise(hueRotation: 0, kaleido: 7, metric: 0, wrap: true, palette: royal, noiseType: 2, colorMode: 4, xScale: 52, yScale: 52, octaves: 1).write(o0)\nnoise(hueRange: 66, hueRotation: 36, loopAmp: 46, refractAmt: 68, ridges: true, wrap: false, xScale: 88, yScale: 94, noiseType: 3, colorMode: 6, kaleido: 1, octaves: 1).coalesce(tex: read(o0), blendMode: 12, mixAmt: -19, refractAAmt: 0, refractBAmt: 40).kaleido(direction: 2, effectWidth: 3, kaleido: 7, kernel: 0, loopAmp: -10, loopOffset: 10, loopScale: 100, metric: 0, wrap: true).kaleido(direction: 2, effectWidth: 3, kaleido: 7, kernel: 0, loopAmp: 10, loopOffset: 10, loopScale: 86, metric: 0, wrap: true).write(o1)\nrender(o1)',
    tags: ['classic', 'multi-chain', 'noise', 'coalesce', 'kaleido', 'dual-kaleido'],
    description: 'Two noise generators coalesced through dual kaleido filters for seven-fold nested symmetry',
  },
  {
    name: 'liquid flame',
    dsl: 'search classicNoisedeck\n\nnoise(hueRange: 23, hueRotation: 76, loopAmp: 11, loopOffset: 210, loopScale: 50, refractAmt: 34, wrap: true, noiseType: 3, colorMode: 6, kaleido: 1, xScale: 92, yScale: 92, octaves: 1).write(o0)\nnoise(hueRange: 11, hueRotation: 76, loopAmp: 58, loopOffset: 210, loopScale: 100, refractAmt: 51, wrap: true, noiseType: 3, colorMode: 6, kaleido: 1, xScale: 78, yScale: 78, octaves: 1).coalesce(tex: read(o0), blendMode: 17, mixAmt: -4, refractAAmt: 57, refractBAmt: 40).lensDistortion(aberrationAmt: 0, distortion: 21, loopAmp: -3, loopScale: 99, opacity: 39, shape: 0, tint: #ca7907, vignetteAmt: -21).refract().write(o1)\nrender(o1)',
    tags: ['classic', 'multi-chain', 'noise', 'coalesce', 'lens', 'refraction'],
    description: 'Two warm-hued noise generators coalesced with mutual refraction, amber tint and refract filter',
  },
  {
    name: 'liquid ice',
    dsl: 'search classicNoisedeck\n\ncellNoise(colorMode: 1, loopAmp: 19, palette: jester, scale: 88, cellScale: 75, cellSmooth: 50, cellVariation: 0, cyclePalette: 1, rotatePalette: 0).write(o0)\ncellNoise(colorMode: 2, loopAmp: 8, palette: neptune, scale: 92, cellScale: 75, cellSmooth: 0, cellVariation: 0, cyclePalette: 1, rotatePalette: 0).coalesce(tex: read(o0), blendMode: 0, mixAmt: -50, refractAAmt: 61, refractBAmt: 34).lensDistortion(aberrationAmt: 30, distortion: -32, loopAmp: 15, loopScale: 73, opacity: 59, shape: 0, tint: #5e9e96, vignetteAmt: -100).refract().write(o1)\nrender(o1)',
    tags: ['classic', 'multi-chain', 'cellNoise', 'coalesce', 'lens', 'refraction', 'vignette'],
    description: 'Two cell noise generators with jester and neptune palettes, refraction blend with teal vignette',
  },
  {
    name: 'liquid infinity',
    dsl: 'search classicNoisedeck\n\nnoise(hueRange: 67, hueRotation: 9, loopAmp: 89, refractAmt: 100, ridges: true, wrap: true, xScale: 94, yScale: 97, noiseType: 3, colorMode: 6, kaleido: 1, octaves: 1).write(o0)\nnoise(hueRange: 66, hueRotation: 20, loopAmp: 82, refractAmt: 100, ridges: true, wrap: true, xScale: 94, yScale: 97, noiseType: 3, colorMode: 6, kaleido: 1, octaves: 1).coalesce(tex: read(o0), blendMode: 11, mixAmt: 55, refractAAmt: 100, refractBAmt: 100).lensDistortion(aberrationAmt: 20, distortion: -41, loopAmp: -10, loopScale: 60, opacity: 18, shape: 0, tint: #4950bc, vignetteAmt: -61).write(o1)\nrender(o1)',
    tags: ['classic', 'multi-chain', 'noise', 'coalesce', 'refraction', 'lens', 'vignette'],
    description: 'Two max-refraction ridged noise generators coalesced with full mutual refraction and blue vignette',
  },
  {
    name: 'maelstrom',
    dsl: 'search classicNoisedeck\n\nfractal(centerX: 0, centerY: 0, fractalType: 0, offsetX: 40, offsetY: 58, palette: grayscale, rotation: 183, speed: 33, zoomAmt: 0, cyclePalette: 0, rotatePalette: 0).write(o0)\nnoise(hueRange: 26, hueRotation: 81, loopAmp: 100, refractAmt: 73, ridges: true, wrap: true, xScale: 95, yScale: 96, noiseType: 3, colorMode: 6, kaleido: 1, octaves: 1).coalesce(tex: read(o0), blendMode: 10, mixAmt: 100, refractAAmt: 0, refractBAmt: 51).lensDistortion(aberrationAmt: 41, distortion: 23, loopAmp: 48, loopScale: 24, opacity: 14, shape: 0, tint: #935343, vignetteAmt: -47).write(o1)\nrender(o1)',
    tags: ['classic', 'multi-chain', 'fractal', 'noise', 'coalesce', 'lens'],
    description: 'Grayscale Mandelbrot fractal blended with ridged refracted noise, warm-tinted lens distortion',
  },
  {
    name: 'melt',
    dsl: 'search classicNoisedeck\n\nnoise(hueRange: 17, hueRotation: 21, loopAmp: -27, loopOffset: 210, loopScale: 84, refractAmt: 88, wrap: true, noiseType: 3, colorMode: 6, kaleido: 1, xScale: 85, yScale: 85, octaves: 1).write(o0)\ncellNoise(colorMode: 1, loopAmp: 5, palette: blueSkies, scale: 69, cellScale: 75, cellSmooth: 0, cellVariation: 0, cyclePalette: 0, rotatePalette: 0).composite(tex: read(o0), blendMode: 1, inputColor: #000000, mixAmt: 46, range: 44).lensDistortion(aberrationAmt: 65, blendMode: 0, hueRange: 38, hueRotation: 0, blendMode: 0, modulate: false, passthru: 61, opacity: 0, loopAmp: 0, distortion: 0).refract().write(o1)\nrender(o1)',
    tags: ['classic', 'multi-chain', 'noise', 'cellNoise', 'composite', 'lens', 'refraction'],
    description: 'Refracted noise composited with blue cell noise, chromatic aberration and refract filter',
  },
  {
    name: 'oil cloud',
    dsl: 'search classicNoisedeck\n\nnoise(hueRange: 100, hueRotation: 25, loopAmp: 100, octaves: 4, refractAmt: 5, ridges: true, noiseType: 10, colorMode: 6, kaleido: 1, xScale: 81, yScale: 81).write(o0)\nnoise(hueRange: 93, hueRotation: 25, loopAmp: 100, octaves: 1, refractAmt: 5, ridges: false, noiseType: 10, colorMode: 6, kaleido: 1, xScale: 81, yScale: 81).coalesce(tex: read(o0), blendMode: 5, mixAmt: 32, refractAAmt: 0, refractBAmt: 0).refract().refract().write(o1)\nrender(o1)',
    tags: ['classic', 'multi-chain', 'noise', 'coalesce', 'refraction', 'double-refract'],
    description: 'Two full-spectrum noise generators coalesced and double-refracted for iridescent oil effect',
  },
  {
    name: 'prismatic cloud',
    dsl: 'search classicNoisedeck\n\nnoise(hueRange: 37, hueRotation: 0, loopAmp: 26, octaves: 5, refractAmt: 100, ridges: false, noiseType: 10, colorMode: 6, kaleido: 1, xScale: 98, yScale: 98).write(o0)\nnoise(hueRange: 100, hueRotation: 28, loopAmp: 98, refractAmt: 0, ridges: false, wrap: false, xScale: 98, yScale: 98, noiseType: 2, colorMode: 6, kaleido: 1, octaves: 1).coalesce(tex: read(o0), blendMode: 8, mixAmt: -72, refractAAmt: 0, refractBAmt: 100).lensDistortion(aberrationAmt: 0, distortion: -22, loopAmp: 10, loopScale: 71, opacity: 0, shape: 2, tint: #8a47ae, vignetteAmt: -73).lensDistortion(aberrationAmt: 100, blendMode: 0, hueRange: 12, hueRotation: 15, blendMode: 1, modulate: false, passthru: 76, opacity: 0, loopAmp: 0, distortion: 0).write(o1)\nrender(o1)',
    tags: ['classic', 'multi-chain', 'noise', 'coalesce', 'lens', 'dual-lens', 'chromatic-aberration', 'vignette'],
    description: 'Multi-octave noise with full refraction coalesced, dual lens distortion with vignette and chromatic aberration',
  },
  {
    name: 'prismatic goop',
    dsl: 'search classicNoisedeck\n\npattern(color1: #ffffff, color2: #000000, rotation: 0, scale: 95, skewAmt: 8, patternType: 0, speed: 1, animation: 2).write(o0)\nnoise(hueRange: 25, hueRotation: 52, loopAmp: 53, refractAmt: 76, ridges: true, wrap: true, xScale: 95, yScale: 82, noiseType: 3, colorMode: 6, kaleido: 1, octaves: 1).coalesce(tex: read(o0), blendMode: 10, mixAmt: 43, refractAAmt: 10, refractBAmt: 0).lensDistortion(aberrationAmt: 100, blendMode: 0, hueRange: 71, hueRotation: 0, blendMode: 1, modulate: true, passthru: 47, opacity: 0, loopAmp: 0, distortion: 0).effects(effect: 4, effectAmt: 0, flip: 2, offsetX: 0, offsetY: 0, rotation: 59, scaleAmt: 146).write(o1)\nrender(o1)',
    tags: ['classic', 'multi-chain', 'pattern', 'noise', 'coalesce', 'lens', 'effects', 'chromatic-aberration'],
    description: 'Animated checkerboard coalesced with refracted noise, full chromatic aberration and rotated mirror',
  },
  {
    name: 'pure reflection',
    dsl: 'search classicNoisedeck\n\nshapes(loopAAmp: -28, loopAOffset: 30, loopAScale: 97, loopBAmp: 82, loopBOffset: 30, loopBScale: 7, wrap: true, palette: columbia, cyclePalette: 0, rotatePalette: 0).write(o0)\nshapes(loopAAmp: 43, loopAOffset: 210, loopAScale: 63, loopBAmp: -53, loopBOffset: 30, loopBScale: 71, wrap: true, palette: vibrant, cyclePalette: 0, rotatePalette: 0).composite(tex: read(o0), blendMode: 1, inputColor: #341cd4, mixAmt: 43, range: 30).refract().colorLab(colorMode: 2, dither: 0, hueRange: 200, hueRotation: 0, levels: 0, palette: sulphur).write(o1)\nrender(o1)',
    tags: ['classic', 'multi-chain', 'shapes', 'composite', 'refraction', 'colorLab'],
    description: 'Two shapes generators with different palettes composited with blue tint, refracted and color-remapped',
  },
  {
    name: 'satin touch',
    dsl: 'search classicNoisedeck\n\nnoise(hueRange: 7, hueRotation: 73, loopAmp: 52, refractAmt: 80, ridges: false, wrap: true, xScale: 89, yScale: 93, noiseType: 10, colorMode: 6, kaleido: 1, octaves: 1).write(o0)\nnoise(hueRange: 38, hueRotation: 63, loopAmp: 46, octaves: 5, refractAmt: 83, ridges: true, noiseType: 10, colorMode: 6, kaleido: 1, xScale: 100, yScale: 100).coalesce(tex: read(o0), blendMode: 10, mixAmt: 100, refractAAmt: 24, refractBAmt: 10).colorLab(colorMode: 3, dither: 0, hueRange: 105, hueRotation: 55, levels: 0, palette: sulphur).colorLab(colorMode: 2, dither: 0, hueRange: 100, hueRotation: 88, levels: 0, palette: toxic).write(o1)\nrender(o1)',
    tags: ['classic', 'multi-chain', 'noise', 'coalesce', 'colorLab', 'dual-colorLab'],
    description: 'Two refracted noise generators coalesced with dual colorLab remapping through sulphur and toxic palettes',
  },
  {
    name: 'see you in prism',
    dsl: 'search classicNoisedeck\n\nnoise(hueRange: 18, hueRotation: 20, loopAmp: -30, loopOffset: 20, loopScale: 81, refractAmt: 94, wrap: true, noiseType: 3, colorMode: 6, kaleido: 1, xScale: 100, yScale: 100, octaves: 1).write(o0)\ncellNoise(colorMode: 2, loopAmp: 0, palette: royal, scale: 84, cellScale: 75, cellSmooth: 0, cellVariation: 0, cyclePalette: 1, rotatePalette: 0).composite(tex: read(o0), blendMode: 1, inputColor: #8f8f8f, mixAmt: 0, range: 54).lensDistortion(aberrationAmt: 100, distortion: -67, loopAmp: 83, loopScale: 39, opacity: 33, shape: 6, tint: #412036, vignetteAmt: -46).refract().write(o1)\nrender(o1)',
    tags: ['classic', 'multi-chain', 'noise', 'cellNoise', 'composite', 'lens', 'refraction'],
    description: 'Refracted noise composited with royal cell noise, strong barrel distortion with diamond vignette and refract',
  },
  {
    name: 'digital camo',
    dsl: 'search classicNoisedeck\n\nnoise(hueRange: 3, hueRotation: 59, loopAmp: 22, loopOffset: 210, loopScale: 52, refractAmt: 35, wrap: true, noiseType: 0, colorMode: 6, kaleido: 1, xScale: 22, yScale: 22, octaves: 1).effects(effect: 100, effectAmt: 9, flip: 0, offsetX: 0, offsetY: 0, rotation: 0, scaleAmt: 100).write(o1)\nrender(o1)',
    tags: ['classic', 'noise', 'effects', 'pixelate', 'filter'],
    description: 'Low-scale noise with refraction pixelated into digital camouflage pattern',
  },
  {
    name: 'edgy fractal',
    dsl: 'search classicNoisedeck\n\nfractal(centerX: 0, centerY: 0, fractalType: 1, offsetX: 0, offsetY: 0, palette: vibrant, rotation: 0, speed: 51, symmetry: 4, zoomAmt: 0, cyclePalette: 0, rotatePalette: 0).write(o0)\nrender(o0)',
    tags: ['classic', 'fractal', 'simple', 'symmetry'],
    description: 'Symmetry fractal with four-fold rotation and vibrant palette',
  },
  {
    name: 'cyberfall',
    dsl: 'search classicNoisedeck\n\nbitEffects(colorScheme: 11, formula: 0, interp: 0, loopAmp: 100, n: 1, rotation: 45, scale: 84).write(o0)\nrender(o0)',
    tags: ['classic', 'bitEffects', 'simple', 'math-art'],
    description: 'Rotated bit manipulation formula with high animation speed',
  },

  // ── Modern Synth (generators) ─────────────────────────────────────────

  {
    name: 'simple noise',
    dsl: 'search synth\n\nnoise(octaves: 4, ridges: true).write(o0)\nrender(o0)',
    tags: ['synth', 'noise', 'simple', 'starter'],
    description: 'Basic ridged multi-octave noise — the default go-to starter',
  },
  {
    name: 'perlin landscape',
    dsl: 'search synth\n\nperlin(scale: 50, octaves: 3, ridges: true).write(o0)\nrender(o0)',
    tags: ['synth', 'perlin', 'simple', 'noise'],
    description: 'Perlin noise with ridges and moderate scale for organic landscapes',
  },
  {
    name: 'warped perlin',
    dsl: 'search synth\n\nperlin(scale: 40, octaves: 2, warpIterations: 3, warpScale: 60, warpIntensity: 70).write(o0)\nrender(o0)',
    tags: ['synth', 'perlin', 'warp', 'domain-warping'],
    description: 'Domain-warped perlin noise creating fluid organic distortions',
  },
  {
    name: 'cell noise mono',
    dsl: 'search synth\n\ncell(scale: 50, cellScale: 80, cellSmooth: 30).write(o0)\nrender(o0)',
    tags: ['synth', 'cell', 'voronoi', 'simple'],
    description: 'Smooth voronoi cell noise at medium scale',
  },
  {
    name: 'curl flow',
    dsl: 'search synth\n\ncurl(scale: 20, octaves: 3, ridges: true, intensity: 0.8).write(o0)\nrender(o0)',
    tags: ['synth', 'curl', 'flow', 'vector-field'],
    description: 'Curl noise with ridges for flowing vector field patterns',
  },
  {
    name: 'julia set',
    dsl: 'search synth\n\njulia(poi: douadyRabbit, iterations: 300, outputMode: smoothIteration).write(o0)\nrender(o0)',
    tags: ['synth', 'julia', 'fractal', 'complex'],
    description: 'Julia set fractal at the Douady rabbit point of interest',
  },
  {
    name: 'animated julia',
    dsl: 'search synth\n\njulia(poi: manual, cReal: -0.7, cImag: 0.4, cPath: cardioid, cSpeed: 0.3).write(o0)\nrender(o0)',
    tags: ['synth', 'julia', 'fractal', 'animated'],
    description: 'Julia set with c-parameter animating along cardioid path',
  },
  {
    name: 'mandelbrot deep zoom',
    dsl: 'search synth\n\nmandelbrot(poi: seahorseValley, iterations: 500, zoomSpeed: 0.5, outputMode: smoothIteration).write(o0)\nrender(o0)',
    tags: ['synth', 'mandelbrot', 'fractal', 'zoom'],
    description: 'Deep-zooming Mandelbrot at Seahorse Valley with smooth coloring',
  },
  {
    name: 'fractal explorer',
    dsl: 'search synth\n\nfractal(type: burningShip, power: 2, iterations: 200, zoom: 1.5).write(o0)\nrender(o0)',
    tags: ['synth', 'fractal', 'burningShip', 'explorer'],
    description: 'Burning ship fractal variant',
  },
  {
    name: 'gabor texture',
    dsl: 'search synth\n\ngabor(scale: 50, orientation: 45, bandwidth: 50, density: 5).write(o0)\nrender(o0)',
    tags: ['synth', 'gabor', 'texture', 'oriented'],
    description: 'Gabor noise with oriented bandwidth for directional textures',
  },
  {
    name: 'color gradient',
    dsl: 'search synth\n\ngradient(gradientType: radial, color1: #ff0044, color2: #4400ff, color3: #00ff88, color4: #ffaa00).write(o0)\nrender(o0)',
    tags: ['synth', 'gradient', 'color', 'simple'],
    description: 'Radial four-color gradient generator',
  },
  {
    name: 'oscillator stripes',
    dsl: 'search synth\n\nosc2d(oscType: sine, freq: 8, speed: 2, rotation: 30).write(o0)\nrender(o0)',
    tags: ['synth', 'osc2d', 'geometric', 'oscillator'],
    description: '2D sine wave oscillator with angled rotation',
  },
  {
    name: 'polygon sprite',
    dsl: 'search synth\n\npolygon(sides: 6, radius: 0.6, smooth: 0.02, fgColor: #ffffff, bgColor: #000000, bgAlpha: 0).write(o0)\nrender(o0)',
    tags: ['synth', 'polygon', 'geometric', 'shape'],
    description: 'Hexagonal polygon with transparent background for compositing',
  },
  {
    name: 'shape morphing',
    dsl: 'search synth\n\nshape(loopAOffset: dodecahedron, loopBOffset: icosahedron, loopAScale: 50, loopBScale: 30, wrap: true).write(o0)\nrender(o0)',
    tags: ['synth', 'shape', 'morphing', 'lissajous'],
    description: 'Animated shape morph between dodecahedron and icosahedron projections',
  },
  {
    name: 'reaction diffusion',
    dsl: 'search synth\n\nrd(iterations: 16, colorMode: gradient).write(o0)\nrender(o0)',
    tags: ['synth', 'rd', 'reaction-diffusion', 'simulation'],
    description: 'Reaction-diffusion simulation with gradient coloring',
  },
  {
    name: 'cellular automaton',
    dsl: 'search synth\n\nca(ruleIndex: 4, stateSize: x64, speed: 2).write(o0)\nrender(o0)',
    tags: ['synth', 'ca', 'cellular-automata', 'simulation'],
    description: '2D cellular automaton with larger state buffer',
  },
  {
    name: 'multi-neighborhood ca',
    dsl: 'search synth\n\nmnca(ruleIndex: 4, stateSize: x16, speed: 2).write(o0)\nrender(o0)',
    tags: ['synth', 'mnca', 'cellular-automata', 'simulation'],
    description: 'Multi-neighborhood cellular automaton — complex emergent patterns',
  },
  {
    name: 'mod pattern grid',
    dsl: 'search synth\n\nmodPattern(shape1: circle, scale1: 12, shape2: square, scale2: 8, blend: 0.5, speed: 1).write(o0)\nrender(o0)',
    tags: ['synth', 'modPattern', 'geometric', 'pattern'],
    description: 'Modular arithmetic pattern with blended circle and square grids',
  },
  {
    name: 'pattern stripes',
    dsl: 'search synth\n\npattern(type: stripes, scale: 80, rotation: 45, smoothness: 0.05, speed: 1).write(o0)\nrender(o0)',
    tags: ['synth', 'pattern', 'geometric', 'stripes'],
    description: 'Angled stripe pattern with smooth edges',
  },
  {
    name: 'subdivide tiles',
    dsl: 'search synth\n\nsubdivide(depth: 6, density: 80, fill: quad, outline: 2).write(o0)\nrender(o0)',
    tags: ['synth', 'subdivide', 'geometric', 'tiling'],
    description: 'Recursive subdivision tiling with outlined quads',
  },
  {
    name: 'solid color',
    dsl: 'search synth\n\nsolid(color: #1a1a2e).write(o0)\nrender(o0)',
    tags: ['synth', 'solid', 'simple', 'color'],
    description: 'Solid color — useful as a base for filter chains',
  },

  // ── Filter Chains ─────────────────────────────────────────────────────

  {
    name: 'noise with bloom',
    dsl: 'search synth, filter\n\nnoise(ridges: true, octaves: 3)\n  .bloom(taps: 15)\n  .vignette()\n  .write(o0)\nrender(o0)',
    tags: ['filter', 'bloom', 'vignette', 'post-processing'],
    description: 'Ridged noise with bloom glow and vignette darkening',
  },
  {
    name: 'chromatic noise',
    dsl: 'search synth, filter\n\nnoise(colorMode: mono, ridges: true)\n  .chromaticAberration()\n  .write(o0)\nrender(o0)',
    tags: ['filter', 'chromaticAberration', 'color-split'],
    description: 'Monochrome noise with RGB channel separation',
  },
  {
    name: 'prismatic noise',
    dsl: 'search synth, filter\n\nnoise(ridges: true, colorMode: mono)\n  .prismaticAberration(modulate: true)\n  .write(o0)\nrender(o0)',
    tags: ['filter', 'prismaticAberration', 'rainbow'],
    description: 'Monochrome noise with prismatic rainbow aberration',
  },
  {
    name: 'lit terrain',
    dsl: 'search synth, filter\n\nnoise(ridges: true)\n  .lighting(normalStrength: 2)\n  .write(o0)\nrender(o0)',
    tags: ['filter', 'lighting', 'normals', '3d-look'],
    description: 'Noise as a heightmap with dynamic lighting for 3D terrain look',
  },
  {
    name: 'cloud layer',
    dsl: 'search synth, filter\n\nsolid(color: #2d78f0)\n  .clouds(scale: 0.55)\n  .write(o0)\nrender(o0)',
    tags: ['filter', 'clouds', 'sky', 'atmosphere'],
    description: 'Procedural cloud layer over solid blue sky',
  },
  {
    name: 'fiber texture',
    dsl: 'search synth, filter\n\nsolid(color: #000000)\n  .fibers(density: 1)\n  .write(o0)\nrender(o0)',
    tags: ['filter', 'fibers', 'texture', 'overlay'],
    description: 'Fiber texture overlay on black background',
  },
  {
    name: 'scratched surface',
    dsl: 'search synth, filter\n\nsolid(color: #2b2b2b)\n  .scratches()\n  .write(o0)\nrender(o0)',
    tags: ['filter', 'scratches', 'texture', 'grunge'],
    description: 'Dark surface with scratch texture overlay',
  },
  {
    name: 'grime layer',
    dsl: 'search synth, filter\n\nsolid(color: #ffffff)\n  .grime(strength: 1)\n  .write(o0)\nrender(o0)',
    tags: ['filter', 'grime', 'texture', 'grunge'],
    description: 'Grime texture on white for aging/weathering effects',
  },
  {
    name: 'spattered ink',
    dsl: 'search synth, filter\n\nsolid(color: #d4d4d4)\n  .spatter(density: 1)\n  .write(o0)\nrender(o0)',
    tags: ['filter', 'spatter', 'texture', 'ink'],
    description: 'Ink spatter effect on light background',
  },
  {
    name: 'historic palette remap',
    dsl: 'search synth, filter\n\nnoise(ridges: true, colorMode: mono)\n  .historicPalette()\n  .write(o0)\nrender(o0)',
    tags: ['filter', 'historicPalette', 'color', 'remap'],
    description: 'Monochrome noise remapped through a historic color palette',
  },
  {
    name: 'tinted noise',
    dsl: 'search synth, filter\n\nnoise(ridges: true, colorMode: mono)\n  .tint(color: #ff0000, alpha: 0.5, mode: overlay)\n  .write(o0)\nrender(o0)',
    tags: ['filter', 'tint', 'color', 'overlay'],
    description: 'Monochrome noise with red tint overlay',
  },
  {
    name: 'oklab color',
    dsl: 'search synth, filter\n\nnoise(ridges: true)\n  .adjust(mode: oklab)\n  .write(o0)\nrender(o0)',
    tags: ['filter', 'colorspace', 'oklab', 'color'],
    description: 'Noise processed in perceptual oklab color space',
  },
  {
    name: 'hsv adjust',
    dsl: 'search synth, filter\n\nperlin(scale: 75, octaves: 2)\n  .adjust(mode: hsv, rotation: 120, hueRange: 40)\n  .write(o0)\nrender(o0)',
    tags: ['filter', 'adjust', 'hsv', 'color'],
    description: 'Perlin noise with HSV hue rotation and range adjustment',
  },
  {
    name: 'tetra color array',
    dsl: 'search synth, filter\n\nnoise()\n  .tetraColorArray(smoothness: 0)\n  .write(o0)\nrender(o0)',
    tags: ['filter', 'tetraColorArray', 'color', 'quantize'],
    description: 'Noise quantized to tetrahedral color array',
  },
  {
    name: 'tetra cosine',
    dsl: 'search synth, filter\n\nnoise()\n  .tetraCosine()\n  .write(o0)\nrender(o0)',
    tags: ['filter', 'tetraCosine', 'color', 'palette'],
    description: 'Noise remapped through cosine-based tetrahedral palette',
  },
  {
    name: 'cell smoothstep',
    dsl: 'search synth, filter\n\ncell()\n  .smoothstep(edge1: 0.51)\n  .write(o0)\nrender(o0)',
    tags: ['filter', 'smoothstep', 'threshold', 'cell'],
    description: 'Cell noise with smoothstep threshold for clean contours',
  },
  {
    name: 'sharpened pattern',
    dsl: 'search synth, filter\n\npattern(type: dots, smoothness: 0.04)\n  .sharpen(amount: 5)\n  .write(o0)\nrender(o0)',
    tags: ['filter', 'sharpen', 'pattern', 'crisp'],
    description: 'Dot pattern with heavy sharpening for crisp edges',
  },
  {
    name: 'smooth blur',
    dsl: 'search synth, filter\n\nmodPattern()\n  .smooth(type: blur, radius: 4)\n  .write(o0)\nrender(o0)',
    tags: ['filter', 'smooth', 'blur', 'modPattern'],
    description: 'Mod pattern with smoothing blur applied',
  },
  {
    name: 'spooky ticker',
    dsl: 'search synth, filter\n\nperlin()\n  .spookyTicker()\n  .write(o0)\nrender(o0)',
    tags: ['filter', 'spookyTicker', 'text', 'overlay'],
    description: 'Perlin noise with scrolling spooky ticker text overlay',
  },
  {
    name: 'text overlay',
    dsl: 'search synth, filter\n\nperlin(scale: 100)\n  .text()\n  .write(o0)\nrender(o0)',
    tags: ['filter', 'text', 'overlay', 'typography'],
    description: 'Perlin noise with text overlay',
  },
  {
    name: 'hair strands',
    dsl: 'search synth, filter\n\nperlin(scale: 100)\n  .strayHair()\n  .write(o0)\nrender(o0)',
    tags: ['filter', 'strayHair', 'texture', 'overlay'],
    description: 'Perlin texture with stray hair overlay for analog feel',
  },
  {
    name: 'paper texture',
    dsl: 'search synth, filter\n\nsolid(color: #d1d1d1)\n  .texture(alpha: 0.75)\n  .write(o0)\nrender(o0)',
    tags: ['filter', 'texture', 'paper', 'material'],
    description: 'Light gray with paper texture overlay',
  },
  {
    name: 'simple aberration',
    dsl: 'search synth, filter\n\nnoise(ridges: true, colorMode: mono)\n  .simpleAberration()\n  .write(o0)\nrender(o0)',
    tags: ['filter', 'simpleAberration', 'color-split', 'analog'],
    description: 'Monochrome noise with simple chromatic aberration',
  },
  {
    name: 'barrel distort',
    dsl: 'search synth, filter\n\nperlin(scale: 40, octaves: 2)\n  .lens(displacement: 0.5)\n  .write(o0)\nrender(o0)',
    tags: ['filter', 'lens', 'distortion', 'barrel'],
    description: 'Perlin noise with barrel lens distortion',
  },
  {
    name: 'bulge warp',
    dsl: 'search synth, filter\n\ncurl(scale: 20)\n  .bulge()\n  .write(o0)\nrender(o0)',
    tags: ['filter', 'bulge', 'distortion', 'warp'],
    description: 'Curl noise with center bulge distortion',
  },
  {
    name: 'degaussed signal',
    dsl: 'search synth, filter\n\nosc2d(freq: 12, speed: 3)\n  .degauss()\n  .write(o0)\nrender(o0)',
    tags: ['filter', 'degauss', 'analog', 'crt'],
    description: 'Oscillator signal with degauss magnetic distortion',
  },
  {
    name: 'heavy filter chain',
    dsl: 'search synth, filter\n\nnoise(ridges: true, octaves: 3)\n  .blur(radiusX: 3)\n  .bloom(taps: 10)\n  .chromaticAberration()\n  .vignette()\n  .grain()\n  .write(o0)\nrender(o0)',
    tags: ['filter', 'chain', 'post-processing', 'cinematic'],
    description: 'Noise through a cinematic post-processing chain: blur, bloom, aberration, vignette, grain',
  },
  {
    name: 'scrolling noise',
    dsl: 'search synth, filter\n\nnoise(ridges: true)\n  .scroll(speedX: 1, speedY: 0.5)\n  .write(o0)\nrender(o0)',
    tags: ['filter', 'scroll', 'motion', 'translate'],
    description: 'Ridged noise with continuous scrolling motion',
  },
  {
    name: 'skewed curl',
    dsl: 'search synth, filter\n\ncurl(scale: 15, octaves: 2)\n  .skew(wrap: repeat)\n  .write(o0)\nrender(o0)',
    tags: ['filter', 'skew', 'distortion', 'curl'],
    description: 'Curl noise with perspective skew transformation',
  },
  {
    name: 'cinematic grade',
    dsl: 'search synth, filter\n\nnoise(ridges: true, octaves: 3)\n  .grade(preset: cinematic)\n  .write(o0)\nrender(o0)',
    tags: ['filter', 'grade', 'lut', 'cinematic', 'color-grading'],
    description: 'Noise with cinematic LUT color grading applied',
  },
  {
    name: 'noir grade',
    dsl: 'search synth, filter\n\nperlin(scale: 40, octaves: 2, ridges: true)\n  .grade(preset: noir)\n  .vignette()\n  .write(o0)\nrender(o0)',
    tags: ['filter', 'grade', 'noir', 'lut', 'moody'],
    description: 'Perlin noise with noir LUT grading and vignette',
  },
  {
    name: 'retro dither',
    dsl: 'search synth, filter\n\nnoise(ridges: true)\n  .dither(type: bayer4x4, palette: commodore64)\n  .write(o0)\nrender(o0)',
    tags: ['filter', 'dither', 'retro', 'commodore64', 'pixel-art'],
    description: 'Noise dithered with Bayer matrix into Commodore 64 palette',
  },
  {
    name: 'pico8 dither',
    dsl: 'search synth, filter\n\ncell(scale: 60)\n  .dither(type: bayer8x8, palette: pico8, matrixScale: 3)\n  .write(o0)\nrender(o0)',
    tags: ['filter', 'dither', 'retro', 'pico8'],
    description: 'Cell noise dithered into PICO-8 palette for retro game look',
  },
  {
    name: 'cel shaded',
    dsl: 'search synth, filter\n\nperlin(scale: 40, octaves: 2)\n  .celShading(levels: 4, edgeWidth: 2, edgeThreshold: 0.15)\n  .write(o0)\nrender(o0)',
    tags: ['filter', 'celShading', 'cartoon', 'toon', 'edge'],
    description: 'Perlin noise with cel-shading: quantized levels and edge outlines',
  },
  {
    name: 'data corruption',
    dsl: 'search synth, filter\n\nnoise(ridges: true)\n  .corrupt(intensity: 60, bandHeight: 15, sort: 40, channelShift: 30)\n  .write(o0)\nrender(o0)',
    tags: ['filter', 'corrupt', 'glitch', 'databend'],
    description: 'Noise with data corruption glitch: banding, sorting, channel shift',
  },
  {
    name: 'crt monitor',
    dsl: 'search synth, filter\n\nosc2d(freq: 6, speed: 2)\n  .crt(speed: 1)\n  .write(o0)\nrender(o0)',
    tags: ['filter', 'crt', 'retro', 'monitor', 'scanlines'],
    description: 'Oscillator output through CRT monitor simulation',
  },
  {
    name: 'octave warp',
    dsl: 'search synth, filter\n\nnoise(ridges: true, octaves: 2)\n  .octaveWarp(freq: 3, octaves: 4, displacement: 0.3)\n  .write(o0)\nrender(o0)',
    tags: ['filter', 'octaveWarp', 'domain-warping', 'organic'],
    description: 'Noise domain-warped through multi-octave displacement',
  },
  {
    name: 'tiled noise',
    dsl: 'search synth, filter\n\nnoise(ridges: true)\n  .tile(symmetry: rotate4, scale: 0.5, repeat: 3)\n  .write(o0)\nrender(o0)',
    tags: ['filter', 'tile', 'symmetry', 'repeat', 'pattern'],
    description: 'Noise tiled with 4-fold rotational symmetry',
  },
  {
    name: 'seamless tile',
    dsl: 'search synth, filter\n\nperlin(scale: 30, octaves: 3)\n  .seamless(blend: 0.2, repeat: 2)\n  .write(o0)\nrender(o0)',
    tags: ['filter', 'seamless', 'tiling', 'repeatable'],
    description: 'Perlin noise made seamlessly tileable',
  },
  {
    name: 'repeated grid',
    dsl: 'search synth, filter\n\npolygon(sides: 5, radius: 0.3, bgAlpha: 0)\n  .repeat(x: 4, y: 4)\n  .write(o0)\nrender(o0)',
    tags: ['filter', 'repeat', 'grid', 'polygon'],
    description: 'Pentagon polygon repeated in a 4x4 grid',
  },
  {
    name: 'polar vortex',
    dsl: 'search synth, filter\n\nnoise(ridges: true, octaves: 2)\n  .polar(mode: vortex, scale: 1.5, speed: 1)\n  .write(o0)\nrender(o0)',
    tags: ['filter', 'polar', 'vortex', 'distortion'],
    description: 'Noise transformed through spinning polar vortex',
  },
  {
    name: 'pixel mosaic',
    dsl: 'search synth, filter\n\nnoise(ridges: true, octaves: 3)\n  .pixels(size: 16)\n  .write(o0)\nrender(o0)',
    tags: ['filter', 'pixels', 'mosaic', 'pixelate'],
    description: 'Noise pixelated into 16px mosaic blocks',
  },
  {
    name: 'edge detection',
    dsl: 'search synth, filter\n\ncell(scale: 50)\n  .edge(kernel: bold, amount: 200, invert: on)\n  .write(o0)\nrender(o0)',
    tags: ['filter', 'edge', 'detection', 'outline'],
    description: 'Cell noise with bold inverted edge detection',
  },
  {
    name: 'posterized steps',
    dsl: 'search synth, filter\n\nperlin(scale: 50, octaves: 3)\n  .posterize(levels: 6)\n  .write(o0)\nrender(o0)',
    tags: ['filter', 'posterize', 'quantize', 'levels'],
    description: 'Perlin noise posterized to 6 discrete levels',
  },
  {
    name: 'feedback self-refract',
    dsl: 'search synth, filter\n\nnoise(ridges: true)\n  .feedback(blendMode: overlay, mix: 50, refractAAmt: 30, aberration: 20)\n  .write(o0)\nrender(o0)',
    tags: ['filter', 'feedback', 'self-refract', 'chromatic'],
    description: 'Noise with overlay feedback, self-refraction and aberration',
  },
  {
    name: 'warp distortion',
    dsl: 'search synth, filter\n\ncell(scale: 40, cellSmooth: 50)\n  .warp(strength: 60, scale: 2)\n  .write(o0)\nrender(o0)',
    tags: ['filter', 'warp', 'distortion', 'organic'],
    description: 'Cell noise warped with noise-based distortion',
  },
  {
    name: 'pixel sort glitch',
    dsl: 'search synth, filter\n\nnoise(ridges: true, octaves: 2)\n  .pixelSort()\n  .write(o0)\nrender(o0)',
    tags: ['filter', 'pixelSort', 'glitch', 'sort'],
    description: 'Noise with pixel sorting glitch effect',
  },
  {
    name: 'ukiyo-e palette',
    dsl: 'search synth, filter\n\nperlin(scale: 30, octaves: 2, colorMode: mono)\n  .historicPalette(index: ukiyoe)\n  .write(o0)\nrender(o0)',
    tags: ['filter', 'historicPalette', 'ukiyoe', 'japanese'],
    description: 'Perlin noise through ukiyo-e woodblock print palette',
  },
  {
    name: 'pop art palette',
    dsl: 'search synth, filter\n\nnoise(ridges: true, colorMode: mono)\n  .historicPalette(index: popArt, repeat: 2)\n  .write(o0)\nrender(o0)',
    tags: ['filter', 'historicPalette', 'popArt', 'bold'],
    description: 'Ridged noise through pop art palette with double repeat',
  },
  {
    name: 'cosine palette remap',
    dsl: 'search synth, filter\n\nnoise(ridges: true, colorMode: mono)\n  .palette(index: brushedMetal)\n  .write(o0)\nrender(o0)',
    tags: ['filter', 'palette', 'cosine', 'color-remap'],
    description: 'Monochrome noise remapped through brushedMetal cosine palette',
  },
  {
    name: 'embossed noise',
    dsl: 'search synth, filter\n\nnoise(ridges: true, octaves: 3)\n  .emboss()\n  .write(o0)\nrender(o0)',
    tags: ['filter', 'emboss', 'relief', '3d-look'],
    description: 'Noise with emboss filter for raised relief appearance',
  },
  {
    name: 'sobel outlines',
    dsl: 'search synth, filter\n\ncell(scale: 50)\n  .sobel()\n  .write(o0)\nrender(o0)',
    tags: ['filter', 'sobel', 'edge', 'outline'],
    description: 'Cell noise with Sobel edge detection for clean outlines',
  },
  {
    name: 'grainy film',
    dsl: 'search synth, filter\n\nperlin(scale: 40, octaves: 2)\n  .grade(preset: warmFilm)\n  .grain(alpha: 0.3)\n  .write(o0)\nrender(o0)',
    tags: ['filter', 'grain', 'film', 'grade', 'analog'],
    description: 'Perlin with warm film grading and grain for analog feel',
  },

  // ── Mixer Programs ────────────────────────────────────────────────────

  {
    name: 'blend multiply',
    dsl: 'search synth, mixer\n\nnoise(ridges: true, colorMode: mono)\n  .write(o0)\n\nperlin()\n  .blendMode(tex: read(o0), mode: phoenix)\n  .write(o1)\nrender(o1)',
    tags: ['mixer', 'blendMode', 'phoenix', 'two-source'],
    description: 'Perlin blended with monochrome noise using phoenix blend mode',
  },
  {
    name: 'apply brightness',
    dsl: 'search synth, mixer\n\nnoise(seed: 1, ridges: true)\n  .write(o0)\n\nperlin()\n  .applyMode(tex: read(o0))\n  .write(o1)\nrender(o1)',
    tags: ['mixer', 'applyMode', 'brightness', 'two-source'],
    description: 'Apply brightness from ridged noise onto perlin noise',
  },
  {
    name: 'alpha masked polygon',
    dsl: 'search synth, mixer\n\npolygon(smooth: 0, bgAlpha: 0)\n  .write(o0)\n\nnoise(xScale: 100, yScale: 100)\n  .alphaMask(tex: read(o0))\n  .write(o1)\nrender(o1)',
    tags: ['mixer', 'alphaMask', 'polygon', 'masking'],
    description: 'Noise masked by polygon alpha channel for shaped cutout',
  },
  {
    name: 'center vignette blend',
    dsl: 'search synth, mixer\n\nnoise(ridges: true, colorMode: mono)\n  .write(o0)\n\nnoise(ridges: true)\n  .centerMask(tex: read(o0), mix: -75)\n  .write(o1)\nrender(o1)',
    tags: ['mixer', 'centerMask', 'vignette', 'blend'],
    description: 'Color noise centered with monochrome noise at edges via distance mask',
  },
  {
    name: 'cell split noise',
    dsl: 'search synth, mixer\n\nsolid(color: #000000)\n  .write(o0)\n\nnoise()\n  .cellSplit(tex: read(o0), invert: sourceB)\n  .write(o1)\nrender(o1)',
    tags: ['mixer', 'cellSplit', 'voronoi', 'masking'],
    description: 'Noise split into voronoi cell regions against black',
  },
  {
    name: 'distortion refract',
    dsl: 'search synth, mixer\n\ncell()\n  .write(o0)\n\nnoise(ridges: true)\n  .distortion(tex: read(o0))\n  .write(o1)\nrender(o1)',
    tags: ['mixer', 'distortion', 'refract', 'displacement'],
    description: 'Noise refracted through cell noise displacement map',
  },
  {
    name: 'pattern stripe mix',
    dsl: 'search synth, mixer\n\nnoise(ridges: true, colorMode: mono)\n  .write(o0)\n\nnoise(ridges: true)\n  .patternMix(tex: read(o0))\n  .write(o1)\nrender(o1)',
    tags: ['mixer', 'patternMix', 'stripes', 'geometric-blend'],
    description: 'Two noise sources mixed through geometric stripe pattern',
  },
  {
    name: 'drop shadow',
    dsl: 'search synth, mixer\n\nnoise(xScale: 100, yScale: 100)\n  .write(o0)\n\nnoise(ridges: true, colorMode: mono)\n  .shadow(tex: read(o0))\n  .write(o1)\nrender(o1)',
    tags: ['mixer', 'shadow', 'drop-shadow', 'compositing'],
    description: 'Monochrome noise casting shadow onto colored noise background',
  },
  {
    name: 'shape masked noise',
    dsl: 'search synth, mixer\n\nnoise(ridges: true, colorMode: mono)\n  .write(o0)\n\nnoise(ridges: true)\n  .shapeMask(tex: read(o0))\n  .write(o1)\nrender(o1)',
    tags: ['mixer', 'shapeMask', 'circle', 'masking'],
    description: 'Noise composited inside and outside a circular shape mask',
  },
  {
    name: 'soft split wipe',
    dsl: 'search synth, mixer\n\nnoise(ridges: true, colorMode: mono)\n  .write(o0)\n\nnoise(seed: 2, ridges: true)\n  .split(tex: read(o0), softness: 1)\n  .write(o1)\nrender(o1)',
    tags: ['mixer', 'split', 'wipe', 'transition'],
    description: 'Soft split wipe between two noise sources',
  },
  {
    name: 'threshold mask',
    dsl: 'search synth, mixer\n\nnoise()\n  .write(o0)\n\nsolid(color: #000000)\n  .thresholdMix(tex: read(o0))\n  .write(o1)\nrender(o1)',
    tags: ['mixer', 'thresholdMix', 'threshold', 'masking'],
    description: 'Noise thresholded against solid black for binary mask effect',
  },
  {
    name: 'uv remap',
    dsl: 'search synth, mixer\n\npattern()\n  .write(o0)\n\nnoise(ridges: true)\n  .uvRemap(tex: read(o0), scale: 25)\n  .write(o1)\nrender(o1)',
    tags: ['mixer', 'uvRemap', 'displacement', 'distortion'],
    description: 'Noise UV coordinates remapped using pattern color channels',
  },

  // ── Points / Particle Systems ─────────────────────────────────────────

  {
    name: 'basic flow field',
    dsl: 'search points, synth, render\n\nnoise(ridges: true)\n  .pointsEmit(stateSize: x256)\n  .flow(behavior: obedient, stride: 10)\n  .pointsRender(density: 50, intensity: 75)\n  .write(o0)\nrender(o0)',
    tags: ['points', 'flow', 'field', 'agents'],
    description: 'Agent-based flow field following noise luminosity gradients',
  },
  {
    name: 'crosshatch flow',
    dsl: 'search points, synth, render\n\nperlin(scale: 50, octaves: 2)\n  .pointsEmit(stateSize: x512)\n  .flow(behavior: crosshatch, stride: 15)\n  .pointsRender(density: 60, intensity: 80)\n  .write(o0)\nrender(o0)',
    tags: ['points', 'flow', 'crosshatch', 'drawing'],
    description: 'Crosshatch drawing style flow field from perlin noise',
  },
  {
    name: 'physical particles',
    dsl: 'search points, synth, render\n\nnoise(ridges: true)\n  .pointsEmit(stateSize: x256)\n  .physical(gravity: 0.05, energy: 0.5, drag: 0.15)\n  .pointsRender(density: 50)\n  .write(o0)\nrender(o0)',
    tags: ['points', 'physical', 'gravity', 'particles'],
    description: 'Physics-based particles with gravity and drag',
  },
  {
    name: 'zero-g particles',
    dsl: 'search points, synth, render\n\nnoise(ridges: true)\n  .pointsEmit(stateSize: x512, attrition: 2)\n  .physical(gravity: 0, energy: 0.98, drag: 0.05, wander: 0.5)\n  .pointsRender(density: 80, intensity: 90)\n  .write(o0)\nrender(o0)',
    tags: ['points', 'physical', 'zero-gravity', 'drift'],
    description: 'Drifting zero-gravity particles with high energy and wandering',
  },
  {
    name: 'flocking boids',
    dsl: 'search points, synth, render\n\ncell()\n  .pointsEmit(stateSize: x256)\n  .flock(separation: 2, alignment: 1, cohesion: 1)\n  .pointsRender(density: 40)\n  .write(o0)\nrender(o0)',
    tags: ['points', 'flock', 'boids', 'swarm'],
    description: 'Boids flocking simulation with cell noise input',
  },
  {
    name: 'lorenz attractor',
    dsl: 'search points, synth, render\n\nnoise()\n  .pointsEmit(stateSize: x1024)\n  .attractor(attractor: lorenz, speed: 0.5)\n  .pointsRender(viewMode: ortho, density: 80, intensity: 95)\n  .write(o0)\nrender(o0)',
    tags: ['points', 'attractor', 'lorenz', 'chaos', '3d-view'],
    description: 'Lorenz strange attractor with 3D orthographic view',
  },
  {
    name: 'physarum slime',
    dsl: 'search points, synth, render\n\nnoise()\n  .pointsEmit(stateSize: x512)\n  .physarum(moveSpeed: 1.5, turnSpeed: 1, deposit: 0.5, decay: 0.1)\n  .pointsRender(density: 60, intensity: 85)\n  .write(o0)\nrender(o0)',
    tags: ['points', 'physarum', 'slime-mold', 'simulation'],
    description: 'Physarum slime mold agent simulation with trail deposits',
  },
  {
    name: 'particle life',
    dsl: 'search points, synth, render\n\nnoise()\n  .pointsEmit(stateSize: x512)\n  .life(typeCount: 6, attractionScale: 1, friction: 0.1)\n  .pointsRender(density: 50)\n  .write(o0)\nrender(o0)',
    tags: ['points', 'life', 'attraction', 'emergent'],
    description: 'Particle life with 6 types attracting and repelling each other',
  },
  {
    name: 'dla crystal growth',
    dsl: 'search points, synth, render\n\nnoise()\n  .pointsEmit(stateSize: x256)\n  .dla(stride: 15, deposit: 10, decay: 0.25)\n  .pointsRender(density: 50, intensity: 90)\n  .write(o0)\nrender(o0)',
    tags: ['points', 'dla', 'crystal', 'aggregation'],
    description: 'Diffusion-limited aggregation for crystal-like growth patterns',
  },
  {
    name: 'hydraulic erosion',
    dsl: 'search points, synth, render\n\nperlin(scale: 30, octaves: 3)\n  .pointsEmit(stateSize: x512)\n  .hydraulic(stride: 10)\n  .pointsRender(density: 60, intensity: 85)\n  .write(o0)\nrender(o0)',
    tags: ['points', 'hydraulic', 'erosion', 'terrain'],
    description: 'Hydraulic erosion flow on perlin terrain heightmap',
  },
  {
    name: 'lenia artificial life',
    dsl: 'search points, synth, render\n\nnoise()\n  .pointsEmit(stateSize: x512)\n  .lenia(muK: 25, sigmaK: 5, muG: 0.25, sigmaG: 0.15)\n  .pointsRender(density: 60, intensity: 85)\n  .write(o0)\nrender(o0)',
    tags: ['points', 'lenia', 'artificial-life', 'continuous-ca'],
    description: 'Particle Lenia continuous artificial life simulation',
  },
  {
    name: 'billboard sprites',
    dsl: 'search points, synth, render\n\npolygon(radius: 0.7, fgAlpha: 0.1, bgAlpha: 0)\n  .write(o0)\n\nnoise(ridges: true)\n  .pointsEmit(stateSize: x64)\n  .physical(gravity: 0, energy: 0.98, drag: 0.125)\n  .pointsBillboardRender(tex: read(o0), shapeMode: texture, pointSize: 40, sizeVariation: 50)\n  .write(o1)\nrender(o1)',
    tags: ['points', 'billboard', 'sprites', 'textured-particles'],
    description: 'Textured billboard particles using polygon as sprite source',
  },
  {
    name: 'star particles',
    dsl: 'search points, synth, render\n\nnoise(ridges: true)\n  .pointsEmit(stateSize: x256, layout: ring)\n  .physical(gravity: 0, energy: 0.9, wander: 0.5)\n  .pointsBillboardRender(shapeMode: star, pointSize: 12, sizeVariation: 80)\n  .write(o0)\nrender(o0)',
    tags: ['points', 'billboard', 'star', 'ring-layout'],
    description: 'Star-shaped billboard particles emitted in a ring layout',
  },

  // ── Feedback Loops ────────────────────────────────────────────────────

  {
    name: 'warp feedback',
    dsl: 'search synth, filter, render\n\nnoise(ridges: true)\n  .loopBegin(alpha: 95, intensity: 95)\n  .warp()\n  .loopEnd()\n  .write(o0)\nrender(o0)',
    tags: ['feedback', 'loop', 'warp', 'accumulator'],
    description: 'Classic warp feedback loop — noise warps its own previous frame',
  },
  {
    name: 'blur feedback',
    dsl: 'search synth, filter, render\n\ncurl(scale: 20, ridges: true)\n  .loopBegin(alpha: 90, intensity: 90)\n  .blur(radiusX: 2)\n  .warp()\n  .loopEnd()\n  .write(o0)\nrender(o0)',
    tags: ['feedback', 'loop', 'blur', 'warp', 'dreamy'],
    description: 'Curl noise with blur and warp feedback for dreamy smearing effect',
  },
  {
    name: 'edge feedback',
    dsl: 'search synth, filter, render\n\nperlin(scale: 40, octaves: 2)\n  .loopBegin(alpha: 92, intensity: 88)\n  .edge()\n  .bloom(taps: 8)\n  .loopEnd()\n  .write(o0)\nrender(o0)',
    tags: ['feedback', 'loop', 'edge', 'bloom', 'glow'],
    description: 'Perlin noise with edge detection and bloom in feedback loop',
  },

  // ── 3D Volumetric ─────────────────────────────────────────────────────

  {
    name: '3d noise volume',
    dsl: 'search synth3d, filter3d, render\n\nnoise3d(volumeSize: x64, octaves: 2, ridges: true)\n  .render3d()\n  .write(o0)\nrender(o0)',
    tags: ['3d', 'noise3d', 'volume', 'raymarching'],
    description: '3D ridged noise volume rendered with raymarching',
  },
  {
    name: '3d lit noise',
    dsl: 'search synth3d, filter3d, render\n\nnoise3d()\n  .renderLit3d(specularIntensity: 2, shininess: 256)\n  .write(o0)\nrender(o0)',
    tags: ['3d', 'noise3d', 'lit', 'phong'],
    description: '3D noise volume with specular Phong lighting',
  },
  {
    name: '3d fractal',
    dsl: 'search synth3d, filter3d, render\n\nfractal3d(volumeSize: x64, type: mandelbulb, power: 8, iterations: 10)\n  .render3d()\n  .write(o0)\nrender(o0)',
    tags: ['3d', 'fractal3d', 'mandelbulb', 'fractal'],
    description: '3D Mandelbulb fractal volume raymarched at 64^3 resolution',
  },
  {
    name: '3d flythrough',
    dsl: 'search synth3d, filter3d, render\n\nflythrough3d(type: mandelbulb, power: 8, speed: 0.2)\n  .render3d()\n  .write(o0)\nrender(o0)',
    tags: ['3d', 'flythrough3d', 'mandelbulb', 'camera'],
    description: 'Mandelbulb fractal flythrough with camera-relative volume',
  },
  {
    name: '3d cell noise',
    dsl: 'search synth3d, filter3d, render\n\ncell3d(volumeSize: x64, metric: sphere, scale: 10, colorMode: rgb)\n  .render3d()\n  .write(o0)\nrender(o0)',
    tags: ['3d', 'cell3d', 'voronoi', 'volume'],
    description: '3D voronoi cell noise volume in RGB color mode',
  },
  {
    name: '3d shape morph',
    dsl: 'search synth3d, filter3d, render\n\nshape3d(loopAOffset: dodecahedron, loopBOffset: sphere, speedA: -2, speedB: 2)\n  .render3d(threshold: 0.75)\n  .write(o0)\nrender(o0)',
    tags: ['3d', 'shape3d', 'morph', 'polyhedra'],
    description: '3D shape morph between dodecahedron and sphere',
  },
  {
    name: '3d cellular automata',
    dsl: 'search synth3d, filter3d, render\n\nca3d(ruleIndex: diamoeba, volumeSize: x32)\n  .render3d()\n  .write(o0)\nrender(o0)',
    tags: ['3d', 'ca3d', 'cellular-automata', 'simulation'],
    description: '3D diamoeba cellular automaton rendered as volume',
  },
  {
    name: '3d reaction diffusion',
    dsl: 'search synth3d, filter3d, render\n\nrd3d(volumeSize: x32, iterations: 16, colorMode: gradient)\n  .render3d()\n  .write(o0)\nrender(o0)',
    tags: ['3d', 'rd3d', 'reaction-diffusion', 'simulation'],
    description: '3D reaction-diffusion with gradient coloring',
  },
  {
    name: '3d flow field',
    dsl: 'search synth3d, filter3d, render\n\nnoise3d(volumeSize: x32)\n  .flow3d(behavior: obedient, stride: 1, density: 20)\n  .render3d()\n  .write(o0)\nrender(o0)',
    tags: ['3d', 'flow3d', 'filter3d', 'agents'],
    description: '3D agent-based flow field inside a noise volume',
  },

  // ── Combined / Multi-Chain (Modern Namespace) ─────────────────────────

  {
    name: 'noise + filter + mixer',
    dsl: 'search synth, filter, mixer\n\nnoise(ridges: true, octaves: 3)\n  .bloom(taps: 10)\n  .write(o0)\n\nperlin(scale: 40, octaves: 2)\n  .blendMode(tex: read(o0), mode: screen)\n  .vignette()\n  .write(o1)\nrender(o1)',
    tags: ['combined', 'mixer', 'filter', 'blendMode', 'screen'],
    description: 'Bloomed noise and perlin screen-blended with vignette',
  },
  {
    name: 'flow on cell noise',
    dsl: 'search points, synth, render\n\ncell(scale: 60, cellSmooth: 20)\n  .pointsEmit(stateSize: x512)\n  .flow(behavior: meandering, stride: 12)\n  .pointsRender(density: 70, intensity: 85)\n  .write(o0)\nrender(o0)',
    tags: ['combined', 'points', 'flow', 'cell', 'meandering'],
    description: 'Meandering flow agents tracing cell noise gradients',
  },
  {
    name: 'feedback into mixer',
    dsl: 'search synth, filter, mixer, render\n\nnoise(ridges: true)\n  .loopBegin(alpha: 90, intensity: 90)\n  .warp()\n  .loopEnd()\n  .write(o0)\n\nperlin(scale: 30)\n  .blendMode(tex: read(o0), mode: overlay)\n  .write(o1)\nrender(o1)',
    tags: ['combined', 'feedback', 'mixer', 'overlay'],
    description: 'Warp feedback loop blended with perlin via overlay',
  },
  {
    name: 'distorted shapes',
    dsl: 'search synth, mixer\n\nshape(loopAOffset: icosahedron, loopBOffset: torus, wrap: true)\n  .write(o0)\n\nnoise(ridges: true)\n  .distortion(tex: read(o0), mode: refract, intensity: 70)\n  .write(o1)\nrender(o1)',
    tags: ['combined', 'mixer', 'distortion', 'shape', 'refract'],
    description: 'Noise refracted through shape morph displacement',
  },
  {
    name: 'lit 3d with bloom',
    dsl: 'search synth3d, filter3d, filter, render\n\nnoise3d(octaves: 2, ridges: true)\n  .renderLit3d(specularIntensity: 1.5, shininess: 128)\n  .bloom(taps: 12)\n  .vignette()\n  .write(o0)\nrender(o0)',
    tags: ['combined', '3d', 'lighting', 'bloom', 'post-processing'],
    description: '3D lit noise volume with bloom and vignette post-processing',
  },
]

// ═══════════════════════════════════════════════════════════════════════════
// SEARCH FUNCTION
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Simple keyword search over exemplar programs.
 * Tokenizes query, matches against name/tags/description, returns top N.
 */
export function searchExemplars(query: string, maxResults: number = 5): ExemplarProgram[] {
  const tokens = query
    .toLowerCase()
    .split(/[\s,]+/)
    .filter((t) => t.length > 1)

  if (tokens.length === 0) return DSL_EXEMPLAR_PROGRAMS.slice(0, maxResults)

  const scored = DSL_EXEMPLAR_PROGRAMS.map((program) => {
    const searchText = [
      program.name,
      ...program.tags,
      program.description,
    ]
      .join(' ')
      .toLowerCase()

    let score = 0
    for (const token of tokens) {
      // Exact tag match is strongest signal
      if (program.tags.some((tag) => tag === token)) {
        score += 3
      }
      // Name contains token
      if (program.name.toLowerCase().includes(token)) {
        score += 2
      }
      // Description/tags contain token
      if (searchText.includes(token)) {
        score += 1
      }
    }

    return { program, score }
  })

  return scored
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, maxResults)
    .map((s) => s.program)
}
