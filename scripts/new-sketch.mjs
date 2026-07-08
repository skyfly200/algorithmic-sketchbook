#!/usr/bin/env node
/**
 * Scaffold a new embedded sketch from a template.
 *
 *   npm run new <slug> [-- --template <name>] [--title "Nice Title"]
 *
 * Examples:
 *   npm run new my-noise-experiment
 *   npm run new ray-marcher -- --template webgl-shader --title "Ray Marcher"
 *
 * Templates live in /templates — add a folder there to add a template.
 * External (own-repo) projects are added by editing
 * src/registry/external.json instead; see README.md.
 */
import { cpSync, existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const templatesDir = join(root, 'templates')
const templates = readdirSync(templatesDir, { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => d.name)

const args = process.argv.slice(2)
function flag(name, fallback) {
  const i = args.indexOf(`--${name}`)
  return i !== -1 && args[i + 1] ? args[i + 1] : fallback
}

const slug = args.find((a) => !a.startsWith('--') && a !== flag('template') && a !== flag('title'))
const template = flag('template', 'canvas2d')
const usage = `Usage: npm run new <slug> [-- --template <${templates.join('|')}>] [--title "Title"]`

if (!slug) {
  console.error(usage)
  process.exit(1)
}
if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug)) {
  console.error(`Slug must be kebab-case (got "${slug}").\n${usage}`)
  process.exit(1)
}
if (!templates.includes(template)) {
  console.error(`Unknown template "${template}". Available: ${templates.join(', ')}\n${usage}`)
  process.exit(1)
}

const dest = join(root, 'sketches', slug)
if (existsSync(dest)) {
  console.error(`sketches/${slug} already exists.`)
  process.exit(1)
}

const title = flag(
  'title',
  slug.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
)

cpSync(join(templatesDir, template), dest, { recursive: true })

// Fill in the title placeholder in copied files.
for (const file of readdirSync(dest)) {
  const path = join(dest, file)
  writeFileSync(path, readFileSync(path, 'utf8').replaceAll('__TITLE__', title))
}

const techByTemplate = {
  canvas2d: ['canvas2d'],
  'webgl-shader': ['webgl', 'glsl'],
  three: ['three.js', 'webgl'],
}

writeFileSync(
  join(dest, 'sketch.json'),
  JSON.stringify(
    {
      title,
      description: '',
      tags: [],
      tech: techByTemplate[template] ?? [],
      created: new Date().toISOString().slice(0, 10),
    },
    null,
    2,
  ) + '\n',
)

console.log(`Created sketches/${slug} from the "${template}" template.
Next steps:
  1. Edit sketches/${slug}/sketch.js
  2. Fill in the description/tags in sketches/${slug}/sketch.json
  3. npm run dev — it appears in the gallery automatically`)
