// Temporal upscaling prototype check on a sketch (SLUG=mandelbulb|ocean-surface, default mandelbulb). Each config renders N frames on a
// synthetic clock and captures the last one, so every config shows the identical camera pose.
//   ref       : ground truth: native at 2x the size, averaged down (what accumulation should converge to)
//   native    : full-resolution ray march (aliased: one sample per pixel)
//   lowres    : the same low-res render with history off (what you get without temporal accumulation)
//   temporal  : jittered low-res + reprojected history
// Reports PSNR against `ref` and ms per frame (software renderer: only the ratios mean anything).
//   node scripts/scratch/taau-compare.mjs [scale=0.5] [spin=0.15] [frames=24] [w=320] [h=180] [extra query, e.g. '&kernel=5&alpha=0.1']
import { chromium } from 'playwright'
import { createServer } from 'vite'
import fs from 'node:fs'
fs.mkdirSync('scripts/scratch/out', { recursive: true })
const scale = process.argv[2] || '0.5', spin = +(process.argv[3] ?? 0.15), N = +(process.argv[4] || 24)
const VW = +(process.argv[5] || 320), VH = +(process.argv[6] || 180)
const EXTRA = process.argv[7] || ''
const SLUG = process.env.SLUG || 'mandelbulb'
const PARAMS = JSON.parse(process.env.PARAMS || '{}') // extra sketch params, e.g. {"autoZoom":true}
const label = { '0.75': 'Temporal 0.75x', '0.5': 'Temporal 0.5x', '0.33': 'Temporal 0.33x' }[scale]
const server = await createServer({ root: process.cwd(), server: { port: 5199, strictPort: true } })
await server.listen()
const browser = await chromium.launch({ channel: 'msedge', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] })

async function run(name, render, query = '', vw = VW, vh = VH) {
  const page = await (await browser.newContext({ viewport: { width: vw, height: vh } })).newPage()
  const errs = []
  page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text().slice(0, 160)) })
  page.on('pageerror', (e) => errs.push('PAGEERR ' + e.message))
  await page.addInitScript(([N, render, spin, extra]) => {
    let n = 0
    window.__n = () => n
    window.__ts = []
    window.requestAnimationFrame = (cb) => { if (n >= N) return 0; const t = n++ * 16.6667; return setTimeout(() => { const a = performance.now(); cb(t); try { const g = document.getElementById('canvas').getContext('webgl2'); g.bindFramebuffer(g.FRAMEBUFFER, null); g.readPixels(0, 0, 1, 1, g.RGBA, g.UNSIGNED_BYTE, new Uint8Array(4)) } catch {} window.__ts.push(performance.now() - a) }, 0) }
    // set the render mode and spin as soon as the sketch has announced its params
    const set = () => { window.postMessage({ type: 'sketch:set-param', name: 'render', value: render }, '*'); window.postMessage({ type: 'sketch:set-param', name: 'spin', value: spin }, '*'); for (const [k, v] of Object.entries(extra)) window.postMessage({ type: 'sketch:set-param', name: k, value: v }, '*') }
    window.addEventListener('DOMContentLoaded', () => { set(); setTimeout(set, 0) })
  }, [N, render, spin, PARAMS])
    await page.goto(`http://localhost:5199/sketches/${SLUG}/index.html?capture=1&quality=high&seed=1${query}`)
  await page.waitForFunction((N) => window.__n() >= N, N, { timeout: 280000 })
  await page.waitForTimeout(300)
  const url = await page.evaluate(() => document.getElementById('canvas').toDataURL('image/png'))
  const ts = (await page.evaluate(() => window.__ts)).slice(4).sort((a, b) => a - b)
  const ms = Math.round(ts[Math.floor(ts.length / 2)] * 10) / 10 // median frame cost, startup excluded
  fs.writeFileSync(`scripts/scratch/out/taau-${name}.png`, Buffer.from(url.split(',')[1], 'base64'))
  await page.context().close()
  return { name, url, ms, errs }
}

const results = [await run('ref', 'Native', '', VW * 2, VH * 2), await run('native', 'Native'), await run('lowres', label, '&history=0' + EXTRA), await run('temporal', label, EXTRA)]

// PSNR of each against native, in a throwaway page
const cmp = await (await browser.newContext()).newPage()
const psnr = await cmp.evaluate(async ([urls, W, H]) => {
  const load = (u, w, h) => new Promise((res) => { const i = new Image(); i.onload = () => { const c = document.createElement('canvas'); c.width = w; c.height = h; const x = c.getContext('2d'); x.imageSmoothingQuality = 'high'; x.drawImage(i, 0, 0, w, h); res(x.getImageData(0, 0, w, h).data) }; i.src = u })
  const [ref, ...rest] = await Promise.all(urls.map((u) => load(u, W, H)))
  return rest.map((d) => { let s = 0, n = 0; for (let i = 0; i < ref.length; i += 4) for (let k = 0; k < 3; k++) { const e = ref[i + k] - d[i + k]; s += e * e; n++ } return +(10 * Math.log10(255 * 255 / Math.max(s / n, 1e-9))).toFixed(2) })
}, [results.map((r) => r.url), VW, VH])
console.log(`scale ${scale} spin ${spin} frames ${N} @ ${VW}x${VH}`)
const ok = (r) => r.errs.filter((e) => !/404/.test(e)).join('|')
console.log('native   ', results[1].ms, 'ms/frame  PSNR', psnr[0], 'dB', ok(results[1]))
console.log('lowres   ', results[2].ms, 'ms/frame  PSNR', psnr[1], 'dB', ok(results[2]))
console.log('temporal ', results[3].ms, 'ms/frame  PSNR', psnr[2], 'dB', ok(results[3]), EXTRA)
await browser.close(); await server.close()
