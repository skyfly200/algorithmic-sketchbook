// Orbiting Metal — polished metallic solids swinging around a central pivot on
// a tilted ring, each spinning on its own axis. A generated studio environment
// (no external assets) drives the reflections, so the metal reads as chrome,
// gold or coloured alloy depending on the tint. A key light adds a hot specular;
// a beat kicks the orbit speed. Drag to look around.
import { createRuntime } from '../_lib/runtime.js'
import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js'

const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: new URLSearchParams(location.search).get('capture') === '1' })
const rt = createRuntime()
renderer.setPixelRatio(rt.pixelRatio)
renderer.toneMapping = THREE.ACESFilmicToneMapping
renderer.toneMappingExposure = 1.1
document.body.appendChild(renderer.domElement)

const params = rt.params({
  shape: { value: 'Torus Knot', type: 'select', options: ['Torus Knot', 'Sphere', 'Icosahedron', 'Torus', 'Octahedron', 'Capsule'], label: 'Shape' },
  count: { value: 3, min: 1, max: 8, step: 1, label: 'Count' },
  radius: { value: 2.4, min: 0, max: 4, step: 0.05, label: 'Orbit radius' },
  orbit: { value: 0.5, min: -2, max: 2, step: 0.02, label: 'Orbit speed' },
  spin: { value: 1, min: 0, max: 4, step: 0.05, label: 'Spin' },
  metalness: { value: 1, min: 0, max: 1, step: 0.02, label: 'Metalness' },
  roughness: { value: 0.15, min: 0, max: 0.7, step: 0.01, label: 'Polish (roughness)' },
  hue: { value: 40, min: 0, max: 360, step: 1, label: 'Metal tint' },
  sat: { value: 0.15, min: 0, max: 1, step: 0.02, label: 'Tint strength' },
})
rt.mapInput('audio.level', 'spin', 0.5)

const scene = new THREE.Scene()
scene.background = new THREE.Color(0x0a0c12)
const camera = new THREE.PerspectiveCamera(55, 1, 0.1, 100)
camera.position.set(0, 1.6, 7)

const controls = new OrbitControls(camera, renderer.domElement)
controls.enableDamping = true
controls.enablePan = false

// generated studio environment → the reflections the metal shows
const pmrem = new THREE.PMREMGenerator(renderer)
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture

// key + rim lights for a hot specular on top of the environment
const key = new THREE.PointLight(0xffffff, 120)
key.position.set(5, 6, 4)
scene.add(key)
const rim = new THREE.PointLight(0x88aaff, 40)
rim.position.set(-6, -2, -4)
scene.add(rim)
scene.add(new THREE.AmbientLight(0xffffff, 0.15))

const pivot = new THREE.Group()
scene.add(pivot)

const GEO = {
  'Torus Knot': () => new THREE.TorusKnotGeometry(0.6, 0.2, 160, 24),
  Sphere: () => new THREE.SphereGeometry(0.8, 64, 48),
  Icosahedron: () => new THREE.IcosahedronGeometry(0.9, 0),
  Torus: () => new THREE.TorusGeometry(0.6, 0.26, 32, 96),
  Octahedron: () => new THREE.OctahedronGeometry(0.95, 0),
  Capsule: () => new THREE.CapsuleGeometry(0.45, 0.8, 12, 24),
}
let meshes = []
let sig = ''
function build() {
  for (const m of meshes) { pivot.remove(m); m.geometry.dispose(); m.material.dispose() }
  meshes = []
  const n = Math.round(params.count)
  sig = params.shape + n
  const geoFn = GEO[params.shape] || GEO['Torus Knot']
  for (let i = 0; i < n; i++) {
    const mat = new THREE.MeshStandardMaterial({ metalness: params.metalness, roughness: params.roughness })
    const mesh = new THREE.Mesh(geoFn(), mat)
    mesh.userData.phase = (i / n) * Math.PI * 2
    mesh.userData.spinAxis = new THREE.Vector3(rt.random(-1, 1), rt.random(-1, 1), rt.random(-1, 1)).normalize()
    pivot.add(mesh)
    meshes.push(mesh)
  }
}
build()

function resize() {
  renderer.setSize(window.innerWidth, window.innerHeight)
  camera.aspect = window.innerWidth / window.innerHeight
  camera.updateProjectionMatrix()
}

const col = new THREE.Color()
let orbitAngle = 0, lastNow = 0, boost = 0
rt.onBeat(({ energy }) => { boost = Math.min(3, boost + 1 + energy) })

renderer.setAnimationLoop((now) => {
  rt.tick(now)
  const dt = Math.min(0.05, lastNow ? (now - lastNow) / 1000 : 0.016); lastNow = now
  if (params.shape + Math.round(params.count) !== sig) build()
  boost *= 0.92

  orbitAngle += (params.orbit * (1 + boost * 0.5)) * dt
  pivot.rotation.set(0.45, orbitAngle, 0) // tilted orbit ring
  col.setHSL((params.hue % 360) / 360, params.sat, 0.6)
  for (const m of meshes) {
    const a = m.userData.phase
    m.position.set(Math.cos(a) * params.radius, 0, Math.sin(a) * params.radius)
    m.rotateOnAxis(m.userData.spinAxis, params.spin * dt)
    m.material.metalness = params.metalness
    m.material.roughness = params.roughness
    m.material.color.copy(col)
  }
  controls.update()
  renderer.render(scene, camera)
})

window.addEventListener('resize', resize)
resize()
