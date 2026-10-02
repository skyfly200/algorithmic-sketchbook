import { chromium } from 'playwright'
import { spawn } from 'node:child_process'
const srv = spawn('npx', ['vite', 'preview', '--port', '4799'], { shell: true, stdio: 'ignore' })
await new Promise((r) => setTimeout(r, 4000))
const b = await chromium.launch({ channel: 'chrome', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] })
const p = await b.newPage({ viewport: { width: 640, height: 360 } })
const errs = []
p.on('pageerror', (e) => errs.push(e.message)); p.on('console', (m) => m.type() === 'error' && errs.push(m.text()))
await p.goto('http://localhost:4799/sketches/lava-lamp/index.html')
await p.waitForTimeout(2500)
await p.screenshot({ path: process.argv[2] })
console.log('errors:', errs)
await b.close(); srv.kill()
process.exit(0)
