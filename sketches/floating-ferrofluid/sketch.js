/**
 * Floating Ferrofluid — blobs of magnetic fluid suspended in a liquid tank,
 * the way ferrofluid hangs in the classic density-matched bottle sculptures.
 * The blobs drift on slow currents, bob, softly repel and merge into one
 * another as metaballs, and bristle into radial Rosensweig spikes that lean
 * toward the magnet. Everything is rendered per pixel from the metaball field:
 * the surface normal comes from the field gradient and is shaded like oily
 * black chrome — diffuse, a tight specular, a procedural environment reflection
 * and Fresnel edge sheen — floating over a lit liquid tank.
 *
 * It floats in front of a loudspeaker that drives it: the cone pumps with the
 * bass and the sound modulates the fluid in real time — bass swells the whole
 * body and throws the spikes taller, treble bristles them finer. Turn on the
 * mic (bottom-right) to feed it live sound; with no mic it runs on a synthetic
 * throb so it's never still. Move the mouse to lean the spikes like a magnet.
 */
import { createRuntime } from '../_lib/runtime.js'

const rt = createRuntime()
const canvas = document.getElementById('canvas')
const CAPTURE = new URLSearchParams(location.search).get('capture') === '1'
const gl = canvas.getContext('webgl2', { preserveDrawingBuffer: CAPTURE })

const params = rt.params({
  blobs: { value: 7, min: 2, max: 12, step: 1, label: 'Fluid lobes' },
  size: { value: 0.26, min: 0.12, max: 0.5, step: 0.01, label: 'Pool size' },
  gather: { value: 0.7, min: 0.2, max: 1.4, step: 0.02, label: 'Gather (pool)' },
  field: { value: 0.9, min: 0, max: 1.6, step: 0.02, label: 'Field / spikes' },
  spikes: { value: 11, min: 3, max: 24, step: 1, label: 'Spike count' },
  magnet: { value: 0.5, min: 0, max: 2.5, step: 0.05, label: 'Magnet pull' },
  jitter: { value: 0.4, min: 0, max: 1.5, step: 0.02, label: 'Jitter / dance' },
  viscosity: { value: 0.5, min: 0.05, max: 1, step: 0.02, label: 'Viscosity' },
  drive: { value: 1.1, min: 0, max: 2, step: 0.05, label: 'Speaker drive' },
  hue: { value: Math.round(rt.random(200, 300)), min: 0, max: 360, step: 1, label: 'Sheen hue' },
})
rt.onBeat(() => {}) // mounts the mic toggle; audio is read directly below

const MAXB = 12
const VERT = `#version 300 es
in vec2 position; void main(){ gl_Position = vec4(position, 0.0, 1.0); }`
const FRAG = `#version 300 es
precision highp float;
uniform vec2 u_res;
uniform float u_time, u_pulse, u_field, u_spikes, u_hue, u_magnetOn;
uniform float u_bass, u_high, u_cone, u_drive;
uniform vec2 u_mouse;
uniform int u_count;
uniform vec3 u_blobs[${MAXB}];
out vec4 o;
vec3 hsl(float h,float s,float l){ vec3 r=clamp(abs(mod(h*6.+vec3(0,4,2),6.)-3.)-1.,0.,1.); float c=(1.-abs(2.*l-1.))*s; return l+c*(r-.5); }
// Metaball field with per-blob radial spikes. The speaker pushes the fluid
// outward (spikes bias radially from the centre) and the bass swells them; the
// magnet (mouse) leans them, and treble bristles them finer.
float field(vec2 p){
  float f = 0.0;
  float audio = 1.0 + u_bass*2.2*u_drive + u_pulse*0.8;
  float freq = u_spikes*(1.0 + u_high*1.2*u_drive);
  for(int i=0;i<${MAXB};i++){
    if(i>=u_count) break;
    vec3 b = u_blobs[i];
    vec2 d = p - b.xy;
    float dist = length(d)+1e-4;
    float ang = atan(d.y, d.x);
    float magAng = atan(u_mouse.y-b.y, u_mouse.x-b.x);
    float radAng = atan(b.y, b.x);                       // outward from the cone
    float bias = mix(radAng, magAng, 0.4*u_magnetOn);
    float toward = 0.5+0.5*cos(ang-bias);
    // sharp primary spikes with a finer secondary bristle riding on them
    float ridge = pow(0.5+0.5*cos(ang*freq + u_time*0.7 + float(i)*1.7), 4.0);
    ridge *= 0.75 + 0.25*pow(0.5+0.5*cos(ang*freq*2.7 - u_time*1.3 + float(i)), 2.0);
    float amp = u_field*(0.25 + 0.75*toward)*audio*1.25;
    float reff = b.z*(1.0 + amp*ridge);
    f += reff*reff/(dist*dist);
  }
  return f;
}
// The loudspeaker the fluid floats in front of: a coned driver with concentric
// grooves, a domed dust cap and a rubber surround, its cone breathing on the bass.
vec3 speaker(vec2 p){
  float rr = length(p) / (1.0 - 0.03*u_cone);            // cone excursion on bass
  float R = 0.95;
  vec3 c = mix(vec3(0.05,0.05,0.06), vec3(0.12,0.12,0.14), 0.5+0.5*cos(rr*34.0 - u_cone*7.0));
  c *= 0.45 + 0.6*smoothstep(0.0, R, rr);                // cone depth shading
  float cap = smoothstep(R*0.26, R*0.2, rr);             // dust cap dome
  c = mix(c, vec3(0.13,0.13,0.16)*(0.7+0.7*u_cone), cap);
  float sur = smoothstep(R*1.02, R*0.9, rr) * smoothstep(R*0.76, R*0.9, rr); // surround
  c = mix(c, vec3(0.07,0.07,0.08), sur);
  c += hsl(u_hue/360.0,0.6,0.5)*u_bass*0.35*smoothstep(R, 0.0, rr); // bass glow from the cap
  return c;
}
void main(){
  vec2 p = (gl_FragCoord.xy - 0.5*u_res) / (0.5*min(u_res.x,u_res.y));
  float F = field(p);
  float e = 2.0/min(u_res.x,u_res.y);
  float fx = field(p+vec2(e,0.0)) - field(p-vec2(e,0.0));
  float fy = field(p+vec2(0.0,e)) - field(p-vec2(0.0,e));
  vec2 grad = vec2(fx,fy)/(2.0*e);
  float iso = 1.0;
  float m = smoothstep(iso-0.55, iso+0.55, F);          // fluid mask

  // the speaker, sitting in its cabinet, fluid floating in front of it
  vec3 cab = mix(vec3(0.02,0.02,0.03), vec3(0.04,0.045,0.06), 0.5+0.5*p.y);
  float disc = smoothstep(0.98, 0.94, length(p));       // the driver's circular face
  vec3 bg = mix(cab, speaker(p), disc);
  // soft shadow the fluid casts onto the cone
  bg = mix(bg, bg*0.55, smoothstep(iso-0.9, iso, F)*(1.0-m));

  // chrome-black shading off the field-gradient normal
  vec3 n = normalize(vec3(-grad*0.05, 1.0));
  vec3 L = normalize(vec3(0.4,0.7,0.65));
  vec3 V = vec3(0.0,0.0,1.0);
  float diff = max(dot(n,L),0.0);
  vec3 Rr = reflect(-L, n);
  float spec = pow(max(dot(Rr,V),0.0), 60.0);
  float fres = pow(1.0-max(n.z,0.0), 3.0);
  vec3 rv = reflect(-V, n);
  vec3 env = mix(vec3(0.02,0.03,0.05), hsl(u_hue/360.0,0.5,0.62), 0.5+0.5*sin(rv.x*6.0+rv.y*4.0+u_time*0.5));
  vec3 body = vec3(0.015);
  body += diff*0.14;
  body += env*(0.35+0.65*fres);
  body += vec3(1.0)*spec*(0.9+u_pulse);
  body += hsl(u_hue/360.0,0.7,0.6)*fres*0.5;

  vec3 col = mix(bg, body, m);
  o = vec4(col, 1.0);
}`

function sh(t, s) { const x = gl.createShader(t); gl.shaderSource(x, s); gl.compileShader(x); if (!gl.getShaderParameter(x, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(x)); return x }
const prog = gl.createProgram()
gl.attachShader(prog, sh(gl.VERTEX_SHADER, VERT))
gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FRAG))
gl.linkProgram(prog); gl.useProgram(prog)
const buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf)
gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW)
const loc = gl.getAttribLocation(prog, 'position'); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0)
const U = {}
for (const n of ['u_res', 'u_time', 'u_pulse', 'u_field', 'u_spikes', 'u_hue', 'u_magnetOn', 'u_bass', 'u_high', 'u_cone', 'u_drive', 'u_mouse', 'u_count', 'u_blobs']) U[n] = gl.getUniformLocation(prog, n)

// --- audio drive: real mic levels when it's on, a synthetic throb otherwise,
// so the speaker always pumps and the fluid is never dead in the gallery. ---
let bass = 0, high = 0, cone = 0
function readAudio(t) {
  const s = rt.beat.state
  if (s.active) {
    bass += (s.low - bass) * 0.35
    high += (s.high - high) * 0.35
  } else {
    // a kick-drum-ish synthetic bass: a decaying thump ~2.2 Hz plus a low sine
    const beatPhase = (t * 2.2) % 1
    const thump = Math.exp(-beatPhase * 6) * 0.9
    bass += ((0.25 + thump + 0.15 * Math.sin(t * 1.3)) - bass) * 0.3
    high += ((0.2 + 0.15 * Math.sin(t * 9) + 0.1 * thump) - high) * 0.3
  }
  cone += (bass - cone) * 0.4 // cone excursion trails the bass a touch
}

// --- blob physics (in the shader's normalized coords: short axis spans -1..1) ---
let halfW = 1, halfH = 1
const blobs = []
const buf3 = new Float32Array(MAXB * 3)
function makeBlob() {
  return {
    // spawn near the cone centre — the fluid pools there and spikes outward
    x: rt.random(-0.28, 0.28),
    y: rt.random(-0.28, 0.28),
    vx: 0, vy: 0,
    r: params.size * rt.random(0.7, 1.15),
    ph: rt.random(0, Math.PI * 2),
  }
}
function syncCount() {
  const target = Math.round(params.blobs)
  while (blobs.length < target) blobs.push(makeBlob())
  while (blobs.length > target) blobs.pop()
}

// magnet target: the mouse when it's moving, otherwise a slow auto-drift so the
// spikes keep leaning and dancing on their own.
let magX = 0, magY = 0, tmagX = 0, tmagY = 0
let pointerActive = 0
window.addEventListener('pointermove', (e) => {
  const nx = (e.clientX * rt.pixelRatio - 0.5 * canvas.width) / (0.5 * Math.min(canvas.width, canvas.height))
  const ny = -(e.clientY * rt.pixelRatio - 0.5 * canvas.height) / (0.5 * Math.min(canvas.width, canvas.height))
  tmagX = nx; tmagY = ny; pointerActive = 1.2
})

// Divergence-free-ish current so the whole tank drifts like liquid.
function current(x, y, t) {
  return [1.1 * Math.cos(1.2 * y - 0.3 * t) + 0.6 * Math.cos(0.7 * (x + y) + 0.2 * t),
    -(0.9 * Math.cos(1.0 * x + 0.4 * t) + 0.6 * Math.cos(0.7 * (x + y) + 0.2 * t))]
}

let lastNow = 0
function step(t, dt) {
  pointerActive = Math.max(0, pointerActive - dt)
  if (pointerActive <= 0) { tmagX = halfW * 0.7 * Math.sin(t * 0.31); tmagY = halfH * 0.7 * Math.cos(t * 0.23) }
  magX += (tmagX - magX) * Math.min(1, dt * 4)
  magY += (tmagY - magY) * Math.min(1, dt * 4)

  const damp = Math.pow(0.02, dt * (0.4 + params.viscosity)) // higher viscosity → more damping
  const jit = params.jitter
  const pull = params.magnet
  const gather = params.gather
  // the pool spreads a little as the bass drives it, then draws back together
  const spreadR = params.size * (1.0 + bass * params.drive * 1.6)
  for (let i = 0; i < blobs.length; i++) {
    const b = blobs[i]
    // gather onto the cone centre (leaning toward the magnet) so the fluid stays
    // one central spiky mass instead of drifting off across the frame
    const gx = magX * 0.35 * (pull / 0.5), gy = magY * 0.35 * (pull / 0.5)
    b.vx += (gx - b.x) * gather * 2.2 * dt
    b.vy += (gy - b.y) * gather * 2.2 * dt
    // small chaotic jitter so the lobes shiver and dance
    const [cx, cy] = current(b.x, b.y, t)
    b.vx += (cx + Math.sin(t * 2.1 + b.ph) * 1.5) * jit * 0.04 * dt
    b.vy += (cy + Math.cos(t * 1.8 + b.ph * 1.3) * 1.5) * jit * 0.04 * dt
    // the speaker shoves the fluid outward on the bass, then it settles back
    const rr = Math.hypot(b.x, b.y) + 1e-3
    const push = (bass - 0.3) * params.drive * 0.16
    b.vx += (b.x / rr) * push * dt * 6
    b.vy += (b.y / rr) * push * dt * 6
    // soft mutual repulsion so the lobes pack into a lumpy pool, not a point
    for (let j = 0; j < blobs.length; j++) {
      if (j === i) continue
      const o = blobs[j]
      const ox = b.x - o.x, oy = b.y - o.y
      const od = Math.hypot(ox, oy) + 1e-3
      const min = (b.r + o.r) * 0.62
      if (od < min) { const f = (min - od) / min * 0.5 * dt; b.vx += (ox / od) * f; b.vy += (oy / od) * f }
    }
    b.vx *= damp; b.vy *= damp
    b.x += b.vx; b.y += b.vy
    // keep the pool within a disc around the centre (never off the cone)
    const maxR = Math.min(halfW, halfH) * 0.7 + spreadR
    const cr = Math.hypot(b.x, b.y)
    if (cr > maxR) { b.x *= maxR / cr; b.y *= maxR / cr; b.vx *= 0.3; b.vy *= 0.3 }
    b.r += (params.size * (0.85 + 0.15 * Math.sin(t + b.ph)) - b.r) * Math.min(1, dt * 2)
  }
}

function resize() {
  canvas.width = window.innerWidth * rt.pixelRatio
  canvas.height = window.innerHeight * rt.pixelRatio
  gl.viewport(0, 0, canvas.width, canvas.height)
  halfW = canvas.width >= canvas.height ? canvas.width / canvas.height : 1
  halfH = canvas.width >= canvas.height ? 1 : canvas.height / canvas.width
}

function frame(now) {
  rt.tick(now)
  const t = now * 0.001
  const dt = lastNow ? Math.min(0.05, (now - lastNow) / 1000) : 0.016
  lastNow = now
  readAudio(t)
  syncCount()
  step(t, dt)
  for (let i = 0; i < blobs.length; i++) { buf3[i * 3] = blobs[i].x; buf3[i * 3 + 1] = blobs[i].y; buf3[i * 3 + 2] = blobs[i].r }

  gl.uniform2f(U.u_res, canvas.width, canvas.height)
  gl.uniform1f(U.u_time, t)
  gl.uniform1f(U.u_pulse, rt.beat.state.pulse)
  gl.uniform1f(U.u_field, params.field)
  gl.uniform1f(U.u_spikes, params.spikes)
  gl.uniform1f(U.u_hue, params.hue)
  gl.uniform1f(U.u_magnetOn, pointerActive > 0 ? 1 : 0.7)
  gl.uniform1f(U.u_bass, bass)
  gl.uniform1f(U.u_high, high)
  gl.uniform1f(U.u_cone, cone)
  gl.uniform1f(U.u_drive, params.drive)
  gl.uniform2f(U.u_mouse, magX, magY)
  gl.uniform1i(U.u_count, blobs.length)
  gl.uniform3fv(U.u_blobs, buf3)
  gl.drawArrays(gl.TRIANGLES, 0, 3)
  requestAnimationFrame(frame)
}
window.addEventListener('resize', resize)
resize()
requestAnimationFrame(frame)
