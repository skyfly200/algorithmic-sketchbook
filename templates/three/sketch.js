// Shared runtime: quality/FPS settings from the viewer + beat detection
// (rt.onBeat / rt.beat.state.pulse).
import { createRuntime } from '../_lib/runtime.js'
import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'

const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: new URLSearchParams(location.search).get('capture') === '1' })
const rt = createRuntime()
renderer.setPixelRatio(rt.pixelRatio)
document.body.appendChild(renderer.domElement)

const scene = new THREE.Scene()
const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 100)
camera.position.set(0, 1.5, 5)

const controls = new OrbitControls(camera, renderer.domElement)
controls.enableDamping = true

// Your scene here — a wireframe icosahedron to start with.
const mesh = new THREE.Mesh(
  new THREE.IcosahedronGeometry(1.5, 1),
  new THREE.MeshStandardMaterial({ color: 0x7c8cff, wireframe: true }),
)
scene.add(mesh)

scene.add(new THREE.AmbientLight(0xffffff, 0.4))
const light = new THREE.PointLight(0xffffff, 60)
light.position.set(4, 5, 4)
scene.add(light)

function resize() {
  renderer.setSize(window.innerWidth, window.innerHeight)
  camera.aspect = window.innerWidth / window.innerHeight
  camera.updateProjectionMatrix()
}

renderer.setAnimationLoop((now) => {
  rt.tick(now)
  mesh.rotation.y = now * 0.0004
  controls.update()
  renderer.render(scene, camera)
})

window.addEventListener('resize', resize)
resize()
