// Adapted for Noisemaker effects from gokayfem/shader-skills skills/shader-art-coding/glsl/atmosphere.glsl
// at e09bc993bf04201f26c03c87c89210e9b472f526 (MIT, Copyright (c) 2026 gokayfem).
// The WGSL twin translates the same code. The licence text is in ../../license.ts; the upstream record is
// ../../provenance.json.

export const ATMOSPHERE_GLSL = `//! atmosphere: skies and sun. simpleSky is a cheap artistic gradient. atmosphereSky is physically based single
//! scattering (Rayleigh + Mie + ozone) with constants from Hillaire, "A Scalable and Production Ready Sky and
//! Atmosphere Rendering Technique" (EGSR 2020). Distances are in kilometers to avoid float cancellation.

/// Cheap analytic sky: horizon-to-zenith gradient, darker ground below the horizon, sun glow lobes.
/// Returns linear radiance (roughly 0-2; the glow can exceed 1 near the sun).
/// Upstream writes the ground blend as smoothstep(0.0, -0.08, rd.y), with descending edges that GLSL and WGSL leave
/// undefined; here it is 1.0 - smoothstep(-0.08, 0.0, rd.y), the same ramp with ascending edges.
/// @use quick backgrounds, reflections, fog color, stylized daylight
vec3 simpleSky(vec3 rd, vec3 sunDir) {
    float y = max(rd.y, 0.0);
    vec3 zenith = vec3(0.12, 0.28, 0.62);
    vec3 horizon = vec3(0.62, 0.74, 0.88);
    vec3 col = mix(horizon, zenith, pow(y, 0.5));
    col = mix(col, vec3(0.28, 0.26, 0.24), 1.0 - smoothstep(-0.08, 0.0, rd.y));
    float mu = max(dot(rd, sunDir), 0.0);
    col += vec3(1.0, 0.75, 0.45) * (0.25 * pow(mu, 8.0) + 0.6 * pow(mu, 64.0) + 2.0 * pow(mu, 512.0));
    return col;
}

/// Sun disk with antialiased edge and limb darkening (Neckel 1996). angularRadius in radians (the real sun is
/// 0.00476; art often uses 3-10x). pixelAngle is the angular size of a pixel (about 2 / (resolution.y * focal)).
/// Returns a 0..1 shape tinted by limb darkening; multiply by a bright sun color (10-50).
/// @use suns, moons (use a different tint), bright stars in skies
vec3 sunDisk(vec3 rd, vec3 sunDir, float angularRadius, float pixelAngle) {
    float ang = acos(clamp(dot(rd, sunDir), -1.0, 1.0));
    float edge = 1.0 - smoothstep(angularRadius - pixelAngle, angularRadius + pixelAngle, ang);
    float r = clamp(ang / angularRadius, 0.0, 1.0);
    float muLimb = sqrt(max(1.0 - r * r, 0.0));
    vec3 limb = pow(vec3(muLimb), vec3(0.397, 0.503, 0.652));
    return edge * limb;
}

const float ATMOSPHERE_GROUND_KM = 6360.0;
const float ATMOSPHERE_TOP_KM = 6460.0;

/// Densities (rayleigh, mie, ozone) at altitude h km above the ground.
/// @use custom atmosphere marches (aerial perspective, planet views)
vec3 atmosphereDensity(float h) {
    return vec3(exp(-h / 8.0), exp(-h / 1.2), max(0.0, 1.0 - abs(h - 25.0) / 15.0));
}

/// Extinction per km for the given densities.
/// @use transmittance through air for sun color and aerial perspective
vec3 atmosphereExtinction(vec3 density) {
    const vec3 rayleigh = vec3(5.802, 13.558, 33.1) * 1e-3;
    const float mie = (3.996 + 4.40) * 1e-3;
    const vec3 ozone = vec3(0.650, 1.881, 0.085) * 1e-3;
    return rayleigh * density.x + mie * density.y + ozone * density.z;
}

/// Physically based sky radiance along rd for a viewer viewHeightKm above the ground, with single scattering
/// (16 view steps x 8 light steps). sunIntensity about 20. Sunsets come out somewhat dark because multiple
/// scattering is ignored; add a small ambient term if needed.
/// @use realistic skies, sunsets, aerial perspective colors, planet-from-space views
/// @see Sebastien Hillaire, "A Scalable and Production Ready Sky and Atmosphere Rendering Technique", EGSR 2020
vec3 atmosphereSky(vec3 rd, vec3 sunDir, float viewHeightKm, float sunIntensity) {
    const vec3 rayleighScatter = vec3(5.802, 13.558, 33.1) * 1e-3;
    const float mieScatter = 3.996e-3;
    vec3 ro = vec3(0.0, ATMOSPHERE_GROUND_KM + max(viewHeightKm, 0.001), 0.0);
    vec2 top = iSphere(ro, rd, vec3(0.0), ATMOSPHERE_TOP_KM);
    if (top.y <= 0.0) return vec3(0.0);
    vec2 ground = iSphere(ro, rd, vec3(0.0), ATMOSPHERE_GROUND_KM);
    float tStart = max(top.x, 0.0);
    float tEnd = (ground.x > 0.0) ? ground.x : top.y;
    float mu = dot(rd, sunDir);
    float pR = phaseRayleigh(mu);
    float pM = phaseCornetteShanks(mu, 0.8);
    const int VIEW_STEPS = 16;
    const int LIGHT_STEPS = 8;
    float dt = (tEnd - tStart) / float(VIEW_STEPS);
    vec3 radiance = vec3(0.0), transmittance = vec3(1.0);
    for (int i = 0; i < VIEW_STEPS; i++) {
        vec3 p = ro + rd * (tStart + (float(i) + 0.5) * dt);
        vec3 dens = atmosphereDensity(length(p) - ATMOSPHERE_GROUND_KM);
        vec3 sunT = vec3(0.0);
        if (iSphere(p, sunDir, vec3(0.0), ATMOSPHERE_GROUND_KM).x < 0.0) {
            float tl = iSphere(p, sunDir, vec3(0.0), ATMOSPHERE_TOP_KM).y;
            float dl = tl / float(LIGHT_STEPS);
            vec3 depth = vec3(0.0);
            for (int j = 0; j < LIGHT_STEPS; j++) {
                vec3 q = p + sunDir * ((float(j) + 0.5) * dl);
                depth += atmosphereExtinction(atmosphereDensity(length(q) - ATMOSPHERE_GROUND_KM)) * dl;
            }
            sunT = exp(-depth);
        }
        vec3 scatter = sunT * (rayleighScatter * dens.x * pR + mieScatter * dens.y * pM) * sunIntensity;
        volumeStep(radiance, transmittance, atmosphereExtinction(dens), scatter, dt);
    }
    return radiance;
}
`

export const ATMOSPHERE_WGSL = `//! atmosphere: skies and sun. simpleSky is a cheap artistic gradient. atmosphereSky is physically based single
//! scattering (Rayleigh + Mie + ozone) with constants from Hillaire, "A Scalable and Production Ready Sky and
//! Atmosphere Rendering Technique" (EGSR 2020). Distances are in kilometers to avoid float cancellation.

/// Cheap analytic sky: horizon-to-zenith gradient, darker ground below the horizon, sun glow lobes.
/// Returns linear radiance (roughly 0-2; the glow can exceed 1 near the sun).
/// Upstream writes the ground blend as smoothstep(0.0, -0.08, rd.y), with descending edges that GLSL and WGSL leave
/// undefined; here it is 1.0 - smoothstep(-0.08, 0.0, rd.y), the same ramp with ascending edges.
/// @use quick backgrounds, reflections, fog color, stylized daylight
fn simpleSky(rd: vec3f, sunDir: vec3f) -> vec3f {
    let y = max(rd.y, 0.0);
    let zenith = vec3f(0.12, 0.28, 0.62);
    let horizon = vec3f(0.62, 0.74, 0.88);
    var col = mix(horizon, zenith, pow(y, 0.5));
    col = mix(col, vec3f(0.28, 0.26, 0.24), 1.0 - smoothstep(-0.08, 0.0, rd.y));
    let mu = max(dot(rd, sunDir), 0.0);
    col += vec3f(1.0, 0.75, 0.45) * (0.25 * pow(mu, 8.0) + 0.6 * pow(mu, 64.0) + 2.0 * pow(mu, 512.0));
    return col;
}

/// Sun disk with antialiased edge and limb darkening (Neckel 1996). angularRadius in radians (the real sun is
/// 0.00476; art often uses 3-10x). pixelAngle is the angular size of a pixel (about 2 / (resolution.y * focal)).
/// Returns a 0..1 shape tinted by limb darkening; multiply by a bright sun color (10-50).
/// @use suns, moons (use a different tint), bright stars in skies
fn sunDisk(rd: vec3f, sunDir: vec3f, angularRadius: f32, pixelAngle: f32) -> vec3f {
    let ang = acos(clamp(dot(rd, sunDir), -1.0, 1.0));
    let edge = 1.0 - smoothstep(angularRadius - pixelAngle, angularRadius + pixelAngle, ang);
    let r = clamp(ang / angularRadius, 0.0, 1.0);
    let muLimb = sqrt(max(1.0 - r * r, 0.0));
    let limb = pow(vec3f(muLimb), vec3f(0.397, 0.503, 0.652));
    return edge * limb;
}

const ATMOSPHERE_GROUND_KM: f32 = 6360.0;
const ATMOSPHERE_TOP_KM: f32 = 6460.0;

/// Densities (rayleigh, mie, ozone) at altitude h km above the ground.
/// @use custom atmosphere marches (aerial perspective, planet views)
fn atmosphereDensity(h: f32) -> vec3f {
    return vec3f(exp(-h / 8.0), exp(-h / 1.2), max(0.0, 1.0 - abs(h - 25.0) / 15.0));
}

/// Extinction per km for the given densities.
/// @use transmittance through air for sun color and aerial perspective
fn atmosphereExtinction(density: vec3f) -> vec3f {
    const rayleigh = vec3f(5.802, 13.558, 33.1) * 1e-3;
    const mie: f32 = (3.996f + 4.40f) * 1e-3f;
    const ozone = vec3f(0.650, 1.881, 0.085) * 1e-3;
    return rayleigh * density.x + mie * density.y + ozone * density.z;
}

/// Physically based sky radiance along rd for a viewer viewHeightKm above the ground, with single scattering
/// (16 view steps x 8 light steps). sunIntensity about 20. Sunsets come out somewhat dark because multiple
/// scattering is ignored; add a small ambient term if needed.
/// @use realistic skies, sunsets, aerial perspective colors, planet-from-space views
/// @see Sebastien Hillaire, "A Scalable and Production Ready Sky and Atmosphere Rendering Technique", EGSR 2020
fn atmosphereSky(rd: vec3f, sunDir: vec3f, viewHeightKm: f32, sunIntensity: f32) -> vec3f {
    const rayleighScatter = vec3f(5.802, 13.558, 33.1) * 1e-3;
    const mieScatter: f32 = 3.996e-3;
    let ro = vec3f(0.0, ATMOSPHERE_GROUND_KM + max(viewHeightKm, 0.001), 0.0);
    let top = iSphere(ro, rd, vec3f(0.0), ATMOSPHERE_TOP_KM);
    if (top.y <= 0.0) { return vec3f(0.0); }
    let ground = iSphere(ro, rd, vec3f(0.0), ATMOSPHERE_GROUND_KM);
    let tStart = max(top.x, 0.0);
    let tEnd = select(top.y, ground.x, ground.x > 0.0);
    let mu = dot(rd, sunDir);
    let pR = phaseRayleigh(mu);
    let pM = phaseCornetteShanks(mu, 0.8);
    const VIEW_STEPS: i32 = 16;
    const LIGHT_STEPS: i32 = 8;
    let dt = (tEnd - tStart) / f32(VIEW_STEPS);
    var radiance = vec3f(0.0);
    var transmittance = vec3f(1.0);
    for (var i = 0; i < VIEW_STEPS; i++) {
        let p = ro + rd * (tStart + (f32(i) + 0.5) * dt);
        let dens = atmosphereDensity(length(p) - ATMOSPHERE_GROUND_KM);
        var sunT = vec3f(0.0);
        if (iSphere(p, sunDir, vec3f(0.0), ATMOSPHERE_GROUND_KM).x < 0.0) {
            let tl = iSphere(p, sunDir, vec3f(0.0), ATMOSPHERE_TOP_KM).y;
            let dl = tl / f32(LIGHT_STEPS);
            var depth = vec3f(0.0);
            for (var j = 0; j < LIGHT_STEPS; j++) {
                let q = p + sunDir * ((f32(j) + 0.5) * dl);
                depth += atmosphereExtinction(atmosphereDensity(length(q) - ATMOSPHERE_GROUND_KM)) * dl;
            }
            sunT = exp(-depth);
        }
        let scatter = sunT * (rayleighScatter * dens.x * pR + mieScatter * dens.y * pM) * sunIntensity;
        volumeStep(&radiance, &transmittance, atmosphereExtinction(dens), scatter, dt);
    }
    return radiance;
}
`
