import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

// WCAG contrast, checked against the real tokens.css rather than a copy of the
// values. Until now every contrast check in this project was ad-hoc: a throwaway
// script or a measurement taken in a browser. Nothing stopped a token edit from
// silently dropping the site below AA, which is how white-on-primary sat at
// 2.77:1 and the dark toast at 1.81:1 in the first place.
//
// What this covers: the token pairs the design intends to combine.
// What it cannot cover: a rule that pairs the wrong two tokens, or a hardcoded
// colour in a stylesheet. The lint below catches the specific version of that
// mistake which has already happened twice.

const CSS = fs.readFileSync(new URL('../src/tokens.css', import.meta.url), 'utf8')

/** Pull the custom properties out of a rule block. */
const readBlock = (selector) => {
  const start = CSS.indexOf(selector)
  assert.notEqual(start, -1, `${selector} not found in tokens.css`)
  const open = CSS.indexOf('{', start)
  const close = CSS.indexOf('\n}', open)
  const body = CSS.slice(open, close)
  const out = {}
  for (const m of body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) out[m[1]] = m[2].trim()
  return out
}

const light = readBlock(':root')
// The dark block only overrides some tokens; the rest inherit from :root.
const dark = { ...light, ...readBlock("[data-theme='dark']") }

const hex = (h) => {
  const m = /^#([0-9a-f]{6})$/i.exec(h.trim())
  assert.ok(m, `expected a 6-digit hex colour, got ${JSON.stringify(h)}`)
  return [0, 2, 4].map((i) => parseInt(m[1].substr(i, 2), 16))
}
const luminance = (c) => {
  const [r, g, b] = hex(c).map((v) => {
    v /= 255
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}
const contrast = (a, b) => {
  const l1 = luminance(a)
  const l2 = luminance(b)
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05)
}

// [foreground token, background token, minimum]
// 4.5 for body text, 3.0 for UI component boundaries and focus indicators.
const PAIRS = [
  ['--text', '--surface', 4.5],
  ['--text', '--background', 4.5],
  ['--text-secondary', '--surface', 4.5],
  ['--text-secondary', '--background', 4.5],
  ['--secondary', '--surface', 4.5],

  // Filled controls. --on-primary exists because a bright dark-theme fill
  // cannot carry white text.
  ['--on-primary', '--primary', 4.5],
  ['--on-primary', '--primary-dark', 4.5],
  ['--primary', '--surface', 4.5],

  // Status colours are used both as accent text and as toast fills.
  ['--success', '--surface', 4.5],
  ['--warning', '--surface', 4.5],
  ['--error', '--surface', 4.5],
  ['--on-status', '--success', 4.5],
  ['--on-status', '--warning', 4.5],
  ['--on-status', '--error', 4.5],

  // Control boundaries and focus rings: WCAG 1.4.11.
  ['--border-strong', '--surface', 3.0],
  ['--border-focus', '--surface', 3.0],
  ['--border-focus', '--background', 3.0],
]

const BADGES = ['blue', 'sky', 'teal', 'slate', 'amber', 'rose']

for (const [themeName, tokens] of [['light', light], ['dark', dark]]) {
  test(`${themeName} theme meets WCAG AA for every token pair`, () => {
    for (const [fg, bg, min] of PAIRS) {
      assert.ok(tokens[fg], `${fg} missing in ${themeName}`)
      assert.ok(tokens[bg], `${bg} missing in ${themeName}`)
      const ratio = contrast(tokens[fg], tokens[bg])
      assert.ok(
        ratio >= min,
        `${themeName}: ${fg} on ${bg} is ${ratio.toFixed(2)}:1, needs ${min}:1`,
      )
    }
  })

  test(`${themeName} theme badge pairs meet WCAG AA`, () => {
    for (const name of BADGES) {
      const fg = `--badge-${name}-fg`
      const bg = `--badge-${name}-bg`
      assert.ok(tokens[fg] && tokens[bg], `${name} badge missing in ${themeName}`)
      const ratio = contrast(tokens[fg], tokens[bg])
      assert.ok(
        ratio >= 4.5,
        `${themeName}: ${name} badge is ${ratio.toFixed(2)}:1, needs 4.5:1`,
      )
    }
  })
}

test('both themes define the same colour tokens', () => {
  // A token defined only in light silently falls back in dark, which is how a
  // theme ends up with an unreadable leftover.
  const darkOnly = readBlock("[data-theme='dark']")
  for (const key of Object.keys(darkOnly)) {
    if (key === '--page-gradient' || key.startsWith('--shadow')) continue
    assert.ok(light[key], `${key} is overridden in dark but never defined in :root`)
  }
})

// The bug that has now happened three times: a hardcoded white sitting on a
// fill that becomes bright in dark mode. The buttons, the toast, and the
// checkbox tick.
//
// Matching on line proximity is not enough and gave a false pass here. The
// toast sets its colour in `.notification` while the background lives in
// `.notification.success`, and the tick is `.checkbox:checked::after` against
// `.checkbox:checked` -- in both cases the two declarations are in separate
// rules. So group rules by their base selector instead: strip pseudo-elements,
// pseudo-classes and modifier classes, then check whether any rule in that
// family sets a themed background while another sets a literal colour.
const baseSelector = (sel) =>
  sel
    .trim()
    .split(',')[0]
    .replace(/::[\w-]+/g, '')
    .replace(/:[\w-]+(\([^)]*\))?/g, '')
    .replace(/\.(active|success|error|warning|is-current)\b/g, '')
    .trim()

test('no stylesheet puts a literal colour on a themed fill', () => {
  const sheets = ['../src/style.css', '../src/site-footer.css', '../src/settings-panel.css', '../src/site-header.css']
  const themedBg = /background:\s*var\(--(primary|primary-dark|secondary|success|warning|error)\)/
  const literalColour = /(^|\n)\s*color:\s*(white|#fff(fff)?)\s*;/i

  const families = new Map() // base selector -> { bg, literalAt }
  for (const rel of sheets) {
    // Strip comments first. Without this a rule preceded by one keys as
    // "/* Notifications */\n.notification" and lands in its own family, which
    // is exactly how the toast slipped through the first version of this test.
    const text = fs
      .readFileSync(new URL(rel, import.meta.url), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
    for (const m of text.matchAll(/(^|\n)([^{}@\n][^{}]*?)\{([^}]*)\}/g)) {
      const base = baseSelector(m[2])
      if (!base) continue
      const body = m[3]
      const entry = families.get(base) || { bg: false, literalAt: null }
      if (themedBg.test(body)) entry.bg = true
      if (literalColour.test(body)) entry.literalAt = `${rel.replace('../', '')} ${m[2].trim()}`
      families.set(base, entry)
    }
  }

  const offenders = [...families.values()]
    .filter((e) => e.bg && e.literalAt)
    .map((e) => e.literalAt)

  assert.deepEqual(
    offenders,
    [],
    `these sit on a themed fill and need --on-primary / --on-status rather than a literal colour: ${offenders.join(' | ')}`,
  )
})
