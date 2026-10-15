/**
 * Per-user install of the packaged bridge: where it goes and how it starts at
 * login. `installPlan` is pure (tested in tests/bridge.test.js); `bridge/main.mjs`
 * carries it out. Nothing here needs admin rights.
 *
 *   macOS   ~/Library/Application Support/Sketchbook Bridge + a LaunchAgent
 *   Linux   ~/.local/share/sketchbook-bridge + a systemd user unit
 *           (an XDG autostart entry when there is no systemd user session)
 *   Windows %LOCALAPPDATA%\Sketchbook Bridge + a hidden launcher in the Startup
 *           folder + an entry in Settings > Apps so it can be removed there
 */
import path from 'node:path'

export const LABEL = 'com.algorithmic-sketchbook.bridge'
export const UNIT = 'sketchbook-bridge.service'
export const WIN_UNINSTALL_KEY = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\SketchbookBridge'

const xmlEscape = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
// systemd: quote each word, escape backslash / quote, and double % (specifier char)
const sdQuote = (s) => `"${String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/%/g, '%%')}"`
// .desktop Exec: quote each word, escape the reserved characters
const deskQuote = (s) => `"${String(s).replace(/([\\"`$])/g, '\\$1')}"`

/**
 * @param {object} o
 * @param {'darwin'|'linux'|'win32'} o.platform
 * @param {string} o.home         user home directory
 * @param {object} [o.env]        environment (LOCALAPPDATA / APPDATA / XDG_* on the platforms that use them)
 * @param {boolean} [o.systemd]   Linux only: a systemd user session is available
 * @param {number} [o.uid]        macOS only: for `launchctl … gui/<uid>`
 * @returns {{ dir, node, script, log, files: {path, content}[], start: string[][], stop: string[][], register: string[][], unregister: string[][] }}
 */
export function installPlan({ platform, home, env = {}, systemd = true, uid = 501 }) {
  const P = platform === 'win32' ? path.win32 : path.posix
  let dir
  if (platform === 'darwin') dir = P.join(home, 'Library', 'Application Support', 'Sketchbook Bridge')
  else if (platform === 'win32') dir = P.join(env.LOCALAPPDATA || P.join(home, 'AppData', 'Local'), 'Sketchbook Bridge')
  else dir = P.join(env.XDG_DATA_HOME || P.join(home, '.local', 'share'), 'sketchbook-bridge')

  const node = P.join(dir, 'runtime', platform === 'win32' ? 'node.exe' : 'node')
  const script = P.join(dir, 'bridge.cjs')
  const log = P.join(dir, 'bridge.log')
  const plan = { dir, node, script, log, files: [], start: [], stop: [], register: [], unregister: [] }

  if (platform === 'darwin') {
    const plist = P.join(home, 'Library', 'LaunchAgents', `${LABEL}.plist`)
    plan.files.push({
      path: plist,
      content: `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${xmlEscape(node)}</string>
    <string>${xmlEscape(script)}</string>
    <string>run</string>
  </array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><dict><key>SuccessfulExit</key><false/></dict>
  <key>StandardOutPath</key><string>${xmlEscape(log)}</string>
  <key>StandardErrorPath</key><string>${xmlEscape(log)}</string>
</dict>
</plist>
`,
    })
    plan.start.push(['launchctl', 'bootstrap', `gui/${uid}`, plist])
    plan.stop.push(['launchctl', 'bootout', `gui/${uid}/${LABEL}`])
  } else if (platform === 'win32') {
    const startup = P.join(env.APPDATA || P.join(home, 'AppData', 'Roaming'), 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup')
    const vbs = P.join(startup, 'Sketchbook Bridge.vbs')
    // VBScript string: double the quotes; window style 0 = hidden, False = don't wait
    const cmd = `"${node}" "${script}" run --log "${log}"`.replace(/"/g, '""')
    plan.files.push({ path: vbs, content: `CreateObject("WScript.Shell").Run "${cmd}", 0, False\r\n` })
    plan.start.push(['wscript.exe', vbs])
    const uninstall = `"${node}" "${script}" uninstall`
    const reg = (name, type, value) => ['reg', 'add', WIN_UNINSTALL_KEY, '/v', name, '/t', type, '/d', value, '/f']
    plan.register.push(
      reg('DisplayName', 'REG_SZ', 'Sketchbook Bridge'),
      reg('Publisher', 'REG_SZ', 'Algorithmic Sketchbook'),
      reg('InstallLocation', 'REG_SZ', dir),
      reg('DisplayIcon', 'REG_SZ', node),
      reg('UninstallString', 'REG_SZ', uninstall),
      reg('NoModify', 'REG_DWORD', '1'),
      reg('NoRepair', 'REG_DWORD', '1'),
    )
    plan.unregister.push(['reg', 'delete', WIN_UNINSTALL_KEY, '/f'])
  } else if (systemd) {
    const unit = P.join(env.XDG_CONFIG_HOME || P.join(home, '.config'), 'systemd', 'user', UNIT)
    plan.files.push({
      path: unit,
      content: `[Unit]
Description=Sketchbook Bridge (Art-Net + phone/OSC remote for Algorithmic Sketchbook)
After=network-online.target

[Service]
ExecStart=${sdQuote(node)} ${sdQuote(script)} run
Restart=on-failure
RestartSec=5

[Install]
WantedBy=default.target
`,
    })
    plan.start.push(['systemctl', '--user', 'daemon-reload'], ['systemctl', '--user', 'enable', '--now', UNIT])
    plan.stop.push(['systemctl', '--user', 'disable', '--now', UNIT])
  } else {
    const desktop = P.join(env.XDG_CONFIG_HOME || P.join(home, '.config'), 'autostart', 'sketchbook-bridge.desktop')
    plan.files.push({
      path: desktop,
      content: `[Desktop Entry]
Type=Application
Name=Sketchbook Bridge
Comment=Art-Net + phone/OSC remote for Algorithmic Sketchbook
Exec=${deskQuote(node)} ${deskQuote(script)} run --log ${deskQuote(log)}
Terminal=false
X-GNOME-Autostart-enabled=true
`,
    })
    // started directly (detached) by main.mjs; stopped through the pid file
  }
  return plan
}
