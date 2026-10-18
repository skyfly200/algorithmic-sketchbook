// Scratch: rough frame timing for mushroom-fruiting (software rendering, so relative only).
import { chromium } from 'playwright'
import { createServer } from 'vite'
const server = await createServer({ root: process.cwd(), logLevel: 'error', server: { port: 5197, strictPort: true } })
await server.listen()
const browser = await chromium.launch({ executablePath: process.env.CHROME || undefined })
const page = await (await browser.newContext({ viewport: { width: 1280, height: 720 } })).newPage()
await page.goto(`http://localhost:5197/sketches/mushroom-fruiting/index.html?quality=high&seed=5`)
await page.waitForTimeout(1500)
await page.evaluate(() => window.postMessage({ type: 'sketch:set-param', name: 'growth', value: 3 }, '*'))
const r = await page.evaluate(() => new Promise((res) => {
  const t0 = performance.now(); let n = 0, worst = 0, prev = t0
  function f(now) { n++; worst = Math.max(worst, now - prev); prev = now; if (now - t0 < 6000) requestAnimationFrame(f); else res({ fps: n / ((now - t0) / 1000), worst }) }
  requestAnimationFrame(f)
}))
console.log(r)
await browser.close(); await server.close()
