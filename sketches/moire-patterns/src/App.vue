<script setup>
import { ref, onMounted, onBeforeUnmount } from 'vue'
import MoireCanvas from './components/MoireCanvas.vue'
import ControlPanel from './components/ControlPanel.vue'
import ShareDrawer from './components/ShareDrawer.vue'
import TimelineBar from './components/TimelineBar.vue'
import { settings, loadFromHash, randomize, undoRandomize, redoRandomize } from './settings.js'
import { saveToGallery } from './gallery.js'
import { modes, saveMode, loadMode } from './modes.js'
import { jumpToKey } from './timeline.js'
import { slideshow, startSlideshow, stopSlideshow } from './slideshow.js'

const canvasRef = ref(null)
const panelVisible = ref(true)

// Mobile only: which slide-over panel is open ('', 'controls', 'share') and
// whether the timeline sheet is up. Ignored on desktop, where both panels
// and the timeline are always docked.
const mobilePanel = ref('')
const mobileTimeline = ref(false)
function toggleMobile(which) {
  mobileTimeline.value = false
  mobilePanel.value = mobilePanel.value === which ? '' : which
}
function toggleMobileTimeline() {
  mobilePanel.value = ''
  mobileTimeline.value = !mobileTimeline.value
}

const WARN_KEY = 'moire-epilepsy-ack'
const showWarning = ref(!localStorage.getItem(WARN_KEY))

function acknowledgeWarning() {
  try {
    localStorage.setItem(WARN_KEY, '1')
  } catch {
    // Private browsing — the warning will just show again next visit.
  }
  showWarning.value = false
}

function saveCurrent() {
  const thumb = canvasRef.value?.captureThumb()
  if (thumb) saveToGallery(thumb)
}

function saveCurrentMode() {
  const name = window.prompt('Name this mode:', 'Mode ' + (modes.length + 1))
  if (name === null) return
  saveMode(name, canvasRef.value?.captureThumb())
}

function toggleSlideshow() {
  if (slideshow.active) {
    stopSlideshow()
    panelVisible.value = true
  } else {
    startSlideshow()
    panelVisible.value = false
  }
}

function toggleFullscreen() {
  if (document.fullscreenElement) document.exitFullscreen()
  else document.documentElement.requestFullscreen()
}

function onKey(e) {
  if (showWarning.value) return
  if (e.target.closest('input, select, textarea')) return
  const key = e.key.toLowerCase()
  if (key === 'h') panelVisible.value = !panelVisible.value
  else if (key === 'f') toggleFullscreen()
  else if (key === 's') toggleSlideshow()
  else if (key === 'escape') {
    if (slideshow.active) toggleSlideshow()
  }
  else if (key === 'r') randomize()
  else if (key === 'z') e.shiftKey ? redoRandomize() : undoRandomize()
  else if (key === 'g') saveCurrent()
  else if (key === 'm') saveCurrentMode()
  else if (key >= '1' && key <= '9') {
    const mode = modes[+key - 1]
    if (mode) loadMode(mode)
  }
  else if (key === ' ' || key === 'a') {
    // Space on a focused button should click the button, not toggle playback.
    if (key === ' ' && e.target.closest('button')) return
    e.preventDefault()
    settings.animate = !settings.animate
  } else if (key === ',') jumpToKey(-1)
  else if (key === '.') jumpToKey(1)
  else if (key === 'arrowup' || key === 'arrowdown') {
    e.preventDefault()
    const delta = key === 'arrowup' ? 0.1 : -0.1
    settings.animSpeed = +Math.min(4, Math.max(0.1, settings.animSpeed + delta)).toFixed(1)
  }
}

onMounted(() => {
  loadFromHash()
  // Always start paused, even when a share link was saved mid-animation.
  settings.animate = false
  window.addEventListener('keydown', onKey)
})
onBeforeUnmount(() => window.removeEventListener('keydown', onKey))
</script>

<template>
  <div class="app" :class="[{ clean: !panelVisible }, mobilePanel ? 'm-open m-' + mobilePanel : '', mobileTimeline ? 'm-timeline' : '']">
    <div class="main">
      <ControlPanel
        v-show="panelVisible"
        @slideshow="toggleSlideshow"
      />
      <MoireCanvas ref="canvasRef" />
      <ShareDrawer
        v-show="panelVisible"
        @export="canvasRef?.exportPNG()"
        @record="canvasRef?.toggleRecording()"
        @save="saveCurrent"
        @savemode="saveCurrentMode"
      />
    </div>
    <TimelineBar v-show="panelVisible" />
    <div class="view-buttons">
      <button @click="panelVisible = !panelVisible">
        {{ panelVisible ? 'Hide UI' : 'Show UI' }}
      </button>
      <button @click="toggleFullscreen">Fullscreen</button>
    </div>
    <button v-if="slideshow.active" class="slideshow-badge" @click="toggleSlideshow">
      ■ stop display (Esc)
    </button>

    <!-- Mobile-only: backdrop + bottom toolbar (hidden on desktop via CSS) -->
    <div v-show="mobilePanel" class="mobile-backdrop" @click="mobilePanel = ''" />
    <nav class="mobile-bar">
      <button :class="{ active: mobilePanel === 'controls' }" @click="toggleMobile('controls')">
        ☰<small>Controls</small>
      </button>
      <button @click="randomize()">🎲<small>Random</small></button>
      <button @click="settings.animate = !settings.animate">
        {{ settings.animate ? '❚❚' : '▶' }}<small>{{ settings.animate ? 'Pause' : 'Play' }}</small>
      </button>
      <button :class="{ active: mobileTimeline }" @click="toggleMobileTimeline">
        ◆<small>Timeline</small>
      </button>
      <button :class="{ active: mobilePanel === 'share' }" @click="toggleMobile('share')">
        ⤴<small>Share</small>
      </button>
      <button @click="toggleFullscreen">⛶<small>Full</small></button>
    </nav>
    <div v-if="showWarning" class="warn-backdrop">
      <div class="warn-dialog" role="alertdialog" aria-labelledby="warn-title">
        <h2 id="warn-title">⚠️ Seizure warning — photosensitive epilepsy</h2>
        <p>
          This tool produces high-contrast interference patterns that can
          <strong>flash, strobe, and shift rapidly</strong>. Content like
          this <strong>can trigger seizures</strong> in people with
          photosensitive epilepsy — including people who have
          <strong>never had a seizure before</strong>.
        </p>
        <p>
          <strong>Animation is paused by default and we advise against
          enabling it</strong> if you or anyone watching has epilepsy, a
          history of seizures, or is unsure of their sensitivity. The
          animated and slideshow modes substantially increase the risk.
        </p>
        <p>
          Stop using this tool immediately and seek medical advice if you
          experience dizziness, altered vision, eye or muscle twitching,
          disorientation, or any involuntary movement.
        </p>
        <button class="warn-ok" @click="acknowledgeWarning">
          I understand the risk
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.app {
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100%;
}
.main {
  display: flex;
  flex: 1;
  min-height: 0;
}
.view-buttons {
  position: fixed;
  top: 10px;
  right: 12px;
  display: flex;
  gap: 6px;
  transition: opacity 0.25s;
}

/* Clean display mode: with the UI hidden, the remaining overlays are
   invisible until hovered. */
.app.clean .view-buttons {
  opacity: 0;
  padding: 10px 12px;
  margin: -10px -12px;
}
.app.clean .view-buttons:hover,
.app.clean .view-buttons:focus-within {
  opacity: 1;
}
.app.clean :deep(.hint) {
  opacity: 0;
  pointer-events: auto;
  transition: opacity 0.25s;
}
.app.clean :deep(.hint:hover) {
  opacity: 1;
}
/* Invisible until hovered so the display view shows only the art;
   the enlarged padding/margin keeps a findable hit area in the corner. */
.slideshow-badge {
  position: fixed;
  bottom: 12px;
  right: 12px;
  z-index: 50;
  padding: 5px 12px;
  font-size: 11.5px;
  color: #c9c9d1;
  background: rgba(12, 12, 16, 0.65);
  border: 1px solid #26262e;
  border-radius: 999px;
  cursor: pointer;
  backdrop-filter: blur(4px);
  opacity: 0;
  transition: opacity 0.25s;
}
.slideshow-badge::before {
  content: '';
  position: absolute;
  inset: -14px -16px;
}
.slideshow-badge:hover,
.slideshow-badge:focus-visible {
  opacity: 1;
}
.warn-backdrop {
  position: fixed;
  inset: 0;
  z-index: 100;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  background: rgba(5, 5, 8, 0.82);
  backdrop-filter: blur(6px);
}
.warn-dialog {
  max-width: 460px;
  padding: 26px 28px;
  background: #14141a;
  border: 1px solid #35314f;
  border-radius: 12px;
  box-shadow: 0 12px 48px rgba(0, 0, 0, 0.6);
}
.warn-dialog h2 {
  font-size: 16px;
  font-weight: 650;
  color: #ffd166;
  margin-bottom: 12px;
}
.warn-dialog p {
  font-size: 13px;
  line-height: 1.6;
  color: #c9c9d1;
  margin-bottom: 12px;
}
.warn-dialog strong {
  color: #e4e4e9;
}
.warn-ok {
  width: 100%;
  margin-top: 4px;
  padding: 10px;
  font-size: 13px;
  font-weight: 600;
  color: #e9e6ff;
  background: #342e6e;
  border: 1px solid #4c42a3;
  border-radius: 8px;
  cursor: pointer;
}
.warn-ok:hover {
  background: #3e3784;
}
.view-buttons button {
  padding: 5px 12px;
  font-size: 11.5px;
  color: #c9c9d1;
  background: rgba(12, 12, 16, 0.65);
  border: 1px solid #26262e;
  border-radius: 999px;
  cursor: pointer;
  backdrop-filter: blur(4px);
  transition: background 0.12s, border-color 0.12s;
}
.view-buttons button:hover {
  background: rgba(35, 35, 44, 0.85);
  border-color: #3a3a48;
}

/* The mobile toolbar and backdrop exist in the DOM at all sizes but only
   show on small screens (below). Desktop layout is entirely unchanged. */
.mobile-bar,
.mobile-backdrop {
  display: none;
}

/* ---- Mobile layout (phones / narrow screens) ------------------------ */
@media (max-width: 768px) {
  /* Canvas fills the screen; the two side panels become slide-over sheets. */
  .main {
    display: block;
    position: relative;
  }
  .main :deep(.canvas-wrap) {
    position: absolute;
    inset: 0;
  }
  /* The keyboard-shortcut hint is meaningless on touch. */
  .main :deep(.hint) {
    display: none;
  }

  .panel,
  .drawer {
    position: fixed;
    top: 0;
    bottom: 0;
    z-index: 60;
    width: 88%;
    max-width: 380px;
    transition: transform 0.28s ease;
    box-shadow: 0 0 40px rgba(0, 0, 0, 0.6);
    /* Clear the bottom toolbar and any device safe-area inset. */
    padding-bottom: calc(76px + env(safe-area-inset-bottom, 0px));
    /* Closed panels never intercept canvas touches, even mid-slide. */
    pointer-events: none;
  }
  .panel {
    left: 0;
    transform: translateX(-100%);
  }
  .drawer {
    right: 0;
    transform: translateX(100%);
  }
  .app.m-controls .panel {
    transform: none;
    pointer-events: auto;
  }
  .app.m-share .drawer {
    transform: none;
    pointer-events: auto;
  }

  /* The desktop hide/fullscreen pills are desktop-only. The timeline bar is
     hidden by default and revealed as a bottom sheet on demand. */
  .view-buttons {
    display: none;
  }
  .tbar {
    display: none;
  }
  .app.m-timeline .tbar {
    display: block;
    position: fixed;
    left: 0;
    right: 0;
    bottom: calc(70px + env(safe-area-inset-bottom, 0px));
    z-index: 58;
    max-height: 52vh;
    border-top: 1px solid #212129;
    box-shadow: 0 -10px 30px rgba(0, 0, 0, 0.55);
  }
  /* Let the timeline toolbar wrap at narrow widths instead of overflowing. */
  .app.m-timeline .tbar :deep(.toolbar) {
    flex-wrap: wrap;
    row-gap: 6px;
  }

  .mobile-backdrop {
    display: block;
    position: fixed;
    inset: 0;
    z-index: 55;
    background: rgba(5, 5, 8, 0.5);
  }

  .mobile-bar {
    display: flex;
    position: fixed;
    left: 0;
    right: 0;
    bottom: 0;
    z-index: 70;
    padding-bottom: env(safe-area-inset-bottom, 0px);
    background: rgba(16, 16, 20, 0.96);
    border-top: 1px solid #212129;
    backdrop-filter: blur(8px);
  }
  .mobile-bar button {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 2px;
    padding: 9px 2px;
    font-size: 17px;
    color: #c9c9d1;
    background: none;
    border: none;
    border-radius: 0;
    cursor: pointer;
  }
  .mobile-bar button small {
    font-size: 9.5px;
    color: #85858f;
    letter-spacing: 0.02em;
  }
  .mobile-bar button.active {
    color: #cfc8ff;
  }
  .mobile-bar button.active small {
    color: #8f86d8;
  }

  /* The display-view stop badge sits above the toolbar. */
  .slideshow-badge {
    bottom: calc(70px + env(safe-area-inset-bottom, 0px));
  }
}
</style>
