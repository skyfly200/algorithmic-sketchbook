// Natural-language patch designer — the offline parser that turns a spoken or
// typed description ("dreamy underwater glow through my webcam") into an intent:
// which effects/filters to reach for, a blend mode, whether to pull in the
// camera / audio / text / a mask, adjective-driven parameter nudges, and a
// colour. It's deliberately framework-free and deterministic so it can be
// unit-tested; the Patch view wraps parseDesignerIntent() to plumb it into the
// editable preview, and (optionally) an AI "smart mode" can replace it.

// slug → extra spoken/written phrases that don't appear in the title or slug
export const NL_SYN = {
  glow: ['bloom', 'halo', 'soft glow'], 'vhs-defects': ['vhs', 'tape', 'video tape'],
  'rain-window': ['rain', 'rainy', 'raindrops', 'window rain'],
  kaleidoscope: ['kaleidoscopic', 'mirror'], 'channel-offset': ['rgb split', 'chromatic', 'chromatic aberration', 'colour split', 'color split'],
  'motion-extraction': ['motion', 'motion extraction', 'echo trails'], pointillism: ['dots', 'stipple', 'pointillist'],
  halftone: ['comic', 'newspaper', 'print dots'], 'brightness-contrast': ['brightness', 'contrast'],
  'liquid-metal': ['chrome', 'mercury', 'molten'], 'ink-bleed': ['ink', 'watercolor', 'watercolour', 'bleeding ink'],
  polaroid: ['old photo', 'vintage photo', 'aged photo'], twist: ['twirl', 'swirl'],
  'hyperbolic-space': ['hyperbolic', 'poincare'], azulejos: ['azulejo', 'spanish tiles', 'portuguese tiles', 'ceramic tiles'],
  noise: ['static', 'fractal noise', 'tv snow'], feedback: ['trails', 'feedback loop'],
  crt: ['old tv', 'scanlines'], microbes: ['diatom', 'diatoms', 'algae', 'bacteria', 'plankton', 'microscope', 'petri'],
}
// Mood/theme words → extra search keywords that get matched against the catalog,
// so vibe-only descriptions ("dreamy underwater", "glitchy") still find sketches.
export const NL_MOODS = {
  dreamy: ['glow', 'bloom', 'soft', 'mist', 'fog', 'nebula'], ethereal: ['glow', 'mist', 'nebula', 'aurora'],
  glitch: ['vhs', 'channel', 'rgb split', 'crt', 'interlace', 'feedback'], glitchy: ['vhs', 'channel', 'rgb split', 'crt', 'interlace'],
  underwater: ['caustics', 'water', 'ripple', 'liquid', 'ocean', 'wave'], aquatic: ['caustics', 'water', 'ripple', 'liquid'],
  psychedelic: ['kaleidoscope', 'plasma', 'moire', 'swirl', 'liquid light'], trippy: ['kaleidoscope', 'moire', 'swirl', 'plasma'],
  retro: ['vhs', 'crt', 'film', 'halftone'], vintage: ['film', 'polaroid', 'halftone', 'grain', 'crt'],
  fiery: ['ember', 'flame', 'solar', 'lava', 'fire'], fire: ['ember', 'flame', 'solar', 'lava'],
  cosmic: ['nebula', 'stars', 'galaxy', 'solar', 'aurora'], space: ['nebula', 'stars', 'galaxy', 'solar'],
  organic: ['slime', 'coral', 'fungal', 'mycelium', 'flower', 'bloom'], natural: ['coral', 'flower', 'bloom', 'animal'],
  geometric: ['tiling', 'hyperbolic', 'moire', 'grid', 'azulejo'], neon: ['glow', 'uv', 'strobe', 'laser'],
  calm: ['fog', 'mist', 'glow', 'flow'], chaotic: ['feedback', 'strobe', 'shaky', 'noise'], energetic: ['strobe', 'feedback', 'kaleidoscope'],
}
// Adjectives that nudge parameters after building: [category, +1|-1, trigger words].
export const NL_MODS = [
  ['speed', +1, ['fast', 'quick', 'rapid', 'energetic', 'frantic', 'hyper', 'racing']],
  ['speed', -1, ['slow', 'calm', 'gentle', 'lazy', 'sluggish', 'relaxed', 'drifting']],
  ['bright', +1, ['bright', 'glowing', 'vivid', 'luminous', 'radiant', 'brilliant']],
  ['bright', -1, ['dark', 'dim', 'moody', 'shadowy', 'murky', 'gloomy', 'muted']],
  ['contrast', +1, ['punchy', 'harsh', 'high contrast', 'high-contrast', 'stark', 'crisp', 'bold']],
  ['contrast', -1, ['soft', 'flat', 'washed', 'faded', 'hazy', 'gentle']],
  ['amount', +1, ['intense', 'strong', 'heavy', 'extreme', 'aggressive', 'wild', 'max', 'dramatic']],
  ['amount', -1, ['subtle', 'light', 'faint', 'minimal', 'delicate', 'slight']],
  ['scale', +1, ['big', 'large', 'huge', 'zoomed', 'macro', 'giant', 'coarse']],
  ['scale', -1, ['small', 'tiny', 'fine', 'micro', 'dense', 'detailed']],
]
// category → which schema param names/labels it should drive
export const NL_MOD_PARAMS = {
  speed: /speed|rate|flow|churn|drift|velocity|tempo|spin|swirl/i,
  bright: /bright|expos|glow|lumin|value|gain|light/i,
  contrast: /contrast|gamma|punch/i,
  amount: /amount|intensity|strength|mix|power|depth|density|opacity|blur/i,
  scale: /scale|zoom|size|radius|detail|freq|count/i,
}
export const NL_COLORS = { red: 0, crimson: 350, scarlet: 5, orange: 30, amber: 40, yellow: 55, gold: 48, lime: 90, green: 130, emerald: 150, teal: 170, cyan: 185, aqua: 185, blue: 215, azure: 205, indigo: 250, purple: 275, violet: 270, magenta: 305, pink: 325, rose: 340, white: 0, black: 0 }
export const NL_STOP = new Set('the and with over into through onto a an of to in on for it its this that make makes look looks like live source filter effect them then as by from your you i me my is are be or so at not no all one two some more very really want give show turn put using use add just kinda sort feel feels bit little lot really really'.split(/\s+/))
export const NL_BLENDS = [['soft light', 'soft-light'], ['hard light', 'hard-light'], ['color dodge', 'color-dodge'], ['dodge', 'color-dodge'], ['burn', 'color-burn'], ['screen', 'screen'], ['additive', 'add'], ['add', 'add'], ['multiply', 'multiply'], ['overlay', 'overlay'], ['difference', 'difference'], ['lighten', 'lighten'], ['darken', 'darken']]
export const NL_TEXT_DEFAULTS = { font: 'sans-serif', size: 0.2, weight: 800, tracking: 0.04, x: 0.5, y: 0.5, hue: 200, sat: 82, val: 96, rotate: 0, italic: false, glow: 0.4, bg: false }

// word-boundary-ish search; returns match position or -1
export function nlHas(text, phrase) {
  const p = (phrase || '').trim().toLowerCase()
  if (p.length < 2) return -1
  const esc = p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const m = new RegExp(`(^|[^a-z0-9])${esc}([^a-z0-9]|$)`, 'i').exec(text)
  return m ? m.index : -1
}
// HSV(0-360,0-100,0-100) → #rrggbb, for setting an effect's colour params.
export function hueHex(h, s = 85, v = 95) {
  h = ((h % 360) + 360) % 360; s /= 100; v /= 100
  const c = v * s, x = c * (1 - Math.abs(((h / 60) % 2) - 1)), m = v - c
  let r = 0, g = 0, b = 0
  if (h < 60) [r, g, b] = [c, x, 0]; else if (h < 120) [r, g, b] = [x, c, 0]
  else if (h < 180) [r, g, b] = [0, c, x]; else if (h < 240) [r, g, b] = [0, x, c]
  else if (h < 300) [r, g, b] = [x, 0, c]; else [r, g, b] = [c, 0, x]
  return '#' + [r, g, b].map((n) => Math.round((n + m) * 255).toString(16).padStart(2, '0')).join('')
}
// Words distinctive enough (appear in few descriptions) to be worth matching on.
function buildDescIndex(opts) {
  const idx = new Map()
  for (const s of opts) {
    for (const w of new Set(String(s.description || '').toLowerCase().match(/[a-z]{5,}/g) || [])) idx.set(w, (idx.get(w) || 0) + 1)
  }
  return idx
}
// Score each catalog option against the text: strong hits on title/slug/synonym,
// weaker on tags, distinctive description words, and mood-derived keywords.
function nlScore(opts, text, moodKW, idx) {
  const found = []
  for (const s of opts) {
    let score = 0, pos = Infinity
    const strong = [s.title.toLowerCase(), s.slug.replace(/-/g, ' '), ...(NL_SYN[s.slug] || [])]
    for (const ph of strong) { const i = nlHas(text, ph); if (i >= 0) { score += 5; if (i < pos) pos = i } }
    for (const t of (s.tags || [])) { if (t.length >= 4 && !t.includes('-')) { const i = nlHas(text, t); if (i >= 0) { score += 1.5; if (i < pos) pos = i } } }
    for (const w of new Set(String(s.description || '').toLowerCase().match(/[a-z]{5,}/g) || [])) {
      if ((idx.get(w) || 99) <= 5) { const i = nlHas(text, w); if (i >= 0) { score += 1; if (i < pos) pos = i } }
    }
    for (const kw of moodKW) { for (const ph of strong) if (ph.includes(kw)) { score += 2.5; break } }
    if (score > 0) found.push({ s, score, pos: pos === Infinity ? 9999 : pos })
  }
  found.sort((a, b) => b.score - a.score || a.pos - b.pos)
  const seen = new Set()
  return found.filter((m) => !seen.has(m.s.slug) && seen.add(m.s.slug))
}

// Parse a prompt into an editable intent object. `effectOptions`/`filterOptions`
// are the catalog lists ({ slug, title, description, tags }) to match against.
// Pure — returns the intent; the caller decides what to do with it.
export function parseDesignerIntent(prompt, effectOptions, filterOptions) {
  const text = String(prompt || '').toLowerCase()
  const recognized = new Set()
  const note = (phrase) => { for (const w of String(phrase).toLowerCase().split(/[^a-z0-9]+/)) if (w.length > 2) recognized.add(w) }

  // Pull the literal text-content first (a quoted string, or "saying X"), then
  // strip it from the matching text so words *inside* the caption (e.g. "BRIGHT
  // WAVES") don't get read as effect names, moods, adjectives or colours.
  let quote = prompt.match(/["“”'‘’]([^"“”'‘’]{1,60})["“”'‘’]/)
  let textContent = quote ? quote[1] : null
  const textM = text.match(/\b(text|title|lyrics|typography|caption|words)\b/)
  if (!textContent) { const m = text.match(/\b(?:saying|text|title|words?|says|caption)\s+([a-z0-9 ,'!?-]{2,40})/); if (m) { textContent = m[1].replace(/\b(over|on|onto|with|through|and|then|masked|blend).*$/, '').trim() } }
  let search = text
  if (quote) search = search.replace(quote[0].toLowerCase(), ' ')
  if (textM) note(textM[0])

  const moodKW = []
  for (const [mood, kws] of Object.entries(NL_MOODS)) if (nlHas(search, mood) >= 0) { moodKW.push(...kws); note(mood) }

  const idx = buildDescIndex([...effectOptions, ...filterOptions])
  const effM = nlScore(effectOptions, search, moodKW, idx)
  const filtM = nlScore(filterOptions, search, moodKW, idx)
  for (const m of [...effM, ...filtM]) {
    note(m.s.title); note(m.s.slug.replace(/-/g, ' '))
    for (const syn of (NL_SYN[m.s.slug] || [])) if (nlHas(search, syn) >= 0) note(syn)
  }

  let blend = 'screen'
  for (const [w, mode] of NL_BLENDS) if (nlHas(search, w) >= 0) { blend = mode; note(w); break }

  const camM = search.match(/\b(camera|webcam|selfie|my face|live video|myself|my cam)\b/); if (camM) note(camM[0])
  const maskM = search.match(/\b(mask|masked|through the (?:text|shape|word)|inside the (?:text|shape)|cut ?out|silhouette|stencil|clipped)\b/); if (maskM) note(maskM[0])
  if (textContent) note(textContent)
  const audM = search.match(/\b(audio|music|beat|bass|mic|sound|react|pulse|rhythm)\b/); if (audM) note(audM[0])
  const mouM = search.match(/\b(mouse|cursor|pointer)\b/); if (mouM) note(mouM[0])

  const mods = {}
  for (const [cat, dir, words] of NL_MODS) { if (mods[cat]) continue; for (const w of words) if (nlHas(search, w) >= 0) { mods[cat] = dir; note(w); break } }

  let color = null
  for (const [name, hue] of Object.entries(NL_COLORS)) if (nlHas(search, name) >= 0) { color = { name, hue, sat: name === 'white' ? 0 : 85, val: name === 'black' ? 10 : 95 }; note(name); break }

  const ignored = [...new Set((search.match(/[a-z][a-z'-]{2,}/g) || []).filter((w) => !NL_STOP.has(w) && !recognized.has(w)))].slice(0, 12)

  return {
    effects: effM.slice(0, 3).map((m) => ({ slug: m.s.slug, title: m.s.title })),
    filters: filtM.slice(0, 4).map((m) => ({ slug: m.s.slug, title: m.s.title })),
    camera: !!camM, text: { on: !!textContent || !!textM, content: textContent },
    mask: !!maskM, audio: !!audM, mouse: !!mouM, blend, mods, color, ignored,
  }
}

// --- AI smart mode ----------------------------------------------------------
// The optional Claude-powered designer. The offline parser above handles most
// prompts; with the user's own API key, this sends the description + the live
// effect/filter catalogue to the model and gets back a structured graph spec.
// The three helpers here are the framework-free core — the system prompt, the
// per-node param sanitizer that clamps whatever the model returns to safe
// ranges, and the fetch itself (fetchImpl injectable for tests). PatchView owns
// the reactive graph mutation that turns a validated spec into live nodes.

// Clamp a numeric field to [lo,hi], falling back to d for non-numbers.
export function nlNum(v, d, lo = -Infinity, hi = Infinity) {
  return typeof v === 'number' && isFinite(v) ? Math.max(lo, Math.min(hi, v)) : d
}

// The system prompt describing the node graph the model must emit.
export const NL_SYSTEM_PROMPT = `You are the patch designer for "Bright Waves", a live-visuals node-graph compositor. Turn the user's description into a graph as a JSON object and nothing else.

Node types (field "type"):
- effect: a generative source. Needs "slug" from the effects list.
- filter: processes ONE video input (port 0). Needs "slug" from the filters list.
- media: a camera source. Use {"type":"media","mode":"camera"}.
- text: on-screen text. Fields: text, and optional x,y (0..1), size (0.03..0.6), weight (100..900), hue (0..360), sat (0..100), val (0..100), rotate.
- sprite: a placed image. Optional x,y,scale.
- polygon: a white matte shape source. Optional "shape": one of triangle,square,pentagon,hexagon,octagon,circle,diamond,star,heart,arrow,cross.
- mask: cuts a picture to a matte. Input port 0 = picture (content), port 1 = matte (a polygon/text). Optional "invert".
- blend: composites TWO inputs. Port 0 = base, port 1 = top. Fields: mode (screen,add,multiply,overlay,difference,lighten,darken,soft-light,normal), mix (0..1).
- portal: remaps a region. geo/vcam: 3D geometry + camera (geo feeds vcam).
- input: emits a 0..1 control signal. Field "source" from the input-sources list. xy: an XY pad control. tracker: video motion tracker.
- output: the final image. Exactly one; wire the last picture node into it.

Rules:
- "edges" are VIDEO/geometry connections: {"from": id, "to": id, "port": inputIndex}. port is 0-based.
- "links" are CONTROL connections from an input/xy/tracker OUTPUT to a target node's numeric PARAM: {"from": id, "to": id, "param": "mix"}. Controllable params include blend "mix", text "x"/"y"/"hue"/"rotate"/"size", portal edges, polygon "feather".
- Every graph must end in exactly one output node fed by the final picture.
- Only use slugs that appear in the provided lists. Prefer few nodes (2–7) unless the description clearly needs more.
- ids are short strings you choose.

Return ONLY a JSON object: {"nodes":[...],"edges":[...],"links":[...],"notes":"one short sentence"}. No markdown, no prose.`

// Sanitize one node from the model's spec into a safe params object, clamping
// every numeric field and falling back known slugs/sources to valid choices.
// ctx supplies the catalogue sets + defaults so this stays framework-free.
export function specNodeParams(n, ctx) {
  const {
    effectSlugs, filterSlugs, inputSlugs, blends = [], polyShapes = {},
    fallbackEffect = '', fallbackFilter = '', seed = () => '', nodeW = 190, thumbH = 107,
  } = ctx
  const capitalize = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1).toLowerCase() : s)
  switch (n.type) {
    case 'effect': return { slug: effectSlugs.has(n.slug) ? n.slug : fallbackEffect, seed: seed() }
    case 'filter': return { slug: filterSlugs.has(n.slug) ? n.slug : fallbackFilter, seed: seed() }
    case 'blend': return { mode: blends.includes(n.mode) ? n.mode : 'screen', mix: nlNum(n.mix, 0.6, 0, 1) }
    case 'text': return { ...NL_TEXT_DEFAULTS, text: String(n.text ?? 'BRIGHT WAVES'), x: nlNum(n.x, 0.5, 0, 1), y: nlNum(n.y, 0.5, 0, 1), size: nlNum(n.size, 0.2, 0.03, 0.6), weight: nlNum(n.weight, 800, 100, 900), hue: nlNum(n.hue, 200, 0, 360), sat: nlNum(n.sat, 82, 0, 100), val: nlNum(n.val, 96, 0, 100), rotate: nlNum(n.rotate, 0, -180, 180) }
    case 'input': return { source: inputSlugs.has(n.source) ? n.source : 'audio.pulse', scale: 1, offset: 0, invert: false, curve: 'linear' }
    case 'xy': return { x: 0.5, y: 0.5, recenter: false, xMin: 0, xMax: 1, yMin: 0, yMax: 1, curve: 'linear', padW: nodeW, padH: thumbH }
    case 'tracker': return { thresh: 0.5, smooth: 0.7 }
    case 'media': return { mode: 'camera', mediaId: null }
    case 'sprite': return { mediaId: null, x: nlNum(n.x, 0.5, 0, 1), y: nlNum(n.y, 0.5, 0, 1), scale: nlNum(n.scale, 0.4, 0.02, 2), rotate: 0, opacity: 1, spin: 0, motion: 'None', speed: 0.5, amp: 0.2, cols: 1, rows: 1, fps: 12 }
    case 'polygon': { const shp = polyShapes[capitalize(n.shape)]; return { points: (shp || [[0.2, 0.2], [0.8, 0.2], [0.8, 0.8], [0.2, 0.8]]).map((p) => [...p]), feather: nlNum(n.feather, 0, 0, 0.5) } }
    case 'mask': return { mode: 'multiply', strength: 1, invert: !!n.invert }
    case 'portal': return { srcX: 0.05, srcY: 0.05, srcW: 0.35, srcH: 0.35, dstX: 0.6, dstY: 0.6, dstW: 0.35, dstH: 0.35, recurse: 1, border: true, shape: 'rectangle', lockAspect: false, aspect: '1:1' }
    case 'geo': return { shape: 'Icosahedron', material: 'Solid', hue: 160, sat: 72, val: 90, displace: 0.25, freq: 2, spin: 0.5, detail: 2, flutes: 8, twist: 90, groove: 0.28, source: 'Shape', cloud: 'Galaxy', voxel: 'Sphere', count: 12000, res: 18, pointSize: 0.03, dataVer: 0, lat: 46.5, lon: 8.0, zoom: 11, terrainRes: 96, verticalScale: 0.6, drape: true }
    case 'vcam': return { fov: 55, distance: 4.5, orbit: 0.4, tilt: 0.35, bg: 'Dark', lightHue: 40, lightSat: 34, lightVal: 86, spin: true }
    default: return {}
  }
}

// Call the Anthropic API (directly from the browser, with the user's own key)
// and return the parsed JSON patch. Throws on HTTP error or missing JSON.
export async function callDesignerAI({ prompt, apiKey, model, system = NL_SYSTEM_PROMPT, effects, filters, inputs, maxTokens = 1600, fetchImpl = globalThis.fetch }) {
  const eff = effects.map((s) => `${s.slug}: ${s.title}`).join('\n')
  const filt = filters.map((s) => `${s.slug}: ${s.title}`).join('\n')
  const user = `EFFECTS (sources), slug: title —\n${eff}\n\nFILTERS (process video), slug: title —\n${filt}\n\nINPUT SOURCES for input nodes: ${inputs.join(', ')}\n\nDESCRIPTION: "${prompt}"\n\nReturn ONLY the JSON patch.`
  const res = await fetchImpl('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({ model, max_tokens: maxTokens, system, messages: [{ role: 'user', content: user }] }),
  })
  if (!res.ok) {
    let msg = res.status + ''
    try { const j = await res.json(); msg = j.error?.message || JSON.stringify(j).slice(0, 140) } catch { /* non-json */ }
    throw new Error(msg)
  }
  const data = await res.json()
  const text = (data.content || []).map((c) => c.text || '').join('')
  const a = text.indexOf('{'), b = text.lastIndexOf('}')
  if (a < 0 || b < a) throw new Error('no JSON in response')
  return JSON.parse(text.slice(a, b + 1))
}

// Given an effect sketch's live param schema, decide which params a set of
// adjective mods + a colour should nudge and to what value: adjective categories
// (NL_MOD_PARAMS) push a matching numeric param toward its high/low end, a colour
// fills a colour param or an obvious "hue" param. Returns [name, value] pairs;
// PatchView pushes each to the effect over postMessage.
export function resolveEffectMods(schema, mods = {}, color = null) {
  const out = []
  for (const [name, spec] of Object.entries(schema || {})) {
    const label = (name + ' ' + (spec.label || '')).toLowerCase()
    if (spec.type === 'color') { if (color) out.push([name, hueHex(color.hue, color.sat, color.val)]); continue }
    if (typeof spec.min !== 'number') continue
    const span = spec.max - spec.min || 1
    let applied = false
    for (const [cat, re] of Object.entries(NL_MOD_PARAMS)) {
      if (mods[cat] && re.test(label)) { out.push([name, +(spec.min + span * (mods[cat] > 0 ? 0.8 : 0.2)).toFixed(4)]); applied = true; break }
    }
    if (!applied && color && /\bhue\b/.test(label)) out.push([name, spec.max <= 361 ? color.hue : +(color.hue / 360).toFixed(3)])
  }
  return out
}
