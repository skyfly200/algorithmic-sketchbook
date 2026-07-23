<script setup>
/**
 * Docs — a multi-page guide rendered from Markdown files in src/docs/pages.
 * The sidebar lists every page (order + icons from src/docs/pages.js); the
 * body renders the current page's Markdown to HTML. All content is authored in
 * the .md files, so the guide works offline like the rest of the app.
 */
import { computed, watch } from 'vue'
import { useRoute } from 'vue-router'
import { PAGES, pageBySlug, DEFAULT_SLUG } from '../docs/pages'

const route = useRoute()
const current = computed(() => pageBySlug(route.params.page) || pageBySlug(DEFAULT_SLUG))
const idx = computed(() => PAGES.findIndex((p) => p.slug === current.value.slug))
const prev = computed(() => (idx.value > 0 ? PAGES[idx.value - 1] : null))
const next = computed(() => (idx.value < PAGES.length - 1 ? PAGES[idx.value + 1] : null))

// Scroll back to the top of the article whenever the page changes.
watch(() => route.params.page, () => window.scrollTo({ top: 0 }))
</script>

<template>
  <div class="docs-shell">
    <aside class="docs-nav">
      <div class="docs-nav-title">Documentation</div>
      <router-link
        v-for="p in PAGES"
        :key="p.slug"
        :to="{ name: 'docs', params: { page: p.slug } }"
        class="docs-nav-link"
        :class="{ active: p.slug === current.slug }"
      >
        <v-icon :icon="p.icon" size="18" class="mr-2" />{{ p.title }}
      </router-link>
    </aside>

    <main class="docs-main">
      <!-- eslint-disable-next-line vue/no-v-html -->
      <article class="md" v-html="current.html" />

      <nav class="docs-pager">
        <router-link
          v-if="prev"
          :to="{ name: 'docs', params: { page: prev.slug } }"
          class="pager-link prev"
        >
          <v-icon icon="mdi-arrow-left" size="18" class="mr-1" />
          <span><small>Previous</small><br />{{ prev.title }}</span>
        </router-link>
        <span v-else />
        <router-link
          v-if="next"
          :to="{ name: 'docs', params: { page: next.slug } }"
          class="pager-link next"
        >
          <span><small>Next</small><br />{{ next.title }}</span>
          <v-icon icon="mdi-arrow-right" size="18" class="ml-1" />
        </router-link>
        <span v-else />
      </nav>
    </main>
  </div>
</template>

<style scoped>
.docs-shell {
  display: grid;
  grid-template-columns: 240px minmax(0, 1fr);
  gap: 32px;
  max-width: 1180px;
  margin: 0 auto;
  padding: 28px 24px 64px;
  align-items: start;
}
.docs-nav {
  position: sticky;
  top: 20px;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.docs-nav-title {
  font: 600 11px system-ui, sans-serif;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: rgba(255, 255, 255, 0.4);
  padding: 0 12px 8px;
}
.docs-nav-link {
  display: flex;
  align-items: center;
  padding: 7px 12px;
  border-radius: 8px;
  color: rgba(255, 255, 255, 0.72);
  text-decoration: none;
  font-size: 0.92rem;
  line-height: 1.2;
}
.docs-nav-link:hover { background: rgba(255, 255, 255, 0.06); color: #fff; }
.docs-nav-link.active {
  background: rgba(124, 140, 255, 0.16);
  color: #fff;
  box-shadow: inset 2px 0 0 #7c8cff;
}
.docs-main { min-width: 0; }
.docs-pager {
  display: flex;
  justify-content: space-between;
  gap: 16px;
  margin-top: 48px;
  padding-top: 20px;
  border-top: 1px solid rgba(255, 255, 255, 0.1);
}
.pager-link {
  display: flex;
  align-items: center;
  padding: 12px 16px;
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 10px;
  color: rgba(255, 255, 255, 0.85);
  text-decoration: none;
  max-width: 48%;
}
.pager-link:hover { background: rgba(255, 255, 255, 0.05); border-color: rgba(124, 140, 255, 0.5); }
.pager-link.next { margin-left: auto; text-align: right; }
.pager-link small { color: rgba(255, 255, 255, 0.45); font-size: 0.72rem; text-transform: uppercase; letter-spacing: 0.04em; }

@media (max-width: 760px) {
  .docs-shell { grid-template-columns: 1fr; gap: 16px; }
  .docs-nav {
    position: static;
    flex-direction: row;
    flex-wrap: wrap;
    gap: 6px;
    padding-bottom: 8px;
    border-bottom: 1px solid rgba(255, 255, 255, 0.1);
  }
  .docs-nav-title { width: 100%; }
  .docs-nav-link { font-size: 0.82rem; padding: 6px 10px; border: 1px solid rgba(255, 255, 255, 0.1); }
  .docs-nav-link.active { box-shadow: none; }
}
</style>

<!-- Markdown content styling (unscoped so it reaches v-html output). -->
<style>
.md { line-height: 1.65; color: rgba(255, 255, 255, 0.9); }
.md h1 { font-size: 2rem; font-weight: 800; letter-spacing: -0.01em; margin: 0 0 16px; }
.md h2 { font-size: 1.35rem; font-weight: 700; margin: 34px 0 12px; padding-bottom: 6px; border-bottom: 1px solid rgba(255, 255, 255, 0.08); }
.md h3 { font-size: 1.08rem; font-weight: 700; margin: 24px 0 8px; }
.md p { margin: 0 0 14px; opacity: 0.92; }
.md a { color: #8ea2ff; text-decoration: none; }
.md a:hover { text-decoration: underline; }
.md ul, .md ol { margin: 0 0 14px; padding-left: 22px; }
.md li { margin: 4px 0; opacity: 0.92; }
.md li > ul, .md li > ol { margin: 4px 0; }
.md hr { border: none; border-top: 1px solid rgba(255, 255, 255, 0.12); margin: 28px 0; }
.md blockquote {
  margin: 0 0 14px; padding: 8px 16px;
  border-left: 3px solid rgba(124, 140, 255, 0.6);
  background: rgba(124, 140, 255, 0.06); border-radius: 0 8px 8px 0;
  opacity: 0.9;
}
.md code {
  background: rgba(255, 255, 255, 0.09); border-radius: 4px; padding: 1px 6px;
  font: 0.86em ui-monospace, "SF Mono", Menlo, monospace;
}
.md pre.code {
  background: rgba(255, 255, 255, 0.05); border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 10px; padding: 14px 16px; overflow-x: auto; margin: 0 0 16px;
}
.md pre.code code { background: none; padding: 0; font-size: 0.84rem; line-height: 1.55; color: #d7dcea; }
.md .table-wrap { overflow-x: auto; margin: 0 0 18px; }
.md table { border-collapse: collapse; width: 100%; font-size: 0.9rem; }
.md th, .md td { text-align: left; padding: 8px 12px; border-bottom: 1px solid rgba(255, 255, 255, 0.1); vertical-align: top; }
.md th { color: rgba(255, 255, 255, 0.6); font-weight: 600; font-size: 0.8rem; text-transform: uppercase; letter-spacing: 0.03em; }
.md td code { white-space: nowrap; }
</style>
