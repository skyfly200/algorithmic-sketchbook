/**
 * Sketchbook Bridge: one process for the local servers a browser can't do
 * itself (UDP in). It runs the Art-Net bridge (bridge/artnet.mjs) and the phone /
 * OSC remote relay (bridge/remote.mjs), which also serves the built app.
 *
 *   node bridge/main.mjs [run]     from the repo (serves dist/; `npm run bridge`)
 *   bridge.cjs run|install|uninstall|status   inside a packaged bundle
 *
 * `npm run bridge:package` builds the bundles (scripts/package-bridge.mjs).
 */
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import http from 'node:http'
import { spawn, spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { startArtnet } from './artnet.mjs'
import { startRemote, REMOTE_HTTP_PORT, REMOTE_OSC_PORT } from './remote.mjs'
import { installPlan } from './autostart.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const BUNDLE_FILE = path.join(HERE, 'bundle.json')
const bundle = fs.existsSync(BUNDLE_FILE) ? JSON.parse(fs.readFileSync(BUNDLE_FILE, 'utf8')) : null
const PID_FILE = path.join(HERE, 'bridge.pid')

const HELP = `Sketchbook Bridge${bundle ? ` ${bundle.version}` : ''}: Art-Net and phone/OSC remote for Algorithmic Sketchbook

Usage: bridge <command> [options]

Commands
  run          start the bridge in this window (default)
  install      copy this bundle to your user folder, start it now and at every login
  uninstall    stop it, remove the login item and the installed copy
  status       say whether a bridge is answering on this computer

Options for run
  --port N       app + phone relay HTTP port (default ${REMOTE_HTTP_PORT})
  --osc-port N   OSC UDP port (default ${REMOTE_OSC_PORT})
  --app DIR      built app to serve (default: the bundle's app/, or the repo's dist/)
  --no-remote    Art-Net only
  --no-artnet    phone/OSC relay only
  --open         open the app in the browser once it is up
  --log FILE     append output to FILE instead of the console
Options for install
  --no-open      don't open the browser afterwards
`

function parseArgs(argv) {
  const opts = { cmd: 'run', port: REMOTE_HTTP_PORT, oscPort: REMOTE_OSC_PORT, artnet: true, remote: true, open: undefined }
  const rest = [...argv]
  if (rest[0] && !rest[0].startsWith('-')) opts.cmd = rest.shift()
  while (rest.length) {
    const a = rest.shift()
    if (a === '--port') opts.port = Number(rest.shift())
    else if (a === '--osc-port') opts.oscPort = Number(rest.shift())
    else if (a === '--app') opts.app = rest.shift()
    else if (a === '--log') opts.log = rest.shift()
    else if (a === '--no-remote') opts.remote = false
    else if (a === '--no-artnet') opts.artnet = false
    else if (a === '--open') opts.open = true
    else if (a === '--no-open') opts.open = false
    else if (a === '-h' || a === '--help') opts.cmd = 'help'
    else throw new Error(`unknown option ${a}`)
  }
  return opts
}

function appRoot(opts) {
  const candidates = opts.app ? [path.resolve(opts.app)] : [path.join(HERE, 'app'), path.join(HERE, '..', 'dist')]
  return candidates.find((d) => fs.existsSync(path.join(d, 'index.html')))
}

// fire and forget; a missing program reports through 'error', which must not crash the bridge
function detach(cmd, args, extra = {}) {
  const child = spawn(cmd, args, { detached: true, stdio: 'ignore', windowsHide: true, ...extra })
  child.on('error', () => {})
  child.unref()
}

function openBrowser(url) {
  const [cmd, args] = process.platform === 'darwin' ? ['open', [url]]
    : process.platform === 'win32' ? ['cmd', ['/c', 'start', '', url]]
      : ['xdg-open', [url]]
  detach(cmd, args)
}

function quietRun(argv) {
  const r = spawnSync(argv[0], argv.slice(1), { stdio: 'ignore' })
  return r.status === 0
}

function killFromPidFile(pidFile) {
  try {
    const pid = Number(fs.readFileSync(pidFile, 'utf8'))
    if (pid && pid !== process.pid) process.kill(pid)
  } catch { /* not running */ }
  try { fs.rmSync(pidFile, { force: true }) } catch { /* gone */ }
}

// --- run -----------------------------------------------------------------------
async function run(opts) {
  let log = console.log
  if (opts.log) {
    const out = fs.createWriteStream(opts.log, { flags: 'a' })
    log = (...a) => out.write(`${a.join(' ')}\n`)
    log(`\n--- ${new Date().toISOString()} ---`)
  }
  const closers = []
  if (opts.artnet) closers.push(startArtnet({ log }))
  if (opts.remote) {
    const root = appRoot(opts)
    if (!root) {
      log(bundle ? '\n  The app folder is missing from this bundle; re-download it.\n'
        : '\n  dist/ not found: run `npm run build` first (or pass --no-remote for Art-Net only).\n')
      process.exit(1)
    }
    try {
      const r = await startRemote({ root, httpPort: opts.port, oscPort: opts.oscPort, log })
      closers.push(r)
      if (opts.open) openBrowser(r.url)
    } catch (e) {
      log(`\n  Not started: ${e.message}\n`)
      // exit 0 so a login item doesn't restart-loop against a bridge that is already up
      process.exit(0)
    }
  }
  if (bundle) fs.writeFileSync(PID_FILE, String(process.pid))
  const stop = () => {
    for (const c of closers) c.close()
    if (bundle) fs.rmSync(PID_FILE, { force: true })
    process.exit(0)
  }
  process.on('SIGINT', stop)
  process.on('SIGTERM', stop)
  if (!opts.log) log('  Press Ctrl+C to stop.\n')
}

// --- install / uninstall -----------------------------------------------------------
function currentPlan() {
  const platform = process.platform
  const systemd = platform === 'linux' && quietRun(['systemctl', '--user', 'show-environment'])
  return installPlan({ platform, home: os.homedir(), env: process.env, systemd, uid: process.getuid?.() })
}

function stopInstalled(plan) {
  for (const c of plan.stop) quietRun(c)
  killFromPidFile(path.join(plan.dir, 'bridge.pid'))
}

async function install(opts) {
  if (!bundle) throw new Error('install works from a packaged bundle; build one with `npm run bridge:package`')
  const plan = currentPlan()
  console.log(`Installing Sketchbook Bridge ${bundle.version} to ${plan.dir}`)
  stopInstalled(plan)
  if (path.resolve(HERE) !== path.resolve(plan.dir)) {
    // replace the program files, keep the log
    for (const name of ['runtime', 'app', 'bridge.cjs', 'bundle.json']) fs.rmSync(path.join(plan.dir, name), { recursive: true, force: true })
    fs.mkdirSync(plan.dir, { recursive: true })
    for (const name of fs.readdirSync(HERE)) {
      if (name === 'bridge.pid' || name === 'bridge.log') continue
      fs.cpSync(path.join(HERE, name), path.join(plan.dir, name), { recursive: true })
    }
  }
  for (const f of plan.files) {
    fs.mkdirSync(path.dirname(f.path), { recursive: true })
    fs.writeFileSync(f.path, f.content)
    console.log(`  login item: ${f.path}`)
  }
  for (const c of plan.register) quietRun(c)
  if (!(plan.start.length && plan.start.every(quietRun))) {
    // no service manager to start it (or it refused): start it detached ourselves
    detach(plan.node, [plan.script, 'run', '--log', plan.log])
  }
  const up = await waitForBridge(8000)
  console.log(up ? `\nRunning: open http://localhost:${REMOTE_HTTP_PORT} (phone: …/remote).`
    : `\nInstalled, but nothing answered on port ${REMOTE_HTTP_PORT} yet. Log: ${plan.log}`)
  console.log('It starts again at every login. Remove it with the Uninstall launcher' +
    (process.platform === 'win32' ? ' or Settings > Apps.' : '.'))
  if (up && opts.open !== false) openBrowser(`http://localhost:${REMOTE_HTTP_PORT}`)
}

function uninstall() {
  const plan = currentPlan()
  stopInstalled(plan)
  for (const c of plan.unregister) quietRun(c)
  for (const f of plan.files) fs.rmSync(f.path, { force: true })
  if (!fs.existsSync(plan.dir)) { console.log('Sketchbook Bridge is not installed.'); return }
  if (process.platform === 'win32') {
    // node.exe in that folder may be this very process; delete it once we've exited
    // verbatim, so Node doesn't backslash-escape the quotes cmd.exe has to see
    detach('cmd.exe', [`/d /c "ping -n 3 127.0.0.1 >nul & rmdir /s /q "${plan.dir}""`], { windowsVerbatimArguments: true })
  } else {
    fs.rmSync(plan.dir, { recursive: true, force: true })
  }
  console.log(`Removed Sketchbook Bridge (${plan.dir}) and its login item.`)
}

function waitForBridge(ms) {
  const until = Date.now() + ms
  return new Promise((resolve) => {
    const probe = () => {
      const req = http.get({ host: '127.0.0.1', port: REMOTE_HTTP_PORT, path: '/', timeout: 1000 }, (res) => { res.resume(); resolve(true) })
      req.on('error', retry)
      req.on('timeout', () => req.destroy())
    }
    const retry = () => (Date.now() > until ? resolve(false) : setTimeout(probe, 300))
    probe()
  })
}

async function status() {
  const up = await waitForBridge(0)
  const plan = currentPlan()
  console.log(up ? `A bridge is answering on http://localhost:${REMOTE_HTTP_PORT}.` : 'No bridge is answering on this computer.')
  console.log(fs.existsSync(plan.script) ? `Installed at ${plan.dir}.` : 'Not installed (it may still be running from a download or the repo).')
}

// --- main ----------------------------------------------------------------------------
async function main() {
  const opts = parseArgs(process.argv.slice(2))
  switch (opts.cmd) {
    case 'run': return run(opts)
    case 'install': return install(opts)
    case 'uninstall': return uninstall()
    case 'status': return status()
    case 'help': return console.log(HELP)
    default: throw new Error(`unknown command ${opts.cmd}`)
  }
}

main().catch((e) => {
  console.error(`\n  ${e.message}\n\n${HELP}`)
  process.exitCode = 1
})
