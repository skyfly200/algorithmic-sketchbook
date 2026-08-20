// Static lookup tables for the Patch compositor — node definitions, the
// control-mappable parameter ranges, blend-mode lists, the geometry/geodata
// option sets and a few presets. Lifted out of PatchView so the node catalogue
// is edited in one obvious place instead of buried in a 5k-line component.
// Everything here is plain data (no reactive state, no component functions).

// Compositor pipe resolutions. 'Native' is resolved to device pixels at apply
// time (see resolveRes in PatchView), capped so huge displays don't melt the GPU.
export const RESOLUTIONS = [
  { label: '384 × 216', w: 384, h: 216 },
  { label: '640 × 360', w: 640, h: 360 },
  { label: '960 × 540', w: 960, h: 540 },
  { label: '1280 × 720', w: 1280, h: 720 },
  { label: '1920 × 1080', w: 1920, h: 1080 },
  { label: 'Native', native: true },
]

// The node catalogue: title, input-port count, accent colour and icon per type.
export const TYPES = {
  effect: { title: 'Effect', ins: 0, color: '#7c8cff', icon: 'mdi-creation' },
  filter: { title: 'Filter', ins: 1, color: '#c98cff', icon: 'mdi-image-filter-vintage' },
  media: { title: 'Media', ins: 0, color: '#4dd0c4', icon: 'mdi-image-multiple' }, // camera / files / clips
  // Live map / satellite imagery for a place — a 2D image source you can pipe,
  // filter and composite. Public tiles by default; a key upgrades the provider.
  geodata: { title: 'Geodata', ins: 0, color: '#5bd6a8', icon: 'mdi-earth' },
  text: { title: 'Text', ins: 0, color: '#ff9ec4', icon: 'mdi-format-text' },
  // A loaded image (or sprite-sheet) positioned in the frame, animated over time
  // by a motion preset and/or control-mapped x/y/scale/rotate/opacity.
  sprite: { title: 'Sprite', ins: 0, color: '#7fe3a1', icon: 'mdi-image-move' },
  portal: { title: 'Portal', ins: 1, color: '#8ad0ff', icon: 'mdi-shape-outline' }, // remap a region elsewhere
  mask: { title: 'Mask', ins: 2, color: '#f2ad00', icon: 'mdi-vector-intersection' },
  polygon: { title: 'Polygon', ins: 0, color: '#f2ad00', icon: 'mdi-vector-polygon' }, // a matte-shape source: white editable polygon → wire into a Mask
  blend: { title: 'Blend', ins: 2, color: '#a0e060', icon: 'mdi-circle-half-full' },
  // Geometry space: a mesh source (its displacement stands in for a vertex
  // shader) and a virtual Camera that rasterizes connected geometry down to a
  // pixel frame the rest of the graph can composite.
  geo: { title: 'Geometry', ins: 0, color: '#6ee7b7', icon: 'mdi-cube-outline' },
  vcam: { title: 'Camera', ins: 3, color: '#ffd166', icon: 'mdi-camera-control' },
  output: { title: 'Output', ins: 1, color: '#ffffff', icon: 'mdi-monitor' },
  // Control emitters (0..1 values, not video): their output jacks wire into the
  // parameter jacks of other nodes to modulate them live.
  input: { title: 'Input', ins: 0, color: '#e0a060', icon: 'mdi-sine-wave' },
  xy: { title: 'XY Pad', ins: 0, color: '#e0a060', icon: 'mdi-gesture-tap' },
  tracker: { title: 'Tracker', ins: 1, color: '#e0a060', icon: 'mdi-target' },
}
// Extra output-port labels (xy: x,y · tracker: x,y,size).
export const OUT_LABELS = { xy: ['x', 'y'], tracker: ['x', 'y', 'size'] }

// Numeric params a control wire can drive on the non-effect operator nodes
// (effect params come from the sketch's own schema over postMessage).
export const PARAM_RANGES = {
  blend: { mix: [0, 1] },
  // Text's numeric font/layout controls are all control-mappable (drag an
  // Input/XY/Tracker output onto their ▣ jacks to animate the type).
  text: { size: [0.03, 0.6], weight: [100, 900], tracking: [-0.1, 0.5], x: [0, 1], y: [0, 1], hue: [0, 360], rotate: [-180, 180] },
  // Portal: a source region is remapped (copied/scaled) into a destination
  // region — all eight edges control-mappable so the portal can roam.
  portal: { srcX: [0, 1], srcY: [0, 1], srcW: [0.05, 1], srcH: [0.05, 1], dstX: [0, 1], dstY: [0, 1], dstW: [0.05, 1], dstH: [0.05, 1] },
  // Polygon: only the edge softness is a scalar worth modulating; the
  // vertices are edited by dragging on the output.
  polygon: { feather: [0, 0.5] },
  // Sprite: position, size, rotation and opacity are all control-mappable, so a
  // sprite can be flown around and keyframed through space over time.
  sprite: { x: [0, 1], y: [0, 1], scale: [0.02, 2], rotate: [-180, 180], opacity: [0, 1] },
}

export const SPRITE_MOTIONS = ['None', 'Drift', 'Orbit', 'Bounce', 'Float', 'Spin']
export const TEXT_TRANSITIONS = ['None', 'Fade', 'Slide L', 'Slide R', 'Rise', 'Drop', 'Zoom', 'Typewriter']
// Fallback font list (generic families + common web-safe faces) used until the
// user loads their real installed fonts via the Local Font Access API.
export const TEXT_FONTS = [
  'system-ui', 'sans-serif', 'serif', 'monospace', 'cursive', 'fantasy',
  'Georgia', 'Times New Roman', 'Courier New', 'Arial', 'Arial Black', 'Impact',
  'Trebuchet MS', 'Verdana', 'Tahoma', 'Palatino Linotype', 'Garamond', 'Comic Sans MS', 'Brush Script MT',
]

// Canvas globalCompositeOperation values offered on the Blend node; MIX_BLENDS
// drops 'normal' for the places where a straight copy isn't a useful mix.
export const BLENDS = [
  'normal', 'screen', 'add', 'lighten', 'darken', 'multiply', 'overlay', 'soft-light',
  'hard-light', 'color-dodge', 'color-burn', 'difference', 'exclusion',
  'hue', 'saturation', 'color', 'luminosity',
]
export const MIX_BLENDS = BLENDS.filter((m) => m !== 'normal')
// Aspect-ratio presets for lock-proportions.
export const ASPECTS = { '1:1': 1, '4:3': 4 / 3, '3:2': 3 / 2, '16:9': 16 / 9, '2:1': 2, '9:16': 9 / 16, '3:4': 3 / 4 }
// Response shapes for an Input node's control curve.
export const INPUT_CURVES = ['linear', 'exp', 'log', 's-curve', 'step']

// Geometry node option sets.
export const GEO_SHAPES = ['Cube', 'Sphere', 'Torus', 'Icosahedron', 'Torus knot', 'Cone', 'Cylinder', 'Plane', 'Gaudí column']
export const GEO_MATERIALS = ['Solid', 'Wireframe', 'Points', 'Normals']
export const GEO_SOURCES = ['Shape', 'Point cloud', 'Voxel', 'Terrain']
export const GEO_CLOUDS = ['Galaxy', 'Sphere', 'Torus', 'Terrain', 'Cube', 'Imported']
export const GEO_VOXELS = ['Sphere', 'Terrain', 'Gyroid', 'Shell']

// Geodata node: map layer styles + a few place jump-tos.
export const GEO_LAYERS = ['Streets', 'Satellite', 'Topographic', 'Dark']
export const GEO_PLACES = { grand: { lat: 36.06, lon: -112.14, zoom: 12 }, alps: { lat: 45.98, lon: 7.66, zoom: 12 }, tokyo: { lat: 35.68, lon: 139.76, zoom: 13 } }

// Prompt-chip examples shown in the natural-language designer.
export const NL_EXAMPLES = [
  'dreamy underwater scene, slow and deep blue',
  'glitchy retro camera, punchy and fast',
  'liquid metal over noise, intense, react to the beat',
  'the text "BRIGHT WAVES" masked through a psychedelic swirl',
]
