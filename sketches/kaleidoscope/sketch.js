/**
 * Kaleidoscope over a live source (camera / dropped photo or video / demo /
 * the Mixer-Patch layers below). Classic mirror-tube optics: one wedge of the
 * scene is sampled and reflected around the centre — segments alternate
 * mirrored and unmirrored so edges always match, exactly like a two-mirror
 * kaleidoscope. (A fragment shader: fold the plane into one mirrored wedge and
 * sample the source there, so it also runs in a Patch filter chain.) The wedge slowly orbits the source (steer it with the mouse),
 * the whole mandala turns, and beats kick the rotation.
 */
import { createRuntime } from '../_lib/runtime.js'
import { createSource } from '../_lib/source.js'
import { createGLFilter } from '../_lib/glfilter.js'

const rt = createRuntime()
const params = rt.params({
  segments: { value: 2 * Math.round(rt.random(3, 8)), min: 4, max: 24, step: 2, label: 'Segments' },
  spin: { value: +rt.random(0.05, 0.3).toFixed(2), min: -1, max: 1, step: 0.01, label: 'Mandala spin' },
  orbit: { value: +rt.random(0.1, 0.35).toFixed(2), min: 0, max: 1, step: 0.02, label: 'Wedge orbit' },
  zoom: { value: 1.15, min: 0.6, max: 2.5, step: 0.05, label: 'Sample zoom' },
  srcX: { value: 0.5, min: 0, max: 1, step: 0.01, label: 'Sample X' },
  srcY: { value: 0.5, min: 0, max: 1, step: 0.01, label: 'Sample Y' },
})
// Steer the sampled wedge with the mouse; beats kick the mandala's spin.
// Centred: the pointer swings the sample point both ways around its base
// (screen centre = the base), across the slider's whole range.
rt.mapInput('mouse.x', 'srcX', 1, { center: true })
rt.mapInput('mouse.y', 'srcY', 1, { center: true })
rt.mapInput('audio.pulse', 'spin', 0.3)

const canvas = document.getElementById('canvas')

// Demo source: a "bead dish" — dense drifting clusters of glass beads,
// petals, rings and sequins. A kaleidoscope lives on fine colourful detail,
// which the default soft-blob demo doesn't have.
const beads = []
{
  const clusters = []
  for (let c = 0; c < 5; c++) {
    clusters.push({
      x: rt.random(0.2, 0.8),
      y: rt.random(0.2, 0.8),
      drift: rt.random(0.3, 1),
      ph: rt.random(0, Math.PI * 2),
    })
  }
  for (let i = 0; i < 130; i++) {
    beads.push({
      c: clusters[i % clusters.length],
      kind: rt.pick(['bead', 'petal', 'tri', 'ring', 'sequin']),
      r: rt.random(0.02, 0.11), // orbit radius around the cluster
      orbitSpeed: rt.random(0.05, 0.35) * (rt.rng() < 0.5 ? 1 : -1),
      ph: rt.random(0, Math.PI * 2),
      size: rt.random(6, 26),
      hue: Math.round(rt.random(0, 360)),
      spin: rt.random(-1.5, 1.5),
    })
  }
}
function beadDish(c, t, w, h) {
  const g = c.createLinearGradient(0, 0, w, h)
  g.addColorStop(0, '#100a1e')
  g.addColorStop(1, '#0a1420')
  c.fillStyle = g
  c.fillRect(0, 0, w, h)
  for (const b of beads) {
    const cl = b.c
    const cx = (cl.x + 0.06 * Math.sin(t * 0.11 * cl.drift + cl.ph)) * w
    const cy = (cl.y + 0.05 * Math.cos(t * 0.09 * cl.drift + cl.ph * 1.7)) * h
    const a = t * b.orbitSpeed + b.ph
    const x = cx + Math.cos(a) * b.r * w
    const y = cy + Math.sin(a) * b.r * w
    c.save()
    c.translate(x, y)
    c.rotate(t * b.spin + b.ph)
    const s = b.size
    if (b.kind === 'bead') {
      const rg = c.createRadialGradient(-s * 0.3, -s * 0.3, s * 0.1, 0, 0, s)
      rg.addColorStop(0, '#fff')
      rg.addColorStop(0.3, `hsl(${b.hue}, 85%, 62%)`)
      rg.addColorStop(1, `hsl(${b.hue}, 75%, 26%)`)
      c.fillStyle = rg
      c.beginPath()
      c.arc(0, 0, s, 0, Math.PI * 2)
      c.fill()
    } else if (b.kind === 'petal') {
      c.fillStyle = `hsl(${b.hue}, 75%, 58%)`
      c.beginPath()
      c.ellipse(s * 0.5, 0, s, s * 0.36, 0, 0, Math.PI * 2)
      c.fill()
      c.strokeStyle = `hsl(${b.hue}, 60%, 30%)`
      c.lineWidth = 1.5
      c.stroke()
    } else if (b.kind === 'tri') {
      c.fillStyle = `hsl(${b.hue}, 80%, 55%)`
      c.beginPath()
      c.moveTo(s, 0)
      c.lineTo(-s * 0.5, s * 0.7)
      c.lineTo(-s * 0.5, -s * 0.7)
      c.closePath()
      c.fill()
    } else if (b.kind === 'ring') {
      c.strokeStyle = `hsl(${b.hue}, 80%, 60%)`
      c.lineWidth = s * 0.3
      c.beginPath()
      c.arc(0, 0, s * 0.7, 0, Math.PI * 2)
      c.stroke()
    } else {
      c.fillStyle = `hsl(${b.hue}, 95%, 72%)`
      c.fillRect(-s * 0.4, -s * 0.4, s * 0.8, s * 0.8)
      c.fillStyle = 'rgba(255,255,255,0.55)'
      c.fillRect(-s * 0.4, -s * 0.4, s * 0.8, s * 0.25)
    }
    c.restore()
  }
}

const FRAG = `#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_tex;
uniform vec2 u_res;
uniform float u_n;      // segments (even)
uniform float u_spin;   // mandala rotation, radians
uniform float u_churn;  // slow rotation of the sampled patch, radians
uniform vec2 u_b;       // sample point in the source square, 0..1 (y down)
uniform float u_k;      // source-square units per screen px
uniform float u_zoom;
out vec4 outColor;

const float TAU = 6.28318530718;

void main() {
  vec2 p = vec2(v_uv.x - 0.5, 0.5 - v_uv.y) * u_res; // px from centre, y down
  float rho = length(p);
  float wedge = TAU / u_n;
  // fold the plane into one wedge: alternate slots are mirrored so every seam matches
  float a = mod(atan(p.y, p.x) - u_spin, 2.0 * wedge);
  if (a > wedge) a = 2.0 * wedge - a;
  vec2 w = rho * vec2(cos(a), sin(a));          // the point in wedge space
  float cs = cos(-u_churn), sn = sin(-u_churn);
  vec2 q = u_b + vec2(w.x * cs - w.y * sn, w.x * sn + w.y * cs) * u_k; // square coords, 0..1
  q = 0.5 + (q - 0.5) / u_zoom;
  // the square is the source cover-fitted: crop the long side of the frame
  float ar = u_res.x / u_res.y;
  vec2 s = ar > 1.0 ? vec2(0.5 + (q.x - 0.5) / ar, q.y) : vec2(q.x, 0.5 + (q.y - 0.5) * ar);
  outColor = vec4(texture(u_tex, vec2(s.x, 1.0 - s.y)).rgb, 1.0);
}`

const src = createSource({ demo: beadDish })
const gf = createGLFilter({ rt, src, canvas, frag: FRAG })

const WANDER = 0.22 // sample point wander, as a fraction of the mandala radius
let spinPhase = 0
let orbitPhase = 0
let lastNow = 0

function frame(now) {
  rt.tick(now)
  const dt = lastNow ? Math.min(0.05, (now - lastNow) / 1000) : 0.016
  lastNow = now
  spinPhase += params.spin * dt * 2
  orbitPhase += params.orbit * dt

  gf.render({ time: now * 0.001 }, (u) => {
    const W = gf.width, H = gf.height
    const S = Math.hypot(W, H) / 2 // mandala radius (covers the screen corners)
    // the square of source the wedge is cut from must cover wedge length + wander
    const k = 1 / (2 * S * (1.05 + WANDER)) // source-square units per screen px
    const wander = S * WANDER * k
    // steerable sample point, orbiting gently so the mandala churns even untouched
    const bx = 0.5 + (params.srcX - 0.5) * 2 * wander + Math.cos(orbitPhase) * wander * 0.35
    const by = 0.5 + (0.5 - params.srcY) * 2 * wander + Math.sin(orbitPhase * 1.3) * wander * 0.35
    u.f('u_n', Math.max(4, 2 * Math.round(params.segments / 2)))
    u.f('u_spin', spinPhase)
    u.f('u_churn', orbitPhase * 0.5)
    u.v2('u_b', bx, by)
    u.f('u_k', k)
    u.f('u_zoom', params.zoom)
  })
  requestAnimationFrame(frame)
}
requestAnimationFrame(frame)
