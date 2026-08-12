// Hyperbolic Space — an infinite {p,q} tiling drawn in the Poincaré disk, the
// conformal model of the hyperbolic plane where straight lines curve and equal
// tiles shrink toward the rim. Each pixel is folded back into one fundamental
// triangle of the (2,p,q) reflection group by two mirror lines and a circle
// inversion; the reflection count paints the tiles. A drifting SU(1,1) Möbius
// transform glides the camera endlessly through the negatively-curved space.
import { createRuntime } from '../_lib/runtime.js'

const rt = createRuntime()
const canvas = document.getElementById('canvas')
const CAPTURE = new URLSearchParams(location.search).get('capture') === '1'
const gl = canvas.getContext('webgl2', { preserveDrawingBuffer: CAPTURE })

const PALS = ['Aurora', 'Ember', 'Ocean', 'Mono']
const params = rt.params({
  p: { value: 7, min: 3, max: 9, step: 1, label: 'Polygon sides (p)' },
  q: { value: 3, min: 3, max: 8, step: 1, label: 'Meeting (q)' },
  glide: { value: 0.5, min: 0, max: 1.5, step: 0.02, label: 'Glide speed' },
  turn: { value: 0.15, min: -1, max: 1, step: 0.01, label: 'Turn' },
  edges: { value: 0.5, min: 0, max: 1, step: 0.02, label: 'Edge ink' },
  glow: { value: 0.5, min: 0, max: 1, step: 0.02, label: 'Depth glow' },
  palette: { value: 'Aurora', type: 'select', options: PALS, label: 'Palette' },
})
rt.mapInput('beat.pulse', 'glow', 0.5)

const VERT = `#version 300 es
in vec2 position; void main(){ gl_Position = vec4(position,0.,1.); }`
const FRAG = `#version 300 es
precision highp float;
uniform vec2 u_res, u_A, u_B; uniform float u_p, u_q, u_edges, u_glow; uniform int u_pal;
out vec4 o;
const float PI = 3.14159265;
vec2 cmul(vec2 a, vec2 b){ return vec2(a.x*b.x - a.y*b.y, a.x*b.y + a.y*b.x); }
vec2 cconj(vec2 a){ return vec2(a.x, -a.y); }
vec2 cdiv(vec2 a, vec2 b){ float d=dot(b,b); return vec2(a.x*b.x + a.y*b.y, a.y*b.x - a.x*b.y)/d; }

vec3 pal(float t){
  t = clamp(t, 0.0, 1.0);
  if(u_pal==0) return 0.5 + 0.5*cos(6.2831*(t*0.8 + vec3(0.0,0.33,0.60)) + 1.0);      // aurora
  if(u_pal==1) return mix(vec3(0.15,0.02,0.0), vec3(1.0,0.75,0.25), t) + vec3(0.15,0.0,0.05)*sin(t*9.0); // ember
  if(u_pal==2) return mix(vec3(0.0,0.05,0.15), vec3(0.35,0.9,1.0), t);                // ocean
  return vec3(0.12 + 0.8*t);                                                          // mono
}

void main(){
  vec2 uv = (gl_FragCoord.xy - 0.5*u_res)/min(u_res.x,u_res.y) * 2.0;
  float rr0 = dot(uv, uv);
  if(rr0 > 1.0){ o = vec4(0.02,0.02,0.035,1.0); return; }   // outside the disk

  // glide the camera: z' = (A z + B)/(conj(B) z + conj(A))
  vec2 z = cdiv(cmul(u_A, uv) + u_B, cmul(cconj(u_B), uv) + cconj(u_A));

  // (2,p,q) reflecting circle on the x-axis, orthogonal to the unit disk
  float cp = cos(PI/u_p), sq = sin(PI/u_q);
  float denom = sqrt(max(1e-4, cp*cp - sq*sq));
  float d = cp/denom;                 // centre distance
  float r = sq/denom;                 // radius
  vec2  O2 = vec2(d, 0.0);
  float rr = r*r;
  float wp = PI/u_p;

  int count = 0;
  float dEdge = 1e3;
  for(int i=0;i<64;i++){
    // fold the angle into one wedge [0, wp] via the two straight mirrors
    float ang = atan(z.y, z.x);
    ang = ang - 2.0*wp*floor(ang/(2.0*wp));
    if(ang > wp) ang = 2.0*wp - ang;
    float rad = length(z);
    z = rad*vec2(cos(ang), sin(ang));
    // invert in the mirror circle if we're inside it, else we've landed
    vec2 c = z - O2; float d2 = dot(c, c);
    if(d2 < rr){ z = O2 + c*(rr/d2); count++; }
    else {
      // distance to the three triangle edges, for the geodesic net
      float e1 = z.y;                                   // x-axis mirror
      float e2 = abs(z.x*sin(wp) - z.y*cos(wp));         // wedge mirror
      float e3 = sqrt(d2) - r;                           // circle mirror
      dEdge = min(min(e1, e2), e3);
      break;
    }
  }

  float depth = float(count);
  // tile fill: cycle the palette by reflection depth, two-tone per triangle parity
  float tone = mod(depth, 6.0)/6.0;
  vec3 col = pal(tone);
  col *= (mod(depth, 2.0) < 1.0) ? 1.0 : 0.72;          // checker the two half-tiles

  // geodesic edges (uniform width in the hyperbolic metric on the folded point)
  float lw = 0.008 + 0.03*u_edges;
  float line = smoothstep(lw, lw*0.4, dEdge);
  col = mix(col, vec3(0.02,0.02,0.04), line*(0.4+0.6*u_edges));

  // depth glow toward the centre + fade into the rim
  col *= 0.55 + 0.6*exp(-depth*0.12);
  col += u_glow*0.25*exp(-depth*0.2);
  col *= smoothstep(1.0, 0.9, rr0);                     // soft disk edge

  o = vec4(col, 1.0);
}`

function sh(t, s) { const x = gl.createShader(t); gl.shaderSource(x, s); gl.compileShader(x); if (!gl.getShaderParameter(x, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(x)); return x }
const prog = gl.createProgram(); gl.attachShader(prog, sh(gl.VERTEX_SHADER, VERT)); gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FRAG)); gl.linkProgram(prog); gl.useProgram(prog)
const gbuf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, gbuf); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW)
const pos = gl.getAttribLocation(prog, 'position'); gl.enableVertexAttribArray(pos); gl.vertexAttribPointer(pos, 2, gl.FLOAT, false, 0, 0)
const U = (n) => gl.getUniformLocation(prog, n)
const u = { res: U('u_res'), A: U('u_A'), B: U('u_B'), p: U('u_p'), q: U('u_q'), edges: U('u_edges'), glow: U('u_glow'), pal: U('u_pal') }

// Camera as a bounded wander instead of an accumulating glide. The earlier
// version composed a hyperbolic translation every frame, so the net transform
// grew without bound and the viewpoint ran off toward the ideal boundary —
// where the tiles shrink to nothing and the whole disk washes out to one tone.
// Here the origin is translated to a point that orbits on a breathing circle
// kept well inside the disk (|a| ≤ ~0.73), plus a slow world spin. Motion stays
// continuous but never approaches the rim, so the tiling never collapses.
function resize() { canvas.width = window.innerWidth * rt.pixelRatio; canvas.height = window.innerHeight * rt.pixelRatio; gl.viewport(0, 0, canvas.width, canvas.height) }
let last = 0, phase = 0, breath = 0, spin = 0
function frame(now) {
  rt.tick(now)
  const dt = last ? Math.min(0.05, (now - last) / 1000) : 0.016; last = now
  phase += params.glide * dt * 0.35   // travel around the wander circle
  breath += params.glide * dt * 0.21  // circle radius breathes in and out
  spin += params.turn * dt * 0.5       // world rotation
  const R = 0.45 + 0.28 * Math.sin(breath + 1.3)   // 0.17 .. 0.73, always interior
  const ax = R * Math.cos(phase), ay = R * Math.sin(phase)
  const nrm = 1 / Math.sqrt(Math.max(1e-3, 1 - (ax * ax + ay * ay)))
  const cr = Math.cos(spin * 0.5), sr = Math.sin(spin * 0.5)
  // M = Translate(a) ∘ Rotate(spin):  A = n·e^{i spin/2},  B = n·a·e^{-i spin/2}
  const A0 = nrm * cr, A1 = nrm * sr
  const B0 = nrm * (ax * cr + ay * sr), B1 = nrm * (ay * cr - ax * sr)

  gl.uniform2f(u.res, canvas.width, canvas.height)
  gl.uniform2f(u.A, A0, A1); gl.uniform2f(u.B, B0, B1)
  gl.uniform1f(u.p, Math.round(params.p)); gl.uniform1f(u.q, Math.round(params.q))
  gl.uniform1f(u.edges, params.edges); gl.uniform1f(u.glow, params.glow)
  gl.uniform1i(u.pal, Math.max(0, PALS.indexOf(params.palette)))
  gl.drawArrays(gl.TRIANGLES, 0, 3)
  requestAnimationFrame(frame)
}
window.addEventListener('resize', resize); resize(); requestAnimationFrame(frame)
