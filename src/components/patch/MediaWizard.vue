<script setup>
/**
 * MediaWizard — the "Import content" dialog for the Patch editor. Purely
 * presentational: it renders the source-picker grid and emits one event per
 * choice; the host owns the graph-mutating handlers (add a Media/Geometry node,
 * open a file picker, capture the screen, …). Controlled via v-model.
 */
defineProps({
  modelValue: { type: Boolean, default: false },
  hasGoogle: { type: Boolean, default: false }, // is Google Photos configured?
})
const emit = defineEmits([
  'update:modelValue', 'upload', 'url', 'screen-live', 'screen-grab',
  'google', 'point-cloud', 'geodata', 'terrain', 'open-settings',
])
</script>

<template>
  <div v-if="modelValue" class="wiz-backdrop" @pointerdown.self="emit('update:modelValue', false)">
    <div class="wiz" @pointerdown.stop>
      <div class="wiz-head">
        <v-icon icon="mdi-tray-arrow-down" size="18" class="mr-2" />
        <span class="wiz-title">Import content</span>
        <span class="wiz-spacer" />
        <v-btn icon="mdi-close" size="x-small" variant="text" @click="emit('update:modelValue', false)" />
      </div>
      <div class="wiz-grid">
        <button class="wiz-card" @click="emit('upload')">
          <v-icon icon="mdi-file-image-outline" size="26" /><span>Images / Video</span><small>Files → Media / Sprite</small>
        </button>
        <button class="wiz-card" @click="emit('url')">
          <v-icon icon="mdi-link-variant" size="26" /><span>From URL</span><small>Paste an image/video link</small>
        </button>
        <button class="wiz-card" @click="emit('screen-live')">
          <v-icon icon="mdi-monitor-share" size="26" /><span>Screen capture</span><small>Live window/screen source</small>
        </button>
        <button class="wiz-card" @click="emit('screen-grab')">
          <v-icon icon="mdi-monitor-screenshot" size="26" /><span>Screen snapshot</span><small>One still frame → Media</small>
        </button>
        <button class="wiz-card" :class="{ 'wiz-card--dim': !hasGoogle }" @click="hasGoogle ? emit('google') : emit('open-settings')">
          <v-icon icon="mdi-google-photos" size="26" /><span>Google Photos</span><small>{{ hasGoogle ? 'Pick from your library' : 'Add a client ID in Settings' }}</small>
        </button>
        <button class="wiz-card" @click="emit('point-cloud')">
          <v-icon icon="mdi-dots-hexagon" size="26" /><span>Point cloud / LiDAR</span><small>.ply / .las / .xyz / .pts → Geometry</small>
        </button>
        <button class="wiz-card" @click="emit('geodata')">
          <v-icon icon="mdi-map" size="26" /><span>Map / Satellite</span><small>Live tiles → Geodata node</small>
        </button>
        <button class="wiz-card" @click="emit('terrain')">
          <v-icon icon="mdi-terrain" size="26" /><span>3D Terrain</span><small>Elevation → Geometry / Camera</small>
        </button>
      </div>
      <div class="wiz-note">Point clouds accept common LiDAR exports (.ply/.xyz/.pts). Maps &amp; terrain use free public tiles; add a provider key in Settings for higher quality.</div>
    </div>
  </div>
</template>

<style scoped>
.wiz-backdrop { position: fixed; inset: 0; z-index: 4000; background: rgba(5,6,10,0.6); display: flex; align-items: center; justify-content: center; }
.wiz { width: min(560px, 92vw); background: #14161e; border: 1px solid #2a2f40; border-radius: 12px; box-shadow: 0 20px 60px rgba(0,0,0,0.6); overflow: hidden; }
.wiz-head { display: flex; align-items: center; padding: 10px 12px; border-bottom: 1px solid rgba(255,255,255,0.07); color: #cdd3e6; }
.wiz-title { font-weight: 600; font-size: 0.9rem; }
.wiz-spacer { flex: 1; }
.wiz-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 8px; padding: 12px; }
.wiz-card {
  display: flex; flex-direction: column; align-items: center; gap: 3px; text-align: center;
  padding: 14px 8px; border-radius: 10px; cursor: pointer; color: #cdd3e6;
  background: #1a1d28; border: 1px solid #2a2f40;
}
.wiz-card:hover { border-color: #7c8cff; background: rgba(124,140,255,0.1); }
.wiz-card span { font-size: 0.78rem; font-weight: 600; margin-top: 4px; }
.wiz-card small { font-size: 0.64rem; color: #8a90a0; }
.wiz-card--dim { opacity: 0.7; }
.wiz-note { font-size: 0.66rem; color: #737b93; padding: 0 12px 12px; }
</style>
