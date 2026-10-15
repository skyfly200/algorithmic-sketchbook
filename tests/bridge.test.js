import { describe, it, expect } from 'vitest'
import zlib from 'node:zlib'
import { parseArtDmx } from '../bridge/artnet.mjs'
import { oscToControls } from '../bridge/remote.mjs'
import { installPlan, LABEL, UNIT } from '../bridge/autostart.mjs'
import { createZip } from '../scripts/lib/zip.mjs'

function artDmx(universe, data, opcode = 0x5000) {
  const b = Buffer.alloc(18 + data.length)
  b.write('Art-Net\0', 0, 'latin1')
  b.writeUInt16LE(opcode, 8)
  b.writeUInt16LE(universe, 14)
  b.writeUInt16BE(data.length, 16)
  b.set(data, 18)
  return b
}

const pad4 = (b) => Buffer.concat([b, Buffer.alloc(4 - (b.length % 4))])
const oscStr = (s) => pad4(Buffer.from(s, 'ascii'))
function oscMsg(address, ...floats) {
  const args = floats.map((f) => { const b = Buffer.alloc(4); b.writeFloatBE(f); return b })
  return Buffer.concat([oscStr(address), oscStr(`,${'f'.repeat(floats.length)}`), ...args])
}

describe('Art-Net parsing', () => {
  it('reads universe and channel data from ArtDMX', () => {
    expect(parseArtDmx(artDmx(3, [0, 128, 255]))).toEqual({ universe: 3, data: [0, 128, 255] })
  })
  it('ignores other opcodes and other packets', () => {
    expect(parseArtDmx(artDmx(0, [1], 0x2000))).toBeNull() // ArtPoll
    expect(parseArtDmx(Buffer.from('hello world, not artnet'))).toBeNull()
  })
})

describe('OSC parsing', () => {
  it('maps an address to a remote control key', () => {
    expect(oscToControls(oscMsg('/remote/fader/1', 0.5))).toEqual([{ type: 'control', name: 'fader.1', value: 0.5 }])
    expect(oscToControls(oscMsg('/x', 0.25))).toEqual([{ type: 'control', name: 'x', value: 0.25 }])
  })
  it('numbers multiple args', () => {
    expect(oscToControls(oscMsg('/xy', 0.25, 0.75)).map((m) => [m.name, m.value])).toEqual([['xy.1', 0.25], ['xy.2', 0.75]])
  })
  it('unwraps bundles', () => {
    const a = oscMsg('/a', 1)
    const b = oscMsg('/b', 0)
    const size = (m) => { const s = Buffer.alloc(4); s.writeInt32BE(m.length); return s }
    const bundle = Buffer.concat([oscStr('#bundle'), Buffer.alloc(8), size(a), a, size(b), b])
    expect(oscToControls(bundle).map((m) => m.name)).toEqual(['a', 'b'])
  })
})

describe('installPlan', () => {
  it('macOS: LaunchAgent with escaped paths, started through launchctl', () => {
    const p = installPlan({ platform: 'darwin', home: '/Users/a&b', uid: 502 })
    expect(p.dir).toBe('/Users/a&b/Library/Application Support/Sketchbook Bridge')
    expect(p.node).toBe(`${p.dir}/runtime/node`)
    const [plist] = p.files
    expect(plist.path).toBe(`/Users/a&b/Library/LaunchAgents/${LABEL}.plist`)
    expect(plist.content).toContain('<string>/Users/a&amp;b/Library/Application Support/Sketchbook Bridge/bridge.cjs</string>')
    expect(plist.content).not.toContain('a&b')
    expect(p.start).toEqual([['launchctl', 'bootstrap', 'gui/502', plist.path]])
    expect(p.stop[0]).toEqual(['launchctl', 'bootout', `gui/502/${LABEL}`])
  })

  it('Windows: hidden Startup launcher with VBScript-doubled quotes and an Apps entry', () => {
    const env = { LOCALAPPDATA: 'C:\\Users\\Al\\AppData\\Local', APPDATA: 'C:\\Users\\Al\\AppData\\Roaming' }
    const p = installPlan({ platform: 'win32', home: 'C:\\Users\\Al', env })
    expect(p.dir).toBe('C:\\Users\\Al\\AppData\\Local\\Sketchbook Bridge')
    expect(p.node).toBe(`${p.dir}\\runtime\\node.exe`)
    const [vbs] = p.files
    expect(vbs.path).toBe('C:\\Users\\Al\\AppData\\Roaming\\Microsoft\\Windows\\Start Menu\\Programs\\Startup\\Sketchbook Bridge.vbs')
    expect(vbs.content).toBe(
      'CreateObject("WScript.Shell").Run """C:\\Users\\Al\\AppData\\Local\\Sketchbook Bridge\\runtime\\node.exe"" ' +
      '""C:\\Users\\Al\\AppData\\Local\\Sketchbook Bridge\\bridge.cjs"" run --log ' +
      '""C:\\Users\\Al\\AppData\\Local\\Sketchbook Bridge\\bridge.log""", 0, False\r\n')
    const uninstall = p.register.find((c) => c.includes('UninstallString'))
    expect(uninstall.at(-2)).toBe(`"${p.node}" "${p.script}" uninstall`)
    expect(p.unregister).toHaveLength(1)
  })

  it('Linux with systemd: a user unit, enabled and started', () => {
    const p = installPlan({ platform: 'linux', home: '/home/al', systemd: true })
    expect(p.dir).toBe('/home/al/.local/share/sketchbook-bridge')
    const [unit] = p.files
    expect(unit.path).toBe(`/home/al/.config/systemd/user/${UNIT}`)
    expect(unit.content).toContain('ExecStart="/home/al/.local/share/sketchbook-bridge/runtime/node" "/home/al/.local/share/sketchbook-bridge/bridge.cjs" run')
    expect(p.start.at(-1)).toEqual(['systemctl', '--user', 'enable', '--now', UNIT])
  })

  it('Linux without systemd: an XDG autostart entry, honouring XDG dirs', () => {
    const p = installPlan({ platform: 'linux', home: '/home/al', systemd: false, env: { XDG_DATA_HOME: '/d', XDG_CONFIG_HOME: '/c' } })
    expect(p.dir).toBe('/d/sketchbook-bridge')
    expect(p.files[0].path).toBe('/c/autostart/sketchbook-bridge.desktop')
    expect(p.files[0].content).toContain('Exec="/d/sketchbook-bridge/runtime/node" "/d/sketchbook-bridge/bridge.cjs" run --log')
    expect(p.start).toEqual([])
  })
})

describe('createZip', () => {
  // read it back from the central directory, the way unzip tools do
  function readZip(buf) {
    const eocd = buf.length - 22
    expect(buf.readUInt32LE(eocd)).toBe(0x06054b50)
    const count = buf.readUInt16LE(eocd + 10)
    let p = buf.readUInt32LE(eocd + 16)
    const out = []
    for (let i = 0; i < count; i++) {
      expect(buf.readUInt32LE(p)).toBe(0x02014b50)
      const method = buf.readUInt16LE(p + 10)
      const crc = buf.readUInt32LE(p + 16)
      const csize = buf.readUInt32LE(p + 20)
      const nameLen = buf.readUInt16LE(p + 28)
      const mode = (buf.readUInt32LE(p + 38) >>> 16) & 0o777
      const local = buf.readUInt32LE(p + 42)
      const name = buf.toString('utf8', p + 46, p + 46 + nameLen)
      const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28)
      const raw = buf.subarray(start, start + csize)
      const data = method === 8 ? zlib.inflateRawSync(raw) : raw
      expect(zlib.crc32(data)).toBe(crc)
      out.push({ name, mode, data: data.toString() })
      p += 46 + nameLen
    }
    return out
  }

  it('round-trips names, contents and Unix modes', () => {
    const files = readZip(createZip([
      { name: 'b/run.sh', data: Buffer.from('#!/bin/sh\necho hi\n'.repeat(20)), mode: 0o755 },
      { name: 'b/README – ünïcode.txt', data: Buffer.from('x') },
      { name: 'b/empty', data: Buffer.alloc(0) },
    ]))
    expect(files.map((f) => [f.name, f.mode])).toEqual([['b/run.sh', 0o755], ['b/README – ünïcode.txt', 0o644], ['b/empty', 0o644]])
    expect(files[0].data).toBe('#!/bin/sh\necho hi\n'.repeat(20))
    expect(files[1].data).toBe('x')
  })
})
