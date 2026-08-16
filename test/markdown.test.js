import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { renderMarkdown } from '../src/markdown.js'

// The renderer had no tests, which is how it shipped mangling most of the one
// file it exists to display. Every long bullet in ROADMAP.md is written with a
// hanging indent, and the renderer treated each wrapped line as the start of a
// paragraph: 69 of the file's 98 lists were a single item with its own tail
// ejected underneath it. Nothing looked wrong in the Markdown.

const ROADMAP = fs.readFileSync(new URL('../ROADMAP.md', import.meta.url), 'utf8')

const count = (html, re) => (html.match(re) || []).length
const textOf = (html) => html.replace(/<[^>]+>/g, '')

test('a wrapped bullet stays one bullet', () => {
  const html = renderMarkdown([
    '- [ ] **Porting cost is low.** No build step, no CDN, and `lib.js` is',
    '      already DOM-free; a shell wraps the existing files unchanged.',
    '- [ ] A second item.',
  ].join('\n'))

  assert.equal(count(html, /<ul[ >]/g), 1, 'one list, not one per line')
  assert.equal(count(html, /<li[ >]/g), 2)
  assert.equal(count(html, /<p>/g), 0, 'a continuation line is not a paragraph')
  assert.match(textOf(html), /is already DOM-free/, 'the wrap joins with a space')
})

test('emphasis spanning a wrap is emphasis, not literal asterisks', () => {
  // inline() runs once per BLOCK for this reason: run per line, it cannot see
  // a span that opens on one line and closes on the next, and emits both
  // markers as text. Seven spans in the roadmap did exactly that.
  const html = renderMarkdown([
    '- [ ] **Manifest V3 forces the build step, and it is the same blocker',
    '      already on the board.** Extension pages get `script-src \'self\'`.',
  ].join('\n'))

  assert.equal(count(html, /<strong>/g), 1)
  assert.equal(textOf(html).includes('**'), false, 'no literal ** may survive')
  assert.match(html, /<code>script-src &#39;self&#39;<\/code>/)
})

test('a paragraph that wraps mid-emphasis closes it too', () => {
  const html = renderMarkdown(['**The shape it would take, noted now so it is', 'not designed under pressure.**'].join('\n'))
  assert.equal(count(html, /<strong>/g), 1)
  assert.equal(textOf(html).includes('**'), false)
})

test('a blank line still ends the item', () => {
  // The continuation rule must not swallow the prose that follows a list.
  const html = renderMarkdown(['- one', '', 'A following paragraph.'].join('\n'))
  assert.equal(count(html, /<li[ >]/g), 1)
  assert.equal(count(html, /<p>/g), 1)
  assert.match(html, /<\/ul><p>A following paragraph\.<\/p>/)
})

test('a heading ends the item without a blank line', () => {
  const html = renderMarkdown(['- one', '## Next'].join('\n'))
  assert.match(html, /<\/ul><h3 id="next">Next<\/h3>/)
})

test('strikethrough renders, because the roadmap uses it to mark a reversal', () => {
  const html = renderMarkdown('- [x] ~~**Plain-text export is not offered.**~~ Reversed.')
  assert.match(html, /<del><strong>Plain-text export is not offered\.<\/strong><\/del>/)
  assert.equal(textOf(html).includes('~~'), false)
})

test('nested bullets survive the buffering', () => {
  const html = renderMarkdown(['- outer', '  - inner one', '  - inner two', '- outer two'].join('\n'))
  assert.equal(count(html, /<ul[ >]/g), 2)
  assert.equal(count(html, /<\/ul>/g), 2)
  // Four bullets plus the bare <li> that carries the nested <ul>, which is how
  // a sublist is legally attached to the item above it.
  assert.equal(count(html, /<li[ >]/g), 5)
  assert.equal(count(html, /<li><ul>/g), 1)
})

test('the real roadmap renders with balanced tags and no leaked markup', () => {
  // The guard that matters: this runs against the file as it actually is, so
  // a construct the renderer does not know fails here rather than on the page.
  const html = renderMarkdown(ROADMAP)

  for (const tag of ['li', 'ul', 'p', 'span', 'td', 'tr']) {
    assert.equal(count(html, new RegExp(`<${tag}[ >]`, 'g')), count(html, new RegExp(`</${tag}>`, 'g')),
      `${tag} tags are unbalanced`)
  }

  const text = textOf(html)
  for (const [name, re] of [['bold', /\*\*/g], ['strikethrough', /~~/g], ['heading', /^#{1,6} /gm]]) {
    assert.equal((text.match(re) || []).length, 0, `${name} markup leaked into the rendered text`)
  }
})

test('every roadmap list holds the items its Markdown declares', () => {
  // The count is the whole bug: a list of five bullets must render as one list
  // of five, not five lists of one.
  const html = renderMarkdown(ROADMAP)
  const lists = html.match(/<ul[^>]*>(?:(?!<\/ul>)[\s\S])*?<\/ul>/g) || []
  const singles = lists.filter((u) => count(u, /<li[ >]/g) === 1).length

  // Bullets, task items and numbered items all become one <li> each.
  const declared = (ROADMAP.match(/^\s*(?:- |\d+[.)] )/gm) || []).length
  assert.equal(count(html, /<li[ >]/g) - count(html, /<li><ul>/g), declared,
    'every bullet in the file should be exactly one rendered item')
  // A ratio rather than a count, because one-item lists are legitimate here:
  // a long entry with blank-line-separated paragraphs inside it is one bullet
  // followed by prose, which is the house style. What this catches is the
  // regression that prompted it, where every wrapped line began a new list and
  // 69 of 98 lists held a single item -- 70%. Currently 18%.
  const ratio = singles / lists.length
  assert.ok(ratio < 0.4,
    `${singles} of ${lists.length} lists hold one item (${(ratio * 100).toFixed(0)}%); it was 70% when each wrap started a new list`)
})

test('a numbered list is a numbered list', () => {
  // Epic 9's invariants and 9d's three modes both use these. Until they were
  // supported, each rendered as one run-on paragraph with the numbers
  // stranded inline mid-sentence.
  const html = renderMarkdown(['1. First thing', '2. Second thing', '3. Third'].join('\n'))
  assert.equal(count(html, /<ol>/g), 1)
  assert.equal(count(html, /<\/ol>/g), 1)
  assert.equal(count(html, /<li>/g), 3)
  assert.equal(count(html, /<ul[ >]/g), 0, 'not a bullet list wearing numbers')
  assert.equal(textOf(html).includes('1.'), false, 'the marker is the list, not text')
})

test('numbered items wrap like every other item', () => {
  const html = renderMarkdown([
    '1. **Local only.** One device, no network, and nothing',
    '   leaves it.',
    '2. Second.',
  ].join('\n'))
  assert.equal(count(html, /<li>/g), 2)
  assert.match(textOf(html), /and nothing leaves it\./)
  assert.equal(count(html, /<strong>/g), 1)
})

test('both list kinds can follow each other', () => {
  const html = renderMarkdown(['- a bullet', '', '1. a number'].join('\n'))
  assert.equal(count(html, /<ul[ >]/g), 1)
  assert.equal(count(html, /<ol>/g), 1)
  assert.match(html, /<\/ul>.*<ol>/s, 'the first list must close before the second opens')
})

test('the roadmap renders its numbered lists as lists', () => {
  // The two that exist: Epic 9's invariants and 9d's three modes.
  const html = renderMarkdown(ROADMAP)
  assert.ok(count(html, /<ol>/g) >= 2, 'both numbered lists should render as ordered lists')
  assert.equal(count(html, /<ol>/g), count(html, /<\/ol>/g))
})

test('no list continuation is indented into an accidental code block', () => {
  // ROADMAP.md is read in two places -- roadmap.html through renderMarkdown,
  // and GitHub through a CommonMark renderer -- and only one of them was ever
  // checked. In CommonMark, content indented 4+ past a list item's CONTENT
  // COLUMN is an indented code block. `- ` puts that column at 2, so the
  // file's 6-space hanging indent was exactly the threshold: 719 lines of
  // ordinary prose rendered as monospace boxes on GitHub, with `~~` and `**`
  // as literal characters. The strike-through reversal trail -- the whole
  // mechanism behind "reversals stay visible" -- was the worst casualty.
  //
  // It rendered fine on roadmap.html only because renderMarkdown closes the
  // list on a blank line and never sees the continuation as list content.
  // Our bug was masking the other one, which is why this asserts the SOURCE
  // rather than either renderer's output.
  //
  // The content column depends on the marker: `- ` is 2, `1. ` is 3. Measured
  // per item rather than assumed, or the ordered lists produce false failures.
  const marker = /^(?:[-*+]|\d+[.)])(\s+)/
  const offenders = []
  let fence = false
  let column = null

  ROADMAP.split(/\r?\n/).forEach((line, i) => {
    const stripped = line.replace(/^ +/, '')
    if (stripped.startsWith('```')) { fence = !fence; return }
    if (fence || !line.trim()) return

    const indent = line.length - stripped.length
    if (indent === 0) {
      const m = marker.exec(line)
      column = m ? m[0].length : null
      return
    }
    if (column !== null && indent >= column + 4) {
      offenders.push(`  L${i + 1}: indented ${indent}, content column ${column} — ${stripped.slice(0, 55)}`)
    }
  })

  assert.deepEqual(offenders, [],
    `${offenders.length} line(s) will render as an indented code block on GitHub.\n`
    + `Indent list continuations to the item's content column:\n${offenders.slice(0, 5).join('\n')}`)
})
