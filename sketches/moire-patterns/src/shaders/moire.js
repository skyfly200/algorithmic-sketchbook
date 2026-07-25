// Fullscreen-quad shaders for the moiré generator.
//
// Inspired by the classic `sin(length(uv) * frequency)` fragment shader:
// when the ring frequency approaches/exceeds the pixel Nyquist limit, the
// point-sampled sine aliases against the pixel grid and moiré appears.
// Layering several gratings with slightly different frequencies, rotations
// or centers produces the classic interference moiré as well. uAAMode
// exposes the mitigation techniques (screen-space derivative smoothing,
// supersampling), so aliasing moiré can be dialed up or down on demand.
//
// The fragment shader is a template: the user's custom pattern expression
// is injected into wave() and the material is rebuilt on change.

export const DEFAULT_CUSTOM_EXPR = 'sin(d * freq + 3.0 * sin(a * 5.0))'

// Custom shapes are signed-distance expressions: negative inside the shape.
export const DEFAULT_SHAPE_EXPR = 'd - r * (0.7 + 0.3 * cos(a * 5.0))'

export const MAX_LAYERS = 8

export const vertexShader = /* glsl */ `
void main() {
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`

export function makeFragmentShader(
  customExpr = DEFAULT_CUSTOM_EXPR,
  customShapeExpr = DEFAULT_SHAPE_EXPR,
) {
  return /* glsl */ `
precision highp float;

const int MAX_LAYERS = ${MAX_LAYERS};
const float PI = 3.141592653589793;

uniform vec2  uResolution;
uniform float uAnimTime;    // seconds accumulated only while playing
uniform float uZoom;
uniform int   uLayerCount;  // 1..MAX_LAYERS
uniform int   uAAMode;      // 0 off (aliased), 1 fwidth smooth, 2 ssaa 2x2, 3 ssaa 4x4
uniform int   uColorMode;   // 0 duotone, 1 gradient, 2 rainbow, 3 per-layer
uniform float uThickness;   // stripe duty threshold in [0,1]
uniform vec3  uColorA;      // background
uniform vec3  uColorB;      // foreground
uniform vec3  uColorC;      // gradient end stop
uniform vec3  uLayerColor[MAX_LAYERS];
uniform float uLayerAlpha[MAX_LAYERS];
uniform vec2  uOffset[MAX_LAYERS];
uniform float uFreq[MAX_LAYERS];
uniform float uRot[MAX_LAYERS];
// 0 rings, 1 lines, 2 grid, 3 spokes, 4 spiral, 5 checker, 6 hex,
// 7 waves, 8 dots, 9 custom expression; shapes (SDF fills): 10 circle,
// 11 square, 12 triangle, 13 star, 14 hexagon, 15 custom SDF expression
uniform int   uPattern[MAX_LAYERS];
// 0 multiply, 1 difference, 2 average, 3 min, 4 max, 5 screen, 6 add,
// 7 subtract, 8 mask (blends layers below against layers above)
uniform int   uOp[MAX_LAYERS];

vec2 toPlane(vec2 fragCoord) {
  vec2 uv = fragCoord / uResolution * 2.0 - 1.0;
  uv.x *= uResolution.x / uResolution.y;
  return uv * uZoom;
}

float sdBox(vec2 p, float r) {
  vec2 q = abs(p) - vec2(r);
  return length(max(q, vec2(0.0))) + min(max(q.x, q.y), 0.0);
}

float sdTriangle(vec2 p, float r) {
  const float k = 1.7320508;
  vec2 q = vec2(abs(p.x) - r, p.y + r / k);
  if (q.x + k * q.y > 0.0) q = vec2(q.x - k * q.y, -k * q.x - q.y) / 2.0;
  q.x -= clamp(q.x, -2.0 * r, 0.0);
  return -length(q) * sign(q.y);
}

float sdStar5(vec2 p, float r) {
  const vec2 k1 = vec2(0.809016994, -0.587785252);
  const vec2 k2 = vec2(-k1.x, k1.y);
  const float rf = 0.45;
  p.x = abs(p.x);
  p -= 2.0 * max(dot(k1, p), 0.0) * k1;
  p -= 2.0 * max(dot(k2, p), 0.0) * k2;
  p.x = abs(p.x);
  p.y -= r;
  vec2 ba = rf * vec2(-k1.y, k1.x) - vec2(0.0, 1.0);
  float h = clamp(dot(p, ba) / dot(ba, ba), 0.0, r);
  return length(p - ba * h) * sign(p.y * ba.x - p.x * ba.y);
}

float sdHexagon(vec2 p, float r) {
  const vec3 k = vec3(-0.866025404, 0.5, 0.577350269);
  vec2 q = abs(p);
  q -= 2.0 * min(dot(k.xy, q), 0.0) * k.xy;
  q -= vec2(clamp(q.x, -k.z * r, k.z * r), r);
  return length(q) * sign(q.y);
}

float wave(vec2 p, float freq, int type) {
  if (type >= 10) {
    // Shape fills: frequency controls size (higher frequency = smaller).
    float r = 60.0 / max(freq, 1.0);
    float sd;
    if      (type == 10) sd = length(p) - r;
    else if (type == 11) sd = sdBox(p, r);
    else if (type == 12) sd = sdTriangle(p, r);
    else if (type == 13) sd = sdStar5(p, r);
    else if (type == 14) sd = sdHexagon(p, r);
    else {
      // Custom SDF. Available: p (vec2), r (radius), freq, d, a, t
      float d = length(p);
      float a = atan(p.y, p.x);
      float t = uAnimTime;
      sd = float(${customShapeExpr});
    }
    return clamp(-sd * 8.0, -1.0, 1.0);
  }
  if (type == 0) return sin(length(p) * freq);
  if (type == 1) return sin(p.x * freq);
  if (type == 2) return max(sin(p.x * freq), sin(p.y * freq));
  if (type == 3) {
    float spokes = max(floor(freq * 0.25), 1.0);
    return sin(atan(p.y, p.x) * spokes);
  }
  if (type == 4) return sin(length(p) * freq + atan(p.y, p.x) * 3.0);
  if (type == 5) return sin(p.x * freq) * sin(p.y * freq);
  if (type == 6) {
    return clamp((cos(p.x * freq)
                + cos((0.5 * p.x + 0.866 * p.y) * freq)
                + cos((0.5 * p.x - 0.866 * p.y) * freq)) / 1.5, -1.0, 1.0);
  }
  if (type == 7) return sin(p.x * freq + 4.0 * sin(p.y * freq * 0.15));
  if (type == 8) return (cos(p.x * freq) + cos(p.y * freq)) * 0.5;
  // Custom user expression. Available: p (vec2), freq, d (radius), a (angle), t (time)
  float d = length(p);
  float a = atan(p.y, p.x);
  float t = uAnimTime;
  return clamp(float(${customExpr}), -1.0, 1.0);
}

float layerValue(vec2 p, int i) {
  float dir = mod(float(i), 2.0) < 0.5 ? 1.0 : -1.0;
  float phase = float(i) * 2.4;
  float t = uAnimTime * dir;

  // Slow orbit of the layer center (zero displacement at t = 0 so enabling
  // animation never snaps the pattern) plus a slow counter-rotation.
  vec2 off = uOffset[i]
    + 0.06 * (vec2(cos(t * 0.7 + phase), sin(t * 0.7 + phase))
            - vec2(cos(phase), sin(phase)));
  float rot = uRot[i] + t * 0.15;

  float c = cos(rot);
  float s = sin(rot);
  vec2 q = mat2(c, -s, s, c) * (p - off);

  float v = 0.5 + 0.5 * wave(q, uFreq[i], uPattern[i]);
  if (uAAMode == 1) {
    float w = fwidth(v) + 1e-4;
    return smoothstep(uThickness - w, uThickness + w, v);
  }
  return step(uThickness, v);
}

float applyOp(float acc, float c, int op) {
  if (op == 0) return acc * c;
  if (op == 1) return abs(acc - c);
  if (op == 2) return (acc + c) * 0.5;
  if (op == 3) return min(acc, c);
  if (op == 4) return max(acc, c);
  if (op == 5) return acc + c - acc * c;
  if (op == 6) return min(acc + c, 1.0);
  return clamp(acc - c, 0.0, 1.0);
}

// Layers combine bottom-up. A layer whose op is "mask" closes the group
// of layers accumulated so far and blends it against the group that
// follows, using the mask layer's own pattern (or shape) as the blend
// factor. Several masks chain: [A, mask1, B, mask2, C] gives
// mix(mix(A, B, m1), C, m2).
float composite(vec2 p) {
  float result = 0.0;
  float acc = 0.0;
  float pendingMask = -1.0;
  bool started = false;
  for (int i = 0; i < MAX_LAYERS; i++) {
    if (i >= uLayerCount) break;
    float c = layerValue(p, i) * uLayerAlpha[i];
    if (uOp[i] == 8 && i > 0) {
      float group = started ? acc : 0.0;
      result = pendingMask >= 0.0 ? mix(result, group, pendingMask) : group;
      pendingMask = c;
      started = false;
      continue;
    }
    if (!started) {
      acc = c;
      started = true;
    } else {
      acc = applyOp(acc, c, uOp[i]);
    }
  }
  if (pendingMask >= 0.0) {
    // A trailing mask with no layers above it clips the result instead.
    return started ? mix(result, acc, pendingMask) : result * pendingMask;
  }
  return started ? acc : result;
}

vec3 hsv2rgb(vec3 c) {
  vec3 p = abs(fract(c.xxx + vec3(0.0, 2.0 / 3.0, 1.0 / 3.0)) * 6.0 - 3.0);
  return c.z * mix(vec3(1.0), clamp(p - 1.0, 0.0, 1.0), c.y);
}

vec3 shade(vec2 fragCoord) {
  vec2 p = toPlane(fragCoord);

  if (uColorMode == 3) {
    // Per-layer colors: screen-composite each tinted grating over the background.
    vec3 col = uColorA;
    for (int i = 0; i < MAX_LAYERS; i++) {
      if (i >= uLayerCount) break;
      vec3 tinted = uLayerColor[i] * (layerValue(p, i) * uLayerAlpha[i]);
      col = col + tinted - col * tinted;
    }
    return col;
  }

  float v = composite(p);
  if (uColorMode == 1) {
    return v < 0.5 ? mix(uColorA, uColorB, v * 2.0)
                   : mix(uColorB, uColorC, v * 2.0 - 1.0);
  }
  if (uColorMode == 2) {
    // Hue from the composite value, drifting slowly while animated.
    // Richest with the Average blend, where v is multi-level.
    return mix(uColorA, hsv2rgb(vec3(fract(v * 0.833 + uAnimTime * 0.03), 0.8, 0.95)), v);
  }
  return mix(uColorA, uColorB, v);
}

void main() {
  vec3 col = vec3(0.0);
  if (uAAMode == 2) {
    for (int x = 0; x < 2; x++)
      for (int y = 0; y < 2; y++)
        col += shade(gl_FragCoord.xy + (vec2(float(x), float(y)) - 0.5) * 0.5);
    col *= 0.25;
  } else if (uAAMode == 3) {
    for (int x = 0; x < 4; x++)
      for (int y = 0; y < 4; y++)
        col += shade(gl_FragCoord.xy + (vec2(float(x), float(y)) - 1.5) * 0.25);
    col *= 0.0625;
  } else {
    col = shade(gl_FragCoord.xy);
  }
  gl_FragColor = vec4(col, 1.0);
}
`
}
