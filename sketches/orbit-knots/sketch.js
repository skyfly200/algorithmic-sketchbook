// Sketches go through Vite, so they can import any npm dependency declared
// in the repo's package.json — here, three.js.
import { createRuntime } from '../_lib/runtime.js'
import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'

const renderer = new THREE.WebGLRenderer({ antialias: true })
const rt = createRuntime()
renderer.setPixelRatio(rt.pixelRatio)
document.body.appendChild(renderer.domElement)

const scene = new THREE.Scene()
scene.fog = new THREE.FogExp2(0x000000, 0.05)

const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 100)
camera.position.set(0, 2, 9)

const controls = new OrbitControls(camera, renderer.domElement)
controls.enableDamping = true
controls.autoRotate = true
controls.autoRotateSpeed = 0.8

const knots = []
const palette = [0x7c8cff, 0x4dd0c4, 0xff7ca8]
for (let i = 0; i < 3; i++) {
  const geometry = new THREE.TorusKnotGeometry(1.6, 0.12, 220, 16, 2 + i, 3)
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
  knots.forEach((knot, i) => {
    knot.rotation.x = t * (0.2 + i * 0.1)
    knot.rotation.y = t * 0.3
  })
  controls.update()
  renderer.render(scene, camera)
})

window.addEventListener('resize', resize)
resize()
