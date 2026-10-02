import fs from 'node:fs'; fs.mkdirSync('scripts/scratch/out', { recursive: true })
import { chromium } from 'playwright'
import { preview } from 'vite'
const root = process.cwd()
const server = await preview({ root, preview: { port: 4399, strictPort: true } })
const graph = {
  nodes: [
    { id: 1, type: 'text', x: 0, y: 0, params: { text: 'CHAIN TEST', font: 'sans-serif', size: 0.25, weight: 700, tracking: 0.04, x: 0.5, y: 0.5, hue: 200, sat: 82, val: 96, rotate: 0, italic: false, glow: 0.4, bg: false, seqMode: 'off', lyrics: '', lineDur: 3, loopSeq: true, transition: 'None', transDur: 0.4 } },
    { id: 2, type: 'filter', x: 0, y: 0, params: { slug: 'solarize', seed: 1 } },
    { id: 3, type: 'filter', x: 0, y: 0, params: { slug: 'duotone', seed: 1 } },
    { id: 4, type: 'filter', x: 0, y: 0, params: { slug: 'invert', seed: 1 } },
    { id: 5, type: 'output', x: 0, y: 0, params: {} },
  ],
  edges: [{ from: 1, to: 2, port: 0 }, { from: 2, to: 3, port: 0 }, { from: 3, to: 4, port: 0 }, { from: 4, to: 5, port: 0 }],
  links: [], effects: {},
}
const browser = await chromium.launch({ channel: 'msedge', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] })
async function grab(mode) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } })
  const page = await ctx.newPage()
  const logs = []
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') logs.push(m.text()) })
  page.on('pageerror', (e) => logs.push('PAGEERR ' + e.message))
  await page.addInitScript(([g, mode]) => {
    window.__m = {}; window.addEventListener('message', (e) => { const t = e.data && e.data.type; if (t && t.startsWith('filter:')) window.__m[t] = (window.__m[t] || 0) + 1 })
    localStorage.setItem('sketchbook-patch', JSON.stringify(g))
    if (mode === 'off') localStorage.setItem('patch.filterChain', 'off')
  }, [graph, mode])
  await page.goto('http://localhost:4399/'); await page.waitForTimeout(1500); const skip = page.getByText('Skip', { exact: true }); if (await skip.count()) await skip.first().click(); await page.evaluate(() => { location.hash = '#/patch' })
  await page.waitForTimeout(9000)
  const data = await page.evaluate(() => {
    const c = document.querySelector('canvas.stage') || [...document.querySelectorAll('canvas')].sort((a,b)=>b.width*b.height-a.width*a.height)[0]; if(!c) return {w:0,h:0,px:[],body:document.body.innerText.slice(0,300)}
    if(!c) return {w:0,h:0,px:[]}; const t = document.createElement('canvas'); t.width = 160; t.height = 90
    t.getContext('2d').drawImage(c, 0, 0, 160, 90)
    return { m: window.__m, w: c.width, h: c.height, px: Array.from(t.getContext('2d').getImageData(0, 0, 160, 90).data) }
  })
  await page.screenshot({ path: `scripts/scratch/out/chain-${mode}.png` })
  await ctx.close()
  return { ...data, logs }
}
const on = await grab('on')
const off = await grab('off')
let sum = 0, max = 0, n = 0
for (let i = 0; i < on.px.length; i += 4) for (let k = 0; k < 3; k++) { const d = Math.abs(on.px[i + k] - off.px[i + k]); sum += d; max = Math.max(max, d); n++ }
const nonBlack = (p) => p.filter((v, i) => i % 4 < 3 && v > 8).length
console.log('msgs on', JSON.stringify(on.m), 'off', JSON.stringify(off.m)); console.log('size', on.w, on.h, 'meanAbsDiff', (sum / n).toFixed(2), 'maxDiff', max, 'nonBlack on/off', nonBlack(on.px), nonBlack(off.px))
console.log('on logs', on.logs.slice(0, 5), 'off logs', off.logs.slice(0, 5))
await browser.close(); await server.httpServer.close()
