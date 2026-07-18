/**
 * Disco Ball — a mirrored ball built the way real ones are: rows of little
 * square mirror tiles laid over a sphere (an InstancedMesh, one instance per
 * facet, each tilted a hair off-true so the ball sparkles instead of reading
 * as a smooth sphere). Coloured lights orbit the room; every facet that
 * catches one throws a spot onto the surrounding walls — the spots are real
 * reflections, computed from the facet normals as the ball turns, so the dot
 * field wheels around the room exactly like the real thing.
 *
 * Beats flash a scatter of facets and pump the beams. Drag to orbit.
 */
import { createRuntime } from '../_lib/runtime.js'
import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'

const renderer = new THREE.WebGLRenderer({
  antialias: true,
  preserveDrawingBuffer: new URLSearchParams(location.search).get('capture') === '1',
})
const rt = createRuntime()
renderer.setPixelRatio(rt.pixelRatio)
document.body.appendChild(renderer.domElement)

const params = rt.params({
  spin: { value: +rt.random(0.2, 0.5).toFixed(2), min: 0, max: 2, step: 0.02, label: 'Ball spin' },
  spots: { value: 0.8, min: 0, max: 1, step: 0.02, label: 'Wall spots' },
  beams: { value: 0.5, min: 0, max: 1, step: 0.02, label: 'Light beams' },
  sparkle: { value: 0.6, min: 0, max: 1, step: 0.02, label: 'Sparkle' },
  hue: { value: Math.round(rt.random(0, 360)), min: 0, max: 360, step: 1, label: 'Light hue' },
  hueSpread: { value: 90, min: 0, max: 180, step: 1, label: 'Hue spread' },
  flash: { value: 0.5, min: 0, max: 1, step: 0.02, label: 'Beat flash' },
})
// The ball is a music instrument: beats flash it, loudness spins it up.
rt.mapInput('audio.pulse', 'flash', 0.5)
rt.mapInput('audio.volume', 'spin', 0.4)

const scene = new THREE.Scene()
scene.background = new THREE.Color(0x030308)
scene.fog = new THREE.FogExp2(0x030308, 0.028)
const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 100)
camera.position.set(0, 0.4, 7.5)

const controls = new OrbitControls(camera, renderer.domElement)
controls.enableDamping = true
controls.autoRotate = true
controls.autoRotateSpeed = 0.5
controls.maxDistance = 14

// --- the ball: rows of square mirror tiles over a sphere --------------------
const BALL_R = 1.6
const facetDirs = [] // unit normals of every facet (for the reflections)
{
  const rows = 24
  const tile = (Math.PI * BALL_R) / rows // tile edge ≈ band height
  const geo = new THREE.PlaneGeometry(tile * 0.92, tile * 0.92)
  const mat = new THREE.MeshPhongMaterial({ color: 0x9aa3b2, specular: 0xffffff, shininess: 900 })
  // Count facets first.
  const placements = []
  for (let r = 0; r < rows; r++) {
    const phi = ((r + 0.5) / rows) * Math.PI // 0..π from pole
    const ringR = Math.sin(phi) * BALL_R
    const cnt = Math.max(3, Math.round((2 * Math.PI * ringR) / tile))
    for (let c = 0; c < cnt; c++) {
      const theta = ((c + (r % 2) * 0.5) / cnt) * Math.PI * 2
      placements.push([phi, theta])
    }
  }
  const inst = new THREE.InstancedMesh(geo, mat, placements.length)
  const m = new THREE.Matrix4()
  const q = new THREE.Quaternion()
  const up = new THREE.Vector3(0, 0, 1)
  const jitter = new THREE.Euler()
  placements.forEach(([phi, theta], i) => {
    const n = new THREE.Vector3(
      Math.sin(phi) * Math.cos(theta),
      Math.cos(phi),
      Math.sin(phi) * Math.sin(theta),
    )
    facetDirs.push(n.clone())
    q.setFromUnitVectors(up, n)
    // A hair of per-facet misalignment: that's what makes a real ball sparkle.
    jitter.set(rt.random(-0.05, 0.05), rt.random(-0.05, 0.05), 0)
    const qj = new THREE.Quaternion().setFromEuler(jitter)
    m.compose(n.clone().multiplyScalar(BALL_R), q.clone().multiply(qj), new THREE.Vector3(1, 1, 1))
    inst.setMatrixAt(i, m)
    inst.setColorAt(i, new THREE.Color(0xffffff))
  })
  scene.add(inst)
  var facets = inst // hoisted for the sparkle pass
}
// The hanging rod.
const rod = new THREE.Mesh(
  new THREE.CylinderGeometry(0.03, 0.03, 4, 8),
  new THREE.MeshPhongMaterial({ color: 0x333944 }),
)
rod.position.y = BALL_R + 2
scene.add(rod)

// --- lights ------------------------------------------------------------------
scene.add(new THREE.AmbientLight(0x223, 1.2))
const lights = []
for (let i = 0; i < 3; i++) {
  const l = new THREE.PointLight(0xffffff, 220, 60)
  scene.add(l)
  lights.push(l)
}

// --- wall spots: one soft dot per facet, thrown onto the room sphere --------
const ROOM_R = 17
function dotTexture() {
  const c = document.createElement('canvas')
  c.width = c.height = 64
  const g = c.getContext('2d')
  const rad = g.createRadialGradient(32, 32, 0, 32, 32, 32)
  rad.addColorStop(0, 'rgba(255,255,255,1)')
  rad.addColorStop(0.35, 'rgba(255,255,255,0.6)')
  rad.addColorStop(1, 'rgba(255,255,255,0)')
  g.fillStyle = rad
  g.fillRect(0, 0, 64, 64)
  return new THREE.CanvasTexture(c)
}
const spotGeo = new THREE.BufferGeometry()
const spotPos = new Float32Array(facetDirs.length * 3)
const spotCol = new Float32Array(facetDirs.length * 3)
spotGeo.setAttribute('position', new THREE.BufferAttribute(spotPos, 3))
spotGeo.setAttribute('color', new THREE.BufferAttribute(spotCol, 3))
const spots = new THREE.Points(
  spotGeo,
  new THREE.PointsMaterial({
    vertexColors: true, size: 0.55, map: dotTexture(), transparent: true,
    blending: THREE.AdditiveBlending, depthWrite: false,
  }),
)
spots.frustumCulled = false
scene.add(spots)

// --- beams: a few bright shafts from the ball, rotating with it --------------
const beamGroup = new THREE.Group()
scene.add(beamGroup)
const beamMat = new THREE.MeshBasicMaterial({
  color: 0xffffff, transparent: true, opacity: 0.06,
  blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
})
const beamDirs = []
for (let i = 0; i < 14; i++) {
  const dir = facetDirs[Math.floor(rt.rng() * facetDirs.length)].clone()
  const len = ROOM_R
  const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.5, len, 8, 1, true), beamMat.clone())
  beam.position.copy(dir.clone().multiplyScalar(len / 2))
  beam.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir)
  beamGroup.add(beam)
  beamDirs.push(dir)
}

// A floor to ground the room.
const floor = new THREE.Mesh(
  new THREE.CircleGeometry(20, 48),
  new THREE.MeshPhongMaterial({ color: 0x0a0c14, shininess: 40 }),
)
floor.rotation.x = -Math.PI / 2
floor.position.y = -4
scene.add(floor)

const colA = new THREE.Color()
let flashK = 0
rt.onBeat(() => (flashK = 1))

let lastNow = 0
let ballAngle = 0
renderer.setAnimationLoop((now) => {
  rt.tick(now)
  const t = now * 0.001
  const dt = lastNow ? Math.min(0.05, (now - lastNow) / 1000) : 0.016
  lastNow = now
  ballAngle += params.spin * dt
  flashK *= Math.pow(0.12, dt * 2)

  facets.rotation.y = ballAngle
  beamGroup.rotation.y = ballAngle

  // Coloured lights orbit slowly, hues fanned around the base hue.
  for (let i = 0; i < lights.length; i++) {
    const a = t * (0.3 + i * 0.13) + (i * Math.PI * 2) / lights.length
    lights[i].position.set(Math.cos(a) * 8, 3 + Math.sin(t * 0.5 + i) * 2, Math.sin(a) * 8)
    colA.setHSL(((params.hue + i * params.hueSpread) % 360) / 360, 0.85, 0.6)
    lights[i].color.copy(colA)
    lights[i].intensity = 200 + flashK * params.flash * 500
  }

  // Wall spots: reflect each (rotated) facet direction off toward the room.
  const cy = Math.cos(ballAngle)
  const sy = Math.sin(ballAngle)
  const on = params.spots
  for (let i = 0; i < facetDirs.length; i++) {
    const d = facetDirs[i]
    // Rotate the facet normal by the ball's spin (about y).
    const x = d.x * cy + d.z * sy
    const z = -d.x * sy + d.z * cy
    const y = d.y
    spotPos[i * 3] = x * ROOM_R
    spotPos[i * 3 + 1] = y * ROOM_R
    spotPos[i * 3 + 2] = z * ROOM_R
    // A facet lights up when it faces one of the lights-ish: cheap shimmer by
    // hashing facet index + spin, tinted by the light hues.
    const tw = 0.5 + 0.5 * Math.sin(i * 12.9898 + ballAngle * (2 + (i % 5)))
    const li = i % lights.length
    colA.setHSL(((params.hue + li * params.hueSpread) % 360) / 360, 0.6, 0.45 + tw * 0.3)
    const k = on * (0.25 + 0.75 * tw) * (1 + flashK * params.flash * 1.6)
    spotCol[i * 3] = colA.r * k
    spotCol[i * 3 + 1] = colA.g * k
    spotCol[i * 3 + 2] = colA.b * k
  }
  spotGeo.attributes.position.needsUpdate = true
  spotGeo.attributes.color.needsUpdate = true

  // Beams breathe with the music.
  beamGroup.children.forEach((b, i) => {
    b.material.opacity = params.beams * (0.03 + 0.05 * (0.5 + 0.5 * Math.sin(t * 2 + i * 1.7))) * (1 + flashK * 2)
    const li = i % lights.length
    colA.setHSL(((params.hue + li * params.hueSpread) % 360) / 360, 0.7, 0.65)
    b.material.color.copy(colA)
  })

  // Sparkle: a scattering of facets flare white each frame.
  if (params.sparkle > 0.01) {
    const nFlare = Math.round(6 + params.sparkle * 26 * (1 + flashK * 2))
    for (let k = 0; k < nFlare; k++) {
      const i = Math.floor(Math.random() * facetDirs.length)
      const bright = 1 + Math.random() * 5 * params.sparkle
      facets.setColorAt(i, colA.setScalar(bright))
    }
    // And relax a batch back to mirror-grey.
    for (let k = 0; k < 40; k++) {
      facets.setColorAt(Math.floor(Math.random() * facetDirs.length), colA.setScalar(1))
    }
    facets.instanceColor.needsUpdate = true
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
