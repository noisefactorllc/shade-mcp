// Scene and material formulas adapted from the pinned shader-skills template.
// Full upstream provenance and MIT terms are attached by getShaderCraftExample.
export default {
  glsl: `vec3 marble(vec2 p) {
    vec2 q, r;
    float f = warpedFbm(p * 1.5, 3.0, 5, q, r);
    vec3 col = mixOklab(srgbToLinear(vec3(0.92, 0.90, 0.86)), srgbToLinear(vec3(0.35, 0.38, 0.45)), saturate(length(q) * 0.9));
    col = mix(col, srgbToLinear(vec3(0.62, 0.42, 0.30)), saturate(r.y * r.y * 2.0));
    return col * (0.85 + 0.25 * f);
}
vec3 crackedEarth(vec2 p, float px) {
    vec3 v = voronoiBorder(p * 4.0, 0.9);
    vec2 cell = floor(p * 4.0 + v.yz);
    float tint = hash12(cell);
    vec3 col = mix(srgbToLinear(vec3(0.62, 0.44, 0.30)), srgbToLinear(vec3(0.75, 0.58, 0.40)), tint);
    col *= 0.75 + 0.25 * smoothstep(0.0, 0.25, v.x);
    float plate = fillAA(0.03 - v.x, px * 4.0);
    return mix(srgbToLinear(vec3(0.12, 0.08, 0.06)), col, plate);
}
vec3 hexTiles(vec2 p, float px) {
    vec4 h = hexGrid(p * 5.0);
    float edge = hexEdgeDistance(h.xy);
    vec3 base = oklchToLinearSrgb(vec3(0.7, 0.09, 3.6 + 0.8 * hash12(h.zw)));
    float bevel = smoothstep(0.0, 0.12, edge);
    return mix(vec3(0.02), base * (0.7 + 0.3 * bevel), smoothstep(0.03 - px * 5.0, 0.03 + px * 5.0, edge));
}
vec3 truchet(vec2 p, float px) {
    float d = truchetArcs(p * 5.0, 0.12) / 5.0;
    float stripe = truchetArcs(p * 5.0, 0.03) / 5.0;
    vec3 col = srgbToLinear(vec3(0.08, 0.10, 0.16));
    col = mix(col, srgbToLinear(vec3(0.95, 0.75, 0.30)), fillAA(d, px));
    return mix(col, srgbToLinear(vec3(0.55, 0.20, 0.10)), fillAA(stripe, px));
}
vec3 organicCells(vec2 p) {
    float s = smoothVoronoi(p * 5.0, 12.0);
    vec3 col = mixOklab(srgbToLinear(vec3(0.95, 0.55, 0.55)), srgbToLinear(vec3(0.35, 0.05, 0.15)), saturate(s * 1.6));
    return col * (0.6 + 0.4 * smoothstep(0.1, 0.5, s));
}
vec3 checker(vec2 p, float px) {
    float z = 1.0 / max(0.55 - p.y, 0.02);
    vec2 floorUV = vec2(p.x * z, z) * 1.5;
    float c = filteredChecker(floorUV, vec2(px * z * z * 1.5 + px * z * 1.5));
    return mix(vec3(0.05), vec3(0.8), c) * (1.0 - smoothstep(0.3, 0.55, p.y));
}
void main() {
    vec2 sampleCoord = gl_FragCoord.xy;
    vec2 uv = sampleCoord / resolution.y;
    float px = 1.0 / resolution.y;
    float aspect = resolution.x / resolution.y;
    vec2 grid = vec2(3.0, 2.0);
    vec2 tileSize = vec2(aspect, 1.0) / grid;
    vec2 id = floor(uv / tileSize);
    vec2 local = (uv - id * tileSize) / tileSize.y;
    vec2 p = local - 0.5 * vec2(tileSize.x / tileSize.y, 1.0);
    float k = id.x + 3.0 * (1.0 - id.y);
    float lpx = px / tileSize.y;
    vec3 col;
    if (k < 0.5) col = marble(p + 0.05 * vec2(cos(TAU*fract(time)),sin(TAU*fract(time))));
    else if (k < 1.5) col = crackedEarth(p, lpx);
    else if (k < 2.5) col = hexTiles(p, lpx);
    else if (k < 3.5) col = truchet(p, lpx);
    else if (k < 4.5) col = organicCells(p + 0.03 * vec2(cos(TAU*fract(time)),sin(TAU*fract(time))));
    else col = checker(p, lpx);
    vec2 e = min(local, vec2(tileSize.x / tileSize.y, 1.0) - local);
    col *= smoothstep(0.0, 0.02, min(e.x, e.y));
    fragColor = vec4(linearToSrgb(col) + ditherTPDF(sampleCoord, int(seed)), 1.0);
}
`,
  wgsl: `fn marble(p_arg: vec2f) -> vec3f {
    var p = p_arg;
    var q: vec2f;
    var r: vec2f;
    var f: f32 = warpedFbm((p * 1.5), 3.0, 5, &q, &r);
    var col: vec3f = mixOklab(srgbToLinear(vec3f(0.92, 0.90, 0.86)), srgbToLinear(vec3f(0.35, 0.38, 0.45)), saturate_f((length(q) * 0.9)));
    col = mix(col, srgbToLinear(vec3f(0.62, 0.42, 0.30)), saturate_f(((r.y * r.y) * 2.0)));
    return (col * ((0.85 + (0.25 * f))));
}

fn crackedEarth(p_arg: vec2f, px_arg: f32) -> vec3f {
    var p = p_arg;
    var px = px_arg;
    var v: vec3f = voronoiBorder((p * 4.0), 0.9);
    var cell: vec2f = floor(((p * 4.0) + v.yz));
    var tint: f32 = hash12(cell);
    var col: vec3f = mix(srgbToLinear(vec3f(0.62, 0.44, 0.30)), srgbToLinear(vec3f(0.75, 0.58, 0.40)), tint);
    col *= (0.75 + (0.25 * smoothstep(0.0, 0.25, v.x)));
    var plate: f32 = fillAA_ff((0.03 - v.x), (px * 4.0));
    return mix(srgbToLinear(vec3f(0.12, 0.08, 0.06)), col, plate);
}

fn hexTiles(p_arg: vec2f, px_arg: f32) -> vec3f {
    var p = p_arg;
    var px = px_arg;
    var h: vec4f = hexGrid((p * 5.0));
    var edge: f32 = hexEdgeDistance(h.xy);
    var base: vec3f = oklchToLinearSrgb(vec3f(0.7, 0.09, (3.6 + (0.8 * hash12(h.zw)))));
    var bevel: f32 = smoothstep(0.0, 0.12, edge);
    return mix(vec3f(0.02), (base * ((0.7 + (0.3 * bevel)))), smoothstep((0.03 - (px * 5.0)), (0.03 + (px * 5.0)), edge));
}

fn truchet(p_arg: vec2f, px_arg: f32) -> vec3f {
    var p = p_arg;
    var px = px_arg;
    var d: f32 = (truchetArcs((p * 5.0), 0.12) / 5.0);
    var stripe: f32 = (truchetArcs((p * 5.0), 0.03) / 5.0);
    var col: vec3f = srgbToLinear(vec3f(0.08, 0.10, 0.16));
    col = mix(col, srgbToLinear(vec3f(0.95, 0.75, 0.30)), fillAA_ff(d, px));
    return mix(col, srgbToLinear(vec3f(0.55, 0.20, 0.10)), fillAA_ff(stripe, px));
}

fn organicCells(p_arg: vec2f) -> vec3f {
    var p = p_arg;
    var s: f32 = smoothVoronoi((p * 5.0), 12.0);
    var col: vec3f = mixOklab(srgbToLinear(vec3f(0.95, 0.55, 0.55)), srgbToLinear(vec3f(0.35, 0.05, 0.15)), saturate_f((s * 1.6)));
    return (col * ((0.6 + (0.4 * smoothstep(0.1, 0.5, s)))));
}

fn checker(p_arg: vec2f, px_arg: f32) -> vec3f {
    var p = p_arg;
    var px = px_arg;
    var z: f32 = (1.0 / max((0.55 - p.y), 0.02));
    var floorUV: vec2f = (vec2f((p.x * z), z) * 1.5);
    var c: f32 = filteredChecker(floorUV, vec2f(((((px * z) * z) * 1.5) + ((px * z) * 1.5))));
    return (mix(vec3f(0.05), vec3f(0.8), c) * (1.0 - smoothstep(0.3, 0.55, p.y)));
}

fn exampleMain() {

    var sampleCoord: vec2f = pixel;
    var uv: vec2f = (sampleCoord / vec2f(resolution.y));
    var px: f32 = (1.0 / resolution.y);
    var aspect: f32 = (resolution.x / resolution.y);
    var grid: vec2f = vec2f(3.0, 2.0);
    var tileSize: vec2f = (vec2f(aspect, 1.0) / grid);
    var id: vec2f = floor((uv / tileSize));
    var local: vec2f = (((uv - (id * tileSize))) / vec2f(tileSize.y));
    var p: vec2f = (local - (0.5 * vec2f((tileSize.x / tileSize.y), 1.0)));
    var k: f32 = (id.x + (3.0 * ((1.0 - id.y))));
    var lpx: f32 = (px / tileSize.y);
    var col: vec3f;
    if ((k < 0.5)) {
        col = marble((p + (0.05 * vec2f(cos((TAU * time)), sin((TAU * time))))));
    } else {
        if ((k < 1.5)) {
            col = crackedEarth(p, lpx);
        } else {
            if ((k < 2.5)) {
                col = hexTiles(p, lpx);
            } else {
                if ((k < 3.5)) {
                    col = truchet(p, lpx);
                } else {
                    if ((k < 4.5)) {
                        col = organicCells((p + (0.03 * vec2f(cos((TAU * time)), sin((TAU * time))))));
                    } else {
                        col = checker(p, lpx);
                    }
                }
            }
        }
    }
    var e: vec2f = min(local, (vec2f((tileSize.x / tileSize.y), 1.0) - local));
    col *= smoothstep(0.0, 0.02, min(e.x, e.y));
    fragColor = vec4f((linearToSrgb(col) + ditherTPDF(sampleCoord, i32(seed))), 1.0);
}
`,
}
