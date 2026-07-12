/**
 * Diffraction Grating 3D — a 3D render of a holographic diffraction grating: a
 * surface whose micro-grooves split reflected light into spectral orders, so it
 * throws the shifting rainbow sheen of a CD, hologram, or diffraction foil. A
 * custom shader evaluates the grating equation per-fragment — for each order m,
 * the wavelength that constructively diffracts toward the eye is found and
 * converted to colour — over linear, radial, or spiral groove fields, on a
 * disc, torus-knot, or sphere. Orbit with the mouse; it auto-tumbles.
 *
 * Grating type, groove frequency, shape, and palette phase are seeded per load
 * (and by the viewer's 🎲), so every visit is a different grating.
 */
import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { createRuntime } from '../_lib/runtime.js'

const rt = createRuntime()
const params = rt.params({
  freq: { value: +rt.random(1.4, 4.2).toFixed(2), min: 0.5, max: 8, step: 0.05, label: 'Groove frequency' },
  gtype: { value: Math.floor(rt.random(0, 3)), min: 0, max: 2, step: 1, label: 'Grating (0 linear·1 radial·2 spiral)' },
  shape: { value: Math.floor(rt.random(0, 3)), min: 0, max: 2, step: 1, label: 'Shape (0 disc·1 knot·2 sphere)' },
  swirl: { value: +rt.random(1, 5).toFixed(2), min: 0, max: 12, step: 0.1, label: 'Spiral swirl' },
  orders: { value: 4, min: 1, max: 6, step: 1, label: 'Diffraction orders' },
  gain: { value: 1, min: 0.2, max: 2.5, step: 0.05, label: 'Rainbow brightness' },
  spin: { value: +rt.random(0.15, 0.5).toFixed(2), min: 0, max: 2, step: 0.01, label: 'Auto-spin' },
  orbit: { value: 0.4, min: 0, max: 4, step: 0.05, label: 'Camera orbit' },
  flash: { value: 0, min: 0, max: 1, step: 0.01, label: 'Beat flash' },
})
// Music → the grating by default (remix in the controls panel).
rt.mapInput('beat.pulse', 'flash', 0.8) // beats flare the whole sheen
rt.mapInput('beat.volume', 'orbit', 0.7) // loudness spins the camera
rt.mapInput('beat.low', 'freq', 0.6) // bass shifts the groove pitch

const CAPTURE = new URLSearchParams(location.search).get('capture') === '1'
const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: CAPTURE })
renderer.setPixelRatio(rt.pixelRatio)
document.body.appendChild(renderer.domElement)

const scene = new THREE.Scene()
scene.background = new THREE.Color(0x05060a)
const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 100)
camera.position.set(0, 1.2, 5)

const controls = new OrbitControls(camera, renderer.domElement)
controls.enableDamping = true
controls.autoRotate = true

const huePhase = rt.random(0, 1)

const uniforms = {
  u_lightDir: { value: new THREE.Vector3(0.4, 0.7, 0.6).normalize() },
  u_center: { value: new THREE.Vector3(0, 0, 0) },
  u_freq: { value: params.freq },
  u_gtype: { value: params.gtype },
  u_swirl: { value: params.swirl },
  u_orders: { value: params.orders },
  u_gain: { value: params.gain },
  u_flash: { value: 0 },
  u_hue: { value: huePhase },
}

const VERT = `
varying vec3 vWorldPos;
varying vec3 vWorldNormal;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorldPos = wp.xyz;
  vWorldNormal = normalize(mat3(modelMatrix) * normal);
  gl_Position = projectionMatrix * viewMatrix * wp;
}`

const FRAG = `
precision highp float;
varying vec3 vWorldPos;
varying vec3 vWorldNormal;
uniform vec3 u_lightDir, u_center;
uniform float u_freq, u_gtype, u_swirl, u_orders, u_gain, u_flash, u_hue;

// Approximate visible-spectrum wavelength (nm) -> linear RGB.
vec3 waveToRGB(float w) {
  vec3 c;
  if (w < 440.0) c = vec3(-(w - 440.0) / 60.0, 0.0, 1.0);
  else if (w < 490.0) c = vec3(0.0, (w - 440.0) / 50.0, 1.0);
  else if (w < 510.0) c = vec3(0.0, 1.0, -(w - 510.0) / 20.0);
  else if (w < 580.0) c = vec3((w - 510.0) / 70.0, 1.0, 0.0);
  else if (w < 645.0) c = vec3(1.0, -(w - 645.0) / 65.0, 0.0);
  else c = vec3(1.0, 0.0, 0.0);
  // Fade toward the ends of human vision.
  float f = 1.0;
  if (w < 420.0) f = 0.25 + 0.75 * (w - 380.0) / 40.0;
  else if (w > 645.0) f = 0.25 + 0.75 * (700.0 - w) / 55.0;
  return c * clamp(f, 0.0, 1.0);
}

// Colour contribution of a wavelength, windowed to the visible band.
vec3 band(float w) {
  float vis = smoothstep(378.0, 400.0, w) * (1.0 - smoothstep(680.0, 702.0, w));
  return waveToRGB(w) * vis;
}

void main() {
  vec3 N = normalize(vWorldNormal);
  if (!gl_FrontFacing) N = -N;
  vec3 V = normalize(cameraPosition - vWorldPos);
  vec3 L = normalize(u_lightDir);

  // Build the grating vector g (perpendicular to the grooves) in the surface's
  // tangent plane, per grating type.
  vec3 rel = vWorldPos - u_center;
  vec3 axis = vec3(1.0, 0.0, 0.0);
  vec3 gLinear = axis - N * dot(axis, N);
  if (length(gLinear) < 1e-3) gLinear = vec3(0.0, 0.0, 1.0) - N * dot(vec3(0.0, 0.0, 1.0), N);
  gLinear = normalize(gLinear);
  vec3 gRadial = rel - N * dot(rel, N);
  gRadial = length(gRadial) < 1e-4 ? gLinear : normalize(gRadial);
  // Spiral: rotate the radial direction about the normal, more with radius.
  float r = length(rel);
  float a = u_swirl * r;
  vec3 perp = normalize(cross(N, gRadial));
  vec3 gSpiral = normalize(gRadial * cos(a) + perp * sin(a));

  vec3 g = u_gtype < 0.5 ? gLinear : (u_gtype < 1.5 ? gRadial : gSpiral);

  // Grating equation: the phase term is the groove-wise component of the half
  // vector. Solving d·(sinθi - sinθm) = mλ for λ per order m gives the colour
  // that constructively diffracts toward the eye.
  vec3 H = normalize(L + V);
  vec3 Hp = H - N * dot(H, N);          // half vector projected across grooves
  float coord = dot(Hp, g);
  float pitch = 1900.0 / max(u_freq, 0.05); // groove period scale (nm-ish)

  vec3 col = vec3(0.0);
  for (int m = 1; m <= 6; m++) {
    if (float(m) > u_orders + 0.5) break;
    float w = coord * pitch / float(m);
    col += (band(w) + band(-w)) / float(m); // +m and -m orders
  }

  // Envelope: rainbow catches strongest near the specular direction and at
  // grazing angles, like a real grating held to the light.
  float spec = pow(max(dot(reflect(-V, N), L), 0.0), 12.0);
  float fres = pow(1.0 - max(dot(N, V), 0.0), 3.0);
  float env = 0.5 + 1.7 * spec + 0.7 * fres;
  col *= env * u_gain;

  // Cheap palette phase so the 🎲 shifts the overall cast.
  col = mix(col, col.gbr, u_hue * 0.5);

  // Dark dielectric base + white specular glint + beat flash.
  vec3 base = vec3(0.015, 0.02, 0.03) + 0.05 * max(dot(N, L), 0.0);
  col += base + vec3(spec) * 0.5;
  col *= 1.0 + u_flash * 1.2;

  gl_FragColor = vec4(col, 1.0);
}`

const material = new THREE.ShaderMaterial({
  uniforms,
  vertexShader: VERT,
  fragmentShader: FRAG,
  side: THREE.DoubleSide,
})

const GEOMS = [
  () => new THREE.CircleGeometry(2, 128), // disc — the classic grating sample
  () => new THREE.TorusKnotGeometry(1.3, 0.42, 220, 32), // continuous rainbow
  () => new THREE.SphereGeometry(1.7, 128, 96),
]
let mesh = null
let builtShape = -1
function buildMesh(shape) {
  if (mesh) {
    scene.remove(mesh)
    mesh.geometry.dispose()
  }
  mesh = new THREE.Mesh(GEOMS[shape](), material)
  scene.add(mesh)
  builtShape = shape
}
buildMesh(params.shape)

function resize() {
  renderer.setSize(window.innerWidth, window.innerHeight)
  camera.aspect = window.innerWidth / window.innerHeight
  camera.updateProjectionMatrix()
}

renderer.setAnimationLoop((now) => {
  rt.tick(now)
  if (params.shape !== builtShape) buildMesh(params.shape)

  uniforms.u_freq.value = params.freq
  uniforms.u_gtype.value = params.gtype
  uniforms.u_swirl.value = params.swirl
  uniforms.u_orders.value = params.orders
  uniforms.u_gain.value = params.gain
  uniforms.u_flash.value = params.flash

  const t = now * 0.001
  mesh.rotation.y = t * params.spin
  mesh.rotation.x = Math.sin(t * params.spin * 0.6) * 0.35
  // A key light that slowly circles so the sheen is always sweeping.
  uniforms.u_lightDir.value.set(Math.cos(t * 0.3) * 0.6, 0.7, Math.sin(t * 0.3) * 0.6).normalize()

  controls.autoRotateSpeed = params.orbit * 2
  controls.update()
  renderer.render(scene, camera)
})

window.addEventListener('resize', resize)
resize()
