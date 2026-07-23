// A small, dependency-free Markdown → HTML renderer, enough for the docs pages:
// headings, paragraphs, fenced code blocks, inline code, bold/italic, links,
// unordered/ordered lists, GFM pipe tables, blockquotes and horizontal rules.
// The docs are authored in-repo (trusted), and this runs at render time with no
// network — so the whole guide works offline like everything else.

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

// Inline spans. Split on backtick code spans first so their contents are never
// touched by the bold/italic/link passes; transform the remaining segments.
function inline(text) {
  return text
    .split(/(`[^`]+`)/g)
    .map((seg) => {
      if (seg.length >= 2 && seg[0] === '`' && seg[seg.length - 1] === '`') {
        return `<code>${esc(seg.slice(1, -1))}</code>`
      }
      let t = esc(seg)
      t = t.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, label, href) => {
        const ext = /^https?:/.test(href)
        const attrs = ext ? ' target="_blank" rel="noopener"' : ''
        return `<a href="${href}"${attrs}>${label}</a>`
      })
      t = t.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      t = t.replace(/(^|[^*])\*([^*]+)\*/g, '$1<em>$2</em>')
      return t
    })
    .join('')
}

function tableRow(line) {
  return line.replace(/^\||\|$/g, '').split('|').map((c) => c.trim())
}

export function renderMarkdown(md) {
  const lines = md.replace(/\r\n/g, '\n').split('\n')
  const out = []
  let i = 0
  while (i < lines.length) {
    const line = lines[i]

    // fenced code block
    if (/^```/.test(line)) {
      const buf = []
      i++
      while (i < lines.length && !/^```/.test(lines[i])) buf.push(lines[i++])
      i++ // closing fence
      out.push(`<pre class="code"><code>${esc(buf.join('\n'))}</code></pre>`)
      continue
    }

    // blank line
    if (/^\s*$/.test(line)) { i++; continue }

    // heading
    const h = line.match(/^(#{1,6})\s+(.*)$/)
    if (h) { out.push(`<h${h[1].length}>${inline(h[2].trim())}</h${h[1].length}>`); i++; continue }

    // horizontal rule
    if (/^(-{3,}|\*{3,})\s*$/.test(line)) { out.push('<hr />'); i++; continue }

    // table: header row followed by a |---|---| separator
    if (line.includes('|') && i + 1 < lines.length && /^\s*\|?[\s:-]*-[-\s:|]*$/.test(lines[i + 1]) && lines[i + 1].includes('-')) {
      const head = tableRow(line)
      i += 2
      const rows = []
      while (i < lines.length && lines[i].includes('|') && !/^\s*$/.test(lines[i])) rows.push(tableRow(lines[i++]))
      let html = '<div class="table-wrap"><table><thead><tr>'
      html += head.map((c) => `<th>${inline(c)}</th>`).join('')
      html += '</tr></thead><tbody>'
      for (const r of rows) html += '<tr>' + r.map((c) => `<td>${inline(c)}</td>`).join('') + '</tr>'
      html += '</tbody></table></div>'
      out.push(html)
      continue
    }

    // blockquote
    if (/^>\s?/.test(line)) {
      const buf = []
      while (i < lines.length && /^>\s?/.test(lines[i])) buf.push(lines[i++].replace(/^>\s?/, ''))
      out.push(`<blockquote>${inline(buf.join(' '))}</blockquote>`)
      continue
    }

    // list (unordered or ordered) — single level; each item is inline-rendered
    if (/^\s*([-*]|\d+\.)\s+/.test(line)) {
      const ordered = /^\s*\d+\.\s+/.test(line)
      const items = []
      while (i < lines.length && /^\s*([-*]|\d+\.)\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*([-*]|\d+\.)\s+/, ''))
        i++
      }
      const tag = ordered ? 'ol' : 'ul'
      out.push(`<${tag}>` + items.map((it) => `<li>${inline(it)}</li>`).join('') + `</${tag}>`)
      continue
    }

    // paragraph — gather consecutive plain lines
    const buf = []
    while (i < lines.length && !/^\s*$/.test(lines[i]) && !/^(```|#{1,6}\s|>|\s*([-*]|\d+\.)\s)/.test(lines[i]) && !/^(-{3,}|\*{3,})\s*$/.test(lines[i])) {
      buf.push(lines[i++])
    }
    out.push(`<p>${inline(buf.join(' '))}</p>`)
  }
  return out.join('\n')
}

// Pull the first H1's text out of a markdown doc (used as the page title).
export function firstHeading(md) {
  const m = md.match(/^#\s+(.*)$/m)
  return m ? m[1].trim() : ''
}
