// Ocean Surface — a stylised sea rendered per-pixel (in the spirit of
// Acerola's ocean breakdowns): summed directional Gerstner-ish waves give a
// height/normal field, shaded with a Fresnel sky reflection, deep/shallow
// water tint, sub-surface scatter in the wave backs, and glittering sun
// specular that dances on the crests. Drag to swing the sun/camera.
import { createRuntime } from '../_lib/runtime.js'

const rt = createRuntime()
const canvas = document.getElementById('canvas')
const CAPTURE = new URLSearchParams(location.search).get('capture') === '1'
const gl = canvas.getContext('webgl2', { preserveDrawingBuffer: CAPTURE })

const params = rt.params({
  choppiness: { value: 1, min: 0.2, max: 2.5, step: 0.05, label: 'Choppiness' },
  windSpeed: { value: 1, min: 0, max: 3, step: 0.05, label: 'Wind speed' },
  scale: { value: 1, min: 0.4, max: 2.5, step: 0.05, label: 'Wave scale' },
  sunHeight: { value: 0.25, min: 0.02, max: 0.8, step: 0.01, label: 'Sun height' },
  deep: { value: 210, min: 160, max: 260, step: 1, label: 'Water hue' },
  sss: { value: 0.6, min: 0, max: 1.5, step: 0.05, label: 'Sub-surface' },
  glitter: { value: 1, min: 0, max: 2, step: 0.05, label: 'Sun glitter' },
})
rt.mapInput('audio.level', 'choppiness', 0.4)
rt.mapInput('audio.low', 'windSpeed', 0.3)

const VERT = `#version 300 es
in vec2 position; void main(){ gl_Position=vec4(position,0.,1.); }`
const FRAG = `#version 300 es
precision highp float;
uniform vec2 u_res; uniform float u_time,u_seed;
uniform vec2 u_sun;
uniform float u_chop,u_wind,u_scale,u_sunH,u_deep,u_sss,u_glitter;
out vec4 o;
vec3 hsl(float h,float s,float l){ vec3 r=clamp(abs(mod(h*6.+vec3(0,4,2),6.)-3.)-1.,0.,1.); float c=(1.-abs(2.*l-1.))*s; return l+c*(r-.5); }
// sum of directional waves → height at world xz
float waves(vec2 p, out vec2 grad){
  float h=0.; grad=vec2(0.);
  float amp=1.0, freq=0.6*u_scale, sp=1.0;
  float ang=u_seed;
  for(int i=0;i<7;i++){
    vec2 dir=vec2(cos(ang),sin(ang));
    float ph=dot(dir,p)*freq + u_time*u_wind*sp;
    float w=exp(sin(ph)-1.0)*amp; // sharp-crest wave (Acerola-style)
    h+=w;
    float dw=w*cos(ph)*freq;
    grad+=dir*dw;
    amp*=0.82; freq*=1.18*u_chop; sp*=1.07; ang+=2.399;
  }
  return h;
}
void main(){
  vec2 uv=(gl_FragCoord.xy-.5*u_res)/u_res.y;
  vec3 sun=normalize(vec3(u_sun.x,u_sunH+0.05,-1.0));
  // horizon: everything above is sky
  float hy=0.16;
  if(uv.y>hy){
    float sy=(uv.y-hy);
    vec3 sky=mix(hsl(u_deep/360.,0.5,0.7),hsl((u_deep-30.)/360.,0.7,0.35),clamp(sy*2.5,0.,1.));
    // sun disk + halo
    vec2 sp=vec2(u_sun.x*0.6, hy+u_sunH);
    float d=length(uv-sp);
    sky+=hsl(0.11,0.9,0.8)*smoothstep(0.06,0.0,d);
    sky+=hsl(0.12,0.8,0.6)*smoothstep(0.5,0.0,d)*0.3;
    o=vec4(sky,1.); return;
  }
  // project the sea pixel to a world point (fake perspective by 1/depth)
  float depth=hy/(hy-uv.y);
  vec2 wp=vec2(uv.x*depth*3.0, depth*3.0);
  vec2 grad;
  float h=waves(wp,grad);
  vec3 n=normalize(vec3(-grad.x, 1.5/u_chop, -grad.y));
  vec3 view=normalize(vec3(uv.x,0.4,1.0));
  float fres=pow(1.0-max(0.0,dot(n,view)),4.0);
  // colours
  vec3 deepC=hsl(u_deep/360.,0.85,0.14);
  vec3 shallowC=hsl((u_deep-25.)/360.,0.7,0.4);
  vec3 skyRef=hsl(u_deep/360.,0.4,0.65);
  vec3 col=mix(deepC,shallowC,clamp(h*0.5,0.,1.));
  col=mix(col,skyRef,fres*0.8);
  // sub-surface scatter: light glows through the back of crests
  float back=max(0.0,dot(n,sun));
  col+=hsl((u_deep-45.)/360.,0.9,0.5)*pow(max(0.0,h-0.6),1.5)*u_sss*back;
  // sun specular glitter
  vec3 refl=reflect(-sun,n);
  float spec=pow(max(0.0,dot(refl,view)),80.0);
  col+=vec3(1.0,0.95,0.8)*spec*u_glitter*(0.5+fres);
  // depth fog to horizon
  col=mix(col,skyRef,smoothstep(0.0,0.16,uv.y)* (1.0-0.0));
  col*=smoothstep(-0.02,0.1,hy-uv.y+0.1);
  o=vec4(col,1.);
}`
function sh(t,s){const x=gl.createShader(t);gl.shaderSource(x,s);gl.compileShader(x);if(!gl.getShaderParameter(x,gl.COMPILE_STATUS))throw new Error(gl.getShaderInfoLog(x));return x}
const prog=gl.createProgram();gl.attachShader(prog,sh(gl.VERTEX_SHADER,VERT));gl.attachShader(prog,sh(gl.FRAGMENT_SHADER,FRAG));gl.linkProgram(prog);gl.useProgram(prog)
const b=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,b);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,3,-1,-1,3]),gl.STATIC_DRAW)
const loc=gl.getAttribLocation(prog,'position');gl.enableVertexAttribArray(loc);gl.vertexAttribPointer(loc,2,gl.FLOAT,false,0,0)
const U={};for(const n of ['u_res','u_time','u_seed','u_sun','u_chop','u_wind','u_scale','u_sunH','u_deep','u_sss','u_glitter'])U[n]=gl.getUniformLocation(prog,n)
const seed=rt.random(0,10)
let sunX=0.2,tSunX=0.2
window.addEventListener('pointermove',(e)=>{ if(e.buttons) tSunX=(e.clientX/window.innerWidth)*2-1 })
function resize(){canvas.width=window.innerWidth*rt.pixelRatio;canvas.height=window.innerHeight*rt.pixelRatio;gl.viewport(0,0,canvas.width,canvas.height)}
function frame(now){rt.tick(now); sunX+=(tSunX-sunX)*0.04
  gl.uniform2f(U.u_res,canvas.width,canvas.height);gl.uniform1f(U.u_time,now*0.001);gl.uniform1f(U.u_seed,seed)
  gl.uniform2f(U.u_sun,sunX,params.sunHeight)
  gl.uniform1f(U.u_chop,params.choppiness);gl.uniform1f(U.u_wind,params.windSpeed);gl.uniform1f(U.u_scale,params.scale)
  gl.uniform1f(U.u_sunH,params.sunHeight);gl.uniform1f(U.u_deep,params.deep);gl.uniform1f(U.u_sss,params.sss);gl.uniform1f(U.u_glitter,params.glitter)
  gl.drawArrays(gl.TRIANGLES,0,3);requestAnimationFrame(frame)}
window.addEventListener('resize',resize);resize();requestAnimationFrame(frame)
