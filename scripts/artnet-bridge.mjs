/**
 * ArtNet → browser bridge. Browsers can't receive UDP, so this tiny local
 * server listens for ArtDMX packets on UDP :6454 (the ArtNet standard port)
 * and re-serves the latest universe as Server-Sent Events on
 * http://localhost:9321/artnet — which the sketch runtime's `artnet.*` input
 * sources subscribe to.
 *
 *   npm run artnet-bridge          # then map artnet.ch1…ch32 in any sketch
 *
 * No dependencies; uses only node builtins.
 */
import dgram from 'node:dgram'
import http from 'node:http'

const UDP_PORT = 6454
const HTTP_PORT = 9321
const HEADER = 'Art-Net\0'

const clients = new Set()
let lastFrame = null

const udp = dgram.createSocket({ type: 'udp4', reuseAddr: true })
udp.on('message', (buf) => {
  if (buf.length < 20 || buf.toString('latin1', 0, 8) !== HEADER) return
  const opcode = buf.readUInt16LE(8)
  if (opcode !== 0x5000) return // ArtDMX only
  const universe = buf.readUInt16LE(14)
  const length = buf.readUInt16BE(16)
  const data = [...buf.subarray(18, 18 + Math.min(length, 512))]
  lastFrame = JSON.stringify({ universe, data })
  const msg = `data: ${lastFrame}\n\n`
  for (const res of clients) res.write(msg)
})
udp.bind(UDP_PORT, () => console.log(`[artnet-bridge] listening for ArtDMX on udp://0.0.0.0:${UDP_PORT}`))

http
  .createServer((req, res) => {
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
  .listen(HTTP_PORT, () => console.log(`[artnet-bridge] serving SSE on http://localhost:${HTTP_PORT}/artnet`))
