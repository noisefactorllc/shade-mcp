// Adapted for Noisemaker effects from gokayfem/shader-skills skills/shader-art-coding/glsl/common.glsl
// at e09bc993bf04201f26c03c87c89210e9b472f526 (MIT, Copyright (c) 2026 gokayfem).
// The WGSL twin translates the same code. The licence text is in ../../license.ts; the upstream record is
// ../../provenance.json.

export const COMMON_GLSL = `//! common: constants, rotation, remapping and shaping functions.
//! Target: GLSL ES 3.00 as Noisemaker effects use it (WebGL2). Every function here is original and MIT licensed.
//! Programs that use the library declare   precision highp float; precision highp int;   (the hashes need 32-bit uint).

const float PI = 3.14159265358979;
const float TAU = 6.28318530717959;

/// Clamp to [0,1].
/// @use masks, weights, colors
float saturate(float x) { return clamp(x, 0.0, 1.0); }
vec3 saturate(vec3 x) { return clamp(x, 0.0, 1.0); }

/// Squared length.
/// @use cheap distance comparisons, SDF internals
float dot2(vec2 v) { return dot(v, v); }
float dot2(vec3 v) { return dot(v, v); }

/// 2D rotation matrix. \`rot2(a) * v\` rotates v counter-clockwise by a radians.
/// (cos, sin) is renormalized because GLSL ES leaves trig precision undefined: on SwiftShader and some mobile
/// GPUs a raw cos/sin pair is far enough from unit length that rotations stop preserving distances.
/// @use spinning parts, posing limbs, rotating octaves, camera roll
mat2 rot2(float a) {
    vec2 cs = normalize(vec2(cos(a), sin(a)));
    return mat2(cs.x, cs.y, -cs.y, cs.x);
}

/// Linear remap of x from [a,b] to [c,d] (unclamped).
/// @use converting ranges, rescaling noise
float remap(float x, float a, float b, float c, float d) {
    return c + (d - c) * (x - a) / (b - a);
}

/// Linear ramp from 0 at a to 1 at b, clamped.
/// @use masks whose falloff should not ease in or out
float linearstep(float a, float b, float x) {
    return clamp((x - a) / (b - a), 0.0, 1.0);
}

/// Smooth bump: 1 at x == c, falling to 0 at |x - c| >= w (cubic).
/// @use stripes, rings, highlights at one height, pulses in time
float cubicPulse(float c, float w, float x) {
    x = abs(x - c);
    if (x > w) return 0.0;
    x /= w;
    return 1.0 - x * x * (3.0 - 2.0 * x);
}

/// Fast attack, exponential decay. Peaks at 1 when x == 1/k.
/// @use heartbeat motion, impacts, flashes, plucked-string envelopes
float expImpulse(float x, float k) {
    float h = k * x;
    return h * exp(1.0 - h);
}

/// Contrast curve on [0,1] that keeps 0, 0.5 and 1 fixed. k > 1 adds contrast, k < 1 flattens.
/// @use tightening masks, adjusting animation easing
float gain(float x, float k) {
    float a = 0.5 * pow(2.0 * ((x < 0.5) ? x : 1.0 - x), k);
    return (x < 0.5) ? a : 1.0 - a;
}

/// 0 at x = 0 and x = 1, peak 1 at x = 0.5; k sharpens.
/// @use petal width along length, leaf profiles, arches
float parabola(float x, float k) {
    return pow(4.0 * x * (1.0 - x), k);
}

/// Returns x when x > m; smoothly bottoms out at n when x -> 0. Needs 2n < m.
/// @use avoiding hard zero in falloffs, soft floor on thickness
float almostIdentity(float x, float m, float n) {
    if (x > m) return x;
    float a = 2.0 * n - m;
    float b = 2.0 * m - 3.0 * n;
    float t = x / m;
    return (a * t + b) * t * t + n;
}
`

export const COMMON_WGSL = `//! common: constants, rotation, remapping and shaping functions.
//! Target: WGSL as Noisemaker effects use it (WebGPU); the twin of the GLSL module. Every function here is original
//! and MIT licensed.

const PI: f32 = 3.14159265358979;
const TAU: f32 = 6.28318530717959;

/// Clamp to [0,1].
/// @use masks, weights, colors
fn saturate_f(x: f32) -> f32 { return clamp(x, 0.0, 1.0); }
fn saturate_f3(x: vec3f) -> vec3f { return clamp(x, vec3f(0.0), vec3f(1.0)); }

/// Squared length.
/// @use cheap distance comparisons, SDF internals
fn dot2_f2(v: vec2f) -> f32 { return dot(v, v); }
fn dot2_f3(v: vec3f) -> f32 { return dot(v, v); }

/// 2D rotation matrix. \`rot2(a) * v\` rotates v counter-clockwise by a radians.
/// (cos, sin) is renormalized because trig precision is not guaranteed: on SwiftShader and some mobile
/// GPUs a raw cos/sin pair is far enough from unit length that rotations stop preserving distances.
/// @use spinning parts, posing limbs, rotating octaves, camera roll
fn rot2(a: f32) -> mat2x2f {
    let cs = normalize(vec2f(cos(a), sin(a)));
    return mat2x2f(cs.x, cs.y, -cs.y, cs.x);
}

/// Linear remap of x from [a,b] to [c,d] (unclamped).
/// @use converting ranges, rescaling noise
fn remap(x: f32, a: f32, b: f32, c: f32, d: f32) -> f32 {
    return c + (d - c) * (x - a) / (b - a);
}

/// Linear ramp from 0 at a to 1 at b, clamped.
/// @use masks whose falloff should not ease in or out
fn linearstep(a: f32, b: f32, x: f32) -> f32 {
    return clamp((x - a) / (b - a), 0.0, 1.0);
}

/// Smooth bump: 1 at x == c, falling to 0 at |x - c| >= w (cubic).
/// @use stripes, rings, highlights at one height, pulses in time
fn cubicPulse(c: f32, w: f32, x: f32) -> f32 {
    var x_ = abs(x - c);
    if (x_ > w) { return 0.0; }
    x_ /= w;
    return 1.0 - x_ * x_ * (3.0 - 2.0 * x_);
}

/// Fast attack, exponential decay. Peaks at 1 when x == 1/k.
/// @use heartbeat motion, impacts, flashes, plucked-string envelopes
fn expImpulse(x: f32, k: f32) -> f32 {
    let h = k * x;
    return h * exp(1.0 - h);
}

/// Contrast curve on [0,1] that keeps 0, 0.5 and 1 fixed. k > 1 adds contrast, k < 1 flattens.
/// @use tightening masks, adjusting animation easing
fn gain(x: f32, k: f32) -> f32 {
    let a = 0.5 * pow(2.0 * select(1.0 - x, x, x < 0.5), k);
    return select(1.0 - a, a, x < 0.5);
}

/// 0 at x = 0 and x = 1, peak 1 at x = 0.5; k sharpens.
/// @use petal width along length, leaf profiles, arches
fn parabola(x: f32, k: f32) -> f32 {
    return pow(4.0 * x * (1.0 - x), k);
}

/// Returns x when x > m; smoothly bottoms out at n when x -> 0. Needs 2n < m.
/// @use avoiding hard zero in falloffs, soft floor on thickness
fn almostIdentity(x: f32, m: f32, n: f32) -> f32 {
    if (x > m) { return x; }
    let a = 2.0 * n - m;
    let b = 2.0 * m - 3.0 * n;
    let t = x / m;
    return (a * t + b) * t * t + n;
}
`
