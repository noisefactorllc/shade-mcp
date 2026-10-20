// Scene and material formulas adapted from the pinned shader-skills template.
// Full upstream provenance and MIT terms are attached by getShaderCraftExample.
export default {
  glsl: `const float SCALE = 5.0;
const int OCTAVES = 5;
float noiseStudy(int id, vec2 p, float px) {
    if (id == 0) return 0.5 + 0.7 * gradientNoise(p);
    if (id == 1) return 1.0 - smoothstep(0.0, 0.13 + px, voronoiBorder(p, 0.85).x);
    if (id == 2) return 0.5 + 0.5 * simplexNoise(p);
    if (id == 3) return 0.5 + 0.5 * fbm(p, OCTAVES);
    if (id == 4) {
        vec2 q, r;
        float f = warpedFbm(p * 0.6, 1.5, 3, q, r);
        return 0.5 + 0.5 * sin(p.x * 2.0 + 6.0 * f);
    }
    if (id == 5) return valueNoise(p);
    if (id == 6) {
        vec4 cell = voronoi(p, 0.85);
        return saturate(1.8 * (cell.y - cell.x));
    }
    if (id == 7) return ridgedFbm(p, OCTAVES);
    if (id == 8) return billowFbm(p, OCTAVES);
    return hybridTerrainHeight(p, OCTAVES);
}
void main() {
    vec2 sampleCoord = gl_FragCoord.xy;
    vec2 board = sampleCoord / resolution * vec2(5.0, 2.0);
    ivec2 tile = ivec2(floor(board));
    int id = tile.x + (1 - tile.y) * 5;
    vec2 local = fract(board);
    vec2 p = local * SCALE + vec2(1.23, 4.56);
    float px = SCALE * 5.0 / resolution.x;
    float f = noiseStudy(id, p, px);
    vec3 col = vec3(saturate(f));
    vec2 edge = min(local,1.0-local);
    float frame = smoothstep(0.01,0.025,min(edge.x,edge.y));
    col = mix(vec3(0.035), col, frame);
    float tick = step(0.965,local.y) * step(0.1,local.x) * step(local.x,0.1+0.03*float(tile.x+1));
    col = mix(col,vec3(0.9),tick);
    fragColor = vec4(col + ditherTPDF(sampleCoord,int(seed)),1.0);
}
`,
  wgsl: `const SCALE: f32 = 5.0;

const OCTAVES: i32 = 5;

fn noiseStudy(id_arg: i32, p_arg: vec2f, px_arg: f32) -> f32 {
    var id = id_arg;
    var p = p_arg;
    var px = px_arg;
    if ((id == 0)) {
        return (0.5 + (0.7 * gradientNoise_f2(p)));
    }
    if ((id == 1)) {
        return (1.0 - smoothstep(0.0, (0.13 + px), voronoiBorder(p, 0.85).x));
    }
    if ((id == 2)) {
        return (0.5 + (0.5 * simplexNoise(p)));
    }
    if ((id == 3)) {
        return (0.5 + (0.5 * fbm_f2i(p, OCTAVES)));
    }
    if ((id == 4)) {
        var q: vec2f;
        var r: vec2f;
        var f: f32 = warpedFbm((p * 0.6), 1.5, 3, &q, &r);
        return (0.5 + (0.5 * sin(((p.x * 2.0) + (6.0 * f)))));
    }
    if ((id == 5)) {
        return valueNoise_f2(p);
    }
    if ((id == 6)) {
        var cell: vec4f = voronoi(p, 0.85);
        return saturate_f((1.8 * ((cell.y - cell.x))));
    }
    if ((id == 7)) {
        return ridgedFbm(p, OCTAVES);
    }
    if ((id == 8)) {
        return billowFbm_f2i(p, OCTAVES);
    }
    return hybridTerrainHeight(p, OCTAVES);
}

fn exampleMain() {

    var sampleCoord: vec2f = pixel;
    var board: vec2f = ((sampleCoord / resolution) * vec2f(5.0, 2.0));
    var tile: vec2i = vec2i(floor(board));
    var id: i32 = (tile.x + (((1 - tile.y)) * 5));
    var local: vec2f = fract(board);
    var p: vec2f = ((local * SCALE) + vec2f(1.23, 4.56));
    var px: f32 = ((SCALE * 5.0) / resolution.x);
    var f: f32 = noiseStudy(id, p, px);
    var col: vec3f = vec3f(saturate_f(f));
    var edge: vec2f = min(local, (vec2f(1.0) - local));
    var frame: f32 = smoothstep(0.01, 0.025, min(edge.x, edge.y));
    col = mix(vec3f(0.035), col, frame);
    var tick: f32 = ((step(0.965, local.y) * step(0.1, local.x)) * step(local.x, (0.1 + (0.03 * f32((tile.x + 1))))));
    col = mix(col, vec3f(0.9), tick);
    fragColor = vec4f((col + ditherTPDF(sampleCoord, i32(seed))), 1.0);
}
`,
}
