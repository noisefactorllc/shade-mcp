// Scene and material formulas adapted from the pinned shader-skills template.
// Full upstream provenance and MIT terms are attached by getShaderCraftExample.
export default {
  glsl: `const vec3 SUN_DIR = vec3(0.6965260331, 0.5970223141, -0.3980148761);
const vec3 SUN_COLOR = vec3(3.2, 2.8, 2.3);
const vec3 SKY_FILL = vec3(0.35, 0.45, 0.6);
const vec3 GROUND_FILL = vec3(0.18, 0.15, 0.12);
const float BLEND = 0.25;
const float EXPOSURE = 1.0;
const float FOCAL = 2.2;
const float MAT_FLOOR = 1.0;
const float MAT_PLINTH = 2.0;
const float MAT_GLAZE = 3.0;
const float MAT_GOLD = 4.0;
vec2 map(vec3 p) {
    vec2 res = vec2(p.y, MAT_FLOOR);
    float plinth = sdRoundBox(p - vec3(0.0, 0.3, 0.0), vec3(0.9, 0.3, 0.9), 0.04);
    if (plinth < res.x) res = vec2(plinth, MAT_PLINTH);
    vec3 q = p - vec3(0.0, 1.0, 0.0);
    q.xz = rot2(0.6) * q.xz;
    float block = sdRoundBox(q, vec3(0.32, 0.38, 0.32), 0.08);
    float ball = sdSphere(q - vec3(0.16, 0.44, 0.05), 0.3);
    vec2 blob = sminBlend(block, ball, BLEND);
    blob.x = smoothSubtract(blob.x, sdTorus(q - vec3(0.0, -0.08, 0.0), vec2(0.4, 0.05)), 0.04);
    if (blob.x < res.x) res = vec2(blob.x, MAT_GLAZE + 0.99 * blob.y);
    vec3 r = p - vec3(-0.45, 0.8, -0.5);
    r.yz = rot2(1.25) * r.yz;
    float ring = sdTorus(r, vec2(0.17, 0.035));
    if (ring < res.x) res = vec2(ring, MAT_GOLD);
    return res;
}
void material(float id, vec3 p, float footprint, out vec3 albedo, out float rough, out float metal) {
    float m = floor(id);
    rough = 0.5;
    metal = 0.0;
    if (m == MAT_FLOOR) {
        float checker = filteredChecker(p.xz * 2.0, vec2(footprint * 2.0));
        albedo = mix(vec3(0.30, 0.28, 0.26), vec3(0.42, 0.40, 0.37), checker);
        rough = 0.7;
    } else if (m == MAT_PLINTH) {
        albedo = vec3(0.55, 0.53, 0.5);
        rough = 0.85;
    } else if (m == MAT_GLAZE) {
        float w = fract(id) / 0.99;
        albedo = mixOklab(srgbToLinear(vec3(0.95, 0.45, 0.25)), srgbToLinear(vec3(0.15, 0.55, 0.6)), w);
        rough = 0.25;
    } else {
        albedo = vec3(1.0, 0.78, 0.34);
        rough = 0.2;
        metal = 1.0;
    }
}
vec3 render(vec2 sampleCoord) {
    vec2 uv = (2.0 * sampleCoord - resolution) / resolution.y;
    float an = TAU * fract(time);
    vec3 ro = vec3(3.4 * sin(an), 1.9, -3.4 * cos(an));
    vec3 ta = vec3(0.0, 0.85, 0.0);
    mat3 cam = cameraMatrix(ro, ta, 0.0);
    vec3 rd = cameraRay(cam, uv, FOCAL);
    vec3 sky = simpleSky(rd, SUN_DIR);
    vec3 hit = raymarch(ro, rd, 0.1, 30.0, 1.0);
    if (hit.x < 0.0) return sky;
    float t = hit.x;
    vec3 p = ro + rd * t;
    vec3 n = calcNormal(p, 0.0005 * t);
    vec3 v = -rd;
    vec3 albedo;
    float rough, metal;
    material(hit.y, p, t * 2.0 / (resolution.y * FOCAL), albedo, rough, metal);
    float sha = softShadow(p + n * 0.002, SUN_DIR, 0.01, 8.0, 12.0);
    float ao = calcAO(p, n, 0.15);
    vec3 refl = reflect(rd, n);
    vec3 f0 = mix(vec3(0.04), albedo, metal);
    vec3 key = shadePBR(n, v, SUN_DIR, albedo, rough, metal) * SUN_COLOR * sha;
    vec3 fill = albedo * (1.0 - metal) * hemisphereLight(n, SKY_FILL, GROUND_FILL) * ao;
    vec3 spec = envBRDFApprox(f0, max(dot(n, v), 0.0), rough) * simpleSky(refl, SUN_DIR)
              * ao * smoothstep(-0.1, 0.3, refl.y);
    vec3 bounceDir = normalize(vec3(-SUN_DIR.x, 0.0, -SUN_DIR.z));
    vec3 bounce = albedo * (1.0 - metal) * vec3(0.25, 0.18, 0.12) * clamp(dot(n, bounceDir), 0.0, 1.0) * ao;
    vec3 col = key + fill + spec + bounce;
    return mix(col, sky, distanceFog(t, 0.02));
}
void main() {
    vec2 sampleCoord = gl_FragCoord.xy;
    vec3 acc = vec3(0.0);
    for (int i = 0; i < 1; i++) {
        vec3 c = render(sampleCoord);
        c = tonemapAgX(c * EXPOSURE);
        acc += c;
    }
    vec3 col = acc / float(1);
    col = linearToSrgb(col) + ditherTPDF(sampleCoord, int(seed));
    fragColor = vec4(col, 1.0);
}
`,
  wgsl: `const SUN_DIR: vec3f = vec3f(0.6965260331, 0.5970223141, (-0.3980148761));

const SUN_COLOR: vec3f = vec3f(3.2, 2.8, 2.3);

const SKY_FILL: vec3f = vec3f(0.35, 0.45, 0.6);

const GROUND_FILL: vec3f = vec3f(0.18, 0.15, 0.12);

const BLEND: f32 = 0.25;

const EXPOSURE: f32 = 1.0;

const FOCAL: f32 = 2.2;

const MAT_FLOOR: f32 = 1.0;

const MAT_PLINTH: f32 = 2.0;

const MAT_GLAZE: f32 = 3.0;

const MAT_GOLD: f32 = 4.0;

fn map(p_arg: vec3f) -> vec2f {
    var p = p_arg;
    var res: vec2f = vec2f(p.y, MAT_FLOOR);
    var plinth: f32 = sdRoundBox((p - vec3f(0.0, 0.3, 0.0)), vec3f(0.9, 0.3, 0.9), 0.04);
    if ((plinth < res.x)) {
        res = vec2f(plinth, MAT_PLINTH);
    }
    var q: vec3f = (p - vec3f(0.0, 1.0, 0.0));
    { let swizzleValue = (rot2(0.6) * q.xz); q.x = swizzleValue.x; q.z = swizzleValue.y; }
    var block: f32 = sdRoundBox(q, vec3f(0.32, 0.38, 0.32), 0.08);
    var ball: f32 = sdSphere((q - vec3f(0.16, 0.44, 0.05)), 0.3);
    var blob: vec2f = sminBlend(block, ball, BLEND);
    blob.x = smoothSubtract(blob.x, sdTorus((q - vec3f(0.0, (-0.08), 0.0)), vec2f(0.4, 0.05)), 0.04);
    if ((blob.x < res.x)) {
        res = vec2f(blob.x, (MAT_GLAZE + (0.99 * blob.y)));
    }
    var r: vec3f = (p - vec3f((-0.45), 0.8, (-0.5)));
    { let swizzleValue = (rot2(1.25) * r.yz); r.y = swizzleValue.x; r.z = swizzleValue.y; }
    var ring: f32 = sdTorus(r, vec2f(0.17, 0.035));
    if ((ring < res.x)) {
        res = vec2f(ring, MAT_GOLD);
    }
    return res;
}

fn material(id_arg: f32, p_arg: vec3f, footprint_arg: f32, albedo: ptr<function, vec3f>, rough: ptr<function, f32>, metal: ptr<function, f32>) {
    var id = id_arg;
    var p = p_arg;
    var footprint = footprint_arg;
    var m: f32 = floor(id);
    (*rough) = 0.5;
    (*metal) = 0.0;
    if ((m == MAT_FLOOR)) {
        var checker: f32 = filteredChecker((p.xz * 2.0), vec2f((footprint * 2.0)));
        (*albedo) = mix(vec3f(0.30, 0.28, 0.26), vec3f(0.42, 0.40, 0.37), checker);
        (*rough) = 0.7;
    } else {
        if ((m == MAT_PLINTH)) {
            (*albedo) = vec3f(0.55, 0.53, 0.5);
            (*rough) = 0.85;
        } else {
            if ((m == MAT_GLAZE)) {
                var w: f32 = (fract(id) / 0.99);
                (*albedo) = mixOklab(srgbToLinear(vec3f(0.95, 0.45, 0.25)), srgbToLinear(vec3f(0.15, 0.55, 0.6)), w);
                (*rough) = 0.25;
            } else {
                (*albedo) = vec3f(1.0, 0.78, 0.34);
                (*rough) = 0.2;
                (*metal) = 1.0;
            }
        }
    }
}

fn render(fragCoord_arg: vec2f) -> vec3f {
    var sampleCoord = fragCoord_arg;
    var uv: vec2f = ((((2.0 * sampleCoord) - resolution)) / vec2f(resolution.y));
    var an: f32 = (TAU * time);
    var ro: vec3f = vec3f((3.4 * sin(an)), 1.9, ((-3.4) * cos(an)));
    var ta: vec3f = vec3f(0.0, 0.85, 0.0);
    var cam: mat3x3f = cameraMatrix(ro, ta, 0.0);
    var rd: vec3f = cameraRay(cam, uv, FOCAL);
    var sky: vec3f = simpleSky(rd, SUN_DIR);
    var hit: vec3f = raymarch(ro, rd, 0.1, 30.0, 1.0);
    if ((hit.x < 0.0)) {
        return sky;
    }
    var t: f32 = hit.x;
    var p: vec3f = (ro + (rd * t));
    var n: vec3f = calcNormal(p, (0.0005 * t));
    var v: vec3f = (-rd);
    var albedo: vec3f;
    var rough: f32;
    var metal: f32;
    material(hit.y, p, ((t * 2.0) / ((resolution.y * FOCAL))), &albedo, &rough, &metal);
    var sha: f32 = softShadow((p + (n * 0.002)), SUN_DIR, 0.01, 8.0, 12.0);
    var ao: f32 = calcAO(p, n, 0.15);
    var refl: vec3f = reflect(rd, n);
    var f0: vec3f = mix(vec3f(0.04), albedo, metal);
    var key: vec3f = ((shadePBR(n, v, SUN_DIR, albedo, rough, metal) * SUN_COLOR) * sha);
    var fill: vec3f = (((albedo * ((1.0 - metal))) * hemisphereLight(n, SKY_FILL, GROUND_FILL)) * ao);
    var spec: vec3f = (((envBRDFApprox(f0, max(dot(n, v), 0.0), rough) * simpleSky(refl, SUN_DIR)) * ao) * smoothstep((-0.1), 0.3, refl.y));
    var bounceDir: vec3f = normalize(vec3f((-SUN_DIR.x), 0.0, (-SUN_DIR.z)));
    var bounce: vec3f = ((((albedo * ((1.0 - metal))) * vec3f(0.25, 0.18, 0.12)) * clamp(dot(n, bounceDir), 0.0, 1.0)) * ao);
    var col: vec3f = (((key + fill) + spec) + bounce);
    return mix(col, sky, distanceFog(t, 0.02));
}

fn exampleMain() {

    var sampleCoord: vec2f = pixel;
    var acc: vec3f = vec3f(0.0);
    for (var i: i32 = 0; (i < 1); i++) {
        var c: vec3f = render(sampleCoord);
        c = tonemapAgX((c * EXPOSURE));
        acc += c;
    }
    var col: vec3f = (acc / vec3f(f32(1)));
    col = (linearToSrgb(col) + ditherTPDF(sampleCoord, i32(seed)));
    fragColor = vec4f(col, 1.0);
}
`,
}
