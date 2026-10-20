// Adapted for Noisemaker effects from gokayfem/shader-skills skills/shader-art-coding/glsl/sdf3d.glsl
// at e09bc993bf04201f26c03c87c89210e9b472f526 (MIT, Copyright (c) 2026 gokayfem).
// The WGSL twin translates the same code. The licence text is in ../../license.ts; the upstream record is
// ../../provenance.json.

export const SDF3D_GLSL = `//! sdf3d: 3D signed distance primitives. Each one is centered at the origin unless noted. Move or rotate the
//! point before calling (sdBox(p - center, size)), never the result.
//! Exactness tags:
//!   @exact  true Euclidean distance inside and outside (safe for smooth blending, AO, soft shadows, offsets)
//!   @bound  never overestimates (Lipschitz <= 1), so raymarching is safe, but offsets and blends are less accurate
//!   @approx exact zero set but may overestimate in places (see the function's note for the safe stepScale)
//! Formulas follow Inigo Quilez's distance-function catalog (article "distance functions").
//! Implementations here are original and checked by the upstream tests (sign, Lipschitz bound, eikonal).

/// Sphere of radius r.
/// @exact
/// @use heads, eyes, fruit, planets, bubbles, joints
float sdSphere(vec3 p, float r) { return length(p) - r; }

/// Axis-aligned box with half-extents b.
/// @exact
/// @use buildings, crates, bricks, pedestals, furniture
float sdBox(vec3 p, vec3 b) {
    vec3 q = abs(p) - b;
    return length(max(q, 0.0)) + min(max(q.x, max(q.y, q.z)), 0.0);
}

/// Box with rounded edges. The outer size stays b; r is the edge radius (r <= min(b)).
/// @exact
/// @use toys, product shots, soft architecture, dice, phone-like slabs
float sdRoundBox(vec3 p, vec3 b, float r) {
    vec3 q = abs(p) - b + r;
    return length(max(q, 0.0)) + min(max(q.x, max(q.y, q.z)), 0.0) - r;
}

/// Wireframe box: edges of a box with half-extents b and edge thickness e.
/// @exact
/// @use scaffolding, cages, display frames, sci-fi structures
float sdBoxFrame(vec3 p, vec3 b, float e) {
    p = abs(p) - b;
    vec3 q = abs(p + e) - e;
    return min(min(
        length(max(vec3(p.x, q.y, q.z), 0.0)) + min(max(p.x, max(q.y, q.z)), 0.0),
        length(max(vec3(q.x, p.y, q.z), 0.0)) + min(max(q.x, max(p.y, q.z)), 0.0)),
        length(max(vec3(q.x, q.y, p.z), 0.0)) + min(max(q.x, max(q.y, p.z)), 0.0));
}

/// Torus in the XZ plane. t.x = major radius, t.y = tube radius.
/// @exact
/// @use rings, donuts, tires, halos, lifebuoys
float sdTorus(vec3 p, vec2 t) {
    vec2 q = vec2(length(p.xz) - t.x, p.y);
    return length(q) - t.y;
}

/// Partial torus (arc) in the XY plane, symmetric about +Y. sc = vec2(sin, cos) of the half-aperture angle,
/// ra = major radius, rb = tube radius.
/// @exact
/// @use horns, handles, eyebrows, arches, croissant shapes, magnets
float sdCappedTorus(vec3 p, vec2 sc, float ra, float rb) {
    p.x = abs(p.x);
    float k = (sc.y * p.x > sc.x * p.y) ? dot(p.xy, sc) : length(p.xy);
    return sqrt(max(dot(p, p) + ra * ra - 2.0 * ra * k, 0.0)) - rb;
}

/// Chain link: a torus stretched along Y by le. r1 = major radius, r2 = tube radius.
/// @exact
/// @use chains, rings, jewelry, fences
float sdLink(vec3 p, float le, float r1, float r2) {
    vec3 q = vec3(p.x, max(abs(p.y) - le, 0.0), p.z);
    return length(vec2(length(q.xy) - r1, q.z)) - r2;
}

/// Infinite plane through the origin offset by h along unit normal n: dot(p, n) + h.
/// @exact
/// @use ground, walls, water surface, clipping half-spaces
float sdPlane(vec3 p, vec3 n, float h) { return dot(p, n) + h; }

/// Capsule: segment a-b swept by radius r.
/// @exact
/// @use limbs, fingers, branches, hair strands, pills, bones
float sdCapsule(vec3 p, vec3 a, vec3 b, float r) {
    vec3 pa = p - a, ba = b - a;
    float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
    return length(pa - ba * h) - r;
}

/// Vertical capsule from y = 0 to y = h, radius r.
/// @exact
/// @use upright limbs, posts, bottles, candles
float sdVerticalCapsule(vec3 p, float h, float r) {
    p.y -= clamp(p.y, 0.0, h);
    return length(p) - r;
}

/// Vertical capped cylinder from y = -h to y = +h, radius r.
/// @exact
/// @use columns, cans, coins, logs, wheels (rotate first)
float sdCylinder(vec3 p, float h, float r) {
    vec2 d = abs(vec2(length(p.xz), p.y)) - vec2(r, h);
    return min(max(d.x, d.y), 0.0) + length(max(d, 0.0));
}

/// Capped cone (frustum) from y = -h (radius r1) to y = +h (radius r2). Set r2 = 0 for a pointed cone.
/// Exact everywhere, including the base cap. Points below the base are outside.
/// @exact
/// @use trees, roofs, spikes, lampshades, volcanoes, party hats, vases
float sdCappedCone(vec3 p, float h, float r1, float r2) {
    vec2 q = vec2(length(p.xz), p.y);
    vec2 top = vec2(r2, h);
    vec2 side = vec2(r2 - r1, 2.0 * h);
    vec2 toCap = vec2(q.x - min(q.x, (q.y < 0.0) ? r1 : r2), abs(q.y) - h);
    vec2 toSide = q - top + side * clamp(dot(top - q, side) / dot2(side), 0.0, 1.0);
    float s = (toSide.x < 0.0 && toCap.y < 0.0) ? -1.0 : 1.0;
    return s * sqrt(min(dot2(toCap), dot2(toSide)));
}

/// Pointed cone with its base disk (radius r) at y = 0 and apex at y = h.
/// @exact
/// @use evergreen trees, spikes, horns, mountains, wizard hats
float sdCone(vec3 p, float h, float r) {
    return sdCappedCone(p - vec3(0.0, 0.5 * h, 0.0), 0.5 * h, r, 0.0);
}

/// Round cone: sphere r1 at y = 0 smoothly hulled with sphere r2 at y = h.
/// @exact
/// @use limbs, fingers, tree trunks, carrots, teardrops, tentacle segments
float sdRoundCone(vec3 p, float r1, float r2, float h) {
    float b = (r1 - r2) / h;
    float a = sqrt(1.0 - b * b);
    vec2 q = vec2(length(p.xz), p.y);
    float k = dot(q, vec2(-b, a));
    if (k < 0.0) return length(q) - r1;
    if (k > a * h) return length(q - vec2(0.0, h)) - r2;
    return dot(q, vec2(a, b)) - r1;
}

/// Ellipsoid with semi-axes r. A fast approximation: the zero set is exact and the field is a bound outside for
/// aspect ratios up to about 2:1. Inside, and for more stretched ellipsoids, the gradient exceeds 1 (measured: 2.5
/// at 4:1). March with stepScale 0.7-0.8 there, or build long shapes from sdCapsule / sdRoundCone instead.
/// @approx
/// @use heads, bodies, eggs, pebbles, leaves (flat), muscles, clouds of blobs
float sdEllipsoid(vec3 p, vec3 r) {
    float k0 = length(p / r);
    float k1 = length(p / (r * r));
    if (k1 < 1e-8) return -min(r.x, min(r.y, r.z));
    return k0 * (k0 - 1.0) / k1;
}

/// Hollow spherical cap (bowl) of radius r, cut by the plane y = h, with shell thickness t. The opening faces +Y.
/// @exact
/// @use bowls, cups, helmets, shells, satellite dishes, eye sockets
float sdCutHollowSphere(vec3 p, float r, float h, float t) {
    float w = sqrt(r * r - h * h);
    vec2 q = vec2(length(p.xz), p.y);
    return ((h * q.x < w * q.y) ? length(q - vec2(w, h)) : abs(length(q) - r)) - t;
}

/// Hexagonal prism along Z. h.x = inradius of the hexagon, h.y = half-length.
/// @exact
/// @use pencils, bolts, crystals, basalt columns, honeycomb cells
float sdHexPrism(vec3 p, vec2 h) {
    const vec3 k = vec3(-0.8660254, 0.5, 0.57735027);
    p = abs(p);
    p.xy -= 2.0 * min(dot(k.xy, p.xy), 0.0) * k.xy;
    vec2 d = vec2(length(p.xy - vec2(clamp(p.x, -k.z * h.x, k.z * h.x), h.x)) * sign(p.y - h.x),
                  p.z - h.y);
    return min(max(d.x, d.y), 0.0) + length(max(d, 0.0));
}

/// Regular octahedron with "radius" s (vertex distance from center). Bound version.
/// @bound
/// @use gems, crystals, diamonds, abstract motifs
float sdOctahedron(vec3 p, float s) {
    p = abs(p);
    return (p.x + p.y + p.z - s) * 0.57735027;
}

/// Gyroid sheet with cell scale \`scale\` and half-thickness t. The infinite triply-periodic surface
/// sin x cos y + sin y cos z + sin z cos x = 0. Intersect with a bounding shape.
/// @bound
/// @use lattices, coral, bone interiors, sponges, sci-fi infill, organic architecture
float sdGyroid(vec3 p, float scale, float t) {
    p *= scale;
    float g = dot(sin(p), cos(p.yzx));
    return (abs(g) / scale - t) * 0.57735027;
}

/// Sphere of radius r cut by the plane y = h, keeping the cap ABOVE the plane. h = 0 gives a dome on the ground;
/// negative h keeps more than half. Needs |h| < r.
/// @exact
/// @use domes, mushroom caps, half-buried rocks, igloos, bread loaves
float sdCutSphere(vec3 p, float r, float h) {
    float w = sqrt(max(r * r - h * h, 0.0));
    vec2 q = vec2(length(p.xz), p.y);
    float s = max((h - r) * q.x * q.x + w * w * (h + r - 2.0 * q.y), h * q.x - w * q.y);
    return (s < 0.0) ? length(q) - r : (q.x < w) ? h - q.y : length(q - vec2(w, h));
}

/// Sphere ra at the origin with sphere rb at (d, 0, 0) carved out, exact including the crease rim.
/// A plain opSubtract of two spheres is only a bound.
/// @exact
/// @use eye sockets, craters, bitten fruit, nostrils, scooped shapes
float sdDeathStar(vec3 p, float ra, float rb, float d) {
    float a = (ra * ra - rb * rb + d * d) / (2.0 * d);
    float b = sqrt(max(ra * ra - a * a, 0.0));
    vec2 q = vec2(p.x, length(p.yz));
    if (q.x * b - q.y * a > d * max(b - q.y, 0.0)) return length(q - vec2(a, b));
    return max(length(q) - ra, -(length(q - vec2(d, 0.0)) - rb));
}

/// Unsigned distance to a 3D quadratic Bezier curve A-B-C; subtract a radius for a tube.
/// Solves the closest-point cubic analytically. Falls back to a segment when the curve is straight.
/// @exact
/// @use hair strands, tentacles, stems, whiskers, horns, cables, curved tubes
float sdQuadraticBezier(vec3 pos, vec3 A, vec3 B, vec3 C) {
    vec3 a = B - A;
    vec3 b = A - 2.0 * B + C;
    vec3 c = a * 2.0;
    vec3 d = A - pos;
    float bb = dot(b, b);
    if (bb < 1e-10) {
        vec3 pa = pos - A, ca = C - A;
        return length(pa - ca * clamp(dot(pa, ca) / dot(ca, ca), 0.0, 1.0));
    }
    float kk = 1.0 / bb;
    float kx = kk * dot(a, b);
    float ky = kk * (2.0 * dot(a, a) + dot(d, b)) / 3.0;
    float kz = kk * dot(d, a);
    float pp = ky - kx * kx;
    float q = kx * (2.0 * kx * kx - 3.0 * ky) + kz;
    float h = q * q + 4.0 * pp * pp * pp;
    float res;
    if (h >= 0.0) {
        h = sqrt(h);
        vec2 x = (vec2(h, -h) - q) / 2.0;
        vec2 uv = sign(x) * pow(abs(x), vec2(1.0 / 3.0));
        float t = clamp(uv.x + uv.y - kx, 0.0, 1.0);
        res = dot2(d + (c + b * t) * t);
    } else {
        float z = sqrt(-pp);
        float v = acos(clamp(q / (pp * z * 2.0), -1.0, 1.0)) / 3.0;
        float m = cos(v);
        float n = sin(v) * 1.7320508;
        vec2 t = clamp(vec2(m + m, -n - m) * z - kx, 0.0, 1.0);
        res = min(dot2(d + (c + b * t.x) * t.x), dot2(d + (c + b * t.y) * t.y));
    }
    return sqrt(res);
}
`

export const SDF3D_WGSL = `//! sdf3d: 3D signed distance primitives. Each one is centered at the origin unless noted. Move or rotate the
//! point before calling (sdBox(p - center, size)), never the result.
//! Exactness tags:
//!   @exact  true Euclidean distance inside and outside (safe for smooth blending, AO, soft shadows, offsets)
//!   @bound  never overestimates (Lipschitz <= 1), so raymarching is safe, but offsets and blends are less accurate
//!   @approx exact zero set but may overestimate in places (see the function's note for the safe stepScale)
//! Formulas follow Inigo Quilez's distance-function catalog (article "distance functions").
//! Implementations here are original and checked by the upstream tests (sign, Lipschitz bound, eikonal).

/// Sphere of radius r.
/// @exact
/// @use heads, eyes, fruit, planets, bubbles, joints
fn sdSphere(p: vec3f, r: f32) -> f32 { return length(p) - r; }

/// Axis-aligned box with half-extents b.
/// @exact
/// @use buildings, crates, bricks, pedestals, furniture
fn sdBox_f3f3(p: vec3f, b: vec3f) -> f32 {
    let q = abs(p) - b;
    return length(max(q, vec3f(0.0))) + min(max(q.x, max(q.y, q.z)), 0.0);
}

/// Box with rounded edges. The outer size stays b; r is the edge radius (r <= min(b)).
/// @exact
/// @use toys, product shots, soft architecture, dice, phone-like slabs
fn sdRoundBox(p: vec3f, b: vec3f, r: f32) -> f32 {
    let q = abs(p) - b + r;
    return length(max(q, vec3f(0.0))) + min(max(q.x, max(q.y, q.z)), 0.0) - r;
}

/// Wireframe box: edges of a box with half-extents b and edge thickness e.
/// @exact
/// @use scaffolding, cages, display frames, sci-fi structures
fn sdBoxFrame(p: vec3f, b: vec3f, e: f32) -> f32 {
    let p_ = abs(p) - b;
    let q = abs(p_ + e) - e;
    return min(min(
        length(max(vec3f(p_.x, q.y, q.z), vec3f(0.0))) + min(max(p_.x, max(q.y, q.z)), 0.0),
        length(max(vec3f(q.x, p_.y, q.z), vec3f(0.0))) + min(max(q.x, max(p_.y, q.z)), 0.0)),
        length(max(vec3f(q.x, q.y, p_.z), vec3f(0.0))) + min(max(q.x, max(q.y, p_.z)), 0.0));
}

/// Torus in the XZ plane. t.x = major radius, t.y = tube radius.
/// @exact
/// @use rings, donuts, tires, halos, lifebuoys
fn sdTorus(p: vec3f, t: vec2f) -> f32 {
    let q = vec2f(length(p.xz) - t.x, p.y);
    return length(q) - t.y;
}

/// Partial torus (arc) in the XY plane, symmetric about +Y. sc = vec2f(sin, cos) of the half-aperture angle,
/// ra = major radius, rb = tube radius.
/// @exact
/// @use horns, handles, eyebrows, arches, croissant shapes, magnets
fn sdCappedTorus(p: vec3f, sc: vec2f, ra: f32, rb: f32) -> f32 {
    var p_ = p;
    p_.x = abs(p_.x);
    let k = select(length(p_.xy), dot(p_.xy, sc), sc.y * p_.x > sc.x * p_.y);
    return sqrt(max(dot(p_, p_) + ra * ra - 2.0 * ra * k, 0.0)) - rb;
}

/// Chain link: a torus stretched along Y by le. r1 = major radius, r2 = tube radius.
/// @exact
/// @use chains, rings, jewelry, fences
fn sdLink(p: vec3f, le: f32, r1: f32, r2: f32) -> f32 {
    let q = vec3f(p.x, max(abs(p.y) - le, 0.0), p.z);
    return length(vec2f(length(q.xy) - r1, q.z)) - r2;
}

/// Infinite plane through the origin offset by h along unit normal n: dot(p, n) + h.
/// @exact
/// @use ground, walls, water surface, clipping half-spaces
fn sdPlane(p: vec3f, n: vec3f, h: f32) -> f32 { return dot(p, n) + h; }

/// Capsule: segment a-b swept by radius r.
/// @exact
/// @use limbs, fingers, branches, hair strands, pills, bones
fn sdCapsule(p: vec3f, a: vec3f, b: vec3f, r: f32) -> f32 {
    let pa = p - a;
    let ba = b - a;
    let h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
    return length(pa - ba * h) - r;
}

/// Vertical capsule from y = 0 to y = h, radius r.
/// @exact
/// @use upright limbs, posts, bottles, candles
fn sdVerticalCapsule(p: vec3f, h: f32, r: f32) -> f32 {
    var p_ = p;
    p_.y -= clamp(p_.y, 0.0, h);
    return length(p_) - r;
}

/// Vertical capped cylinder from y = -h to y = +h, radius r.
/// @exact
/// @use columns, cans, coins, logs, wheels (rotate first)
fn sdCylinder(p: vec3f, h: f32, r: f32) -> f32 {
    let d = abs(vec2f(length(p.xz), p.y)) - vec2f(r, h);
    return min(max(d.x, d.y), 0.0) + length(max(d, vec2f(0.0)));
}

/// Capped cone (frustum) from y = -h (radius r1) to y = +h (radius r2). Set r2 = 0 for a pointed cone.
/// Exact everywhere, including the base cap. Points below the base are outside.
/// @exact
/// @use trees, roofs, spikes, lampshades, volcanoes, party hats, vases
fn sdCappedCone(p: vec3f, h: f32, r1: f32, r2: f32) -> f32 {
    let q = vec2f(length(p.xz), p.y);
    let top = vec2f(r2, h);
    let side = vec2f(r2 - r1, 2.0 * h);
    let toCap = vec2f(q.x - min(q.x, select(r2, r1, q.y < 0.0)), abs(q.y) - h);
    let toSide = q - top + side * clamp(dot(top - q, side) / dot2_f2(side), 0.0, 1.0);
    let s = select(1.0, -1.0, toSide.x < 0.0 && toCap.y < 0.0);
    return s * sqrt(min(dot2_f2(toCap), dot2_f2(toSide)));
}

/// Pointed cone with its base disk (radius r) at y = 0 and apex at y = h.
/// @exact
/// @use evergreen trees, spikes, horns, mountains, wizard hats
fn sdCone(p: vec3f, h: f32, r: f32) -> f32 {
    return sdCappedCone(p - vec3f(0.0, 0.5 * h, 0.0), 0.5 * h, r, 0.0);
}

/// Round cone: sphere r1 at y = 0 smoothly hulled with sphere r2 at y = h.
/// @exact
/// @use limbs, fingers, tree trunks, carrots, teardrops, tentacle segments
fn sdRoundCone(p: vec3f, r1: f32, r2: f32, h: f32) -> f32 {
    let b = (r1 - r2) / h;
    let a = sqrt(1.0 - b * b);
    let q = vec2f(length(p.xz), p.y);
    let k = dot(q, vec2f(-b, a));
    if (k < 0.0) { return length(q) - r1; }
    if (k > a * h) { return length(q - vec2f(0.0, h)) - r2; }
    return dot(q, vec2f(a, b)) - r1;
}

/// Ellipsoid with semi-axes r. A fast approximation: the zero set is exact and the field is a bound outside for
/// aspect ratios up to about 2:1. Inside, and for more stretched ellipsoids, the gradient exceeds 1 (measured: 2.5
/// at 4:1). March with stepScale 0.7-0.8 there, or build long shapes from sdCapsule / sdRoundCone instead.
/// @approx
/// @use heads, bodies, eggs, pebbles, leaves (flat), muscles, clouds of blobs
fn sdEllipsoid(p: vec3f, r: vec3f) -> f32 {
    let k0 = length(p / r);
    let k1 = length(p / (r * r));
    if (k1 < 1e-8) { return -min(r.x, min(r.y, r.z)); }
    return k0 * (k0 - 1.0) / k1;
}

/// Hollow spherical cap (bowl) of radius r, cut by the plane y = h, with shell thickness t. The opening faces +Y.
/// @exact
/// @use bowls, cups, helmets, shells, satellite dishes, eye sockets
fn sdCutHollowSphere(p: vec3f, r: f32, h: f32, t: f32) -> f32 {
    let w = sqrt(r * r - h * h);
    let q = vec2f(length(p.xz), p.y);
    return select(abs(length(q) - r), length(q - vec2f(w, h)), h * q.x < w * q.y) - t;
}

/// Hexagonal prism along Z. h.x = inradius of the hexagon, h.y = half-length.
/// @exact
/// @use pencils, bolts, crystals, basalt columns, honeycomb cells
fn sdHexPrism(p: vec3f, h: vec2f) -> f32 {
    const k = vec3f(-0.8660254, 0.5, 0.57735027);
    var p_ = abs(p);
    p_ = vec3f(p_.xy - 2.0 * min(dot(k.xy, p_.xy), 0.0) * k.xy, p_.z);
    let d = vec2f(length(p_.xy - vec2f(clamp(p_.x, -k.z * h.x, k.z * h.x), h.x)) * sign(p_.y - h.x),
                  p_.z - h.y);
    return min(max(d.x, d.y), 0.0) + length(max(d, vec2f(0.0)));
}

/// Regular octahedron with "radius" s (vertex distance from center). Bound version.
/// @bound
/// @use gems, crystals, diamonds, abstract motifs
fn sdOctahedron(p: vec3f, s: f32) -> f32 {
    let p_ = abs(p);
    return (p_.x + p_.y + p_.z - s) * 0.57735027;
}

/// Gyroid sheet with cell scale \`scale\` and half-thickness t. The infinite triply-periodic surface
/// sin x cos y + sin y cos z + sin z cos x = 0. Intersect with a bounding shape.
/// @bound
/// @use lattices, coral, bone interiors, sponges, sci-fi infill, organic architecture
fn sdGyroid(p: vec3f, scale: f32, t: f32) -> f32 {
    let p_ = p * scale;
    let g = dot(sin(p_), cos(p_.yzx));
    return (abs(g) / scale - t) * 0.57735027;
}

/// Sphere of radius r cut by the plane y = h, keeping the cap ABOVE the plane. h = 0 gives a dome on the ground;
/// negative h keeps more than half. Needs |h| < r.
/// @exact
/// @use domes, mushroom caps, half-buried rocks, igloos, bread loaves
fn sdCutSphere(p: vec3f, r: f32, h: f32) -> f32 {
    let w = sqrt(max(r * r - h * h, 0.0));
    let q = vec2f(length(p.xz), p.y);
    let s = max((h - r) * q.x * q.x + w * w * (h + r - 2.0 * q.y), h * q.x - w * q.y);
    if (s < 0.0) { return length(q) - r; }
    if (q.x < w) { return h - q.y; }
    return length(q - vec2f(w, h));
}

/// Sphere ra at the origin with sphere rb at (d, 0, 0) carved out, exact including the crease rim.
/// A plain opSubtract of two spheres is only a bound.
/// @exact
/// @use eye sockets, craters, bitten fruit, nostrils, scooped shapes
fn sdDeathStar(p: vec3f, ra: f32, rb: f32, d: f32) -> f32 {
    let a = (ra * ra - rb * rb + d * d) / (2.0 * d);
    let b = sqrt(max(ra * ra - a * a, 0.0));
    let q = vec2f(p.x, length(p.yz));
    if (q.x * b - q.y * a > d * max(b - q.y, 0.0)) { return length(q - vec2f(a, b)); }
    return max(length(q) - ra, -(length(q - vec2f(d, 0.0)) - rb));
}

/// Unsigned distance to a 3D quadratic Bezier curve A-B-C; subtract a radius for a tube.
/// Solves the closest-point cubic analytically. Falls back to a segment when the curve is straight.
/// @exact
/// @use hair strands, tentacles, stems, whiskers, horns, cables, curved tubes
fn sdQuadraticBezier_f3f3f3f3(pos: vec3f, A: vec3f, B: vec3f, C: vec3f) -> f32 {
    let a = B - A;
    let b = A - 2.0 * B + C;
    let c = a * 2.0;
    let d = A - pos;
    let bb = dot(b, b);
    if (bb < 1e-10) {
        let pa = pos - A;
        let ca = C - A;
        return length(pa - ca * clamp(dot(pa, ca) / dot(ca, ca), 0.0, 1.0));
    }
    let kk = 1.0 / bb;
    let kx = kk * dot(a, b);
    let ky = kk * (2.0 * dot(a, a) + dot(d, b)) / 3.0;
    let kz = kk * dot(d, a);
    let pp = ky - kx * kx;
    let q = kx * (2.0 * kx * kx - 3.0 * ky) + kz;
    var h = q * q + 4.0 * pp * pp * pp;
    var res: f32;
    if (h >= 0.0) {
        h = sqrt(h);
        let x = (vec2f(h, -h) - q) / 2.0;
        let uv = sign(x) * pow(abs(x), vec2f(1.0f / 3.0f));
        let t = clamp(uv.x + uv.y - kx, 0.0, 1.0);
        res = dot2_f3(d + (c + b * t) * t);
    } else {
        let z = sqrt(-pp);
        let v = acos(clamp(q / (pp * z * 2.0), -1.0, 1.0)) / 3.0;
        let m = cos(v);
        let n = sin(v) * 1.7320508;
        let t = clamp(vec2f(m + m, -n - m) * z - kx, vec2f(0.0), vec2f(1.0));
        res = min(dot2_f3(d + (c + b * t.x) * t.x), dot2_f3(d + (c + b * t.y) * t.y));
    }
    return sqrt(res);
}
`
