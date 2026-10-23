export const GLSL_REFERENCE = `## GLSL Shader Format

### Required Structure

\`\`\`glsl
#version 300 es
precision highp float;
precision highp int;

uniform float time;           // 0→1 looping! Use sin(time * TAU)
uniform vec2 resolution;

uniform float myParam;        // Your custom uniforms

out vec4 fragColor;

#define PI 3.14159265359
#define TAU 6.28318530718
#define aspectRatio (resolution.x / resolution.y)

void main() {
    vec2 uv = gl_FragCoord.xy / resolution;
    float t = time * TAU;     // Convert to radians
    vec3 color = vec3(uv, 0.5 + 0.5 * sin(t));
    fragColor = vec4(color, 1.0);
}
\`\`\`

##  WILL IT LOOP - SEAMLESS ANIMATION RULES

**This section has the highest priority for animation. You must understand all its rules.**

### Core Definition

Treat \`time\` as **1-periodic** on **[0, 1]**: \`t=1\` must be IDENTICAL to \`t=0\`.
All time-driven values must be continuous across the boundary with NO visible "pop" at the seam.

The approved method comes from Étienne Jacob / Bleuje:
1. Use a periodic function with an offset or delay.
2. Use the same looping time basis for everything.
3. Vary each element through an offset.

Reference: [bleuje.com/tutorial2](https://bleuje.com/tutorial2/) and [bleuje.com/tutorial3](https://bleuje.com/tutorial3/)

### THE DERIVATIVE RULE (Why Loops Fail)

**Matching value(0) == value(1) is NOT ENOUGH!**
The **velocity/derivative** must ALSO match, or you get a "hard reset" at t≈0.999.

**Use sin(), cos(), or periodicValue() as the time basis for generated animation.**
Use integer cycle counts when these functions receive raw time. Both values and derivatives must match at the loop endpoints.
Do not use raw nonperiodic time as the animation signal. Do not substitute ramps from fract(), mod(), smoothstep(), or custom easing.
Spatial uses of fract(), mod(), and smoothstep() are permitted. Compositions with periodic signals must preserve both endpoint values and derivatives.
Check the final animated result. A function name alone does not guarantee a loop.

### HARD REQUIREMENTS (Check ALL Before Shipping)

1. **SEAM EQUALITY + DERIVATIVE CONTINUITY**
   - For EVERY animated value: value(0) == value(1) AND value'(0) == value'(1)
   - sin/cos with integer cycles of raw time satisfy BOTH conditions. Check both conditions after composition.
   - If the value controls motion, the seam must not create a visible kink

2. **ROTATION = INTEGER TURNS**
   - Canonical form: \`angle(t) = angle0 + (offset * TAU) + (N * TAU * time)\`
   - N MUST be INTEGER (1, 2, 3). Non-integer N = incomplete turn = seam!
   -  \`angle = TAU * time\` (1 turn)  \`angle = 2.0 * TAU * time\` (2 turns)
   -  \`angle = 1.5 * TAU * time\` (BROKEN - 1.5 turns = incomplete!)

3. **TRANSLATION = CLOSED LOOP**
   - Must return to EXACT starting point at t=1
   - Circle: \`start + radius * vec2(cos(TAU * phase), sin(TAU * phase))\`
   - Oscillation: \`start + dir * (amplitude * sin(TAU * phase))\`
   - Pattern: \`pos = start + radius * vec2(cos(TAU*time), sin(TAU*time))\`

4. **NOISE = TIMECIRCLE PATTERN** (Bleuje Tutorial 3)
   - Map time to a circle.
   - Sample noise at that point:
   - \`vec2 tc = vec2(cos(TAU*time), sin(TAU*time)); noise(uv + tc*0.5);\`

### THE BLEUJE PATTERN - Periodic Function + Offset

The "Bleuje pattern" (from shader artist Étienne Jacob) is the approved method:
**periodicValue(time, offset)** = a periodic function evaluated at (time - offset)

\`\`\`glsl
// THE BLEUJE PATTERN - copy this exactly:
#define TAU 6.28318530717958647692

float normalizedSine(float x) {
    return 0.5 + 0.5 * sin(x);
}

float periodicValue(float time, float offset) {
    return normalizedSine((time - offset) * TAU);  // Returns 0→1→0 smoothly
}

// With offset, different objects animate at different phases:
float wave1 = periodicValue(time, 0.0);   // Starts at 0.5, rises
float wave2 = periodicValue(time, 0.25);  // Starts at 1.0, falls
float wave3 = periodicValue(time, 0.5);   // Starts at 0.5, falls
float wave4 = periodicValue(time, 0.75);  // Starts at 0.0, rises
\`\`\`

###  CORRECT Animation Examples

\`\`\`glsl
float t = time * TAU;
float wave = sin(t);                              // Smooth loop
float pulse = 0.5 + 0.5 * sin(t);                // Normalized 0→1→0
float oscillate = amplitude * sin(t);            // Oscillation
vec2 circular = radius * vec2(cos(t), sin(t));   // Circle motion

// Multiple speeds - ALL MUST BE INTEGERS!
float slow = sin(t);           // 1 cycle
float fast = sin(t * 2.0);     // 2 cycles
float faster = sin(t * 3.0);   // 3 cycles

// Integer rotation
float angle = TAU * time;        // 1 full turn
float angle = 2.0 * TAU * time;  // 2 full turns

// Looping noise - time on a circle:
vec2 tc = vec2(cos(t), sin(t));
float n = noise4D(vec4(uv * scale, tc));
\`\`\`

### Animation Primitives (use these for all animation)

\`\`\`glsl
float t = time * TAU;                    // Convert to radians first
float pulse = 0.5 + 0.5 * sin(t);       // Smooth 0→1→0
float wave = sin(t);                     // Smooth -1→1→-1
float angle = t * 2.0;                   // 2 full rotations
vec2 circular = vec2(cos(t), sin(t));   // Circular motion
vec2 timeCircle = vec2(cos(t), sin(t)); // For noise animation
float n = noise(uv * scale + timeCircle * 0.5);  // Animated noise
\`\`\`

### Looping Helpers (copy exactly)

\`\`\`glsl
// Rotation: N MUST be integer
float loopedAngle(float time, float offsetTurns, int N, float angle0) {
    return angle0 + TAU * (offsetTurns + float(N) * time);
}

// Translation on circle: cyclesN MUST be integer
vec2 loopedCircle(vec2 start, float time, float radius, float offsetTurns, int cyclesN) {
    float phase = offsetTurns + float(cyclesN) * time;
    return start + radius * vec2(cos(TAU * phase), sin(TAU * phase));
}

// Linear-looking oscillation: cyclesN MUST be integer
vec2 loopedOscillate(vec2 start, vec2 dir, float time, float amp, float offsetTurns, int cyclesN) {
    float phase = offsetTurns + float(cyclesN) * time;
    return start + dir * (amp * sin(TAU * phase));
}

// Looping noise via time-circle (4D noise required for spatial variation)
float loopedNoise(vec2 p, float time, float scale, float offset, float speed) {
    float phase = (time * speed) + offset;
    vec2 tc = vec2(cos(TAU * phase), sin(TAU * phase));
    return noise4D(vec4(p * scale, tc));  // or simplex4D
}

// Looped scalar (brightness, scale, alpha, etc.)
float loopedScalar(float base, float time, float offset, float amp, int cyclesN) {
    float phase = offset + float(cyclesN) * time;
    return base + amp * sin(TAU * phase);
}
\`\`\`

### Animation Checklist

**Check that your shader uses these patterns:**

- [ ] Animation uses sin(time * TAU) or cos(time * TAU)
- [ ] Cycle multipliers are integers (1, 2, 3...)
- [ ] Rotation completes full turns: angle = N * TAU * time
- [ ] Noise uses timeCircle: vec2(cos(t), sin(t)) in coordinates

### Stable Hash (for seeded loops)
\`\`\`glsl
uint hash_u32(uint x) {
    x ^= x >> 16u;
    x *= 0x7FEB352Du;
    x ^= x >> 15u;
    x *= 0x846CA68Bu;
    x ^= x >> 16u;
    return x;
}

float hash01(uint x) {
    return float(hash_u32(x) & 0x00FFFFFFu) / float(0x01000000u);
}
\`\`\`

### Filter Shader (with input)

\`\`\`glsl
uniform sampler2D inputTex;

void main() {
    ivec2 texSize = textureSize(inputTex, 0);
    vec2 uv = gl_FragCoord.xy / vec2(texSize);
    vec4 color = texture(inputTex, uv);
    fragColor = color;
}
\`\`\`

### Hash/Random
\`\`\`glsl
float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}
\`\`\`

### Value Noise
\`\`\`glsl
float noise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    float a = hash(i), b = hash(i + vec2(1,0));
    float c = hash(i + vec2(0,1)), d = hash(i + vec2(1,1));
    return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}
\`\`\`

### FBM
\`\`\`glsl
float fbm(vec2 p, int octaves) {
    float v = 0.0, a = 0.5;
    for (int i = 0; i < octaves; i++) {
        v += a * noise(p); p *= 2.0; a *= 0.5;
    }
    return v;
}
\`\`\`

### Color Palette
\`\`\`glsl
vec3 palette(float t, vec3 a, vec3 b, vec3 c, vec3 d) {
    return a + b * cos(TAU * (c * t + d));
}
\`\`\`

### HSV to RGB
\`\`\`glsl
vec3 hsv2rgb(vec3 c) {
    vec4 K = vec4(1.0, 2.0/3.0, 1.0/3.0, 3.0);
    vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
    return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
}
\`\`\`

### Distance Field Shapes

\`\`\`glsl
float sdCircle(vec2 p, float r) { return length(p) - r; }
float sdBox(vec2 p, vec2 b) { vec2 d = abs(p) - b; return length(max(d, 0.0)) + min(max(d.x, d.y), 0.0); }
\`\`\`

### Rotation
\`\`\`glsl
vec2 rotate2D(vec2 st, float a) {
    st -= 0.5;
    st = mat2(cos(a), -sin(a), sin(a), cos(a)) * st;
    return st + 0.5;
}
\`\`\`

### Wrap Modes
\`\`\`glsl
if(wrap==0) uv = abs(mod(uv+1.,2.)-1.);  // mirror
else if(wrap==1) uv = fract(uv);          // repeat
else uv = clamp(uv, 0., 1.);              // clamp
\`\`\`

### PCG Random (high quality)
\`\`\`glsl
uvec3 pcg(uvec3 v) {
    v = v*1664525u+1013904223u;
    v.x+=v.y*v.z; v.y+=v.z*v.x; v.z+=v.x*v.y;
    v^=v>>16u;
    v.x+=v.y*v.z; v.y+=v.z*v.x; v.z+=v.x*v.y;
    return v;
}
\`\`\`

### Luminance
\`\`\`glsl
float lum(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
\`\`\``

export const GLSL_RECIPES = `## GLSL Recipes

### Animated Plasma
\`\`\`glsl
float t = time * TAU * floor(speed); // whole cycles per loop keep the seam closed
float v = sin(uv.x * scale + t) + sin(uv.y * scale + t);
v += sin((uv.x + uv.y) * scale + t) + sin(length(uv - 0.5) * scale * 2.0 + t);
vec3 col = 0.5 + 0.5 * cos(TAU * (v * 0.25 + vec3(0.0, 0.33, 0.67)));
\`\`\`

### Raymarched Sphere
\`\`\`glsl
float sdSphere(vec3 p, float r) { return length(p) - r; }
vec3 calcNormal(vec3 p) {
    vec2 e = vec2(0.001, 0.0);
    return normalize(vec3(
        sdSphere(p+e.xyy,1.0)-sdSphere(p-e.xyy,1.0),
        sdSphere(p+e.yxy,1.0)-sdSphere(p-e.yxy,1.0),
        sdSphere(p+e.yyx,1.0)-sdSphere(p-e.yyx,1.0)
    ));
}
\`\`\`

### Kaleidoscope
\`\`\`glsl
vec2 c = (gl_FragCoord.xy - resolution * 0.5) / min(resolution.x, resolution.y);
float a = atan(c.y, c.x);
float r = length(c);
float seg = TAU / float(segments);
a = mod(a, seg);
if (mod(floor(atan(c.y, c.x) / seg), 2.0) > 0.5) a = seg - a;
vec2 transformed = vec2(cos(a), sin(a)) * r;
\`\`\`

### Voronoi
\`\`\`glsl
vec2 cell = floor(uv * cellCount);
float minDist = 10.0;
for (int y = -1; y <= 1; y++) {
    for (int x = -1; x <= 1; x++) {
        vec2 n = cell + vec2(x, y);
        vec2 pt = n + hash(n) * jitter;
        minDist = min(minDist, distance(uv * cellCount, pt));
    }
}
\`\`\`

### Domain Warping
\`\`\`glsl
vec2 warp = uv + 0.1 * vec2(
    noise(uv * 4.0 + seed),
    noise(uv * 4.0 + seed + 100.0)
);
float n = noise(warp * 8.0);
\`\`\`

### 3D Perspective Grid (Synthwave/Vaporwave Flyover)
Classic 80s aesthetic with perspective grid floor and gradient sky.
\`\`\`glsl
// Horizon line splits screen
float horizon = 0.4;
float t = time * TAU;

// Sky gradient (top portion)
if (uv.y > horizon) {
    float skyT = (uv.y - horizon) / (1.0 - horizon);
    vec3 skyBot = vec3(0.8, 0.2, 0.6);  // Hot pink
    vec3 skyTop = vec3(0.1, 0.0, 0.2);  // Deep purple
    color = mix(skyBot, skyTop, skyT);
} else {
    // Perspective grid (bottom portion)
    float z = horizon / (horizon - uv.y);  // Perspective depth
    float x = (uv.x - 0.5) * z;            // Perspective X
    z += t * speed;                        // Animation

    // Grid lines
    float gridX = abs(fract(x * gridScale) - 0.5);
    float gridZ = abs(fract(z * gridScale) - 0.5);
    float grid = min(gridX, gridZ);
    grid = smoothstep(0.02, 0.05, grid);

    // Grid color with depth fade
    vec3 gridColor = vec3(0.0, 1.0, 1.0);  // Cyan
    float fade = 1.0 / (1.0 + z * 0.1);    // Fade with depth
    color = mix(gridColor, vec3(0.0), grid) * fade;
}
\`\`\`

### Sun/Circle with Glow
\`\`\`glsl
vec2 center = vec2(0.5, horizon);
float dist = length(uv - center);
float sun = smoothstep(sunRadius + 0.02, sunRadius, dist);
float glow = exp(-dist * 3.0) * 0.5;
vec3 sunColor = vec3(1.0, 0.3, 0.5);
color += sunColor * (sun + glow);
\`\`\`

### Scanlines Effect
\`\`\`glsl
float scanline = sin(uv.y * resolution.y * 0.5) * 0.5 + 0.5;
color *= 0.8 + 0.2 * scanline;
\`\`\`

## PROVEN LOOPING IMPLEMENTATIONS FROM NOISEMAKER

These are **real, working implementations** from the Noisemaker effect library.
**Study these patterns. They show exactly how to create loops without visible seams.**

### EXAMPLE 1: synth/noise - Periodic Function with Time Blend

**Technique:** Use a periodic function to blend noise values over time.
The noise lattice does not animate. \`periodicFunction(time)\` modulates the blend parameter to create smooth cyclic variation.

\`\`\`glsl
// From synth/noise - the periodicFunction approach
float periodicFunction(float p) {
    // Maps p (0..1) to a cosine wave (0..1), creating smooth looping
    return (cos(p * TAU) + 1.0) * 0.5;  // 0→1→0 as p goes 0→1
}

// In main():
float t = time + spatialOffset(st);  // time plus spatial variation
float blend = periodicFunction(t) * amplitude;  // Smoothly loops!

// Use blend as parameter in noise evaluation
vec3 color = multires(st, freq, octaves, seed, blend);
\`\`\`

The noise function is stationary. Only the \`blend\` parameter oscillates through \`periodicFunction(time)\`. The noise coordinates stay fixed.

### EXAMPLE 2: synth/perlin - Two Approaches for Different Dimensions

**2D Mode: Rotating Gradient Angles**
The gradient vectors at each lattice point rotate with time. This rotation keeps the noise structure coherent and creates smooth animation.

\`\`\`glsl
// From synth/perlin (2D mode) - gradients rotate with time
float grid2D(vec2 st, vec2 cell, float timeAngle, float channelOffset) {
    // Base gradient angle from hash
    float angle = prng(vec3(cell + float(seed), 1.0)).r * TAU;

    // KEY: Add time as rotation - completes INTEGER turns over time 0→1
    angle += timeAngle + channelOffset * TAU;  // timeAngle = time * TAU

    vec2 gradient = vec2(cos(angle), sin(angle));
    vec2 dist = st - cell;
    return dot(gradient, dist);
}

// Usage: timeAngle = time * TAU
float n = noise2D(st, time * TAU, 0.0);  // Loops perfectly
\`\`\`

**3D Mode: Periodic Z-Axis**
Sample a 3D noise volume where the Z-axis wraps at a defined period.
Time maps linearly to Z, which wraps seamlessly.

\`\`\`glsl
// From synth/perlin (3D mode) - periodic z-axis
const float Z_PERIOD = 4.0;  // Period length in z-axis lattice units

float wrapZ(float z) {
    return mod(z, Z_PERIOD);  // Z coordinates wrap for seamless tiling
}

float noise3D(vec3 p) {
    vec3 i = floor(p);
    vec3 f = fract(p);

    // Wrap z indices for periodicity
    float iz0 = wrapZ(i.z);
    float iz1 = wrapZ(i.z + 1.0);

    // Sample corners with wrapped z
    float n000 = dot(grad3(vec3(i.xy, iz0) + vec3(0,0,0)), f - vec3(0,0,0));
    // ... etc for all 8 corners
}

// Usage: time 0→1 maps to z 0→Z_PERIOD, which wraps seamlessly
float z = time * Z_PERIOD;  // or time / TAU * Z_PERIOD
float n = noise3D(vec3(uv * scale, z));
\`\`\`

The noise volume is periodic in the Z dimension.
When time reaches 1.0, z wraps to 0.0 identically.

### EXAMPLE 3: filter/tunnel - Integer Speed for Perfect Loops

**Technique:** When speed is an INTEGER, the tunnel advances by exactly N cells. It ends at its starting position. Non-integer speed creates seams.

\`\`\`glsl
// From filter/tunnel - integer speed requirement
void main() {
    vec2 centered = uv - 0.5;
    float a = atan(centered.y, centered.x);
    float r = length(centered);

    // Tunnel coordinates
    vec2 tunnelCoords = smod(vec2(
        0.3 / r + time * speed,           // speed MUST BE INTEGER for loop!
        a / PI + time * -tunnelRotation   // tunnelRotation MUST BE INTEGER!
    ), 1.0);

    fragColor = texture(inputTex, tunnelCoords);
}
\`\`\`

**Why it works:**
- If \`speed = 1\`, the tunnel advances by exactly 1.0 in UV space
- \`smod(x, 1.0)\` wraps, so position at t=1 equals position at t=0
- If \`speed = 1.5\`, it advances by 1.5 - the remainder creates a visible seam!

**The rule:** Any uniform that multiplies time in a modular space MUST be INTEGER.

### EXAMPLE 4: synth/osc2d - The Bleuje periodicValue Pattern

**Technique:** Two-stage periodic evaluation from Étienne Jacob's tutorials.
This creates complex-looking motion that loops perfectly.

\`\`\`glsl
// From synth/osc2d - the periodicValue pattern
float periodicValue(float t, float v) {
    // Bleuje pattern: periodic function evaluated at (time - offset)
    return (sin((t - v) * TAU) + 1.0) * 0.5;  // Returns 0→1→0 smoothly
}

// Two-stage periodic for complex motion:
// 1. Sample noise to get per-pixel offset values
float timeNoise = tilingNoise1D(spatialPos, freq, float(seed) + 12345.0);
float valueNoise = tilingNoise1D(spatialPos, freq, float(seed));

// 2. First periodic: time with timeNoise offset, scaled by speed
float scaledTime = periodicValue(time, timeNoise) * speed;

// 3. Second periodic: scaledTime with valueNoise offset
float val = periodicValue(scaledTime, valueNoise);
\`\`\`

**Why it works:**
- \`periodicValue(time, offset)\` is periodic in \`time\` for any fixed \`offset\`
- Nesting two periodic functions is still periodic
- Each pixel has different offsets, so motion appears complex but loops perfectly

##  SUMMARY: Three Proven Looping Strategies

| Strategy | When to Use | Example |
|----------|-------------|---------|
| **periodicFunction(time) as blend** | Animating noise smoothly | synth/noise |
| **Rotating gradients with time*TAU** | 2D periodic noise | synth/perlin 2D |
| **Periodic Z-axis with mod wrapping** | 3D periodic noise | synth/perlin 3D |
| **Integer multiplier for modular coords** | Tunnels, scrolling grids | filter/tunnel |
| **periodicValue(time, offset)** | Complex motion with offsets | synth/osc2d, Bleuje tutorials |

**Use one of these proven looping patterns.**`;
