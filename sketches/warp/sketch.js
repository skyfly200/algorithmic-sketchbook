// Warp — a live displacement filter over any source (camera / dropped media /
// demo / the Mixer-Patch layers below). The source is baked into a buffer and
// redrawn through an animated warp field using a triangle mesh, so ripples,
// swirls, waves, pinch/bulge and a fisheye lens bend the image in real time.
// The distortion amount, frequency and speed are live params, mappable to the
// music, so beats can pump the warp.
import { createRuntime } from '../_lib/runtime.js'
import { createSource } from '../_lib/source.js'

const rt = createRuntime()
const params = rt.params({
  pattern: {
    value: 'Ripple', type: 'select',
    options: ['Ripple', 'Swirl', 'Waves', 'Pinch', 'Bulge', 'Fisheye'],
    label: 'Warp pattern',
  },
  amount: { value: 0.5, min: 0, max: 1.5, step: 0.02, label: 'Amount' },
  frequency: { value: 0.5, min: 0.1, max: 2, step: 0.02, label: 'Frequency' },
  speed: { value: 1, min: 0, max: 4, step: 0.05, label: 'Speed' },
  // Crop-to-fill: overscan the warped mesh so distortions that pull the image
  // inward (pinch, fisheye, big ripples) never reveal the background at the
  // edges — the output always fills the frame.
  fill: { value: true, type: 'bool', label: 'Crop to fill' },
  fillZoom: { value: 1.2, min: 1, max: 2, step: 0.02, label: 'Fill overscan' },
  mirror: { value: false, type: 'bool', label: 'Mirror (selfie)' },
})
// Beats and loudness pump the warp by default.
rt.mapInput('audio.pulse', 'amount', 0.5)
rt.mapInput('audio.level', 'frequency', 0.3)

const canvas = document.getElementById('canvas')
const ctx = canvas.getContext('2d')

// Demo source: a bold colour grid so the distortion is easy to read.
const src = createSource({
  demo(c, t, w, h) {
    c.fillStyle = '#0a0d16'
    c.fillRect(0, 0, w, h)
    const n = 12
    const cw = w / n, ch = h / n
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        const hue = ((x + y) * 18 + t * 20) % 360
        c.fillStyle = (x + y) % 2 ? `hsl(${hue}, 70%, 55%)` : `hsl(${(hue + 40) % 360}, 60%, 22%)`
        c.fillRect(x * cw, y * ch, cw, ch)
      }
    }
    // a bright ring so radial warps show clearly
    c.strokeStyle = 'rgba(255,255,255,0.85)'
    c.lineWidth = Math.max(3, w * 0.006)
    c.beginPath(); c.arc(w / 2, h / 2, Math.min(w, h) * 0.32, 0, Math.PI * 2); c.stroke()
  },
})

// A buffer holding the undistorted source; the mesh samples from it.
const buf = document.createElement('canvas')
const bctx = buf.getContext('2d')

let W = 0, H = 0
function resize() {
  W = canvas.width = Math.floor(window.innerWidth * rt.pixelRatio)
  H = canvas.height = Math.floor(window.innerHeight * rt.pixelRatio)
  buf.width = W
  buf.height = H
}

// Affine-map a source triangle onto a destination triangle and stamp the
// buffer through it (canvas texture-mapping). Dest triangle is expanded a hair
// from its centroid to hide seams between neighbouring cells.
function drawTri(img, s0, s1, s2, d0, d1, d2) {
  const gx = (d0[0] + d1[0] + d2[0]) / 3
  const gy = (d0[1] + d1[1] + d2[1]) / 3
  const k = 1.02
  const ex0 = gx + (d0[0] - gx) * k, ey0 = gy + (d0[1] - gy) * k
  const ex1 = gx + (d1[0] - gx) * k, ey1 = gy + (d1[1] - gy) * k
  const ex2 = gx + (d2[0] - gx) * k, ey2 = gy + (d2[1] - gy) * k
  ctx.save()
  ctx.beginPath()
  ctx.moveTo(ex0, ey0); ctx.lineTo(ex1, ey1); ctx.lineTo(ex2, ey2); ctx.closePath()
  ctx.clip()
  const [x0, y0] = s0, [x1, y1] = s1, [x2, y2] = s2
  const [u0, v0] = d0, [u1, v1] = d1, [u2, v2] = d2
  const den = x0 * (y1 - y2) + x1 * (y2 - y0) + x2 * (y0 - y1)
  if (Math.abs(den) < 1e-6) { ctx.restore(); return }
  const a = (u0 * (y1 - y2) + u1 * (y2 - y0) + u2 * (y0 - y1)) / den
  const b = (v0 * (y1 - y2) + v1 * (y2 - y0) + v2 * (y0 - y1)) / den
  const c = (u0 * (x2 - x1) + u1 * (x0 - x2) + u2 * (x1 - x0)) / den
  const d = (v0 * (x2 - x1) + v1 * (x0 - x2) + v2 * (x1 - x0)) / den
  const e = (u0 * (x1 * y2 - x2 * y1) + u1 * (x2 * y0 - x0 * y2) + u2 * (x0 * y1 - x1 * y0)) / den
  const f = (v0 * (x1 * y2 - x2 * y1) + v1 * (x2 * y0 - x0 * y2) + v2 * (x0 * y1 - x1 * y0)) / den
  ctx.setTransform(a, b, c, d, e, f)
  ctx.drawImage(img, 0, 0)
  ctx.restore()
}

// Map a normalized source point (u,v in 0..1) to its distorted screen
// position. Returns pixel coords. `amt`/`fq`/`ph` fold the params in.
function warpPoint(u, v, amt, fq, ph) {
  const p = params.pattern
  let nu = u, nv = v
  if (p === 'Waves') {
    nu = u + amt * 0.06 * Math.sin(v * fq * 12 + ph)
    nv = v + amt * 0.06 * Math.sin(u * fq * 12 + ph * 1.2)
  } else {
    const cx = u - 0.5, cy = v - 0.5
    const r = Math.hypot(cx, cy) + 1e-5
    if (p === 'Ripple') {
      const off = amt * 0.05 * Math.sin(r * fq * 40 - ph * 3)
      nu = u + (cx / r) * off
      nv = v + (cy / r) * off
    } else if (p === 'Swirl') {
      const rot = amt * 3.2 * Math.max(0, 0.5 - r) + Math.sin(ph) * amt * 0.4
      const cs = Math.cos(rot), sn = Math.sin(rot)
      nu = 0.5 + cx * cs - cy * sn
      nv = 0.5 + cx * sn + cy * cs
    } else if (p === 'Pinch') {
      const k = 1 - amt * 0.6 * Math.max(0, 0.5 - r) * 2 * (0.7 + 0.3 * Math.sin(ph))
      nu = 0.5 + cx * k
      nv = 0.5 + cy * k
    } else if (p === 'Bulge') {
      const k = 1 + amt * 0.8 * Math.max(0, 0.5 - r) * 2 * (0.7 + 0.3 * Math.sin(ph))
      nu = 0.5 + cx * k
      nv = 0.5 + cy * k
    } else if (p === 'Fisheye') {
      const rn = Math.min(1, r / 0.5)
      const k = 1 - amt * 0.5 * (1 - rn * rn) * (0.8 + 0.2 * Math.sin(ph))
      nu = 0.5 + cx * k
      nv = 0.5 + cy * k
    }
  }
  // Crop-to-fill: overscan about the centre so inward warps still cover the frame.
  if (params.fill) {
    const z = params.fillZoom
    nu = 0.5 + (nu - 0.5) * z
    nv = 0.5 + (nv - 0.5) * z
  }
  return [nu * W, nv * H]
}

function frame(now) {
  rt.tick(now)
  const t = now * 0.001
  src.update(t)
  if (!src.ready) { requestAnimationFrame(frame); return }

  // Bake the current source into the buffer.
  src.draw(bctx, W, H, { mirror: params.mirror })

  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.fillStyle = '#05060a'
  ctx.fillRect(0, 0, W, H)

  const amt = params.amount
  const fq = params.frequency
  const ph = t * params.speed
  // Mesh resolution scales with quality; radial patterns need a finer grid.
  const cols = Math.max(8, Math.round(30 * rt.detail))
  const rows = Math.max(6, Math.round(cols * (H / W)))

  // Precompute the distorted position of every grid node once.
  const pts = []
  for (let j = 0; j <= rows; j++) {
    const row = []
    for (let i = 0; i <= cols; i++) {
      row.push(warpPoint(i / cols, j / rows, amt, fq, ph))
    }
    pts.push(row)
  }

  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const su0 = (i / cols) * W, sv0 = (j / rows) * H
      const su1 = ((i + 1) / cols) * W, sv1 = (j / rows) * H
      const su2 = (i / cols) * W, sv2 = ((j + 1) / rows) * H
      const su3 = ((i + 1) / cols) * W, sv3 = ((j + 1) / rows) * H
      const d0 = pts[j][i], d1 = pts[j][i + 1], d2 = pts[j + 1][i], d3 = pts[j + 1][i + 1]
      drawTri(buf, [su0, sv0], [su1, sv1], [su2, sv2], d0, d1, d2)
      drawTri(buf, [su1, sv1], [su3, sv3], [su2, sv2], d1, d3, d2)
    }
  }
  ctx.setTransform(1, 0, 0, 1, 0, 0)

  requestAnimationFrame(frame)
}

window.addEventListener('resize', resize)
resize()
requestAnimationFrame(frame)
