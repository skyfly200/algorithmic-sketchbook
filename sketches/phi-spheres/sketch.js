/**
 * Phi Spheres — a phyllotaxis spiral: sphere i sits at angle φ·i·π and radius
 * s·i, exactly how seed heads and sunflowers pack. Three modes animate it:
 *   - Animate In/Out : grow the spiral outward one sphere at a time, then back
 *   - Wave           : a radial sine wave ripples the spiral along z
 *   - Random Displacement : each sphere shivers along z by its own random amount
 */
import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { createRuntime } from '../_lib/runtime.js'

const rt = createRuntime()
rt.onBeat(() => {}) // mounts the mic toggle so it can pulse to sound

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
  rt.tick(performance.now())

  if (mode !== 'Animate In/Out') frameCount++

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
    for (const sp of spheres) {
      sp.position.z = Math.sin(sp.userData.radius * 1.4 - frameCount * 0.06) * 1.3
    }
  } else if (mode === 'Random Displacement') {
    for (const sp of spheres) {
      sp.position.z = sp.userData.rand * Math.sin(frameCount * 0.05) * 2.4
    }
  }

  // Beat pulse: gently scale the whole spiral.
  const pulse = 1 + rt.beat.state.pulse * 0.12
  group.scale.setScalar(pulse)

  controls.update()
  renderer.render(scene, camera)
})

window.addEventListener('resize', resize)
resize()
