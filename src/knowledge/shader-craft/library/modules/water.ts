// Adapted for Noisemaker effects from gokayfem/shader-skills skills/shader-art-coding/glsl/water.glsl
// at e09bc993bf04201f26c03c87c89210e9b472f526 (MIT, Copyright (c) 2026 gokayfem).
// The WGSL twin translates the same code. The licence text is in ../../license.ts; the upstream record is
// ../../provenance.json.

export const WATER_GLSL = `//! water: finite-depth wave dispersion, analytic wave derivatives, exact dielectric Fresnel and RGB attenuation.
//! Units must agree: wavelength/depth/path in meters, gravity in m/s^2, extinction in 1/m. No textures or scene state.

/// Angular frequency sqrt(g*k*tanh(k*depth)) for finite-depth gravity waves. Nonpositive inputs are clamped.
/// @use shallow coasts, ocean swell, lake waves with depth-dependent speed
/// @range nonnegative
/// @see MIT 2.20 Marine Hydrodynamics, lecture 20
float waterDispersion(float k, float depth, float gravity) {
    k = max(k,0.0);
    float e = exp(-2.0*k*max(depth,0.0));
    return sqrt(max(gravity,0.0)*k*(1.0-e)/(1.0+e));
}

/// One sinusoidal wave: vec4(height, dh/dx, dh/dz, Laplacian). Direction is normalized internally; zero uses +X.
/// wavelength > 0, amplitude in meters. footprint filters waves below 2-6 pixels; derivatives hold it constant.
/// @use analytic water normals, layered swell/chop, curvature foam, finite-depth lake and coastal waves
/// @see Mark Finch, GPU Gems chapter 1, "Effective Water Simulation from Physical Models"
vec4 waterWaveD(vec2 xz, float time, vec2 direction, float wavelength, float amplitude, float depth, float footprint) {
    float dl = length(direction);
    vec2 dir = dl>0.000001 ? direction/dl : vec2(1.0,0.0);
    float lengthM = max(wavelength,0.0001);
    float k = TAU/lengthM;
    float keep = smoothstep(2.0,6.0,lengthM/max(footprint,0.000001));
    float phase = k*dot(dir,xz)-waterDispersion(k,depth,9.81)*time;
    float h = amplitude*keep*sin(phase);
    return vec4(h, amplitude*keep*k*cos(phase)*dir, -k*k*h);
}

/// Exact unpolarized dielectric Fresnel for a positive incident cosine and positive refractive indices.
/// Returns 1 for total internal reflection. Caller chooses etaIncident/etaTransmitted for the ray's side.
/// @use air-water interfaces (1.0,1.333), underwater views (1.333,1.0), glass
/// @range [0,1]
/// @see Physically Based Rendering, "Specular Reflection and Transmission"
float fresnelDielectric(float cosIncident, float etaIncident, float etaTransmitted) {
    float ci = clamp(abs(cosIncident),0.0,1.0);
    float ei = max(etaIncident,0.000001), et = max(etaTransmitted,0.000001);
    if (abs(ei-et)<0.0000001) return 0.0;
    float sinT2 = (ei*ei)/(et*et)*max(0.0,1.0-ci*ci);
    if (sinT2>=1.0) return 1.0;
    float ct = sqrt(max(0.0,1.0-sinT2));
    float rs = (ei*ci-et*ct)/max(ei*ci+et*ct,0.000001);
    float rp = (et*ci-ei*ct)/max(et*ci+ei*ct,0.000001);
    return clamp(0.5*(rs*rs+rp*rp),0.0,1.0);
}

/// Beer-Lambert RGB transmittance exp(-extinction*pathLength). Negative extinction/path is clamped to zero.
/// Use the refracted optical path, not vertical water depth. Attenuation alone does not add scattered light.
/// @use depth-colored water, underwater visibility, tinted glass, homogeneous fog
/// @range [0,1]
/// @see Physically Based Rendering, "Transmittance"
vec3 beerTransmittance(vec3 extinction, float pathLength) {
    return exp(-max(extinction,vec3(0.0))*max(pathLength,0.0));
}
`

export const WATER_WGSL = `//! water: finite-depth wave dispersion, analytic wave derivatives, exact dielectric Fresnel and RGB attenuation.
//! Units must agree: wavelength/depth/path in meters, gravity in m/s^2, extinction in 1/m. No textures or scene state.

/// Angular frequency sqrt(g*k*tanh(k*depth)) for finite-depth gravity waves. Nonpositive inputs are clamped.
/// @use shallow coasts, ocean swell, lake waves with depth-dependent speed
/// @range nonnegative
/// @see MIT 2.20 Marine Hydrodynamics, lecture 20
fn waterDispersion(k: f32, depth: f32, gravity: f32) -> f32 {
    let k_ = max(k, 0.0);
    let e = exp(-2.0 * k_ * max(depth, 0.0));
    return sqrt(max(gravity, 0.0) * k_ * (1.0 - e) / (1.0 + e));
}

/// One sinusoidal wave: vec4f(height, dh/dx, dh/dz, Laplacian). Direction is normalized internally; zero uses +X.
/// wavelength > 0, amplitude in meters. footprint filters waves below 2-6 pixels; derivatives hold it constant.
/// @use analytic water normals, layered swell/chop, curvature foam, finite-depth lake and coastal waves
/// @see Mark Finch, GPU Gems chapter 1, "Effective Water Simulation from Physical Models"
fn waterWaveD(xz: vec2f, time: f32, direction: vec2f, wavelength: f32, amplitude: f32, depth: f32, footprint: f32) -> vec4f {
    let dl = length(direction);
    let dir = select(vec2f(1.0, 0.0), direction / dl, dl > 0.000001);
    let lengthM = max(wavelength, 0.0001);
    let k = TAU / lengthM;
    let keep = smoothstep(2.0, 6.0, lengthM / max(footprint, 0.000001));
    let phase = k * dot(dir, xz) - waterDispersion(k, depth, 9.81) * time;
    let h = amplitude * keep * sin(phase);
    return vec4f(h, amplitude * keep * k * cos(phase) * dir, -k * k * h);
}

/// Exact unpolarized dielectric Fresnel for a positive incident cosine and positive refractive indices.
/// Returns 1 for total internal reflection. Caller chooses etaIncident/etaTransmitted for the ray's side.
/// @use air-water interfaces (1.0,1.333), underwater views (1.333,1.0), glass
/// @range [0,1]
/// @see Physically Based Rendering, "Specular Reflection and Transmission"
fn fresnelDielectric(cosIncident: f32, etaIncident: f32, etaTransmitted: f32) -> f32 {
    let ci = clamp(abs(cosIncident), 0.0, 1.0);
    let ei = max(etaIncident, 0.000001);
    let et = max(etaTransmitted, 0.000001);
    if (abs(ei - et) < 0.0000001) { return 0.0; }
    let sinT2 = (ei * ei) / (et * et) * max(0.0, 1.0 - ci * ci);
    if (sinT2 >= 1.0) { return 1.0; }
    let ct = sqrt(max(0.0, 1.0 - sinT2));
    let rs = (ei * ci - et * ct) / max(ei * ci + et * ct, 0.000001);
    let rp = (et * ci - ei * ct) / max(et * ci + ei * ct, 0.000001);
    return clamp(0.5 * (rs * rs + rp * rp), 0.0, 1.0);
}

/// Beer-Lambert RGB transmittance exp(-extinction*pathLength). Negative extinction/path is clamped to zero.
/// Use the refracted optical path, not vertical water depth. Attenuation alone does not add scattered light.
/// @use depth-colored water, underwater visibility, tinted glass, homogeneous fog
/// @range [0,1]
/// @see Physically Based Rendering, "Transmittance"
fn beerTransmittance(extinction: vec3f, pathLength: f32) -> vec3f {
    return exp(-max(extinction, vec3f(0.0)) * max(pathLength, 0.0));
}
`
