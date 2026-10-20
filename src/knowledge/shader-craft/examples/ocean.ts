// Scene and material formulas adapted from the pinned shader-skills template.
// Full upstream provenance and MIT terms are attached by getShaderCraftExample.
export default {
  glsl: `const vec3 SUN_DIR = vec3(0.1942938351, 0.1360056846, -0.9714691757);
const float SUN_INTENSITY = 20.0;
const float WIND_ANGLE = 1.9;
const float SWELL_LENGTH = 34.0;
const float SWELL_HEIGHT = 0.8;
const float CHOP = 0.7;
const float CREST_SHARPNESS = 2.4;
const float RIPPLE = 0.008;
const float FOAM_AMOUNT = 1.0;
const vec3 WATER_DEEP = vec3(0.004, 0.02, 0.04);
const vec3 WATER_GLOW = vec3(0.05, 0.26, 0.25);
const float HAZE = 6.0;
const float CAMERA_HEIGHT = 3.0;
const float EXPOSURE = 0.9;
const float FOCAL = 2.0;
const float GRAVITY = 9.81;
const float WAVELENGTH_RATIO = 0.8;
const int TRACE_WAVES = 12;
const int SHADE_WAVES = 28;
const int FOAM_WAVES = 6;
const float TRACE_FAR = 400.0;
void wave(int i, out vec2 dir, out float k, out float amp, out float phase) {
    float fi = float(i);
    vec3 h = hash32(vec2(fi, 17.0));
    float a = WIND_ANGLE + mix(0.35, 1.3, min(fi / 12.0, 1.0)) * (2.0 * h.x - 1.0);
    dir = vec2(cos(a), sin(a));
    k = TAU / (SWELL_LENGTH * pow(WAVELENGTH_RATIO, fi) * mix(0.85, 1.15, h.y));
    amp = SWELL_HEIGHT * pow(CHOP, fi);
    phase = TAU * h.z;
}
float wavePhase(vec2 dir, float k, float phase, vec2 xz) {
    return k * dot(dir, xz) - TAU * max(1.0, floor(sqrt(GRAVITY * k) * 8.0 / TAU + 0.5)) * fract(time) + phase;
}
float waveKeep(vec2 dir, float k, vec4 fp) {
    float footprint = length(vec2(dot(dir, vec2(-fp.y, fp.x)) * fp.z, dot(dir, fp.xy) * fp.w));
    return smoothstep(2.0, 6.0, TAU / (k * footprint));
}
float oceanHeight(vec2 xz, int count, vec4 fp) {
    float h = 0.0;
    for (int i = ZERO; i < SHADE_WAVES; i++) {
        if (i >= count) break;
        vec2 dir; float k, amp, phase;
        wave(i, dir, k, amp, phase);
        h += waveKeep(dir, k, fp) * amp * (exp(CREST_SHARPNESS * (sin(wavePhase(dir, k, phase, xz)) - 1.0)) - 0.3);
    }
    return h;
}
float profileMaxSlope() {
    float s = CREST_SHARPNESS;
    float sn = (sqrt(1.0 + 4.0 * s * s) - 1.0) / (2.0 * s);
    return s * sqrt(1.0 - sn * sn) * exp(s * (sn - 1.0));
}
vec3 oceanBounds() {
    float ampSum = 0.0, slopeSum = 0.0;
    for (int i = ZERO; i < TRACE_WAVES; i++) {
        vec2 dir; float k, amp, phase;
        wave(i, dir, k, amp, phase);
        ampSum += amp;
        slopeSum += amp * k;
    }
    return vec3(-0.3 * ampSum, 0.7 * ampSum, slopeSum * profileMaxSlope());
}
vec2 traceOcean(vec3 ro, vec3 rd, vec3 bounds, vec4 pixelSpread) {
    if (rd.y >= 0.0) return vec2(-1.0, 0.0);
    float t = max((ro.y - bounds.y) / -rd.y, 0.0);
    float tEnd = min((ro.y - bounds.x) / -rd.y, TRACE_FAR);
    float closing = -rd.y + 0.6 * bounds.z * length(rd.xz);
    float tPrev = t, gapPrev = 1e10;
    for (int i = ZERO; i < 200; i++) {
        vec3 p = ro + rd * t;
        float gap = p.y - oceanHeight(p.xz, TRACE_WAVES, pixelSpread * vec4(1.0, 1.0, t, t));
        if (gap < 0.0) return vec2(mix(tPrev, t, gapPrev / (gapPrev - gap)), float(i));
        if (t >= tEnd) break;
        tPrev = t;
        gapPrev = gap;
        t = min(t + max(gap / closing, 0.004 * t), tEnd);
    }
    return vec2(-1.0, 200.0);
}
vec4 oceanDetail(vec2 xz, vec4 fp, out float lostSlope2, out float crest) {
    const float slopeRms = 0.3 + 0.06 * CREST_SHARPNESS;
    vec4 s = vec4(0.0);
    lostSlope2 = 0.0;
    crest = 0.0;
    float crestMax = 0.0;
    for (int i = ZERO; i < SHADE_WAVES; i++) {
        vec2 dir; float k, amp, phase;
        wave(i, dir, k, amp, phase);
        float keep = waveKeep(dir, k, fp);
        float theta = wavePhase(dir, k, phase, xz);
        float sn = sin(theta), cs = cos(theta);
        float e = exp(CREST_SHARPNESS * (sn - 1.0));
        float d1 = CREST_SHARPNESS * cs * e;
        float d2 = CREST_SHARPNESS * (CREST_SHARPNESS * cs * cs - sn) * e;
        s += keep * amp * vec4(e - 0.3, k * d1 * dir, k * k * d2);
        lostSlope2 += (1.0 - keep) * (amp * k * slopeRms) * (amp * k * slopeRms);
        if (i < FOAM_WAVES) {
            crest -= keep * amp * k * k * d2;
            crestMax += amp * k * k * CREST_SHARPNESS;
        }
    }
    crest /= crestMax;
    return s;
}
vec3 sunTransmittance(float heightKm, vec3 dir) {
    vec3 ro = vec3(0.0, ATMOSPHERE_GROUND_KM + heightKm, 0.0);
    if (iSphere(ro, dir, vec3(0.0), ATMOSPHERE_GROUND_KM).x > 0.0) return vec3(0.0);
    float tl = iSphere(ro, dir, vec3(0.0), ATMOSPHERE_TOP_KM).y;
    vec3 depth = vec3(0.0);
    for (int i = 0; i < 12; i++) {
        vec3 q = ro + dir * ((float(i) + 0.5) * tl / 12.0);
        depth += atmosphereExtinction(atmosphereDensity(length(q) - ATMOSPHERE_GROUND_KM)) * tl / 12.0;
    }
    return exp(-depth);
}
vec3 render(vec2 sampleCoord) {
    vec2 uv = (2.0 * sampleCoord - resolution) / resolution.y;
    float pixelAngle = 2.0 / (resolution.y * FOCAL);
    float viewKm = CAMERA_HEIGHT * 0.001;
    vec3 ro = vec3(0.0, CAMERA_HEIGHT, 0.0);
    mat3 cam = cameraMatrix(ro, ro + vec3(0.0, -0.06, -1.0), 0.0);
    vec3 rd = cameraRay(cam, uv, FOCAL);
    vec3 sunColor = SUN_INTENSITY * 0.12 * sunTransmittance(viewKm, SUN_DIR);
    if (rd.y >= 0.0) {
        vec3 sky = atmosphereSky(rd, SUN_DIR, viewKm, SUN_INTENSITY);
        return sky + sunColor * 40.0 * sunDisk(rd, SUN_DIR, 0.012, pixelAngle);
    }
    vec4 pixelSpread = vec4(normalize(rd.xz), pixelAngle, pixelAngle / max(-rd.y, 0.01));
    vec3 bounds = oceanBounds();
    vec2 hit = traceOcean(ro, rd, bounds, pixelSpread);
    float t = (hit.x > 0.0) ? hit.x : ro.y / -rd.y;
    vec3 p = ro + rd * t;
    vec4 fp = pixelSpread * vec4(1.0, 1.0, t, t);
    float lostSlope2, crest;
    vec4 wv = oceanDetail(p.xz, fp, lostSlope2, crest);
    vec2 slope = wv.yz;
    float footprint = sqrt(fp.z * fp.w);
    float keepRipple = smoothstep(2.0, 6.0, 0.8 / footprint);
    vec3 r1 = simplexNoiseD(p.xz * 1.3 + vec2(cos(TAU*fract(time)),sin(TAU*fract(time)))*0.9, TAU * fract(time));
    vec3 r2 = simplexNoiseD(p.xz * 3.7 - vec2(cos(TAU*fract(time)),sin(TAU*fract(time)))*0.6, -2.0 * TAU * fract(time));
    slope += RIPPLE * keepRipple * (1.3 * r1.yz + 0.5 * 3.7 * r2.yz * smoothstep(2.0, 6.0, 0.3 / footprint));
    lostSlope2 += RIPPLE * RIPPLE * 4.0 * (1.0 - keepRipple);
    vec3 n = normalize(vec3(-slope.x, 1.0, -slope.y));
    float lace = billowFbm(p.xz * vec2(1.2, 2.4) + 0.5 * vec2(cos(TAU*fract(time)),sin(TAU*fract(time))), 6);
    float coverage = 0.7 * smoothstep(0.08, 0.3, crest);
    float foam = FOAM_AMOUNT * coverage * smoothstep(1.0 - coverage, 1.15 - coverage, lace);
    float bubbles = (1.0 - smoothstep(0.0, 0.22, voronoiBorder(p.xz * vec2(2.5, 4.0), 1.0).x));
    foam *= mix(0.75, mix(0.4, 1.0, bubbles), smoothstep(2.0, 6.0, 0.3 / footprint));
    vec3 v = -rd;
    float NoV = max(dot(n, v), 1e-3);
    vec3 F = fresnelSchlick(NoV, vec3(0.02));
    vec3 refl = reflect(rd, n);
    refl.y = abs(refl.y);
    vec3 skyRefl = atmosphereSky(refl, SUN_DIR, viewKm, SUN_INTENSITY);
    vec3 skyAmbient = atmosphereSky(vec3(0.0, 1.0, 0.0), SUN_DIR, viewKm, SUN_INTENSITY);
    float alpha = sqrt(0.02 * 0.02 + 2.0 * lostSlope2);
    vec3 glint = specularGGX(n, v, SUN_DIR, sqrt(alpha), vec3(0.02)) * sunColor;
    vec3 reflection = F * skyRefl;
    float backlit = pow(clamp(dot(rd, SUN_DIR), 0.0, 1.0), 4.0);
    float thin = smoothstep(0.45, 0.9, (wv.x - bounds.x) / (bounds.y - bounds.x));
    vec3 body = (1.0 - F) * (WATER_DEEP * (skyAmbient + sunColor * max(dot(n, SUN_DIR), 0.0))
                             + WATER_GLOW * sunColor * backlit * thin);
    vec3 foamColor = vec3(0.9) * (sunColor * (max(dot(n, SUN_DIR), 0.0) + 0.5 * backlit) + 3.0 * skyAmbient);
    vec3 col = mix(reflection + glint + body, foamColor, foam);
    vec3 fogColor = atmosphereSky(normalize(vec3(rd.x, 0.0, rd.z)), SUN_DIR, viewKm, SUN_INTENSITY);
    vec3 airT = exp(-t * 0.001 * HAZE * atmosphereExtinction(atmosphereDensity(0.0)));
    return col * airT + fogColor * (1.0 - airT);
}
void main() {
    vec2 sampleCoord = gl_FragCoord.xy;
    vec3 col = render(sampleCoord);
    col = linearToSrgb(tonemapAgXPunchy(col * EXPOSURE)) + ditherTPDF(sampleCoord, int(seed));
    fragColor = vec4(col, 1.0);
}
`,
  wgsl: `const SUN_DIR: vec3f = vec3f(0.1942938351, 0.1360056846, (-0.9714691757));

const SUN_INTENSITY: f32 = 20.0;

const WIND_ANGLE: f32 = 1.9;

const SWELL_LENGTH: f32 = 34.0;

const SWELL_HEIGHT: f32 = 0.8;

const CHOP: f32 = 0.7;

const CREST_SHARPNESS: f32 = 2.4;

const RIPPLE: f32 = 0.008;

const FOAM_AMOUNT: f32 = 1.0;

const WATER_DEEP: vec3f = vec3f(0.004, 0.02, 0.04);

const WATER_GLOW: vec3f = vec3f(0.05, 0.26, 0.25);

const HAZE: f32 = 6.0;

const CAMERA_HEIGHT: f32 = 3.0;

const EXPOSURE: f32 = 0.9;

const FOCAL: f32 = 2.0;

const GRAVITY: f32 = 9.81;

const WAVELENGTH_RATIO: f32 = 0.8;

const TRACE_WAVES: i32 = 12;

const SHADE_WAVES: i32 = 28;

const FOAM_WAVES: i32 = 6;

const TRACE_FAR: f32 = 400.0;

fn wave(i_arg: i32, dir: ptr<function, vec2f>, k: ptr<function, f32>, amp: ptr<function, f32>, phase: ptr<function, f32>) {
    var i = i_arg;
    var fi: f32 = f32(i);
    var h: vec3f = hash32(vec2f(fi, 17.0));
    var a: f32 = (WIND_ANGLE + (mix(0.35, 1.3, min((fi / 12.0), 1.0)) * (((2.0 * h.x) - 1.0))));
    (*dir) = vec2f(cos(a), sin(a));
    (*k) = (TAU / (((SWELL_LENGTH * pow(WAVELENGTH_RATIO, fi)) * mix(0.85, 1.15, h.y))));
    (*amp) = (SWELL_HEIGHT * pow(CHOP, fi));
    (*phase) = (TAU * h.z);
}

fn wavePhase(dir_arg: vec2f, k_arg: f32, phase_arg: f32, xz_arg: vec2f) -> f32 {
    var dir = dir_arg;
    var k = k_arg;
    var phase = phase_arg;
    var xz = xz_arg;
    return (((k * dot(dir, xz)) - ((TAU * max(1.0, floor(sqrt(GRAVITY * k) * 8.0 / TAU + 0.5))) * time)) + phase);
}

fn waveKeep(dir_arg: vec2f, k_arg: f32, fp_arg: vec4f) -> f32 {
    var dir = dir_arg;
    var k = k_arg;
    var fp = fp_arg;
    var footprint: f32 = length(vec2f((dot(dir, vec2f((-fp.y), fp.x)) * fp.z), (dot(dir, fp.xy) * fp.w)));
    return smoothstep(2.0, 6.0, (TAU / ((k * footprint))));
}

fn oceanHeight(xz_arg: vec2f, count_arg: i32, fp_arg: vec4f) -> f32 {
    var xz = xz_arg;
    var count = count_arg;
    var fp = fp_arg;
    var h: f32 = 0.0;
    for (var i: i32 = ZERO; (i < SHADE_WAVES); i++) {
        if ((i >= count)) {
            break;
        }
        var dir: vec2f;
        var k: f32;
        var amp: f32;
        var phase: f32;
        wave(i, &dir, &k, &amp, &phase);
        h += ((waveKeep(dir, k, fp) * amp) * ((exp((CREST_SHARPNESS * ((sin(wavePhase(dir, k, phase, xz)) - 1.0)))) - 0.3)));
    }
    return h;
}

fn profileMaxSlope() -> f32 {

    var s: f32 = CREST_SHARPNESS;
    var sn: f32 = (((sqrt((1.0 + ((4.0 * s) * s))) - 1.0)) / ((2.0 * s)));
    return ((s * sqrt((1.0 - (sn * sn)))) * exp((s * ((sn - 1.0)))));
}

fn oceanBounds() -> vec3f {

    var ampSum: f32 = 0.0;
    var slopeSum: f32 = 0.0;
    for (var i: i32 = ZERO; (i < TRACE_WAVES); i++) {
        var dir: vec2f;
        var k: f32;
        var amp: f32;
        var phase: f32;
        wave(i, &dir, &k, &amp, &phase);
        ampSum += amp;
        slopeSum += (amp * k);
    }
    return vec3f(((-0.3) * ampSum), (0.7 * ampSum), (slopeSum * profileMaxSlope()));
}

fn traceOcean(ro_arg: vec3f, rd_arg: vec3f, bounds_arg: vec3f, pixelSpread_arg: vec4f) -> vec2f {
    var ro = ro_arg;
    var rd = rd_arg;
    var bounds = bounds_arg;
    var pixelSpread = pixelSpread_arg;
    if ((rd.y >= 0.0)) {
        return vec2f((-1.0), 0.0);
    }
    var t: f32 = max((((ro.y - bounds.y)) / (-rd.y)), 0.0);
    var tEnd: f32 = min((((ro.y - bounds.x)) / (-rd.y)), TRACE_FAR);
    var closing: f32 = ((-rd.y) + ((0.6 * bounds.z) * length(rd.xz)));
    var tPrev: f32 = t;
    var gapPrev: f32 = 1e10;
    for (var i: i32 = ZERO; (i < 200); i++) {
        var p: vec3f = (ro + (rd * t));
        var gap: f32 = (p.y - oceanHeight(p.xz, TRACE_WAVES, (pixelSpread * vec4f(1.0, 1.0, t, t))));
        if ((gap < 0.0)) {
            return vec2f(mix(tPrev, t, (gapPrev / ((gapPrev - gap)))), f32(i));
        }
        if ((t >= tEnd)) {
            break;
        }
        tPrev = t;
        gapPrev = gap;
        t = min((t + max((gap / closing), (0.004 * t))), tEnd);
    }
    return vec2f((-1.0), 200.0);
}

fn oceanDetail(xz_arg: vec2f, fp_arg: vec4f, lostSlope2: ptr<function, f32>, crest: ptr<function, f32>) -> vec4f {
    var xz = xz_arg;
    var fp = fp_arg;
    let slopeRms: f32 = (0.3 + (0.06 * CREST_SHARPNESS));
    var s: vec4f = vec4f(0.0);
    (*lostSlope2) = 0.0;
    (*crest) = 0.0;
    var crestMax: f32 = 0.0;
    for (var i: i32 = ZERO; (i < SHADE_WAVES); i++) {
        var dir: vec2f;
        var k: f32;
        var amp: f32;
        var phase: f32;
        wave(i, &dir, &k, &amp, &phase);
        var keep: f32 = waveKeep(dir, k, fp);
        var theta: f32 = wavePhase(dir, k, phase, xz);
        var sn: f32 = sin(theta);
        var cs: f32 = cos(theta);
        var e: f32 = exp((CREST_SHARPNESS * ((sn - 1.0))));
        var d1: f32 = ((CREST_SHARPNESS * cs) * e);
        var d2: f32 = ((CREST_SHARPNESS * ((((CREST_SHARPNESS * cs) * cs) - sn))) * e);
        s += ((keep * amp) * vec4f((e - 0.3), ((k * d1) * dir), ((k * k) * d2)));
        (*lostSlope2) += ((((1.0 - keep)) * (((amp * k) * slopeRms))) * (((amp * k) * slopeRms)));
        if ((i < FOAM_WAVES)) {
            (*crest) -= ((((keep * amp) * k) * k) * d2);
            crestMax += (((amp * k) * k) * CREST_SHARPNESS);
        }
    }
    (*crest) /= crestMax;
    return s;
}

fn sunTransmittance(heightKm_arg: f32, dir_arg: vec3f) -> vec3f {
    var heightKm = heightKm_arg;
    var dir = dir_arg;
    var ro: vec3f = vec3f(0.0, (ATMOSPHERE_GROUND_KM + heightKm), 0.0);
    if ((iSphere(ro, dir, vec3f(0.0), ATMOSPHERE_GROUND_KM).x > 0.0)) {
        return vec3f(0.0);
    }
    var tl: f32 = iSphere(ro, dir, vec3f(0.0), ATMOSPHERE_TOP_KM).y;
    var depth: vec3f = vec3f(0.0);
    for (var i: i32 = 0; (i < 12); i++) {
        var q: vec3f = (ro + (dir * (((((f32(i) + 0.5)) * tl) / 12.0))));
        depth += ((atmosphereExtinction(atmosphereDensity((length(q) - ATMOSPHERE_GROUND_KM))) * tl) / vec3f(12.0));
    }
    return exp((-depth));
}

fn render(fragCoord_arg: vec2f) -> vec3f {
    var sampleCoord = fragCoord_arg;
    var uv: vec2f = ((((2.0 * sampleCoord) - resolution)) / vec2f(resolution.y));
    var pixelAngle: f32 = (2.0 / ((resolution.y * FOCAL)));
    var viewKm: f32 = (CAMERA_HEIGHT * 0.001);
    var ro: vec3f = vec3f(0.0, CAMERA_HEIGHT, 0.0);
    var cam: mat3x3f = cameraMatrix(ro, (ro + vec3f(0.0, (-0.06), (-1.0))), 0.0);
    var rd: vec3f = cameraRay(cam, uv, FOCAL);
    var sunColor: vec3f = ((SUN_INTENSITY * 0.12) * sunTransmittance(viewKm, SUN_DIR));
    if ((rd.y >= 0.0)) {
        var sky: vec3f = atmosphereSky(rd, SUN_DIR, viewKm, SUN_INTENSITY);
        return (sky + ((sunColor * 40.0) * sunDisk(rd, SUN_DIR, 0.012, pixelAngle)));
    }
    var pixelSpread: vec4f = vec4f(normalize(rd.xz), pixelAngle, (pixelAngle / max((-rd.y), 0.01)));
    var bounds: vec3f = oceanBounds();
    var hit: vec2f = traceOcean(ro, rd, bounds, pixelSpread);
    var t: f32 = select((ro.y / (-rd.y)), hit.x, ((hit.x > 0.0)));
    var p: vec3f = (ro + (rd * t));
    var fp: vec4f = (pixelSpread * vec4f(1.0, 1.0, t, t));
    var lostSlope2: f32;
    var crest: f32;
    var wv: vec4f = oceanDetail(p.xz, fp, &lostSlope2, &crest);
    var slope: vec2f = wv.yz;
    var footprint: f32 = sqrt((fp.z * fp.w));
    var keepRipple: f32 = smoothstep(2.0, 6.0, (0.8 / footprint));
    var r1: vec3f = simplexNoiseD_f2f(((p.xz * 1.3) + (vec2f(cos((TAU * time)), sin((TAU * time))) * 0.9)), (TAU * time));
    var r2: vec3f = simplexNoiseD_f2f(((p.xz * 3.7) - (vec2f(cos((TAU * time)), sin((TAU * time))) * 0.6)), (((-2.0) * TAU) * time));
    slope += ((RIPPLE * keepRipple) * (((1.3 * r1.yz) + (((0.5 * 3.7) * r2.yz) * smoothstep(2.0, 6.0, (0.3 / footprint))))));
    lostSlope2 += (((RIPPLE * RIPPLE) * 4.0) * ((1.0 - keepRipple)));
    var n: vec3f = normalize(vec3f((-slope.x), 1.0, (-slope.y)));
    var lace: f32 = billowFbm_f2i(((p.xz * vec2f(1.2, 2.4)) + (0.5 * vec2f(cos((TAU * time)), sin((TAU * time))))), 6);
    var coverage: f32 = (0.7 * smoothstep(0.08, 0.3, crest));
    var foam: f32 = ((FOAM_AMOUNT * coverage) * smoothstep((1.0 - coverage), (1.15 - coverage), lace));
    var bubbles: f32 = (1.0 - smoothstep(0.0, 0.22, voronoiBorder((p.xz * vec2f(2.5, 4.0)), 1.0).x));
    foam *= mix(0.75, mix(0.4, 1.0, bubbles), smoothstep(2.0, 6.0, (0.3 / footprint)));
    var v: vec3f = (-rd);
    var NoV: f32 = max(dot(n, v), 1e-3);
    var F: vec3f = fresnelSchlick(NoV, vec3f(0.02));
    var refl: vec3f = reflect(rd, n);
    refl.y = abs(refl.y);
    var skyRefl: vec3f = atmosphereSky(refl, SUN_DIR, viewKm, SUN_INTENSITY);
    var skyAmbient: vec3f = atmosphereSky(vec3f(0.0, 1.0, 0.0), SUN_DIR, viewKm, SUN_INTENSITY);
    var alpha: f32 = sqrt(((0.02 * 0.02) + (2.0 * lostSlope2)));
    var glint: vec3f = (specularGGX(n, v, SUN_DIR, sqrt(alpha), vec3f(0.02)) * sunColor);
    var reflection: vec3f = (F * skyRefl);
    var backlit: f32 = pow(clamp(dot(rd, SUN_DIR), 0.0, 1.0), 4.0);
    var thin: f32 = smoothstep(0.45, 0.9, (((wv.x - bounds.x)) / ((bounds.y - bounds.x))));
    var body: vec3f = (((vec3f(1.0) - F)) * (((WATER_DEEP * ((skyAmbient + (sunColor * max(dot(n, SUN_DIR), 0.0))))) + (((WATER_GLOW * sunColor) * backlit) * thin))));
    var foamColor: vec3f = (vec3f(0.9) * (((sunColor * ((max(dot(n, SUN_DIR), 0.0) + (0.5 * backlit)))) + (3.0 * skyAmbient))));
    var col: vec3f = mix(((reflection + glint) + body), foamColor, foam);
    var fogColor: vec3f = atmosphereSky(normalize(vec3f(rd.x, 0.0, rd.z)), SUN_DIR, viewKm, SUN_INTENSITY);
    var airT: vec3f = exp(((((-t) * 0.001) * HAZE) * atmosphereExtinction(atmosphereDensity(0.0))));
    return ((col * airT) + (fogColor * ((vec3f(1.0) - airT))));
}

fn exampleMain() {

    var sampleCoord: vec2f = pixel;
    var col: vec3f = render(sampleCoord);
    col = (linearToSrgb(tonemapAgXPunchy((col * EXPOSURE))) + ditherTPDF(sampleCoord, i32(seed)));
    fragColor = vec4f(col, 1.0);
}
`,
}
