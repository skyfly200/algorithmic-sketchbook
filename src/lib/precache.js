// Optional pre-fetch of sketch pages and their script/style assets, so a cue's
// effect never waits on the network when it boots. In the production build the
// service worker already precaches every file, so this is a cheap no-op there;
// it matters on first visit (before the SW has finished installing), on dev
// servers, and on hosts that bypass the SW. Fetching through the normal fetch
// path lands the responses in the SW / HTTP cache.

// Extract the module scripts, modulepreloads and stylesheets a page references.
function pageAssets(html, baseUrl) {
  const out = new Set()
  const re = /<(?:script[^>]*\ssrc|link[^>]*\shref)=["']([^"']+)["'][^>]*>/gi
  let m
  while ((m = re.exec(html))) {
    const tag = m[0]
    if (/<link/i.test(tag) && !/rel=["'](?:modulepreload|stylesheet)["']/i.test(tag)) continue
    try { out.add(new URL(m[1], baseUrl).href) } catch { /* malformed url */ }
  }
  return [...out]
}

// urls: sketch page URLs (query strings are ignored). Returns { pages, assets, failed }.
export async function precacheSketches(urls, { onProgress, concurrency = 4 } = {}) {
  const pages = [...new Set(urls.map((u) => new URL(u, location.href)).map((u) => { u.search = ''; u.hash = ''; return u.href }))]
  const seen = new Set()
  const queue = []
  const stat = { pages: pages.length, assets: 0, failed: 0 }
  let done = 0
  const total = () => pages.length + stat.assets

  async function get(url, isPage) {
    try {
      const res = await fetch(url)
      if (!res.ok) { stat.failed++; return }
      if (isPage) {
        const html = await res.text()
        for (const a of pageAssets(html, url)) if (!seen.has(a)) { seen.add(a); stat.assets++; queue.push(() => get(a, false)) }
      } else {
        await res.arrayBuffer() // drain so the body is fully cached
      }
    } catch { stat.failed++ }
    done++
    onProgress?.(done, total())
  }
  for (const p of pages) queue.push(() => get(p, true))

  // Small worker pool; pages enqueue their assets as they parse.
  async function worker() { while (queue.length) await queue.shift()() }
  await Promise.all(Array.from({ length: concurrency }, worker))
  return stat
}
