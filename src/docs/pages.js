// Ordered docs pages. Each entry maps a URL slug (/#/docs/<slug>) to a Markdown
// file in ./pages and a sidebar label + icon. The Markdown itself is the source
// of truth for the content; this only fixes the order and navigation chrome.
import { renderMarkdown, firstHeading } from './markdown'

const raw = import.meta.glob('./pages/*.md', { query: '?raw', import: 'default', eager: true })
function md(name) {
  const key = Object.keys(raw).find((k) => k.endsWith(`/pages/${name}.md`))
  return key ? raw[key] : ''
}

// Sidebar order + icons. Slug 'overview' is the default page at /#/docs.
const ORDER = [
  ['overview', 'mdi-book-open-page-variant-outline'],
  ['viewer', 'mdi-eye-outline'],
  ['inputs', 'mdi-tune-vertical'],
  ['scenes', 'mdi-movie-open-star-outline'],
  ['mixer', 'mdi-layers-triple-outline'],
  ['patch', 'mdi-vector-polyline'],
  ['autopilot', 'mdi-robot-outline'],
  ['effects-filters', 'mdi-image-filter-vintage'],
  ['authoring', 'mdi-code-tags'],
  ['runtime', 'mdi-api'],
  ['offline', 'mdi-wifi-off'],
]

export const PAGES = ORDER.map(([slug, icon]) => {
  const source = md(slug)
  return { slug, icon, title: firstHeading(source) || slug, html: renderMarkdown(source) }
})

export const pageBySlug = (slug) => PAGES.find((p) => p.slug === slug)
export const DEFAULT_SLUG = 'overview'
