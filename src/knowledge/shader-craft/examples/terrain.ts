// Scene and material formulas adapted from the pinned shader-skills template.
// Full upstream provenance and MIT terms are attached by getShaderCraftExample.
export default {
  glsl: `const vec3 SUN_DIR = vec3(0.8652772176, 0.2035946394, -0.4580879387);
const float SUN_INTENSITY = 20.0;
const float TERRAIN_SCALE = 0.32;
const float TERRAIN_HEIGHT = 2.0;
const float SNOW_LINE = 1.05;
const float EXPOSURE = 1.4;
const float FOCAL = 1.8;
float terrainHeight(vec2 xz) { return TERRAIN_HEIGHT * erodedFbm(xz * TERRAIN_SCALE, 9); }
vec2 map(vec3 p) {
    return vec2(0.45 * (p.y - terrainHeight(p.xz)), 1.0);
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
    vec3 ro = vec3(-3.0 + 0.2 * sin(TAU*fract(time)), 0.0, 4.0 - 0.6 * sin(TAU*fract(time)));
    ro.y = terrainHeight(ro.xz) + 0.9;
    vec3 ta = ro + vec3(0.25, -0.16, -1.0);
    mat3 cam = cameraMatrix(ro, ta, 0.0);
    vec3 rd = cameraRay(cam, uv, FOCAL);
    vec3 sky = atmosphereSky(rd, SUN_DIR, ro.y, SUN_INTENSITY);
    vec3 sunColor = SUN_INTENSITY * 0.12 * sunTransmittance(ro.y, SUN_DIR);
    vec3 hit = raymarch(ro, rd, 0.01, 40.0, 1.0);
    if (hit.x < 0.0) {
        return sky + sunColor * 40.0 * sunDisk(rd, SUN_DIR, 0.012, 2.0 / (resolution.y * FOCAL));
    }
    float t = hit.x;
    vec3 p = ro + rd * t;
    vec3 n = calcNormal(p, 0.001 * t);
    float flatness = smoothstep(0.72, 0.88, n.y);
    float snow = smoothstep(SNOW_LINE - 0.15, SNOW_LINE + 0.1, p.y + 0.25 * fbm(p.xz * 6.0, 3))
               * smoothstep(0.55, 0.8, n.y);
    float grain = 0.5 + 0.5 * fbm(p.xz * 40.0, 4);
    vec3 rock = mix(vec3(0.10, 0.085, 0.07), vec3(0.20, 0.17, 0.14), grain);
    vec3 grass = mix(vec3(0.06, 0.08, 0.03), vec3(0.11, 0.12, 0.05), grain);
    vec3 albedo = mix(rock, grass, flatness * (1.0 - smoothstep(0.6, 1.0, p.y)));
    albedo = mix(albedo, vec3(0.85, 0.88, 0.92), snow);
    float sha = softShadow(p + n * 0.01, SUN_DIR, 0.02, 20.0, 16.0);
    float NoL = clamp(dot(n, SUN_DIR), 0.0, 1.0);
    vec3 skyAmbient = atmosphereSky(vec3(0.0, 1.0, 0.0), SUN_DIR, p.y, SUN_INTENSITY);
    vec3 key = albedo * sunColor * NoL * sha;
    vec3 fill = albedo * skyAmbient * (0.5 + 0.5 * n.y) * 2.0;
    vec3 bounce = albedo * sunColor * 0.08 * clamp(dot(n, normalize(vec3(-SUN_DIR.x, 0.0, -SUN_DIR.z))), 0.0, 1.0);
    vec3 col = key + fill + bounce;
    vec3 fogColor = atmosphereSky(normalize(vec3(rd.x, max(rd.y, 0.02), rd.z)), SUN_DIR, ro.y, SUN_INTENSITY);
    vec3 airT = exp(-t * atmosphereExtinction(atmosphereDensity(0.5 * (ro.y + p.y))) * 4.0);
    return col * airT + fogColor * (1.0 - airT);
}
void main() {
    vec2 sampleCoord = gl_FragCoord.xy;
    vec3 col = render(sampleCoord);
    col = linearToSrgb(tonemapAgX(col * EXPOSURE)) + ditherTPDF(sampleCoord, int(seed));
    fragColor = vec4(col, 1.0);
}
`,
  wgsl: `const SUN_DIR: vec3f = vec3f(0.8652772176, 0.2035946394, (-0.4580879387));

const SUN_INTENSITY: f32 = 20.0;

const TERRAIN_SCALE: f32 = 0.32;

const TERRAIN_HEIGHT: f32 = 2.0;

const SNOW_LINE: f32 = 1.05;

const EXPOSURE: f32 = 1.4;

const FOCAL: f32 = 1.8;

fn terrainHeight(xz_arg: vec2f) -> f32 {
    var xz = xz_arg;
    return (TERRAIN_HEIGHT * erodedFbm((xz * TERRAIN_SCALE), 9));
}

fn map(p_arg: vec3f) -> vec2f {
    var p = p_arg;
    return vec2f((0.45 * ((p.y - terrainHeight(p.xz)))), 1.0);
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
    var ro: vec3f = vec3f(((-3.0) + (0.2 * sin((TAU * time)))), 0.0, (4.0 - (0.6 * sin((TAU * time)))));
    ro.y = (terrainHeight(ro.xz) + 0.9);
    var ta: vec3f = (ro + vec3f(0.25, (-0.16), (-1.0)));
    var cam: mat3x3f = cameraMatrix(ro, ta, 0.0);
    var rd: vec3f = cameraRay(cam, uv, FOCAL);
    var sky: vec3f = atmosphereSky(rd, SUN_DIR, ro.y, SUN_INTENSITY);
    var sunColor: vec3f = ((SUN_INTENSITY * 0.12) * sunTransmittance(ro.y, SUN_DIR));
    var hit: vec3f = raymarch(ro, rd, 0.01, 40.0, 1.0);
    if ((hit.x < 0.0)) {
        return (sky + ((sunColor * 40.0) * sunDisk(rd, SUN_DIR, 0.012, (2.0 / ((resolution.y * FOCAL))))));
    }
    var t: f32 = hit.x;
    var p: vec3f = (ro + (rd * t));
    var n: vec3f = calcNormal(p, (0.001 * t));
    var flatness: f32 = smoothstep(0.72, 0.88, n.y);
    var snow: f32 = (smoothstep((SNOW_LINE - 0.15), (SNOW_LINE + 0.1), (p.y + (0.25 * fbm_f2i((p.xz * 6.0), 3)))) * smoothstep(0.55, 0.8, n.y));
    var grain: f32 = (0.5 + (0.5 * fbm_f2i((p.xz * 40.0), 4)));
    var rock: vec3f = mix(vec3f(0.10, 0.085, 0.07), vec3f(0.20, 0.17, 0.14), grain);
    var grass: vec3f = mix(vec3f(0.06, 0.08, 0.03), vec3f(0.11, 0.12, 0.05), grain);
    var albedo: vec3f = mix(rock, grass, (flatness * ((1.0 - smoothstep(0.6, 1.0, p.y)))));
    albedo = mix(albedo, vec3f(0.85, 0.88, 0.92), snow);
    var sha: f32 = softShadow((p + (n * 0.01)), SUN_DIR, 0.02, 20.0, 16.0);
    var NoL: f32 = clamp(dot(n, SUN_DIR), 0.0, 1.0);
    var skyAmbient: vec3f = atmosphereSky(vec3f(0.0, 1.0, 0.0), SUN_DIR, p.y, SUN_INTENSITY);
    var key: vec3f = (((albedo * sunColor) * NoL) * sha);
    var fill: vec3f = (((albedo * skyAmbient) * ((0.5 + (0.5 * n.y)))) * 2.0);
    var bounce: vec3f = (((albedo * sunColor) * 0.08) * clamp(dot(n, normalize(vec3f((-SUN_DIR.x), 0.0, (-SUN_DIR.z)))), 0.0, 1.0));
    var col: vec3f = ((key + fill) + bounce);
    var fogColor: vec3f = atmosphereSky(normalize(vec3f(rd.x, max(rd.y, 0.02), rd.z)), SUN_DIR, ro.y, SUN_INTENSITY);
    var airT: vec3f = exp((((-t) * atmosphereExtinction(atmosphereDensity((0.5 * ((ro.y + p.y)))))) * 4.0));
    return ((col * airT) + (fogColor * ((vec3f(1.0) - airT))));
}

fn exampleMain() {

    var sampleCoord: vec2f = pixel;
    var col: vec3f = render(sampleCoord);
    col = (linearToSrgb(tonemapAgX((col * EXPOSURE))) + ditherTPDF(sampleCoord, i32(seed)));
    fragColor = vec4f(col, 1.0);
}
`,
}
