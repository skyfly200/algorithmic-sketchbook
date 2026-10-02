// Neural upscaler worker. Runs a Swin2SR super-resolution model through Transformers.js so the
// seconds of inference never block the live compositor. See neural.js for the main-thread side.
//
// Messages in:   { type: 'init', repo, gpu }   load the model (gpu: try WebGPU first)
//                { type: 'tile', id, w, h, rgba }   upscale one RGBA tile (rgba is an ArrayBuffer)
// Messages out:  { type: 'load', status, file, progress }   download / load progress
//                { type: 'ready', device }
//                { type: 'tile', id, w, h, rgba }   the upscaled tile (RGBA, ArrayBuffer)
//                { type: 'error', id?, gpu, message }   gpu: it happened on WebGPU, so retry on WASM
//
// Transformers.js is loaded from a pinned CDN URL instead of being bundled: the npm package
// drags in Node-only dependencies (sharp, onnxruntime-node), and the model weights have to be
// fetched at run time anyway. WebGPU is tried first when the browser has an adapter; if it can't
// create or run the model the host restarts the worker on single-threaded WASM (int8). Only the WASM path is
// covered by automated checks.
const TF_URL = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.7.6/dist/transformers.min.js'

let tf = null
let up = null
let repo = ''
let device = 'wasm'

const post = (msg, transfer) => self.postMessage(msg, transfer)

async function load(wantGpu) {
  tf ??= await import(/* @vite-ignore */ TF_URL)
  tf.env.allowLocalModels = false // otherwise it probes /models/... and gets the SPA's index.html
  // Only try WebGPU when there is really an adapter. A failed WebGPU attempt can poison a retry in
  // the same worker, so a GPU failure is reported and the host starts a fresh worker for WASM.
  let gpu = false
  if (wantGpu && self.navigator?.gpu) { try { gpu = !!(await self.navigator.gpu.requestAdapter()) } catch { /* none */ } }
  device = gpu ? 'webgpu' : 'wasm'
  up = await tf.pipeline('image-to-image', repo, {
    device,
    dtype: gpu ? 'fp32' : 'q8',
    progress_callback: (p) => post({ type: 'load', status: p.status, file: p.file, progress: p.progress ?? null }),
  })
}

async function upscale(w, h, rgba) {
  // The model takes RGB; the host handles alpha separately.
  const img = new tf.RawImage(new Uint8ClampedArray(rgba), w, h, 4).rgb()
  const res = await up(img)
  const n = res.width * res.height
  const out = new Uint8ClampedArray(n * 4)
  const src = res.data
  const ch = res.channels
  for (let i = 0, j = 0, k = 0; i < n; i++, j += ch, k += 4) {
    out[k] = src[j]; out[k + 1] = src[j + 1]; out[k + 2] = src[j + 2]; out[k + 3] = 255
  }
  return { w: res.width, h: res.height, rgba: out.buffer }
}

self.onmessage = async (e) => {
  const m = e.data
  try {
    if (m.type === 'init') {
      repo = m.repo
      await load(!!m.gpu)
      post({ type: 'ready', device })
    } else if (m.type === 'tile') {
      const r = await upscale(m.w, m.h, m.rgba)
      post({ type: 'tile', id: m.id, w: r.w, h: r.h, rgba: r.rgba }, [r.rgba])
    }
  } catch (err) {
    post({ type: 'error', id: m.id, gpu: device === 'webgpu', message: String(err?.message || err) })
  }
}
