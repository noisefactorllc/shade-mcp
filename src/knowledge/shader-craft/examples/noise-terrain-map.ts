// Scene and material formulas adapted from the pinned shader-skills template.
// Full upstream provenance and MIT terms are attached by getShaderCraftExample.
export default {
  glsl: `const int OCTAVES = 5;
const float WORLD_SCALE = 5.0;
const float RIVER_WIDTH = 0.10;
vec2 terrainMapFields(vec2 p) {
    float h = hybridTerrainHeight(p, OCTAVES);
    float bend = 0.9 * fbm(vec2(p.y * 0.36, 2.7), 4);
    float riverDistance = abs(p.x - bend);
    float river = 1.0 - smoothstep(RIVER_WIDTH, RIVER_WIDTH + 0.075, riverDistance);
    h = mix(h, 0.19, river);
    return vec2(h, river);
}
void main() {
    vec2 sampleCoord = gl_FragCoord.xy;
    vec2 uv = (2.0 * sampleCoord - resolution) / resolution.y;
    vec2 p = uv * WORLD_SCALE;
    vec2 field = terrainMapFields(p);
    float e = 2.0 * WORLD_SCALE / resolution.y;
    vec2 slope = vec2(terrainMapFields(p+vec2(e,0.0)).x-terrainMapFields(p-vec2(e,0.0)).x,
                      terrainMapFields(p+vec2(0.0,e)).x-terrainMapFields(p-vec2(0.0,e)).x) / (2.0*e);
    vec3 n = normalize(vec3(-slope.x,0.7,-slope.y));
    float hills = smoothstep(0.38,0.63,field.x);
    float rock = smoothstep(0.58,0.78,field.x) * smoothstep(0.2,0.75,length(slope));
    vec3 land = mix(srgbToLinear(vec3(0.32,0.42,0.20)),srgbToLinear(vec3(0.61,0.57,0.35)),hills);
    land = mix(land,srgbToLinear(vec3(0.57,0.56,0.50)),rock);
    float diffuse = max(dot(n,vec3(-0.4662524041, 0.8392543274, 0.2797514425)),0.0);
    vec3 col = land * (0.3 + 1.2 * diffuse);
    float bank = 1.0 - smoothstep(0.02,0.11,abs(field.y-0.4));
    col = mix(col,srgbToLinear(vec3(0.64,0.58,0.37)),bank*0.65);
    vec3 water = mix(vec3(0.01,0.12,0.15),vec3(0.05,0.31,0.36),0.5+0.5*sin(p.y*7.0+p.x*3.0));
    col = mix(col,water,field.y);
    col = linearToSrgb(tonemapAgX(col*1.2));
    fragColor = vec4(col+ditherTPDF(sampleCoord,int(seed)),1.0);
}
`,
  wgsl: `const OCTAVES: i32 = 5;

const WORLD_SCALE: f32 = 5.0;

const RIVER_WIDTH: f32 = 0.10;

fn terrainMapFields(p_arg: vec2f) -> vec2f {
    var p = p_arg;
    var h: f32 = hybridTerrainHeight(p, OCTAVES);
    var bend: f32 = (0.9 * fbm_f2i(vec2f((p.y * 0.36), 2.7), 4));
    var riverDistance: f32 = abs((p.x - bend));
    var river: f32 = (1.0 - smoothstep(RIVER_WIDTH, (RIVER_WIDTH + 0.075), riverDistance));
    h = mix(h, 0.19, river);
    return vec2f(h, river);
}

fn exampleMain() {

    var sampleCoord: vec2f = pixel;
    var uv: vec2f = ((((2.0 * sampleCoord) - resolution)) / vec2f(resolution.y));
    var p: vec2f = (uv * WORLD_SCALE);
    var field: vec2f = terrainMapFields(p);
    var e: f32 = ((2.0 * WORLD_SCALE) / resolution.y);
    var slope: vec2f = (vec2f((terrainMapFields((p + vec2f(e, 0.0))).x - terrainMapFields((p - vec2f(e, 0.0))).x), (terrainMapFields((p + vec2f(0.0, e))).x - terrainMapFields((p - vec2f(0.0, e))).x)) / vec2f(((2.0 * e))));
    var n: vec3f = normalize(vec3f((-slope.x), 0.7, (-slope.y)));
    var hills: f32 = smoothstep(0.38, 0.63, field.x);
    var rock: f32 = (smoothstep(0.58, 0.78, field.x) * smoothstep(0.2, 0.75, length(slope)));
    var land: vec3f = mix(srgbToLinear(vec3f(0.32, 0.42, 0.20)), srgbToLinear(vec3f(0.61, 0.57, 0.35)), hills);
    land = mix(land, srgbToLinear(vec3f(0.57, 0.56, 0.50)), rock);
    var diffuse: f32 = max(dot(n, vec3f((-0.4662524041), 0.8392543274, 0.2797514425)), 0.0);
    var col: vec3f = (land * ((0.3 + (1.2 * diffuse))));
    var bank: f32 = (1.0 - smoothstep(0.02, 0.11, abs((field.y - 0.4))));
    col = mix(col, srgbToLinear(vec3f(0.64, 0.58, 0.37)), (bank * 0.65));
    var water: vec3f = mix(vec3f(0.01, 0.12, 0.15), vec3f(0.05, 0.31, 0.36), (0.5 + (0.5 * sin(((p.y * 7.0) + (p.x * 3.0))))));
    col = mix(col, water, field.y);
    col = linearToSrgb(tonemapAgX((col * 1.2)));
    fragColor = vec4f((col + ditherTPDF(sampleCoord, i32(seed))), 1.0);
}
`,
}
