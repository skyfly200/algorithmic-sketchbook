// Coarse device capability probe — feeds classifyTier() in budget.js. These are
// heuristics from public browser signals (they can be wrong, e.g. a hybrid GPU
// laptop), so the tier is only a default: Settings can override it.
// deviceMemory is Chromium-only and capped at 8 by the spec; absent → assume 4.

const SOFTWARE = /swiftshader|llvmpipe|softpipe|software|basic render|microsoft basic|mesa offscreen/i
// Entry-level parts carry a discrete GPU's name but perform like integrated graphics.
const ENTRY = /\bMX\s?\d{3}\b|\bGT\s?\d{3,4}\b|\bGTX\s?(6|7|9)\d{2}\b|\bGTX\s?10(30|50)\b|\bGTX\s?16(30|50)\b|radeon (rx )?(5\d{2}|r[579])\b|geforce (8|9)\d{3}/i
const DISCRETE = /nvidia|geforce|quadro|rtx|gtx|radeon (rx|pro|vii)|arc a\d|apple m\d|apple gpu.*(pro|max|ultra)/i

// renderer: the WEBGL_debug_renderer_info UNMASKED_RENDERER string ('' if unknown)
export function classifyGpu(renderer) {
  if (!renderer) return 'integrated' // unknown: assume the common middle case
  if (SOFTWARE.test(renderer)) return 'software'
  if (ENTRY.test(renderer)) return 'integrated'
  if (DISCRETE.test(renderer)) return 'discrete'
  return 'integrated'
}

export function readRenderer() {
  try {
    const gl = document.createElement('canvas').getContext('webgl2') || document.createElement('canvas').getContext('webgl')
    if (!gl) return 'software' // no WebGL at all behaves like software rendering
    const ext = gl.getExtension('WEBGL_debug_renderer_info')
    const r = ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : ''
    gl.getExtension('WEBGL_lose_context')?.loseContext()
    return r || ''
  } catch { return '' }
}

// nav / renderer injectable for tests.
export function probeCapability({ nav = typeof navigator !== 'undefined' ? navigator : {}, renderer = readRenderer() } = {}) {
  return {
    gpu: classifyGpu(renderer),
    renderer,
    cores: nav.hardwareConcurrency || 4,
    memGB: nav.deviceMemory || 4,
  }
}
