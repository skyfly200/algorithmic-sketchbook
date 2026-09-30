/**
 * Built-in demo scenes for the filter / effect sketches.
 *
 * A filter is only as easy to judge as the picture it is fed, so these are
 * designed to exercise a wide range of effects at once:
 *   - Landscape:  smooth sky gradients, hard silhouettes, water, saturated and
 *                 neutral colour, skin-tone patches, big and tiny text, moving
 *                 sprites (good for colour grading, painterly, tilt-shift, glow).
 *   - Test chart: greyscale ramps, a colour wheel, a Siemens star, checkerboards
 *                 at several scales, slanted edges and text (good for blur,
 *                 sharpen, edge detect, pixelate, warps, polar).
 *   - Night city: dark scene with neon, lit windows, bokeh-ready point lights,
 *                 light beams and rain (good for glow, bloom, lens flare, CRT, VHS).
 *
 * Each entry's make() returns paint(ctx, t, W, H). Static layers are baked once
 * to an offscreen canvas, so per frame only the moving parts are drawn.
 */

function rng(seed) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// Bake a static layer once, re-bake if the target size changes.
function baked(draw) {
  let c = null
  return (W, H) => {
    if (!c || c.width !== W || c.height !== H) {
      c = document.createElement('canvas')
      c.width = W
      c.height = H
      draw(c.getContext('2d'), W, H)
    }
    return c
  }
}

const TAU = Math.PI * 2

function ridge(g, W, base, amp, seedv, color, detail = 9, snow = false) {
  const r = rng(seedv)
  const pts = []
  const n = 40
  for (let i = 0; i <= n; i++) {
    const x = (i / n) * W
    const k = Math.sin(i * 0.55 + seedv) * 0.5 + Math.sin(i * 1.3 + seedv * 2) * 0.3 + (r() - 0.5) * detail * 0.1
    pts.push([x, base - amp * (0.55 + k)])
  }
  g.fillStyle = color
  g.beginPath()
  g.moveTo(0, base + 400)
  for (const [x, y] of pts) g.lineTo(x, y)
  g.lineTo(W, base + 400)
  g.closePath()
  g.fill()
  if (snow) {
    g.fillStyle = 'rgba(255,255,255,0.92)'
    for (let i = 1; i < pts.length - 1; i++) {
      const [x, y] = pts[i]
      if (y < base - amp * 0.95) {
        g.beginPath()
        g.moveTo(x, y)
        g.lineTo(x - 9, y + 14)
        g.lineTo(x + 9, y + 14)
        g.closePath()
        g.fill()
      }
    }
  }
}

function pine(g, x, y, s, color) {
  g.fillStyle = color
  for (let k = 0; k < 4; k++) {
    const w = s * (0.9 - k * 0.17)
    const yy = y - k * s * 0.42
    g.beginPath()
    g.moveTo(x, yy - s * 0.7)
    g.lineTo(x - w * 0.5, yy)
    g.lineTo(x + w * 0.5, yy)
    g.closePath()
    g.fill()
  }
  g.fillRect(x - s * 0.05, y, s * 0.1, s * 0.3)
}

function colorBar(g, x, y, w, h) {
  const n = 12
  for (let i = 0; i < n; i++) {
    g.fillStyle = `hsl(${(i / n) * 360}, 85%, 52%)`
    g.fillRect(x + (i * w) / 2 / n, y, w / 2 / n + 1, h)
  }
  for (let i = 0; i < 8; i++) {
    const v = Math.round((i / 7) * 255)
    g.fillStyle = `rgb(${v},${v},${v})`
    g.fillRect(x + w / 2 + (i * w) / 2 / 8, y, w / 2 / 8 + 1, h)
  }
  g.strokeStyle = 'rgba(0,0,0,0.6)'
  g.lineWidth = 1
  g.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1)
}

// ---------------------------------------------------------------------------
// 1. Landscape
function landscape() {
  const bg = baked((g, W, H) => {
    const hz = H * 0.62
    const sky = g.createLinearGradient(0, 0, 0, hz)
    sky.addColorStop(0, '#0d1838')
    sky.addColorStop(0.45, '#5a4389')
    sky.addColorStop(0.8, '#e8845f')
    sky.addColorStop(1, '#ffd9a0')
    g.fillStyle = sky
    g.fillRect(0, 0, W, hz)
    // stars in the dark part
    const r = rng(7)
    for (let i = 0; i < 70; i++) {
      g.fillStyle = `rgba(255,255,255,${0.3 + r() * 0.6})`
      const s = r() < 0.15 ? 2 : 1
      g.fillRect(r() * W, r() * hz * 0.45, s, s)
    }
    // sun
    const sx = W * 0.72
    const sy = hz - H * 0.08
    const halo = g.createRadialGradient(sx, sy, 0, sx, sy, H * 0.42)
    halo.addColorStop(0, 'rgba(255,236,190,0.9)')
    halo.addColorStop(0.25, 'rgba(255,170,110,0.35)')
    halo.addColorStop(1, 'rgba(255,120,90,0)')
    g.fillStyle = halo
    g.fillRect(0, 0, W, hz)
    g.fillStyle = '#fff6dc'
    g.beginPath()
    g.arc(sx, sy, H * 0.055, 0, TAU)
    g.fill()
    // ridges, far to near
    ridge(g, W, hz, H * 0.26, 3, '#6a5a9c', 9, true)
    ridge(g, W, hz, H * 0.18, 11, '#3f3a78', 7)
    ridge(g, W, hz + 4, H * 0.1, 19, '#1f2350', 5)
    // water
    const w = g.createLinearGradient(0, hz, 0, H)
    w.addColorStop(0, '#e9a673')
    w.addColorStop(0.15, '#57457c')
    w.addColorStop(1, '#0c1330')
    g.fillStyle = w
    g.fillRect(0, hz, W, H - hz)
    // reflected sun column
    const rs = g.createLinearGradient(0, hz, 0, H)
    rs.addColorStop(0, 'rgba(255,220,160,0.75)')
    rs.addColorStop(1, 'rgba(255,220,160,0)')
    g.fillStyle = rs
    g.fillRect(sx - H * 0.05, hz, H * 0.1, (H - hz) * 0.8)
    // fine ripple lines (high-frequency detail)
    g.strokeStyle = 'rgba(255,255,255,0.10)'
    g.lineWidth = 1
    for (let y = hz + 6; y < H; y += 5) {
      g.beginPath()
      g.moveTo(0, y + 0.5)
      g.lineTo(W, y + 0.5)
      g.stroke()
    }
    // pines
    for (let i = 0; i < 7; i++) pine(g, W * 0.03 + i * W * 0.028, hz + H * 0.12, H * (0.16 + (i % 3) * 0.04), '#070a18')
    for (let i = 0; i < 5; i++) pine(g, W * 0.9 + i * W * 0.03, hz + H * 0.14, H * (0.2 + (i % 2) * 0.05), '#070a18')
    // skin-tone swatches + chart
    const skin = ['#f3d2b8', '#d9a07a', '#a86b4a', '#5e3a2a']
    skin.forEach((c, i) => {
      g.fillStyle = c
      g.beginPath()
      g.arc(W * 0.06 + i * H * 0.085, H * 0.26, H * 0.038, 0, TAU)
      g.fill()
    })
    colorBar(g, W * 0.04, H * 0.92, W * 0.34, H * 0.05)
    // text: big + tiny
    g.fillStyle = '#fff'
    g.font = `800 ${Math.round(H * 0.065)}px system-ui, sans-serif`
    g.textBaseline = 'top'
    g.fillText('ALGORITHMIC', W * 0.04, H * 0.05)
    g.fillStyle = '#ffd98a'
    g.fillText('SKETCHBOOK', W * 0.04, H * 0.05 + H * 0.07)
    g.fillStyle = 'rgba(255,255,255,0.85)'
    g.font = `${Math.round(H * 0.018)}px system-ui, sans-serif`
    g.fillText('The quick brown fox jumps over the lazy dog 0123456789', W * 0.04, H * 0.2)
  })
  const balls = [
    { hue: 350, r: 0.045, fx: 0.7, fy: 1.1, px: 0.3, py: 1.2 },
    { hue: 160, r: 0.035, fx: 1.1, fy: 0.8, px: 2.2, py: 0.4 },
    { hue: 50, r: 0.03, fx: 0.9, fy: 1.4, px: 4.1, py: 2.4 },
  ]
  return (d, t, W, H) => {
    d.drawImage(bg(W, H), 0, 0)
    // drifting clouds
    for (let i = 0; i < 4; i++) {
      const x = ((t * 14 * (0.6 + i * 0.25) + i * W * 0.3) % (W * 1.4)) - W * 0.2
      const y = H * (0.12 + i * 0.07)
      const cl = d.createRadialGradient(x, y, 0, x, y, H * 0.12)
      cl.addColorStop(0, 'rgba(255,190,170,0.35)')
      cl.addColorStop(1, 'rgba(255,190,170,0)')
      d.fillStyle = cl
      d.save()
      d.translate(x, y)
      d.scale(2.6, 0.55)
      d.translate(-x, -y)
      d.fillRect(x - H * 0.12, y - H * 0.12, H * 0.24, H * 0.24)
      d.restore()
    }
    // birds
    d.strokeStyle = '#0a0a18'
    d.lineWidth = 2
    for (let i = 0; i < 5; i++) {
      const x = (((t * 40 + i * 140) % (W + 100)) - 50)
      const y = H * 0.3 + Math.sin(t * 1.3 + i) * H * 0.04 + i * H * 0.02
      const f = Math.sin(t * 9 + i * 2) * 5
      d.beginPath()
      d.moveTo(x - 12, y + f)
      d.quadraticCurveTo(x - 6, y - 4, x, y)
      d.quadraticCurveTo(x + 6, y - 4, x + 12, y + f)
      d.stroke()
    }
    // bouncing balls with a hard edge + specular highlight
    for (const b of balls) {
      const x = W * (0.12 + 0.76 * (0.5 + 0.5 * Math.sin(t * b.fx + b.px)))
      const y = H * (0.42 + 0.3 * Math.abs(Math.sin(t * b.fy + b.py)))
      const r = H * b.r
      const g2 = d.createRadialGradient(x - r * 0.35, y - r * 0.4, r * 0.1, x, y, r)
      g2.addColorStop(0, `hsl(${b.hue},90%,78%)`)
      g2.addColorStop(1, `hsl(${b.hue},85%,38%)`)
      d.fillStyle = g2
      d.beginPath()
      d.arc(x, y, r, 0, TAU)
      d.fill()
      d.strokeStyle = 'rgba(0,0,0,0.55)'
      d.lineWidth = 1.5
      d.stroke()
    }
    // water glints
    d.fillStyle = 'rgba(255,240,200,0.8)'
    for (let i = 0; i < 18; i++) {
      const x = W * 0.72 + Math.sin(t * 1.7 + i * 3.1) * W * 0.05
      const y = H * 0.64 + ((i * 37 + Math.floor(t * 3 + i)) % 20) * H * 0.014
      d.fillRect(x, y, 6 + (i % 4) * 4, 1.5)
    }
  }
}

// ---------------------------------------------------------------------------
// 2. Test chart
function chart() {
  const bg = baked((g, W, H) => {
    g.fillStyle = '#6b6b70'
    g.fillRect(0, 0, W, H)
    // greyscale steps + smooth ramp
    const top = H * 0.04
    const steps = 16
    for (let i = 0; i < steps; i++) {
      const v = Math.round((i / (steps - 1)) * 255)
      g.fillStyle = `rgb(${v},${v},${v})`
      g.fillRect(W * 0.04 + (i * W * 0.44) / steps, top, (W * 0.44) / steps + 1, H * 0.07)
    }
    const ramp = g.createLinearGradient(W * 0.04, 0, W * 0.48, 0)
    ramp.addColorStop(0, '#000')
    ramp.addColorStop(1, '#fff')
    g.fillStyle = ramp
    g.fillRect(W * 0.04, top + H * 0.08, W * 0.44, H * 0.05)
    // colour wheel
    const cx = W * 0.2
    const cy = H * 0.45
    const R = H * 0.22
    for (let a = 0; a < 360; a += 2) {
      const s = g.createRadialGradient(cx, cy, 0, cx, cy, R)
      s.addColorStop(0, '#fff')
      s.addColorStop(1, `hsl(${a},100%,50%)`)
      g.fillStyle = s
      g.beginPath()
      g.moveTo(cx, cy)
      g.arc(cx, cy, R, ((a - 1) * Math.PI) / 180, ((a + 1.2) * Math.PI) / 180)
      g.closePath()
      g.fill()
    }
    // Siemens star
    const sx = W * 0.5
    const sy = H * 0.45
    const SR = H * 0.22
    g.fillStyle = '#f4f4f4'
    g.beginPath()
    g.arc(sx, sy, SR, 0, TAU)
    g.fill()
    g.fillStyle = '#111'
    const spokes = 48
    for (let i = 0; i < spokes; i++) {
      const a0 = (i / spokes) * TAU
      const a1 = a0 + TAU / spokes / 2
      g.beginPath()
      g.moveTo(sx, sy)
      g.arc(sx, sy, SR, a0, a1)
      g.closePath()
      g.fill()
    }
    // checkerboards at three scales
    const cb = (x, y, w, h, s) => {
      for (let j = 0; j < h / s; j++)
        for (let i = 0; i < w / s; i++) {
          g.fillStyle = (i + j) % 2 ? '#fafafa' : '#141414'
          g.fillRect(x + i * s, y + j * s, s, s)
        }
    }
    cb(W * 0.72, H * 0.06, W * 0.12, H * 0.16, H * 0.04)
    cb(W * 0.72 + W * 0.13, H * 0.06, W * 0.12, H * 0.16, H * 0.02)
    cb(W * 0.72 + W * 0.26 - W * 0.12, H * 0.25, W * 0.12, H * 0.08, H * 0.008)
    // slanted edge + concentric circles
    g.fillStyle = '#eee'
    g.beginPath()
    g.moveTo(W * 0.72, H * 0.4)
    g.lineTo(W * 0.85, H * 0.4)
    g.lineTo(W * 0.85, H * 0.55)
    g.lineTo(W * 0.72, H * 0.52)
    g.closePath()
    g.fill()
    g.strokeStyle = '#111'
    g.lineWidth = 1.5
    for (let r = 4; r < H * 0.13; r += 4 + r * 0.05) {
      g.beginPath()
      g.arc(W * 0.92, H * 0.47, r, 0, TAU)
      g.stroke()
    }
    // RGB / CMY primaries
    const prim = ['#f00', '#0f0', '#00f', '#0ff', '#f0f', '#ff0']
    prim.forEach((c, i) => {
      g.fillStyle = c
      g.fillRect(W * 0.04 + i * W * 0.075, H * 0.74, W * 0.07, H * 0.08)
    })
    // text at several sizes
    g.fillStyle = '#fff'
    g.textBaseline = 'top'
    ;[0.06, 0.035, 0.022, 0.014].forEach((s, i) => {
      g.font = `${i === 0 ? 800 : 500} ${Math.round(H * s)}px system-ui, sans-serif`
      g.fillText(i === 0 ? 'TEST CHART' : 'Sphinx of black quartz, judge my vow 0123456789', W * 0.52, H * (0.6 + i * 0.07 + (i ? 0.03 : 0)))
    })
    // bottom ramps: hue sweep + saturation sweep
    const hue = g.createLinearGradient(W * 0.04, 0, W * 0.96, 0)
    for (let i = 0; i <= 12; i++) hue.addColorStop(i / 12, `hsl(${(i / 12) * 360},90%,50%)`)
    g.fillStyle = hue
    g.fillRect(W * 0.04, H * 0.88, W * 0.92, H * 0.04)
    const sat = g.createLinearGradient(W * 0.04, 0, W * 0.96, 0)
    sat.addColorStop(0, '#808080')
    sat.addColorStop(1, '#ff6a00')
    g.fillStyle = sat
    g.fillRect(W * 0.04, H * 0.93, W * 0.92, H * 0.04)
  })
  return (d, t, W, H) => {
    d.drawImage(bg(W, H), 0, 0)
    // a sweeping bar + a rotating wedge make motion visible to temporal filters
    const sx = W * 0.5
    const sy = H * 0.45
    const a = t * 1.2
    d.strokeStyle = 'rgba(255,60,60,0.9)'
    d.lineWidth = 3
    d.beginPath()
    d.moveTo(sx, sy)
    d.lineTo(sx + Math.cos(a) * H * 0.22, sy + Math.sin(a) * H * 0.22)
    d.stroke()
    const bx = W * (0.04 + 0.92 * (0.5 + 0.5 * Math.sin(t * 0.8)))
    d.fillStyle = '#fff'
    d.fillRect(bx - 2, H * 0.72, 4, H * 0.27)
    // pulsing + bouncing shapes
    const pr = H * (0.03 + 0.012 * Math.sin(t * 3))
    d.fillStyle = '#ffd400'
    d.beginPath()
    d.arc(W * 0.36, H * 0.12 + Math.abs(Math.sin(t * 1.4)) * H * 0.1, pr, 0, TAU)
    d.fill()
    d.strokeStyle = '#000'
    d.lineWidth = 2
    d.stroke()
    d.save()
    d.translate(W * 0.6, H * 0.14)
    d.rotate(t * 0.9)
    d.fillStyle = '#2a7bff'
    d.fillRect(-H * 0.035, -H * 0.035, H * 0.07, H * 0.07)
    d.restore()
  }
}

// ---------------------------------------------------------------------------
// 3. Night city
function city() {
  const bg = baked((g, W, H) => {
    const hz = H * 0.66
    const sky = g.createLinearGradient(0, 0, 0, hz)
    sky.addColorStop(0, '#05051a')
    sky.addColorStop(0.6, '#2a1250')
    sky.addColorStop(1, '#b4356b')
    g.fillStyle = sky
    g.fillRect(0, 0, W, hz)
    const r = rng(21)
    // skyline, three depths
    const layers = [
      { col: '#231245', hmin: 0.14, hmax: 0.34, wmin: 0.03, wmax: 0.07, win: 0.25 },
      { col: '#150a30', hmin: 0.1, hmax: 0.3, wmin: 0.04, wmax: 0.09, win: 0.4 },
      { col: '#0a0518', hmin: 0.06, hmax: 0.22, wmin: 0.05, wmax: 0.11, win: 0.5 },
    ]
    for (const L of layers) {
      let x = -W * 0.02
      while (x < W) {
        const w = W * (L.wmin + r() * (L.wmax - L.wmin))
        const h = H * (L.hmin + r() * (L.hmax - L.hmin))
        g.fillStyle = L.col
        g.fillRect(x, hz - h, w, h)
        for (let wy = hz - h + 8; wy < hz - 6; wy += 11) {
          for (let wx = x + 6; wx < x + w - 6; wx += 9) {
            if (r() < L.win) {
              g.fillStyle = r() < 0.15 ? '#8ff' : r() < 0.5 ? '#ffd27a' : '#ffb35c'
              g.fillRect(wx, wy, 4, 6)
            }
          }
        }
        x += w + 2
      }
    }
    // road + wet reflections
    const road = g.createLinearGradient(0, hz, 0, H)
    road.addColorStop(0, '#2a1438')
    road.addColorStop(1, '#07030f')
    g.fillStyle = road
    g.fillRect(0, hz, W, H - hz)
    // neon signs (pink, cyan, amber) with glow
    const signs = [
      [0.12, '#ff2e93', 'OPEN'],
      [0.42, '#22e6ff', 'HOTEL'],
      [0.74, '#ffb02e', 'BAR'],
    ]
    for (const [fx, col, txt] of signs) {
      const x = W * fx
      const y = hz - H * 0.18
      g.save()
      g.shadowColor = col
      g.shadowBlur = 24
      g.strokeStyle = col
      g.lineWidth = 4
      g.strokeRect(x, y, W * 0.12, H * 0.07)
      g.fillStyle = col
      g.font = `800 ${Math.round(H * 0.045)}px system-ui, sans-serif`
      g.textBaseline = 'middle'
      g.fillText(txt, x + W * 0.012, y + H * 0.037)
      g.restore()
      // wet-road reflection streak
      const refl = g.createLinearGradient(0, hz, 0, H)
      refl.addColorStop(0, col + '99')
      refl.addColorStop(1, col + '00')
      g.fillStyle = refl
      g.fillRect(x, hz, W * 0.12, (H - hz) * 0.9)
    }
    // dashed lane markings
    g.fillStyle = 'rgba(255,255,255,0.55)'
    for (let i = 0; i < 9; i++) {
      const y = hz + (H - hz) * (0.1 + i * 0.1)
      const w = 4 + i * 2.2
      g.fillRect(W * 0.5 - w / 2, y, w, 6 + i * 1.4)
    }
  })
  return (d, t, W, H) => {
    d.drawImage(bg(W, H), 0, 0)
    const hz = H * 0.66
    d.globalCompositeOperation = 'lighter'
    // searchlight beams
    for (let k = 0; k < 2; k++) {
      const a = -Math.PI / 2 + Math.sin(t * 0.6 + k * 2) * 0.5
      const x0 = W * (0.25 + k * 0.5)
      const g = d.createLinearGradient(x0, hz, x0 + Math.cos(a) * H, hz + Math.sin(a) * H)
      g.addColorStop(0, 'rgba(180,220,255,0.35)')
      g.addColorStop(1, 'rgba(180,220,255,0)')
      d.fillStyle = g
      d.beginPath()
      d.moveTo(x0, hz)
      d.lineTo(x0 + Math.cos(a - 0.05) * H, hz + Math.sin(a - 0.05) * H)
      d.lineTo(x0 + Math.cos(a + 0.05) * H, hz + Math.sin(a + 0.05) * H)
      d.closePath()
      d.fill()
    }
    // cars: headlight pairs with soft glow, travelling along the road
    for (let i = 0; i < 6; i++) {
      const dir = i % 2 ? 1 : -1
      const f = (t * 0.12 * (0.7 + (i % 3) * 0.3) + i * 0.17) % 1
      const z = dir > 0 ? f : 1 - f
      const y = hz + (H - hz) * (0.08 + z * 0.8)
      const x = W * (0.5 + dir * (0.03 + z * 0.22))
      const s = 2 + z * 14
      for (const dx of [-1, 1]) {
        const gl = d.createRadialGradient(x + dx * s * 2.4, y, 0, x + dx * s * 2.4, y, s * 4)
        const c = dir > 0 ? '255,240,200' : '255,60,60'
        gl.addColorStop(0, `rgba(${c},0.95)`)
        gl.addColorStop(0.3, `rgba(${c},0.35)`)
        gl.addColorStop(1, `rgba(${c},0)`)
        d.fillStyle = gl
        d.fillRect(x + dx * s * 2.4 - s * 4, y - s * 4, s * 8, s * 8)
      }
    }
    // a blinking drone light
    const dx = W * (0.2 + 0.6 * (0.5 + 0.5 * Math.sin(t * 0.4)))
    const dy = H * 0.2 + Math.sin(t * 0.9) * H * 0.04
    const blink = Math.sin(t * 7) > 0 ? 1 : 0.25
    const dg = d.createRadialGradient(dx, dy, 0, dx, dy, 22)
    dg.addColorStop(0, `rgba(255,70,70,${blink})`)
    dg.addColorStop(1, 'rgba(255,70,70,0)')
    d.fillStyle = dg
    d.fillRect(dx - 22, dy - 22, 44, 44)
    d.globalCompositeOperation = 'source-over'
    // rain streaks
    d.strokeStyle = 'rgba(200,220,255,0.35)'
    d.lineWidth = 1
    d.beginPath()
    for (let i = 0; i < 90; i++) {
      const x = ((i * 97.3) % W)
      const y = (((t * 520 + i * 61.7) % (H + 40)) - 20)
      d.moveTo(x, y)
      d.lineTo(x - 3, y + 16)
    }
    d.stroke()
  }
}

export const DEMOS = [
  { name: 'Landscape', make: landscape },
  { name: 'Test chart', make: chart },
  { name: 'Night city', make: city },
]
