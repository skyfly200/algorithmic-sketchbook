// Infinity Mirror — a regular polytope traced in LED light between two facing
// mirrors: the edge frame repeats down a receding tunnel of copies, each one
// dimmer, slightly smaller, twisted and hue-shifted like a real infinity
// mirror with angled glass. 3D Platonic solids sit still in space; the four-
// dimensional forms also turn through w, so every reflection is a shadow of a
// shape mid-morph. Move the mouse to look into the mirror off-axis — the
// deeper reflections shear away twice as far, just like the real thing.
import { createRuntime } from '../_lib/runtime.js'
import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { polytope, rotateProject } from '../holographic-display/fourd.js'

const renderer = new THREE.WebGLRenderer({
  antialias: true,
  preserveDrawingBuffer: new URLSearchParams(location.search).get('capture') === '1',
})
const rt = createRuntime()
renderer.setPixelRatio(rt.pixelRatio)
document.body.appendChild(renderer.domElement)

const SHAPES = [
  'tetrahedron', 'cube', 'octahedron', 'dodecahedron', 'icosahedron',
  '5-cell', 'tesseract', '16-cell', '24-cell', '600-cell',
]
const FOUR_D = new Set(['5-cell', 'tesseract', '16-cell', '24-cell', '600-cell'])

const params = rt.params({
  shape: { value: rt.pick(['tesseract', 'icosahedron', '24-cell', 'dodecahedron']), type: 'select', options: SHAPES, label: 'Polytope' },
  depth: { value: 20, min: 3, max: 40, step: 1, label: 'Reflections' },
  spacing: { value: 0.85, min: 0.25, max: 2, step: 0.01, label: 'Mirror gap' },
  shrink: { value: 0.94, min: 0.8, max: 1, step: 0.005, label: 'Shrink' },
  twist: { value: rt.random(-0.14, 0.14), min: -0.5, max: 0.5, step: 0.01, label: 'Twist' },
  hue: { value: rt.random(0, 360), min: 0, max: 360, step: 1, label: 'LED hue' },
  hueShift: { value: 12, min: 0, max: 60, step: 1, label: 'Hue shift / copy' },
  glow: { value: 1, min: 0.2, max: 2.5, step: 0.02, label: 'Glow' },
  spin: { value: 0.4, min: 0, max: 2, step: 0.02, label: 'Spin' },
  morph: { value: 0.5, min: 0, max: 2, step: 0.02, label: '4D turn' },
  parallax: { value: 1, min: 0, max: 2.5, step: 0.02, label: 'Parallax' },
})
rt.mapInput('audio.pulse', 'glow', 0.6)
rt.mapInput('audio.low', 'spacing', 0.25)

const scene = new THREE.Scene()
scene.background = new THREE.Color(0x020308)
const camera = new THREE.PerspectiveCamera(55, 1, 0.1, 200)
camera.position.set(0, 0.4, 5.4)

const controls = new OrbitControls(camera, renderer.domElement)
controls.enableDamping = true
controls.target.set(0, 0, -2)
controls.maxDistance = 20

// --- shape sources ----------------------------------------------------------
// Everything becomes { verts: [[x,y,z,w]], edges: [[a,b]] }. Platonic solids
// live at w = 0; the 4-polytopes come from the shared 4D library.
const PHI = (1 + Math.sqrt(5)) / 2
const cyc = (t) => [[t[0], t[1], t[2]], [t[1], t[2], t[0]], [t[2], t[0], t[1]]]
function signs3(t) {
  const out = []
  for (let m = 0; m < 8; m++) {
    const v = [t[0] * (m & 1 ? -1 : 1), t[1] * (m & 2 ? -1 : 1), t[2] * (m & 4 ? -1 : 1)]
    if (!out.some((o) => o[0] === v[0] && o[1] === v[1] && o[2] === v[2])) out.push(v)
  }
  return out
}
function platonic(name) {
  let v3
  switch (name) {
    case 'tetrahedron':
      v3 = [[1, 1, 1], [1, -1, -1], [-1, 1, -1], [-1, -1, 1]]
      break
    case 'cube':
      v3 = signs3([1, 1, 1])
      break
    case 'octahedron':
      v3 = [...signs3([1, 0, 0]), ...signs3([0, 1, 0]), ...signs3([0, 0, 1])]
      break
    case 'icosahedron':
      v3 = cyc([0, 1, PHI]).flatMap(signs3)
      break
    case 'dodecahedron':
      v3 = [...signs3([1, 1, 1]), ...cyc([0, 1 / PHI, PHI]).flatMap(signs3)]
      break
  }
  // normalize to unit radius, lift to 4D at w=0
  const r = Math.hypot(...v3[0])
  return v3.map((p) => [p[0] / r, p[1] / r, p[2] / r, 0])
}
function edgesByNearest(verts) {
  let min = Infinity
  const d2 = (a, b) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2 + (a[3] - b[3]) ** 2
  for (let i = 0; i < verts.length; i++)
    for (let j = i + 1; j < verts.length; j++) min = Math.min(min, d2(verts[i], verts[j]))
  const edges = []
  for (let i = 0; i < verts.length; i++)
    for (let j = i + 1; j < verts.length; j++) if (d2(verts[i], verts[j]) < min * 1.01) edges.push([i, j])
  return edges
}
function shapeData(name) {
  if (FOUR_D.has(name)) {
    const p = polytope(name)
    return { verts: p.verts, edges: p.edges }
  }
  const verts = platonic(name)
  return { verts, edges: edgesByNearest(verts) }
}

// --- LED sprite for the vertices -------------------------------------------
const ledCanvas = document.createElement('canvas')
ledCanvas.width = ledCanvas.height = 64
{
  const c = ledCanvas.getContext('2d')
  const g = c.createRadialGradient(32, 32, 2, 32, 32, 32)
  g.addColorStop(0, 'rgba(255,255,255,1)')
  g.addColorStop(0.25, 'rgba(255,255,255,0.6)')
  g.addColorStop(1, 'rgba(255,255,255,0)')
  c.fillStyle = g
  c.fillRect(0, 0, 64, 64)
}
const ledTex = new THREE.CanvasTexture(ledCanvas)

// --- the tunnel of reflections ---------------------------------------------
// One shared, per-frame-updated geometry; each reflection is its own node so
// it can carry its own transform, tint and opacity.
const MAX_COPIES = 40
let lineGeom = new THREE.BufferGeometry()
let pointGeom = new THREE.BufferGeometry()
let current = null // { verts, edges, name }
let linePos = null
let pointPos = null
const proj = [] // projected 3D verts, reused

const copies = []
for (let i = 0; i < MAX_COPIES; i++) {
  const outer = new THREE.Group() // parallax shear + twist
  const inner = new THREE.Group() // the form's own spin
  const lineMat = new THREE.LineBasicMaterial({
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  })
  const pointMat = new THREE.PointsMaterial({
    map: ledTex,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    sizeAttenuation: true,
  })
  inner.add(new THREE.LineSegments(lineGeom, lineMat), new THREE.Points(pointGeom, pointMat))
  outer.add(inner)
  scene.add(outer)
  copies.push({ outer, inner, lineMat, pointMat })
}

function loadShape(name) {
  current = { ...shapeData(name), name }
  const { verts, edges } = current
  linePos = new Float32Array(edges.length * 6)
  pointPos = new Float32Array(verts.length * 3)
  proj.length = 0
  for (let i = 0; i < verts.length; i++) proj.push([0, 0, 0])
  lineGeom.setAttribute('position', new THREE.BufferAttribute(linePos, 3))
  pointGeom.setAttribute('position', new THREE.BufferAttribute(pointPos, 3))
}
loadShape(params.shape)

// project the (possibly 4D-rotated) form into the shared geometries
function updateGeometry(t) {
  const { verts, edges, name } = current
  const is4d = FOUR_D.has(name)
  const m = params.morph
  const ax = is4d ? t * 0.31 * m : 0
  const ay = is4d ? t * 0.23 * m : 0
  const az = is4d ? t * 0.17 * m : 0
  const SIZE = 1.75 // world radius of the front frame
  for (let i = 0; i < verts.length; i++) {
    rotateProject(verts[i], ax, ay, az, 3.2, proj[i])
    proj[i][0] *= SIZE
    proj[i][1] *= SIZE
    proj[i][2] *= SIZE
  }
  for (let i = 0; i < verts.length; i++) {
    pointPos[i * 3] = proj[i][0]
    pointPos[i * 3 + 1] = proj[i][1]
    pointPos[i * 3 + 2] = proj[i][2]
  }
  for (let e = 0; e < edges.length; e++) {
    const a = proj[edges[e][0]]
    const b = proj[edges[e][1]]
    linePos.set(a, e * 6)
    linePos.set(b, e * 6 + 3)
  }
  lineGeom.attributes.position.needsUpdate = true
  pointGeom.attributes.position.needsUpdate = true
  lineGeom.computeBoundingSphere()
  pointGeom.computeBoundingSphere()
}

// --- interaction ------------------------------------------------------------
// Pointer position = viewing angle into the mirror; reflections shear away
// progressively (each bounce doubles the lateral walk-off).
let mx = 0
let my = 0
window.addEventListener('pointermove', (e) => {
  mx = (e.clientX / window.innerWidth) * 2 - 1
  my = (e.clientY / window.innerHeight) * 2 - 1
})

// beat pulses travel down the tunnel as waves of brightness
const waves = []
rt.onBeat(({ energy }) => {
  waves.push({ t: performance.now() * 0.001, e: 0.6 + energy })
  if (waves.length > 6) waves.shift()
})

renderer.setAnimationLoop((now) => {
  rt.tick(now)
  const t = now * 0.001

  if (params.shape !== current.name) loadShape(params.shape)
  updateGeometry(t)

  const n = Math.round(params.depth)
  const sat = 0.9
  const spinX = t * 0.4 * params.spin
  const spinY = t * 0.57 * params.spin
  for (let i = 0; i < MAX_COPIES; i++) {
    const c = copies[i]
    const on = i < n
    c.outer.visible = on
    if (!on) continue

    const s = Math.pow(params.shrink, i)
    c.outer.position.set(
      mx * i * 0.09 * params.parallax,
      -my * i * 0.055 * params.parallax,
      -i * params.spacing,
    )
    c.outer.scale.setScalar(s)
    c.outer.rotation.z = i * params.twist + t * 0.02
    c.inner.rotation.set(spinX, spinY, 0)

    // brightness: glass absorption per bounce + travelling beat waves
    let bright = Math.pow(0.82, i) * params.glow
    for (const w of waves) {
      const d = i - (t - w.t) * 14 // wavefront speed: copies per second
      bright *= 1 + w.e * 1.6 * Math.exp(-d * d * 0.18)
    }
    const hue = (((params.hue + i * params.hueShift + t * 4) % 360) + 360) / 360
    c.lineMat.color.setHSL(hue, sat, 0.6)
    c.lineMat.opacity = Math.min(1, bright * 1.3)
    c.pointMat.color.setHSL(hue, sat * 0.8, 0.75)
    c.pointMat.opacity = Math.min(1, bright * 1.5)
    c.pointMat.size = 0.17 * s * (0.5 + params.glow * 0.5)
  }

  controls.update()
  renderer.render(scene, camera)
})

function resize() {
  renderer.setSize(window.innerWidth, window.innerHeight)
  camera.aspect = window.innerWidth / window.innerHeight
  camera.updateProjectionMatrix()
}
window.addEventListener('resize', resize)
resize()
