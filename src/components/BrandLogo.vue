<script setup>
// The user's animated "Bright Waves" logo. Rendered inline so its SMIL
// animations run. IDs are suffixed per-instance so multiple logos on one page
// (app bar + hero) don't collide on their mask/pattern references.
const props = defineProps({
  size: { type: [Number, String], default: 96 },
  uid: { type: String, default: 'bw' },
})
</script>

<template>
  <svg
    :width="size"
    :height="size"
    viewBox="0 0 2400 2400"
    class="brand-logo"
    role="img"
    aria-label="Bright Waves logo"
  >
    <mask :id="`clip-${uid}`">
      <circle fill="white" cx="600" cy="600" r="220" />
    </mask>
    <symbol :id="`logo-${uid}`" x="-600" y="-600" width="1000" height="1000" :mask="`url(#clip-${uid})`">
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
      <pattern :id="`pattern-${uid}`" x="0" y="0" width="0.05" height="0.05">
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
    <circle :fill="`url(#pattern-${uid})`" cx="1200" cy="1200" r="2000" />
    <use :href="`#logo-${uid}`" transform="translate(1200 1200) scale(8 8)" />
  </svg>
</template>

<style scoped>
.brand-logo {
  display: block;
  border-radius: 12px;
  background-color: #121212;
  stroke-width: 10;
}
</style>
