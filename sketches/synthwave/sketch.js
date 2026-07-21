// Synthwave — an endless retro-future drive: a neon wireframe grid rolling
// toward the horizon over rippled hills, a huge banded sun setting into a
// gradient sky with scanlines, and distant mountains. The grid scrolls, the
// sun pulses, and everything glows on the beat.
import { createRuntime } from '../_lib/runtime.js'

const rt = createRuntime()
const canvas = document.getElementById('canvas')
const CAPTURE = new URLSearchParams(location.search).get('capture') === '1'
const gl = canvas.getContext('webgl2', { preserveDrawingBuffer: CAPTURE })

const params = rt.params({
  speed: { value: 1, min: 0, max: 4, step: 0.05, label: 'Drive speed' },
  gridGlow: { value: 1, min: 0.2, max: 2.5, step: 0.05, label: 'Grid glow' },
  hills: { value: 0.5, min: 0, max: 1.5, step: 0.05, label: 'Hill height' },
  sun: { value: 0.9, min: 0.3, max: 1.5, step: 0.05, label: 'Sun size' },
  hueSky: { value: 300, min: 0, max: 360, step: 1, label: 'Sky hue' },
  hueGrid: { value: 190, min: 0, max: 360, step: 1, label: 'Grid hue' },
  scan: { value: 0.3, min: 0, max: 1, step: 0.02, label: 'Scanlines' },
})
rt.mapInput('audio.pulse', 'gridGlow', 0.7)
rt.mapInput('audio.low', 'hills', 0.3)

const VERT = `#version 300 es
in vec2 position; void main(){ gl_Position=vec4(position,0.,1.); }`
const FRAG = `#version 300 es
precision highp float;
uniform vec2 u_res; uniform float u_time,u_seed,u_pulse;
uniform float u_speed,u_gridGlow,u_hills,u_sun,u_hueSky,u_hueGrid,u_scan;
out vec4 o;
vec3 hsl(float h,float s,float l){ vec3 r=clamp(abs(mod(h*6.+vec3(0,4,2),6.)-3.)-1.,0.,1.); float c=(1.-abs(2.*l-1.))*s; return l+c*(r-.5); }
float hash(float x){ return fract(sin(x*127.1+u_seed)*43758.5); }
float hill(float x,float z){ // rolling hills, taller further out
  return (sin(x*0.6+z*0.2)*0.5+sin(x*1.7-z*0.1)*0.3+hash(floor(x*2.0))*0.4)*u_hills;
}
void main(){
  vec2 uv=gl_FragCoord.xy/u_res;
  vec2 p=(gl_FragCoord.xy-.5*u_res)/u_res.y;
  float horizon=0.02;
  vec3 col;
  if(p.y>horizon){
    // sky gradient + sun
    float sy=(p.y-horizon)/(0.5);
    col=mix(hsl(u_hueSky/360.,0.9,0.55), hsl((u_hueSky+40.)/360.,0.95,0.12), sy);
    // sun: an animated banded disc that slowly bobs as it "sets"
    vec2 sc=vec2(0.0, horizon+0.28 + sin(u_time*0.25)*0.02);
    float d=length(p-sc);
    float disc=smoothstep(u_sun*0.42, u_sun*0.40, d);
    // retro scan-bands only across the lower half — they rise over time and
    // the dark gaps widen toward the bottom (the classic sinking-sun look)
    float yb = clamp((sc.y - p.y) / (u_sun*0.42), 0.0, 1.0); // 0 centre → 1 base
    float scan = sin((p.y - sc.y)*90.0 + u_time*2.2);
    float bands = smoothstep(-0.2 - yb*1.4, 0.25, scan);    // gaps grow with yb
    float band = disc*(p.y>sc.y ? 1.0 : bands);
    vec3 sunCol=mix(hsl(0.13,1.0,0.62),hsl(0.95,1.0,0.55), (p.y-sc.y+u_sun*0.4)/(u_sun*0.8));
    // gentle brightness shimmer + beat swell
    float shimmer = 0.85 + 0.15*sin(u_time*3.0 + p.y*40.0);
    col=mix(col, sunCol*shimmer, band*(0.7+0.3*u_pulse));
    // soft pulsing halo around the disc
    float halo=smoothstep(u_sun*0.95, u_sun*0.4, d);
    col += hsl(0.05,1.0,0.5)*halo*halo*(0.12+0.10*u_pulse);
    // stars up high
    if(sy>0.5){ float st=step(0.996,hash(floor(p.x*300.)+floor(p.y*300.)*7.)); col+=st*0.6; }
  } else {
    // ground plane: perspective grid
    float z=horizon/(horizon-p.y); // depth
    float wx=p.x*z*8.0;
    float wz=z*6.0 - u_time*u_speed*4.0;
    float h=hill(wx,wz);
    // grid lines
    float gx=abs(fract(wx*0.5)-0.5);
    float gz=abs(fract(wz*0.5)-0.5);
    float line=smoothstep(0.06,0.0,min(gx,gz)/max(0.2,z*0.15));
    float fog=exp(-z*0.25);
    vec3 g=hsl(u_hueGrid/360.,1.0,0.6)*line*u_gridGlow*fog;
    vec3 ground=hsl((u_hueGrid+30.)/360.,0.8,0.06)*fog;
    col=ground+g+ h*0.15*hsl(u_hueGrid/360.,0.8,0.4)*fog;
  }
  // scanlines
  col*=1.0 - u_scan*0.4*step(0.5,fract(gl_FragCoord.y*0.5));
  o=vec4(col,1.0);
}`
function sh(t,s){const x=gl.createShader(t);gl.shaderSource(x,s);gl.compileShader(x);if(!gl.getShaderParameter(x,gl.COMPILE_STATUS))throw new Error(gl.getShaderInfoLog(x));return x}
const prog=gl.createProgram();gl.attachShader(prog,sh(gl.VERTEX_SHADER,VERT));gl.attachShader(prog,sh(gl.FRAGMENT_SHADER,FRAG));gl.linkProgram(prog);gl.useProgram(prog)
const b=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,b);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,3,-1,-1,3]),gl.STATIC_DRAW)
const loc=gl.getAttribLocation(prog,'position');gl.enableVertexAttribArray(loc);gl.vertexAttribPointer(loc,2,gl.FLOAT,false,0,0)
const U={};for(const n of ['u_res','u_time','u_seed','u_pulse','u_speed','u_gridGlow','u_hills','u_sun','u_hueSky','u_hueGrid','u_scan'])U[n]=gl.getUniformLocation(prog,n)
const seed=rt.random(0,100)
function resize(){canvas.width=window.innerWidth*rt.pixelRatio;canvas.height=window.innerHeight*rt.pixelRatio;gl.viewport(0,0,canvas.width,canvas.height)}
function frame(now){rt.tick(now)
  gl.uniform2f(U.u_res,canvas.width,canvas.height);gl.uniform1f(U.u_time,now*0.001);gl.uniform1f(U.u_seed,seed);gl.uniform1f(U.u_pulse,rt.beat.state.pulse)
  gl.uniform1f(U.u_speed,params.speed);gl.uniform1f(U.u_gridGlow,params.gridGlow);gl.uniform1f(U.u_hills,params.hills);gl.uniform1f(U.u_sun,params.sun)
  gl.uniform1f(U.u_hueSky,params.hueSky);gl.uniform1f(U.u_hueGrid,params.hueGrid);gl.uniform1f(U.u_scan,params.scan)
  gl.drawArrays(gl.TRIANGLES,0,3);requestAnimationFrame(frame)}
window.addEventListener('resize',resize);resize();requestAnimationFrame(frame)
