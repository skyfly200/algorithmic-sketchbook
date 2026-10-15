/**
 * Package the local bridge (bridge/main.mjs: Art-Net + phone/OSC relay + the
 * built app) as one download per OS that needs nothing else installed:
 *
 *   release/sketchbook-bridge-<version>-<target>.zip
 *     runtime/node(.exe)   official Node.js binary (kept as nodejs.org signed it)
 *     bridge.cjs           the bridge, bundled into one file with esbuild
 *     app/                 the built gallery (dist/), served on http://localhost:7777
 *     Start / Install / Uninstall launchers, README.txt
 *
 *   npm run bridge:package                       all targets
 *   npm run bridge:package -- --targets win-x64  some targets (comma separated)
 *   npm run bridge:package -- --skip-build       reuse the current dist/
 *
 * Node downloads are checked against nodejs.org's SHASUMS256.txt and cached in
 * .cache/node/. Packaging for every OS works from any OS.
 */
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'
import { createZip } from './lib/zip.mjs'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const NODE_VERSION = '22.22.0' // runtime shipped in the bundles; bump deliberately
const CACHE = path.join(ROOT, '.cache', 'node', `v${NODE_VERSION}`)
const OUT = path.join(ROOT, 'release')
const DIST = path.join(ROOT, 'dist')
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'))

const TARGETS = {
  'win-x64': { os: 'win32', remote: 'win-x64/node.exe' },
  'darwin-arm64': { os: 'darwin', remote: `node-v${NODE_VERSION}-darwin-arm64.tar.gz`, inner: `node-v${NODE_VERSION}-darwin-arm64/bin/node` },
  'darwin-x64': { os: 'darwin', remote: `node-v${NODE_VERSION}-darwin-x64.tar.gz`, inner: `node-v${NODE_VERSION}-darwin-x64/bin/node` },
  'linux-x64': { os: 'linux', remote: `node-v${NODE_VERSION}-linux-x64.tar.gz`, inner: `node-v${NODE_VERSION}-linux-x64/bin/node` },
  'linux-arm64': { os: 'linux', remote: `node-v${NODE_VERSION}-linux-arm64.tar.gz`, inner: `node-v${NODE_VERSION}-linux-arm64/bin/node` },
}

function parseArgs(argv) {
  const o = { targets: Object.keys(TARGETS), build: true }
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--targets') o.targets = argv[++i].split(',').map((s) => s.trim()).filter(Boolean)
    else if (argv[i] === '--skip-build') o.build = false
    else throw new Error(`unknown option ${argv[i]}`)
  }
  for (const t of o.targets) if (!TARGETS[t]) throw new Error(`unknown target ${t} (have: ${Object.keys(TARGETS).join(', ')})`)
  return o
}

const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex')

async function download(url) {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`)
  return Buffer.from(await res.arrayBuffer())
}

async function cached(name, url, expectSha) {
  const file = path.join(CACHE, name.replace(/\//g, '_'))
  if (fs.existsSync(file) && (!expectSha || sha256(fs.readFileSync(file)) === expectSha)) return fs.readFileSync(file)
  console.log(`  downloading ${url}`)
  const buf = await download(url)
  if (expectSha && sha256(buf) !== expectSha) throw new Error(`checksum mismatch for ${name}`)
  fs.mkdirSync(CACHE, { recursive: true })
  fs.writeFileSync(file, buf)
  return buf
}

let shasums
async function nodeBinary(target) {
  const t = TARGETS[target]
  const base = `https://nodejs.org/dist/v${NODE_VERSION}`
  if (!shasums) {
    const text = (await cached('SHASUMS256.txt', `${base}/SHASUMS256.txt`)).toString('utf8')
    shasums = Object.fromEntries(text.trim().split('\n').map((l) => l.trim().split(/\s+/).reverse()))
  }
  const sum = shasums[t.remote]
  if (!sum) throw new Error(`${t.remote} is not listed in Node ${NODE_VERSION}'s SHASUMS256.txt`)
  const buf = await cached(t.remote, `${base}/${t.remote}`, sum)
  if (!t.inner) return buf
  // pull bin/node out of the tarball with the system tar (present on macOS, Linux and Windows 10+)
  const tmp = fs.mkdtempSync(path.join(CACHE, 'x-'))
  try {
    const archive = path.join(CACHE, t.remote.replace(/\//g, '_'))
    const r = spawnSync('tar', ['-xzf', archive, '-C', tmp, t.inner], { stdio: 'inherit' })
    if (r.status !== 0) throw new Error(`tar could not extract ${t.inner}`)
    return fs.readFileSync(path.join(tmp, t.inner))
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true })
  }
}

async function bundleBridge() {
  const result = await build({
    entryPoints: [path.join(ROOT, 'bridge', 'main.mjs')],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node22',
    write: false,
    legalComments: 'inline',
    // import.meta.url doesn't exist in CommonJS; give it the bundled file's own URL
    banner: { js: "const __bridge_url = require('node:url').pathToFileURL(__filename).href;" },
    define: { 'import.meta.url': '__bridge_url' },
    logLevel: 'warning',
  })
  return Buffer.from(result.outputFiles[0].contents)
}

// --- launchers ---------------------------------------------------------------------
function launchers(os) {
  if (os === 'win32') {
    const cmd = (args, pause = true) => `@echo off\r\n"%~dp0runtime\\node.exe" "%~dp0bridge.cjs" ${args}\r\n${pause ? 'pause\r\n' : ''}`
    return [
      { name: 'Start Bridge.cmd', text: cmd('run --open') },
      { name: 'Install.cmd', text: cmd('install') },
      { name: 'Uninstall.cmd', text: cmd('uninstall') },
    ]
  }
  const sh = (args) => `#!/bin/sh\ncd "$(dirname "$0")" || exit 1\nexec ./runtime/node ./bridge.cjs ${args}\n`
  if (os === 'darwin') {
    return [
      { name: 'Start Bridge.command', text: sh('run --open'), exec: true },
      { name: 'Install.command', text: sh('install'), exec: true },
      { name: 'Uninstall.command', text: sh('uninstall'), exec: true },
    ]
  }
  return [
    { name: 'start-bridge.sh', text: sh('run --open'), exec: true },
    { name: 'install.sh', text: sh('install'), exec: true },
    { name: 'uninstall.sh', text: sh('uninstall'), exec: true },
  ]
}

function readme(os, version) {
  const L = os === 'win32' ? ['Start Bridge.cmd', 'Install.cmd', 'Uninstall.cmd']
    : os === 'darwin' ? ['Start Bridge.command', 'Install.command', 'Uninstall.command']
      : ['start-bridge.sh', 'install.sh', 'uninstall.sh']
  const firstRun = os === 'win32'
    ? `Windows may show "Windows protected your PC" for the launchers (they are not code-signed):
choose More info > Run anyway. When Windows Firewall asks about Node.js, allow it on
private networks so your phone and lighting desk can reach the bridge.`
    : os === 'darwin'
      ? `macOS blocks the launchers the first time because they are not signed by an Apple
developer: Control-click the file, choose Open, then Open again (or allow it in System
Settings > Privacy & Security). The bundled Node.js binary is the one nodejs.org signs.
Allow incoming connections if macOS asks, so your phone can reach the bridge.`
      : 'If a firewall is running, allow TCP 7777 and UDP 8000 / 6454 from your local network.'
  return `Sketchbook Bridge ${version}
=========================

The local half of Algorithmic Sketchbook: browsers cannot receive UDP, so this small
program receives it for them and serves the app on your computer.

  * Art-Net (DMX) in on UDP 6454, passed to sketches as artnet.ch1..ch32
    (SSE on http://localhost:9321/artnet)
  * Phone controller and OSC (TouchOSC etc.) on UDP 8000, as remote.* inputs
  * The app itself on http://localhost:7777, and the phone controller at
    http://<this computer's LAN address>:7777/remote (the window prints the address
    and a QR code)

Try it:   ${L[0]}   runs it in a window until you close it.
Install:  ${L[1]}   copies it to your user folder and starts it now and at every
                    login (no admin rights needed).
Remove:   ${L[2]}${os === 'win32' ? '   (or Settings > Apps > Sketchbook Bridge)' : ''}

${firstRun}

Bundled: Node.js ${NODE_VERSION} (runtime/, MIT licence in runtime/LICENSE).
`
}

// --- main ------------------------------------------------------------------------
async function main() {
  const opts = parseArgs(process.argv.slice(2))
  if (opts.build) {
    console.log('Building the app (npm run build)…')
    const r = spawnSync('npm', ['run', 'build'], { cwd: ROOT, stdio: 'inherit', shell: process.platform === 'win32' })
    if (r.status !== 0) process.exit(r.status || 1)
  }
  if (!fs.existsSync(path.join(DIST, 'index.html'))) throw new Error('dist/ is missing; run without --skip-build')

  console.log('Bundling bridge/main.mjs…')
  const bridge = await bundleBridge()
  const license = await cached('LICENSE', `https://raw.githubusercontent.com/nodejs/node/v${NODE_VERSION}/LICENSE`)

  const appFiles = []
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name)
      if (e.isDirectory()) walk(p)
      else appFiles.push({ rel: path.relative(DIST, p).split(path.sep).join('/'), data: fs.readFileSync(p) })
    }
  }
  walk(DIST)

  fs.mkdirSync(OUT, { recursive: true })
  for (const target of opts.targets) {
    const { os } = TARGETS[target]
    const name = `sketchbook-bridge-${pkg.version}-${target}`
    console.log(`Packaging ${name}…`)
    const node = await nodeBinary(target)
    const meta = { name: 'sketchbook-bridge', version: pkg.version, target, node: NODE_VERSION, built: new Date().toISOString() }
    const entries = [
      { name: `${name}/runtime/${os === 'win32' ? 'node.exe' : 'node'}`, data: node, mode: 0o755 },
      { name: `${name}/runtime/LICENSE`, data: license },
      { name: `${name}/bridge.cjs`, data: bridge },
      { name: `${name}/bundle.json`, data: Buffer.from(`${JSON.stringify(meta, null, 2)}\n`) },
      { name: `${name}/README.txt`, data: Buffer.from(os === 'win32' ? readme(os, pkg.version).replace(/\n/g, '\r\n') : readme(os, pkg.version)) },
      ...launchers(os).map((l) => ({ name: `${name}/${l.name}`, data: Buffer.from(l.text), mode: l.exec ? 0o755 : 0o644 })),
      ...appFiles.map((f) => ({ name: `${name}/app/${f.rel}`, data: f.data })),
    ]
    const zip = createZip(entries)
    const file = path.join(OUT, `${name}.zip`)
    fs.writeFileSync(file, zip)
    console.log(`  ${path.relative(ROOT, file)}  ${(zip.length / 1048576).toFixed(1)} MB  sha256 ${sha256(zip)}`)
  }
}

main().catch((e) => {
  console.error(`\n  ${e.message}\n`)
  process.exit(1)
})
