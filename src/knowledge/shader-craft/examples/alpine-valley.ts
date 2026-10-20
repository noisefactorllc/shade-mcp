// Scene and material formulas adapted from the pinned shader-skills template.
// Full upstream provenance and MIT terms are attached by getShaderCraftExample.
export default {
  glsl: `const vec3 ALPINE_SUN=vec3(-0.7992474537, 0.5164368163, -0.3074028668);
const float SNOW_ALTITUDE=1.9;
const float FAR_DISTANCE=70.0;
const int ALPINE_TRACE_STEPS=320;
float alpineHeight(vec2 p) {
    float valley=1.0-exp(-0.085*p.x*p.x);
    float peaks=0.65+1.8*erodedFbm(p*vec2(0.30,0.25)+vec2(2.0,7.0),6)
                +0.35*ridgedFbm(p*0.2,4);
    float broad=0.5+0.5*fbm(p*0.12,4);
    float detail=0.06*fbm(p*1.8,3);
    return 0.18+(1.3+3.1*peaks+1.0*broad)*valley+detail;
}
vec2 map(vec3 p) {return vec2((p.y-alpineHeight(p.xz))*0.12,1.0);}
vec3 traceAlpine(vec3 ro,vec3 rd) {
    float t=0.02,previous=0.0;
    for(int i=0;i<ALPINE_TRACE_STEPS;i++) {
        vec3 p=ro+rd*t;
        float gap=p.y-alpineHeight(p.xz);
        if(gap<0.0) {
            float lo=previous,hi=t;
            for(int j=0;j<10;j++) {
                float mid=0.5*(lo+hi);
                vec3 q=ro+rd*mid;
                if(q.y>alpineHeight(q.xz))lo=mid;else hi=mid;
            }
            return vec3(0.5*(lo+hi),1.0,float(i));
        }
        previous=t;
        t+=0.04+0.015*t;
        if(t>FAR_DISTANCE)break;
    }
    return vec3(-1.0,0.0,float(ALPINE_TRACE_STEPS));
}
vec3 alpineSky(vec3 rd) {
    vec3 c=simpleSky(rd,ALPINE_SUN);
    float cloud=smoothstep(0.1,0.5,fbm(rd.xz/max(rd.y+0.45,0.15)*1.2,4));
    return mix(c,vec3(0.86,0.88,0.91),cloud*0.45*smoothstep(0.05,0.4,rd.y));
}
vec3 alpineRender(vec2 coord) {
    vec2 uv=(2.0*coord-resolution)/resolution.y;
    vec3 ro=vec3(0.15,2.1,10.0-0.25*sin(TAU*fract(time)));
    ro.y=max(ro.y,alpineHeight(ro.xz)+0.7);
    vec3 rd=cameraRay(cameraMatrix(ro,vec3(0.0,1.9,-15.0),0.0),uv,1.8);
    vec3 sky=alpineSky(rd);
    vec3 hit=traceAlpine(ro,rd);
    if(hit.x<0.0)return sky;
    vec3 p=ro+rd*hit.x;
    float footprint=hit.x*2.0/(resolution.y*1.8);
    vec3 n=calcNormal(p,max(0.002,footprint*0.5));
    float snow=smoothstep(SNOW_ALTITUDE-0.3,SNOW_ALTITUDE+0.4,p.y+0.22*fbm(p.xz*2.0,3))
              *smoothstep(0.35,0.75,n.y);
    float grass=smoothstep(0.6,0.9,n.y)*(1.0-smoothstep(1.4,2.5,p.y));
    float detailKeep=1.0-smoothstep(0.02,0.2,footprint);
    float grain=0.5+0.5*fbm(p.xz*18.0,3)*detailKeep;
    float strata=0.5+0.5*sin(p.y*35.0+fbm(p.xz*3.0,3)*2.0);
    vec3 rock=mix(vec3(0.16,0.15,0.14),vec3(0.32,0.29,0.25),grain)*(0.85+0.15*strata*detailKeep);
    vec3 albedo=mix(rock,mix(vec3(0.075,0.12,0.035),vec3(0.16,0.20,0.065),grain),grass);
    albedo=mix(albedo,vec3(0.78,0.84,0.9),snow);
    float shadow=softShadow(p+n*0.03,ALPINE_SUN,0.03,15.0,12.0);
    vec3 col=shadePBR(n,-rd,ALPINE_SUN,albedo,0.8,0.0)*vec3(3.4,3.0,2.5)*shadow;
    col+=albedo*hemisphereLight(n,vec3(0.4,0.58,0.85),vec3(0.16,0.13,0.095));
    vec3 haze=alpineSky(normalize(vec3(rd.x,0.04,rd.z)));
    float fog=heightFog(ro,rd,hit.x,0.011,0.18);
    return mix(col,haze,fog);
}
void main() {
    vec2 sampleCoord = gl_FragCoord.xy;
    vec3 col=alpineRender(sampleCoord);
    col=linearToSrgb(tonemapAgX(col*1.15))+ditherTPDF(sampleCoord,int(seed));
    fragColor=vec4(col,1.0);
}
`,
  wgsl: `const ALPINE_SUN: vec3f = vec3f((-0.7992474537), 0.5164368163, (-0.3074028668));

const SNOW_ALTITUDE: f32 = 1.9;

const FAR_DISTANCE: f32 = 70.0;

const ALPINE_TRACE_STEPS: i32 = 320;

fn alpineHeight(p_arg: vec2f) -> f32 {
    var p = p_arg;
    var valley: f32 = (1.0 - exp((((-0.085) * p.x) * p.x)));
    var peaks: f32 = ((0.65 + (1.8 * erodedFbm(((p * vec2f(0.30, 0.25)) + vec2f(2.0, 7.0)), 6))) + (0.35 * ridgedFbm((p * 0.2), 4)));
    var broad: f32 = (0.5 + (0.5 * fbm_f2i((p * 0.12), 4)));
    var detail: f32 = (0.06 * fbm_f2i((p * 1.8), 3));
    return ((0.18 + ((((1.3 + (3.1 * peaks)) + (1.0 * broad))) * valley)) + detail);
}

fn map(p_arg: vec3f) -> vec2f {
    var p = p_arg;
    return vec2f((((p.y - alpineHeight(p.xz))) * 0.12), 1.0);
}

fn traceAlpine(ro_arg: vec3f, rd_arg: vec3f) -> vec3f {
    var ro = ro_arg;
    var rd = rd_arg;
    var t: f32 = 0.02;
    var previous: f32 = 0.0;
    for (var i: i32 = 0; (i < ALPINE_TRACE_STEPS); i++) {
        var p: vec3f = (ro + (rd * t));
        var gap: f32 = (p.y - alpineHeight(p.xz));
        if ((gap < 0.0)) {
            var lo: f32 = previous;
            var hi: f32 = t;
            for (var j: i32 = 0; (j < 10); j++) {
                var mid: f32 = (0.5 * ((lo + hi)));
                var q: vec3f = (ro + (rd * mid));
                if ((q.y > alpineHeight(q.xz))) {
                    lo = mid;
                } else {
                    hi = mid;
                }
            }
            return vec3f((0.5 * ((lo + hi))), 1.0, f32(i));
        }
        previous = t;
        t += (0.04 + (0.015 * t));
        if ((t > FAR_DISTANCE)) {
            break;
        }
    }
    return vec3f((-1.0), 0.0, f32(ALPINE_TRACE_STEPS));
}

fn alpineSky(rd_arg: vec3f) -> vec3f {
    var rd = rd_arg;
    var c: vec3f = simpleSky(rd, ALPINE_SUN);
    var cloud: f32 = smoothstep(0.1, 0.5, fbm_f2i(((rd.xz / vec2f(max((rd.y + 0.45), 0.15))) * 1.2), 4));
    return mix(c, vec3f(0.86, 0.88, 0.91), ((cloud * 0.45) * smoothstep(0.05, 0.4, rd.y)));
}

fn alpineRender(coord_arg: vec2f) -> vec3f {
    var coord = coord_arg;
    var uv: vec2f = ((((2.0 * coord) - resolution)) / vec2f(resolution.y));
    var ro: vec3f = vec3f(0.15, 2.1, (10.0 - (0.25 * sin((TAU * time)))));
    ro.y = max(ro.y, (alpineHeight(ro.xz) + 0.7));
    var rd: vec3f = cameraRay(cameraMatrix(ro, vec3f(0.0, 1.9, (-15.0)), 0.0), uv, 1.8);
    var sky: vec3f = alpineSky(rd);
    var hit: vec3f = traceAlpine(ro, rd);
    if ((hit.x < 0.0)) {
        return sky;
    }
    var p: vec3f = (ro + (rd * hit.x));
    var footprint: f32 = ((hit.x * 2.0) / ((resolution.y * 1.8)));
    var n: vec3f = calcNormal(p, max(0.002, (footprint * 0.5)));
    var snow: f32 = (smoothstep((SNOW_ALTITUDE - 0.3), (SNOW_ALTITUDE + 0.4), (p.y + (0.22 * fbm_f2i((p.xz * 2.0), 3)))) * smoothstep(0.35, 0.75, n.y));
    var grass: f32 = (smoothstep(0.6, 0.9, n.y) * ((1.0 - smoothstep(1.4, 2.5, p.y))));
    var detailKeep: f32 = (1.0 - smoothstep(0.02, 0.2, footprint));
    var grain: f32 = (0.5 + ((0.5 * fbm_f2i((p.xz * 18.0), 3)) * detailKeep));
    var strata: f32 = (0.5 + (0.5 * sin(((p.y * 35.0) + (fbm_f2i((p.xz * 3.0), 3) * 2.0)))));
    var rock: vec3f = (mix(vec3f(0.16, 0.15, 0.14), vec3f(0.32, 0.29, 0.25), grain) * ((0.85 + ((0.15 * strata) * detailKeep))));
    var albedo: vec3f = mix(rock, mix(vec3f(0.075, 0.12, 0.035), vec3f(0.16, 0.20, 0.065), grain), grass);
    albedo = mix(albedo, vec3f(0.78, 0.84, 0.9), snow);
    var shadow: f32 = softShadow((p + (n * 0.03)), ALPINE_SUN, 0.03, 15.0, 12.0);
    var col: vec3f = ((shadePBR(n, (-rd), ALPINE_SUN, albedo, 0.8, 0.0) * vec3f(3.4, 3.0, 2.5)) * shadow);
    col += (albedo * hemisphereLight(n, vec3f(0.4, 0.58, 0.85), vec3f(0.16, 0.13, 0.095)));
    var haze: vec3f = alpineSky(normalize(vec3f(rd.x, 0.04, rd.z)));
    var fog: f32 = heightFog(ro, rd, hit.x, 0.011, 0.18);
    return mix(col, haze, fog);
}

fn exampleMain() {

    var sampleCoord: vec2f = pixel;
    var col: vec3f = alpineRender(sampleCoord);
    col = (linearToSrgb(tonemapAgX((col * 1.15))) + ditherTPDF(sampleCoord, i32(seed)));
    fragColor = vec4f(col, 1.0);
}
`,
}
