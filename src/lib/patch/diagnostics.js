// Patch error checking. Framework-free, so it can be tested on its own.
//
// diagnoseDeck() looks at one deck's graph and returns the problems a user would want to be told about,
// each with a plain-language message, how to fix it, and (where there is a safe one) a one-click action.
// runtimeIssue() builds the same shape for things only the running app can see: a sketch that crashed or
// never loaded, a denied camera, a clip that will not play.
//
// Severity, as the user sees it:
//   error    the picture is blank or wrong
//   warning  probably not what was intended
//   info     worth knowing, never counted as a problem (a node that is not connected yet, mid-edit)
//
// Things deliberately NOT flagged: feedback cycles (a documented one-frame-delay feature), wires to missing
// nodes or ports (pruneOrphans removes those and reports the count instead), and nodes on a branch that
// cannot reach the Output are only `info`, so building a patch is not nagged at.
import { TYPES, PARAM_RANGES } from './constants.js'
import { liveNodes } from './scheduler.js'

export const SEVERITY_RANK = { error: 3, warning: 2, info: 1 }

// Control emitters: they output 0..1 values on control wires, not video.
const CONTROL = new Set(['input', 'xy', 'tracker'])
const isVideoSource = (t) => t !== 'output' && !CONTROL.has(t)
// a name the user gave it, or its type and number, so two Effect nodes can be told apart
const nodeLabel = (n) => n.name || `${TYPES[n.type]?.title || n.type}${n.id != null ? ' #' + n.id : ''}`

const issue = (o) => ({ nodeId: null, action: null, ...o, key: `${o.code}:${o.nodeId ?? ''}:${o.extra ?? ''}` })

/**
 * @param {{ nodes: object[], edges: object[], links?: object[], deckIdx?: number, deckName?: string }} deck
 * @param {object} ctx  what the checks need to know about the app
 *   sketchOf(slug) -> { title, isFilter } | null   whether a sketch exists
 *   mediaReady, mediaExists(id)                    the media library (it loads after startup)
 *   cameraOn, screenOn, micOn
 *   schemaOf(nodeId) -> Set<string> | null          an effect's param names, null until its sketch has announced them
 *   hasImage(node) -> bool                          a sprite / media node's picture exists
 */
export function diagnoseDeck(deck, ctx) {
  const { nodes, edges, links = [], deckIdx = 0, deckName = '' } = deck
  if (!nodes.length) return []
  const out = []
  const where = deckName ? ` (deck ${deckName})` : ''
  const add = (o) => out.push(issue({ deck: deckIdx, ...o }))
  const byId = new Map(nodes.map((n) => [n.id, n]))
  const inEdges = (id) => edges.filter((e) => e.to === id)
  const outEdges = (id) => edges.filter((e) => e.from === id)

  // --- node types we do not know (a patch from a newer version, or a damaged file) ---
  const known = nodes.filter((n) => TYPES[n.type])
  for (const n of nodes) {
    if (TYPES[n.type]) continue
    add({
      code: 'UNKNOWN_NODE', severity: 'error', nodeId: n.id,
      title: 'Unknown node type',
      message: `Node #${n.id} is a "${n.type}" node, which this version does not have, so it draws nothing${where}.`,
      fix: 'Delete it (select it and press Delete) and rebuild that part of the patch. If the file came from a newer version, open it there instead.',
      action: { type: 'removeNode', nodeId: n.id, label: 'Delete the node' },
    })
  }

  // --- the Output ---
  const outputs = known.filter((n) => n.type === 'output')
  if (!outputs.length) {
    // wire the only loose video node, when there is exactly one
    const sinks = known.filter((n) => isVideoSource(n.type) && !outEdges(n.id).length)
    const only = sinks.length === 1 ? sinks[0] : null
    add({
      code: 'NO_OUTPUT', severity: 'error',
      title: 'No Output node',
      message: `Nothing in this patch is sent to the screen: it has no Output node, so the stage stays black${where}.`,
      fix: 'Click the monitor button in the toolbar ("Add Output") and drag the right-hand port of your last node onto the Output\'s left-hand port.',
      action: { type: 'addOutput', connectFrom: only?.id ?? null, label: only ? `Add an Output and connect ${nodeLabel(only)}` : 'Add an Output node' },
    })
  } else {
    if (outputs.length > 1) {
      add({
        code: 'MULTIPLE_OUTPUTS', severity: 'warning', nodeId: outputs[1].id,
        title: 'More than one Output',
        message: `This deck has ${outputs.length} Output nodes. Only the first one is shown on the stage${where}.`,
        fix: 'Delete the Outputs you do not need (select one and press Delete).',
        action: { type: 'removeNode', nodeId: outputs[1].id, label: 'Delete the extra Output' },
      })
    }
    for (const o of outputs) {
      if (inEdges(o.id).some((e) => e.port === 0)) continue
      const sinks = known.filter((n) => isVideoSource(n.type) && n.id !== o.id && !outEdges(n.id).length)
      const only = sinks.length === 1 ? sinks[0] : null
      add({
        code: 'OUTPUT_EMPTY', severity: 'error', nodeId: o.id,
        title: 'The Output has no input',
        message: `Nothing is connected to the Output, so the stage is black${where}.`,
        fix: 'Drag the right-hand port of the node you want to see onto the Output\'s left-hand port.',
        action: only ? { type: 'connect', from: only.id, to: o.id, port: 0, label: `Connect ${nodeLabel(only)} to the Output` } : { type: 'focus', nodeId: o.id, label: 'Show the Output' },
      })
    }
  }

  // --- what reaches the Output ---
  // Reach ignores the "hidden behind an opaque top layer" rule, so a layer that is merely covered
  // is told apart from one that is not connected at all.
  const noHide = nodes.map((n) => (n.type === 'blend' ? { ...n, params: { ...n.params, mode: 'screen' } } : n))
  const reach = liveNodes({ nodes: noHide, edges, links }).live
  const live = liveNodes({ nodes, edges, links }).live
  const hasOutput = outputs.length > 0
  const dangling = new Set()
  for (const n of known) {
    if (n.type === 'output' || CONTROL.has(n.type) || live.has(n.id)) continue
    if (reach.has(n.id)) {
      add({
        code: 'HIDDEN_BEHIND', severity: 'warning', nodeId: n.id,
        title: 'Covered by another layer',
        message: `${nodeLabel(n)} is connected, but a Blend above it uses Normal mode at full mix with an opaque layer, so it can never be seen${where}.`,
        fix: 'Lower that Blend\'s mix, change its mode away from Normal, or remove the covering layer.',
        action: { type: 'focus', nodeId: n.id, label: 'Show the node' },
      })
    } else if (hasOutput) {
      dangling.add(n.id)
      add({
        code: 'NOT_CONNECTED', severity: 'info', nodeId: n.id,
        title: 'Not connected to the Output',
        message: `${nodeLabel(n)} does not lead to the Output, so it is not part of the picture and is paused to save power${where}.`,
        fix: 'Drag its right-hand port onto another node, ending at the Output. Delete it if you do not need it.',
        action: { type: 'focus', nodeId: n.id, label: 'Show the node' },
      })
    }
  }

  // --- node by node (skipping anything that is not connected: it is already reported as info) ---
  const linksTo = (id) => links.filter((l) => l.node === id)
  for (const n of known) {
    if (dangling.has(n.id)) continue
    const ins = inEdges(n.id)
    const has = (port) => ins.some((e) => e.port === port)
    const focus = { type: 'focus', nodeId: n.id, label: 'Show the node' }

    if (n.type === 'effect' || n.type === 'filter') {
      const slug = n.params?.slug
      if (!slug) {
        add({ code: 'SKETCH_NONE', severity: 'error', nodeId: n.id, title: 'No sketch chosen', message: `${nodeLabel(n)} has no sketch selected, so it draws nothing${where}.`, fix: 'Open the node and pick one from its sketch dropdown.', action: focus })
      } else {
        const sk = ctx.sketchOf(slug)
        if (!sk) {
          add({
            code: 'SKETCH_MISSING', severity: 'error', nodeId: n.id, extra: slug,
            title: 'Sketch not available',
            message: `The sketch "${slug}" is not in this version, so ${nodeLabel(n)} draws nothing${where}. It may have been renamed or removed, or the patch came from a different build.`,
            fix: 'Open the node and pick another sketch from its dropdown.', action: focus,
          })
        } else if (n.type === 'effect' && sk.isFilter) {
          add({
            code: 'KIND_MISMATCH', severity: 'warning', nodeId: n.id, extra: slug,
            title: 'A filter in an Effect node',
            message: `"${sk.title}" is a filter, but this is an Effect node, which has no input, so it can only process its built-in demo picture${where}.`,
            fix: 'Add a Filter node from the toolbar, choose this sketch there, and wire your source into it.', action: focus,
          })
        } else if (n.type === 'filter' && !sk.isFilter) {
          add({
            code: 'KIND_MISMATCH', severity: 'warning', nodeId: n.id, extra: slug,
            title: 'A generator in a Filter node',
            message: `"${sk.title}" draws its own picture and ignores its input, so wiring a source into this Filter node has no effect${where}.`,
            fix: 'Use an Effect node for this sketch, or pick a real filter in this node.', action: focus,
          })
        }
      }
    }

    if (n.type === 'filter' && !has(0) && n.params?.slug) {
      add({
        code: 'FILTER_NO_INPUT', severity: 'warning', nodeId: n.id,
        title: 'Filter has no input',
        message: `${nodeLabel(n)} has nothing wired into it, so it processes its built-in demo picture instead of your image${where}.`,
        fix: 'Drag the right-hand port of a source (Effect, Media, Text...) onto this Filter\'s left-hand port.', action: focus,
      })
    }
    if (n.type === 'portal' && !has(0)) {
      add({
        code: 'PORTAL_NO_INPUT', severity: 'warning', nodeId: n.id,
        title: 'Portal has no input',
        message: `${nodeLabel(n)} has nothing to remap, so it shows a black frame${where}.`,
        fix: 'Wire a source into its left-hand port.', action: focus,
      })
    }
    if (n.type === 'mask') {
      if (!has(0)) {
        add({ code: 'MASK_NO_CONTENT', severity: 'error', nodeId: n.id, title: 'Mask has no picture to cut', message: `${nodeLabel(n)} has no picture wired into its first port, so it shows nothing${where}.`, fix: 'Wire the picture you want to cut into its first (top) port and a matte (a Polygon, Text or gradient) into the second.', action: focus })
      } else if (!has(1)) {
        add({ code: 'MASK_NO_MATTE', severity: 'warning', nodeId: n.id, title: 'Mask has no matte', message: `${nodeLabel(n)} has no matte wired into its second port, so the picture passes through uncut${where}.`, fix: 'Wire a Polygon, Text or any bright-on-dark source into its second port.', action: focus })
      }
    }
    if (n.type === 'blend') {
      if (!has(0) && !has(1)) {
        add({ code: 'BLEND_EMPTY', severity: 'warning', nodeId: n.id, title: 'Blend has no layers', message: `${nodeLabel(n)} has nothing wired into it, so it shows a black frame${where}.`, fix: 'Wire one source into each of its two ports.', action: focus })
      } else if (!has(0) || !has(1)) {
        add({ code: 'BLEND_ONE_LAYER', severity: 'info', nodeId: n.id, title: 'Blend has one layer', message: `${nodeLabel(n)} only has one input, so it passes that picture through unchanged${where}.`, fix: 'Wire a second source into the empty port to blend the two.', action: focus })
      }
    }
    if (n.type === 'vcam' && !ins.some((e) => byId.get(e.from)?.type === 'geo')) {
      add({ code: 'CAMERA_NO_GEOMETRY', severity: 'warning', nodeId: n.id, title: 'Camera has nothing to film', message: `${nodeLabel(n)} has no Geometry node wired into it, so its scene is empty${where}.`, fix: 'Add a Geometry node (point cloud, terrain or shape) and wire it into the Camera.', action: focus })
    }
    if (n.type === 'geo' && !outEdges(n.id).some((e) => byId.get(e.to)?.type === 'vcam')) {
      add({ code: 'GEOMETRY_NOT_FILMED', severity: 'info', nodeId: n.id, title: 'Geometry is not in a Camera', message: `${nodeLabel(n)} is only seen through a Camera node, and none is connected${where}.`, fix: 'Add a Camera node and wire this Geometry into it.', action: focus })
    }

    if (n.type === 'media') {
      const mode = n.params?.mode ?? 'camera'
      if (mode === 'library') {
        const id = n.params?.mediaId
        if (id == null) {
          add({ code: 'MEDIA_NOT_CHOSEN', severity: 'error', nodeId: n.id, title: 'No clip chosen', message: `${nodeLabel(n)} is set to play from your library but no clip is chosen, so it is black${where}.`, fix: 'Pick a clip in the node\'s Clip dropdown, or add one with the Import wizard.', action: { type: 'import', label: 'Open the Import wizard' } })
        } else if (ctx.mediaReady && !ctx.mediaExists(id)) {
          add({ code: 'MEDIA_MISSING', severity: 'error', nodeId: n.id, title: 'Clip is missing', message: `The clip ${nodeLabel(n)} uses is no longer in your media library, so it is black${where}. Media is stored in this browser: clearing site data, or opening the patch on another computer, loses it.`, fix: 'Import the file again with the Import wizard and pick it in the node\'s Clip dropdown.', action: { type: 'import', label: 'Open the Import wizard' } })
        }
      } else if (mode === 'camera' && !ctx.cameraOn) {
        add({ code: 'CAMERA_OFF', severity: 'warning', nodeId: n.id, title: 'Camera is off', message: `${nodeLabel(n)} shows the camera, which is switched off, so it is black${where}.`, fix: 'Click the camera button in the toolbar and allow access when the browser asks.', action: { type: 'toggleCamera', label: 'Turn the camera on' } })
      } else if (mode === 'screen' && !ctx.screenOn) {
        add({ code: 'SCREEN_NOT_SHARED', severity: 'warning', nodeId: n.id, title: 'Screen is not shared', message: `${nodeLabel(n)} shows a shared screen or window, but nothing is being shared, so it is black${where}.`, fix: 'Click "Share screen" on the node and choose a window or screen.', action: focus })
      }
    }
    if (n.type === 'sprite' && !ctx.hasImage(n)) {
      if (!ctx.mediaReady && n.params?.mediaId != null) { /* the library is still loading */ } else {
        add({ code: 'SPRITE_NO_IMAGE', severity: 'error', nodeId: n.id, title: 'Sprite has no image', message: `${nodeLabel(n)} has no image, so nothing is drawn${where}.`, fix: 'Load an image into the sprite (use the Import wizard, then pick it in the node).', action: { type: 'import', label: 'Open the Import wizard' } })
      }
    }

    // a control input that listens to audio needs the microphone
    if (n.type === 'input' && String(n.params?.source ?? '').startsWith('audio.') && !ctx.micOn && (links.some((l) => l.from === n.id))) {
      add({ code: 'INPUT_NEEDS_MIC', severity: 'warning', nodeId: n.id, extra: n.params.source, title: 'The microphone is off', message: `${nodeLabel(n)} listens to audio (${n.params.source}), which stays at 0 while the microphone is off${where}.`, fix: 'Click the microphone button in the toolbar and allow access.', action: { type: 'toggleMic', label: 'Turn the microphone on' } })
    }
  }

  // --- control wires pointing at a parameter that no longer exists ---
  links.forEach((l, i) => {
    const t = byId.get(l.node)
    if (!t) return
    let gone = false
    if (t.type === 'effect' || t.type === 'filter') {
      const schema = ctx.schemaOf(t.id) // null until the sketch has announced its params
      gone = !!schema && !schema.has(l.param)
    } else if (PARAM_RANGES[t.type]) {
      gone = !(l.param in PARAM_RANGES[t.type])
    }
    if (gone) {
      add({
        code: 'LINK_PARAM_GONE', severity: 'warning', nodeId: t.id, extra: l.param,
        title: 'A control wire has nothing to drive',
        message: `A wire from ${nodeLabel(byId.get(l.from) ?? { type: 'input' })} points at "${l.param}" on ${nodeLabel(t)}, which has no such parameter, so it does nothing${where}.`,
        fix: 'Delete the wire, or drag the control node\'s output onto a parameter that exists.',
        action: { type: 'removeLink', link: l, label: 'Delete the wire' },
      })
    }
  })

  return out
}

/** Sort for display: severity first, then by node. */
export function sortIssues(list) {
  return [...list].sort((a, b) => SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity] || (a.nodeId ?? 0) - (b.nodeId ?? 0) || a.key.localeCompare(b.key))
}

/** The number the toolbar badge shows: errors and warnings only. */
export const problemCount = (list) => list.filter((i) => i.severity !== 'info').length

/** Worst severity per node, for the badge on each node. */
export function worstByNode(list) {
  const m = new Map()
  for (const i of list) {
    if (i.nodeId == null) continue
    const cur = m.get(i.nodeId)
    if (!cur || SEVERITY_RANK[i.severity] > SEVERITY_RANK[cur]) m.set(i.nodeId, i.severity)
  }
  return m
}

/** A signature of a list, so callers can tell when it really changed. */
export const issueSignature = (list) => list.map((i) => `${i.key}|${i.severity}|${i.message}`).join('\n')

// --- problems only the running app can see ---------------------------------------------------------
const RUNTIME = {
  SKETCH_LOAD_FAILED: (d) => ({
    severity: 'error', title: 'A sketch has not loaded',
    message: `${d.label || 'An effect'} has not finished loading after ${Math.round((d.seconds ?? 25))} seconds. It is either still compiling a heavy shader or it failed to load, so it shows nothing.`,
    fix: 'Wait a little longer on a slow machine. If it never appears, check your connection, then click the dice on the node to reload it, or pick a different sketch.',
  }),
  SKETCH_ERROR: (d) => ({
    severity: 'error', title: 'A sketch hit an error',
    message: `${d.label || 'An effect'} reported an error${d.detail ? `: ${d.detail}` : ''}. It may be drawing nothing, or frozen.`,
    fix: 'Try the dice on the node (a new seed and parameters) or change a parameter. If it keeps failing, replace the node. Open the sketch on its own page to see the full error in the browser console.',
  }),
  CAMERA_DENIED: () => ({
    severity: 'error', title: 'The camera was blocked',
    message: 'The browser did not give this page access to the camera, so camera nodes are black.',
    fix: 'Click the camera or lock icon in the address bar, set Camera to Allow, then turn the camera on again from the toolbar. Another app may also be using it.',
  }),
  MIC_DENIED: () => ({
    severity: 'error', title: 'The microphone was blocked',
    message: 'The browser did not give this page access to the microphone, so nothing can react to sound.',
    fix: 'Click the microphone or lock icon in the address bar, set Microphone to Allow, then turn it on again from the toolbar.',
  }),
  VIDEO_PLAYBACK: (d) => ({
    severity: 'error', title: 'A clip will not play',
    message: `The browser could not play ${d.detail ? `"${d.detail}"` : 'this clip'}${d.label ? ` in ${d.label}` : ''}, so it is black.`,
    fix: 'Convert it to MP4 (H.264) or WebM and import it again with the Import wizard.',
  }),
  BAKE_FAILED: (d) => ({
    severity: 'warning', title: 'Could not bake a node',
    message: `Recording ${d.label || 'a node'} to a loop failed${d.detail ? `: ${d.detail}` : ''}. It keeps running live.`,
    fix: 'Nothing is broken. To try again, change nothing for a few seconds, or click the record icon on the node. You can switch automatic baking off with the film-roll button in the toolbar.',
  }),
  PRUNED_WIRES: (d) => ({
    severity: 'warning', title: 'Broken wires were removed',
    message: `${d.detail} wire${d.detail === 1 ? ' pointed' : 's pointed'} at nodes or ports that do not exist, so ${d.detail === 1 ? 'it was' : 'they were'} removed when the patch loaded.`,
    fix: 'Check the places where nodes are not connected and wire them again. This usually means the patch came from a different version, or a node was deleted.',
  }),
}
export const RUNTIME_CODES = Object.keys(RUNTIME)

/** An issue for something that went wrong at run time. d: { nodeId?, label?, detail?, deck? } */
export function runtimeIssue(code, d = {}) {
  const make = RUNTIME[code]
  if (!make) throw new Error('Unknown issue code ' + code)
  const base = make(d)
  const action = code === 'CAMERA_DENIED' ? { type: 'toggleCamera', label: 'Try the camera again' }
    : code === 'MIC_DENIED' ? { type: 'toggleMic', label: 'Try the microphone again' }
      : d.nodeId != null ? { type: 'focus', nodeId: d.nodeId, label: 'Show the node' } : null
  return issue({ code, nodeId: d.nodeId ?? null, deck: d.deck ?? 0, action, ...base, runtime: true })
}
