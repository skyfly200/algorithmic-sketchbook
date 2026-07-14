/**
 * Bright Waves Logo — the site's animated SVG mark, promoted to a full sketch so
 * it can be dropped in as a layer in the Mixer or a node in Patch (both pull
 * their options from the sketch registry). Transparent by default, so it
 * composites as a branding / watermark overlay over live visuals; a param adds
 * a solid backdrop when you want it standalone. Scale, spin, and a beat pulse
 * are runtime params, so it reacts to music like every other sketch.
 */
import { createRuntime } from '../_lib/runtime.js'

const rt = createRuntime()
const params = rt.params({
  scale: { value: 0.7, min: 0.15, max: 1.4, step: 0.01, label: 'Logo size' },
  opacity: { value: 1, min: 0, max: 1, step: 0.01, label: 'Opacity' },
  spin: { value: 0, min: -60, max: 60, step: 1, label: 'Spin (°/s)' },
  pulse: { value: 0.14, min: 0, max: 0.6, step: 0.01, label: 'Beat pulse' },
  art: { value: true, type: 'bool', label: 'Tiled art disc' },
  backdrop: { value: false, type: 'bool', label: 'Solid backdrop' },
})
// Beats breathe the mark by default — remix in the controls panel.
rt.mapInput('audio.pulse', 'pulse', 0.25)

const uid = 'bw'
const stage = document.getElementById('stage')
const bg = document.getElementById('bg')

// The user's animated logo art (SMIL runs itself); IDs suffixed like the Vue
// component so it stays self-contained.
stage.innerHTML = `
<svg viewBox="0 0 2400 2400" role="img" aria-label="Bright Waves logo">
  <mask id="clip-${uid}"><circle fill="white" cx="600" cy="600" r="220" /></mask>
  <symbol id="logo-${uid}" x="-600" y="-600" width="1000" height="1000" mask="url(#clip-${uid})">
    <g transform="translate(500 500)">
      <polygon points="0 0,0 200,50 150,0 100,50 50,0 0" fill="purple" stroke="purple">
        <animateTransform attributeName="transform" type="translate" calcMode="spline"
          keySplines="0.5 1 0.5 1;0.5 1 0.5 1;.5 0 1 .5"
          values="500 -500;0 0;0 0;-500 500" keyTimes="0;0.20;0.8;1" additive="sum" dur="4s" repeatCount="indefinite" />
      </polygon>
      <polygon points="200 0,200 200,150 150,200 100,150 50,200 0" fill="orange" stroke="orange">
        <animateTransform attributeName="transform" type="translate" calcMode="spline"
          keySplines="0.5 0 0.5 1;0.5 1 0.5 1;0.5 1 0.5 1;.5 0 1 .5"
          values="-500 500;-500 500;0 0;0 0;500 -500" keyTimes="0;0.15;0.35;0.8;1" additive="sum" dur="4s" repeatCount="indefinite" />
      </polygon>
      <polyline points="0 100,50 150,100 100,150 150,200 100" fill="none" stroke="green">
        <animateTransform attributeName="transform" type="translate" calcMode="spline"
          keySplines="0.5 0 0.5 1;0.5 1 0.5 1;0.5 1 0.5 1;.5 0 1 .5"
          values="500 500;500 500;0 0;0 0;-500 -500" keyTimes="0;0.05;0.25;0.8;1" additive="sum" dur="4s" repeatCount="indefinite" />
      </polyline>
      <polyline points="0 100,50 50,100 100,150 50,200 100" fill="none" stroke="blue">
        <animateTransform attributeName="transform" type="translate" calcMode="spline"
          keySplines="0.5 0 0.5 1;0.5 1 0.5 1;0.5 1 0.5 1;.5 0 1 .5"
          values="-500 -500;-500 -500;0 0;0 0;500 500" keyTimes="0;0.2;0.4;0.8;1" additive="sum" dur="4s" repeatCount="indefinite" />
      </polyline>
    </g>
  </symbol>
  <defs>
    <pattern id="pattern-${uid}" x="0" y="0" width="0.05" height="0.05">
      <polygon points="0 0,0 200,50 150,0 100,50 50,0 0" fill="purple" stroke="purple" />
      <polygon points="200 0,200 200,150 150,200 100,150 50,200 0" fill="orange" stroke="orange" />
      <polygon points="100 0,100 200,150 150,100 100,150 50,100 0" fill="purple" stroke="purple" />
      <polygon points="100 0,100 200,50 150,100 100,50 50,100 0" fill="orange" stroke="orange" />
      <polyline points="0 100,50 150,100 100,150 150,200 100" fill="none" stroke="green" />
      <polyline points="0 100,50 50,100 100,150 50,200 100" fill="none" stroke="blue" />
      <polyline points="0 0,50 50,100 0,150 50,200 0" fill="none" stroke="green" />
      <polyline points="0 200,50 150,100 200,150 150,200 200" fill="none" stroke="blue" />
    </pattern>
  </defs>
  <g id="tform" style="stroke-width: 10">
    <circle id="art-${uid}" fill="url(#pattern-${uid})" cx="1200" cy="1200" r="2000" />
    <use href="#logo-${uid}" transform="translate(1200 1200) scale(8 8)" />
  </g>
</svg>`

const tform = document.getElementById('tform')
const artDisc = document.getElementById(`art-${uid}`)

function frame(now) {
  rt.tick(now)
  bg.style.opacity = params.backdrop ? 1 : 0
  stage.style.opacity = params.opacity
  artDisc.style.display = params.art ? '' : 'none'

  const s = params.scale * (1 + rt.beat.state.pulse * params.pulse)
  const deg = (now * 0.001 * params.spin) % 360
  // Rotate + scale about the art's centre (1200,1200).
  tform.setAttribute(
    'transform',
    `translate(1200 1200) rotate(${deg.toFixed(3)}) scale(${s.toFixed(4)}) translate(-1200 -1200)`,
  )
  requestAnimationFrame(frame)
}
requestAnimationFrame(frame)
