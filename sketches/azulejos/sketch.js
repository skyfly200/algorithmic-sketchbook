// Azulejos — the blue-and-white glazed ceramic tiles of Spain and Portugal,
// generated procedurally. Each tile carries an 8-fold rosette with a linking
// stem to corner buds so the pattern runs continuously across the wall, framed
// by a painted border and set in grout. Cobalt on cream, polychrome Spanish, or
// manganese purple; a slow glaze sheen sweeps across the fired surface.
import { createRuntime } from '../_lib/runtime.js'

const rt = createRuntime()
const canvas = document.getElementById('canvas')
const CAPTURE = new URLSearchParams(location.search).get('capture') === '1'
const gl = canvas.getContext('webgl2', { preserveDrawingBuffer: CAPTURE })

const PALS = ['Cobalt', 'Polychrome', 'Manganese']
const params = rt.params({
  palette: { value: 'Cobalt', type: 'select', options: PALS, label: 'Glaze' },
  tiles: { value: 4, min: 1, max: 10, step: 1, label: 'Tiles across' },
  petals: { value: 8, min: 4, max: 12, step: 1, label: 'Rosette points' },
  ornament: { value: 0.6, min: 0, max: 1, step: 0.02, label: 'Ornament' },
  grout: { value: 0.5, min: 0, max: 1, step: 0.02, label: 'Grout' },
  sheen: { value: 0.5, min: 0, max: 1, step: 0.02, label: 'Glaze sheen' },
  spin: { value: 0.1, min: -1, max: 1, step: 0.01, label: 'Motif drift' },
})
rt.mapInput('beat.pulse', 'sheen', 0.4)

const VERT = `#version 300 es
in vec2 position; void main(){ gl_Position = vec4(position,0.,1.); }`
const FRAG = `#version 300 es
precision highp float;
uniform vec2 u_res; uniform float u_time, u_tiles, u_petals, u_orn, u_grout, u_sheen, u_spin;
uniform int u_pal;
out vec4 o;

float ring(float r, float c, float w){ return smoothstep(w, 0.0, abs(r-c)); }

// one tile motif, cell coords in -0.5..0.5
float motif(vec2 c, float phase){
  float m = 0.0;
  float r = length(c);
  float a = atan(c.y, c.x) + phase;
  // central rosette: petalled disc with a hollow centre
  float petal = 0.20 + 0.06*u_orn*cos(u_petals*a);
  m = max(m, smoothstep(0.015, -0.015, r - petal));
  m *= smoothstep(0.05, 0.075, r);                 // hollow middle
  m = max(m, ring(r, petal + 0.035, 0.012));        // outline ring
  m = max(m, ring(r, 0.055, 0.010));                // inner ring
  // eight little dots around the rosette
  float dots = smoothstep(0.03, 0.0, abs(r - (petal+0.085)) ) * step(0.5, 0.5+0.5*cos(u_petals*a));
  m = max(m, dots*u_orn);
  // diagonal stems to the corners for cross-tile continuity
  vec2 ca = abs(c);
  float diag = abs(ca.x - ca.y);                    // 0 on the diagonals
  float stem = smoothstep(0.018, 0.0, diag) * smoothstep(0.16, 0.24, r) * smoothstep(0.52,0.42,r);
  m = max(m, stem*0.9);
  // corner buds (join with neighbouring tiles across the grout)
  vec2 q = abs(c) - 0.5;
  float rc = length(q);
  float ac = atan(q.y, q.x);
  float bud = 0.10 + 0.05*u_orn*cos(u_petals*ac + phase);
  m = max(m, smoothstep(0.012,-0.012, rc - bud));
  m = max(m, ring(rc, bud+0.03, 0.010));
  // painted square frame near the tile edge
  float sq = max(ca.x, ca.y);
  m = max(m, ring(sq, 0.44, 0.010));
  m = max(m, ring(sq, 0.40, 0.006)*0.8);
  return clamp(m, 0.0, 1.0);
}

void main(){
  vec2 uv = (gl_FragCoord.xy - 0.5*u_res)/min(u_res.x,u_res.y);
  vec2 p = uv * u_tiles;
  vec2 cell = fract(p) - 0.5;
  vec2 id = floor(p);
  float checker = mod(id.x + id.y, 2.0);            // alternate motif drift
  float phase = u_time*u_spin*(checker>0.5? 1.0 : -1.0);
  float m = motif(cell, phase);

  // grout: darker groove + bevel between tiles
  vec2 e = 0.5 - abs(cell);
  float edge = min(e.x, e.y);
  float groove = smoothstep(0.5*u_grout*0.09, 0.0, edge);

  // palette
  vec3 glaze, ink, ink2, accent;
  if(u_pal==0){ glaze=vec3(0.93,0.90,0.80); ink=vec3(0.10,0.22,0.55); ink2=vec3(0.05,0.11,0.34); accent=ink; }
  else if(u_pal==1){ glaze=vec3(0.95,0.92,0.82); ink=vec3(0.10,0.24,0.58); ink2=vec3(0.72,0.14,0.10); accent=vec3(0.86,0.66,0.12); }
  else { glaze=vec3(0.95,0.93,0.88); ink=vec3(0.34,0.10,0.36); ink2=vec3(0.18,0.05,0.22); accent=ink; }

  // paint: blend glaze->ink by motif; use ink2 for the hard outlines
  vec3 col = mix(glaze, ink, smoothstep(0.15,0.55,m));
  col = mix(col, ink2, smoothstep(0.6,0.95,m));
  // polychrome flecks: tint the corner buds with the accent
  if(u_pal==1){
    vec2 q = abs(cell)-0.5; float rc=length(q);
    col = mix(col, accent, smoothstep(0.12,0.06,rc)*smoothstep(0.4,0.6,m));
  }

  // grout groove
  vec3 groutCol = vec3(0.62,0.58,0.50);
  col = mix(col, groutCol, groove);

  // fired glaze sheen: a soft diagonal specular band sweeping across
  float band = sin((uv.x+uv.y)*2.2 - u_time*0.4);
  float sh = smoothstep(0.85,1.0, band) * u_sheen * (0.4+0.6*(1.0-m));
  col += sh*0.28;
  // gentle per-tile glaze unevenness
  col *= 0.96 + 0.04*sin(id.x*1.7)*cos(id.y*2.1);

  o = vec4(col, 1.0);
}`

function sh(t, s) { const x = gl.createShader(t); gl.shaderSource(x, s); gl.compileShader(x); if (!gl.getShaderParameter(x, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(x)); return x }
const prog = gl.createProgram(); gl.attachShader(prog, sh(gl.VERTEX_SHADER, VERT)); gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FRAG)); gl.linkProgram(prog); gl.useProgram(prog)
const buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW)
const pos = gl.getAttribLocation(prog, 'position'); gl.enableVertexAttribArray(pos); gl.vertexAttribPointer(pos, 2, gl.FLOAT, false, 0, 0)
const U = (n) => gl.getUniformLocation(prog, n)
const u = { res: U('u_res'), time: U('u_time'), tiles: U('u_tiles'), petals: U('u_petals'), orn: U('u_orn'), grout: U('u_grout'), sheen: U('u_sheen'), spin: U('u_spin'), pal: U('u_pal') }
function resize() { canvas.width = window.innerWidth * rt.pixelRatio; canvas.height = window.innerHeight * rt.pixelRatio; gl.viewport(0, 0, canvas.width, canvas.height) }
function frame(now) {
  rt.tick(now)
  gl.uniform2f(u.res, canvas.width, canvas.height); gl.uniform1f(u.time, now * 0.001)
  gl.uniform1f(u.tiles, Math.round(params.tiles)); gl.uniform1f(u.petals, Math.round(params.petals))
  gl.uniform1f(u.orn, params.ornament); gl.uniform1f(u.grout, params.grout); gl.uniform1f(u.sheen, params.sheen); gl.uniform1f(u.spin, params.spin)
  gl.uniform1i(u.pal, Math.max(0, PALS.indexOf(params.palette)))
  gl.drawArrays(gl.TRIANGLES, 0, 3); requestAnimationFrame(frame)
}
window.addEventListener('resize', resize); resize(); requestAnimationFrame(frame)
