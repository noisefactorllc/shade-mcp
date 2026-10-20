// Adapted for Noisemaker effects from gokayfem/shader-skills skills/shader-art-coding/glsl/intersect.glsl
// at e09bc993bf04201f26c03c87c89210e9b472f526 (MIT, Copyright (c) 2026 gokayfem).
// The WGSL twin translates the same code. The licence text is in ../../license.ts; the upstream record is
// ../../provenance.json.

export const INTERSECT_GLSL = `//! intersect: analytic ray-primitive intersections. Rays are ro + t * rd with unit rd.
//! Use them for bounding volumes (clip the raymarch range to where the scene can be), exact floors and water planes,
//! glass spheres and eyeballs, and cheap reflections.
//! Formulas follow Inigo Quilez's article on ray-surface intersectors.

/// Ray vs plane dot(p, n) + h = 0 (unit n). Returns t, which is negative when the plane is behind the ray or parallel to it.
/// @use floors, water, mirrors, clipping marches to a ground plane
float iPlane(vec3 ro, vec3 rd, vec3 n, float h) {
    float denom = dot(rd, n);
    if (abs(denom) < 1e-8) return -1.0;
    return -(dot(ro, n) + h) / denom;
}

/// Ray vs sphere centered at c with radius r. Returns vec2(tNear, tFar), or vec2(-1) on a miss.
/// Uses the precision-friendly form that measures from the closest point on the ray.
/// @use bounding spheres, glass balls, eyeballs, planets, bubbles
vec2 iSphere(vec3 ro, vec3 rd, vec3 c, float r) {
    vec3 oc = ro - c;
    float b = dot(oc, rd);
    vec3 qc = oc - b * rd;
    float h = r * r - dot(qc, qc);
    if (h < 0.0) return vec2(-1.0);
    h = sqrt(h);
    return vec2(-b - h, -b + h);
}

/// Ray vs axis-aligned box centered at the origin with half-extents b (slab method).
/// Returns vec2(tNear, tFar), or vec2(-1) on a miss. Works when the ray starts inside (tNear < 0 < tFar).
/// An rd component of exactly 0 makes that axis's slab distances NaN (inf - inf or 0 * inf), which GLSL min and max
/// leave undefined, so the result depends on the GPU; keep rd components nonzero.
/// @use bounding boxes for raymarching, glass cubes, rooms
vec2 iBox(vec3 ro, vec3 rd, vec3 b) {
    vec3 m = 1.0 / rd;
    vec3 n = m * ro;
    vec3 k = abs(m) * b;
    vec3 t1 = -n - k;
    vec3 t2 = -n + k;
    float tN = max(max(t1.x, t1.y), t1.z);
    float tF = min(min(t2.x, t2.y), t2.z);
    if (tN > tF || tF < 0.0) return vec2(-1.0);
    return vec2(tN, tF);
}
`

export const INTERSECT_WGSL = `//! intersect: analytic ray-primitive intersections. Rays are ro + t * rd with unit rd.
//! Use them for bounding volumes (clip the raymarch range to where the scene can be), exact floors and water planes,
//! glass spheres and eyeballs, and cheap reflections.
//! Formulas follow Inigo Quilez's article on ray-surface intersectors.

/// Ray vs plane dot(p, n) + h = 0 (unit n). Returns t, which is negative when the plane is behind the ray or parallel to it.
/// @use floors, water, mirrors, clipping marches to a ground plane
fn iPlane(ro: vec3f, rd: vec3f, n: vec3f, h: f32) -> f32 {
    let denom = dot(rd, n);
    if (abs(denom) < 1e-8) { return -1.0; }
    return -(dot(ro, n) + h) / denom;
}

/// Ray vs sphere centered at c with radius r. Returns vec2f(tNear, tFar), or vec2f(-1) on a miss.
/// Uses the precision-friendly form that measures from the closest point on the ray.
/// @use bounding spheres, glass balls, eyeballs, planets, bubbles
fn iSphere(ro: vec3f, rd: vec3f, c: vec3f, r: f32) -> vec2f {
    let oc = ro - c;
    let b = dot(oc, rd);
    let qc = oc - b * rd;
    var h = r * r - dot(qc, qc);
    if (h < 0.0) { return vec2f(-1.0); }
    h = sqrt(h);
    return vec2f(-b - h, -b + h);
}

/// Ray vs axis-aligned box centered at the origin with half-extents b (slab method).
/// Returns vec2f(tNear, tFar), or vec2f(-1) on a miss. Works when the ray starts inside (tNear < 0 < tFar).
/// An rd component of exactly 0 makes that axis's slab distances NaN (inf - inf or 0 * inf), which GLSL min and max
/// leave undefined, so the result depends on the GPU; keep rd components nonzero.
/// @use bounding boxes for raymarching, glass cubes, rooms
fn iBox(ro: vec3f, rd: vec3f, b: vec3f) -> vec2f {
    let m = 1.0 / rd;
    let n = m * ro;
    let k = abs(m) * b;
    let t1 = -n - k;
    let t2 = -n + k;
    let tN = max(max(t1.x, t1.y), t1.z);
    let tF = min(min(t2.x, t2.y), t2.z);
    if (tN > tF || tF < 0.0) { return vec2f(-1.0); }
    return vec2f(tN, tF);
}
`
