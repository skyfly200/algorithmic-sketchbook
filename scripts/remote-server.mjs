/**
 * Remote-control relay — run this on your laptop to drive the app from your
 * phone (or any OSC controller) over your local network.
 *
 *   npm run remote            # build first with `npm run build`
 *
 * It does three things, with no dependencies (node builtins only):
 *   1. Serves the built app (dist/) over plain HTTP on your LAN, so the app and
 *      the phone share one HTTP origin — a phone browser on https:// can't open
 *      an insecure socket to your laptop, so we avoid https entirely here.
 *   2. Runs a tiny message hub (SSE downstream + POST upstream) that relays
 *      control/param messages between the app and the phone controller page
 *      (served at /remote).
 *   3. Listens for OSC over UDP (:8000) and injects it as `remote.*` controls,
 *      so TouchOSC / any OSC app drives the same sources as the web controller.
 *
 * Message protocol (JSON over POST /remote-hub/send, fanned out over SSE):
 *   phone → app : { type:'control', name, value }   → sketch `remote.<name>` sources
 *                 { type:'set-param', name, value }  → sets the live sketch param
 *                 { type:'hello' }                   → asks apps to (re)publish schema
 *   app  → phone: { type:'schema', params, values } → the current sketch's params
 *                 { type:'param', name, value }      → echo when the app changes one
 */
import http from 'node:http'
import dgram from 'node:dgram'
import { readFile, stat } from 'node:fs/promises'
import { createReadStream } from 'node:fs'
import { join, extname, normalize } from 'node:path'
import { networkInterfaces } from 'node:os'
import { fileURLToPath } from 'node:url'

const HTTP_PORT = Number(process.env.REMOTE_PORT) || 7777
const OSC_PORT = Number(process.env.OSC_PORT) || 8000
const ROOT = fileURLToPath(new URL('../dist', import.meta.url))

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.ico': 'image/x-icon',
  '.woff': 'font/woff', '.woff2': 'font/woff2', '.wasm': 'application/wasm', '.webmanifest': 'application/manifest+json',
}

// --- the hub: SSE clients tagged by role, fan-out by message type ------------
const apps = new Set()
const phones = new Set()
let lastSchema = null // cached so a phone that connects late still gets it

function send(res, obj) { res.write(`data: ${JSON.stringify(obj)}\n\n`) }
function toApps(obj) { for (const r of apps) send(r, obj) }
function toPhones(obj) { for (const r of phones) send(r, obj) }

function route(msg) {
  switch (msg.type) {
    case 'control':
    case 'set-param':
      toApps(msg); break
    case 'schema':
      lastSchema = msg; toPhones(msg); break
    case 'param':
      toPhones(msg); break
    case 'hello':
      // a phone (re)joined — ask any app to republish its current schema
      toApps({ type: 'hello' }); break
  }
}

// --- HTTP: static app + controller page + hub endpoints ----------------------
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'content-type', 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS' }

async function serveStatic(req, res, urlPath) {
  // /remote → the controller page shipped in the build at /remote/index.html
  let rel = decodeURIComponent(urlPath.split('?')[0])
  if (rel === '/remote' || rel === '/remote/') rel = '/remote/index.html'
  let file = normalize(join(ROOT, rel))
  if (!file.startsWith(ROOT)) { res.writeHead(403); return res.end() } // path escape guard
  try {
    const s = await stat(file)
    if (s.isDirectory()) file = join(file, 'index.html')
  } catch {
    // SPA fallback: unknown non-file path → the app shell (hash routing)
    if (!extname(rel)) file = join(ROOT, 'index.html')
    else { res.writeHead(404); return res.end('Not found') }
  }
  try {
    const type = MIME[extname(file)] || 'application/octet-stream'
    res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-cache' })
    createReadStream(file).pipe(res)
  } catch { res.writeHead(404); res.end('Not found') }
}

const server = http.createServer(async (req, res) => {
  const url = req.url || '/'
  if (req.method === 'OPTIONS') { res.writeHead(204, CORS); return res.end() }

  // SSE downstream — the app and the phone each open one of these
  if (url.startsWith('/remote-hub/events')) {
    const role = new URL(url, 'http://x').searchParams.get('role') === 'app' ? 'app' : 'phone'
    res.writeHead(200, { ...CORS, 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' })
    res.write(': connected\n\n')
    const set = role === 'app' ? apps : phones
    set.add(res)
    if (role === 'phone' && lastSchema) send(res, lastSchema) // catch a late phone up
    if (role === 'app') toApps({ type: 'hello' })             // ask for a fresh schema
    const ping = setInterval(() => res.write(': ping\n\n'), 20000) // keep proxies from timing out
    req.on('close', () => { clearInterval(ping); set.delete(res) })
    return
  }

  // POST upstream — one message, fanned out by type
  if (url.startsWith('/remote-hub/send') && req.method === 'POST') {
    let body = ''
    req.on('data', (c) => { body += c; if (body.length > 1e5) req.destroy() })
    req.on('end', () => {
      try { route(JSON.parse(body)) } catch { /* ignore malformed */ }
      res.writeHead(204, CORS); res.end()
    })
    return
  }

  serveStatic(req, res, url)
})

// --- OSC over UDP → control messages ----------------------------------------
// Minimal OSC 1.0 reader: address + type tags + float/int args. Bundles are
// unwrapped; timetags ignored (fire immediately). Enough for TouchOSC & friends.
function osc4(n) { return (n + 3) & ~3 } // OSC pads strings/blobs to 4 bytes
function readOscString(buf, o) {
  let e = o
  while (e < buf.length && buf[e] !== 0) e++
  return { str: buf.toString('ascii', o, e), next: osc4(e + 1 - o) + o }
}
function handleOscMessage(buf, o, end) {
  const a = readOscString(buf, o)
  const t = readOscString(buf, a.next)
  const tags = t.str.replace(/^,/, '')
  let p = t.next
  const args = []
  for (const tag of tags) {
    if (tag === 'f') { args.push(buf.readFloatBE(p)); p += 4 }
    else if (tag === 'i') { args.push(buf.readInt32BE(p)); p += 4 }
    else if (tag === 's') { const s = readOscString(buf, p); args.push(s.str); p = s.next }
    else if (tag === 'T') args.push(1)
    else if (tag === 'F') args.push(0)
    else break // unknown type — stop rather than misread
  }
  // address → control key: drop leading '/', an optional 'remote/' prefix, dots for slashes
  let key = a.str.replace(/^\//, '').replace(/^remote\//, '').replace(/\//g, '.')
  const nums = args.filter((v) => typeof v === 'number')
  if (!nums.length) return
  if (nums.length === 1) toApps({ type: 'control', name: key, value: nums[0] })
  else nums.forEach((v, i) => toApps({ type: 'control', name: `${key}.${i + 1}`, value: v }))
}
function handleOscPacket(buf, o = 0, end = buf.length) {
  if (buf.toString('ascii', o, o + 8) === '#bundle\0') {
    let p = o + 16 // skip '#bundle\0' + 8-byte timetag
    while (p + 4 <= end) {
      const size = buf.readInt32BE(p); p += 4
      if (size <= 0 || p + size > end) break
      handleOscPacket(buf, p, p + size); p += size
    }
  } else if (buf[o] === 0x2f) { // '/'
    handleOscMessage(buf, o, end)
  }
}
const udp = dgram.createSocket({ type: 'udp4', reuseAddr: true })
udp.on('message', (buf) => { try { handleOscPacket(buf) } catch { /* bad packet */ } })
udp.on('error', (e) => console.warn('[remote] OSC socket error:', e.message))

// --- startup banner ----------------------------------------------------------
function lanIP() {
  for (const list of Object.values(networkInterfaces())) {
    for (const n of list || []) if (n.family === 'IPv4' && !n.internal) return n.address
  }
  return 'localhost'
}
async function qr(text) {
  try { const { default: QR } = await import('qrcode'); return await QR.toString(text, { type: 'terminal', small: true }) }
  catch { return null }
}

async function start() {
  try { await stat(join(ROOT, 'index.html')) }
  catch { console.error('\n  dist/ not found — run `npm run build` first, then `npm run remote`.\n'); process.exit(1) }

  server.listen(HTTP_PORT, '0.0.0.0', async () => {
    const ip = lanIP()
    const appUrl = `http://${ip}:${HTTP_PORT}`
    const phoneUrl = `${appUrl}/remote`
    console.log('\n  Bright Waves — remote control\n')
    console.log(`  App  (open on this laptop) : ${appUrl}`)
    console.log(`  Phone controller (scan/type): ${phoneUrl}`)
    console.log(`  OSC in (TouchOSC etc.)      : udp://${ip}:${OSC_PORT}  → remote.*\n`)
    const art = await qr(phoneUrl)
    if (art) console.log(art)
    else console.log('  (tip: `npm i -D qrcode` to print a scannable QR here)\n')
  })
  udp.bind(OSC_PORT, () => {}) // best-effort; OSC just won't arrive if the port is taken
}
start()
