import { chromium } from 'playwright'
import { spawn } from 'node:child_process'
const srv = spawn('npx', ['vite', 'preview', '--port', '4798'], { shell: true, stdio: 'ignore' })
await new Promise((r) => setTimeout(r, 4000))
const b = await chromium.launch({ channel: 'chrome' })
const p = await b.newPage({ viewport: { width: 1200, height: 700 } })
await p.goto('http://localhost:4798/')
await p.waitForTimeout(3000)
console.log(await p.evaluate(() => ({ svgIcons: document.querySelectorAll('.v-icon svg').length, emptyIcons: [...document.querySelectorAll('.v-icon')].filter((e) => !e.querySelector('svg') && !e.textContent.trim()).length })))
await p.screenshot({ path: process.argv[2] })
await b.close(); srv.kill(); process.exit(0)
