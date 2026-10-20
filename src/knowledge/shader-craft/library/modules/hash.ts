// Adapted for Noisemaker effects from gokayfem/shader-skills skills/shader-art-coding/glsl/hash.glsl
// at e09bc993bf04201f26c03c87c89210e9b472f526 (MIT, Copyright (c) 2026 gokayfem).
// The WGSL twin translates the same code. The licence text is in ../../license.ts; the upstream record is
// ../../provenance.json.

export const HASH_GLSL = `//! hash: integer hashes and float wrappers for lattice ids.
//! Naming: hashNM returns N floats from M inputs (hash12 = 1 output, 2 inputs). Outputs are in [0,1).
//! The float wrappers hash INTEGER-VALUED inputs (cell ids, pixel coords, frame numbers). Fractional parts
//! are dropped. That is deliberate: negative float -> uint is undefined in GLSL, and round() can return -0.0,
//! which has different bits from 0.0. Converting through int avoids both. To hash a continuous value, scale it first.
//! Keep inputs inside the 32-bit int range: GLSL leaves larger values undefined and WGSL clamps them, so the two
//! languages agree only inside it.
//! Do not use fract(sin(dot(p, k)) * 43758.5453): its result changes across GPUs and degrades at large inputs.
//! Integer mixers are from Jarzynski and Olano, "Hash Functions for GPU Rendering" (JCGT 2020): pcg3d and pcg4d sit
//! on that study's quality/speed frontier, and 32-bit integer math is bit-exact on every GPU, unlike sin().

/// PCG-style 1D integer hash.
/// @use seeding, per-instance randomness, building other hashes
/// @see Jarzynski and Olano, "Hash Functions for GPU Rendering", JCGT 9(3), 2020
uint pcgHash(uint v) {
    uint state = v * 747796405u + 2891336453u;
    uint word = ((state >> ((state >> 28u) + 4u)) ^ state) * 277803737u;
    return (word >> 22u) ^ word;
}

/// 3D integer hash, three decorrelated outputs.
/// @use 3D cell ids, voxel jitter, (pixel, frame) noise
/// @see Jarzynski and Olano, "Hash Functions for GPU Rendering", JCGT 9(3), 2020
uvec3 pcg3d(uvec3 v) {
    v = v * 1664525u + 1013904223u;
    v.x += v.y * v.z;
    v.y += v.z * v.x;
    v.z += v.x * v.y;
    v ^= v >> 16u;
    v.x += v.y * v.z;
    v.y += v.z * v.x;
    v.z += v.x * v.y;
    return v;
}

/// 4D integer hash, four decorrelated outputs (0 BigCrush failures in the JCGT study).
/// @use (pixel.x, pixel.y, frame, sample) streams for stochastic sampling, 4D cell ids
/// @see Jarzynski and Olano, "Hash Functions for GPU Rendering", JCGT 9(3), 2020
uvec4 pcg4d(uvec4 v) {
    v = v * 1664525u + 1013904223u;
    v.x += v.y * v.w;
    v.y += v.z * v.x;
    v.z += v.x * v.y;
    v.w += v.y * v.z;
    v ^= v >> 16u;
    v.x += v.y * v.w;
    v.y += v.z * v.x;
    v.z += v.x * v.y;
    v.w += v.y * v.z;
    return v;
}

/// Map a uint to [0,1) using the top 24 bits, so the result can never round up to 1.0.
float uintToUnit(uint h) { return float(h >> 8u) * (1.0 / 16777216.0); }
vec2 uintToUnit(uvec2 h) { return vec2(h >> 8u) * (1.0 / 16777216.0); }
vec3 uintToUnit(uvec3 h) { return vec3(h >> 8u) * (1.0 / 16777216.0); }
vec4 uintToUnit(uvec4 h) { return vec4(h >> 8u) * (1.0 / 16777216.0); }

/// Random float in [0,1) for an integer-valued input.
/// @use per-cell randomness, stable random per instance id
/// @range [0,1)
float hash11(float p) { return uintToUnit(pcgHash(uint(int(floor(p))))); }

/// Random float in [0,1) for an integer-valued 2D input.
/// @use per-cell variation (color, height, rotation), sparse spots, star fields
/// @range [0,1)
float hash12(vec2 p) {
    uvec2 q = uvec2(ivec2(floor(p)));
    return uintToUnit(pcgHash(q.x + pcgHash(q.y)));
}

/// Random float in [0,1) for an integer-valued 3D input.
/// @use per-voxel randomness, per-pixel-per-frame noise via hash13(vec3(gl_FragCoord.xy, frame))
/// @range [0,1)
float hash13(vec3 p) {
    uvec3 q = uvec3(ivec3(floor(p)));
    return uintToUnit(pcgHash(q.x + pcgHash(q.y + pcgHash(q.z))));
}

/// Random vec2 in [0,1)^2 for an integer-valued 2D input.
/// @use Voronoi feature points, 2D jitter, random gradients
/// @range [0,1)^2
vec2 hash22(vec2 p) {
    ivec2 q = ivec2(floor(p));
    return uintToUnit(pcg3d(uvec3(q.x, q.y, 0x2545u))).xy;
}

/// Random vec3 in [0,1)^3 for an integer-valued 3D input.
/// @use 3D Voronoi points, random colors per cell, random directions
/// @range [0,1)^3
vec3 hash33(vec3 p) { return uintToUnit(pcg3d(uvec3(ivec3(floor(p))))); }

/// Random vec4 in [0,1)^4 for an integer-valued 4D input.
/// @use per-pixel, per-frame, per-sample random numbers: hash44(vec4(gl_FragCoord.xy, frame, sampleIndex))
/// @range [0,1)^4
vec4 hash44(vec4 p) { return uintToUnit(pcg4d(uvec4(ivec4(floor(p))))); }

/// Random vec3 in [0,1)^3 for an integer-valued 2D input.
/// @use per-tile random color, per-cell (offset, rotation, scale) triples
/// @range [0,1)^3
vec3 hash32(vec2 p) {
    ivec2 q = ivec2(floor(p));
    return uintToUnit(pcg3d(uvec3(q.x, q.y, 0x9E37u)));
}
`

export const HASH_WGSL = `//! hash: integer hashes and float wrappers for lattice ids.
//! Naming: hashNM returns N floats from M inputs (hash12 = 1 output, 2 inputs). Outputs are in [0,1).
//! The float wrappers hash INTEGER-VALUED inputs (cell ids, pixel coords, frame numbers). Fractional parts
//! are dropped. That is deliberate: negative float -> uint is undefined in GLSL, and round() can return -0.0,
//! which has different bits from 0.0. Converting through i32 avoids both. To hash a continuous value, scale it first.
//! Keep inputs inside the 32-bit int range: GLSL leaves larger values undefined and WGSL clamps them, so the two
//! languages agree only inside it.
//! Do not use fract(sin(dot(p, k)) * 43758.5453): its result changes across GPUs and degrades at large inputs.
//! Integer mixers are from Jarzynski and Olano, "Hash Functions for GPU Rendering" (JCGT 2020): pcg3d and pcg4d sit
//! on that study's quality/speed frontier, and 32-bit integer math is bit-exact on every GPU, unlike sin().

/// PCG-style 1D integer hash.
/// @use seeding, per-instance randomness, building other hashes
/// @see Jarzynski and Olano, "Hash Functions for GPU Rendering", JCGT 9(3), 2020
fn pcgHash(v: u32) -> u32 {
    let state = v * 747796405u + 2891336453u;
    let word = ((state >> ((state >> 28u) + 4u)) ^ state) * 277803737u;
    return (word >> 22u) ^ word;
}

/// 3D integer hash, three decorrelated outputs.
/// @use 3D cell ids, voxel jitter, (pixel, frame) noise
/// @see Jarzynski and Olano, "Hash Functions for GPU Rendering", JCGT 9(3), 2020
fn pcg3d(v: vec3u) -> vec3u {
    var v_ = v * 1664525u + 1013904223u;
    v_.x += v_.y * v_.z;
    v_.y += v_.z * v_.x;
    v_.z += v_.x * v_.y;
    v_ ^= v_ >> vec3u(16u);
    v_.x += v_.y * v_.z;
    v_.y += v_.z * v_.x;
    v_.z += v_.x * v_.y;
    return v_;
}

/// 4D integer hash, four decorrelated outputs (0 BigCrush failures in the JCGT study).
/// @use (pixel.x, pixel.y, frame, sample) streams for stochastic sampling, 4D cell ids
/// @see Jarzynski and Olano, "Hash Functions for GPU Rendering", JCGT 9(3), 2020
fn pcg4d(v: vec4u) -> vec4u {
    var v_ = v * 1664525u + 1013904223u;
    v_.x += v_.y * v_.w;
    v_.y += v_.z * v_.x;
    v_.z += v_.x * v_.y;
    v_.w += v_.y * v_.z;
    v_ ^= v_ >> vec4u(16u);
    v_.x += v_.y * v_.w;
    v_.y += v_.z * v_.x;
    v_.z += v_.x * v_.y;
    v_.w += v_.y * v_.z;
    return v_;
}

/// Map a uint to [0,1) using the top 24 bits, so the result can never round up to 1.0.
fn uintToUnit_u(h: u32) -> f32 { return f32(h >> 8u) * (1.0 / 16777216.0); }
fn uintToUnit_u2(h: vec2u) -> vec2f { return vec2f(h >> vec2u(8u)) * (1.0 / 16777216.0); }
fn uintToUnit_u3(h: vec3u) -> vec3f { return vec3f(h >> vec3u(8u)) * (1.0 / 16777216.0); }
fn uintToUnit_u4(h: vec4u) -> vec4f { return vec4f(h >> vec4u(8u)) * (1.0 / 16777216.0); }

/// Random float in [0,1) for an integer-valued input.
/// @use per-cell randomness, stable random per instance id
/// @range [0,1)
fn hash11(p: f32) -> f32 { return uintToUnit_u(pcgHash(u32(i32(floor(p))))); }

/// Random float in [0,1) for an integer-valued 2D input.
/// @use per-cell variation (color, height, rotation), sparse spots, star fields
/// @range [0,1)
fn hash12(p: vec2f) -> f32 {
    let q = vec2u(vec2i(floor(p)));
    return uintToUnit_u(pcgHash(q.x + pcgHash(q.y)));
}

/// Random float in [0,1) for an integer-valued 3D input.
/// @use per-voxel randomness, per-pixel-per-frame noise via hash13(vec3f(position.xy, f32(frame)))
/// @range [0,1)
fn hash13(p: vec3f) -> f32 {
    let q = vec3u(vec3i(floor(p)));
    return uintToUnit_u(pcgHash(q.x + pcgHash(q.y + pcgHash(q.z))));
}

/// Random vec2 in [0,1)^2 for an integer-valued 2D input.
/// @use Voronoi feature points, 2D jitter, random gradients
/// @range [0,1)^2
fn hash22(p: vec2f) -> vec2f {
    let q = vec2i(floor(p));
    return uintToUnit_u3(pcg3d(vec3u(u32(q.x), u32(q.y), 0x2545u))).xy;
}

/// Random vec3 in [0,1)^3 for an integer-valued 3D input.
/// @use 3D Voronoi points, random colors per cell, random directions
/// @range [0,1)^3
fn hash33(p: vec3f) -> vec3f { return uintToUnit_u3(pcg3d(vec3u(vec3i(floor(p))))); }

/// Random vec4 in [0,1)^4 for an integer-valued 4D input.
/// @use per-pixel, per-frame, per-sample random numbers: hash44(vec4f(position.xy, f32(frame), f32(sampleIndex)))
/// @range [0,1)^4
fn hash44(p: vec4f) -> vec4f { return uintToUnit_u4(pcg4d(vec4u(vec4i(floor(p))))); }

/// Random vec3 in [0,1)^3 for an integer-valued 2D input.
/// @use per-tile random color, per-cell (offset, rotation, scale) triples
/// @range [0,1)^3
fn hash32(p: vec2f) -> vec3f {
    let q = vec2i(floor(p));
    return uintToUnit_u3(pcg3d(vec3u(u32(q.x), u32(q.y), 0x9E37u)));
}
`
