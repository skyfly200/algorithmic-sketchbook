/**
 * Phi Spheres — a phyllotaxis spiral: sphere i sits at angle φ·i·π and radius
 * s·i, exactly how seed heads and sunflowers pack. Three modes animate it:
 *   - Animate In/Out : grow the spiral outward one sphere at a time, then back
 *   - Wave           : a radial sine wave ripples the spiral along z
 *   - Random Displacement : each sphere shivers along z by its own random amount
 *
 * Every animation driver is a runtime param, so the music (beat.pulse /
 * beat.level) can be mapped onto any of them from the controls panel and saved
 * in scenes. Default mappings make it react to sound out of the box.
 */
import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { createRuntime } from '../_lib/runtime.js'

const rt = createRuntime()
const params = rt.params({
  pulse: { value: 0, min: 0, max: 1, step: 0.01, label: 'Pulse (scale)' },
  waveAmp: { value: 0.6, min: 0, max: 3, step: 0.05, label: 'Wave amplitude' },
  waveSpeed: { value: 1, min: 0, max: 4, step: 0.05, label: 'Wave speed' },
  scatter: { value: 1.2, min: 0, max: 4, step: 0.05, label: 'Scatter amount' },
  spin: { value: 0.15, min: 0, max: 2, step: 0.01, label: 'Auto-spin (in-plane)' },
  orbit: { value: 0.6, min: 0, max: 6, step: 0.05, label: 'Camera orbit speed' },
  sphereSize: { value: 1, min: 0.4, max: 2, step: 0.05, label: 'Sphere size' },
})
// Default music → animation mappings (remix or add more in the controls panel).
// These also mount the mic toggle so the piece reacts to sound.
rt.mapInput('audio.pulse', 'pulse', 0.7) // beats pop the whole spiral
rt.mapInput('audio.level', 'waveAmp', 0.9) // bass swells the wave
rt.mapInput('audio.high', 'scatter', 0.8) // highs shiver the scatter
rt.mapInput('audio.volume', 'orbit', 0.7) // loudness spins the camera orbit

const scene = new THREE.Scene()
const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000)
camera.position.z = 5

const renderer = new THREE.WebGLRenderer({ antialias: true })
renderer.setPixelRatio(rt.pixelRatio)
renderer.setSize(window.innerWidth, window.innerHeight)
renderer.shadowMap.enabled = true
renderer.shadowMap.type = THREE.PCFSoftShadowMap
document.body.appendChild(renderer.domElement)

// Golden-ratio spiral constants (from the original).
const phi = 1.618033988749894848204586834
const pi = Math.PI
const n = 120
const s = 0.11
const r = 0.5
const q = 75
const o = 0.145

let mode = 'Animate In/Out'
let frameCount = 0
let growing = true

const group = new THREE.Group() // scaled as one for the beat pulse
scene.add(group)
const spheres = []

function addSphere() {
  const i = spheres.length + 1
  const a = phi * i * pi - o
  const x = s * i * Math.cos(a)
  const y = s * i * Math.sin(a)
  const size = r + i / q

  const geometry = new THREE.SphereGeometry(size, 36, 36)
  const material = new THREE.MeshStandardMaterial({ color: 0x800080, roughness: 0.5, metalness: 0.1 })
  const sphere = new THREE.Mesh(geometry, material)
  sphere.position.set(x, y, 0)
  sphere.castShadow = true
  sphere.receiveShadow = true
  sphere.userData = { baseX: x, baseY: y, radius: Math.hypot(x, y), rand: Math.random() * 2 - 1 }

  group.add(sphere)
  spheres.push(sphere)
}

function removeSphere() {
  const sphere = spheres.pop()
  if (sphere) group.remove(sphere)
}

function ensureFull() {
  while (spheres.length < n) addSphere()
}

function resetInOut() {
  while (spheres.length) removeSphere()
  frameCount = 0
  growing = true
}

// Lights
const light = new THREE.DirectionalLight(0xffffff, 1)
light.position.set(0, 1, 1).normalize()
light.castShadow = true
scene.add(light)
scene.add(new THREE.AmbientLight(0xffffff, 0.2))

// Controls
const controls = new OrbitControls(camera, renderer.domElement)
controls.enableDamping = true
controls.dampingFactor = 0.05
controls.rotateSpeed = 0.5
// Auto-orbit the camera; its speed is the `orbit` param, so the music can be
// mapped onto it (beat.volume by default). Dragging still works and blends in.
controls.autoRotate = true

// Mode buttons
const modesEl = document.getElementById('modes')
const buttons = {}
function setMode(next) {
  mode = next
  for (const key in buttons) buttons[key].classList.toggle('active', key === next)
  if (next === 'Animate In/Out') resetInOut()
  else ensureFull()
  if (next !== 'Animate In/Out') frameCount = 0
}
for (const label of ['Animate In/Out', 'Wave', 'Random Displacement']) {
  const btn = document.createElement('button')
  btn.textContent = label
  btn.onclick = () => setMode(label)
  buttons[label] = btn
  modesEl.appendChild(btn)
}
buttons['Animate In/Out'].classList.add('active')

function resize() {
  renderer.setSize(window.innerWidth, window.innerHeight)
  camera.aspect = window.innerWidth / window.innerHeight
  camera.updateProjectionMatrix()
}

renderer.setAnimationLoop(() => {
  // rt.tick() folds live input (beat/mouse/time) into the params below, so
  // reading params.waveAmp etc. already includes any mapped music reactivity.
  rt.tick(performance.now())

  if (mode !== 'Animate In/Out') frameCount += params.waveSpeed

  if (mode === 'Animate In/Out') {
    // Grow the spiral outward, then unwind it — one sphere per frame.
    if (growing) {
      addSphere()
      if (spheres.length >= n) growing = false
    } else {
      removeSphere()
      if (spheres.length <= 0) growing = true
    }
  } else if (mode === 'Wave') {
    // Radial wave whose amplitude/speed are params — map beat.level onto them.
    for (const sp of spheres) {
      sp.position.z = Math.sin(sp.userData.radius * 1.4 - frameCount * 0.06) * params.waveAmp
    }
  } else if (mode === 'Random Displacement') {
    for (const sp of spheres) {
      sp.position.z = sp.userData.rand * Math.sin(frameCount * 0.05) * params.scatter
    }
  }

  // Auto-spin, camera orbit, and the overall pulse/size apply in every mode,
  // so music mapped to `pulse`/`orbit` reacts even during Animate In/Out.
  group.rotation.z += params.spin * 0.008
  group.scale.setScalar(params.sphereSize * (1 + params.pulse * 0.5))
  controls.autoRotateSpeed = params.orbit

  controls.update()
  renderer.render(scene, camera)
})

window.addEventListener('resize', resize)
resize()
