// Ladybug on a Möbius Loop — a ladybug crawls along a Möbius strip (a one-sided
// surface, so a full lap leaves it walking upside-down on the "other" face; two
// laps bring it home) or, optionally, a Toroid. The bug is placed on the centre
// line and oriented by the surface's local frame — tangent forward, surface
// normal up — so it banks and rolls with the twist.
import { createRuntime } from '../_lib/runtime.js'
import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'

const rt = createRuntime()
const params = rt.params({
  track: { value: 'Möbius', type: 'select', options: ['Möbius', 'Toroid'], label: 'Track' },
  speed: { value: 1, min: 0, max: 4, step: 0.05, label: 'Crawl speed' },
  twist: { value: 1, min: 0.3, max: 2, step: 0.05, label: 'Twist / thickness' },
  bugSize: { value: 1, min: 0.4, max: 2, step: 0.05, label: 'Ladybug size' },
  orbit: { value: 0.4, min: 0, max: 2, step: 0.02, label: 'Camera orbit' },
  bodyHue: { value: 2, min: 0, max: 360, step: 1, label: 'Shell hue' },
})
rt.mapInput('audio.pulse', 'speed', 0.5)

const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: new URLSearchParams(location.search).get('capture') === '1' })
renderer.setPixelRatio(rt.pixelRatio)
renderer.setSize(window.innerWidth, window.innerHeight)
renderer.shadowMap.enabled = true
document.body.appendChild(renderer.domElement)

const scene = new THREE.Scene()
scene.background = new THREE.Color(0x0b0e14)
scene.fog = new THREE.Fog(0x0b0e14, 9, 24)
const camera = new THREE.PerspectiveCamera(50, innerWidth / innerHeight, 0.1, 100)
camera.position.set(0, 4, 8)
const controls = new OrbitControls(camera, renderer.domElement)
controls.enableDamping = true
controls.autoRotate = true

scene.add(new THREE.AmbientLight(0x8090b0, 0.6))
const key = new THREE.DirectionalLight(0xfff2e0, 1.5)
key.position.set(5, 8, 6)
scene.add(key)
const rim = new THREE.PointLight(0x5bbcd6, 30, 30)
rim.position.set(-6, -2, -4)
scene.add(rim)

const R = 3 // loop radius
const WID = 0.9 // half-width of the band

// --- parametric surfaces ---------------------------------------------------
// u in [0, 2π) around the loop, s in [-1, 1] across the band.
function surfacePoint(u, s, out) {
  const w = WID * params.twist
  if (params.track === 'Toroid') {
    const r = w
    const cu = Math.cos(u), su = Math.sin(u)
    const cv = Math.cos(s * Math.PI), sv = Math.sin(s * Math.PI)
    out.set((R + r * cv) * cu, r * sv, (R + r * cv) * su)
  } else {
    const v = s * w
    const c2 = Math.cos(u / 2), s2 = Math.sin(u / 2)
    const cu = Math.cos(u), su = Math.sin(u)
    out.set((R + v * c2) * cu, v * s2, (R + v * c2) * su)
  }
  return out
}

// Build the band mesh from the parametric surface.
const USEG = 240, SSEG = 12
let bandGeom = new THREE.BufferGeometry()
const bandMat = new THREE.MeshStandardMaterial({ color: 0x2a3350, roughness: 0.55, metalness: 0.1, side: THREE.DoubleSide })
const band = new THREE.Mesh(bandGeom, bandMat)
scene.add(band)
const _p = new THREE.Vector3()
function rebuildBand() {
  const pos = [], idx = []
  for (let i = 0; i <= USEG; i++) {
    const u = (i / USEG) * Math.PI * 2
    for (let j = 0; j <= SSEG; j++) {
      const s = (j / SSEG) * 2 - 1
      surfacePoint(u, s, _p)
      pos.push(_p.x, _p.y, _p.z)
    }
  }
  const row = SSEG + 1
  for (let i = 0; i < USEG; i++) for (let j = 0; j < SSEG; j++) {
    const a = i * row + j, b = a + row
    idx.push(a, b, a + 1, a + 1, b, b + 1)
  }
  bandGeom.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  bandGeom.setIndex(idx)
  bandGeom.computeVertexNormals()
}
rebuildBand()

// --- the ladybug -----------------------------------------------------------
const bug = new THREE.Group()
scene.add(bug)
const legs = [] // hip pivots, animated in a tripod walking gait
{
  // domed red shell, flat underside (a scaled half-ish sphere)
  const shellMat = new THREE.MeshStandardMaterial({ color: 0xd81f26, roughness: 0.32, metalness: 0.05 })
  const shell = new THREE.Mesh(new THREE.SphereGeometry(0.5, 32, 24, 0, Math.PI * 2, 0, Math.PI * 0.62), shellMat)
  shell.scale.set(1, 0.62, 1.25)
  bug.userData.shellMat = shellMat
  bug.add(shell)
  // elytra split line
  const lineMat = new THREE.MeshStandardMaterial({ color: 0x0a0a0a })
  const split = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.32, 1.2), lineMat)
  split.position.y = 0.02
  bug.add(split)
  // black spots on the dome
  const spotMat = new THREE.MeshStandardMaterial({ color: 0x0a0a0a })
  const spotGeom = new THREE.SphereGeometry(0.09, 12, 8)
  const spots = [[0.22, -0.35], [-0.22, -0.35], [0.28, 0.1], [-0.28, 0.1], [0.16, 0.45], [-0.16, 0.45]]
  for (const [sx, sz] of spots) {
    const sp = new THREE.Mesh(spotGeom, spotMat)
    sp.position.set(sx, 0.28, sz)
    sp.scale.set(1, 0.5, 1)
    bug.add(sp)
  }
  // head
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.26, 20, 16), new THREE.MeshStandardMaterial({ color: 0x111318, roughness: 0.5 }))
  head.scale.set(1, 0.7, 0.8)
  head.position.set(0, 0.06, 0.72)
  bug.add(head)
  // antennae
  const antMat = new THREE.MeshStandardMaterial({ color: 0x111318 })
  for (const dir of [-1, 1]) {
    const ant = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.28, 6), antMat)
    ant.position.set(dir * 0.1, 0.16, 0.92); ant.rotation.set(0.5, 0, dir * 0.3)
    bug.add(ant)
  }
  // legs — each hangs from a hip pivot so it can swing fore/aft and lift in a
  // walking gait. Alternate legs get opposite phase → an insect tripod stride.
  const legMat = new THREE.MeshStandardMaterial({ color: 0x0a0a0a })
  let li = 0
  for (const dir of [-1, 1]) for (const lz of [-0.3, 0, 0.35]) {
    const pivot = new THREE.Group()
    pivot.position.set(dir * 0.3, -0.04, lz)
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.42, 6), legMat)
    leg.position.set(dir * 0.18, -0.15, 0); leg.rotation.z = dir * 1.1
    pivot.add(leg)
    bug.add(pivot)
    legs.push({ pivot, dir, phase: (li % 2) * Math.PI, restZ: dir * 1.1 })
    li++
  }
}
// Animate the tripod gait: rotate each hip pivot fore/aft (cos) and lift the
// foot on the recovery half-stroke (max(0, sin)). Stride advances with speed,
// so the legs march faster when the bug crawls faster and freeze when it stops.
let walk = 0
function stepLegs() {
  for (const L of legs) {
    const p = walk + L.phase
    L.pivot.rotation.y = Math.cos(p) * 0.5
    L.pivot.rotation.x = -Math.max(0, Math.sin(p)) * 0.5
  }
}

// Orient the bug on the surface at parameter u using a finite-difference frame:
// forward = ∂P/∂u (direction of travel), up = surface normal = ∂P/∂u × ∂P/∂s.
const pA = new THREE.Vector3(), pB = new THREE.Vector3(), pS0 = new THREE.Vector3(), pS1 = new THREE.Vector3()
const fwd = new THREE.Vector3(), across = new THREE.Vector3(), up = new THREE.Vector3(), right = new THREE.Vector3()
const m = new THREE.Matrix4()
function placeBug(u) {
  const du = 0.01, ds = 0.02
  surfacePoint(u - du, 0, pA)
  surfacePoint(u + du, 0, pB)
  surfacePoint(u, -ds, pS0)
  surfacePoint(u, ds, pS1)
  fwd.subVectors(pB, pA).normalize()
  across.subVectors(pS1, pS0)
  up.crossVectors(fwd, across).normalize()
  right.crossVectors(up, fwd).normalize()
  m.makeBasis(right, up, fwd)
  bug.quaternion.setFromRotationMatrix(m)
  surfacePoint(u, 0, _p)
  const lift = (0.18 + Math.sin(walk * 2) * 0.012) * params.bugSize // gait body bob
  bug.position.copy(_p).addScaledVector(up, lift)
  bug.scale.setScalar(params.bugSize)
}

let u = 0, lastTrack = 'Möbius', lastTwist = 1
function frame(now) {
  rt.tick(now)
  if (params.track !== lastTrack || params.twist !== lastTwist) { lastTrack = params.track; lastTwist = params.twist; rebuildBand() }
  u = (u + params.speed * 0.006) % (Math.PI * 4) // 4π so the Möbius return reads
  walk += params.speed * 0.16 // stride keeps pace with travel; freezes at speed 0
  placeBug(u)
  stepLegs()
  bug.userData.shellMat.color.setHSL(((params.bodyHue % 360) / 360), 0.8, 0.42)
  controls.autoRotateSpeed = params.orbit
  controls.update()
  renderer.render(scene, camera)
}

function resize() {
  renderer.setSize(window.innerWidth, window.innerHeight)
  camera.aspect = window.innerWidth / window.innerHeight
  camera.updateProjectionMatrix()
}
window.addEventListener('resize', resize)
resize()
renderer.setAnimationLoop(frame)
