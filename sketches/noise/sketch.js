// Noise Field — an animated procedural noise generator. Value-noise fractal
// (fBm), ridged, turbulence or plain white noise, scrolling through a third
// dimension of time so it churns. Colour it mono, RGB (three offset noises), or
// through a warm/cool/spectral palette. A source, not a filter.
import { createRuntime } from '../_lib/runtime.js'

const rt = createRuntime()
const canvas = document.getElementById('canvas')
const gl = canvas.getContext('webgl2', { preserveDrawingBuffer: new URLSearchParams(location.search).get('capture') === '1' })

const TYPES = ['fBm', 'Ridged', 'Turbulence', 'Value', 'White']
const PALS = ['Mono', 'RGB', 'Warm', 'Cool', 'Spectral']
const params = rt.params({
  type: { value: 'fBm', type: 'select', options: TYPES, label: 'Noise' },
  palette: { value: 'Mono', type: 'select', options: PALS, label: 'Colour' },
  scale: { value: 3, min: 0.5, max: 12, step: 0.1, label: 'Scale' },
  octaves: { value: 5, min: 1, max: 8, step: 1, label: 'Octaves' },
  speed: { value: 0.5, min: 0, max: 3, step: 0.05, label: 'Speed' },
  warp: { value: 0.3, min: 0, max: 1.5, step: 0.05, label: 'Domain warp' },
  contrast: { value: 1, min: 0.3, max: 3, step: 0.05, label: 'Contrast' },
  hue: { value: 200, min: 0, max: 360, step: 1, label: 'Hue' },
})
rt.mapInput('audio.level', 'contrast', 0.5)

const VERT = `#version 300 es
in vec2 position; void main(){ gl_Position = vec4(position,0.,1.); }`
const FRAG = `#version 300 es
precision highp float;
uniform vec2 u_res; uniform float u_time, u_scale, u_warp, u_contrast, u_hue;
uniform int u_type, u_oct, u_pal;
out vec4 o;
float hash(vec3 p){ p=fract(p*0.3183099+0.1); p*=17.0; return fract(p.x*p.y*p.z*(p.x+p.y+p.z)); }
float vnoise(vec3 x){ vec3 i=floor(x), f=fract(x); f=f*f*(3.0-2.0*f);
  return mix(mix(mix(hash(i+vec3(0,0,0)),hash(i+vec3(1,0,0)),f.x),mix(hash(i+vec3(0,1,0)),hash(i+vec3(1,1,0)),f.x),f.y),
             mix(mix(hash(i+vec3(0,0,1)),hash(i+vec3(1,0,1)),f.x),mix(hash(i+vec3(0,1,1)),hash(i+vec3(1,1,1)),f.x),f.y),f.z); }
float fbm(vec3 p){ float a=0.5,s=0.0,n=0.0; for(int i=0;i<8;i++){ if(i>=u_oct)break; float v=vnoise(p);
  if(u_type==1) v=1.0-abs(v*2.0-1.0);          // ridged
  else if(u_type==2) v=abs(v*2.0-1.0);          // turbulence
  s+=a*v; n+=a; p*=2.02; a*=0.5; } return s/n; }
vec3 palette(float t){
  t=clamp(t,0.0,1.0);
  if(u_pal==2) return mix(vec3(0.1,0.02,0.0), vec3(1.0,0.85,0.5), t);          // warm
  if(u_pal==3) return mix(vec3(0.0,0.03,0.12), vec3(0.6,0.9,1.0), t);          // cool
  return 0.5+0.5*cos(6.2831*(t+vec3(0.0,0.33,0.67)));                          // spectral
}
void main(){
  vec2 uv=(gl_FragCoord.xy - 0.5*u_res)/u_res.y;
  vec3 p=vec3(uv*u_scale, u_time*0.15);
  if(u_warp>0.001){ vec3 q=vec3(fbm(p+1.7), fbm(p+8.3), 0.0); p.xy += q.xy*u_warp; }
  float base = (u_type==4)? hash(floor(vec3(gl_FragCoord.xy, u_time*30.0))) : fbm(p);
  base = clamp((base-0.5)*u_contrast+0.5, 0.0, 1.0);
  vec3 col;
  if(u_pal==1){ col=vec3(fbm(p), fbm(p+3.1), fbm(p+6.2)); col=clamp((col-0.5)*u_contrast+0.5,0.0,1.0); }
  else if(u_pal==0){ float h=u_hue/360.0; vec3 tint=0.5+0.5*cos(6.2831*(h+vec3(0.0,0.06,0.12))); col=mix(tint*0.12, tint, base); }
  else col=palette(base);
  o=vec4(col,1.0);
}`
function sh(t,s){const x=gl.createShader(t);gl.shaderSource(x,s);gl.compileShader(x);if(!gl.getShaderParameter(x,gl.COMPILE_STATUS))throw new Error(gl.getShaderInfoLog(x));return x}
const prog=gl.createProgram();gl.attachShader(prog,sh(gl.VERTEX_SHADER,VERT));gl.attachShader(prog,sh(gl.FRAGMENT_SHADER,FRAG));gl.linkProgram(prog);gl.useProgram(prog)
const buf=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,buf);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,3,-1,-1,3]),gl.STATIC_DRAW)
const pos=gl.getAttribLocation(prog,'position');gl.enableVertexAttribArray(pos);gl.vertexAttribPointer(pos,2,gl.FLOAT,false,0,0)
const U=(n)=>gl.getUniformLocation(prog,n)
const u={res:U('u_res'),time:U('u_time'),scale:U('u_scale'),warp:U('u_warp'),contrast:U('u_contrast'),hue:U('u_hue'),type:U('u_type'),oct:U('u_oct'),pal:U('u_pal')}
function resize(){canvas.width=window.innerWidth*rt.pixelRatio;canvas.height=window.innerHeight*rt.pixelRatio;gl.viewport(0,0,canvas.width,canvas.height)}
let t=0,last=0
function frame(now){
  rt.tick(now); const dt=last?Math.min(0.05,(now-last)/1000):0.016; last=now; t+=params.speed*dt
  gl.uniform2f(u.res,canvas.width,canvas.height); gl.uniform1f(u.time,t)
  gl.uniform1f(u.scale,params.scale); gl.uniform1f(u.warp,params.warp); gl.uniform1f(u.contrast,params.contrast); gl.uniform1f(u.hue,params.hue)
  gl.uniform1i(u.type,Math.max(0,TYPES.indexOf(params.type))); gl.uniform1i(u.oct,Math.round(params.octaves)); gl.uniform1i(u.pal,Math.max(0,PALS.indexOf(params.palette)))
  gl.drawArrays(gl.TRIANGLES,0,3); requestAnimationFrame(frame)
}
window.addEventListener('resize',resize); resize(); requestAnimationFrame(frame)
