// Bloom — hyperreal generative flowers in the spirit of Flume's album art:
// glossy sculpted petals built as parametric surfaces (width profile, cup,
// backward curl, edge ruffle), stacked in golden-angle whorls around a
// stamen crown, unfurling on a slow cycle. Every seed grows a different
// cultivar; beats shiver the petals open a little further.
import { createRuntime } from '../_lib/runtime.js'
import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js'

const renderer = new THREE.WebGLRenderer({
  antialias: true,
  preserveDrawingBuffer: new URLSearchParams(location.search).get('capture') === '1',
})
const rt = createRuntime()
renderer.setPixelRatio(rt.pixelRatio)
renderer.toneMapping = THREE.ACESFilmicToneMapping
renderer.toneMappingExposure = 1.15
document.body.appendChild(renderer.domElement)

// Per-species morphology: petal count/whorls, arrangement (packed spiral vs a
// flat whorl), petal shape (width, length, cup, curl, ruffle, tip pointiness),
// colour character, spread and the kind of flower centre. The user sliders
// (petals, layers, curl, ruffle, hue) modulate these so every species still
// responds to the controls.
const SPECIES = {
  Rose: { petals: 8, layers: 5, arrange: 'spiral', widthK: 0.66, lenK: 0.95, cup: 0.9, curl: 0.7, ruffle: 0.5, tip: 0.15, sat: 0.8, lightBase: 0.42, center: 'tuck', spread: 0.55, nod: 0.25 },
  Dahlia: { petals: 12, layers: 6, arrange: 'spiral', widthK: 0.4, lenK: 0.82, cup: 0.6, curl: 0.6, ruffle: 0.3, tip: 0.85, sat: 0.82, lightBase: 0.44, center: 'tuck', spread: 0.5, nod: 0.15 },
  Daisy: { petals: 20, layers: 1, arrange: 'whorl', widthK: 0.26, lenK: 1.15, cup: 0.12, curl: 0.2, ruffle: 0.2, tip: 0.55, sat: 0.06, lightBase: 0.9, whiteTip: true, center: 'disc', centerHue: 48, spread: 0.95, nod: 0.15 },
  Tulip: { petals: 6, layers: 2, arrange: 'whorl', widthK: 0.74, lenK: 0.9, cup: 1.15, curl: 0.15, ruffle: 0.12, tip: 0.1, sat: 0.82, lightBase: 0.46, center: 'crown', spread: 0.28, nod: 0.08 },
  Lily: { petals: 6, layers: 1, arrange: 'whorl', widthK: 0.5, lenK: 1.28, cup: 0.28, curl: 1.5, ruffle: 0.35, tip: 0.85, sat: 0.72, lightBase: 0.5, center: 'lily', spread: 0.85, nod: 0.42 },
  Poppy: { petals: 5, layers: 1, arrange: 'whorl', widthK: 0.98, lenK: 0.82, cup: 0.72, curl: 0.45, ruffle: 1.5, tip: 0.05, sat: 0.85, lightBase: 0.46, center: 'dark', spread: 0.7, nod: 0.2 },
}
const SPECIES_LIST = Object.keys(SPECIES)

const params = rt.params({
  species: { value: 'Assorted', type: 'select', options: ['Assorted', ...SPECIES_LIST], label: 'Flower' },
  bloom: { value: 0.85, min: 0, max: 1, step: 0.01, label: 'Bloom' },
  autoBloom: { value: true, type: 'bool', label: 'Bloom cycle' },
  petals: { value: 9, min: 4, max: 16, step: 1, label: 'Petals / whorl' },
  layers: { value: 3, min: 1, max: 5, step: 1, label: 'Whorls' },
  curl: { value: 1, min: 0, max: 2, step: 0.02, label: 'Petal curl' },
  ruffle: { value: 0.7, min: 0, max: 2, step: 0.02, label: 'Ruffle' },
  hue: { value: 328, min: 0, max: 360, step: 1, label: 'Hue' },
  iridescence: { value: 0.5, min: 0, max: 1, step: 0.01, label: 'Iridescence' },
  spin: { value: 0.4, min: 0, max: 2, step: 0.02, label: 'Orbit speed' },
})
rt.mapInput('audio.pulse', 'bloom', 0.12)
rt.mapInput('audio.mid', 'iridescence', 0.4)

const scene = new THREE.Scene()
scene.background = new THREE.Color(0x05060a)
scene.fog = new THREE.Fog(0x05060a, 9, 22)
const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100)
camera.position.set(0, 2.1, 7.2)

const controls = new OrbitControls(camera, renderer.domElement)
controls.enableDamping = true
controls.target.set(0, 1.35, 0)
controls.autoRotate = true
controls.minDistance = 2.5
controls.maxDistance = 14

// Studio look: an environment map for the glossy PBR petals + colored rims.
const pmrem = new THREE.PMREMGenerator(renderer)
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture
const key = new THREE.DirectionalLight(0xfff2e2, 1.7)
key.position.set(4, 7, 5)
scene.add(key)
const rimA = new THREE.PointLight(0xff5fd0, 26, 30)
rimA.position.set(-6, 3, -4)
scene.add(rimA)
const rimB = new THREE.PointLight(0x3fb8ff, 22, 30)
rimB.position.set(6, 1.5, -5)
scene.add(rimB)
scene.add(new THREE.AmbientLight(0x404060, 0.5))

// unlit ground: a baked radial pool of deep blue that melts into the
// background (a lit floor reads as gray under studio IBL no matter how dark
// its albedo, so we paint the vignette ourselves)
const floorCanvas = document.createElement('canvas')
floorCanvas.width = floorCanvas.height = 256
{
  const fctx = floorCanvas.getContext('2d')
  const g = fctx.createRadialGradient(128, 128, 10, 128, 128, 128)
  g.addColorStop(0, '#161822')
  g.addColorStop(0.55, '#0a0b12')
  g.addColorStop(1, '#05060a')
  fctx.fillStyle = g
  fctx.fillRect(0, 0, 256, 256)
}
const floorTex = new THREE.CanvasTexture(floorCanvas)
floorTex.colorSpace = THREE.SRGBColorSpace
const floor = new THREE.Mesh(
  new THREE.CircleGeometry(9, 48),
  new THREE.MeshBasicMaterial({ map: floorTex, fog: false }),
)
floor.rotation.x = -Math.PI / 2
floor.position.y = -1.6
scene.add(floor)

// --- parametric petal surface ----------------------------------------------
function makePetalGeom(o) {
  const wS = 10
  const lS = 24
  const pos = []
  const col = []
  const uv = []
  const idx = []
  // spine: march along the petal length, curling backward toward the tip
  const spine = []
  let py = 0
  let pz = 0
  for (let j = 0; j <= lS; j++) {
    const v = j / lS
    spine.push([py, pz])
    const a = o.lift + o.curl * 1.35 * Math.pow(v, 1.6)
    py += (o.len / lS) * Math.cos(a)
    pz += (o.len / lS) * Math.sin(a)
  }
  const sat = o.sat ?? 0.9, lb = o.lightBase ?? 0.4, tp = o.tip ?? 0.4
  const base = new THREE.Color().setHSL(o.hue / 360, sat, lb * 0.45)
  const mid = new THREE.Color().setHSL(((o.hue + 8) % 360) / 360, sat * 0.98, lb)
  const tip = new THREE.Color().setHSL(((o.hue + 22) % 360) / 360, sat * (o.whiteTip ? 0.3 : 0.72), Math.min(0.97, lb * 1.6 + (o.whiteTip ? 0.18 : 0)))
  const c = new THREE.Color()
  for (let j = 0; j <= lS; j++) {
    const v = j / lS
    // width profile, with `tip` sharpening the exponent and tapering the point
    const w = Math.pow(Math.sin(Math.PI * Math.min(1, v * 0.94 + 0.035)), 0.62 + tp * 0.5) * (1 - 0.22 * v) * (1 - tp * 0.75 * Math.pow(v, 2.2))
    for (let i = 0; i <= wS; i++) {
      const u = i / wS
      const x = (u - 0.5) * o.wid * w
      const cup = o.cup * Math.pow(Math.abs(u - 0.5) * 2, 1.8) * w * o.wid * 0.55
      const ruf = o.ruffle * 0.055 * o.len * Math.sin(u * Math.PI * o.rufFreq + o.rufPhase + v * 2.2) * v * v * w
      pos.push(x, spine[j][0], spine[j][1] - cup + ruf)
      if (v < 0.45) c.lerpColors(base, mid, v / 0.45)
      else c.lerpColors(mid, tip, (v - 0.45) / 0.55)
      const edge = Math.pow(Math.abs(u - 0.5) * 2, 3) * 0.18
      col.push(Math.min(1, c.r + edge), Math.min(1, c.g + edge), Math.min(1, c.b + edge))
      uv.push(u, v)
    }
  }
  for (let j = 0; j < lS; j++) {
    for (let i = 0; i < wS; i++) {
      const a = j * (wS + 1) + i
      idx.push(a, a + 1, a + wS + 1, a + 1, a + wS + 2, a + wS + 1)
    }
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3))
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2))
  g.setIndex(idx)
  g.computeVertexNormals()
  return g
}

// A shared petal-vein texture: a central midrib and finer laterals branching
// toward the tip, baked once and used as a bump + subtle roughness map so the
// petals read as real, veined tissue rather than smooth plastic.
function makeVeinTexture() {
  const S = 256
  const c = document.createElement('canvas'); c.width = c.height = S
  const x = c.getContext('2d')
  x.fillStyle = '#808080'; x.fillRect(0, 0, S, S) // neutral (no bump)
  x.lineCap = 'round'
  // midrib up the centre (u = 0.5), fading toward the tip
  x.strokeStyle = 'rgba(60,60,60,0.9)'; x.lineWidth = 3
  x.beginPath(); x.moveTo(S * 0.5, S); x.lineTo(S * 0.5, S * 0.06); x.stroke()
  // lateral veins branching off the midrib toward the edges
  x.strokeStyle = 'rgba(80,80,80,0.7)'; x.lineWidth = 1.4
  for (let k = 1; k <= 9; k++) {
    const vy = S * (1 - k / 10) // up the length
    for (const dir of [-1, 1]) {
      x.beginPath()
      x.moveTo(S * 0.5, vy)
      x.quadraticCurveTo(S * (0.5 + dir * 0.22), vy - S * 0.03, S * (0.5 + dir * 0.42), vy - S * 0.09)
      x.stroke()
    }
  }
  const tex = new THREE.CanvasTexture(c)
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping
  return tex
}
const veinTex = makeVeinTexture()

function petalMaterial(hue = params.hue, sat = 0.85) {
  const m = new THREE.MeshPhysicalMaterial({
    vertexColors: true,
    side: THREE.DoubleSide,
    // Real petals are matte-velvety, not lacquered: higher roughness, a strong
    // fabric-like sheen, and only a whisper of clearcoat for the waxy surface.
    roughness: 0.62,
    metalness: 0,
    clearcoat: 0.25,
    clearcoatRoughness: 0.55,
    sheen: 0.9,
    sheenRoughness: 0.42,
    sheenColor: new THREE.Color().setHSL(((hue + 20) % 360) / 360, 0.6, 0.7),
    iridescence: params.iridescence * 0.5,
    iridescenceIOR: 1.25,
    // veining as micro-relief + slightly rougher along the veins
    bumpMap: veinTex,
    bumpScale: 0.04,
    roughnessMap: veinTex,
    // fake subsurface: petals are thin, so they glow faintly from within when
    // backlit (cheaper than a full transmission pass, which would tank perf)
    emissive: new THREE.Color().setHSL((hue % 360) / 360, sat, 0.5),
    emissiveIntensity: 0.09,
  })
  m.envMapIntensity = 0.5
  return m
}

// --- a flower: whorls of petal pivots + a stamen crown on a curved stem ----
function mulberry(seed) {
  let s = seed >>> 0
  return () => {
    s = (s + 0x6d2b79f5) | 0
    let z = Math.imul(s ^ (s >>> 15), 1 | s)
    z = (z + Math.imul(z ^ (z >>> 7), 61 | z)) ^ z
    return ((z ^ (z >>> 14)) >>> 0) / 4294967296
  }
}

const flowers = []
const petalMats = []
const GOLD = Math.PI * (3 - Math.sqrt(5))

const HSL = (h, s, l) => new THREE.Color().setHSL((((h % 360) + 360) % 360) / 360, s, l)
function speciesFor(i) {
  if (params.species !== 'Assorted') return SPECIES[params.species] ?? SPECIES.Rose
  return SPECIES[SPECIES_LIST[i % SPECIES_LIST.length]]
}

// The flower centre, styled per species: a florets disc (daisy), a dark boss +
// stamen ring (poppy), six prominent stamens + a pistil (lily), a small tucked
// mound the petals hide (rose/dahlia), or the generic stamen crown (tulip).
function buildCenter(style, hue, size, rnd, centerHue) {
  const g = new THREE.Group()
  const M = new THREE.Matrix4(), E = new THREE.Euler()
  if (style === 'disc') {
    const disc = new THREE.Mesh(new THREE.SphereGeometry(size * 0.42, 24, 16), new THREE.MeshStandardMaterial({ color: HSL(centerHue ?? 48, 0.85, 0.5), roughness: 0.8 }))
    disc.scale.set(1, 0.32, 1); g.add(disc)
    const n = 110, dg = new THREE.SphereGeometry(size * 0.02, 6, 5)
    const inst = new THREE.InstancedMesh(dg, new THREE.MeshStandardMaterial({ color: HSL((centerHue ?? 48) - 8, 0.9, 0.4), roughness: 0.7 }), n)
    for (let i = 0; i < n; i++) { const rr = size * 0.4 * Math.sqrt(i / n), a = i * GOLD; M.makeTranslation(Math.cos(a) * rr, size * 0.14 * (1 - rr / (size * 0.42)), Math.sin(a) * rr); inst.setMatrixAt(i, M) }
    g.add(inst); return g
  }
  if (style === 'dark') {
    const boss = new THREE.Mesh(new THREE.SphereGeometry(size * 0.2, 20, 14), new THREE.MeshStandardMaterial({ color: 0x120a08, roughness: 0.7 }))
    boss.scale.y = 0.5; g.add(boss)
    const cap = new THREE.Mesh(new THREE.SphereGeometry(size * 0.15, 16, 10), new THREE.MeshStandardMaterial({ color: HSL(hue + 200, 0.25, 0.28), roughness: 0.6 }))
    cap.scale.y = 0.22; cap.position.y = size * 0.1; g.add(cap)
    const n = 44, fg = new THREE.CylinderGeometry(size * 0.004, size * 0.006, size * 0.22, 4); fg.translate(0, size * 0.11, 0)
    const ag = new THREE.SphereGeometry(size * 0.015, 6, 4); ag.translate(0, size * 0.22, 0)
    const fi = new THREE.InstancedMesh(fg, new THREE.MeshStandardMaterial({ color: 0x1c1512, roughness: 0.6 }), n)
    const ai = new THREE.InstancedMesh(ag, new THREE.MeshStandardMaterial({ color: 0x2a1e12, roughness: 0.5 }), n)
    for (let i = 0; i < n; i++) { E.set(0.85 + rnd() * 0.35, i * GOLD, 0, 'YXZ'); M.makeRotationFromEuler(E); fi.setMatrixAt(i, M); ai.setMatrixAt(i, M) }
    g.add(fi, ai); return g
  }
  if (style === 'tuck') {
    const mound = new THREE.Mesh(new THREE.SphereGeometry(size * 0.1, 12, 8), new THREE.MeshStandardMaterial({ color: HSL(hue, 0.55, 0.32), roughness: 0.7 }))
    mound.scale.y = 0.6; g.add(mound); return g
  }
  // 'crown' (generic / tulip) or 'lily' (six long stamens + a pistil)
  const lily = style === 'lily'
  const mound = new THREE.Mesh(new THREE.SphereGeometry(size * 0.16, 20, 14), new THREE.MeshStandardMaterial({ color: HSL(hue + 40, 0.7, 0.35), roughness: 0.6 }))
  mound.scale.y = 0.7; g.add(mound)
  const nStam = lily ? 6 : 16
  const fg = new THREE.CylinderGeometry(size * (lily ? 0.012 : 0.008), size * (lily ? 0.016 : 0.012), size * (lily ? 0.6 : 0.42), lily ? 6 : 5); fg.translate(0, size * (lily ? 0.3 : 0.21), 0)
  const ag = new THREE.SphereGeometry(size * (lily ? 0.06 : 0.035), 8, 6); ag.scale(1, lily ? 2.4 : 1.7, 1); ag.translate(0, size * (lily ? 0.62 : 0.44), 0)
  const fi = new THREE.InstancedMesh(fg, new THREE.MeshStandardMaterial({ color: HSL(hue + 30, 0.5, 0.75), roughness: 0.5 }), nStam)
  const ai = new THREE.InstancedMesh(ag, new THREE.MeshStandardMaterial({ color: lily ? 0x7a4a12 : 0xffb545, emissive: lily ? 0x1a0e00 : 0x6a3c00, roughness: 0.5 }), nStam)
  for (let i = 0; i < nStam; i++) { E.set((lily ? 0.5 : 0.35) + rnd() * (lily ? 0.2 : 0.5), lily ? (i * Math.PI * 2) / 6 : i * GOLD, 0, 'YXZ'); M.makeRotationFromEuler(E); fi.setMatrixAt(i, M); ai.setMatrixAt(i, M) }
  g.add(fi, ai)
  if (lily) { const pist = new THREE.Mesh(new THREE.CylinderGeometry(size * 0.014, size * 0.02, size * 0.7, 6), new THREE.MeshStandardMaterial({ color: HSL(120, 0.4, 0.5), roughness: 0.5 })); pist.position.y = size * 0.35; g.add(pist) }
  return g
}

function buildFlower(spec) {
  const rnd = mulberry(spec.seed)
  const sp = spec.species
  const group = new THREE.Group()
  const head = new THREE.Group()
  const pivots = []
  const hue = (params.hue + spec.hueShift + 360) % 360
  const mat = petalMaterial(hue, sp.sat)
  petalMats.push(mat)

  // slider-scaled counts (species base × how far the slider is from its default)
  const perWhorl = Math.max(3, Math.round(sp.petals * (params.petals / 9)))
  const layers = Math.max(1, Math.round(sp.layers * (params.layers / 3)))
  const spiral = sp.arrange === 'spiral'
  const curlB = params.curl * sp.curl, rufB = params.ruffle * sp.ruffle

  // petal geoms bucketed by how far in the petal sits (fl 0 outer → 1 inner)
  const NB = 8, geomCache = []
  const geomFor = (fl) => {
    const b = Math.max(0, Math.min(NB - 1, Math.floor(fl * NB)))
    if (geomCache[b]) return geomCache[b]
    return (geomCache[b] = makePetalGeom({
      len: spec.size * sp.lenK * (1.05 - fl * 0.5) * (0.9 + rnd() * 0.18),
      wid: spec.size * sp.widthK * (1.0 - fl * 0.25) * (0.9 + rnd() * 0.2),
      curl: curlB * (0.5 + fl * 1.0),
      cup: sp.cup * (0.8 + rnd() * 0.4),
      ruffle: rufB * (0.7 + rnd() * 0.6),
      rufFreq: 2 + Math.floor(rnd() * 3),
      rufPhase: rnd() * Math.PI * 2,
      lift: 0.06, tip: sp.tip, sat: sp.sat, lightBase: sp.lightBase, whiteTip: !!sp.whiteTip,
      hue: (hue + fl * 12 + rnd() * 8) % 360,
    }))
  }

  const addPetal = (fl, rotY, closed, open) => {
    const pivot = new THREE.Group()
    pivot.rotation.y = rotY
    const tilt = new THREE.Group() // animated: closed → open
    tilt.add(new THREE.Mesh(geomFor(fl), mat))
    pivot.add(tilt); head.add(pivot)
    pivots.push({ tilt, closed, open, layer: fl, wob: rnd() * Math.PI * 2 })
  }
  if (spiral) {
    const total = perWhorl * layers
    for (let i = 0; i < total; i++) {
      const fl = total <= 1 ? 0 : i / (total - 1)
      addPetal(fl, i * GOLD, 0.1 + fl * 0.5, 0.2 + (1 - fl) * (0.5 + sp.spread * 0.6) + rnd() * 0.08)
    }
  } else {
    for (let l = 0; l < layers; l++) {
      const fl = layers === 1 ? 0 : l / (layers - 1)
      for (let i = 0; i < perWhorl; i++) addPetal(fl, i * ((Math.PI * 2) / perWhorl) + l * GOLD, 0.12 + fl * 0.1, 0.35 + (1 - fl) * (0.35 + sp.spread * 0.7) + rnd() * 0.1)
    }
  }

  const crown = buildCenter(sp.center, hue, spec.size, rnd, sp.centerHue)
  head.add(crown)

  head.position.copy(spec.pos)
  head.rotation.set(sp.nod ?? spec.nod, rnd() * Math.PI * 2, 0)
  group.add(head)

  // curved stem down to the platform
  const sway = new THREE.Vector3(rnd() - 0.5, 0, rnd() - 0.5).multiplyScalar(0.8)
  const curve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(spec.pos.x + sway.x, -1.6, spec.pos.z + sway.z),
    new THREE.Vector3(spec.pos.x + sway.x * 0.4, (spec.pos.y - 1.6) * 0.5, spec.pos.z + sway.z * 0.4),
    spec.pos.clone().add(new THREE.Vector3(0, -spec.size * 0.1, 0)),
  ])
  const stem = new THREE.Mesh(
    new THREE.TubeGeometry(curve, 20, spec.size * 0.045, 7),
    new THREE.MeshStandardMaterial({ color: 0x2a5a2e, roughness: 0.45 }),
  )
  group.add(stem)

  scene.add(group)
  return { group, head, crown, pivots, spec, phase: spec.phase }
}

function clearFlowers() {
  for (const f of flowers) {
    f.group.traverse((o) => {
      if (o.geometry) o.geometry.dispose()
    })
    scene.remove(f.group)
  }
  flowers.length = 0
  for (const m of petalMats) m.dispose()
  petalMats.length = 0
}

function buildGarden() {
  clearFlowers()
  const n = rt.detail < 0.55 ? 2 : 4
  const specs = [
    { pos: new THREE.Vector3(0, 1.5, 0), size: 1.5, hueShift: 0, nod: 0.32, phase: 0 },
    { pos: new THREE.Vector3(-2.3, 0.7, -0.9), size: 1.0, hueShift: rt.random(-40, 40), nod: 0.55, phase: 0.35 },
    { pos: new THREE.Vector3(2.2, 0.9, -1.2), size: 1.1, hueShift: rt.random(-40, 40), nod: 0.45, phase: 0.6 },
    { pos: new THREE.Vector3(1.1, 0.2, 1.6), size: 0.7, hueShift: rt.random(-60, 60), nod: 0.7, phase: 0.82 },
  ]
  for (let i = 0; i < n; i++) {
    flowers.push(buildFlower({ ...specs[i], species: speciesFor(i), seed: (rt.rng() * 4294967296) >>> 0 }))
  }
}

// rebuild when structural params change (debounced so slider drags are cheap)
let lastKey = ''
let keyChangedAt = 0
let rebuildPending = false
function structuralKey() {
  return [params.species, Math.round(params.petals), Math.round(params.layers), params.curl.toFixed(2), params.ruffle.toFixed(2), Math.round(params.hue)].join('|')
}

buildGarden()
lastKey = structuralKey()

// --- animation --------------------------------------------------------------
const smooth = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)))
  return t * t * (3 - 2 * t)
}

renderer.setAnimationLoop((now) => {
  rt.tick(now)
  const t = now * 0.001

  const k = structuralKey()
  if (k !== lastKey) {
    lastKey = k
    keyChangedAt = t
    rebuildPending = true
  }
  if (rebuildPending && t - keyChangedAt > 0.2) {
    rebuildPending = false
    buildGarden()
  }

  const pulse = rt.beat.state.pulse
  for (const f of flowers) {
    let b = params.bloom
    if (params.autoBloom) {
      // slow open → hold → close cycle, staggered per flower
      const c = ((t / 26 + f.phase) % 1 + 1) % 1
      b = (smooth(0.02, 0.3, c) * (1 - smooth(0.72, 0.97, c))) * params.bloom
    }
    b = Math.min(1, b + pulse * 0.08)
    for (const p of f.pivots) {
      // outer whorls open first; petals breathe and shiver on beats
      const local = smooth(p.layer * 0.28, p.layer * 0.28 + 0.72, b)
      const breathe = Math.sin(t * 0.8 + p.wob) * 0.02 + pulse * Math.sin(t * 18 + p.wob) * 0.03
      p.tilt.rotation.x = p.closed + (p.open - p.closed) * local + breathe
      const s = 0.3 + 0.7 * Math.pow(local, 0.7)
      p.tilt.scale.setScalar(s)
    }
    // the stamen crown emerges with the petals so a closed bud stays a bud
    f.crown.scale.setScalar(0.12 + 0.88 * Math.pow(smooth(0.15, 0.85, b), 1.4))
    f.head.rotation.y += 0.0006 * (1 + pulse)
  }

  // keep iridescence subtle so the petals stay velvety, and let beats pulse
  // the inner glow so the flower seems to breathe light
  for (const m of petalMats) {
    m.iridescence = params.iridescence * 0.5
    m.emissiveIntensity = 0.09 + pulse * 0.14
  }
  rimA.intensity = 26 + pulse * 40
  rimB.intensity = 22 + pulse * 26

  controls.autoRotateSpeed = params.spin
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
