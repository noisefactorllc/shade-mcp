// Scene and material formulas adapted from the pinned shader-skills template.
// Full upstream provenance and MIT terms are attached by getShaderCraftExample.
export default {
  glsl: `const vec3 SUN_DIR = vec3(0.6045512662, 0.2518963609, -0.7556890828);
const vec3 SUN_COLOR = vec3(6.0, 5.2, 4.2);
const float CLOUD_BOTTOM = 1.5;
const float CLOUD_TOP = 3.2;
const float COVERAGE = 0.42;
const float DENSITY = 9.0;
const float WIND = 0.06;
const float EXPOSURE = 1.0;
float cloudDensity(vec3 p, int octaves) {
    float h = (p.y - CLOUD_BOTTOM) / (CLOUD_TOP - CLOUD_BOTTOM);
    if (h < 0.0 || h > 1.0) return 0.0;
    float profile = smoothstep(0.0, 0.12, h) * (1.0 - smoothstep(0.45, 1.0, h));
    vec3 q = p * 0.55 + vec3(cos(TAU*fract(time))*WIND, 0.0, sin(TAU*fract(time))*WIND);
    float n = 0.5 + 0.5 * fbm(q, octaves, 2.02, 0.5);
    float d = saturate((n * profile - (1.0 - COVERAGE)) / COVERAGE);
    return d * DENSITY;
}
vec3 render(vec2 sampleCoord) {
    vec2 uv = (2.0 * sampleCoord - resolution) / resolution.y;
    vec3 ro = vec3(0.0, 0.3, 0.0);
    mat3 cam = cameraMatrix(ro, ro + vec3(0.35, 0.32, -1.0), 0.0);
    vec3 rd = cameraRay(cam, uv, 1.6);
    vec3 sky = simpleSky(rd, SUN_DIR) * 1.2;
    vec3 col = sky + SUN_COLOR * sunDisk(rd, SUN_DIR, 0.03, 2.0 / (resolution.y * 1.6));
    if (rd.y <= 0.01) return col;
    float t0 = (CLOUD_BOTTOM - ro.y) / rd.y;
    float t1 = min((CLOUD_TOP - ro.y) / rd.y, 30.0);
    const int STEPS = 48;
    float dt = (t1 - t0) / float(STEPS);
    float t = t0 + dt * interleavedGradientNoise(floor(sampleCoord), int(seed));
    float mu = dot(rd, SUN_DIR);
    float phase = 4.0 * PI * phaseDualHG(mu, 0.75, -0.25, 0.75);
    vec3 radiance = vec3(0.0), transmittance = vec3(1.0);
    for (int i = 0; i < STEPS; i++) {
        vec3 p = ro + rd * t;
        float sigma = cloudDensity(p, 5);
        if (sigma > 0.001) {
            float depth = 0.0;
            for (int j = 0; j < 5; j++) depth += cloudDensity(p + SUN_DIR * (0.1 + 0.25 * float(j)), 3) * 0.25;
            float h = (p.y - CLOUD_BOTTOM) / (CLOUD_TOP - CLOUD_BOTTOM);
            vec3 sunLight = SUN_COLOR * phase * mix(exp(-depth), beerPowder(depth), 0.5 - 0.5 * mu);
            vec3 ambient = vec3(0.22, 0.28, 0.38) * (0.3 + 0.7 * h);
            volumeStep(radiance, transmittance, vec3(sigma), sigma * (sunLight + ambient), dt);
        }
        if (transmittance.x < 0.01) break;
        t += dt;
    }
    float fade = exp(-0.04 * max(t0, 0.0));
    return mix(col, col * transmittance + radiance, fade);
}
void main() {
    vec2 sampleCoord = gl_FragCoord.xy;
    vec3 col = render(sampleCoord);
    col = linearToSrgb(tonemapAgX(col * EXPOSURE)) + ditherTPDF(sampleCoord, int(seed));
    fragColor = vec4(col, 1.0);
}
`,
  wgsl: `const SUN_DIR: vec3f = vec3f(0.6045512662, 0.2518963609, (-0.7556890828));

const SUN_COLOR: vec3f = vec3f(6.0, 5.2, 4.2);

const CLOUD_BOTTOM: f32 = 1.5;

const CLOUD_TOP: f32 = 3.2;

const COVERAGE: f32 = 0.42;

const DENSITY: f32 = 9.0;

const WIND: f32 = 0.06;

const EXPOSURE: f32 = 1.0;

fn cloudDensity(p_arg: vec3f, octaves_arg: i32) -> f32 {
    var p = p_arg;
    var octaves = octaves_arg;
    var h: f32 = (((p.y - CLOUD_BOTTOM)) / ((CLOUD_TOP - CLOUD_BOTTOM)));
    if (((h < 0.0) || (h > 1.0))) {
        return 0.0;
    }
    var profile: f32 = (smoothstep(0.0, 0.12, h) * (1.0 - smoothstep(0.45, 1.0, h)));
    var q: vec3f = ((p * 0.55) + vec3f((cos((TAU * time)) * WIND), 0.0, (sin((TAU * time)) * WIND)));
    var n: f32 = (0.5 + (0.5 * fbm_f3iff(q, octaves, 2.02, 0.5)));
    var d: f32 = saturate_f(((((n * profile) - ((1.0 - COVERAGE)))) / COVERAGE));
    return (d * DENSITY);
}

fn render(fragCoord_arg: vec2f) -> vec3f {
    var sampleCoord = fragCoord_arg;
    var uv: vec2f = ((((2.0 * sampleCoord) - resolution)) / vec2f(resolution.y));
    var ro: vec3f = vec3f(0.0, 0.3, 0.0);
    var cam: mat3x3f = cameraMatrix(ro, (ro + vec3f(0.35, 0.32, (-1.0))), 0.0);
    var rd: vec3f = cameraRay(cam, uv, 1.6);
    var sky: vec3f = (simpleSky(rd, SUN_DIR) * 1.2);
    var col: vec3f = (sky + (SUN_COLOR * sunDisk(rd, SUN_DIR, 0.03, (2.0 / ((resolution.y * 1.6))))));
    if ((rd.y <= 0.01)) {
        return col;
    }
    var t0: f32 = (((CLOUD_BOTTOM - ro.y)) / rd.y);
    var t1: f32 = min((((CLOUD_TOP - ro.y)) / rd.y), 30.0);
    let STEPS: i32 = 48;
    var dt: f32 = (((t1 - t0)) / f32(STEPS));
    var t: f32 = (t0 + (dt * interleavedGradientNoise_f2i(floor(sampleCoord), i32(seed))));
    var mu: f32 = dot(rd, SUN_DIR);
    var phase: f32 = ((4.0 * PI) * phaseDualHG(mu, 0.75, (-0.25), 0.75));
    var radiance: vec3f = vec3f(0.0);
    var transmittance: vec3f = vec3f(1.0);
    for (var i: i32 = 0; (i < STEPS); i++) {
        var p: vec3f = (ro + (rd * t));
        var sigma: f32 = cloudDensity(p, 5);
        if ((sigma > 0.001)) {
            var depth: f32 = 0.0;
            for (var j: i32 = 0; (j < 5); j++) {
                depth += (cloudDensity((p + (SUN_DIR * ((0.1 + (0.25 * f32(j)))))), 3) * 0.25);
            }
            var h: f32 = (((p.y - CLOUD_BOTTOM)) / ((CLOUD_TOP - CLOUD_BOTTOM)));
            var sunLight: vec3f = ((SUN_COLOR * phase) * mix(exp((-depth)), beerPowder(depth), (0.5 - (0.5 * mu))));
            var ambient: vec3f = (vec3f(0.22, 0.28, 0.38) * ((0.3 + (0.7 * h))));
            volumeStep(&radiance, &transmittance, vec3f(sigma), (sigma * ((sunLight + ambient))), dt);
        }
        if ((transmittance.x < 0.01)) {
            break;
        }
        t += dt;
    }
    var fade: f32 = exp(((-0.04) * max(t0, 0.0)));
    return mix(col, ((col * transmittance) + radiance), fade);
}

fn exampleMain() {

    var sampleCoord: vec2f = pixel;
    var col: vec3f = render(sampleCoord);
    col = (linearToSrgb(tonemapAgX((col * EXPOSURE))) + ditherTPDF(sampleCoord, i32(seed)));
    fragColor = vec4f(col, 1.0);
}
`,
}
