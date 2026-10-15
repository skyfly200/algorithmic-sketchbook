/**
 * Minimal zip writer (deflate, UTF-8 names, Unix file modes) so the bridge
 * bundles keep their executable bits on macOS / Linux without needing a `zip`
 * tool on the machine that packages them. No zip64: entries and the archive
 * must stay under 4 GB / 65535 files, far above what the bundles need.
 */
import zlib from 'node:zlib'

function dosTime(d) {
  return {
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1),
    date: ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
  }
}

/**
 * @param {{ name: string, data: Buffer, mode?: number }[]} entries  name uses '/' separators
 * @returns {Buffer}
 */
export function createZip(entries, when = new Date()) {
  const { time, date } = dosTime(when)
  const locals = []
  const centrals = []
  let offset = 0
  for (const e of entries) {
    const name = Buffer.from(e.name, 'utf8')
    const crc = zlib.crc32(e.data)
    const deflated = zlib.deflateRawSync(e.data, { level: 9 })
    const stored = deflated.length >= e.data.length
    const body = stored ? e.data : deflated
    const method = stored ? 0 : 8

    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)          // version needed
    local.writeUInt16LE(0x0800, 6)      // UTF-8 names
    local.writeUInt16LE(method, 8)
    local.writeUInt16LE(time, 10)
    local.writeUInt16LE(date, 12)
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(body.length, 18)
    local.writeUInt32LE(e.data.length, 22)
    local.writeUInt16LE(name.length, 26)
    local.writeUInt16LE(0, 28)
    locals.push(local, name, body)

    const central = Buffer.alloc(46)
    central.writeUInt32LE(0x02014b50, 0)
    central.writeUInt16LE((3 << 8) | 20, 4) // made by Unix, so the mode below is honoured
    central.writeUInt16LE(20, 6)
    central.writeUInt16LE(0x0800, 8)
    central.writeUInt16LE(method, 10)
    central.writeUInt16LE(time, 12)
    central.writeUInt16LE(date, 14)
    central.writeUInt32LE(crc, 16)
    central.writeUInt32LE(body.length, 20)
    central.writeUInt32LE(e.data.length, 24)
    central.writeUInt16LE(name.length, 28)
    // extra, comment, disk, internal attrs: 0
    central.writeUInt32LE((((e.mode ?? 0o644) | 0o100000) << 16) >>> 0, 38) // regular file + permissions
    central.writeUInt32LE(offset, 42)
    centrals.push(central, name)

    offset += local.length + name.length + body.length
  }
  const cdSize = centrals.reduce((n, b) => n + b.length, 0)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(entries.length, 8)
  end.writeUInt16LE(entries.length, 10)
  end.writeUInt32LE(cdSize, 12)
  end.writeUInt32LE(offset, 16)
  return Buffer.concat([...locals, ...centrals, end])
}
