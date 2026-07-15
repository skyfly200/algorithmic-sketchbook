/**
 * Holographic Display — a holographic artifact floating and slowly turning above
 * a glowing pedestal, the way a sci-fi projector table renders one. The object
 * is drawn with a hologram shader: a Fresnel edge glow, travelling scanlines, a
 * flicker, and periodic glitches that jitter the geometry and split it into
 * RGB fringes. A cone of light rises from the pedestal's emitter ring. Additive
 * blending gives it that see-through, self-lit look.
 */
import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js'
import { STLLoader } from 'three/addons/loaders/STLLoader.js'
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js'
import { createRuntime } from '../_lib/runtime.js'

const rt = createRuntime()
const SHAPES = ['icosahedron', 'torus knot', 'dodecahedron', 'crystal', 'sphere']
const params = rt.params({
  shape: { value: rt.pick(SHAPES), type: 'select', options: SHAPES, label: 'Artifact' },
  height: { value: 1.6, min: 0.6, max: 6, step: 0.05, label: 'Height above pedestal' },
  spinX: { value: 0, min: -90, max: 90, step: 1, label: 'Spin X (°/s)' },
  spinY: { value: Math.round(rt.random(15, 35)), min: -90, max: 90, step: 1, label: 'Spin Y (°/s)' },
  spinZ: { value: 0, min: -90, max: 90, step: 1, label: 'Spin Z (°/s)' },
  glimmer: { value: 0.6, min: 0, max: 1.5, step: 0.02, label: 'Glimmer' },
  glitch: { value: 0.4, min: 0, max: 1.5, step: 0.02, label: 'Glitch amount' },
  scan: { value: 1, min: 0, max: 3, step: 0.05, label: 'Scanline density' },
  hue: { value: +rt.random(0.5, 0.62).toFixed(2), min: 0, max: 1, step: 0.01, label: 'Hologram hue' },
  float: { value: 0.5, min: 0, max: 1.5, step: 0.02, label: 'Float bob' },
})
// Music: beats spike the glitch, loudness drives the glimmer.
rt.mapInput('audio.pulse', 'glitch', 0.8)
rt.mapInput('audio.volume', 'glimmer', 0.5)
rt.mapInput('audio.flux', 'glitch', 0.4)

const CAPTURE = new URLSearchParams(location.search).get('capture') === '1'
const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: CAPTURE })
renderer.setPixelRatio(rt.pixelRatio)
document.body.appendChild(renderer.domElement)

const scene = new THREE.Scene()
scene.background = new THREE.Color(0x05070d)
scene.fog = new THREE.FogExp2(0x05070d, 0.11)
const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 100)
camera.position.set(0, 1.6, 6)

const controls = new OrbitControls(camera, renderer.domElement)
controls.enableDamping = true
controls.target.set(0, 1.4, 0)
controls.autoRotate = true
controls.autoRotateSpeed = 0.5

const uniforms = {
  u_time: { value: 0 },
  u_glimmer: { value: params.glimmer },
  u_glitch: { value: 0 },
  u_scan: { value: params.scan },
  u_hue: { value: params.hue },
}

const holoMat = new THREE.ShaderMaterial({
  uniforms,
  transparent: true,
  blending: THREE.AdditiveBlending,
  depthWrite: false,
  side: THREE.DoubleSide,
  vertexShader: `
    uniform float u_time, u_glitch;
    varying vec3 vN; varying vec3 vView; varying float vY;
    float h(float n){ return fract(sin(n*43.1)*4321.9); }
    void main(){
      vN = normalize(normalMatrix * normal);
      vec3 p = position;
      // Glitch: displace horizontal slabs sideways in bursts.
      float slab = floor(p.y * 8.0);
      float g = step(0.7, h(slab + floor(u_time*12.0)));
      p.x += g * u_glitch * 0.25 * (h(slab*1.7) - 0.5);
      vec4 mv = modelViewMatrix * vec4(p, 1.0);
      vView = normalize(-mv.xyz);
      vY = position.y;
      gl_Position = projectionMatrix * mv;
    }`,
  fragmentShader: `
    precision highp float;
    uniform float u_time, u_glimmer, u_glitch, u_scan, u_hue;
    varying vec3 vN; varying vec3 vView; varying float vY;
    vec3 hsl(float hh){ return 0.5 + 0.5*cos(6.2831*(hh + vec3(0.0,0.33,0.67))); }
    float h(float n){ return fract(sin(n*91.3)*1234.5); }
    void main(){
      // Fresnel: brighter at grazing angles → glassy edge glow.
      float fres = pow(1.0 - abs(dot(normalize(vN), normalize(vView))), 2.5);
      vec3 col = hsl(u_hue) * (0.25 + fres * 1.6);
      // Travelling scanlines + a fast flicker.
      float scan = 0.5 + 0.5 * sin((vY * 40.0 * u_scan) - u_time * 6.0);
      float flick = 0.85 + 0.15 * sin(u_time * 40.0 + vY * 5.0);
      col *= (0.55 + 0.6 * scan) * flick;
      // Glimmer sparkles.
      col += hsl(u_hue + 0.1) * u_glimmer * 0.4 * step(0.985, h(floor(vY*90.0) + floor(u_time*20.0)));
      // RGB fringe split during glitches.
      col.r *= 1.0 + u_glitch * 0.6;
      col.b *= 1.0 + u_glitch * 0.4 * sin(u_time*30.0);
      float a = 0.28 + fres * 0.7;
      gl_FragColor = vec4(col, a);
    }`,
})

function makeGeom(shape) {
  switch (shape) {
    case 'torus knot': return new THREE.TorusKnotGeometry(0.75, 0.26, 180, 24)
    case 'dodecahedron': return new THREE.DodecahedronGeometry(1.05, 0)
    case 'crystal': return new THREE.OctahedronGeometry(1.1, 0)
    case 'sphere': return new THREE.SphereGeometry(1.0, 48, 32)
    default: return new THREE.IcosahedronGeometry(1.05, 1)
  }
}
// `artifact` is a group we spin/position; it holds either a built-in shape or
// an uploaded model. `modelLoaded` suppresses the built-in wire twin.
let artifact = new THREE.Group()
scene.add(artifact)
let builtShape = null
let modelLoaded = false

function setArtifactChild(obj) {
  while (artifact.children.length) artifact.remove(artifact.children[0])
  artifact.add(obj)
}
function buildArtifact(shape) {
  const mesh = new THREE.Mesh(makeGeom(shape), holoMat)
  setArtifactChild(mesh)
  builtShape = shape
  modelLoaded = false
  wire.visible = true
}

// Fit an uploaded object into the ~2-unit display volume, centred at the
// artifact origin, and re-skin every mesh with the hologram material.
function adoptModel(obj) {
  obj.traverse((c) => {
    if (c.isMesh) {
      if (c.geometry && !c.geometry.attributes.normal) c.geometry.computeVertexNormals()
      c.material = holoMat
    }
  })
  const box = new THREE.Box3().setFromObject(obj)
  const size = box.getSize(new THREE.Vector3())
  const center = box.getCenter(new THREE.Vector3())
  const s = 2.2 / (Math.max(size.x, size.y, size.z) || 1)
  obj.scale.setScalar(s)
  obj.position.sub(center.multiplyScalar(s)) // recenter on origin
  setArtifactChild(obj)
  modelLoaded = true
  wire.visible = false
}

// A faint wireframe twin adds holographic "lines" (built-in shapes only).
const wire = new THREE.LineSegments(
  new THREE.EdgesGeometry(new THREE.IcosahedronGeometry(1.2, 1)),
  new THREE.LineBasicMaterial({ color: 0x3fd8ff, transparent: true, opacity: 0.25, blending: THREE.AdditiveBlending }),
)
wire.position.y = 1.6
scene.add(wire)

buildArtifact(params.shape)

// --- pedestal: a dark cylinder with a glowing emitter ring + projection cone ---
const pedestal = new THREE.Mesh(
  new THREE.CylinderGeometry(1.1, 1.35, 0.5, 48),
  new THREE.MeshStandardMaterial({ color: 0x0b1018, metalness: 0.7, roughness: 0.4 }),
)
pedestal.position.y = 0.25
scene.add(pedestal)
const ring = new THREE.Mesh(
  new THREE.TorusGeometry(0.95, 0.05, 12, 60),
  new THREE.MeshBasicMaterial({ color: 0x49e0ff }),
)
ring.rotation.x = Math.PI / 2
ring.position.y = 0.52
scene.add(ring)
const cone = new THREE.Mesh(
  new THREE.ConeGeometry(0.95, 1.9, 48, 1, true),
  new THREE.MeshBasicMaterial({ color: 0x2ec8ff, transparent: true, opacity: 0.06, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false }),
)
cone.position.y = 1.5
scene.add(cone)

scene.add(new THREE.AmbientLight(0x223344, 1.2))
const key = new THREE.PointLight(0x66ddff, 30)
key.position.set(2, 4, 3)
scene.add(key)

// --- model upload: .glb/.gltf, .obj, .stl, .fbx ---------------------------
const note = document.getElementById('note')
function loadFile(file) {
  const ext = file.name.split('.').pop().toLowerCase()
  const url = URL.createObjectURL(file)
  const done = (obj) => { adoptModel(obj); URL.revokeObjectURL(url); if (note) note.textContent = file.name }
  const fail = () => { if (note) note.textContent = 'Could not load ' + file.name }
  try {
    if (ext === 'glb' || ext === 'gltf') new GLTFLoader().load(url, (g) => done(g.scene), undefined, fail)
    else if (ext === 'obj') new OBJLoader().load(url, done, undefined, fail)
    else if (ext === 'fbx') new FBXLoader().load(url, done, undefined, fail)
    else if (ext === 'stl') new STLLoader().load(url, (geo) => done(new THREE.Mesh(geo, holoMat)), undefined, fail)
    else fail()
  } catch {
    fail()
  }
}
const fileInput = document.getElementById('file')
document.getElementById('load')?.addEventListener('click', () => fileInput.click())
fileInput?.addEventListener('change', () => { if (fileInput.files[0]) loadFile(fileInput.files[0]) })
// Drag & drop anywhere.
window.addEventListener('dragover', (e) => e.preventDefault())
window.addEventListener('drop', (e) => {
  e.preventDefault()
  if (e.dataTransfer?.files?.[0]) loadFile(e.dataTransfer.files[0])
})

function resize() {
  renderer.setSize(window.innerWidth, window.innerHeight)
  camera.aspect = window.innerWidth / window.innerHeight
  camera.updateProjectionMatrix()
}

const DEG = Math.PI / 180
let lastNow = 0
renderer.setAnimationLoop((now) => {
  rt.tick(now)
  // Built-in shape follows the dropdown (a loaded model overrides it until you
  // pick a shape again).
  if (!modelLoaded && params.shape !== builtShape) buildArtifact(params.shape)
  const t = now * 0.001
  const dt = lastNow ? Math.min(0.05, (now - lastNow) / 1000) : 0.016
  lastNow = now

  uniforms.u_time.value = t
  uniforms.u_glimmer.value = params.glimmer
  uniforms.u_scan.value = params.scan
  uniforms.u_hue.value = params.hue
  // Occasional glitch bursts, plus whatever audio maps in.
  const burst = Math.max(0, Math.sin(t * 1.7) - 0.9) * 8
  uniforms.u_glitch.value = params.glitch * (0.15 + burst) + rt.beat.state.pulse * params.glitch

  const bob = Math.sin(t * 1.5) * 0.12 * params.float
  const y = params.height + bob
  // Free rotation on all three axes (accumulated so any combination works).
  artifact.rotation.x += params.spinX * DEG * dt
  artifact.rotation.y += params.spinY * DEG * dt
  artifact.rotation.z += params.spinZ * DEG * dt
  artifact.position.y = y

  wire.position.y = y
  wire.rotation.copy(artifact.rotation)

  // Keep the projection cone reaching from the emitter ring up to the artifact.
  const base = 0.52
  cone.position.y = (base + y) / 2
  cone.scale.y = Math.max(0.2, (y - base) / 1.9)

  ring.material.color.setHSL(params.hue, 0.9, 0.6)
  ring.scale.setScalar(1 + rt.beat.state.pulse * 0.15)

  // Keep the raised hologram framed (drag still orbits freely around it).
  controls.target.y += (params.height - controls.target.y) * 0.05
  controls.update()
  renderer.render(scene, camera)
})

window.addEventListener('resize', resize)
resize()
