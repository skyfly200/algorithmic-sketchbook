/**
 * The sketch registry merges two sources into one list:
 *
 * 1. LOCAL sketches — any folder under /sketches that contains a
 *    `sketch.json` manifest. Discovered automatically at build time via
 *    import.meta.glob, so adding a sketch never requires touching app code.
 *
 * 2. EXTERNAL projects — experiments that live in their own repos,
 *    listed by hand in ./external.json.
 *
 * Both are normalized to the same shape:
 *   {
 *     slug, title, description, tags[], tech[], created,
 *     type: 'local' | 'external',
 *     url,          // what the viewer iframes (local page or live demo)
 *     repo,         // source link (external only)
 *     embed,        // false => open in a new tab instead of iframing
 *     thumbnail,    // optional image URL for the gallery card
 *   }
 */
import externalProjects from './external.json'
// Measured performance scores (1-100 vs a 60fps target), written by
// `npm run perf` (scripts/perf-audit.mjs). Relative to the auditing machine.
import perfScores from './perf.json'

const manifests = import.meta.glob('/sketches/*/sketch.json', { eager: true })
const thumbnails = import.meta.glob('/sketches/*/thumbnail.{png,jpg,webp,gif}', {
  eager: true,
  query: '?url',
  import: 'default',
})

function thumbnailFor(slug) {
  const key = Object.keys(thumbnails).find((p) => p.includes(`/sketches/${slug}/`))
  return key ? thumbnails[key] : null
}

const localSketches = Object.entries(manifests).map(([path, mod]) => {
  const manifest = mod.default ?? mod
  const slug = path.split('/')[2]
  return {
    slug,
    title: manifest.title ?? slug,
    description: manifest.description ?? '',
    tags: manifest.tags ?? [],
    tech: manifest.tech ?? [],
    created: manifest.created ?? '',
    type: 'local',
    url: `${import.meta.env.BASE_URL}sketches/${slug}/index.html`,
    repo: null,
    embed: true,
    thumbnail: thumbnailFor(slug),
    perf: perfScores[slug] ?? null,
  }
})

const externals = externalProjects.map((p) => ({
  slug: p.slug,
  title: p.title ?? p.slug,
  description: p.description ?? '',
  tags: p.tags ?? [],
  tech: p.tech ?? [],
  created: p.created ?? '',
  type: 'external',
  url: p.url ?? null,
  repo: p.repo ?? null,
  embed: p.embed ?? Boolean(p.url),
  thumbnail: p.thumbnail ?? null,
  perf: null, // external pages aren't audited
}))

export const allSketches = [...localSketches, ...externals].sort((a, b) =>
  (b.created || '').localeCompare(a.created || ''),
)
