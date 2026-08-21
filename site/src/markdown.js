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
  // Before emphasis, so ~~**text**~~ nests the right way round. The roadmap
  // uses this to strike a decision it later reversed, keeping the original in
  // place rather than editing it away -- which only reads as a reversal if it
  // renders as one.
  s = s.replace(/~~([^~]+)~~/g, '<del>$1</del>')
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
// Ordered lists. Used by Epic 9's two invariants and 9d's three modes, and
// unsupported until now -- both rendered as one run-on paragraph with the
// numbers stranded inline. 8a's rule is add it or stop using it.
const ORDERED = /^(\s*)\d+[.)]\s+(.*)$/
const HEADING = /^(#{1,6})\s+(.*)$/

/** Render a Markdown subset to an HTML string. */
export const renderMarkdown = (src) => {
  const lines = src.replace(/\r\n/g, '\n').split('\n')
  const out = []

  // Open-block state. Only one list is open at a time; the roadmap nests at
  // most one level, handled by indent rather than by a stack of stacks.
  let listType = null // 'task' | 'bullet' | 'ordered'
  let inPara = false
  let inCode = false
  let nested = false

  // An open list item or paragraph, buffered RAW until its block ends.
  //
  // Buffering rather than emitting line by line is what lets a wrapped line
  // join the one above it, and it has to be the raw text: inline() run per
  // line cannot see a `**` that opens on one line and closes on the next, and
  // emits both markers literally. Seven spans in the roadmap did exactly that.
  let open = null // { prefix, suffix, text: [] }

  // The close tag of the <li> currently accepting content, or null.
  //
  // An item stays open across a blank line when what follows is indented to
  // its content column, which is what lets one item hold several paragraphs.
  // Without this the roadmap's reasoning -- every "why not yet", every
  // reversal -- was ejected from the item it belonged to and rendered as
  // top-level prose at the page margin, so an entry's argument stopped
  // looking like part of the entry.
  let itemSuffix = null

  /**
   * The close tag of the open <blockquote>, or null.
   *
   * Quotes are buffered for the same reason list items are. Emitting one per
   * line ran inline() per line, so a `**` opening on one line and closing on
   * the next came out as literal asterisks -- and 42 quoted lines in the
   * roadmap became 40 separate quote boxes instead of the six quotes they are.
   */
  let quoteSuffix = null

  const flush = () => {
    if (!open) return
    out.push(open.prefix, inline(open.text.join(' ')), open.suffix)
    open = null
  }
  const closeItem = () => {
    flush()
    if (!itemSuffix) return
    out.push(itemSuffix)
    itemSuffix = null
  }
  const closeNested = () => { if (nested) { closeItem(); out.push('</ul></li>'); nested = false } }
  const closeList = () => {
    if (!listType) return
    closeNested()
    closeItem()
    out.push(listType === 'ordered' ? '</ol>' : '</ul>')
    listType = null
  }

  /**
   * What follows the blank line at `i`, which decides how much to close.
   *
   * 'continuation' -- indented, not a marker: another paragraph of the open
   * item, so nothing closes. 'item' -- a marker: the item ends but the list
   * does not, which is what keeps items separated by blank lines in one list
   * rather than one list each. 'block' -- back at the margin: the list ends.
   */
  const after = (i) => {
    for (let j = i + 1; j < lines.length; j++) {
      const l = lines[j]
      if (!l.trim()) continue
      if (TASK.test(l) || BULLET.test(l) || ORDERED.test(l)) return 'item'
      return l.length - l.replace(/^ +/, '').length >= 2 ? 'continuation' : 'block'
    }
    return 'block'
  }
  const closePara = () => { if (inPara) { flush(); inPara = false } }
  const closeQuote = () => {
    flush()
    if (!quoteSuffix) return
    out.push(quoteSuffix)
    quoteSuffix = null
  }
  const closeAll = () => { closeList(); closePara(); closeQuote() }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]

    if (/^```/.test(line)) {
      if (inCode) { out.push('</code></pre>'); inCode = false } else { closeAll(); out.push('<pre><code>'); inCode = true }
      continue
    }
    if (inCode) { out.push(escapeHtml(line) + '\n'); continue }

    // Anything that is not a quoted line ends the quote, whatever it is. One
    // guard here rather than a closeQuote() in every branch below.
    if (quoteSuffix && !line.startsWith('>')) closeQuote()

    if (!line.trim()) {
      if (itemSuffix) {
        const next = after(i)
        if (next === 'continuation') { flush(); continue }
        if (next === 'item') { closeItem(); continue }
      }
      closeAll()
      continue
    }

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

    if (line.startsWith('>')) {
      const content = line.replace(/^>\s?/, '')
      if (!quoteSuffix) {
        closeList()
        closePara()
        out.push('<blockquote>')
        quoteSuffix = '</blockquote>'
      }
      // A bare `>` is a paragraph break inside the quote, not the end of it.
      if (!content.trim()) { flush(); continue }
      if (open) open.text.push(content)
      else open = { prefix: '<p>', suffix: '</p>', text: [content] }
      continue
    }

    // Tables: a header row, a separator, then body rows.
    if (line.trim().startsWith('|') && lines[i + 1] && /^\s*\|[\s|:-]+\|\s*$/.test(lines[i + 1])) {
      // An indented table belongs to the open item, the same way a paragraph
      // does -- the Firefox API comparison in 9d is one, and ejecting it left
      // the item claiming a comparison that had walked off without it.
      if (itemSuffix && /^ /.test(line)) flush()
      else closeAll()
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
    const ordered = task || bullet ? null : ORDERED.exec(line)
    if (task || bullet || ordered) {
      const m = task || bullet || ordered
      const indent = m[1].length
      const wantType = task ? 'task' : (ordered ? 'ordered' : 'bullet')
      closePara()
      if (listType && listType !== wantType && indent === 0) closeList()
      if (!listType) {
        out.push(wantType === 'task' ? '<ul class="task-list">' : (wantType === 'ordered' ? '<ol>' : '<ul>'))
        listType = wantType
      }
      if (indent >= 2 && !nested) { closeItem(); out.push('<li><ul>'); nested = true }
      else if (indent < 2 && nested) closeNested()
      closeItem()

      // The <li> is emitted now rather than buffered, because it may go on to
      // hold several paragraphs and only the last of them knows where it ends.
      if (task) {
        const done = task[2].toLowerCase() === 'x'
        const box = done
          ? '<span class="task-box task-done" aria-hidden="true">[x]</span>'
          : '<span class="task-box task-todo" aria-hidden="true">[ ]</span>'
        const label = done ? 'Done: ' : 'To do: '
        // A <div> rather than the <span> this used to be: the item's content
        // is the second flex child, and paragraphs cannot live in a span.
        out.push(`<li class="${done ? 'is-done' : ''}">${box}<div>`)
        itemSuffix = '</div></li>'
        open = { prefix: `<p><span class="sr-only">${label}</span>`, suffix: '</p>', text: [task[3]] }
      } else {
        out.push('<li>')
        itemSuffix = '</li>'
        open = { prefix: '<p>', suffix: '</p>', text: [(bullet || ordered)[2]] }
      }
      continue
    }

    // Lazy continuation: a wrapped bullet. Every long item in the roadmap is
    // written with a hanging indent, and without this each one rendered as a
    // one-item list with its own tail ejected into a paragraph underneath --
    // which was 69 of the file's 98 lists. A blank line still ends the item,
    // so this only rejoins lines the author had already joined.
    if (open && listType) { open.text.push(line.trim()); continue }

    // A further paragraph inside the item, after a blank line that
    // continuesItem() decided not to close on.
    if (itemSuffix) { open = { prefix: '<p>', suffix: '</p>', text: [line.trim()] }; continue }

    // Anything else is paragraph text; consecutive lines join.
    if (!inPara) { closeList(); open = { prefix: '<p>', suffix: '</p>', text: [] }; inPara = true }
    open.text.push(line.trim())
  }

  if (inCode) out.push('</code></pre>')
  closeAll()
  return out.join('')
}
