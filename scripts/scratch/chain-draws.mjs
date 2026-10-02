import { chromium } from 'playwright'
import { preview } from 'vite'
const server = await preview({ root: process.cwd(), preview: { port: 4399, strictPort: true } })
const f = (id, slug) => ({ id, type: 'filter', x: 0, y: 0, params: { slug, seed: 1 } })
const graph = {
  nodes: [{ id: 1, type: 'effect', x: 0, y: 0, params: { slug: 'plasma-shader', seed: 1 } }, f(2, 'solarize'), f(3, 'duotone'), f(4, 'invert'), { id: 5, type: 'output', x: 0, y: 0, params: {} }],
  edges: [[1, 2], [2, 3], [3, 4], [4, 5]].map(([from, to]) => ({ from, to, port: 0 })), links: [], effects: {},
}
const browser = await chromium.launch({ channel: 'msedge', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] })
async function run(mode) {
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 720 } })).newPage()
  await page.addInitScript(([g, mode]) => {
    localStorage.setItem('sketchbook-patch', JSON.stringify(g))
    if (mode === 'off') localStorage.setItem('patch.filterChain', 'off')
    if (window === window.top) { window.__draws = 0; const d = WebGL2RenderingContext.prototype.drawArrays; WebGL2RenderingContext.prototype.drawArrays = function (...a) { window.__draws++; return d.apply(this, a) } }
  }, [graph, mode])
  await page.goto('http://localhost:4399/'); await page.waitForTimeout(1500)
  const skip = page.getByText('Skip', { exact: true }); if (await skip.count()) await skip.first().click()
  await page.evaluate(() => { location.hash = '#/patch' }); await page.waitForTimeout(8000)
  const snap = () => page.evaluate(() => {
    const hash = (c) => { const t = document.createElement('canvas'); t.width = 32; t.height = 18; t.getContext('2d').drawImage(c, 0, 0, 32, 18); return Array.from(t.getContext('2d').getImageData(0, 0, 32, 18).data).reduce((a, v) => (a * 31 + v) >>> 0, 7) }
    const stage = hash(document.querySelector('canvas.stage'))
    const frames = [...document.querySelectorAll('.sources iframe')].map((fr) => { const c = fr.contentDocument?.querySelector('canvas'); return c && c.width ? hash(c) : null })
    return { stage, frames, draws: window.__draws }
  })
  const a = await snap(); await page.waitForTimeout(1000); const b = await snap()
  return { a, b }
}
for (const mode of ['on', 'off']) { const r = await run(mode); console.log(mode, JSON.stringify(r), 'stageMoved', r.a.stage !== r.b.stage, 'frameIdentical', JSON.stringify(r.a.frames.map((h, i) => h === r.b.frames[i]))) }
await browser.close(); await server.httpServer.close()
