/**
 * Soap Film — a film stretched across a wire ring, rendered with real
 * thin-film interference. The fragment shader carries a live thickness field
 * (hundreds of nanometres, swirled by curl-ish noise and draining upward the
 * way a standing film thins at the top until the black film appears) and, for
 * each of three wavelengths (650/550/450 nm), interferes the front- and
 * back-surface reflections: I ∝ cos²(2π·n·d·cosθ / λ). That — plus Fresnel,
 * so the film is nearly invisible face-on and mirror-bright at grazing — is
 * the whole soap-bubble rainbow, physically earned.
 *
 * Drag to orbit; the film ripples on beats and swirls with loudness.
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
  thickness: { value: +rt.random(0.5, 0.85).toFixed(2), min: 0.15, max: 1.5, step: 0.01, label: 'Film thickness' },
  swirl: { value: +rt.random(0.4, 0.9).toFixed(2), min: 0, max: 2, step: 0.02, label: 'Swirl speed' },
  drain: { value: 0.45, min: 0, max: 1, step: 0.02, label: 'Drainage (black film)' },
  ripple: { value: 0.3, min: 0, max: 1, step: 0.02, label: 'Ripple' },
  scale: { value: +rt.random(1.6, 3).toFixed(1), min: 0.8, max: 6, step: 0.1, label: 'Pattern scale' },
  spin: { value: 0.4, min: 0, max: 2, step: 0.05, label: 'Orbit speed' },
  shape: { value: rt.pick(['round', 'square', 'triangle', 'hexagon', 'star', 'heart']), type: 'select', options: ['round', 'square', 'triangle', 'hexagon', 'star', 'heart'], label: 'Wire frame' },
})
// Music: loudness stirs the film, beats slap it into ripples.
rt.mapInput('audio.volume', 'swirl', 0.6)
rt.mapInput('audio.pulse', 'ripple', 0.6)

const scene = new THREE.Scene()
scene.background = new THREE.Color(0x05060c)
const camera = new THREE.PerspectiveCamera(55, 1, 0.1, 100)
camera.position.set(2.0, 0.9, 4.6)

const controls = new OrbitControls(camera, renderer.domElement)
controls.enableDamping = true
controls.autoRotate = true

// The outline radius at angle θ for each frame shape (unit scale — the film
// and wire are both scaled to R below). Corners sit past r=1, so the shader's
// edge term (1 − r²) naturally flattens the film toward them.
const R = 2
function outlineR(t, shape) {
  const poly = (n) => Math.cos(Math.PI / n) / Math.cos(((t % (2 * Math.PI / n)) + 2 * Math.PI / n) % (2 * Math.PI / n) - Math.PI / n)
  switch (shape) {
    case 'square': return poly(4)
    case 'triangle': return poly(3)
    case 'hexagon': return poly(6)
    case 'star': {
      const k = 5
      const seg = ((t % (2 * Math.PI / k)) + 2 * Math.PI / k) % (2 * Math.PI / k)
      return 0.55 + 0.45 * Math.abs(Math.cos(seg * k / 2 * Math.PI / (Math.PI))) // crude 5-point star
    }
    case 'heart': {
      // classic heart curve normalised to ~unit
      const s = Math.sin(t), c = Math.cos(t)
      const x = 16 * s * s * s
      const y = 13 * c - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t)
      return Math.hypot(x, y) / 17
    }
    default: return 1
  }
}
function outlinePoint(t, shape) {
  if (shape === 'heart') {
    const s = Math.sin(t), c = Math.cos(t)
    const x = 16 * s * s * s
    const y = 13 * c - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t)
    return [x / 17 * R, y / 17 * R]
  }
  if (shape === 'star') {
    const k = 5
    const spikes = k * 2
    const idx = Math.round(t / (Math.PI * 2) * spikes)
    // smooth star via alternating radii
    const rr = (Math.floor(t / (Math.PI / k)) % 2 === 0) ? 1 : 0.5
    return [Math.cos(t) * rr * R, Math.sin(t) * rr * R]
  }
  const r = outlineR(t, shape)
  return [Math.cos(t) * r * R, Math.sin(t) * r * R]
}

function buildFilmGeom(shape) {
  const N = 160
  const pos = [0, 0, 0]
  for (let i = 0; i <= N; i++) {
    const t = (i / N) * Math.PI * 2
    const [x, y] = outlinePoint(t, shape)
    pos.push(x, y, 0)
  }
  const idx = []
  for (let i = 1; i <= N; i++) idx.push(0, i, i + 1)
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  g.setIndex(idx)
  return g
}
function buildWireGeom(shape) {
  const N = 200
  const pts = []
  for (let i = 0; i <= N; i++) {
    const t = (i / N) * Math.PI * 2
    const [x, y] = outlinePoint(t, shape)
    pts.push(new THREE.Vector3(x, y, 0))
  }
  const curve = new THREE.CatmullRomCurve3(pts, true)
  return new THREE.TubeGeometry(curve, 240, 0.035, 12, true)
}

// The wire frame holding the film (rebuilt when the shape changes).
const ring = new THREE.Mesh(
  buildWireGeom('round'),
  new THREE.MeshStandardMaterial({ color: 0x9aa4b8, metalness: 0.9, roughness: 0.35 }),
)
scene.add(ring)
// A handle, like a bubble wand.
const handle = new THREE.Mesh(
  new THREE.CylinderGeometry(0.035, 0.045, 1.6, 12),
  new THREE.MeshStandardMaterial({ color: 0x6a7488, metalness: 0.8, roughness: 0.4 }),
)
handle.position.y = -2.75
scene.add(handle)

scene.add(new THREE.AmbientLight(0xffffff, 0.5))
const key = new THREE.PointLight(0xffffff, 80)
key.position.set(5, 6, 4)
scene.add(key)

// --- the film ---------------------------------------------------------------
const filmUniforms = {
  u_time: { value: 0 },
  u_thick: { value: 0.7 },
  u_swirlPhase: { value: 0 },
  u_drain: { value: 0.45 },
  u_ripple: { value: 0.3 },
  u_scale: { value: 2.2 },
  u_beat: { value: 0 },
}
const film = new THREE.Mesh(
  buildFilmGeom('round'),
  new THREE.ShaderMaterial({
    uniforms: filmUniforms,
    transparent: true,
    side: THREE.DoubleSide,
    depthWrite: false,
    vertexShader: `
      uniform float u_time, u_ripple, u_beat;
      varying vec2 vUv2; // centred uv, radius 1 at the ring
      varying vec3 vWorld;
      void main() {
        vUv2 = position.xy / 2.0;
        float r = length(vUv2);
        // The film sags and ripples; beats slap a travelling ring wave into it.
        float edge = 1.0 - r * r; // pinned at the ring
        float z = 0.10 * edge * sin(u_time * 0.9 + r * 4.0)
                + u_ripple * 0.16 * edge * sin(r * 22.0 - u_time * 5.0)
                + u_beat * 0.25 * edge * sin(r * 18.0 - u_beat * 9.0);
        vec3 p = vec3(position.xy, z);
        vec4 w = modelMatrix * vec4(p, 1.0);
        vWorld = w.xyz;
        gl_Position = projectionMatrix * viewMatrix * w;
      }`,
    fragmentShader: `
      precision highp float;
      uniform float u_time, u_thick, u_swirlPhase, u_drain, u_scale;
      varying vec2 vUv2;
      varying vec3 vWorld;

      float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float noise(vec2 p) {
        vec2 i = floor(p), f = fract(p);
        vec2 u = f * f * (3.0 - 2.0 * f);
        return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x),
                   mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
      }
      float fbm(vec2 p) {
        float s = 0.0, a = 0.5;
        for (int k = 0; k < 4; k++) { s += a * noise(p); p = p * 2.03 + 17.7; a *= 0.5; }
        return s;
      }

      void main() {
        float r = length(vUv2);
        if (r > 1.0) discard;

        // Swirled thickness field: the colour bands marble around the film.
        float ang = u_swirlPhase * (0.6 + 0.8 * (1.0 - r));
        mat2 rot = mat2(cos(ang), -sin(ang), sin(ang), cos(ang));
        vec2 q = rot * vUv2;
        float n = fbm(q * u_scale + vec2(0.0, u_swirlPhase * 0.35));
        // Drainage: gravity thins the top of a standing film; where thickness
        // approaches zero the "black film" appears before it pops.
        float grav = mix(1.0, clamp(0.5 - vUv2.y * 0.75, 0.05, 1.0), u_drain);
        float d_nm = (1400.0 * u_thick) * grav * (0.25 + 0.75 * n); // nanometres

        // View geometry: Fresnel + the cosθ term in the optical path.
        vec3 N = normalize(cross(dFdx(vWorld), dFdy(vWorld)));
        vec3 V = normalize(cameraPosition - vWorld);
        float cosT = abs(dot(N, V));
        // Reflectance floor kept high: against a dark room the fringes are
        // vivid even face-on; grazing angles still flare brighter.
        float fres = 0.30 + 0.70 * pow(1.0 - cosT, 2.0);

        // Thin-film interference at three wavelengths (n_film ≈ 1.33).
        float D = 2.0 * 1.33 * d_nm * cosT;
        vec3 lambda = vec3(650.0, 550.0, 450.0);
        vec3 phase = 6.2831853 * D / lambda + 3.14159265; // π shift at the front face
        vec3 col = 0.5 + 0.5 * cos(phase);
        col = pow(col, vec3(1.4)); // deepen the fringes

        // The black film: reflection dies as d → 0.
        float black = smoothstep(60.0, 220.0, d_nm);
        col *= black;

        // A soft white sheen so the film reads as a surface even between fringes.
        vec3 sheen = vec3(0.5, 0.55, 0.62) * 0.10;
        vec3 outCol = (col * 1.7 + sheen) * fres * 3.4;
        float alpha = clamp(fres * (0.5 + 0.5 * black) * 2.2 + 0.05, 0.0, 0.95);
        gl_FragColor = vec4(outCol, alpha);
      }`,
  }),
)
scene.add(film)

let beatKick = 0
rt.onBeat(() => (beatKick = 1))

let lastNow = 0
let swirlPhase = 0
let curShape = 'round'
renderer.setAnimationLoop((now) => {
  rt.tick(now)
  const dt = lastNow ? Math.min(0.05, (now - lastNow) / 1000) : 0.016
  lastNow = now
  swirlPhase += params.swirl * dt
  beatKick *= Math.pow(0.2, dt * 2)

  if (params.shape !== curShape) {
    curShape = params.shape
    film.geometry.dispose(); film.geometry = buildFilmGeom(curShape)
    ring.geometry.dispose(); ring.geometry = buildWireGeom(curShape)
  }

  filmUniforms.u_time.value = now * 0.001
  filmUniforms.u_thick.value = params.thickness
  filmUniforms.u_swirlPhase.value = swirlPhase
  filmUniforms.u_drain.value = params.drain
  filmUniforms.u_ripple.value = params.ripple
  filmUniforms.u_scale.value = params.scale
  filmUniforms.u_beat.value = beatKick

  controls.autoRotateSpeed = params.spin * 2
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
