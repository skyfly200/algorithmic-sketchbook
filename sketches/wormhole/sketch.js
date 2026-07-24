// Wormhole — the classic warp-tunnel: thin longitudinal lines converge to a
// glowing vanishing point, forming the ribs of a tube that twists and warps as
// it recedes, while streaks of light blast down each line past the camera — the
// feeling of tearing forward far faster than the light streaming by you. The
// throat spirals, the core flares, and the whole run lurches on the beat.
import { createRuntime } from '../_lib/runtime.js'

const rt = createRuntime()
const canvas = document.getElementById('canvas')
const CAPTURE = new URLSearchParams(location.search).get('capture') === '1'
const gl = canvas.getContext('webgl2', { preserveDrawingBuffer: CAPTURE })

const params = rt.params({
  speed: { value: 1.4, min: 0, max: 5, step: 0.05, label: 'Flight speed' },
  twist: { value: 0.8, min: 0, max: 4, step: 0.05, label: 'Throat twist' },
  lines: { value: 90, min: 20, max: 260, step: 1, label: 'Tunnel lines' },
  streak: { value: 0.7, min: 0.1, max: 0.98, step: 0.02, label: 'Streak length' },
  ripple: { value: 0.5, min: 0, max: 2, step: 0.05, label: 'Wall warp' },
  hue: { value: Math.round(rt.random(180, 300)), min: 0, max: 360, step: 1, label: 'Hue' },
  hueShift: { value: 0.4, min: 0, max: 2, step: 0.02, label: 'Hue drift' },
  glow: { value: 1.2, min: 0.2, max: 3, step: 0.05, label: 'Core glow' },
  warp: { value: 0.3, min: 0, max: 1, step: 0.02, label: 'Mouse warp' },
})
rt.mapInput('audio.pulse', 'speed', 1.5)
rt.mapInput('audio.low', 'glow', 0.6)

const VERT = `#version 300 es
in vec2 position; void main() { gl_Position = vec4(position, 0.0, 1.0); }`
const FRAG = `#version 300 es
precision highp float;
uniform vec2 u_res; uniform float u_time, u_seed, u_pulse;
uniform vec2 u_mouse;
uniform float u_speed, u_twist, u_lines, u_streak, u_ripple, u_hue, u_hueShift, u_glow, u_warp;
out vec4 o;
float hash(vec2 p){ p=fract(p*vec2(123.34,456.21)+u_seed); p+=dot(p,p+45.32); return fract(p.x*p.y); }
vec3 hsl(float h,float s,float l){ vec3 r=clamp(abs(mod(h*6.+vec3(0,4,2),6.)-3.)-1.,0.,1.); float c=(1.-abs(2.*l-1.))*s; return l+c*(r-.5); }
void main(){
  vec2 uv=(gl_FragCoord.xy-.5*u_res)/min(u_res.x,u_res.y);
  uv += u_mouse*u_warp*0.4;
  float r=length(uv)+1e-4;
  float a=atan(uv.y,uv.x);
  float spd = u_speed*(1.0+u_pulse*0.6);
  // perspective down the tube: depth ~ 1/r, scrolling toward the camera. the
  // throat twists (twist/r) so the lines spiral into the vanishing point.
  float depth = 1.0/r + u_time*spd*0.7;
  float ang = a + u_twist/r + u_time*0.15;
  float u = fract(ang/6.2831853 + 1.0);
  float v = depth;
  // angular lanes -> thin longitudinal lines that all converge at the core,
  // wobbling as they recede so the tube visibly warps as you fly through it
  float lane = u*u_lines;
  float laneId = floor(lane);
  float wob = sin(v*2.0 + laneId*0.7 + u_time*1.3)*u_ripple*0.35;
  float laneF = fract(lane) - 0.5 + wob;
  float line = pow(smoothstep(0.5, 0.0, abs(laneF)), 6.0);
  // streaking light racing down each line, faster than you can track: a dash
  // per lane scrolling in depth at a randomised speed, only some segments lit
  float ln = hash(vec2(laneId, 3.1));
  float flow = v*0.7 - u_time*spd*(2.5 + ln*3.5);
  float seg = fract(flow);
  float dash = smoothstep(0.0, 0.08, seg) * (1.0 - smoothstep(u_streak, 1.0, seg));
  float lit = step(0.4, hash(vec2(laneId, floor(flow))));
  float streak = line * dash * lit * (0.5 + ln*0.7);
  // colour: near-black tube, faint ribs, hot near-white streaks
  float hue = fract(u_hue/360.0 + v*0.015*u_hueShift + u*0.15);
  vec3 col = hsl(hue, 0.7, 0.05);
  col += hsl(hue, 0.55, 0.5) * line * 0.22;
  col += mix(hsl(fract(hue+0.05), 0.65, 0.7), vec3(1.0), 0.45) * streak * 1.9;
  // glowing core at the vanishing point where every line meets
  float core = smoothstep(0.42, 0.0, r);
  col += mix(hsl(fract(u_hue/360.0+0.04), 0.5, 0.85), vec3(1.0), 0.3) * core*core*u_glow*(1.0+u_pulse);
  // vignette / depth fade so the tube mouth frames the rush
  col *= smoothstep(1.25, 0.15, r);
  o=vec4(col,1.0);
}`
function sh(t, s){ const x=gl.createShader(t); gl.shaderSource(x,s); gl.compileShader(x); if(!gl.getShaderParameter(x,gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(x)); return x }
const prog=gl.createProgram(); gl.attachShader(prog,sh(gl.VERTEX_SHADER,VERT)); gl.attachShader(prog,sh(gl.FRAGMENT_SHADER,FRAG)); gl.linkProgram(prog); gl.useProgram(prog)
const buf=gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER,buf); gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,3,-1,-1,3]),gl.STATIC_DRAW)
const loc=gl.getAttribLocation(prog,'position'); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc,2,gl.FLOAT,false,0,0)
const U={}; for(const n of ['u_res','u_time','u_seed','u_pulse','u_mouse','u_speed','u_twist','u_lines','u_streak','u_ripple','u_hue','u_hueShift','u_glow','u_warp']) U[n]=gl.getUniformLocation(prog,n)
const seed=rt.random(0,100)
let mx=0,my=0,tx=0,ty=0
window.addEventListener('pointermove',(e)=>{ tx=(e.clientX/window.innerWidth)*2-1; ty=-((e.clientY/window.innerHeight)*2-1) })
function resize(){ canvas.width=window.innerWidth*rt.pixelRatio; canvas.height=window.innerHeight*rt.pixelRatio; gl.viewport(0,0,canvas.width,canvas.height) }
function frame(now){
  rt.tick(now); mx+=(tx-mx)*0.05; my+=(ty-my)*0.05
  gl.uniform2f(U.u_res,canvas.width,canvas.height); gl.uniform1f(U.u_time,now*0.001); gl.uniform1f(U.u_seed,seed)
  gl.uniform1f(U.u_pulse,rt.beat.state.pulse); gl.uniform2f(U.u_mouse,mx,my)
  gl.uniform1f(U.u_speed,params.speed); gl.uniform1f(U.u_twist,params.twist); gl.uniform1f(U.u_ripple,params.ripple)
  gl.uniform1f(U.u_lines,params.lines); gl.uniform1f(U.u_streak,params.streak); gl.uniform1f(U.u_hue,params.hue); gl.uniform1f(U.u_hueShift,params.hueShift)
  gl.uniform1f(U.u_glow,params.glow); gl.uniform1f(U.u_warp,params.warp)
  gl.drawArrays(gl.TRIANGLES,0,3); requestAnimationFrame(frame)
}
window.addEventListener('resize',resize); resize(); requestAnimationFrame(frame)
