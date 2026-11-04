#!/usr/bin/env node
// Drives the built sketchbook (dist/) in headless Chromium via Playwright.
//   node driver.mjs gallery [out.png]
//   node driver.mjs viewer <slug> [out.png] [--ms 1500]   gallery viewer (/#/sketch/<slug>)
//   node driver.mjs sketch <slug> [out.png] [--ms 1500]   the bare sketch page, reports console errors
//   node driver.mjs patch  [out.png]                      Patch compositor view
// Run `npm run build` first. Exits 1 on page errors.
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import { preview } from 'vite'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')
const args = process.argv.slice(2)
const ms = +(args[args.indexOf('--ms') + 1] || 1500) || 1500
const pos = args.filter((a, i) => !a.startsWith('--') && args[i - 1] !== '--ms')
const [cmd, ...rest] = pos
const needSlug = cmd === 'viewer' || cmd === 'sketch'
const slug = needSlug ? rest[0] : null
const out = path.resolve((needSlug ? rest[1] : rest[0]) || `/tmp/${cmd}${slug ? '-' + slug : ''}.png`)

const server = await preview({ root, preview: { port: 0, host: '127.0.0.1' } })
const base = server.resolvedUrls.local[0].replace(/\/$/, '')
const url = { gallery: `${base}/`, viewer: `${base}/#/sketch/${slug}`, sketch: `${base}/sketches/${slug}/index.html`, patch: `${base}/#/patch` }[cmd]
if (!url) { console.error('usage: driver.mjs gallery|viewer <slug>|sketch <slug>|patch [out.png]'); process.exit(2) }

// swiftshader WebGL so shader sketches draw without a GPU
const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM || '/opt/pw-browsers/chromium', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox'] })
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } })
await page.addInitScript(() => { try { if (!localStorage.getItem('sketchbook-settings')) localStorage.setItem('sketchbook-settings', JSON.stringify({ tutorials: false })) } catch {} }) // no welcome tour
const errors = []
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message))
page.on('console', (m) => m.type() === 'error' && !/status of 404/.test(m.text()) && errors.push('console: ' + m.text()))
page.on('response', (r) => r.status() >= 400 && !/remote-hub/.test(r.url()) && errors.push(`${r.status()} ${r.url()}`))
await page.goto(url, { waitUntil: 'load' })
await page.waitForTimeout(cmd === 'gallery' ? 2500 : ms + 1000)
await page.screenshot({ path: out })
console.log('screenshot', out)
console.log('title', await page.title(), '| errors', errors.length)
errors.forEach((e) => console.log(' ', e))
await browser.close(); await server.close()
process.exit(errors.length ? 1 : 0)
