// A deliberately small Markdown renderer, for one job: showing ROADMAP.md on
// roadmap.html.
//
// This exists rather than a library because the project has no build step and
// no dependencies, and pulling in a parser to render one file we control would
// undo both. It handles the subset that file actually uses and nothing else --
// if the roadmap grows a construct that is missing here, the fix is to add it
// or to stop using it, not to reach for marked.
//
// Everything is escaped before any markup is generated. The input is our own
// file, but a renderer that only works on trusted input is a renderer waiting
// to be pointed at untrusted input.

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }
const escapeHtml = (s) => s.replace(/[&<>"']/g, (c) => ESCAPES[c])

/** Inline spans. Runs after escaping, so it only ever sees safe text. */
const inline = (raw) => {
  let s = escapeHtml(raw)
  // Code first: its contents must not then be treated as emphasis.
  //
  // The placeholder can safely use angle brackets: escapeHtml has already run,
  // so no raw < survives in the text, and the later <strong>/<em>/<a> insertions
  // never match /<d+>/. A space-delimited sentinel would have been matched back
  // out of ordinary prose -- the roadmap is full of bare numbers.
  const code = []
  s = s.replace(/`([^`]+)`/g, (_, body) => `<${code.push(body) - 1}>`)
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
  s = s.replace(/(^|[^*])\*([^*\s][^*]*)\*/g, '$1<em>$2</em>')
  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, text, href) => {
    // Only http(s), anchors and site-relative paths. No javascript: URLs.
    const safe = /^(https?:\/\/|#|\/)/.test(href) ? href : '#'
    const external = /^https?:\/\//.test(safe)
    const attrs = external ? ' target="_blank" rel="noopener"' : ''
    return `<a href="${safe}"${attrs}>${text}</a>`
  })
  return s.replace(/<(\d+)>/g, (_, i) => `<code>${code[+i]}</code>`)
}

const TASK = /^(\s*)- \[( |x|X)\]\s+(.*)$/
const BULLET = /^(\s*)[-*]\s+(.*)$/
const HEADING = /^(#{1,6})\s+(.*)$/

/** Render a Markdown subset to an HTML string. */
export const renderMarkdown = (src) => {
  const lines = src.replace(/\r\n/g, '\n').split('\n')
  const out = []

  // Open-block state. Only one list is open at a time; the roadmap nests at
  // most one level, handled by indent rather than by a stack of stacks.
  let listType = null // 'task' | 'bullet'
  let inPara = false
  let inCode = false
  let nested = false

  const closeNested = () => { if (nested) { out.push('</ul></li>'); nested = false } }
  const closeList = () => {
    if (!listType) return
    closeNested()
    out.push('</ul>')
    listType = null
  }
  const closePara = () => { if (inPara) { out.push('</p>'); inPara = false } }
  const closeAll = () => { closeList(); closePara() }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]

    if (/^```/.test(line)) {
      if (inCode) { out.push('</code></pre>'); inCode = false } else { closeAll(); out.push('<pre><code>'); inCode = true }
      continue
    }
    if (inCode) { out.push(escapeHtml(line) + '\n'); continue }

    if (!line.trim()) { closeAll(); continue }

    if (/^---+\s*$/.test(line)) { closeAll(); out.push('<hr />'); continue }

    const h = HEADING.exec(line)
    if (h) {
      closeAll()
      // The file's own `# Roadmap` would collide with the page's h1, so shift
      // every level down one: h1 -> h2, and so on.
      const level = Math.min(h[1].length + 1, 6)
      const text = inline(h[2])
      const id = h[2].toLowerCase().replace(/[^\w]+/g, '-').replace(/^-|-$/g, '')
      out.push(`<h${level} id="${escapeHtml(id)}">${text}</h${level}>`)
      continue
    }

    if (line.startsWith('> ')) {
      closeAll()
      out.push(`<blockquote>${inline(line.slice(2))}</blockquote>`)
      continue
    }

    // Tables: a header row, a separator, then body rows.
    if (line.trim().startsWith('|') && lines[i + 1] && /^\s*\|[\s|:-]+\|\s*$/.test(lines[i + 1])) {
      closeAll()
      const cells = (row) => row.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim())
      const head = cells(line)
      out.push('<div class="table-scroll"><table><thead><tr>')
      for (const c of head) out.push(`<th>${inline(c)}</th>`)
      out.push('</tr></thead><tbody>')
      i += 2
      while (i < lines.length && lines[i].trim().startsWith('|')) {
        out.push('<tr>')
        for (const c of cells(lines[i])) out.push(`<td>${inline(c)}</td>`)
        out.push('</tr>')
        i++
      }
      i--
      out.push('</tbody></table></div>')
      continue
    }

    const task = TASK.exec(line)
    const bullet = task ? null : BULLET.exec(line)
    if (task || bullet) {
      const indent = (task ? task[1] : bullet[1]).length
      const wantType = task ? 'task' : 'bullet'
      closePara()
      if (listType && listType !== wantType && indent === 0) closeList()
      if (!listType) {
        out.push(wantType === 'task' ? '<ul class="task-list">' : '<ul>')
        listType = wantType
      }
      if (indent >= 2 && !nested) { out.push('<li><ul>'); nested = true }
      else if (indent < 2 && nested) closeNested()

      if (task) {
        const done = task[2].toLowerCase() === 'x'
        const box = done
          ? '<span class="task-box task-done" aria-hidden="true">[x]</span>'
          : '<span class="task-box task-todo" aria-hidden="true">[ ]</span>'
        const label = done ? 'Done: ' : 'To do: '
        out.push(
          `<li class="${done ? 'is-done' : ''}">${box}<span><span class="sr-only">${label}</span>${inline(task[3])}</span></li>`,
        )
      } else {
        out.push(`<li>${inline(bullet[2])}</li>`)
      }
      continue
    }

    // Anything else is paragraph text; consecutive lines join.
    if (!inPara) { closeList(); out.push('<p>'); inPara = true }
    else out.push(' ')
    out.push(inline(line.trim()))
  }

  if (inCode) out.push('</code></pre>')
  closeAll()
  return out.join('')
}
