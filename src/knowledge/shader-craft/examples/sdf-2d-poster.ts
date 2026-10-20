// Scene and material formulas adapted from the pinned shader-skills template.
// Full upstream provenance and MIT terms are attached by getShaderCraftExample.
export default {
  glsl: `const vec3 SKY_TOP = vec3(0.13, 0.10, 0.30);
const vec3 SKY_HORIZON = vec3(0.98, 0.52, 0.36);
const vec3 SUN = vec3(1.0, 0.86, 0.55);
const vec3 RIDGE_FAR = vec3(0.55, 0.30, 0.42);
const vec3 RIDGE_NEAR = vec3(0.20, 0.12, 0.26);
const vec3 FOLIAGE = vec3(0.07, 0.05, 0.12);
float ridge(vec2 uv, float base, float amp, float freq, float seed) {
    float h = base + amp * fbm(vec2(uv.x * freq + seed, seed), 5);
    return (uv.y - h) / sqrt(1.0 + 4.0 * amp * amp * freq * freq);
}
float plant(vec2 p) {
    float trunk = sdQuadraticBezier(p, vec2(0.0, -1.0), vec2(0.12, -0.45), vec2(0.02, 0.0)) - 0.025;
    vec2 q = p - vec2(0.02, 0.0);
    q = domPolar(q, 9.0);
    q.y += 0.06 * q.x * q.x;
    float leaf = sdVesica((q - vec2(0.24, 0.0)).yx, 0.32, 0.27);
    return min(trunk, leaf);
}
void main() {
    vec2 sampleCoord = gl_FragCoord.xy;
    vec2 uv = (2.0 * sampleCoord - resolution) / resolution.y;
    float px = 2.0 / resolution.y;
    vec3 col = mixOklab(srgbToLinear(SKY_HORIZON), srgbToLinear(SKY_TOP), smoothstep(-0.3, 1.0, uv.y));
    vec2 cell = floor(uv * 18.0);
    vec3 rnd = hash32(cell);
    float star = sdCircle(uv * 18.0 - cell - 0.2 - 0.6 * rnd.xy, 0.02 + 0.05 * rnd.z * rnd.z) / 18.0;
    float twinkle = 0.6 + 0.4 * sin(TAU * fract(time) * (1.0 + floor(3.0 * rnd.z)) + 6.0 * rnd.x);
    col += vec3(1.0, 0.95, 0.9) * fillAA(star, px) * smoothstep(0.1, 0.8, uv.y) * twinkle;
    vec2 sp = uv - vec2(0.42, 0.18);
    float sun = sdCircle(sp, 0.36);
    float gaps = filteredStripes(sp.y * 14.0 + 0.5, px * 14.0);
    float gapMask = mix(1.0, gaps, (1.0 - smoothstep(-0.3, 0.0, sp.y))) ;
    col = mix(col, srgbToLinear(SUN) * 1.6, fillAA(sun, px) * gapMask);
    col += srgbToLinear(SUN) * 0.25 * exp(-6.0 * max(sun, 0.0));
    col = mix(col, srgbToLinear(RIDGE_FAR), fillAA(ridge(uv, -0.1, 0.18, 1.2, 3.0), px));
    col = mix(col, mixOklab(srgbToLinear(RIDGE_FAR), srgbToLinear(RIDGE_NEAR), 0.6),
              fillAA(ridge(uv, -0.32, 0.14, 1.8, 11.0), px));
    col = mix(col, srgbToLinear(RIDGE_NEAR), fillAA(ridge(uv, -0.55, 0.10, 2.6, 23.0), px));
    float plants = min(plant((uv - vec2(-0.95, 0.15)) / 0.9) * 0.9, plant((uv - vec2(1.25, -0.05)) * vec2(-1.0, 1.0) / 0.7) * 0.7);
    col = mix(col, srgbToLinear(FOLIAGE), fillAA(plants, px));
    col = filmGrain(col, 0.04, hash13(vec3(sampleCoord, int(seed))) * 2.0 - 1.0);
    col = linearToSrgb(tonemapNeutral(col)) + ditherTPDF(sampleCoord, int(seed));
    fragColor = vec4(col, 1.0);
}
`,
  wgsl: `const SKY_TOP: vec3f = vec3f(0.13, 0.10, 0.30);

const SKY_HORIZON: vec3f = vec3f(0.98, 0.52, 0.36);

const SUN: vec3f = vec3f(1.0, 0.86, 0.55);

const RIDGE_FAR: vec3f = vec3f(0.55, 0.30, 0.42);

const RIDGE_NEAR: vec3f = vec3f(0.20, 0.12, 0.26);

const FOLIAGE: vec3f = vec3f(0.07, 0.05, 0.12);

fn ridge(uv_arg: vec2f, base_arg: f32, amp_arg: f32, freq_arg: f32, seed_arg: f32) -> f32 {
    var uv = uv_arg;
    var base = base_arg;
    var amp = amp_arg;
    var freq = freq_arg;
    var seed = seed_arg;
    var h: f32 = (base + (amp * fbm_f2i(vec2f(((uv.x * freq) + seed), seed), 5)));
    return (((uv.y - h)) / sqrt((1.0 + ((((4.0 * amp) * amp) * freq) * freq))));
}

fn plant(p_arg: vec2f) -> f32 {
    var p = p_arg;
    var trunk: f32 = (sdQuadraticBezier_f2f2f2f2(p, vec2f(0.0, (-1.0)), vec2f(0.12, (-0.45)), vec2f(0.02, 0.0)) - 0.025);
    var q: vec2f = (p - vec2f(0.02, 0.0));
    q = domPolar(q, 9.0);
    q.y += ((0.06 * q.x) * q.x);
    var leaf: f32 = sdVesica(((q - vec2f(0.24, 0.0))).yx, 0.32, 0.27);
    return min(trunk, leaf);
}

fn exampleMain() {

    var sampleCoord: vec2f = pixel;
    var uv: vec2f = ((((2.0 * sampleCoord) - resolution)) / vec2f(resolution.y));
    var px: f32 = (2.0 / resolution.y);
    var col: vec3f = mixOklab(srgbToLinear(SKY_HORIZON), srgbToLinear(SKY_TOP), smoothstep((-0.3), 1.0, uv.y));
    var cell: vec2f = floor((uv * 18.0));
    var rnd: vec3f = hash32(cell);
    var star: f32 = (sdCircle(((((uv * 18.0) - cell) - vec2f(0.2)) - (0.6 * rnd.xy)), (0.02 + ((0.05 * rnd.z) * rnd.z))) / 18.0);
    var twinkle: f32 = (0.6 + (0.4 * sin((((TAU * time) * ((1.0 + floor((3.0 * rnd.z))))) + (6.0 * rnd.x)))));
    col += (((vec3f(1.0, 0.95, 0.9) * fillAA_ff(star, px)) * smoothstep(0.1, 0.8, uv.y)) * twinkle);
    var sp: vec2f = (uv - vec2f(0.42, 0.18));
    var sun: f32 = sdCircle(sp, 0.36);
    var gaps: f32 = filteredStripes(((sp.y * 14.0) + 0.5), (px * 14.0));
    var gapMask: f32 = mix(1.0, gaps, (1.0 - smoothstep(-0.3, 0.0, sp.y)));
    col = mix(col, (srgbToLinear(SUN) * 1.6), (fillAA_ff(sun, px) * gapMask));
    col += ((srgbToLinear(SUN) * 0.25) * exp(((-6.0) * max(sun, 0.0))));
    col = mix(col, srgbToLinear(RIDGE_FAR), fillAA_ff(ridge(uv, (-0.1), 0.18, 1.2, 3.0), px));
    col = mix(col, mixOklab(srgbToLinear(RIDGE_FAR), srgbToLinear(RIDGE_NEAR), 0.6), fillAA_ff(ridge(uv, (-0.32), 0.14, 1.8, 11.0), px));
    col = mix(col, srgbToLinear(RIDGE_NEAR), fillAA_ff(ridge(uv, (-0.55), 0.10, 2.6, 23.0), px));
    var plants: f32 = min((plant((((uv - vec2f((-0.95), 0.15))) / vec2f(0.9))) * 0.9), (plant(((((uv - vec2f(1.25, (-0.05)))) * vec2f((-1.0), 1.0)) / vec2f(0.7))) * 0.7));
    col = mix(col, srgbToLinear(FOLIAGE), fillAA_ff(plants, px));
    col = filmGrain(col, 0.04, ((hash13(vec3f(sampleCoord, seed)) * 2.0) - 1.0));
    col = (linearToSrgb(tonemapNeutral(col)) + ditherTPDF(sampleCoord, i32(seed)));
    fragColor = vec4f(col, 1.0);
}
`,
}
