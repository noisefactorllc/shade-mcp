// Adapted for Noisemaker effects from gokayfem/shader-skills skills/shader-art-coding/glsl/debug.glsl
// at e09bc993bf04201f26c03c87c89210e9b472f526 (MIT, Copyright (c) 2026 gokayfem).
// The WGSL twin translates the same code. The licence text is in ../../license.ts; the upstream record is
// ../../provenance.json.

export const DEBUG_GLSL = `//! debug: visualize intermediate fields. The pack's DEBUG_MODE convention:
//!   0 final render | 1 distance field / contours | 2 normals | 3 material ids
//!   4 step count / depth | 5 masks / density | 6 lighting terms
//! While building, declare it as an agent-only global debugMode with define "DEBUG_MODE" (default 0), so each view
//! compiles as its own variant; remove the global and its branches before delivery.

/// Distance field as contour bands: warm outside, cool inside, white zero line. Bands are 0.1 units apart.
/// @use checking SDF scale, smoothness, wrong signs, bad blends (kinked or bunched contours)
vec3 debugDistance(float d) {
    vec3 col = (d > 0.0) ? vec3(0.9, 0.6, 0.3) : vec3(0.4, 0.7, 0.85);
    col *= 1.0 - exp(-4.0 * abs(d));
    col *= 0.8 + 0.2 * cos(TAU * d / 0.1);
    return mix(col, vec3(1.0), 1.0 - smoothstep(0.0, 0.01, abs(d)));
}

/// Normal as RGB.
/// @use spotting seams, flipped normals, noisy normals
vec3 debugNormal(vec3 n) { return 0.5 + 0.5 * n; }

/// Distinct color per integer id.
/// @use material ids, cell ids, instance ids
vec3 debugIdColor(float id) {
    return 0.55 + 0.45 * cos(TAU * (0.618034 * id + vec3(0.0, 0.33, 0.67)));
}

/// Heat ramp for a value in [0,1]: black, blue, magenta, orange, yellow, white.
/// @use step counts (steps / maxSteps), depth, cost, any scalar mask
vec3 debugHeat(float t) {
    t = clamp(t, 0.0, 1.0);
    return clamp(vec3(1.5 * t, 1.6 * t * t * t - 0.1, 0.9 * sin(PI * t) + 0.2 * t * t), 0.0, 1.0);
}
`

export const DEBUG_WGSL = `//! debug: visualize intermediate fields. The shader-craft DEBUG_MODE convention:
//!   0 final render | 1 distance field / contours | 2 normals | 3 material ids
//!   4 step count / depth | 5 masks / density | 6 lighting terms
//! While building, declare it as an agent-only global debugMode with define "DEBUG_MODE" (default 0), so each view
//! compiles as its own variant; remove the global and its branches before delivery.

/// Distance field as contour bands: warm outside, cool inside, white zero line. Bands are 0.1 units apart.
/// @use checking SDF scale, smoothness, wrong signs, bad blends (kinked or bunched contours)
fn debugDistance(d: f32) -> vec3f {
    var col = select(vec3f(0.4, 0.7, 0.85), vec3f(0.9, 0.6, 0.3), d > 0.0);
    col *= 1.0 - exp(-4.0 * abs(d));
    col *= 0.8 + 0.2 * cos(TAU * d / 0.1);
    return mix(col, vec3f(1.0), 1.0 - smoothstep(0.0, 0.01, abs(d)));
}

/// Normal as RGB.
/// @use spotting seams, flipped normals, noisy normals
fn debugNormal(n: vec3f) -> vec3f { return 0.5 + 0.5 * n; }

/// Distinct color per integer id.
/// @use material ids, cell ids, instance ids
fn debugIdColor(id: f32) -> vec3f {
    return 0.55 + 0.45 * cos(TAU * (0.618034 * id + vec3f(0.0, 0.33, 0.67)));
}

/// Heat ramp for a value in [0,1]: black, blue, magenta, orange, yellow, white.
/// @use step counts (steps / maxSteps), depth, cost, any scalar mask
fn debugHeat(t: f32) -> vec3f {
    let t_ = clamp(t, 0.0, 1.0);
    return clamp(vec3f(1.5 * t_, 1.6 * t_ * t_ * t_ - 0.1, 0.9 * sin(PI * t_) + 0.2 * t_ * t_), vec3f(0.0), vec3f(1.0));
}
`
