// Sketches go through Vite, so they can import any npm dependency declared
// in the repo's package.json — here, three.js.
import { createRuntime } from '../_lib/runtime.js'
import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'

const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: new URLSearchParams(location.search).get('capture') === '1' })
const rt = createRuntime()
renderer.setPixelRatio(rt.pixelRatio)
document.body.appendChild(renderer.domElement)

// Retrofit: spin/orbit/glow are live params with a beat pulse that pops the
// knots, and the (p, q) winding of each knot is seeded so every load (and the
// viewer's 🎲) grows a different trio.
const params = rt.params({
  spin: { value: +rt.random(0.2, 0.6).toFixed(2), min: 0, max: 2, step: 0.01, label: 'Knot spin' },
  orbit: { value: 0.8, min: 0, max: 4, step: 0.05, label: 'Camera orbit' },
  glow: { value: 0.35, min: 0, max: 1.2, step: 0.01, label: 'Glow' },
  pulse: { value: 0, min: 0, max: 1, step: 0.01, label: 'Beat pulse (scale)' },
})
// Music: beats pop the knots, loudness spins the camera.
rt.mapInput('audio.pulse', 'pulse', 0.6)
rt.mapInput('audio.volume', 'orbit', 0.7)

const scene = new THREE.Scene()
scene.fog = new THREE.FogExp2(0x000000, 0.05)

const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 100)
camera.position.set(0, 2, 9)

const controls = new OrbitControls(camera, renderer.domElement)
controls.enableDamping = true
controls.autoRotate = true

const knots = []
const palette = [0x7c8cff, 0x4dd0c4, 0xff7ca8]
for (let i = 0; i < 3; i++) {
  // Seeded torus-knot winding: p/q coprime-ish pairs picked per load.
  const p = 2 + Math.floor(rt.rng() * 4) // 2..5
  const q = 3 + Math.floor(rt.rng() * 4) // 3..6
  const geometry = new THREE.TorusKnotGeometry(1.6, 0.12, 220, 16, p, q)
  const material = new THREE.MeshStandardMaterial({
    color: palette[i],
    emissive: palette[i],
    emissiveIntensity: 0.35,
    metalness: 0.6,
    roughness: 0.3,
  })
  const knot = new THREE.Mesh(geometry, material)
  knot.position.x = (i - 1) * 4
  scene.add(knot)
  knots.push(knot)
}

scene.add(new THREE.AmbientLight(0xffffff, 0.25))
const key = new THREE.PointLight(0xffffff, 120)
key.position.set(4, 6, 6)
scene.add(key)

function resize() {
  renderer.setSize(window.innerWidth, window.innerHeight)
  camera.aspect = window.innerWidth / window.innerHeight
  camera.updateProjectionMatrix()
}

renderer.setAnimationLoop((now) => {
  rt.tick(now)
  const t = now * 0.001
  const scale = 1 + params.pulse * 0.35
  knots.forEach((knot, i) => {
    knot.rotation.x = t * params.spin * (0.7 + i * 0.3)
    knot.rotation.y = t * params.spin
    knot.scale.setScalar(scale)
    knot.material.emissiveIntensity = params.glow
  })
  controls.autoRotateSpeed = params.orbit
  controls.update()
  renderer.render(scene, camera)
})

window.addEventListener('resize', resize)
resize()
