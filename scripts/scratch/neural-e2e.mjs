// Runs src/lib/upscale/neural.js for real (worker + CDN model) on a small image with a
// transparent corner, in the dev server. Slow on SwiftShader/WASM: ~3 s per 64 px tile.
//   node scripts/scratch/neural-e2e.mjs [model] [w] [h]
import { chromium } from 'playwright'
import { createServer } from 'vite'
import fs from 'node:fs'
fs.mkdirSync('scripts/scratch/out', { recursive: true })
const model = process.argv[2] || 'fast', w = +(process.argv[3] || 100), h = +(process.argv[4] || 70)
const server = await createServer({ root: process.cwd(), server: { port: 5199, strictPort: true } })
await server.listen()
const browser = await chromium.launch({ channel: 'msedge', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] })
const page = await (await browser.newContext()).newPage()
page.on('console', (m) => { if (m.type() === 'error') console.log('[err]', m.text().slice(0, 200)) })
page.on('pageerror', (e) => console.log('PAGEERR', e.message))
await page.goto('http://localhost:5199/')
const r = await page.evaluate(async ([model, w, h]) => {
  const { upscaleImage, modelById } = await import('/src/lib/upscale/neural.js')
  const c = document.createElement('canvas'); c.width = w; c.height = h
  const x = c.getContext('2d')
  const g = x.createLinearGradient(0, 0, w, h); g.addColorStop(0, '#e33'); g.addColorStop(1, '#36f')
  x.fillStyle = g; x.fillRect(0, 0, w, h)
  x.fillStyle = '#fff'; x.fillRect(w * 0.3, h * 0.45, w * 0.4, 3)
  x.beginPath(); x.arc(w * 0.7, h * 0.3, 10, 0, 7); x.fillStyle = '#ff0'; x.fill()
  x.clearRect(0, 0, 12, 12) // transparent corner
  const blob = await new Promise((res) => c.toBlob(res, 'image/png'))
  const seen = []
  const res = await upscaleImage(blob, { model, onStatus: (s) => { if (s.phase !== 'load' || !seen.includes('load')) seen.push(s.phase === 'run' ? `run${s.tilesDone}/${s.tilesTotal}` : s.phase) } })
  const bmp = await createImageBitmap(res.blob)
  const o = document.createElement('canvas'); o.width = bmp.width; o.height = bmp.height
  const ox = o.getContext('2d'); ox.drawImage(bmp, 0, 0)
  const d = ox.getImageData(0, 0, o.width, o.height).data
  const s = modelById(model).scale
  const px = (X, Y) => Array.from(d.slice((Y * o.width + X) * 4, (Y * o.width + X) * 4 + 4))
  // seam probe: compare columns either side of the first tile boundary
  return { out: [bmp.width, bmp.height], expect: [w * s, h * s], device: res.device, ms: res.ms, seen: seen.join(' '), cornerA: px(2, 2)[3], midA: px(Math.floor(o.width / 2), Math.floor(o.height / 2))[3], mid: px(Math.floor(o.width / 2), Math.floor(o.height / 2)), url: o.toDataURL('image/png') }
}, [model, w, h])
fs.writeFileSync(`scripts/scratch/out/neural-e2e-${model}.png`, Buffer.from(r.url.split(',')[1], 'base64'))
delete r.url
console.log(JSON.stringify(r))
await browser.close(); await server.close()
