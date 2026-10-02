#!/usr/bin/env node
/**
 * Performance audit: rates every sketch by static complexity, not by timing.
 * Timing many sketches on one machine is noisy and slow, and concurrent runs
 * skew each other. The source is scored for the work it does per frame.
 *
 * Output: src/registry/perf.json, slug -> 1-100 (100 = light, 1 = heavy).
 * The gallery shows it until the viewer's live fps monitor (localPerf.js)
 * records a real on-device score for that sketch.
 *
 * Measured frame times from bench/*.json are blended in at 80% (`npm run bench -- --out`).
 *
 * Run: npm run perf           (rewrite perf.json)
 *      npm run perf -- --table (print the ranked table, no write)
 */
import { readdirSync, existsSync, writeFileSync, readFileSync } from 'node:fs'

// Measured frame times (bench/*.json, newest file per sketch wins) outweigh the static score.
const MEASURED_WEIGHT = 0.8
const toMeasuredScore = (ms) => Math.max(1, Math.min(100, Math.round(100 - 95 * Math.log2(Math.max(2, ms) / 2) / Math.log2(200))))
function loadBench() {
  const out = {}
  if (!existsSync('bench')) return out
  for (const f of readdirSync('bench').filter((n) => n.endsWith('.json')).sort()) {
    try {
      for (const r of JSON.parse(readFileSync(`bench/${f}`, 'utf8')).results ?? []) if (r.frameMs > 0) out[r.slug] = r.frameMs
    } catch { /* ignore unreadable file */ }
  }
  return out
}
const bench = loadBench()

const count = (src, re) => (src.match(re) || []).length
const read = (p) => (existsSync(p) ? readFileSync(p, 'utf8') : '')

// Strip comments so prose does not trigger a signal.
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')

// Deepest nesting of `for`/`while` loops (brace depth heuristic).
function loopDepth(src) {
  let depth = 0, max = 0
  const stack = []
  const re = /\b(for|while)\b\s*\(|[{}]/g
  let m, pendingLoop = false
  while ((m = re.exec(src))) {
    if (m[0] === '{') { stack.push(pendingLoop); if (pendingLoop) { depth++; max = Math.max(max, depth) } pendingLoop = false }
    else if (m[0] === '}') { if (stack.pop()) depth-- }
    else {
      // brace-less loop bodies still count as one level for this statement
      pendingLoop = true
      max = Math.max(max, depth + 1)
    }
  }
  return max
}

// Complexity points. Each term is a unit of per-frame work; the total maps to a score.
function complexity(slug) {
  const dir = `sketches/${slug}`
  const meta = JSON.parse(read(`${dir}/sketch.json`) || '{}')
  const js = strip(read(`${dir}/sketch.js`))
  const html = strip(read(`${dir}/index.html`))
  const src = js + '\n' + html
  const tech = meta.tech ?? []
  const parts = {}

  // Rendering backend sets the base cost.
  parts.base = tech.includes('three') || /\bTHREE\./.test(src) ? 14 : tech.includes('webgl') || /getContext\(['"]webgl/.test(src) ? 8 : 4

  // Source size is a weak proxy for the number of passes and features.
  parts.size = Math.min(10, js.length / 2500)

  // CPU pixel work: reading and writing every pixel each frame.
  parts.pixels = (/getImageData/.test(src) ? 10 : 0) + (/putImageData/.test(src) ? 6 : 0)

  // Loop nesting: 2D loops over a grid are O(W*H); deeper is worse.
  const depth = loopDepth(js)
  parts.loops = depth >= 3 ? 14 : depth === 2 ? 7 : depth === 1 ? 2 : 0

  // Iterative solvers and multi-pass simulation.
  const iters = [...src.matchAll(/\b(?:iter(?:ation)?s?|steps?|passes|octaves|samples|taps|layers)\w*\s*[=:]\s*(\d+)/gi)].map((m) => +m[1])
  parts.iter = Math.min(14, iters.reduce((a, n) => a + Math.log2(1 + Math.min(n, 256)), 0))

  // Shader cost: loops in GLSL, noise/fbm calls, texture fetches, extra framebuffers.
  const glsl = [...src.matchAll(/`([^`]*(?:gl_FragColor|fragColor|precision\s+\w+\s+float)[^`]*)`/g)].map((m) => m[1]).join('\n')
  parts.shader = Math.min(20,
    count(glsl, /\bfor\s*\(/g) * 3 +
    count(glsl, /\b(?:fbm|noise|snoise|pnoise|simplex|perlin)\w*\s*\(/gi) * 1.5 +
    count(glsl, /\btexture(?:2D)?\s*\(/g) * 0.75 +
    count(glsl, /\b(?:sin|cos|pow|exp|log|atan)\s*\(/g) * 0.15)
  parts.fbo = Math.min(12, count(src, /createFramebuffer|createRenderTarget|WebGLRenderTarget|createTexture/g) * 1.5)

  // Per-frame canvas filters, shadows and blur are expensive raster ops.
  parts.raster = Math.min(14, count(src, /\bfilter\s*=|shadowBlur|createRadialGradient|globalCompositeOperation|drawImage/g) * 0.8 + (/blur\(/.test(src) ? 4 : 0))

  // Particle / agent counts.
  const counts = [...src.matchAll(/\b(?:N|COUNT|NUM|PARTICLES?|AGENTS?|BUBBLES?|DROPS?|CELLS?|POINTS?|SEEDS?|BLADES?|STARS?)\w*\s*=\s*(\d{3,6})/g)].map((m) => +m[1])
  parts.count = Math.min(14, counts.reduce((a, n) => Math.max(a, Math.log10(n) * 3.5), 0))

  // Texture/grid sizes like 256, 512 used as simulation resolution.
  const grid = [...src.matchAll(/\b(?:SIZE|RES|GRID|W|H|N)\w*\s*=\s*(\d{3,4})\b/g)].map((m) => +m[1])
  parts.grid = grid.length ? Math.min(8, Math.log2(Math.max(...grid) / 64)) : 0

  // Sketches that read a live camera feed or analyse a stream pay per frame too.
  parts.input = /getUserMedia|VideoFrame|requestVideoFrameCallback/.test(src) ? 4 : 0

  const total = Object.values(parts).reduce((a, b) => a + b, 0)
  return { total, parts }
}

// Map complexity points to 1-100. 4 points (trivial) scores 100; 65 points (heaviest seen) scores ~5.
const toScore = (pts) => Math.max(1, Math.min(100, Math.round(100 - 95 * Math.pow(Math.max(0, pts - 4) / 61, 0.8))))

const slugs = readdirSync('sketches', { withFileTypes: true })
  .filter((d) => d.isDirectory() && !d.name.startsWith('_') && existsSync(`sketches/${d.name}/sketch.json`))
  .map((d) => d.name)
  .sort()

const rows = slugs.map((slug) => {
  const { total, parts } = complexity(slug)
  const staticScore = toScore(total)
  const ms = bench[slug]
  const score = ms ? Math.round(MEASURED_WEIGHT * toMeasuredScore(ms) + (1 - MEASURED_WEIGHT) * staticScore) : staticScore
  return { slug, total, score, parts }
})

if (process.argv.includes('--table')) {
  for (const r of [...rows].sort((a, b) => a.score - b.score)) {
    const top = Object.entries(r.parts).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k, v]) => `${k}:${v.toFixed(0)}`).join(' ')
    console.log(`${r.slug.padEnd(26)} ${String(r.score).padStart(3)}  ${r.total.toFixed(0).padStart(3)} pts  ${top}`)
  }
} else {
  const scores = Object.fromEntries(rows.map((r) => [r.slug, r.score]))
  writeFileSync('src/registry/perf.json', JSON.stringify(scores, null, 2) + '\n')
  console.log(`wrote src/registry/perf.json (${rows.length} sketches)`)
}
