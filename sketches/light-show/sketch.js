// Light Show — moving-head fixtures sweeping through a hazy room: volumetric
// beams (gradient cones, additive), real spotlights pooling on the floor,
// drifting dust catching the light, and a beat that snaps the rig to new
// sweeps and flashes the haze. The heads carry a gobo wheel (patterns
// projected through the beam onto the floor via SpotLight.map, slowly
// rotating), an iris (aperture), and a focus knob that runs the projection
// from knife-sharp to soft wash. A tiny concert lighting simulator.
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
  gobo: { value: rt.pick(['open', 'dots', 'bars', 'star', 'breakup', 'gears', 'spiral', 'triangles', 'rings', 'leaves', 'windows']), type: 'select', options: ['open', 'dots', 'bars', 'star', 'breakup', 'gears', 'spiral', 'triangles', 'rings', 'leaves', 'windows'], label: 'Gobo' },
  aperture: { value: 1, min: 0.15, max: 1, step: 0.01, label: 'Aperture (iris)' },
  focus: { value: 0.85, min: 0, max: 1, step: 0.01, label: 'Focus' },
  goboSpin: { value: 0.3, min: 0, max: 2, step: 0.02, label: 'Gobo rotation' },
  hue: { value: rt.random(0, 360), min: 0, max: 360, step: 1, label: 'Palette hue' },
  white: { value: 0.15, min: 0, max: 1, step: 0.01, label: 'Whiteness' },
  flash: { value: 0.8, min: 0, max: 2, step: 0.02, label: 'Beat flash' },
})
rt.mapInput('audio.pulse', 'flash', 0.5)
rt.mapInput('audio.high', 'beamWidth', 0.2)
rt.mapInput('audio.low', 'aperture', 0.2)

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

// beam-cone texture: u wraps the cone's circumference, v runs head→floor.
// It's baked from the gobo itself — the gobo's angular light profile becomes
// shafts in the beam, so the volumetric cone matches the projected pattern.
const coneCanvas = document.createElement('canvas')
coneCanvas.width = 256
coneCanvas.height = 128

// --- gobo wheel -------------------------------------------------------------
// One shared 256px canvas; every fixture projects it through its SpotLight
// (each with its own texture object so rotations differ). Focus blurs the
// pattern edges, the iris masks the opening — both baked here.
const GOBO = 256
const goboCanvas = document.createElement('canvas')
goboCanvas.width = goboCanvas.height = GOBO
const goboPattern = document.createElement('canvas') // crisp pattern, pre-blur
goboPattern.width = goboPattern.height = GOBO
const breakupSeed = []
for (let i = 0; i < 14; i++) breakupSeed.push([rt.random(0.15, 0.85), rt.random(0.15, 0.85), rt.random(0.05, 0.16)])

function paintPattern(kind) {
  const c = goboPattern.getContext('2d')
  const m = GOBO / 2
  c.clearRect(0, 0, GOBO, GOBO)
  c.fillStyle = '#fff'
  if (kind === 'open') {
    c.beginPath()
    c.arc(m, m, m * 0.92, 0, Math.PI * 2)
    c.fill()
  } else if (kind === 'dots') {
    for (let ring = 0; ring < 3; ring++) {
      const rr = m * (0.22 + ring * 0.28)
      const n = 4 + ring * 5
      for (let k = 0; k < n; k++) {
        const a = (k / n) * Math.PI * 2 + ring
        c.beginPath()
        c.arc(m + Math.cos(a) * rr, m + Math.sin(a) * rr, m * 0.09, 0, Math.PI * 2)
        c.fill()
      }
    }
  } else if (kind === 'bars') {
    for (let k = -2; k <= 2; k++) c.fillRect(m + k * m * 0.38 - m * 0.09, m * 0.1, m * 0.18, GOBO - m * 0.2)
  } else if (kind === 'star') {
    c.beginPath()
    for (let k = 0; k < 12; k++) {
      const a = (k / 12) * Math.PI * 2
      const rr = k % 2 === 0 ? m * 0.9 : m * 0.32
      c[k === 0 ? 'moveTo' : 'lineTo'](m + Math.cos(a) * rr, m + Math.sin(a) * rr)
    }
    c.closePath()
    c.fill()
  } else if (kind === 'gears') {
    // radial gear teeth around an open hub
    const teeth = 16
    c.beginPath()
    for (let k = 0; k < teeth * 2; k++) {
      const a = (k / (teeth * 2)) * Math.PI * 2
      const rr = k % 2 === 0 ? m * 0.9 : m * 0.62
      c[k === 0 ? 'moveTo' : 'lineTo'](m + Math.cos(a) * rr, m + Math.sin(a) * rr)
    }
    c.closePath()
    c.fill()
    c.globalCompositeOperation = 'destination-out'
    c.beginPath(); c.arc(m, m, m * 0.32, 0, Math.PI * 2); c.fill()
    c.globalCompositeOperation = 'source-over'
  } else if (kind === 'spiral') {
    c.lineCap = 'round'
    c.strokeStyle = '#fff'
    for (let arm = 0; arm < 3; arm++) {
      c.lineWidth = m * 0.1
      c.beginPath()
      for (let t = 0; t < Math.PI * 4; t += 0.1) {
        const rr = m * 0.06 + (t / (Math.PI * 4)) * m * 0.82
        const a = t + (arm / 3) * Math.PI * 2
        const x = m + Math.cos(a) * rr, y = m + Math.sin(a) * rr
        t === 0 ? c.moveTo(x, y) : c.lineTo(x, y)
      }
      c.stroke()
    }
  } else if (kind === 'triangles') {
    const n = 6
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 2
      const cx = m + Math.cos(a) * m * 0.5, cy = m + Math.sin(a) * m * 0.5
      c.save(); c.translate(cx, cy); c.rotate(a)
      c.beginPath()
      c.moveTo(m * 0.28, 0); c.lineTo(-m * 0.14, m * 0.24); c.lineTo(-m * 0.14, -m * 0.24)
      c.closePath(); c.fill()
      c.restore()
    }
  } else if (kind === 'rings') {
    c.strokeStyle = '#fff'
    for (let ring = 1; ring <= 4; ring++) {
      c.lineWidth = m * 0.07
      c.beginPath(); c.arc(m, m, ring * m * 0.22, 0, Math.PI * 2); c.stroke()
    }
  } else if (kind === 'windows') {
    // a cathedral-window grid of rounded panes
    const g = 4, pad = m * 0.06, cell = (GOBO - pad * 2) / g
    for (let iy = 0; iy < g; iy++) for (let ix = 0; ix < g; ix++) {
      const x = pad + ix * cell + cell * 0.12, y = pad + iy * cell + cell * 0.12
      const w = cell * 0.76
      c.beginPath()
      c.moveTo(x, y + w * 0.4)
      c.quadraticCurveTo(x, y, x + w / 2, y)
      c.quadraticCurveTo(x + w, y, x + w, y + w * 0.4)
      c.lineTo(x + w, y + w); c.lineTo(x, y + w); c.closePath()
      c.fill()
    }
  } else {
    // breakup / leaves: a seeded scatter of foliage-like blobs
    for (const [x, y, r] of breakupSeed) {
      c.beginPath()
      c.ellipse(x * GOBO, y * GOBO, r * GOBO, r * GOBO * 0.6, x * 9, 0, Math.PI * 2)
      c.fill()
    }
  }
}

let goboKey = ''
function bakeGobo() {
  const key = `${params.gobo}|${params.focus.toFixed(2)}|${params.aperture.toFixed(2)}`
  if (key === goboKey) return false
  goboKey = key
  paintPattern(params.gobo)
  const c = goboCanvas.getContext('2d')
  c.globalCompositeOperation = 'source-over'
  c.filter = 'none'
  c.fillStyle = '#000'
  c.fillRect(0, 0, GOBO, GOBO)
  c.filter = `blur(${(1 - params.focus) * 9}px)` // defocus softens the pattern
  c.drawImage(goboPattern, 0, 0)
  c.filter = 'none'
  // iris: circular mask whose edge is sharp in focus, soft out of focus
  const m = GOBO / 2
  const r0 = m * 0.96 * params.aperture
  const soft = 3 + (1 - params.focus) * 26
  const g = c.createRadialGradient(m, m, Math.max(0, r0 - soft), m, m, r0)
  g.addColorStop(0, 'rgba(255,255,255,1)')
  g.addColorStop(1, 'rgba(255,255,255,0)')
  c.globalCompositeOperation = 'destination-in'
  c.fillStyle = g
  c.beginPath()
  c.arc(m, m, r0, 0, Math.PI * 2)
  c.fill()
  c.globalCompositeOperation = 'destination-over'
  c.fillStyle = '#000' // the projected map must stay opaque black outside
  c.fillRect(0, 0, GOBO, GOBO)
  c.globalCompositeOperation = 'source-over'
  bakeConeTex()
  return true
}

// sample the finished gobo's brightness around each polar angle and turn it
// into the cone texture: shafts where the gobo passes light, dark in between
function bakeConeTex() {
  const src = goboCanvas.getContext('2d').getImageData(0, 0, GOBO, GOBO).data
  const CW = coneCanvas.width
  const CH = coneCanvas.height
  const prof = new Float32Array(CW)
  let max = 0.001
  for (let x = 0; x < CW; x++) {
    const ang = (x / CW) * Math.PI * 2
    let sum = 0
    let n = 0
    for (let rr = 0.12; rr < 0.92; rr += 0.05) {
      const px = Math.round(GOBO / 2 + Math.cos(ang) * rr * (GOBO / 2))
      const py = Math.round(GOBO / 2 + Math.sin(ang) * rr * (GOBO / 2))
      sum += src[(py * GOBO + px) * 4]
      n++
    }
    prof[x] = sum / (n * 255)
    max = Math.max(max, prof[x])
  }
  const c = coneCanvas.getContext('2d')
  const img = c.createImageData(CW, CH)
  for (let y = 0; y < CH; y++) {
    // canvas top = texture v=1 = cone apex (head): fade in from the lens
    const len = y / (CH - 1)
    const grad = len < 0.15 ? (len / 0.15) * 0.25 : 0.25 + ((len - 0.15) / 0.85) * 0.6
    for (let x = 0; x < CW; x++) {
      const e = 0.25 + 0.75 * (prof[x] / max)
      const i = (y * CW + x) * 4
      img.data[i] = img.data[i + 1] = img.data[i + 2] = 255
      img.data[i + 3] = Math.round(grad * e * 255)
    }
  }
  c.putImageData(img, 0, 0)
}

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

  // two nested gradient cones: a wide soft shell and a hot core. Their
  // texture carries the gobo's shafts; per-fixture so rotations differ.
  const coneTex = new THREE.CanvasTexture(coneCanvas)
  coneTex.wrapS = THREE.RepeatWrapping
  const beamMatOuter = new THREE.MeshBasicMaterial({
    map: coneTex, transparent: true, blending: THREE.AdditiveBlending,
    depthWrite: false, side: THREE.DoubleSide,
  })
  const beamMatInner = beamMatOuter.clone()
  // open-ended cones, apex up at the head; x/z scale sets the floor flare.
  // Both share the head apex radius so the hot core and soft shell are the
  // SAME beam (a bright centre fading to a soft edge), not two columns.
  const outer = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 1, 1, 24, 1, true), beamMatOuter)
  const inner = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 1, 1, 18, 1, true), beamMatInner)
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
  // gobo projection: shared canvas, per-fixture texture so rotations differ
  const goboTex = new THREE.CanvasTexture(goboCanvas)
  goboTex.center.set(0.5, 0.5)
  goboTex.colorSpace = THREE.SRGBColorSpace
  spot.map = goboTex
  const target = new THREE.Object3D()
  target.position.set(0, -BEAM_LEN, 0)
  tilt.add(spot, target)
  spot.target = target

  scene.add(root)
  return {
    root, pan, tilt, outer, inner, lens, spot, goboTex, coneTex,
    beamMatOuter, beamMatInner,
    phase: rt.random(0, Math.PI * 2),
    rate: rt.random(0.6, 1.4),
    panAmp: rt.random(0.5, 1.1),
    tiltAmp: rt.random(0.3, 0.6),
    goboRate: rt.random(0.5, 1.5) * (i % 2 === 0 ? 1 : -1),
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

  // re-bake the gobo when its knobs move; every fixture shares the canvases
  if (bakeGobo()) {
    for (const f of fixtures) {
      f.goboTex.needsUpdate = true
      f.coneTex.needsUpdate = true
    }
  }

  // one set of optics for light and cone, so they always align: the iris
  // masks the projection to a fraction of the spot angle, and the cone
  // flares to exactly tan(angle) x length x that same fraction
  const spotAngle = 0.08 + params.beamWidth * 0.28
  const wR = Math.tan(spotAngle) * BEAM_LEN * 0.96 * params.aperture
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
    // the core shares the outer cone's flare (concentric, same apex) but a
    // bit narrower and brighter — the hot centre of one beam, focus-tightened
    const coreW = wR * (0.55 + params.focus * 0.15)
    f.inner.scale.set(coreW, BEAM_LEN, coreW)
    f.inner.position.y = f.outer.position.y

    f.spot.color.copy(f.color)
    f.spot.intensity = 110 * flash * (0.6 + params.haze * 0.4)
    f.spot.angle = spotAngle
    // focus: knife-edge pool in focus, wide soft penumbra out of focus
    f.spot.penumbra = 0.15 + (1 - params.focus) * 0.7
    const goboRot = t * params.goboSpin * f.goboRate
    f.goboTex.rotation = goboRot
    // spin the cone shafts with the projected pattern
    f.coneTex.offset.x = -goboRot / (Math.PI * 2)
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
