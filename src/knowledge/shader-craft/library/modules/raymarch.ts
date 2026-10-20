// Adapted for Noisemaker effects from gokayfem/shader-skills skills/shader-art-coding/glsl/raymarch.glsl
// at e09bc993bf04201f26c03c87c89210e9b472f526 (MIT, Copyright (c) 2026 gokayfem).
// The WGSL twin translates the same code. The licence text is in ../../license.ts; the upstream record is
// ../../provenance.json.

export const RAYMARCH_GLSL = `//! raymarch: sphere tracing, normals, soft shadows and ambient occlusion for SDF scenes.
//! SCENE CONTRACT: the program defines   vec2 map(vec3 p)   returning vec2(distance, materialId).
//! Packing the material into a vec2 avoids structs (WebGL forbids ?: on structs) and works with every helper here.
//! Loops start at ZERO, a zero the compiler cannot prove. That stops it inlining map() into every loop, which
//! keeps compile times sane and avoids WebGL compiler crashes on large scenes. Library code reads no uniforms, so the
//! program defines ZERO from its own int frame uniform before the library code:   #define ZERO (min(frame, 0))

vec2 map(vec3 p);

const int RAYMARCH_MAX_STEPS = 256;

/// Sphere-trace from ro along unit rd between tmin and tmax.
/// Returns vec3(t, materialId, stepCount). t is -1 on a miss.
/// The hit threshold grows with t (about one pixel's footprint), so distant surfaces don't burn steps.
/// stepScale is 1 for exact or bound fields. Use < 1 (e.g. 0.6) when map() has Lipschitz > 1 (displacement, warps, twist).
/// @use every SDF raymarcher
/// @see Inigo Quilez, raymarching distance fields
vec3 raymarch(vec3 ro, vec3 rd, float tmin, float tmax, float stepScale) {
    float t = tmin;
    for (int i = ZERO; i < RAYMARCH_MAX_STEPS; i++) {
        vec2 h = map(ro + rd * t);
        if (abs(h.x) < max(0.0002 * t, 1e-5)) return vec3(t, h.y, float(i));
        t += h.x * stepScale;
        if (t > tmax) break;
    }
    return vec3(-1.0, -1.0, float(RAYMARCH_MAX_STEPS));
}

/// Surface normal from 4 tetrahedral samples (cheaper than 6 central differences, and still centered).
/// eps should scale with distance, e.g. 0.0005 * t: that filters distant detail and avoids sparkling.
/// @use shading any SDF hit
/// @see Inigo Quilez, normals for an SDF
vec3 calcNormal(vec3 p, float eps) {
    vec3 n = vec3(0.0);
    for (int i = ZERO; i < 4; i++) {
        vec3 e = 0.5773 * (2.0 * vec3((((i + 3) >> 1) & 1), ((i >> 1) & 1), (i & 1)) - 1.0);
        n += e * map(p + e * eps).x;
    }
    return normalize(n);
}

/// Soft shadow toward a light along unit rd. k controls sharpness (k is about 1 / light angular size: 8 soft, 32 hard).
/// Uses the "closest approach between samples" estimate, which removes banding from sharp-cornered occluders.
/// Returns 0 (full shadow) .. 1 (lit).
/// @use sun shadows, contact shadows, penumbrae
/// @see Inigo Quilez, soft shadows
float softShadow(vec3 ro, vec3 rd, float tmin, float tmax, float k) {
    float res = 1.0;
    float t = tmin;
    float ph = 1e10;
    for (int i = ZERO; i < 64; i++) {
        float h = map(ro + rd * t).x;
        if (h < 0.0001) return 0.0;
        float y = h * h / (2.0 * ph);
        float d = sqrt(max(h * h - y * y, 0.0));
        res = min(res, k * d / max(t - y, 1e-4));
        ph = h;
        t += clamp(h, 0.005, 0.5);
        if (res < 0.001 || t > tmax) break;
    }
    res = clamp(res, 0.0, 1.0);
    return res * res * (3.0 - 2.0 * res);
}

/// Ambient occlusion from 5 distance samples along the normal. Compares the expected distance with the actual one.
/// scale is the sampling reach in scene units (about 0.12 for a unit-sized object). Returns 0 (occluded) .. 1 (open).
/// @use crevices, contact darkening, grounding objects on floors
/// @see Inigo Quilez, "Rendering Worlds with Two Triangles" (NVScene 2008)
float calcAO(vec3 p, vec3 n, float scale) {
    float occ = 0.0;
    float weight = 1.0;
    for (int i = ZERO; i < 5; i++) {
        float h = 0.01 + scale * float(i) / 4.0;
        float d = map(p + h * n).x;
        occ += (h - d) * weight;
        weight *= 0.95;
    }
    return clamp(1.0 - 3.0 * occ / max(scale / 0.12, 1e-3), 0.0, 1.0);
}

/// Thickness behind a surface point, estimated by sampling the SDF inside along -n (an "inverse AO").
/// Returns 0 (thin, light passes through) .. 1 (thick). maxDepth is the deepest sample in scene units.
/// @use translucency, subsurface tint, wax and jade, glowing thin edges
float sdfThickness(vec3 p, vec3 n, float maxDepth) {
    float acc = 0.0;
    for (int i = ZERO; i < 4; i++) {
        float h = maxDepth * (float(i) + 1.0) / 4.0;
        acc += clamp(-map(p - n * h).x / h, 0.0, 1.0);
    }
    return acc / 4.0;
}
`

export const RAYMARCH_WGSL = `//! raymarch: sphere tracing, normals, soft shadows and ambient occlusion for SDF scenes.
//! SCENE CONTRACT: the program defines   fn map(p: vec3f) -> vec2f   returning vec2f(distance, materialId).
//! Packing the material into a vec2f works with every helper here and matches the GLSL twin.
//! Loops start at ZERO, a zero the compiler cannot prove. That stops it inlining map() into every loop, which
//! keeps compile times sane on large scenes. Library code reads no uniforms, so the program declares ZERO and sets it
//! from its own frame uniform at the top of its entry point:   var<private> ZERO: i32;   ...   ZERO = min(frame, 0);

const RAYMARCH_MAX_STEPS: i32 = 256;

/// Sphere-trace from ro along unit rd between tmin and tmax.
/// Returns vec3f(t, materialId, stepCount). t is -1 on a miss.
/// The hit threshold grows with t (about one pixel's footprint), so distant surfaces don't burn steps.
/// stepScale is 1 for exact or bound fields. Use < 1 (e.g. 0.6) when map() has Lipschitz > 1 (displacement, warps, twist).
/// @use every SDF raymarcher
/// @see Inigo Quilez, raymarching distance fields
fn raymarch(ro: vec3f, rd: vec3f, tmin: f32, tmax: f32, stepScale: f32) -> vec3f {
    var t = tmin;
    for (var i = ZERO; i < RAYMARCH_MAX_STEPS; i++) {
        let h = map(ro + rd * t);
        if (abs(h.x) < max(0.0002 * t, 1e-5)) { return vec3f(t, h.y, f32(i)); }
        t += h.x * stepScale;
        if (t > tmax) { break; }
    }
    return vec3f(-1.0, -1.0, f32(RAYMARCH_MAX_STEPS));
}

/// Surface normal from 4 tetrahedral samples (cheaper than 6 central differences, and still centered).
/// eps should scale with distance, e.g. 0.0005 * t: that filters distant detail and avoids sparkling.
/// @use shading any SDF hit
/// @see Inigo Quilez, normals for an SDF
fn calcNormal(p: vec3f, eps: f32) -> vec3f {
    var n = vec3f(0.0);
    for (var i = ZERO; i < 4; i++) {
        let e = 0.5773 * (2.0 * vec3f(vec3i(((i + 3) >> 1u) & 1, (i >> 1u) & 1, i & 1)) - 1.0);
        n += e * map(p + e * eps).x;
    }
    return normalize(n);
}

/// Soft shadow toward a light along unit rd. k controls sharpness (k is about 1 / light angular size: 8 soft, 32 hard).
/// Uses the "closest approach between samples" estimate, which removes banding from sharp-cornered occluders.
/// Returns 0 (full shadow) .. 1 (lit).
/// @use sun shadows, contact shadows, penumbrae
/// @see Inigo Quilez, soft shadows
fn softShadow(ro: vec3f, rd: vec3f, tmin: f32, tmax: f32, k: f32) -> f32 {
    var res = 1.0;
    var t = tmin;
    var ph = 1e10;
    for (var i = ZERO; i < 64; i++) {
        let h = map(ro + rd * t).x;
        if (h < 0.0001) { return 0.0; }
        let y = h * h / (2.0 * ph);
        let d = sqrt(max(h * h - y * y, 0.0));
        res = min(res, k * d / max(t - y, 1e-4));
        ph = h;
        t += clamp(h, 0.005, 0.5);
        if (res < 0.001 || t > tmax) { break; }
    }
    res = clamp(res, 0.0, 1.0);
    return res * res * (3.0 - 2.0 * res);
}

/// Ambient occlusion from 5 distance samples along the normal. Compares the expected distance with the actual one.
/// scale is the sampling reach in scene units (about 0.12 for a unit-sized object). Returns 0 (occluded) .. 1 (open).
/// @use crevices, contact darkening, grounding objects on floors
/// @see Inigo Quilez, "Rendering Worlds with Two Triangles" (NVScene 2008)
fn calcAO(p: vec3f, n: vec3f, scale: f32) -> f32 {
    var occ = 0.0;
    var weight = 1.0;
    for (var i = ZERO; i < 5; i++) {
        let h = 0.01 + scale * f32(i) / 4.0;
        let d = map(p + h * n).x;
        occ += (h - d) * weight;
        weight *= 0.95;
    }
    return clamp(1.0 - 3.0 * occ / max(scale / 0.12, 1e-3), 0.0, 1.0);
}

/// Thickness behind a surface point, estimated by sampling the SDF inside along -n (an "inverse AO").
/// Returns 0 (thin, light passes through) .. 1 (thick). maxDepth is the deepest sample in scene units.
/// @use translucency, subsurface tint, wax and jade, glowing thin edges
fn sdfThickness(p: vec3f, n: vec3f, maxDepth: f32) -> f32 {
    var acc = 0.0;
    for (var i = ZERO; i < 4; i++) {
        let h = maxDepth * (f32(i) + 1.0) / 4.0;
        acc += clamp(-map(p - n * h).x / h, 0.0, 1.0);
    }
    return acc / 4.0;
}
`
