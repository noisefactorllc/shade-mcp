// Scene and material formulas adapted from the pinned shader-skills template.
// Full upstream provenance and MIT terms are attached by getShaderCraftExample.
export default {
  glsl: `const int WATER_AA=1;
const int WATER_WAVES=8;
const int WATER_STEPS=180;
const vec3 COAST_SUN=vec3(-0.3890330019, 0.6891441748, -0.6113375744);
const vec3 EXTINCTION=vec3(0.42,0.085,0.045);
const float WATER_IOR=1.333;
const float WATER_FAR=95.0;
float coastBed(vec2 p) {
    vec2 a=p-vec2(-7.0,-8.0),b=p-vec2(7.0,-19.0),c=p-vec2(-5.0,-1.0);
    float islands=5.7*exp(-0.055*dot(a,a))+5.0*exp(-0.07*dot(b,b))+1.1*exp(-0.15*dot(c,c));
    return -2.4+islands*(1.0+0.18*gradientNoise(p*0.75))+0.12*sin(p.x*1.7)*sin(p.y*1.2);
}
vec3 coastBedNormal(vec2 p,float eps) {
    vec2 d=vec2(coastBed(p+vec2(eps,0.0))-coastBed(p-vec2(eps,0.0)),
                coastBed(p+vec2(0.0,eps))-coastBed(p-vec2(0.0,eps)))/(2.0*eps);
    return normalize(vec3(-d.x,1.0,-d.y));
}
vec4 coastWaves(vec2 p,float footprint) {
    vec4 sum=vec4(0.0);
    for(int i=0;i<WATER_WAVES;i++) {
        float fi=float(i);
        float angle=0.7+fi*2.39996;
        float wavelength=4.5*pow(0.69,fi);
        float amp=0.075*pow(0.58,fi);
        sum+=waterWaveD(p+vec2(fi*1.37,fi*0.79)-vec2(cos(angle),sin(angle))*wavelength*max(1.0,floor(waterDispersion(TAU/wavelength,3.0,9.81)*8.0/TAU+0.5))*fract(time),0.0,vec2(cos(angle),sin(angle)),wavelength,amp,3.0,footprint);
    }
    return sum;
}
vec2 traceCoast(vec3 ro,vec3 rd,bool includeWater,int maxSteps) {
    float t=0.01,previous=0.0;
    float closing=max(0.05,abs(rd.y)+4.0*length(rd.xz));
    for(int i=0;i<WATER_STEPS;i++) {
        if(i>=maxSteps)break;
        vec3 p=ro+rd*t;
        float h=coastBed(p.xz);
        if(includeWater) {
            float geometryFootprint=2.0*t/(resolution.y*1.75*max(abs(rd.y),0.1));
            h=max(h,coastWaves(p.xz,geometryFootprint).x);
        }
        float gap=p.y-h;
        if(gap<0.0) {
            float lo=previous,hi=t;
            for(int j=0;j<10;j++) {
                float mid=0.5*(lo+hi);
                vec3 q=ro+rd*mid;
                float surface=coastBed(q.xz);
                if(includeWater) {
                    float fp=2.0*mid/(resolution.y*1.75*max(abs(rd.y),0.1));
                    surface=max(surface,coastWaves(q.xz,fp).x);
                }
                if(q.y>surface)lo=mid;else hi=mid;
            }
            return vec2(0.5*(lo+hi),float(i));
        }
        previous=t;
        t+=max(gap/closing,0.012+0.008*t);
        if(t>WATER_FAR)break;
    }
    if(includeWater && rd.y < -0.0001) return vec2(max(0.01,-ro.y/rd.y),float(maxSteps));
    return vec2(-1.0,float(maxSteps));
}
vec3 coastSky(vec3 rd) {
    vec3 c=mix(vec3(0.22,0.40,0.60),vec3(0.025,0.13,0.36),sqrt(max(rd.y,0.0)));
    float clouds=smoothstep(0.1,0.55,fbm(rd.xz/max(rd.y+0.4,0.15)*1.3,4));
    c=mix(c,vec3(0.95,0.97,1.0),clouds*0.18*smoothstep(0.03,0.3,rd.y));
    return c+vec3(9.0,8.0,6.0)*sunDisk(rd,COAST_SUN,0.012,0.002);
}
vec3 shadeCoastBed(vec3 p,vec3 n,bool submerged,float footprint) {
    float grain=0.5+0.5*fbm(p.xz*2.5,4)*(1.0-smoothstep(0.03,0.25,footprint));
    float rock=smoothstep(0.45,1.0,p.y)*(1.0-smoothstep(0.65,0.9,n.y));
    vec3 sand=mix(vec3(0.38,0.29,0.15),vec3(0.7,0.59,0.37),grain);
    vec3 albedo=mix(sand,vec3(0.17,0.15,0.12),rock);
    float vegetation=smoothstep(1.2,2.0,p.y)*smoothstep(0.5,0.82,n.y);
    albedo=mix(albedo,vec3(0.07,0.12,0.025),vegetation);
    vec3 direct=vec3(2.5,2.3,1.9)*max(dot(n,COAST_SUN),0.0);
    if(submerged) {
        direct*=beerTransmittance(EXTINCTION,max(-p.y,0.0)/COAST_SUN.y);
        float caustic=pow(max(0.0,sin(p.x*7.0+sin(p.z*4.0+TAU*fract(time))*1.3)*sin(p.z*6.0+cos(p.x*4.0-TAU*fract(time))*1.2)),9.0);
        float keep=1.0-smoothstep(0.02,0.12,footprint);
        direct*=1.0+caustic*keep*1.2;
    }
    return albedo*(direct+hemisphereLight(n,vec3(0.35,0.43,0.5),vec3(0.12,0.10,0.07)));
}
vec3 renderCoast(vec2 coord) {
    vec2 uv=(2.0*coord-resolution)/resolution.y;
    vec3 ro=vec3(0.0,3.5,7.5);
    vec3 rd=cameraRay(cameraMatrix(ro,vec3(-0.8,-0.1,-6.0),0.0),uv,1.75);
    vec3 sky=coastSky(rd);
    vec2 hit=traceCoast(ro,rd,true,WATER_STEPS);
    if(hit.x<0.0)return sky;
    vec3 p=ro+rd*hit.x;
    float footprint=2.0*hit.x/(resolution.y*1.75);
    float bed=coastBed(p.xz);
    vec3 col;
    if(bed>p.y-0.015) {
        vec3 n=coastBedNormal(p.xz,max(footprint,0.003));
        col=shadeCoastBed(p,n,false,footprint);
    } else {
        vec4 waves=coastWaves(p.xz,footprint/max(abs(rd.y),0.1));
        vec3 n=normalize(vec3(-waves.y,1.0,-waves.z));
        vec3 v=-rd;
        float F=fresnelDielectric(max(dot(n,v),0.0),1.0,WATER_IOR);
        vec3 refracted=refract(rd,n,1.0/WATER_IOR);
        vec2 bottomHit=traceCoast(p-n*0.006,refracted,false,WATER_STEPS);
        float path=bottomHit.x>0.0?bottomHit.x:30.0;
        vec3 bottomPoint=p-n*0.006+refracted*path;
        vec3 bottomColor=shadeCoastBed(bottomPoint,coastBedNormal(bottomPoint.xz,0.01),true,footprint);
        vec3 T=beerTransmittance(EXTINCTION,path);
        vec3 body=bottomColor*T+vec3(0.012,0.19,0.24)*(1.0-T);
        vec3 reflected=reflect(rd,n);
        vec3 reflection=coastSky(normalize(vec3(reflected.x,max(reflected.y,0.01),reflected.z)));
        vec2 reflectedHit=traceCoast(p+n*0.015,reflected,false,WATER_STEPS);
        if(reflectedHit.x>0.0) {
            vec3 rp=p+n*0.015+reflected*reflectedHit.x;
            if(rp.y>0.02)reflection=shadeCoastBed(rp,coastBedNormal(rp.xz,0.015),false,footprint);
        }
        float unresolved=smoothstep(0.02,0.18,footprint);
        float rough=mix(0.075,0.20,unresolved);
        vec3 glint=specularGGX(n,v,COAST_SUN,rough,vec3(0.02037))*vec3(3.5,3.2,2.7);
        float shallow=1.0-smoothstep(0.08,0.5,max(p.y-bed,0.0));
        float shorePulse=0.5+0.5*sin((p.y-bed)*19.0-TAU*fract(time)*2.0+fbm(p.xz*2.0,3)*3.0);
        float foam=shallow*smoothstep(0.25,0.7,shorePulse)*0.8;
        foam+=0.12*smoothstep(0.18,0.6,-waves.w)*(1.0-unresolved);
        foam=clamp(foam,0.0,1.0);
        col=mix(body*(1.0-F)+reflection*F+glint,vec3(0.8,0.84,0.82),foam);
    }
    return mix(col,coastSky(normalize(vec3(rd.x,0.025,rd.z))),1.0-exp(-hit.x*0.003));
}
void main() {
    vec2 sampleCoord = gl_FragCoord.xy;
    vec3 col=vec3(0.0);
    for(int i=0;i<WATER_AA;i++) {
        vec3 c=renderCoast(sampleCoord);
        c=tonemapAgX(c*1.05);
        col+=c/float(WATER_AA);
    }
    col=linearToSrgb(col)+ditherTPDF(sampleCoord,int(seed));
    fragColor=vec4(col,1.0);
}
`,
  wgsl: `const WATER_AA: i32 = 1;

const WATER_WAVES: i32 = 8;

const WATER_STEPS: i32 = 180;

const COAST_SUN: vec3f = vec3f((-0.3890330019), 0.6891441748, (-0.6113375744));

const EXTINCTION: vec3f = vec3f(0.42, 0.085, 0.045);

const WATER_IOR: f32 = 1.333;

const WATER_FAR: f32 = 95.0;

fn coastBed(p_arg: vec2f) -> f32 {
    var p = p_arg;
    var a: vec2f = (p - vec2f((-7.0), (-8.0)));
    var b: vec2f = (p - vec2f(7.0, (-19.0)));
    var c: vec2f = (p - vec2f((-5.0), (-1.0)));
    var islands: f32 = (((5.7 * exp(((-0.055) * dot(a, a)))) + (5.0 * exp(((-0.07) * dot(b, b))))) + (1.1 * exp(((-0.15) * dot(c, c)))));
    return (((-2.4) + (islands * ((1.0 + (0.18 * gradientNoise_f2((p * 0.75))))))) + ((0.12 * sin((p.x * 1.7))) * sin((p.y * 1.2))));
}

fn coastBedNormal(p_arg: vec2f, eps_arg: f32) -> vec3f {
    var p = p_arg;
    var eps = eps_arg;
    var d: vec2f = (vec2f((coastBed((p + vec2f(eps, 0.0))) - coastBed((p - vec2f(eps, 0.0)))), (coastBed((p + vec2f(0.0, eps))) - coastBed((p - vec2f(0.0, eps))))) / vec2f(((2.0 * eps))));
    return normalize(vec3f((-d.x), 1.0, (-d.y)));
}

fn coastWaves(p_arg: vec2f, footprint_arg: f32) -> vec4f {
    var p = p_arg;
    var footprint = footprint_arg;
    var sum: vec4f = vec4f(0.0);
    for (var i: i32 = 0; (i < WATER_WAVES); i++) {
        var fi: f32 = f32(i);
        var angle: f32 = (0.7 + (fi * 2.39996));
        var wavelength: f32 = (4.5 * pow(0.69, fi));
        var amp: f32 = (0.075 * pow(0.58, fi));
        sum += waterWaveD(((p + vec2f((fi * 1.37), (fi * 0.79))) - (((vec2f(cos(angle), sin(angle)) * wavelength) * max(1.0, floor(waterDispersion(TAU / wavelength, 3.0, 9.81) * 8.0 / TAU + 0.5))) * time)), 0.0, vec2f(cos(angle), sin(angle)), wavelength, amp, 3.0, footprint);
    }
    return sum;
}

fn traceCoast(ro_arg: vec3f, rd_arg: vec3f, includeWater_arg: bool, maxSteps_arg: i32) -> vec2f {
    var ro = ro_arg;
    var rd = rd_arg;
    var includeWater = includeWater_arg;
    var maxSteps = maxSteps_arg;
    var t: f32 = 0.01;
    var previous: f32 = 0.0;
    var closing: f32 = max(0.05, (abs(rd.y) + (4.0 * length(rd.xz))));
    for (var i: i32 = 0; (i < WATER_STEPS); i++) {
        if ((i >= maxSteps)) {
            break;
        }
        var p: vec3f = (ro + (rd * t));
        var h: f32 = coastBed(p.xz);
        if (includeWater) {
            var geometryFootprint: f32 = ((2.0 * t) / (((resolution.y * 1.75) * max(abs(rd.y), 0.1))));
            h = max(h, coastWaves(p.xz, geometryFootprint).x);
        }
        var gap: f32 = (p.y - h);
        if ((gap < 0.0)) {
            var lo: f32 = previous;
            var hi: f32 = t;
            for (var j: i32 = 0; (j < 10); j++) {
                var mid: f32 = (0.5 * ((lo + hi)));
                var q: vec3f = (ro + (rd * mid));
                var surface: f32 = coastBed(q.xz);
                if (includeWater) {
                    var fp: f32 = ((2.0 * mid) / (((resolution.y * 1.75) * max(abs(rd.y), 0.1))));
                    surface = max(surface, coastWaves(q.xz, fp).x);
                }
                if ((q.y > surface)) {
                    lo = mid;
                } else {
                    hi = mid;
                }
            }
            return vec2f((0.5 * ((lo + hi))), f32(i));
        }
        previous = t;
        t += max((gap / closing), (0.012 + (0.008 * t)));
        if ((t > WATER_FAR)) {
            break;
        }
    }
    if ((includeWater && (rd.y < (-0.0001)))) {
        return vec2f(max(0.01, ((-ro.y) / rd.y)), f32(maxSteps));
    }
    return vec2f((-1.0), f32(maxSteps));
}

fn coastSky(rd_arg: vec3f) -> vec3f {
    var rd = rd_arg;
    var c: vec3f = mix(vec3f(0.22, 0.40, 0.60), vec3f(0.025, 0.13, 0.36), sqrt(max(rd.y, 0.0)));
    var clouds: f32 = smoothstep(0.1, 0.55, fbm_f2i(((rd.xz / vec2f(max((rd.y + 0.4), 0.15))) * 1.3), 4));
    c = mix(c, vec3f(0.95, 0.97, 1.0), ((clouds * 0.18) * smoothstep(0.03, 0.3, rd.y)));
    return (c + (vec3f(9.0, 8.0, 6.0) * sunDisk(rd, COAST_SUN, 0.012, 0.002)));
}

fn shadeCoastBed(p_arg: vec3f, n_arg: vec3f, submerged_arg: bool, footprint_arg: f32) -> vec3f {
    var p = p_arg;
    var n = n_arg;
    var submerged = submerged_arg;
    var footprint = footprint_arg;
    var grain: f32 = (0.5 + ((0.5 * fbm_f2i((p.xz * 2.5), 4)) * ((1.0 - smoothstep(0.03, 0.25, footprint)))));
    var rock: f32 = (smoothstep(0.45, 1.0, p.y) * ((1.0 - smoothstep(0.65, 0.9, n.y))));
    var sand: vec3f = mix(vec3f(0.38, 0.29, 0.15), vec3f(0.7, 0.59, 0.37), grain);
    var albedo: vec3f = mix(sand, vec3f(0.17, 0.15, 0.12), rock);
    var vegetation: f32 = (smoothstep(1.2, 2.0, p.y) * smoothstep(0.5, 0.82, n.y));
    albedo = mix(albedo, vec3f(0.07, 0.12, 0.025), vegetation);
    var direct: vec3f = (vec3f(2.5, 2.3, 1.9) * max(dot(n, COAST_SUN), 0.0));
    if (submerged) {
        direct *= beerTransmittance(EXTINCTION, (max((-p.y), 0.0) / COAST_SUN.y));
        var caustic: f32 = pow(max(0.0, (sin(((p.x * 7.0) + (sin(((p.z * 4.0) + (TAU * time))) * 1.3))) * sin(((p.z * 6.0) + (cos(((p.x * 4.0) - (TAU * time))) * 1.2))))), 9.0);
        var keep: f32 = (1.0 - smoothstep(0.02, 0.12, footprint));
        direct *= (1.0 + ((caustic * keep) * 1.2));
    }
    return (albedo * ((direct + hemisphereLight(n, vec3f(0.35, 0.43, 0.5), vec3f(0.12, 0.10, 0.07)))));
}

fn renderCoast(coord_arg: vec2f) -> vec3f {
    var coord = coord_arg;
    var uv: vec2f = ((((2.0 * coord) - resolution)) / vec2f(resolution.y));
    var ro: vec3f = vec3f(0.0, 3.5, 7.5);
    var rd: vec3f = cameraRay(cameraMatrix(ro, vec3f((-0.8), (-0.1), (-6.0)), 0.0), uv, 1.75);
    var sky: vec3f = coastSky(rd);
    var hit: vec2f = traceCoast(ro, rd, true, WATER_STEPS);
    if ((hit.x < 0.0)) {
        return sky;
    }
    var p: vec3f = (ro + (rd * hit.x));
    var footprint: f32 = ((2.0 * hit.x) / ((resolution.y * 1.75)));
    var bed: f32 = coastBed(p.xz);
    var col: vec3f;
    if ((bed > (p.y - 0.015))) {
        var n: vec3f = coastBedNormal(p.xz, max(footprint, 0.003));
        col = shadeCoastBed(p, n, false, footprint);
    } else {
        var waves: vec4f = coastWaves(p.xz, (footprint / max(abs(rd.y), 0.1)));
        var n: vec3f = normalize(vec3f((-waves.y), 1.0, (-waves.z)));
        var v: vec3f = (-rd);
        var F: f32 = fresnelDielectric(max(dot(n, v), 0.0), 1.0, WATER_IOR);
        var refracted: vec3f = refract(rd, n, (1.0 / WATER_IOR));
        var bottomHit: vec2f = traceCoast((p - (n * 0.006)), refracted, false, WATER_STEPS);
        var path: f32 = select(30.0, bottomHit.x, (bottomHit.x > 0.0));
        var bottomPoint: vec3f = ((p - (n * 0.006)) + (refracted * path));
        var bottomColor: vec3f = shadeCoastBed(bottomPoint, coastBedNormal(bottomPoint.xz, 0.01), true, footprint);
        var T: vec3f = beerTransmittance(EXTINCTION, path);
        var body: vec3f = ((bottomColor * T) + (vec3f(0.012, 0.19, 0.24) * ((vec3f(1.0) - T))));
        var reflected: vec3f = reflect(rd, n);
        var reflection: vec3f = coastSky(normalize(vec3f(reflected.x, max(reflected.y, 0.01), reflected.z)));
        var reflectedHit: vec2f = traceCoast((p + (n * 0.015)), reflected, false, WATER_STEPS);
        if ((reflectedHit.x > 0.0)) {
            var rp: vec3f = ((p + (n * 0.015)) + (reflected * reflectedHit.x));
            if ((rp.y > 0.02)) {
                reflection = shadeCoastBed(rp, coastBedNormal(rp.xz, 0.015), false, footprint);
            }
        }
        var unresolved: f32 = smoothstep(0.02, 0.18, footprint);
        var rough: f32 = mix(0.075, 0.20, unresolved);
        var glint: vec3f = (specularGGX(n, v, COAST_SUN, rough, vec3f(0.02037)) * vec3f(3.5, 3.2, 2.7));
        var shallow: f32 = (1.0 - smoothstep(0.08, 0.5, max((p.y - bed), 0.0)));
        var shorePulse: f32 = (0.5 + (0.5 * sin((((((p.y - bed)) * 19.0) - ((TAU * time) * 2.0)) + (fbm_f2i((p.xz * 2.0), 3) * 3.0)))));
        var foam: f32 = ((shallow * smoothstep(0.25, 0.7, shorePulse)) * 0.8);
        foam += ((0.12 * smoothstep(0.18, 0.6, (-waves.w))) * ((1.0 - unresolved)));
        foam = clamp(foam, 0.0, 1.0);
        col = mix((((body * ((1.0 - F))) + (reflection * F)) + glint), vec3f(0.8, 0.84, 0.82), foam);
    }
    return mix(col, coastSky(normalize(vec3f(rd.x, 0.025, rd.z))), (1.0 - exp(((-hit.x) * 0.003))));
}

fn exampleMain() {

    var sampleCoord: vec2f = pixel;
    var col: vec3f = vec3f(0.0);
    for (var i: i32 = 0; (i < WATER_AA); i++) {
        var c: vec3f = renderCoast(sampleCoord);
        c = tonemapAgX((c * 1.05));
        col += (c / vec3f(f32(WATER_AA)));
    }
    col = (linearToSrgb(col) + ditherTPDF(sampleCoord, i32(seed)));
    fragColor = vec4f(col, 1.0);
}
`,
}
