// Decode a compressed LiDAR .laz (LASzip) file in the browser using the
// laz-perf WASM decoder. Returns raw point positions already remapped from LAS
// z-up to three.js y-up, plus per-point RGB when the scan carries it. The heavy
// WASM module is loaded lazily (this file is dynamically imported only when a
// .laz is opened), so it never weighs down the main bundle.
import createLazPerf from 'laz-perf/lib/web/laz-perf.js'
import wasmUrl from 'laz-perf/lib/web/laz-perf.wasm?url'

let modPromise = null
function laz() {
  if (!modPromise) modPromise = createLazPerf({ locateFile: () => wasmUrl })
  return modPromise
}

// Byte offset of the RGB triple within a decompressed point record, per format.
const RGB_OFF = { 2: 20, 3: 28, 5: 28, 7: 30, 8: 30, 10: 30 }

export async function decodeLaz(arrayBuffer) {
  const Module = await laz()
  const bytes = new Uint8Array(arrayBuffer)
  const filePtr = Module._malloc(bytes.byteLength)
  Module.HEAPU8.set(bytes, filePtr)
  const zip = new Module.LASZip()
  let count = 0, recLen = 0, fmt = 0, ptPtr = 0
  try {
    zip.open(filePtr, bytes.byteLength)
    count = zip.getCount()
    fmt = zip.getPointFormat()
    recLen = zip.getPointLength()
    if (!count || !recLen) return null
    ptPtr = Module._malloc(recLen)
    // scale/offset live in the (uncompressed) LAS header at the file start
    const dv = new DataView(arrayBuffer)
    const sx = dv.getFloat64(131, true), sy = dv.getFloat64(139, true), sz = dv.getFloat64(147, true)
    const ox = dv.getFloat64(155, true), oy = dv.getFloat64(163, true), oz = dv.getFloat64(171, true)
    const rgbOff = RGB_OFF[fmt]
    const cap = 2_500_000
    const stride = count > cap ? Math.ceil(count / cap) : 1
    const outMax = Math.floor((count + stride - 1) / stride)
    const xs = new Float64Array(outMax * 3)
    const cs = rgbOff != null ? new Float32Array(outMax * 3) : null
    const inten = new Uint16Array(outMax) // return strength, offset 12 in every format
    let w = 0
    for (let i = 0; i < count; i++) {
      zip.getPoint(ptPtr) // must decode every point in sequence (streaming)
      if (i % stride) continue
      const pv = new DataView(Module.HEAPU8.buffer, ptPtr, recLen)
      const X = pv.getInt32(0, true) * sx + ox
      const Y = pv.getInt32(4, true) * sy + oy
      const Z = pv.getInt32(8, true) * sz + oz
      xs[w * 3] = X; xs[w * 3 + 1] = Z; xs[w * 3 + 2] = -Y // LAS z-up → three y-up
      inten[w] = pv.getUint16(12, true)
      if (cs) { const r = pv.getUint16(rgbOff, true), g = pv.getUint16(rgbOff + 2, true), b = pv.getUint16(rgbOff + 4, true); const d = (r > 255 || g > 255 || b > 255) ? 65535 : 255; cs[w * 3] = r / d; cs[w * 3 + 1] = g / d; cs[w * 3 + 2] = b / d }
      w++
    }
    return { xs: xs.subarray(0, w * 3), colors: cs ? cs.subarray(0, w * 3) : null, intensity: inten.subarray(0, w), count: w }
  } finally {
    zip.delete()
    Module._free(filePtr)
    if (ptPtr) Module._free(ptPtr)
  }
}
