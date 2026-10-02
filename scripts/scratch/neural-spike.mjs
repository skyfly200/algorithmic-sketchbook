// Throwaway: does Transformers.js run a Swin2SR upscaler in the browser, and how fast per tile?
//   node scripts/scratch/neural-spike.mjs [modelId] [tile]
import { chromium } from 'playwright'
const model = process.argv[2] || 'Xenova/swin2SR-lightweight-x2-64'
const tile = +(process.argv[3] || 64)
const URL_ = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.7.6/dist/transformers.min.js'
const browser = await chromium.launch({ channel: 'msedge', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] })
const page = await (await browser.newContext()).newPage()
page.on('console', (m) => console.log('[page]', m.text().slice(0, 200)))
page.on('pageerror', (e) => console.log('PAGEERR', e.message))
await page.goto('about:blank')
const out = await page.evaluate(async ([url, model, tile]) => {
  const t0 = performance.now()
  const tf = await import(url)
  const t1 = performance.now()
  tf.env.allowLocalModels = false
  const gpu = !!navigator.gpu
  const up = await tf.pipeline('image-to-image', model, { device: 'wasm', dtype: 'q8' })
  const t2 = performance.now()
  const c = document.createElement('canvas'); c.width = c.height = tile
  const x = c.getContext('2d')
  const g = x.createLinearGradient(0, 0, tile, tile); g.addColorStop(0, '#e33'); g.addColorStop(1, '#36f')
  x.fillStyle = g; x.fillRect(0, 0, tile, tile); x.fillStyle = '#fff'; x.fillRect(tile * 0.3, tile * 0.3, tile * 0.3, 4)
  const img = tf.RawImage.fromCanvas(c)
  const times = []
  let res
  for (let i = 0; i < 2; i++) { const a = performance.now(); res = await up(img); times.push(Math.round(performance.now() - a)) }
  let nz = 0; for (let i = 0; i < res.data.length; i += 7) if (res.data[i] > 8) nz++
  return { gpu, import_ms: Math.round(t1 - t0), load_ms: Math.round(t2 - t1), run_ms: times, w: res.width, h: res.height, ch: res.channels, nonBlack: nz, keys: Object.keys(res).slice(0, 8), version: tf.env.version }
}, [URL_, model, tile])
console.log(model, tile, JSON.stringify(out))
await browser.close()
