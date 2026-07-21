// Wormhole — a headlong flight down a rippling tube of light. Screen pixels
// are mapped to tube coordinates (angle, depth) and a scrolling texture of
// bands and stars streaks past; the mouth glows, the throat twists, and the
// whole tunnel breathes and lurches on the beat.
import { createRuntime } from '../_lib/runtime.js'

const rt = createRuntime()
const canvas = document.getElementById('canvas')
const CAPTURE = new URLSearchParams(location.search).get('capture') === '1'
const gl = canvas.getContext('webgl2', { preserveDrawingBuffer: CAPTURE })

const params = rt.params({
  speed: { value: 1, min: 0, max: 4, step: 0.05, label: 'Flight speed' },
  twist: { value: 0.6, min: 0, max: 3, step: 0.05, label: 'Throat twist' },
  ripple: { value: 0.5, min: 0, max: 2, step: 0.05, label: 'Wall ripple' },
  bands: { value: 10, min: 2, max: 40, step: 1, label: 'Ring bands' },
  hue: { value: Math.round(rt.random(180, 300)), min: 0, max: 360, step: 1, label: 'Hue' },
  hueShift: { value: 0.4, min: 0, max: 2, step: 0.02, label: 'Hue drift' },
  glow: { value: 1, min: 0.2, max: 2.5, step: 0.05, label: 'Core glow' },
  warp: { value: 0.3, min: 0, max: 1, step: 0.02, label: 'Mouse warp' },
})
rt.mapInput('audio.pulse', 'speed', 1.2)
rt.mapInput('audio.low', 'glow', 0.5)

const VERT = `#version 300 es
in vec2 position; void main() { gl_Position = vec4(position, 0.0, 1.0); }`
const FRAG = `#version 300 es
precision highp float;
uniform vec2 u_res; uniform float u_time, u_seed, u_pulse;
uniform vec2 u_mouse;
uniform float u_speed, u_twist, u_ripple, u_bands, u_hue, u_hueShift, u_glow, u_warp;
out vec4 o;
float hash(vec2 p){ p=fract(p*vec2(123.34,456.21)+u_seed); p+=dot(p,p+45.32); return fract(p.x*p.y); }
vec3 hsl(float h,float s,float l){ vec3 r=clamp(abs(mod(h*6.+vec3(0,4,2),6.)-3.)-1.,0.,1.); float c=(1.-abs(2.*l-1.))*s; return l+c*(r-.5); }
void main(){
  vec2 uv=(gl_FragCoord.xy-.5*u_res)/min(u_res.x,u_res.y);
  uv += u_mouse*u_warp*0.4;
  float r=length(uv)+1e-4;
  float a=atan(uv.y,uv.x);
  // map to tube: depth grows as 1/r (perspective down the tunnel)
  float depth=1.0/r + u_time*u_speed*0.6;
  // throat twist increases toward the centre
  float tw=u_twist/r;
  float ang=a + tw + u_time*0.1;
  // ripple the walls
  float wall=sin(depth*3.0 + ang*4.0)*u_ripple*0.06;
  float u=ang/6.2831;
  float v=depth;
  // banded rings + starry speckle streaking past
  float band=sin((v+wall)*u_bands*0.5);
  float rings=smoothstep(0.0,0.6,band);
  float star=step(0.982, hash(floor(vec2(u*40.0, v*6.0))));
  float hue=fract(u_hue/360.0 + v*0.02*u_hueShift + u*0.3);
  vec3 col=hsl(hue,0.8,0.18+0.4*rings);
  col += hsl(fract(hue+0.1),0.9,0.7)*star*0.9;
  // core glow at the vanishing point
  float core=smoothstep(0.5,0.0,r);
  col += hsl(fract(u_hue/360.0+0.05),0.6,0.7)*core*core*u_glow*(1.0+u_pulse);
  // vignette + depth fade
  col *= smoothstep(1.15,0.2,r);
  o=vec4(col,1.0);
}`
function sh(t, s){ const x=gl.createShader(t); gl.shaderSource(x,s); gl.compileShader(x); if(!gl.getShaderParameter(x,gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(x)); return x }
const prog=gl.createProgram(); gl.attachShader(prog,sh(gl.VERTEX_SHADER,VERT)); gl.attachShader(prog,sh(gl.FRAGMENT_SHADER,FRAG)); gl.linkProgram(prog); gl.useProgram(prog)
const buf=gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER,buf); gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,3,-1,-1,3]),gl.STATIC_DRAW)
const loc=gl.getAttribLocation(prog,'position'); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc,2,gl.FLOAT,false,0,0)
const U={}; for(const n of ['u_res','u_time','u_seed','u_pulse','u_mouse','u_speed','u_twist','u_ripple','u_bands','u_hue','u_hueShift','u_glow','u_warp']) U[n]=gl.getUniformLocation(prog,n)
const seed=rt.random(0,100)
let mx=0,my=0,tx=0,ty=0
window.addEventListener('pointermove',(e)=>{ tx=(e.clientX/window.innerWidth)*2-1; ty=-((e.clientY/window.innerHeight)*2-1) })
function resize(){ canvas.width=window.innerWidth*rt.pixelRatio; canvas.height=window.innerHeight*rt.pixelRatio; gl.viewport(0,0,canvas.width,canvas.height) }
function frame(now){
  rt.tick(now); mx+=(tx-mx)*0.05; my+=(ty-my)*0.05
  gl.uniform2f(U.u_res,canvas.width,canvas.height); gl.uniform1f(U.u_time,now*0.001); gl.uniform1f(U.u_seed,seed)
  gl.uniform1f(U.u_pulse,rt.beat.state.pulse); gl.uniform2f(U.u_mouse,mx,my)
  gl.uniform1f(U.u_speed,params.speed); gl.uniform1f(U.u_twist,params.twist); gl.uniform1f(U.u_ripple,params.ripple)
  gl.uniform1f(U.u_bands,params.bands); gl.uniform1f(U.u_hue,params.hue); gl.uniform1f(U.u_hueShift,params.hueShift)
  gl.uniform1f(U.u_glow,params.glow); gl.uniform1f(U.u_warp,params.warp)
  gl.drawArrays(gl.TRIANGLES,0,3); requestAnimationFrame(frame)
}
window.addEventListener('resize',resize); resize(); requestAnimationFrame(frame)
