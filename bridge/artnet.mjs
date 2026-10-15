/**
 * Art-Net → browser bridge. Browsers can't receive UDP, so this listens for
 * ArtDMX packets on UDP :6454 (the Art-Net standard port) and re-serves the
 * latest universe as Server-Sent Events on http://localhost:9321/artnet, which
 * the sketch runtime's `artnet.*` input sources subscribe to
 * (sketches/_lib/inputs.js). Node builtins only.
 */
import dgram from 'node:dgram'
import http from 'node:http'

export const ARTNET_UDP_PORT = 6454
export const ARTNET_HTTP_PORT = 9321
const HEADER = 'Art-Net\0'

/** An ArtDMX packet → { universe, data } (null for anything else). */
export function parseArtDmx(buf) {
  if (buf.length < 18 || buf.toString('latin1', 0, 8) !== HEADER) return null
  if (buf.readUInt16LE(8) !== 0x5000) return null // ArtDMX only
  const universe = buf.readUInt16LE(14)
  const length = buf.readUInt16BE(16)
  return { universe, data: [...buf.subarray(18, 18 + Math.min(length, 512))] }
}

export function startArtnet({ udpPort = ARTNET_UDP_PORT, httpPort = ARTNET_HTTP_PORT, log = console.log } = {}) {
  const clients = new Set()
  let lastFrame = null

  const udp = dgram.createSocket({ type: 'udp4', reuseAddr: true })
  udp.on('message', (buf) => {
    const frame = parseArtDmx(buf)
    if (!frame) return
    lastFrame = JSON.stringify(frame)
    const msg = `data: ${lastFrame}\n\n`
    for (const res of clients) res.write(msg)
  })
  udp.on('error', (e) => log(`[artnet] UDP :${udpPort} unavailable (${e.code || e.message}); DMX input is off`))
  udp.bind(udpPort, () => log(`[artnet] listening for ArtDMX on udp://0.0.0.0:${udpPort}`))

  const server = http.createServer((req, res) => {
    if (req.url !== '/artnet') {
      res.writeHead(404)
      return res.end()
    }
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Access-Control-Allow-Origin': '*', // sketches run on the dev/site origin
    })
    if (lastFrame) res.write(`data: ${lastFrame}\n\n`)
    clients.add(res)
    req.on('close', () => clients.delete(res))
  })
  server.on('error', (e) => log(`[artnet] HTTP :${httpPort} unavailable (${e.code || e.message}); is another bridge already running?`))
  server.listen(httpPort, () => log(`[artnet] serving SSE on http://localhost:${httpPort}/artnet`))

  return {
    close() {
      for (const res of clients) res.end()
      udp.close()
      server.close()
    },
  }
}
