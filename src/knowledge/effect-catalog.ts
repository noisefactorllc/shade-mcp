export const EFFECT_CATALOG = `## Effect Catalog

**Do NOT guess parameter names.** Copy parameter names exactly from the example programs below or from the exemplar programs.
If no example shows parameters for an effect, use that effect with NO parameters. The effect then uses its defaults.

### SYNTH (Generators) - Start chains, create images from nothing
noise, fractal, julia, mandelbrot, newton, cell, perlin, curl, gabor, gradient,
media, mnca, modPattern, osc2d, pattern, polygon, rd, roll, ca, scope, shape,
solid, spectrum, subdivide, testPattern

### SYNTH3D (3D Volume Generators) - Use with render3d()
noise3d, fractal3d, cell3d, flythrough3d, shape3d, rd3d, ca3d

### FILTER (Processors) - Chain after generators
adjust, bloom, blur, bulge, celShading, cf, channel, chroma, chromaticAberration,
clouds, corrupt, crt, degauss, deriv, dither, edge, emboss, feedback,
fibers, flipMirror, fxaa, glowingEdge, glyphMap, grade, grain, grime, historicPalette,
inv, lens, lensWarp, lightLeak, lighting, lowPoly, motionBlur, normalMap,
normalize, octaveWarp, osd, outline, palette, pinch, pixelSort, pixels, polar,
posterize, prismaticAberration, reindex, repeat, reverb, ridge, rot, scale,
scanlineError, scratches, scroll, seamless, sharpen, simpleAberration, sine, skew,
smooth, smoothstep, snow, sobel, spatter, spiral, spookyTicker, step, strayHair,
tetraColorArray, tetraCosine, text, texture, thresh, tile, tint, translate, tunnel,
vaseline, vignette, warp, waves, wobble, wormhole, zoomBlur

### FILTER3D (3D Volume Processors)
flow3d

### POINTS (Particle Systems) - Use with pointsEmit()/pointsRender()
flow, physical, flock, attractor, life, hydraulic, dla, physarum, lenia

### RENDER (Pipeline Utilities)
render3d, renderLit3d, pointsEmit, pointsRender, pointsBillboardRender,
loopBegin, loopEnd, meshLoader, meshRender

### MIXER (Two-input blending) - Require tex: read(oN) parameter
blendMode, alphaMask, applyMode, cellSplit, centerMask, distortion, focusBlur,
patternMix, shadow, shapeMask, split, thresholdMix, uvRemap

### CLASSIC EFFECTS (classicNoisedeck namespace)
background, bitEffects, caustic, cellNoise, cellRefract, coalesce, colorLab,
composite, depthOfField, displaceMixer, effects, fractal, glitch, kaleido,
lensDistortion, moodscape, noise, noise3d, palette, pattern, quadTap, refract,
shapeMixer, shapes, shapes3d, splat, tunnel, warp

### CLASSIC EFFECTS (classicNoisemaker namespace)
kaleido, refract

### Parameter Examples (REAL, VERIFIED from working programs)
\`\`\`
noise(noiseType: 10, octaves: 2, xScale: 75, yScale: 75, ridges: true, colorMode: 6, hueRotation: 45, hueRange: 25, kaleido: 1, palette: afterimage)
shapes(loopAAmp: 50, loopAOffset: 60, loopAScale: 21, loopBAmp: 42, loopBOffset: 120, loopBScale: 54, palette: netOfGems, wrap: true)
cellNoise(scale: 75, cellScale: 87, cellSmooth: 11, cellVariation: 50, colorMode: 0, palette: royal)
fractal(fractalType: 0, zoomAmt: 0, rotation: 0, speed: 30, offsetX: 70, offsetY: 50, iterations: 50, colorMode: 4, palette: dealerHat)
pattern(patternType: 1, scale: 80, rotation: 0, lineWidth: 100, animation: 0, speed: 1, color1: #ffea31, color2: #000000)
solid(color: #000)
polygon(radius: 0.7, fgAlpha: 0.1, bgAlpha: 0)
text(text: "hello", font: "Audiowide", size: 0.09, posX: 0.375, color: #ffffff)
pointsEmit(stateSize: x64, attrition: 2.63)
physical(gravity: 0, energy: 0.98, drag: 0.125)
pointsRender(density: 100, inputIntensity: 20)
pointsBillboardRender(tex: read(o0), pointSize: 40, sizeVariation: 50, rotationVariation: 50)
loopBegin(alpha: 95, intensity: 95)
warp()
bloom(taps: 15)
blur(radiusX: 5)
vignette()
lens(displacement: -0.5)
chromaticAberration(aberrationAmt: 25)
coalesce(tex: read(o0), blendMode: 8, mixAmt: -51, refractAAmt: 0, refractBAmt: 71)
blendMode(tex: read(o0), mode: multiply)
lensDistortion(aberrationAmt: 100, distortion: -48, opacity: 12, shape: 0, tint: #b42f2d, vignetteAmt: -46)
colorLab(colorMode: 2, dither: 0, hueRange: 100, hueRotation: 0, levels: 2, palette: seventiesShirt)
effects(effect: 4, effectAmt: 2, flip: 0, offsetX: 0, offsetY: 0, rotation: 0, scaleAmt: 100)
posterize(levels: 6)
outline()
adjust(mode: hsv)
adjust(rotation: 120, hueRange: 40)
adjust()
\`\`\`
`
