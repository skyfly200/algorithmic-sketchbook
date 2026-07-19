// Light Show — moving-head fixtures sweeping through a hazy room: volumetric
// beams (gradient cones, additive), real spotlights pooling on the floor,
// drifting dust catching the light, and a beat that snaps the rig to new
// sweeps and flashes the haze. A tiny concert lighting simulator.
import { createRuntime } from '../_lib/runtime.js'
import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'

const renderer = new THREE.WebGLRenderer({
  antialias: true,
  preserveDrawingBuffer: new URLSearchParams(location.search).get('capture') === '1',
})
const rt = createRuntime()
renderer.setPixelRatio(rt.pixelRatio)
renderer.toneMapping = THREE.ACESFilmicToneMapping
document.body.appendChild(renderer.domElement)

const params = rt.params({
  fixtures: { value: 6, min: 2, max: 10, step: 1, label: 'Fixtures' },
  haze: { value: 0.6, min: 0.1, max: 1, step: 0.01, label: 'Haze' },
  speed: { value: 1, min: 0, max: 3, step: 0.05, label: 'Sweep speed' },
  spread: { value: 0.7, min: 0.1, max: 1, step: 0.01, label: 'Sweep spread' },
  beamWidth: { value: 0.5, min: 0.15, max: 1, step: 0.01, label: 'Beam width' },
  hue: { value: rt.random(0, 360), min: 0, max: 360, step: 1, label: 'Palette hue' },
  white: { value: 0.15, min: 0, max: 1, step: 0.01, label: 'Whiteness' },
  flash: { value: 0.8, min: 0, max: 2, step: 0.02, label: 'Beat flash' },
})
rt.mapInput('audio.pulse', 'flash', 0.5)
rt.mapInput('audio.high', 'beamWidth', 0.2)

const scene = new THREE.Scene()
scene.background = new THREE.Color(0x04050a)
scene.fog = new THREE.FogExp2(0x05070d, 0.055)
const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 120)
camera.position.set(0, 3.2, 13)

const controls = new OrbitControls(camera, renderer.domElement)
controls.enableDamping = true
controls.target.set(0, 3, 0)
controls.autoRotate = true
controls.autoRotateSpeed = 0.4
controls.maxPolarAngle = Math.PI * 0.52
controls.maxDistance = 26

// stage: matte floor + a truss bar the fixtures hang from
const floor = new THREE.Mesh(
  new THREE.CircleGeometry(30, 48),
  new THREE.MeshStandardMaterial({ color: 0x14161c, roughness: 0.85, metalness: 0.1 }),
)
floor.rotation.x = -Math.PI / 2
scene.add(floor)
scene.add(new THREE.AmbientLight(0x223, 0.5))

const TRUSS_Y = 8.5
const truss = new THREE.Mesh(
  new THREE.CylinderGeometry(0.07, 0.07, 17, 8),
  new THREE.MeshStandardMaterial({ color: 0x2a2d36, roughness: 0.5, metalness: 0.8 }),
)
truss.rotation.z = Math.PI / 2
truss.position.y = TRUSS_Y
scene.add(truss)

// gradient texture for the beam cones: bright at the head, gone at the floor
const beamCanvas = document.createElement('canvas')
beamCanvas.width = 1
beamCanvas.height = 128
{
  const c = beamCanvas.getContext('2d')
  const g = c.createLinearGradient(0, 0, 0, 128)
  g.addColorStop(0, 'rgba(255,255,255,0)')
  g.addColorStop(0.15, 'rgba(255,255,255,0.25)')
  g.addColorStop(1, 'rgba(255,255,255,0.85)')
  c.fillStyle = g
  c.fillRect(0, 0, 1, 128)
}
const beamTex = new THREE.CanvasTexture(beamCanvas)

// drifting dust: faint points that make the haze feel inhabited
const DUST = Math.round(700 * rt.detail) + 100
{
  const pos = new Float32Array(DUST * 3)
  for (let i = 0; i < DUST; i++) {
    pos[i * 3] = rt.random(-9, 9)
    pos[i * 3 + 1] = rt.random(0.1, TRUSS_Y)
    pos[i * 3 + 2] = rt.random(-9, 9)
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3))
  const dust = new THREE.Points(g, new THREE.PointsMaterial({
    color: 0x8899bb, size: 0.035, transparent: true, opacity: 0.5,
    blending: THREE.AdditiveBlending, depthWrite: false,
  }))
  dust.userData.spin = true
  scene.add(dust)
  dust.onBeforeRender = () => { dust.rotation.y += 0.0004 }
}

// --- fixtures ---------------------------------------------------------------
const BEAM_LEN = TRUSS_Y + 1.5
const fixtures = []

function makeFixture(i, n) {
  const root = new THREE.Group() // hangs on the truss
  root.position.set((i - (n - 1) / 2) * (15 / Math.max(1, n - 1) || 0), TRUSS_Y, 0)
  const pan = new THREE.Group() // yaw
  const tilt = new THREE.Group() // pitch
  root.add(pan)
  pan.add(tilt)

  const body = new THREE.Mesh(
    new THREE.CylinderGeometry(0.16, 0.22, 0.5, 12),
    new THREE.MeshStandardMaterial({ color: 0x15161a, roughness: 0.4, metalness: 0.7 }),
  )
  tilt.add(body)

  // two nested gradient cones: a wide soft shell and a hot core
  const beamMatOuter = new THREE.MeshBasicMaterial({
    map: beamTex, transparent: true, blending: THREE.AdditiveBlending,
    depthWrite: false, side: THREE.DoubleSide,
  })
  const beamMatInner = beamMatOuter.clone()
  // open-ended cones, apex up at the head; x/z scale sets the floor flare
  const outer = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 1, 1, 20, 1, true), beamMatOuter)
  const inner = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 1, 1, 14, 1, true), beamMatInner)
  tilt.add(outer, inner)

  // the lens: a glowing dot you can see from the audience
  const lens = new THREE.Mesh(
    new THREE.SphereGeometry(0.09, 10, 8),
    new THREE.MeshBasicMaterial({ color: 0xffffff }),
  )
  lens.position.y = -0.28
  tilt.add(lens)

  const spot = new THREE.SpotLight(0xffffff, 60, BEAM_LEN * 1.6, 0.35, 0.5, 1.2)
  spot.position.set(0, -0.25, 0)
  const target = new THREE.Object3D()
  target.position.set(0, -BEAM_LEN, 0)
  tilt.add(spot, target)
  spot.target = target

  scene.add(root)
  return {
    root, pan, tilt, outer, inner, lens, spot,
    beamMatOuter, beamMatInner,
    phase: rt.random(0, Math.PI * 2),
    rate: rt.random(0.6, 1.4),
    panAmp: rt.random(0.5, 1.1),
    tiltAmp: rt.random(0.3, 0.6),
    hueOff: (i / n) * 360,
    color: new THREE.Color(),
  }
}

function buildRig() {
  for (const f of fixtures) scene.remove(f.root)
  fixtures.length = 0
  const n = Math.round(params.fixtures)
  for (let i = 0; i < n; i++) fixtures.push(makeFixture(i, n))
}
buildRig()

rt.onBeat(({ energy }) => {
  // snap a couple of fixtures onto fresh sweep orbits
  for (const f of fixtures) {
    if (rt.rng() < 0.4 + energy * 0.3) {
      f.phase = rt.random(0, Math.PI * 2)
      f.rate = rt.random(0.6, 1.6)
      f.panAmp = rt.random(0.4, 1.2)
      f.tiltAmp = rt.random(0.25, 0.65)
    }
  }
})

renderer.setAnimationLoop((now) => {
  rt.tick(now)
  const t = now * 0.001

  if (fixtures.length !== Math.round(params.fixtures)) buildRig()

  const pulse = rt.beat.state.pulse
  const flash = 1 + pulse * params.flash * 1.6
  scene.fog.density = 0.03 + params.haze * 0.045

  const wR = 0.2 + params.beamWidth * 0.85 // beam radius at the floor
  for (const f of fixtures) {
    const ph = t * params.speed * f.rate + f.phase
    f.pan.rotation.y = Math.sin(ph * 0.9) * 1.4 * f.panAmp * params.spread
    f.tilt.rotation.x = Math.sin(ph * 0.63 + 1.2) * 0.75 * f.tiltAmp * params.spread
    f.tilt.rotation.z = Math.cos(ph * 0.71) * 0.55 * f.tiltAmp * params.spread

    // palette: fixture hues fan out around the base hue, pulled toward white
    const hue = (((params.hue + f.hueOff + t * 6) % 360) + 360) / 360
    f.color.setHSL(hue, 1 - params.white * 0.7, 0.5 + params.white * 0.25)

    const alpha = (0.28 + params.haze * 0.45) * flash
    f.beamMatOuter.color.copy(f.color)
    f.beamMatOuter.opacity = alpha * 0.6
    f.beamMatInner.color.copy(f.color).lerp(new THREE.Color(1, 1, 1), 0.35)
    f.beamMatInner.opacity = alpha
    f.lens.material.color.copy(f.color).multiplyScalar(2.2 * flash)

    // cones: apex at the head, flaring to the floor
    f.outer.scale.set(wR, BEAM_LEN, wR)
    f.outer.position.y = -BEAM_LEN / 2 - 0.25
    f.inner.scale.set(wR * 0.4, BEAM_LEN, wR * 0.4)
    f.inner.position.y = f.outer.position.y

    f.spot.color.copy(f.color)
    f.spot.intensity = 110 * flash * (0.6 + params.haze * 0.4)
    f.spot.angle = 0.15 + params.beamWidth * 0.3
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
