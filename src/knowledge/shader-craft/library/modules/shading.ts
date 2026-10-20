// Adapted for Noisemaker effects from gokayfem/shader-skills skills/shader-art-coding/glsl/shading.glsl
// at e09bc993bf04201f26c03c87c89210e9b472f526 (MIT, Copyright (c) 2026 gokayfem).
// The WGSL twin translates the same code. The licence text is in ../../license.ts; the upstream record is
// ../../provenance.json.

export const SHADING_GLSL = `//! shading: BRDF terms and practical lighting models. Vectors are unit length: n = normal, v = toward the viewer
//! (-rd), l = toward the light. Units are "artist units" with pi folded in: a light of color C lights a white
//! Lambert surface facing it to C. Every function here returns radiance per unit light color, already including NoL.
//! Physically based terms follow the Filament documentation.

/// Schlick Fresnel. u is VoH for lights and NoV for environment reflections and rims.
/// f0 = 0.04 for dielectrics (plastic, skin, stone, water ~0.02); for metals f0 = base color.
/// @use reflections that strengthen at grazing angles, rim brightening, water and glass
vec3 fresnelSchlick(float u, vec3 f0) {
    float m = clamp(1.0 - u, 0.0, 1.0);
    float m2 = m * m;
    return f0 + (1.0 - f0) * (m2 * m2 * m);
}

/// GGX / Trowbridge-Reitz normal distribution. alpha = roughness^2.
/// @use specular highlight shape (inside specularGGX)
float distributionGGX(float NoH, float alpha) {
    float a2 = alpha * alpha;
    float d = NoH * NoH * (a2 - 1.0) + 1.0;
    return a2 / (PI * d * d);
}

/// Height-correlated Smith visibility. Already contains the 1 / (4 NoL NoV) term.
/// @use specular shadowing-masking (inside specularGGX)
float visibilitySmithGGX(float NoV, float NoL, float alpha) {
    float a2 = alpha * alpha;
    float gv = NoL * sqrt(NoV * NoV * (1.0 - a2) + a2);
    float gl = NoV * sqrt(NoL * NoL * (1.0 - a2) + a2);
    return 0.5 / max(gv + gl, 1e-6);
}

/// Microfacet specular for one light: pi * D * V * F * NoL (artist units). roughness is perceptual, in [0,1].
/// @use glossy plastic, metal, wet surfaces, car paint, ceramics
vec3 specularGGX(vec3 n, vec3 v, vec3 l, float roughness, vec3 f0) {
    vec3 h = normalize(v + l);
    float NoL = clamp(dot(n, l), 0.0, 1.0);
    float NoV = max(dot(n, v), 1e-4);
    float NoH = clamp(dot(n, h), 0.0, 1.0);
    float VoH = clamp(dot(v, h), 0.0, 1.0);
    float alpha = max(roughness, 0.045);
    alpha *= alpha;
    return PI * distributionGGX(NoH, alpha) * visibilitySmithGGX(NoV, NoL, alpha) * fresnelSchlick(VoH, f0) * NoL;
}

/// Complete metallic-roughness shading for one light (diffuse + specular, NoL included, artist units).
/// Multiply by light color and shadow. Keep albedo around 0.05-0.7 (linear); brighten lights, not albedo.
/// @use hero objects, product renders, anything that needs believable materials
vec3 shadePBR(vec3 n, vec3 v, vec3 l, vec3 albedo, float roughness, float metallic) {
    vec3 f0 = mix(vec3(0.04), albedo, metallic);
    float NoL = clamp(dot(n, l), 0.0, 1.0);
    vec3 F = fresnelSchlick(max(dot(n, v), 0.0), f0);
    vec3 diffuse = albedo * (1.0 - metallic) * (1.0 - F) * NoL;
    return diffuse + specularGGX(n, v, l, roughness, f0);
}

/// Split-sum environment specular without a lookup texture (Karis 2014, after Lazarov).
/// Multiply by the sky or environment color in the reflection direction.
/// @use sky reflections on glossy surfaces, ambient specular
vec3 envBRDFApprox(vec3 f0, float NoV, float roughness) {
    vec4 r = roughness * vec4(-1.0, -0.0275, -0.572, 0.022) + vec4(1.0, 0.0425, 1.04, -0.04);
    float a = min(r.x * r.x, exp2(-9.28 * NoV)) * r.x + r.y;
    vec2 ab = vec2(-1.04, 1.04) * a + r.zw;
    return f0 * ab.x + ab.y;
}

/// Energy-conserving wrap diffuse: light wraps past the terminator by w (0 = Lambert, 0.5 = soft).
/// @use skin, foliage, cloth, soft stylized shading, fur
/// @see Stephen Hill, "Righting Wrap" (2011)
float wrapDiffuse(vec3 n, vec3 l, float w) {
    return max((dot(n, l) + w) / ((1.0 + w) * (1.0 + w)), 0.0);
}

/// Hemisphere light: sky color from above blended to ground color from below.
/// @use ambient fill, outdoor sky light, studio fill
vec3 hemisphereLight(vec3 n, vec3 skyColor, vec3 groundColor) {
    return mix(groundColor, skyColor, 0.5 + 0.5 * n.y);
}

/// Fast translucency (Barre-Brisebois and Bouchard 2011): light passing through thin parts, seen from the back.
/// distortion bends the light along the normal (0.2-0.5). thickness is 0 (thin) .. 1 (thick); see sdfThickness.
/// @use leaves, ears, wax, jade, marble, backlit petals, jellyfish
float translucency(vec3 n, vec3 v, vec3 l, float distortion, float power, float thickness) {
    vec3 h = normalize(l + n * distortion);
    return pow(clamp(dot(v, -h), 0.0, 1.0), power) * (1.0 - thickness);
}

/// Rim light from the viewing angle: strongest at silhouettes.
/// @use character separation from background, fresnel-like glow, stylized outlines
float rimLight(vec3 n, vec3 v, float power) {
    return pow(clamp(1.0 - dot(n, v), 0.0, 1.0), power);
}
`

export const SHADING_WGSL = `//! shading: BRDF terms and practical lighting models. Vectors are unit length: n = normal, v = toward the viewer
//! (-rd), l = toward the light. Units are "artist units" with pi folded in: a light of color C lights a white
//! Lambert surface facing it to C. Every function here returns radiance per unit light color, already including NoL.
//! Physically based terms follow the Filament documentation.

/// Schlick Fresnel. u is VoH for lights and NoV for environment reflections and rims.
/// f0 = 0.04 for dielectrics (plastic, skin, stone, water ~0.02); for metals f0 = base color.
/// @use reflections that strengthen at grazing angles, rim brightening, water and glass
fn fresnelSchlick(u: f32, f0: vec3f) -> vec3f {
    let m = clamp(1.0 - u, 0.0, 1.0);
    let m2 = m * m;
    return f0 + (1.0 - f0) * (m2 * m2 * m);
}

/// GGX / Trowbridge-Reitz normal distribution. alpha = roughness^2.
/// @use specular highlight shape (inside specularGGX)
fn distributionGGX(NoH: f32, alpha: f32) -> f32 {
    let a2 = alpha * alpha;
    let d = NoH * NoH * (a2 - 1.0) + 1.0;
    return a2 / (PI * d * d);
}

/// Height-correlated Smith visibility. Already contains the 1 / (4 NoL NoV) term.
/// @use specular shadowing-masking (inside specularGGX)
fn visibilitySmithGGX(NoV: f32, NoL: f32, alpha: f32) -> f32 {
    let a2 = alpha * alpha;
    let gv = NoL * sqrt(NoV * NoV * (1.0 - a2) + a2);
    let gl = NoV * sqrt(NoL * NoL * (1.0 - a2) + a2);
    return 0.5 / max(gv + gl, 1e-6);
}

/// Microfacet specular for one light: pi * D * V * F * NoL (artist units). roughness is perceptual, in [0,1].
/// @use glossy plastic, metal, wet surfaces, car paint, ceramics
fn specularGGX(n: vec3f, v: vec3f, l: vec3f, roughness: f32, f0: vec3f) -> vec3f {
    let h = normalize(v + l);
    let NoL = clamp(dot(n, l), 0.0, 1.0);
    let NoV = max(dot(n, v), 1e-4);
    let NoH = clamp(dot(n, h), 0.0, 1.0);
    let VoH = clamp(dot(v, h), 0.0, 1.0);
    var alpha = max(roughness, 0.045);
    alpha *= alpha;
    return PI * distributionGGX(NoH, alpha) * visibilitySmithGGX(NoV, NoL, alpha) * fresnelSchlick(VoH, f0) * NoL;
}

/// Complete metallic-roughness shading for one light (diffuse + specular, NoL included, artist units).
/// Multiply by light color and shadow. Keep albedo around 0.05-0.7 (linear); brighten lights, not albedo.
/// @use hero objects, product renders, anything that needs believable materials
fn shadePBR(n: vec3f, v: vec3f, l: vec3f, albedo: vec3f, roughness: f32, metallic: f32) -> vec3f {
    let f0 = mix(vec3f(0.04), albedo, metallic);
    let NoL = clamp(dot(n, l), 0.0, 1.0);
    let F = fresnelSchlick(max(dot(n, v), 0.0), f0);
    let diffuse = albedo * (1.0 - metallic) * (1.0 - F) * NoL;
    return diffuse + specularGGX(n, v, l, roughness, f0);
}

/// Split-sum environment specular without a lookup texture (Karis 2014, after Lazarov).
/// Multiply by the sky or environment color in the reflection direction.
/// @use sky reflections on glossy surfaces, ambient specular
fn envBRDFApprox(f0: vec3f, NoV: f32, roughness: f32) -> vec3f {
    let r = roughness * vec4f(-1.0, -0.0275, -0.572, 0.022) + vec4f(1.0, 0.0425, 1.04, -0.04);
    let a = min(r.x * r.x, exp2(-9.28 * NoV)) * r.x + r.y;
    let ab = vec2f(-1.04, 1.04) * a + r.zw;
    return f0 * ab.x + ab.y;
}

/// Energy-conserving wrap diffuse: light wraps past the terminator by w (0 = Lambert, 0.5 = soft).
/// @use skin, foliage, cloth, soft stylized shading, fur
/// @see Stephen Hill, "Righting Wrap" (2011)
fn wrapDiffuse(n: vec3f, l: vec3f, w: f32) -> f32 {
    return max((dot(n, l) + w) / ((1.0 + w) * (1.0 + w)), 0.0);
}

/// Hemisphere light: sky color from above blended to ground color from below.
/// @use ambient fill, outdoor sky light, studio fill
fn hemisphereLight(n: vec3f, skyColor: vec3f, groundColor: vec3f) -> vec3f {
    return mix(groundColor, skyColor, 0.5 + 0.5 * n.y);
}

/// Fast translucency (Barre-Brisebois and Bouchard 2011): light passing through thin parts, seen from the back.
/// distortion bends the light along the normal (0.2-0.5). thickness is 0 (thin) .. 1 (thick); see sdfThickness.
/// @use leaves, ears, wax, jade, marble, backlit petals, jellyfish
fn translucency(n: vec3f, v: vec3f, l: vec3f, distortion: f32, power: f32, thickness: f32) -> f32 {
    let h = normalize(l + n * distortion);
    return pow(clamp(dot(v, -h), 0.0, 1.0), power) * (1.0 - thickness);
}

/// Rim light from the viewing angle: strongest at silhouettes.
/// @use character separation from background, fresnel-like glow, stylized outlines
fn rimLight(n: vec3f, v: vec3f, power: f32) -> f32 {
    return pow(clamp(1.0 - dot(n, v), 0.0, 1.0), power);
}
`
