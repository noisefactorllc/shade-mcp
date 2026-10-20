// Adapted for Noisemaker effects from gokayfem/shader-skills skills/shader-art-coding/glsl/camera.glsl
// at e09bc993bf04201f26c03c87c89210e9b472f526 (MIT, Copyright (c) 2026 gokayfem).
// The WGSL twin translates the same code. The licence text is in ../../license.ts; the upstream record is
// ../../provenance.json.

export const CAMERA_GLSL = `//! camera: look-at frames, primary rays, field of view, thin-lens depth of field.
//! Convention: uv = (2.0 * gl_FragCoord.xy - resolution) / resolution.y, so uv.y spans [-1, 1] and aspect is kept.

/// Camera-to-world matrix looking from ro toward ta, with roll in radians. Columns are (right, up, forward).
/// @use every 3D shader
mat3 cameraMatrix(vec3 ro, vec3 ta, float roll) {
    vec3 w = normalize(ta - ro);
    vec3 up = vec3(sin(roll), cos(roll), 0.0);
    vec3 u = normalize(cross(w, up));
    vec3 v = cross(u, w);
    return mat3(u, v, w);
}

/// Focal length (the z of the view-space ray) for a vertical field of view in degrees.
/// @use matching a reference photo, wide (90) vs telephoto (20) framing
float fovToFocal(float fovDegrees) { return 1.0 / tan(radians(fovDegrees) * 0.5); }

/// Primary ray direction for screen point uv. focal is about 1.5-2.5 for natural framing (see fovToFocal).
/// @use every 3D shader
vec3 cameraRay(mat3 cam, vec2 uv, float focal) {
    return normalize(cam * vec3(uv, focal));
}

/// Thin-lens depth of field. Moves the ray origin over a lens disk of radius aperture, and re-aims it so that
/// points at distance focusDist stay sharp. xi is a pair of uniform random numbers in [0,1) (e.g. hash22 of the
/// pixel and frame). Average many samples (an AA loop, or accumulation across frames in a feedback texture).
/// @use macro shots, product renders, cinematic focus pulls, bokeh
void thinLensRay(mat3 cam, vec2 uv, float focal, float aperture, float focusDist, vec2 xi, inout vec3 ro, out vec3 rd) {
    vec3 dir = normalize(cam * vec3(uv, focal));
    float ft = focusDist / dot(dir, cam[2]);
    vec3 focusPoint = ro + dir * ft;
    float a = TAU * xi.x;
    float r = aperture * sqrt(xi.y);
    ro += cam * vec3(r * cos(a), r * sin(a), 0.0);
    rd = normalize(focusPoint - ro);
}

/// Orthographic ray: parallel rays from a plane of half-height \`size\` centered on ro.
/// @use isometric scenes, technical illustrations, flat diorama looks
void orthoRay(mat3 cam, vec2 uv, float size, inout vec3 ro, out vec3 rd) {
    ro += cam * vec3(uv * size, 0.0);
    rd = cam[2];
}
`

export const CAMERA_WGSL = `//! camera: look-at frames, primary rays, field of view, thin-lens depth of field.
//! Convention: uv = (2.0 * pixel - resolution) / resolution.y with pixel = vec2f(position.x, resolution.y - position.y),
//! so uv.y spans [-1, 1], points up as in GLSL, and aspect is kept.

/// Camera-to-world matrix looking from ro toward ta, with roll in radians. Columns are (right, up, forward).
/// @use every 3D shader
fn cameraMatrix(ro: vec3f, ta: vec3f, roll: f32) -> mat3x3f {
    let w = normalize(ta - ro);
    let up = vec3f(sin(roll), cos(roll), 0.0);
    let u = normalize(cross(w, up));
    let v = cross(u, w);
    return mat3x3f(u, v, w);
}

/// Focal length (the z of the view-space ray) for a vertical field of view in degrees.
/// @use matching a reference photo, wide (90) vs telephoto (20) framing
fn fovToFocal(fovDegrees: f32) -> f32 { return 1.0 / tan(radians(fovDegrees) * 0.5); }

/// Primary ray direction for screen point uv. focal is about 1.5-2.5 for natural framing (see fovToFocal).
/// @use every 3D shader
fn cameraRay(cam: mat3x3f, uv: vec2f, focal: f32) -> vec3f {
    return normalize(cam * vec3f(uv, focal));
}

/// Thin-lens depth of field. Moves the ray origin over a lens disk of radius aperture, and re-aims it so that
/// points at distance focusDist stay sharp. xi is a pair of uniform random numbers in [0,1) (e.g. hash22 of the
/// pixel and frame). Average many samples (an AA loop, or accumulation across frames in a feedback texture).
/// @use macro shots, product renders, cinematic focus pulls, bokeh
fn thinLensRay(cam: mat3x3f, uv: vec2f, focal: f32, aperture: f32, focusDist: f32, xi: vec2f, ro: ptr<function, vec3f>, rd: ptr<function, vec3f>) {
    let dir = normalize(cam * vec3f(uv, focal));
    let ft = focusDist / dot(dir, cam[2]);
    let focusPoint = *ro + dir * ft;
    let a = TAU * xi.x;
    let r = aperture * sqrt(xi.y);
    *ro += cam * vec3f(r * cos(a), r * sin(a), 0.0);
    *rd = normalize(focusPoint - *ro);
}

/// Orthographic ray: parallel rays from a plane of half-height \`size\` centered on ro.
/// @use isometric scenes, technical illustrations, flat diorama looks
fn orthoRay(cam: mat3x3f, uv: vec2f, size: f32, ro: ptr<function, vec3f>, rd: ptr<function, vec3f>) {
    *ro += cam * vec3f(uv * size, 0.0);
    *rd = cam[2];
}
`
