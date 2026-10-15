// Memory/CPU snapshot per scenario: sums PSS of every Chromium process and CPU ticks over a window.
// Software renderer (SwiftShader): GPU work shows up as CPU, and GPU memory as process memory.
import { chromium } from 'playwright'
import { preview } from 'vite'
import fs from 'fs'
const server = await preview({ preview: { port: 5299, strictPort: true } })
const browser = await chromium.launch({ executablePath: process.env.CHROME || undefined, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] })
// Only this browser's process tree (other Chromium instances on the machine are not counted).
const ppid = (p) => { try { return +fs.readFileSync(`/proc/${p}/stat`, 'utf8').split(') ')[1].split(' ')[1] } catch { return 0 } }
const pids = () => { const root = process.pid; const all = fs.readdirSync('/proc').filter((p) => /^\d+$/.test(p)); const tree = new Set([String(root)]); let grew = true; while (grew) { grew = false; for (const p of all) if (!tree.has(p) && tree.has(String(ppid(p)))) { tree.add(p); grew = true } } tree.delete(String(root)); return [...tree] }
const pss = () => pids().reduce((s, p) => { try { const m = fs.readFileSync(`/proc/${p}/smaps_rollup`, 'utf8').match(/Pss:\s+(\d+)/); return s + (m ? +m[1] : 0) } catch { return s } }, 0) / 1024
const ticks = () => pids().reduce((s, p) => { try { const f = fs.readFileSync(`/proc/${p}/stat`, 'utf8').split(') ')[1].split(' '); return s + +f[11] + +f[12] } catch { return s } }, 0)
const W = +process.env.MS || 5000
async function measure(label, setup) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } })
  const page = await ctx.newPage()
  const errs = []; page.on('pageerror', (e) => errs.push(e.message.slice(0, 100)))
  await setup(page)
  await page.waitForTimeout(6000)
  const cdp = await ctx.newCDPSession(page)
  await cdp.send('Performance.enable')
  await cdp.send('HeapProfiler.collectGarbage')
  const t0 = ticks(); const s0 = Date.now()
  await page.waitForTimeout(W)
  const cpu = (ticks() - t0) / 100 / ((Date.now() - s0) / 1000) // cores busy
  const m = Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map((x) => [x.name, x.value]))
  const frames = await page.evaluate(() => document.querySelectorAll('iframe').length)
  const row = { label, pssMB: Math.round(pss()), jsHeapMB: Math.round(m.JSHeapUsedSize / 1048576), cpuCores: +cpu.toFixed(2), iframes: frames, errs: errs.length }
  console.log(JSON.stringify(row))
  await ctx.close(); await new Promise((r) => setTimeout(r, 1500))
  return row
}
const base = 'http://localhost:5299/'
const skipTour = async (page) => { for (let i = 0; i < 6 && (await page.locator('.tour-root').count()); i++) { const sk = page.locator('.tour-root').getByText('Skip', { exact: true }); if (await sk.count()) await sk.first().click({ force: true }); await page.waitForTimeout(400) } }
const go = (hash, init) => async (page) => { if (process.env.RES) await page.addInitScript((r) => { globalThis.__RES = r }, process.env.RES); if (init) await page.addInitScript(init.fn, init.arg); await page.goto(base); await page.waitForTimeout(1500); await skipTour(page); await page.evaluate((h) => { location.hash = h }, hash) }
const patch = (slugs, filters = [], chainOff = false) => {
  const nodes = []; const edges = []; let id = 1
  const out = { id: 900, type: 'output', x: 900, y: 90, params: {} }
  let prev = null
  slugs.forEach((s, i) => { const n = { id: id++, type: 'effect', x: 40, y: 40 + i * 120, params: { slug: s, seed: 'a' + i } }; nodes.push(n); prev = prev ?? n })
  // effects 2..n blend in via a chain of blends? keep it simple: first effect -> filters -> output; others feed blends
  let head = nodes[0]
  for (let i = 1; i < slugs.length; i++) { const b = { id: id++, type: 'blend', x: 300, y: 40 + i * 120, params: { mode: 'screen', mix: 0.5 } }; nodes.push(b); edges.push({ from: head.id, to: b.id, port: 0 }, { from: nodes[i].id, to: b.id, port: 1 }); head = b }
  filters.forEach((f, i) => { const n = { id: id++, type: 'filter', x: 600, y: 40 + i * 120, params: { slug: f, seed: 'f' + i } }; nodes.push(n); edges.push({ from: head.id, to: n.id, port: 0 }); head = n })
  nodes.push(out); if (head) edges.push({ from: head.id, to: out.id, port: 0 })
  return { fn: ([g, off]) => { localStorage.setItem('sketchbook-patch', JSON.stringify(g)); if (off) localStorage.setItem('patch.filterChain', 'off'); if (globalThis.__RES) localStorage.setItem('sketchbook-patch-res', globalThis.__RES) }, arg: [{ nodes, edges, links: [], effects: {} }, chainOff] }
}
const rows = []
const only = process.argv[2]
const S = [
  ['blank page', async (p) => { await p.goto('about:blank') }],
  ['gallery', go('#/')],
  ['viewer: interference-rings (shader)', go('#/sketch/interference-rings')],
  ['viewer: frost-grow (canvas2d)', go('#/sketch/frost-grow')],
  ['viewer: kuwahara (filter)', go('#/sketch/kuwahara')],
  ['viewer: bubbles-3d (three)', go('#/sketch/bubbles-3d')],
  ['viewer: hex-cascade (p5)', go('#/sketch/hex-cascade')],
  ['patch: empty', go('#/patch', patch([]))],
  ['patch: 1 effect', go('#/patch', patch(['interference-rings']))],
  ['patch: 4 effects', go('#/patch', patch(['interference-rings', 'plasma-shader', 'fractal-explorer', 'voronoi-fractal']))],
  ['patch: 8 effects', go('#/patch', patch(['interference-rings', 'plasma-shader', 'fractal-explorer', 'voronoi-fractal', 'soap-film', 'opalescence', 'solar-corona', 'wormhole']))],
  ['patch: 1 effect + 4 filters (chain on)', go('#/patch', patch(['interference-rings'], ['invert', 'vignette', 'sharpen', 'edge-detect']))],
  ['patch: 1 effect + 4 filters (chain off)', go('#/patch', patch(['interference-rings'], ['invert', 'vignette', 'sharpen', 'edge-detect'], true))],
  ['patch: 2 three.js effects', go('#/patch', patch(['bubbles-3d', 'phi-spheres']))],
  ['viewer: delay (46-frame ring)', go('#/sketch/delay')],
  ['viewer: motion-extraction (30-frame ring)', go('#/sketch/motion-extraction')],
  ['viewer: rolling-shutter', go('#/sketch/rolling-shutter')],
  ['mixer', go('#/mix')],
  ['autopilot', go('#/auto')],
]
for (const [l, f] of S) if (!only || l.includes(only)) rows.push(await measure(l, f))
fs.writeFileSync(process.env.OUT || 'mem-map.json', JSON.stringify(rows, null, 1))
await browser.close(); server.httpServer.close()
