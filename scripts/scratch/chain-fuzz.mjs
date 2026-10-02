import { chromium } from 'playwright'
import { createServer } from 'vite'
import fs from 'node:fs'
const SP = (process.env.SP || 'scripts/scratch/out'); fs.mkdirSync(SP, { recursive: true })
const src = fs.readFileSync('src/registry/filters.js', 'utf8')
const list = [...src.split('export const CHAINABLE_SLUGS')[1].matchAll(/'([a-z0-9-]+)'/g)].map((m) => m[1])
const rounds = +(process.argv[2] || 6), len = +(process.argv[3] || 3)
const only = process.argv.slice(4)
const pick = () => list[Math.floor(Math.random() * list.length)]
const server = await createServer({ root: process.cwd(), server: { port: 5199, strictPort: true } })
await server.listen()
const browser = await chromium.launch({ channel: 'msedge', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] })
const textNode = { id: 1, type: 'text', x: 0, y: 0, params: { text: 'CHAIN', font: 'sans-serif', size: 0.3, weight: 700, tracking: 0.04, x: 0.5, y: 0.5, hue: 200, sat: 82, val: 96, rotate: 0, italic: false, glow: 0.4, bg: false, seqMode: 'off', lyrics: '', lineDur: 3, loopSeq: true, transition: 'None', transDur: 0.4 } }
for (let r = 0; r < rounds; r++) {
  const slugs = only.length ? only : Array.from({ length: len }, pick)
  const nodes = [textNode, ...slugs.map((slug, i) => ({ id: 2 + i, type: 'filter', x: 0, y: 0, params: { slug, seed: 1 } })), { id: 2 + slugs.length, type: 'output', x: 0, y: 0, params: {} }]
  const edges = nodes.slice(0, -1).map((n, i) => ({ from: n.id, to: nodes[i + 1].id, port: 0 }))
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 720 } })).newPage()
  const errs = []
  page.on('pageerror', (e) => errs.push('PAGEERR ' + e.message))
  page.on('console', (m) => { if (m.type() === 'error' && !/404|Failed to load resource/.test(m.text())) errs.push(m.text().slice(0, 200)) })
  await page.addInitScript(([g]) => {
    localStorage.setItem('sketchbook-patch', JSON.stringify(g))
    window.__m = { program: 0, declined: [], uniforms: 0 }
    window.addEventListener('message', (e) => { const d = e.data; if (!d) return; if (d.type === 'filter:program') { window.__m.program++; if (!d.ok) window.__m.declined.push(1) } if (d.type === 'filter:uniforms') window.__m.uniforms++ })
    if (window === window.top) { window.__draws = 0; const o = WebGL2RenderingContext.prototype.drawArrays; WebGL2RenderingContext.prototype.drawArrays = function (...a) { window.__draws++; return o.apply(this, a) } }
  }, [{ nodes, edges, links: [], effects: {} }])
  await page.goto('http://localhost:5199/'); await page.waitForTimeout(1200)
  const skip = page.getByText('Skip', { exact: true }); if (await skip.count()) await skip.first().click()
  await page.evaluate(() => { location.hash = '#/patch' }); await page.waitForSelector('canvas.stage', { timeout: 90000 }); await page.waitForTimeout(+(process.env.WAIT || 9000))
  const res = await page.evaluate(() => {
    const c = document.querySelector('canvas.stage')
    const t = document.createElement('canvas'); t.width = 64; t.height = 36; const x = t.getContext('2d'); x.drawImage(c, 0, 0, 64, 36)
    const d = x.getImageData(0, 0, 64, 36).data; let lit = 0; for (let i = 0; i < d.length; i += 4) if (d[i] + d[i + 1] + d[i + 2] > 30) lit++
    const sizes = [...document.querySelectorAll('.sources iframe')].map((f) => { const cv = f.contentDocument?.querySelector('canvas'); return cv ? cv.width + 'x' + cv.height : '-' })
    return { lit, sizes, m: window.__m, draws: window.__draws }
  })
  await page.screenshot({ path: `${SP}/fuzz-${r}.png` })
  console.log(r, slugs.join(' > '), JSON.stringify({ lit: res.lit, prog: res.m.program, declined: res.m.declined.length, unif: res.m.uniforms, draws: res.draws, sizes: res.sizes.join(',') }), errs.slice(0, 3))
  await page.close()
}
await browser.close(); await server.close()
