// Gaudí Intersected Column — Gaudí generated columns by sweeping two fluted
// star profiles up a shaft, twisting each the opposite way, then keeping the
// intersection of the pair (the radial minimum of the two). Where the twists
// cross, the flutes fold into the branching, load-following forms of the
// Sagrada Família. Both profiles are live, so the column morphs as you tune
// point counts, groove depth and twist.
import { createRuntime } from '../_lib/runtime.js'
import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'

const rt = createRuntime()
const renderer = new THREE.WebGLRenderer({
  antialias: true,
  powerPreference: 'high-performance',
  preserveDrawingBuffer: new URLSearchParams(location.search).get('capture') === '1',
})
renderer.setPixelRatio(rt.pixelRatio)
renderer.setSize(window.innerWidth, window.innerHeight)
document.body.appendChild(renderer.domElement)

const scene = new THREE.Scene()
scene.background = new THREE.Color(0x121417)

const camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 100)
camera.position.set(0, 2.5, 8)

const controls = new OrbitControls(camera, renderer.domElement)
controls.enableDamping = true
controls.target.set(0, 2.5, 0)

// --- Lighting ---
scene.add(new THREE.AmbientLight(0xffffff, 0.6))

const mainLight = new THREE.DirectionalLight(0xffebd6, 1.8)
mainLight.position.set(5, 8, 5)
scene.add(mainLight)

const fillLight = new THREE.DirectionalLight(0x7090bf, 0.7)
fillLight.position.set(-5, 2, -5)
scene.add(fillLight)

const grid = new THREE.GridHelper(10, 10, 0x444444, 0x222222)
scene.add(grid)

// --- Shared material ---
const stoneMaterial = new THREE.MeshStandardMaterial({
  color: 0xdfd3be,
  roughness: 0.35,
  metalness: 0.05,
  side: THREE.DoubleSide,
})

let columnMesh = null

// --- Runtime parameters ---
const params = rt.params({
  height: { value: 5.0, min: 2.0, max: 10.0, step: 0.1, label: 'Height' },
  baseRadius: { value: 1.0, min: 0.4, max: 2.5, step: 0.05, label: 'Base radius' },

  // profile A
  flutesA: { value: 8, min: 3, max: 20, step: 1, label: 'Points (A)' },
  depthA: { value: 0.25, min: 0.0, max: 0.6, step: 0.01, label: 'Depth (A)' },
  twistA: { value: 90, min: -360, max: 360, step: 5, label: 'Twist deg (A)' },

  // profile B
  flutesB: { value: 8, min: 3, max: 20, step: 1, label: 'Points (B)' },
  depthB: { value: 0.25, min: 0.0, max: 0.6, step: 0.01, label: 'Depth (B)' },
  twistB: { value: -90, min: -360, max: 360, step: 5, label: 'Twist deg (B)' },

  rotationSpeed: { value: 0.2, min: 0.0, max: 2.0, step: 0.05, label: 'Turntable speed' },
})

// audio pushes the grooves open on each beat
rt.mapInput('audio.pulse', 'depthA', 0.15)
rt.mapInput('audio.pulse', 'depthB', 0.15)

// --- Geometry evaluator ---
function positiveMod(n, m) {
  return ((n % m) + m) % m
}

// a fluted star: base radius plus a cosine ripple of `flutes` lobes
function calculateRadius(angle, flutes, baseR, depth) {
  const normAngle = positiveMod(angle, Math.PI * 2)
  return baseR + Math.cos(normAngle * flutes) * depth
}

function buildGeometry() {
  // scale vertex density by the runtime detail level
  const baseRadialStep = Math.max(params.flutesA, params.flutesB, 8)
  const radialSegments = Math.floor(Math.max(baseRadialStep * 24 * rt.detail, 32))
  const heightSegments = Math.floor(120 * rt.detail)

  const twistRadA = (params.twistA * Math.PI) / 180
  const twistRadB = (params.twistB * Math.PI) / 180

  const vertices = []
  const uvs = []

  for (let yStep = 0; yStep <= heightSegments; yStep++) {
    const v = yStep / heightSegments
    const y = v * params.height

    const currentTwistA = v * twistRadA
    const currentTwistB = v * twistRadB

    for (let rStep = 0; rStep <= radialSegments; rStep++) {
      const u = rStep / radialSegments
      const baseAngle = u * Math.PI * 2

      const rA = calculateRadius(baseAngle - currentTwistA, params.flutesA, params.baseRadius, params.depthA)
      const rB = calculateRadius(baseAngle + currentTwistB, params.flutesB, params.baseRadius, params.depthB)

      // Gaudí intersection = radial minimum boundary of the two profiles
      const finalRadius = Math.min(rA, rB)

      const x = Math.cos(baseAngle) * finalRadius
      const z = Math.sin(baseAngle) * finalRadius

      vertices.push(x, y, z)
      uvs.push(u, v)
    }
  }

  const indices = []
  const stride = radialSegments + 1
  for (let yStep = 0; yStep < heightSegments; yStep++) {
    for (let rStep = 0; rStep < radialSegments; rStep++) {
      const a = yStep * stride + rStep
      const b = a + 1
      const c = (yStep + 1) * stride + rStep
      const d = c + 1
      indices.push(a, b, d)
      indices.push(a, d, c)
    }
  }

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3))
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2))
  geometry.setIndex(indices)
  geometry.computeVertexNormals()
  return geometry
}

function updateMesh() {
  if (columnMesh) {
    scene.remove(columnMesh)
    columnMesh.geometry.dispose()
  }
  columnMesh = new THREE.Mesh(buildGeometry(), stoneMaterial)
  scene.add(columnMesh)
  controls.target.set(0, params.height / 2, 0)
}

updateMesh()

function resize() {
  renderer.setPixelRatio(rt.pixelRatio)
  renderer.setSize(window.innerWidth, window.innerHeight)
  camera.aspect = window.innerWidth / window.innerHeight
  camera.updateProjectionMatrix()
  updateMesh()
}
window.addEventListener('resize', resize)

// --- Render loop ---
let lastParamsKey = ''
renderer.setAnimationLoop((now) => {
  rt.tick(now)

  // rebuild geometry only when a shape-defining value changes
  const currentKey = `${params.height}_${params.baseRadius}_${params.flutesA}_${params.depthA}_${params.twistA}_${params.flutesB}_${params.depthB}_${params.twistB}_${rt.detail}`
  if (currentKey !== lastParamsKey) {
    updateMesh()
    lastParamsKey = currentKey
  }

  if (columnMesh && params.rotationSpeed > 0) {
    columnMesh.rotation.y += 0.01 * params.rotationSpeed
  }

  controls.update()
  renderer.render(scene, camera)
})
