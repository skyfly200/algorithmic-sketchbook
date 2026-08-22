// Show sequencer for the Patch editor — a cue list you can jump through like a
// lighting console, or run on a timeline that ramps numeric params between
// adjacent same-topology cues. Lifted out of PatchView into a composable so the
// cue/timeline/saved-show state and the playback engine live in one place; the
// bits that touch the live graph and effect iframes (snapshot/applySnap,
// currentEffects, queueEffects, effectControls, postToEffect, the stage canvas)
// are injected via `ctx`, and <ShowPanel> renders the returned state.
import { reactive } from 'vue'
import { topoMatch, applyRamp as rampParams } from '../lib/patch/graph.js'
import { loadJson, saveJson, fileSlug, downloadJson, pickJsonFile, buildShowFile, parseShowImport } from '../lib/patch/library.js'

const SHOW_KEY = 'sketchbook-patch-show'    // the live/working cue set
const SHOWS_KEY = 'sketchbook-patch-shows'  // named, saved show files

// ctx: { nodes, snapshot(), applySnap(s), currentEffects(), queueEffects(fx),
//        effectControls (Map), postToEffect(id,msg), stage (ref → canvas),
//        showToast(msg), alertBadFile() }
export function useShow(ctx) {
  function loadShow() {
    try { return JSON.parse(localStorage.getItem(SHOW_KEY)) || [] } catch { return [] }
  }
  const state = reactive({
    cues: loadShow(),
    savedShows: loadJson(SHOWS_KEY, []),
    open: false,
    mode: 'cues',        // 'cues' | 'timeline'
    activeCue: -1,
    playing: false,
    loop: false,
    playhead: 0,         // seconds
    newShowName: '',
    // timeline strip: a little headroom past the last cue so its marker is draggable
    get length() { return this.cues.length ? Math.max(...this.cues.map((c) => c.time || 0)) : 0 },
    get span() { return Math.max(this.length + 4, 20) },
    // evenly spaced ruler ticks at a "nice" interval (~8 across the span)
    get ticks() {
      const span = this.span
      const steps = [1, 2, 5, 10, 15, 20, 30, 60, 120, 300, 600]
      const step = steps.find((s) => s >= span / 8) || 1200
      const ticks = []
      for (let t = 0; t <= span + 1e-6; t += step) ticks.push({ t, pct: (t / span) * 100 })
      return ticks
    },
  })

  function persistShow() { localStorage.setItem(SHOW_KEY, JSON.stringify(state.cues)) }
  function persistShows() { saveJson(SHOWS_KEY, state.savedShows) }

  // --- cue capture / edit ----------------------------------------------------
  function captureCueAt(t) {
    state.cues.push({ id: Date.now().toString(36), name: `Cue ${state.cues.length + 1}`, time: +Math.max(0, t).toFixed(1), fade: 1, snap: JSON.parse(ctx.snapshot()), effects: ctx.currentEffects() })
    state.activeCue = state.cues.length - 1
    persistShow()
  }
  function captureCue() {
    captureCueAt(state.cues.length ? Math.max(...state.cues.map((c) => c.time || 0)) + 8 : 0)
  }
  function updateCue(i) { state.cues[i].snap = JSON.parse(ctx.snapshot()); state.cues[i].effects = ctx.currentEffects(); persistShow() }
  function deleteCue(i) {
    state.cues.splice(i, 1)
    if (state.activeCue >= state.cues.length) state.activeCue = state.cues.length - 1
    persistShow()
  }
  function moveCue(i, d) {
    const j = i + d
    if (j < 0 || j >= state.cues.length) return
    const [c] = state.cues.splice(i, 1)
    state.cues.splice(j, 0, c)
    persistShow()
  }

  // --- cue playback ----------------------------------------------------------
  function applyCueState(cue) {
    ctx.applySnap(JSON.stringify(cue.snap))
    ctx.queueEffects({ ...(cue.effects || {}) })
  }
  // Crossfade: freeze the current stage, swap the patch, fade the frozen frame
  // out — hides the black flash while new effect iframes boot.
  let xfade = null // { img, t0, dur }
  function goCue(i, opts = {}) {
    if (i < 0 || i >= state.cues.length) return
    const cue = state.cues[i]
    const dur = ((opts.fade != null ? opts.fade : cue.fade) || 0) * 1000
    const cnv = ctx.stage.value
    if (dur > 0 && cnv && cnv.width) {
      const img = document.createElement('canvas')
      img.width = cnv.width; img.height = cnv.height
      img.getContext('2d').drawImage(cnv, 0, 0)
      xfade = { img, t0: performance.now(), dur }
    }
    applyCueState(cue)
    state.activeCue = i
  }
  function nextCue() { goCue(Math.min(state.cues.length - 1, state.activeCue + 1)) }
  function prevCue() { goCue(Math.max(0, state.activeCue - 1)) }
  // Called from the compositor's blit each frame while a crossfade is live.
  function drawXfade(cx, cnv) {
    if (!xfade) return
    const a = 1 - (performance.now() - xfade.t0) / xfade.dur
    if (a <= 0) { xfade = null; return }
    cx.globalAlpha = a; cx.drawImage(xfade.img, 0, 0, cnv.width, cnv.height); cx.globalAlpha = 1
  }

  // --- timeline playback -----------------------------------------------------
  function showLength() { return state.length }
  let lastShowTs = 0
  let curSeg = -1
  function playShow() { if (!state.cues.length) return; state.playing = true; lastShowTs = performance.now(); curSeg = -1 }
  function pauseShow() { state.playing = false }
  function stopShow() { state.playing = false; state.playhead = 0; curSeg = -1 }
  function seekShow(t) { state.playhead = Math.max(0, Math.min(showLength(), t)); curSeg = -1 }
  // Ramp the live graph's numeric params (and point arrays) from cue A→B by f.
  const applyRamp = (a, b, f) => rampParams(ctx.nodes, a, b, f)
  // Ramp each effect sketch's *internal* params between two cues by streaming
  // set-param to the live iframe. Only animates params that actually differ
  // between the cues, and throttles the postMessage traffic.
  let lastEffectRamp = 0
  function rampEffects(a, b, f) {
    const now = performance.now()
    if (now - lastEffectRamp < 45) return // ~22 Hz is plenty for a smooth ramp
    lastEffectRamp = now
    const ae = a.effects || {}, be = b.effects || {}
    for (const idStr of Object.keys(ae)) {
      if (!be[idStr]) continue
      const av = ae[idStr].values || {}, bv = be[idStr].values || {}
      const ec = ctx.effectControls.get(+idStr)
      for (const k of Object.keys(av)) {
        const x = av[k], y = bv[k]
        if (typeof x === 'number' && typeof y === 'number' && x !== y) {
          const v = x + (y - x) * f
          ctx.postToEffect(+idStr, { type: 'sketch:set-param', name: k, value: v })
          if (ec) ec.values[k] = v
        }
      }
    }
  }
  function tickShow(now) {
    const dt = (now - lastShowTs) / 1000
    lastShowTs = now
    state.playhead += dt
    const end = showLength()
    if (state.playhead >= end) {
      if (state.loop && end > 0) { state.playhead = 0; curSeg = -1 }
      else { state.playhead = end; state.playing = false }
    }
    processTimeline()
  }
  function processTimeline() {
    if (!state.cues.length) return
    const sorted = [...state.cues].sort((a, b) => (a.time || 0) - (b.time || 0))
    let i = -1
    for (let k = 0; k < sorted.length; k++) { if ((sorted[k].time || 0) <= state.playhead + 1e-6) i = k; else break }
    if (i < 0) return
    if (i !== curSeg) {
      // Skip the reload when we're flowing forward through a ramped, same-topology
      // segment (the graph is already sitting at this cue from the last ramp).
      const rampedAdjacent = i === curSeg + 1 && curSeg >= 0 && topoMatch(sorted[curSeg].snap, sorted[i].snap)
      if (rampedAdjacent) state.activeCue = state.cues.indexOf(sorted[i])
      else goCue(state.cues.indexOf(sorted[i]), { fade: sorted[i].fade })
      curSeg = i
    }
    const next = sorted[i + 1]
    if (next && topoMatch(sorted[i].snap, next.snap)) {
      const span = (next.time || 0) - (sorted[i].time || 0)
      const f = span > 0 ? Math.min(1, Math.max(0, (state.playhead - (sorted[i].time || 0)) / span)) : 0
      applyRamp(sorted[i].snap, next.snap, f)
      rampEffects(sorted[i], next, f)
    }
  }

  // --- timeline strip helpers ------------------------------------------------
  function pct(t) { return (t / state.span) * 100 }
  function fmtTime(t) {
    t = Math.round(t)
    return t >= 60 ? `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}` : `${t}s`
  }
  function tlSeek(e) {
    const r = e.currentTarget.getBoundingClientRect()
    seekShow(Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)) * state.span)
  }
  // Double-click an empty spot on the timeline to capture a cue (keyframe) there.
  function tlAddCueAt(e) {
    const r = e.currentTarget.getBoundingClientRect()
    const t = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)) * state.span
    captureCueAt(t)
  }
  let tlDrag = null
  function tlCueMove(e) {
    if (!tlDrag) return
    const r = tlDrag.track.getBoundingClientRect()
    const f = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width))
    state.cues[tlDrag.i].time = +(f * state.span).toFixed(1)
  }
  function tlCueUp() {
    if (!tlDrag) return
    tlDrag = null
    persistShow()
    window.removeEventListener('pointermove', tlCueMove)
    window.removeEventListener('pointerup', tlCueUp)
  }
  function tlCueDown(i, e) {
    tlDrag = { i, track: e.currentTarget.parentElement }
    window.addEventListener('pointermove', tlCueMove)
    window.addEventListener('pointerup', tlCueUp)
  }

  // --- file import / export + named show library -----------------------------
  function exportShow(show = null) {
    downloadJson(buildShowFile({ name: show?.name || 'show', mode: show?.mode ?? state.mode, cues: show && show.cues ? show.cues : state.cues }), `${fileSlug(show?.name || 'show')}.show.json`)
  }
  async function importShow() {
    const arr = parseShowImport(await pickJsonFile())
    if (!arr) { ctx.alertBadFile(); return }
    state.cues.splice(0, state.cues.length, ...arr)
    state.activeCue = -1
    curSeg = -1
    persistShow()
  }
  function saveShowAs() {
    if (!state.cues.length) { ctx.showToast('No cues to save yet'); return }
    const name = state.newShowName.trim() || `Show ${state.savedShows.length + 1}`
    state.savedShows.push({ id: Date.now().toString(36), name, mode: state.mode, cues: JSON.parse(JSON.stringify(state.cues)) })
    persistShows()
    state.newShowName = ''
    ctx.showToast(`Saved show “${name}”`)
  }
  function loadShowFile(s) {
    state.cues.splice(0, state.cues.length, ...JSON.parse(JSON.stringify(s.cues || [])))
    if (s.mode) state.mode = s.mode
    state.activeCue = -1
    curSeg = -1
    stopShow()
    persistShow()
    ctx.showToast(`Loaded show “${s.name}”`)
  }
  function deleteShowFile(s) {
    const i = state.savedShows.findIndex((x) => x.id === s.id)
    if (i >= 0) { state.savedShows.splice(i, 1); persistShows() }
  }

  return {
    state, persistShow,
    captureCue, updateCue, deleteCue, moveCue,
    goCue, nextCue, prevCue, drawXfade,
    showLength, playShow, pauseShow, stopShow, seekShow, tickShow,
    pct, fmtTime, tlSeek, tlAddCueAt, tlCueDown,
    exportShow, importShow, saveShowAs, loadShowFile, deleteShowFile,
  }
}
