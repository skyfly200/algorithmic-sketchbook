/**
 * 4D Space — a viewer drifting through a field of four-dimensional polytopes
 * (5-cells, tesseracts, 16-cells, 24-cells) scattered across a hypercubic
 * volume. Every vertex lives in R⁴; each frame the whole space is rotated
 * through the three extra-dimensional planes (XW / YW / ZW — by default the
 * mouse steers XW and YW, so moving the cursor turns the universe through the
 * fourth dimension), then perspective-projected 4D→3D by dividing by
 * w-distance, and finally rendered by a normal 3D camera you can orbit.
 *
 * Depth in w is visible as everything a shadow can't show: objects far in w
 * shrink, dim, and shift hue, and they swell back as the rotation carries
 * them toward our 3-slice — the signature inside-out turning of 4D rotation.
 */
import { createRuntime } from '../_lib/runtime.js'
import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { polytope } from '../holographic-display/fourd.js'

const renderer = new THREE.WebGLRenderer({
  antialias: true,
  preserveDrawingBuffer: new URLSearchParams(location.search).get('capture') === '1',
})
const rt = createRuntime()
renderer.setPixelRatio(rt.pixelRatio)
document.body.appendChild(renderer.domElement)

const params = rt.params({
  rotXW: { value: 0.5, min: 0, max: 1, step: 0.005, label: 'XW turn' },
  rotYW: { value: 0.5, min: 0, max: 1, step: 0.005, label: 'YW turn' },
  rotZW: { value: 0.5, min: 0, max: 1, step: 0.005, label: 'ZW turn' },
  spin: { value: +rt.random(0.15, 0.5).toFixed(2), min: 0, max: 1.5, step: 0.05, label: 'Auto 4D spin' },
  wPersp: { value: 0.6, min: 0.1, max: 1, step: 0.02, label: 'W perspective' },
  count: { value: Math.round(rt.random(14, 24)), min: 4, max: 40, step: 1, label: 'Objects' },
  size: { value: 1.0, min: 0.4, max: 2, step: 0.05, label: 'Object size' },
  hue: { value: +rt.rng().toFixed(2), min: 0, max: 1, step: 0.01, label: 'Hue' },
  nodes: { value: true, type: 'bool', label: 'Vertex nodes' },
  grid: { value: true, type: 'bool', label: 'Reference floor' },
})
// The signature control: the mouse turns the universe through the 4th
// dimension; beats give the auto-spin a shove.
rt.mapInput('mouse.x', 'rotXW', 0.5)
rt.mapInput('mouse.y', 'rotYW', 0.5)
rt.mapInput('audio.pulse', 'spin', 0.4)

const scene = new THREE.Scene()
scene.background = new THREE.Color(0x04050a)
scene.fog = new THREE.FogExp2(0x04050a, 0.06)
const camera = new THREE.PerspectiveCamera(62, 1, 0.1, 200)
camera.position.set(0, 2.2, 9)

const controls = new OrbitControls(camera, renderer.domElement)
controls.enableDamping = true
controls.autoRotate = true
controls.autoRotateSpeed = 0.4

// --- the 4D scene -----------------------------------------------------------
const KINDS = ['5-cell', 'tesseract', '16-cell', '24-cell']
const MAXN = 40
// Each object: a polytope kind, a 4D position, per-object double-rotation
// phases (every 4D object spins in two independent planes at once), and a hue
// offset. Seeded, so 🎲 lays out a different pocket of hyperspace.
const objs = []
{
  const R = 7 // scatter radius in x/z; shallower in y and w
  for (let i = 0; i < MAXN; i++) {
    objs.push({
      geo: polytope(rt.pick(KINDS)),
      pos: [rt.random(-R, R), rt.random(-R * 0.5, R * 0.5), rt.random(-R, R), rt.random(-2.4, 2.4)],
      phase1: rt.random(0, Math.PI * 2),
      phase2: rt.random(0, Math.PI * 2),
      rate1: rt.random(0.2, 0.7),
      rate2: rt.random(0.15, 0.55),
      scale: rt.random(0.55, 1.15),
      dh: rt.random(-0.12, 0.12),
    })
  }
}

// Merged buffers, rewritten each frame: one for all edges, one for all nodes.
let EDGE_VERTS = 0
let NODE_VERTS = 0
for (const o of objs) {
  EDGE_VERTS += o.geo.edges.length * 2
  NODE_VERTS += o.geo.verts.length
}

const edgeGeo = new THREE.BufferGeometry()
edgeGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(EDGE_VERTS * 3), 3))
edgeGeo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(EDGE_VERTS * 3), 3))
const edgeLines = new THREE.LineSegments(
  edgeGeo,
  new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }),
)
edgeLines.frustumCulled = false
scene.add(edgeLines)

function nodeSprite() {
  const c = document.createElement('canvas')
  c.width = c.height = 64
  const g = c.getContext('2d')
  const rad = g.createRadialGradient(32, 32, 0, 32, 32, 32)
  rad.addColorStop(0, 'rgba(255,255,255,1)')
  rad.addColorStop(0.4, 'rgba(255,255,255,0.5)')
  rad.addColorStop(1, 'rgba(255,255,255,0)')
  g.fillStyle = rad
  g.fillRect(0, 0, 64, 64)
  return new THREE.CanvasTexture(c)
}
const nodeGeo = new THREE.BufferGeometry()
nodeGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(NODE_VERTS * 3), 3))
nodeGeo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(NODE_VERTS * 3), 3))
const nodePoints = new THREE.Points(
  nodeGeo,
  new THREE.PointsMaterial({
    vertexColors: true, size: 0.14, map: nodeSprite(), transparent: true,
    blending: THREE.AdditiveBlending, depthWrite: false, sizeAttenuation: true,
  }),
)
nodePoints.frustumCulled = false
scene.add(nodePoints)

// A faint reference grid on y = -3 — a floor that stays in our 3-slice, so
// the 4D turning of everything above it is legible.
const grid = new THREE.GridHelper(30, 30, 0x2a3550, 0x141a2c)
grid.position.y = -3
scene.add(grid)

// --- 4D math ----------------------------------------------------------------
// Rotate [x,y,z,w] in the (i, j) plane by angle a, in place.
function rot(v, i, j, a) {
  const c = Math.cos(a)
  const s = Math.sin(a)
  const vi = v[i]
  const vj = v[j]
  v[i] = vi * c - vj * s
  v[j] = vi * s + vj * c
}

function hslCol(h, s, l) {
  const k = (n) => (n + h * 12) % 12
  const a = s * Math.min(l, 1 - l)
  const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)))
  return [f(0), f(8), f(4)]
}

const tmp = [0, 0, 0, 0]
let spinPhase = 0
let lastNow = 0

function updateSpace(now) {
  const dt = lastNow ? Math.min(0.05, (now - lastNow) / 1000) : 0.016
  lastNow = now
  spinPhase += params.spin * dt

  // Global extra-dimensional turn: params (mouse-driven by default) set the
  // XW / YW / ZW angles; the auto-spin adds a slow double rotation on top.
  const axw = (params.rotXW - 0.5) * Math.PI * 2 + spinPhase * 0.7
  const ayw = (params.rotYW - 0.5) * Math.PI * 2 + spinPhase * 0.45
  const azw = (params.rotZW - 0.5) * Math.PI * 2

  const persp = 3.2 / params.wPersp // the w-camera distance: lower = wilder
  const n = Math.min(MAXN, Math.round(params.count))
  const t = now * 0.001

  const ePos = edgeGeo.attributes.position.array
  const eCol = edgeGeo.attributes.color.array
  const nPos = nodeGeo.attributes.position.array
  const nCol = nodeGeo.attributes.color.array
  let ep = 0
  let np = 0

  for (let oi = 0; oi < n; oi++) {
    const o = objs[oi]
    const { verts, edges } = o.geo
    const a1 = o.phase1 + t * o.rate1
    const a2 = o.phase2 + t * o.rate2

    // Project every vertex of this object once.
    const proj = []
    const glow = []
    for (const v of verts) {
      tmp[0] = v[0] * o.scale * params.size
      tmp[1] = v[1] * o.scale * params.size
      tmp[2] = v[2] * o.scale * params.size
      tmp[3] = v[3] * o.scale * params.size
      // The object's own double rotation (two independent planes at once —
      // the generic rigid rotation in four dimensions).
      rot(tmp, 0, 3, a1)
      rot(tmp, 1, 2, a2)
      // Place it in the world, then turn all of space through w.
      tmp[0] += o.pos[0]
      tmp[1] += o.pos[1]
      tmp[2] += o.pos[2]
      tmp[3] += o.pos[3]
      rot(tmp, 0, 3, axw)
      rot(tmp, 1, 3, ayw)
      rot(tmp, 2, 3, azw)
      // 4D → 3D perspective: divide by distance along w.
      const f = persp / (persp + tmp[3] + 3.4)
      proj.push([tmp[0] * f * 1.6, tmp[1] * f * 1.6, tmp[2] * f * 1.6])
      glow.push(Math.max(0.05, Math.min(1.25, f * 1.15)))
    }

    for (const [i, j] of edges) {
      const gi = (glow[i] + glow[j]) / 2
      const [r, g, b] = hslCol(params.hue + o.dh + gi * 0.1, 0.85, 0.3 + gi * 0.32)
      ePos[ep] = proj[i][0]; ePos[ep + 1] = proj[i][1]; ePos[ep + 2] = proj[i][2]
      eCol[ep] = r * gi; eCol[ep + 1] = g * gi; eCol[ep + 2] = b * gi
      ep += 3
      ePos[ep] = proj[j][0]; ePos[ep + 1] = proj[j][1]; ePos[ep + 2] = proj[j][2]
      eCol[ep] = r * gi; eCol[ep + 1] = g * gi; eCol[ep + 2] = b * gi
      ep += 3
    }
    if (params.nodes) {
      for (let i = 0; i < proj.length; i++) {
        const [r, g, b] = hslCol(params.hue + o.dh + 0.08, 0.9, 0.75)
        nPos[np] = proj[i][0]; nPos[np + 1] = proj[i][1]; nPos[np + 2] = proj[i][2]
        nCol[np] = r * glow[i]; nCol[np + 1] = g * glow[i]; nCol[np + 2] = b * glow[i]
        np += 3
      }
    }
  }
  // Park unused buffer space at the origin, black (invisible under additive).
  for (let k = ep; k < ePos.length; k++) { ePos[k] = 0; eCol[k] = 0 }
  for (let k = np; k < nPos.length; k++) { nPos[k] = 0; nCol[k] = 0 }
  edgeGeo.attributes.position.needsUpdate = true
  edgeGeo.attributes.color.needsUpdate = true
  nodeGeo.attributes.position.needsUpdate = true
  nodeGeo.attributes.color.needsUpdate = true
  nodePoints.visible = params.nodes
  grid.visible = params.grid
}

function resize() {
  renderer.setSize(window.innerWidth, window.innerHeight)
  camera.aspect = window.innerWidth / window.innerHeight
  camera.updateProjectionMatrix()
}

renderer.setAnimationLoop((now) => {
  rt.tick(now)
  updateSpace(now)
  controls.update()
  renderer.render(scene, camera)
})

window.addEventListener('resize', resize)
resize()
