// Grass Field — a dense meadow rendered with SHELL TEXTURING, the fast trick
// Acerola (Garrett Gunnell) breaks down: instead of drawing every blade, the
// ground is sampled as a stack of "shells" and a fragment is kept only while
// the shell's height stays under a per-tuft height mask — so each shell that
// survives is a thinner slice up the blade, and the stack tapers into grass.
// It's a per-pixel raymarch of that shell volume on a low, tilted ground plane,
// swaying under a travelling wind, lit warm at the tips. Pointer parts the grass.
import { createRuntime } from '../_lib/runtime.js'

const rt = createRuntime()
const canvas = document.getElementById('canvas')
const CAPTURE = new URLSearchParams(location.search).get('capture') === '1'
const gl = canvas.getContext('webgl2', { preserveDrawingBuffer: CAPTURE })

const params = rt.params({
  density: { value: 1, min: 0.3, max: 2, step: 0.05, label: 'Density' },
  wind: { value: 1, min: 0, max: 3, step: 0.05, label: 'Wind strength' },
  gust: { value: 0.6, min: 0, max: 1.5, step: 0.05, label: 'Gustiness' },
  height: { value: 1, min: 0.5, max: 1.8, step: 0.05, label: 'Blade height' },
  hue: { value: 95, min: 40, max: 140, step: 1, label: 'Grass hue' },
  dry: { value: 0.25, min: 0, max: 1, step: 0.02, label: 'Dryness' },
  flowers: { value: 0.4, min: 0, max: 1, step: 0.02, label: 'Wildflowers' },
  sun: { value: 0.35, min: 0.05, max: 0.85, step: 0.01, label: 'Sun height' },
})
rt.mapInput('audio.level', 'wind', 0.6)
rt.mapInput('audio.pulse', 'gust', 0.4)

const VERT = `#version 300 es
in vec2 position; void main(){ gl_Position=vec4(position,0.,1.); }`
const FRAG = `#version 300 es
precision highp float;
uniform vec2 u_res, u_mouse; uniform float u_time,u_seed;
uniform float u_density,u_wind,u_gust,u_height,u_hue,u_dry,u_flowers,u_sun;
out vec4 o;
#define SHELLS 24
const float HZ=0.14;                 // horizon height in uv
vec3 hsl(float h,float s,float l){ vec3 r=clamp(abs(mod(h*6.+vec3(0,4,2),6.)-3.)-1.,0.,1.); float c=(1.-abs(2.*l-1.))*s; return l+c*(r-.5); }
float hash(vec2 p){ p=fract(p*vec2(123.34,456.21)); p+=dot(p,p+45.32); return fract(p.x*p.y); }
vec2 hash2(vec2 p){ return vec2(hash(p+1.7),hash(p+9.3)); }
// screen point -> ground world xz (fake perspective), depth out
vec2 ground(vec2 uv, out float depth){ depth=HZ/(HZ-uv.y); return vec2(uv.x*depth*3.0, depth*3.0); }

void main(){
  vec2 uv=(gl_FragCoord.xy-.5*u_res)/u_res.y;
  vec3 sunDir=normalize(vec3(-0.4,u_sun,-1.0));
  // sky
  if(uv.y>HZ){
    float sy=uv.y-HZ;
    vec3 sky=mix(hsl(0.13,0.35,0.86), hsl(0.58,0.45,0.62), clamp(sy*2.2,0.,1.));
    vec2 sp=vec2(-0.35, HZ+u_sun*0.9);
    float d=length(uv-sp);
    sky+=hsl(0.12,0.6,0.9)*smoothstep(0.05,0.,d);
    sky+=hsl(0.13,0.5,0.7)*smoothstep(0.55,0.,d)*0.25;
    o=vec4(sky,1.); return;
  }
  float baseDepth=HZ/(HZ-uv.y);
  float density=9.0*u_density;
  float gH=0.13*u_height;             // grass screen height near the camera
  vec3 col=vec3(0.0); bool hit=false; float tipShade=0.0;
  // march shells from the tip down; first survivor is the nearest blade slice
  for(int k=SHELLS;k>=0;k--){
    float y=float(k)/float(SHELLS);   // 0 ground .. 1 tip
    float shift=y*gH/baseDepth;       // how high this shell sits above its base
    vec2 px=uv; px.y-=shift;
    if(px.y>=HZ) continue;            // base would be in the sky
    float d; vec2 wp=ground(px,d);
    // travelling wind wave + slow gust, stronger toward the tip
    float ph=wp.y*0.22 - u_time*(1.2+u_wind*1.3);
    float sway=(sin(ph)+0.45*sin(ph*1.9+wp.x*0.3))*u_wind;
    float gust=sin(u_time*0.9+wp.x*0.12)*u_gust;
    // pointer parts the grass (u_mouse sits off-screen until the pointer moves)
    vec2 mg=ground(u_mouse,d); float md=length(wp-mg);
    float part=exp(-md*0.9)*sign(wp.x-mg.x)*1.1;
    wp.x+=(sway+gust+part)*y*0.32;
    vec2 cf=wp*density, cell=floor(cf), f=fract(cf);
    float bh=0.4+0.6*hash(cell);      // this tuft's blade height
    if(y>bh) continue;                // above the tip of this tuft
    vec2 c=0.22+0.56*hash2(cell);     // blade footprint centre in the cell
    float rad=mix(0.46,0.03,y/bh);    // taper: wide base -> fine tip
    if(length(f-c)<rad){
      float tip=y/bh;                 // 0 base .. 1 tip along the blade
      float hj=hash(cell+7.7);
      float hue=(u_hue+(hj-0.5)*26.0)/360.0;
      hue=mix(hue, 0.12, u_dry*(0.3+0.6*tip)*hj); // dry blades go golden, tips first
      float sat=mix(0.55,0.42,u_dry);
      // vertical gradient (dark shaded base -> bright tip) + distance fade
      float lig=mix(0.10,0.46,tip*tip);
      lig*=clamp(1.15-d*0.05,0.45,1.15);
      col=hsl(hue,sat,lig);
      tipShade=tip;
      // occasional wildflower crowning a tuft
      if(tip>0.88 && hash(cell+31.4)<u_flowers*0.16){
        col=hsl(hash(cell+3.0), 0.8, 0.72);
      }
      hit=true; break;
    }
  }
  if(!hit){
    float d; vec2 wp=ground(uv,d);
    float n=hash(floor(wp*density*0.7));
    col=hsl(0.09,0.5,mix(0.06,0.14,n))*clamp(1.1-d*0.05,0.4,1.1); // shaded soil
  } else {
    // warm sun catch on the tips, on the wind-facing side
    col+=hsl(0.13,0.6,0.5)*pow(tipShade,3.0)*clamp(u_sun*1.4,0.0,1.0)*0.6;
  }
  // depth haze into the warm horizon
  vec3 haze=hsl(0.16,0.3,0.66);
  col=mix(col,haze,smoothstep(-0.02,HZ,uv.y)*0.85);
  o=vec4(col,1.);
}`
function sh(t,s){const x=gl.createShader(t);gl.shaderSource(x,s);gl.compileShader(x);if(!gl.getShaderParameter(x,gl.COMPILE_STATUS))throw new Error(gl.getShaderInfoLog(x));return x}
const prog=gl.createProgram();gl.attachShader(prog,sh(gl.VERTEX_SHADER,VERT));gl.attachShader(prog,sh(gl.FRAGMENT_SHADER,FRAG));gl.linkProgram(prog);gl.useProgram(prog)
const b=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,b);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,3,-1,-1,3]),gl.STATIC_DRAW)
const loc=gl.getAttribLocation(prog,'position');gl.enableVertexAttribArray(loc);gl.vertexAttribPointer(loc,2,gl.FLOAT,false,0,0)
const U={};for(const n of ['u_res','u_mouse','u_time','u_seed','u_density','u_wind','u_gust','u_height','u_hue','u_dry','u_flowers','u_sun'])U[n]=gl.getUniformLocation(prog,n)
const seed=rt.random(0,10)
let mx=99,my=99,tmx=99,tmy=99 // parked off-screen: no parting until the pointer moves
window.addEventListener('pointermove',(e)=>{ const px=e.clientX*rt.pixelRatio, py=(window.innerHeight-e.clientY)*rt.pixelRatio; tmx=(px-0.5*canvas.width)/canvas.height; tmy=(py-0.5*canvas.height)/canvas.height })
function resize(){canvas.width=window.innerWidth*rt.pixelRatio;canvas.height=window.innerHeight*rt.pixelRatio;gl.viewport(0,0,canvas.width,canvas.height)}
function frame(now){rt.tick(now); mx+=(tmx-mx)*0.12; my+=(tmy-my)*0.12
  gl.uniform2f(U.u_res,canvas.width,canvas.height);gl.uniform2f(U.u_mouse,mx,my)
  gl.uniform1f(U.u_time,now*0.001);gl.uniform1f(U.u_seed,seed)
  gl.uniform1f(U.u_density,params.density);gl.uniform1f(U.u_wind,params.wind);gl.uniform1f(U.u_gust,params.gust)
  gl.uniform1f(U.u_height,params.height);gl.uniform1f(U.u_hue,params.hue);gl.uniform1f(U.u_dry,params.dry)
  gl.uniform1f(U.u_flowers,params.flowers);gl.uniform1f(U.u_sun,params.sun)
  gl.drawArrays(gl.TRIANGLES,0,3);requestAnimationFrame(frame)}
window.addEventListener('resize',resize);resize();requestAnimationFrame(frame)
