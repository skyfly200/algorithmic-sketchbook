/**
 * Built-in Collections — curated libraries of public-domain reference imagery
 * you can browse and build on: pull a plate into a Patch Media node, trace it
 * to polygon mattes, or open it at the source. Each collection names a public
 * source (a Wikimedia Commons category or search); the actual plate list is
 * fetched live in the browser (see ../lib/commons.js) so nothing is bundled or
 * hotlinked from a hardcoded guess.
 *
 * To add a collection: append an entry with a stable `slug`, a `source`
 * ({ category } and/or { search } for Commons), and attribution/credit fields.
 */

export const COLLECTIONS = [
  {
    slug: 'hamonshu',
    title: 'Hamonshū — Waves & Ripples',
    subtitle: 'Japanese wave and ripple designs, 1903',
    author: 'Mori Yūzan (森祐山)',
    year: '1903',
    license: 'Public Domain',
    blurb:
      'Hamonshū (波紋集, “a collection of wave patterns”) is a three-volume book of ' +
      'flowing water designs by the artist Mori Yūzan, published in Kyoto in 1903 as ' +
      'a reference for craftspeople. Its stylised waves, whirlpools, ripples and ' +
      'spray are a natural fit for generative work — trace them into mattes, feed a ' +
      'plate through an effect, or just borrow the line.',
    source: {
      category: 'Hamonshū',
      search: 'Hamonshu Mori Yuzan waves',
    },
    sourceName: 'The Public Domain Review',
    sourceUrl:
      'https://publicdomainreview.org/collection/hamonshu-a-japanese-book-of-wave-and-ripple-designs-1903/',
    tags: ['waves', 'ripples', 'japanese', 'line-art', 'pattern'],
  },
]

export function collectionBySlug(slug) {
  return COLLECTIONS.find((c) => c.slug === slug) || null
}
