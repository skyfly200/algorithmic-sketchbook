/**
 * The sketch registry — every folder under /sketches that contains a
 * `sketch.json` manifest becomes a gallery entry, discovered automatically at
 * build time via import.meta.glob, so adding a sketch never requires touching
 * app code. There's no local-vs-external split any more: everything lives in the
 * project. A manifest may set `standalone: true` to mark a fully self-contained
 * imported app (its own UI, no sketchbook runtime) — those are shown in the
 * gallery like anything else but skip the runtime param panel and the
 * compositor pools (Autopilot / Patch / Mixer).
 *
 * Each entry is normalized to:
 *   {
 *     slug, title, description, tags[], tech[], created, updated,
 *     url,          // the local page the viewer iframes
 *     repo,         // optional source link
 *     embed,        // false => open in a new tab instead of iframing
 *     standalone,   // true => a self-contained imported app
 *     thumbnail,    // optional image URL for the gallery card
 *     perf,         // measured performance score, or null
 *   }
 */
// Measured performance scores (1-100 vs a 60fps target), written by
// `npm run perf` (scripts/perf-audit.mjs). Relative to the auditing machine.
import perfScores from './perf.json'
// { slug: ISO date } of each sketch's last update, from git (see vite.config.js).
import updatedMap from 'virtual:sketch-updated'

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

export const allSketches = Object.entries(manifests)
  .map(([path, mod]) => {
    const manifest = mod.default ?? mod
    const slug = path.split('/')[2]
    return {
      slug,
      title: manifest.title ?? slug,
      description: manifest.description ?? '',
      tags: manifest.tags ?? [],
      tech: manifest.tech ?? [],
      created: manifest.created ?? '',
      updated: updatedMap[slug] ?? manifest.updated ?? manifest.created ?? '',
      url: `${import.meta.env.BASE_URL}sketches/${slug}/index.html`,
      repo: manifest.repo ?? null,
      embed: manifest.embed ?? true,
      // A self-contained imported app: shown in the gallery, but it brings its
      // own UI so it gets no runtime param panel and isn't offered as a
      // composable effect in Autopilot / Patch / Mixer.
      standalone: manifest.standalone ?? false,
      thumbnail: thumbnailFor(slug),
      perf: perfScores[slug] ?? null,
    }
  })
  .sort((a, b) => (b.created || '').localeCompare(a.created || ''))
