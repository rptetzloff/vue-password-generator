import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { PALETTES, DEFAULT_PALETTE } from '../src/palettes.js'

// WCAG contrast, checked against the real tokens.css rather than a copy of the
// values. Until now every contrast check in this project was ad-hoc: a throwaway
// script or a measurement taken in a browser. Nothing stopped a token edit from
// silently dropping the site below AA, which is how white-on-primary sat at
// 2.77:1 and the dark toast at 1.81:1 in the first place.
//
// What this covers: the token pairs the design intends to combine.
// What it cannot cover: a rule that pairs the wrong two tokens, or a hardcoded
// color in a stylesheet. The lint below catches the specific version of that
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

/**
 * Expand `var(--other)` in token values.
 *
 * Tokens referencing tokens is ordinary CSS -- --band-control-hover-bg is
 * defined as var(--band-fill) so the two cannot drift apart -- but every
 * check here reads the raw declaration text, where that is a string rather
 * than a colour. Resolving once, at the point the merged map is built, keeps
 * every assertion below working on real values.
 */
const resolveVars = (map) => {
  const out = {}
  for (const key of Object.keys(map)) {
    let value = map[key]
    for (let depth = 0; depth < 8 && /var\(\s*--/.test(value); depth++) {
      value = value.replace(/var\(\s*(--[\w-]+)\s*(?:,[^)]*)?\)/g, (whole, ref) =>
        (map[ref] === undefined ? whole : map[ref]))
    }
    out[key] = value
  }
  return out
}

const light = resolveVars(readBlock(':root'))
// The dark block only overrides some tokens; the rest inherit from :root.
const dark = resolveVars({ ...light, ...readBlock("[data-theme='dark']") })

const hex = (h) => {
  const m = /^#([0-9a-f]{6})$/i.exec(h.trim())
  assert.ok(m, `expected a 6-digit hex color, got ${JSON.stringify(h)}`)
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

  // Status colors are used both as accent text and as toast fills.
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
const GROUPS = ['added', 'improved', 'fixed', 'removed', 'security']

// The changelog change-group colors. These lived hardcoded in changelog.html
// and so were never covered: seven of the ten theme/group combinations failed
// AA, having been picked for a white card before dark mode existed.
//
// There was briefly a second [data-palette='cvd'] set behind a Colors
// setting. The separation-optimised values are simply the default now.
//
// Every check below runs against every palette, not just the default, because
// palettes tint --surface and --background in dark mode. That tinting is what
// stops each theme rendering as the same gray box, but it also means the group
// colors, the badges and the body text are all sitting on a different
// backdrop per palette. Checking only the default would verify one of sixteen
// combinations and call it done.
//
// The tints are all at or below slate-800's luminance, so in principle these
// ratios can only improve -- but "in principle" is how the 1.01:1 word slots
// happened, so it is measured.
const CONTEXTS = []
for (const { value } of PALETTES) {
  const isDefault = value === DEFAULT_PALETTE
  CONTEXTS.push([
    `${value}/light`,
    isDefault ? light : resolveVars({ ...light, ...readBlock(`[data-palette='${value}']`) }),
  ])
  CONTEXTS.push([
    `${value}/dark`,
    isDefault ? dark : resolveVars({ ...dark, ...readBlock(`[data-theme='dark'][data-palette='${value}']`) }),
  ])
}

for (const [name, tokens] of CONTEXTS) {
  test(`changelog group colors meet WCAG AA in ${name}`, () => {
    for (const g of GROUPS) {
      const token = `--group-${g}`
      assert.ok(tokens[token], `${token} missing in ${name}`)
      const ratio = contrast(tokens[token], tokens['--surface'])
      assert.ok(
        ratio >= 4.5,
        `${name}: ${token} is ${ratio.toFixed(2)}:1 on --surface, needs 4.5:1`,
      )
    }
  })

  test(`${name} meets WCAG AA for every token pair`, () => {
    for (const [fg, bg, min] of PAIRS) {
      assert.ok(tokens[fg], `${fg} missing in ${name}`)
      assert.ok(tokens[bg], `${bg} missing in ${name}`)
      const ratio = contrast(tokens[fg], tokens[bg])
      assert.ok(
        ratio >= min,
        `${name}: ${fg} on ${bg} is ${ratio.toFixed(2)}:1, needs ${min}:1`,
      )
    }
  })

  test(`${name} badge pairs meet WCAG AA`, () => {
    for (const b of BADGES) {
      const fg = `--badge-${b}-fg`
      const bg = `--badge-${b}-bg`
      assert.ok(tokens[fg] && tokens[bg], `${b} badge missing in ${name}`)
      const ratio = contrast(tokens[fg], tokens[bg])
      assert.ok(
        ratio >= 4.5,
        `${name}: ${b} badge is ${ratio.toFixed(2)}:1, needs 4.5:1`,
      )
    }
  })
}

// Left to the browser, the focus ring was inconsistent -- measured at 0.67px on
// some controls and 2px on others, in colors that vary by browser. A sub-pixel
// ring is easy to miss (WCAG 2.4.7). The contrast of --border-focus itself is
// asserted in the pair table above; this pins the ring's existence and weight.
test('a global focus ring is defined at a visible weight', () => {
  const rule = CSS.match(/:where\([^)]*\):focus-visible\s*\{([^}]*)\}/)
  assert.ok(rule, 'tokens.css should define a global :focus-visible ring')
  const body = rule[1]
  const width = body.match(/outline:\s*(\d+(?:\.\d+)?)px/)
  assert.ok(width, 'the ring should set an explicit outline width')
  assert.ok(
    parseFloat(width[1]) >= 2,
    `focus ring is ${width[1]}px; 2px is the minimum that reads reliably`,
  )
  assert.match(body, /var\(--border-focus\)/, 'the ring should use the verified token')
  assert.match(body, /outline-offset/, 'the ring needs an offset to clear the control edge')
})

// Accent palettes. Each swaps --primary and friends, so each has to clear the
// same bar the default does. The list comes from src/palettes.js, so a palette
// added to tokens.css but not the manifest is invisible here -- which is why
// the manifest is also checked against the stylesheet below.
const PALETTE_PAIRS = [
  ['--on-primary', '--primary', 4.5],
  ['--on-primary', '--primary-dark', 4.5],
  ['--primary', '--surface', 4.5],
  ['--border-focus', '--surface', 3.0],
  ['--border-focus', '--background', 3.0],
]

for (const { value } of PALETTES) {
  if (value === DEFAULT_PALETTE) continue // the bare :root, covered above
  const pLight = resolveVars({ ...light, ...readBlock(`[data-palette='${value}']`) })
  const pDark = resolveVars({ ...dark, ...readBlock(`[data-theme='dark'][data-palette='${value}']`) })
  for (const [themeName, tokens] of [['light', pLight], ['dark', pDark]]) {
    test(`the ${value} palette meets WCAG AA in ${themeName}`, () => {
      for (const [fg, bg, min] of PALETTE_PAIRS) {
        const ratio = contrast(tokens[fg], tokens[bg])
        assert.ok(
          ratio >= min,
          `${value}/${themeName}: ${fg} on ${bg} is ${ratio.toFixed(2)}:1, needs ${min}:1`,
        )
      }
    })
  }
}

test('every palette in tokens.css is declared in the manifest', () => {
  // Otherwise a palette can be added to the stylesheet, be selectable by
  // hand-editing localStorage, and be covered by nothing above.
  const declared = new Set(PALETTES.map((p) => p.value))
  const inCss = new Set([...CSS.matchAll(/\[data-palette='([\w-]+)'\]/g)].map((m) => m[1]))
  const orphans = [...inCss].filter((v) => !declared.has(v))
  assert.deepEqual(orphans, [], `in tokens.css but not src/palettes.js: ${orphans.join(', ')}`)

  for (const { value } of PALETTES) {
    if (value === DEFAULT_PALETTE) continue
    assert.ok(inCss.has(value), `${value} is in the manifest but has no block in tokens.css`)
  }
})

test('both themes define the same color tokens', () => {
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
// toast sets its color in `.notification` while the background lives in
// `.notification.success`, and the tick is `.checkbox:checked::after` against
// `.checkbox:checked` -- in both cases the two declarations are in separate
// rules. So group rules by their base selector instead: strip pseudo-elements,
// pseudo-classes and modifier classes, then check whether any rule in that
// family sets a themed background while another sets a literal color.
const baseSelector = (sel) =>
  sel
    .trim()
    .split(',')[0]
    .replace(/::[\w-]+/g, '')
    .replace(/:[\w-]+(\([^)]*\))?/g, '')
    .replace(/\.(active|success|error|warning|is-current)\b/g, '')
    .trim()

// The header and footer are bands over --page-gradient, not surfaces, so no
// token pair describes them: the effective background is a scrim composited
// over a gradient stop. They were previously exempt from every check here, on
// the stated grounds that "the gradient is dark in both themes". That was true
// of dark and false of light -- the light gradient was sky-500, and white nav
// links on it measured 2.52:1 against the 4.5:1 they need. An exemption is
// only as good as its reason, and this one was never checked.
//
// So compose the actual stack instead. Both gradient stops are tested, because
// a 135deg gradient puts different colors behind different parts of the band.
const alphaOver = (fg, alpha, bg) => {
  const px = (h) => [1, 3, 5].map((i) => parseInt(h.substr(i, 2), 16))
  const [f, b] = [px(fg), px(bg)]
  return '#' + f.map((c, i) => Math.round(alpha * c + (1 - alpha) * b[i])
    .toString(16).padStart(2, '0')).join('')
}
/** Accepts either `rgba(r, g, b, a)` or a plain `#rrggbb` (alpha 1). */
const rgbaToken = (v) => {
  const asHex = /^#[0-9a-f]{6}$/i.exec(v.trim())
  if (asHex) return { hex: v.trim(), alpha: 1 }
  const m = /rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,\s/]+([\d.]+))?/.exec(v)
  assert.ok(m, `expected an rgba() or #rrggbb value, got ${JSON.stringify(v)}`)
  const hexOf = '#' + m.slice(1, 4).map((n) => (+n).toString(16).padStart(2, '0')).join('')
  return { hex: hexOf, alpha: m[4] === undefined ? 1 : +m[4] }
}
const gradientStops = (v) => [...v.matchAll(/#[0-9a-f]{6}/gi)].map((m) => m[0])

// --header-bg is derived, not chosen: it is the band scrim composited over the
// palette's own first gradient stop, which is what makes the opaque header look
// the way the translucent one did at the top of the page.
//
// Asserting the derivation rather than just the contrast matters, because a
// palette that forgot to declare --header-bg would inherit the default sky
// value -- a perfectly legible color that is simply the wrong one. Every
// contrast check would pass while a violet theme wore a blue header. This also
// catches a gradient edited without updating the header to match.
const BAND_SCRIM = { light: ['#000000', 0.10], dark: ['#ffffff', 0.10] }

for (const { value } of PALETTES) {
  const isDefault = value === DEFAULT_PALETTE
  const pLight = isDefault ? light : resolveVars({ ...light, ...readBlock(`[data-palette='${value}']`) })
  const pDark = isDefault ? dark : resolveVars({ ...dark, ...readBlock(`[data-theme='dark'][data-palette='${value}']`) })

  for (const [themeName, tokens] of [['light', pLight], ['dark', pDark]]) {
    test(`${value}/${themeName} derives --header-bg from its own gradient`, () => {
      const stop = gradientStops(tokens['--page-gradient'])[0]
      const [scrim, alpha] = BAND_SCRIM[themeName]
      const expected = alphaOver(scrim, alpha, stop)
      assert.equal(
        tokens['--header-bg'].toLowerCase(),
        expected.toLowerCase(),
        `${value}/${themeName}: --header-bg is ${tokens['--header-bg']} but its gradient ` +
          `starts at ${stop}, which composites to ${expected}. Either the block is missing ` +
          '--header-bg and inherited someone else\'s, or the gradient changed without it.',
      )
    })

    test(`${value} header and footer text is legible in ${themeName}`, () => {
      const stops = gradientStops(tokens['--page-gradient'])
      assert.equal(stops.length, 2, `expected two gradient stops for ${value}/${themeName}`)

      // The header is position: fixed once it condenses on scroll, so the
      // gradient is NOT what is behind it -- the scrolling content is. It
      // therefore has to be opaque, and this is the assertion that would have
      // caught the white-nav-on-a-white-card case at 1.25:1.
      const headerBg = tokens['--header-bg']
      assert.match(
        headerBg,
        /^#[0-9a-f]{6}$/i,
        `${value}/${themeName}: --header-bg is ${headerBg}; a fixed header must be opaque, ` +
          'or its text sits on whatever happens to scroll underneath',
      )

      // White text at 14px bold is normal-size text under WCAG, so 4.5:1, not
      // the 3:1 large text would get.
      const headerRatio = contrast('#ffffff', headerBg)
      assert.ok(
        headerRatio >= 4.5,
        `${value}/${themeName}: header text is ${headerRatio.toFixed(2)}:1, needs 4.5:1`,
      )

      // The nav links and gear are chips drawn on top of that band.
      const chipRest = rgbaToken(tokens['--band-control-bg'])
      const chipHover = rgbaToken(tokens['--band-control-hover-bg'])
      const chipBorder = rgbaToken(tokens['--band-control-border'])
      for (const [state, fill] of [['resting', chipRest], ['hover', chipHover]]) {
        const bg = alphaOver(fill.hex, fill.alpha, headerBg)
        const textRatio = contrast('#ffffff', bg)
        assert.ok(
          textRatio >= 4.5,
          `${value}/${themeName}: header chip text (${state}) is ${textRatio.toFixed(2)}:1, needs 4.5:1`,
        )
        const border = alphaOver(chipBorder.hex, chipBorder.alpha, headerBg)
        const borderRatio = contrast(border, bg)
        assert.ok(
          borderRatio >= 3.0,
          `${value}/${themeName}: header chip border (${state}) is ${borderRatio.toFixed(2)}:1, needs 3:1`,
        )
      }

      // The docs sidebar is a third thing sitting on the gradient, and it was
      // not covered here: its nav sat in a white-washed panel -- which
      // *lightens* an already-light backdrop under white text -- with the
      // labels drawn straight onto the gradient at 0.6 alpha. That measured
      // 3.16:1 on the default palette. The panel is --header-bg now, and these
      // are the two tokens its text uses.
      const bandText = rgbaToken(tokens['--band-text'])
      const bandDim = rgbaToken(tokens['--band-text-dim'])

      // Nav items: opaque text on the opaque panel.
      const onPanel = contrast(
        alphaOver(bandText.hex, bandText.alpha, headerBg),
        headerBg,
      )
      assert.ok(
        onPanel >= 4.5,
        `${value}/${themeName}: sidebar nav text is ${onPanel.toFixed(2)}:1 on the panel, needs 4.5:1`,
      )

      for (const stop of stops) {
        // The section label has no panel behind it -- it is on the raw gradient.
        const dimOnGradient = contrast(alphaOver(bandDim.hex, bandDim.alpha, stop), stop)
        assert.ok(
          dimOnGradient >= 4.5,
          `${value}/${themeName}: sidebar label over ${stop} is ${dimOnGradient.toFixed(2)}:1, needs 4.5:1`,
        )

        const fs2 = rgbaToken(tokens['--footer-scrim'])
        const footerBg = alphaOver(fs2.hex, fs2.alpha, stop)
        const ft = rgbaToken(tokens['--footer-text'])
        const footerFg = alphaOver(ft.hex, ft.alpha, footerBg)
        const footerRatio = contrast(footerFg, footerBg)
        assert.ok(
          footerRatio >= 4.5,
          `${value}/${themeName}: footer text over ${stop} is ${footerRatio.toFixed(2)}:1, needs 4.5:1`,
        )
      }
    })
  }
}

// A control that draws its own indicator must switch the native one off.
//
// `.checkbox` is an <input type="checkbox"> with a custom tick in
// `:checked::after`, but it never set `appearance: none`, so the browser drew
// its tick too and the two overlapped. This is the absence-of-a-declaration
// class of bug: no color was wrong, so no contrast check could see it.
//
// `:checked` only ever matches a form control, which makes the rule precise --
// if a family styles a checked state and paints a pseudo-element indicator, it
// has taken over rendering and must say so.
// These paths are relative to this file, so every assertion message would
// otherwise start "../". Anchored, because the intent is to strip one leading
// prefix from a known constant -- not to sanitise a path, which is what an
// unanchored replace of "../" looks like to a scanner, and fairly so.
const label = (rel) => rel.replace(/^\.\.\//, '')

test('controls that draw their own indicator disable the native one', () => {
  const sheets = ['../src/style.css', '../src/settings-panel.css', '../src/site-header.css']

  for (const rel of sheets) {
    const text = fs
      .readFileSync(new URL(rel, import.meta.url), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')

    const families = new Map() // base selector -> { checkedIndicator, appearance }
    for (const m of text.matchAll(/(^|\n)([^{}@\n][^{}]*?)\{([^}]*)\}/g)) {
      const selector = m[2].trim()
      const body = m[3]
      const base = baseSelector(selector)
      if (!base) continue
      const entry = families.get(base) || { indicator: null, appearance: false }
      if (/:checked/.test(selector) && /::(after|before)/.test(selector) && /content\s*:/.test(body)) {
        entry.indicator = selector
      }
      if (/(^|[\s;])(-webkit-)?appearance\s*:\s*none/.test(body)) entry.appearance = true
      families.set(base, entry)
    }

    for (const [base, e] of families) {
      if (!e.indicator) continue
      assert.ok(
        e.appearance,
        `${label(rel)}: "${e.indicator}" paints its own indicator, but ` +
          `"${base}" never sets appearance: none, so the browser draws its native ` +
          'control underneath and both are visible',
      )
    }
  }
})

// The toast, with its fill and text tokens read out of the stylesheet rather
// than assumed.
//
// This covers the gap the lints cannot: pairing the wrong two *tokens*. Both
// are valid vars, so no lint flags them, and only the ratio tells you.
//
// The success toast moved from --success to --primary so it follows the
// palette. Dropping the matching `color: var(--on-primary)` turns out to be
// harmless -- --on-status and --on-primary coincide in both themes today, both
// white in light and both near-black in dark -- but that is a fact this test
// establishes, not one to rely on. Point it at a plausible-but-wrong token and
// it fails: --text-secondary on --primary is 1.28:1.
test('the notification toast pairs its fill and text correctly in every palette', () => {
  const css = fs
    .readFileSync(new URL('../src/style.css', import.meta.url), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')

  const ruleFor = (selector) => {
    // Anchored on `{` so `.notification` does not also match `.notification.success`.
    //
    // Every regex metacharacter, not just the dot: escaping one of them and
    // calling it escaped is the shape of a sanitiser that misses. The same
    // expression is already used in controls.test.js and further down this
    // file; this was the one copy that had drifted.
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const re = new RegExp(`(^|\\n)\\s*${escaped}\\s*\\{([^}]*)\\}`)
    const m = re.exec(css)
    assert.ok(m, `${selector} not found in style.css`)
    return m[2]
  }

  const base = ruleFor('.notification')
  const baseColor = /(?:^|[;\s])color:\s*var\((--[\w-]+)\)/.exec(base)
  assert.ok(baseColor, '.notification should set a text color from a token')

  for (const variant of ['success', 'error']) {
    const body = ruleFor(`.notification.${variant}`)
    const bg = /background:\s*var\((--[\w-]+)\)/.exec(body)
    assert.ok(bg, `.notification.${variant} should set its fill from a token`)
    // An override in the variant wins; otherwise the base color applies.
    const own = /(?:^|[;\s])color:\s*var\((--[\w-]+)\)/.exec(body)
    const fgToken = (own || baseColor)[1]

    for (const [name, tokens] of CONTEXTS) {
      const ratio = contrast(tokens[fgToken], tokens[bg[1]])
      assert.ok(
        ratio >= 4.5,
        `${name}: the ${variant} toast puts ${fgToken} on ${bg[1]} at ${ratio.toFixed(2)}:1, ` +
          'needs 4.5:1',
      )
    }
  }
})

test('no stylesheet puts a literal color on a themed fill', () => {
  const sheets = ['../src/style.css', '../src/site-footer.css', '../src/settings-panel.css', '../src/site-header.css']
  const themedBg = /background:\s*var\(--(primary|primary-dark|secondary|success|warning|error)\)/
  // Any literal, not just white: the history warning badge was `color: #000` on
  // `background: var(--warning)`, which the white-only version of this pattern
  // walked straight past.
  // Anchored on a declaration boundary rather than a newline: anchoring on `\n`
  // meant a rule written on one line hid its own violation.
  const literalColor = /(?:^|[\n{;])\s*color:\s*(white|black|#[0-9a-f]{3,8}|rgba?\()/i

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
      if (literalColor.test(body)) entry.literalAt = `${label(rel)} ${m[2].trim()}`
      families.set(base, entry)
    }
  }

  const offenders = [...families.values()]
    .filter((e) => e.bg && e.literalAt)
    .map((e) => e.literalAt)

  assert.deepEqual(
    offenders,
    [],
    `these sit on a themed fill and need --on-primary / --on-status rather than a literal color: ${offenders.join(' | ')}`,
  )
})

// The stronger version of the rule above, and the one that would have caught
// every wave of this bug at once rather than after a user reported it.
//
// A literal color in style.css cannot follow the theme and is invisible to
// every contrast test in this file, because those read tokens.css. That is the
// entire reason the part-of-speech pills sat at 1.01:1 in dark mode, the
// changelog groups failed seven of ten combinations, and the toast sat at
// 1.81:1 -- in each case the color was real, rendered, and untested.
//
// site-header.css and site-footer.css are deliberately exempt: both sit on
// --page-gradient, which is dark in both themes, so their translucent whites
// are correct against a known backdrop rather than an unknown surface. Their
// contrast is fixed by construction, not by the theme.
test('style.css carries no literal colors', () => {
  const text = fs
    .readFileSync(new URL('../src/style.css', import.meta.url), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')

  const offenders = []
  text.split('\n').forEach((line, i) => {
    // Shadows are the one honest exception: a shadow is an alpha wash rather
    // than a color choice, and tokens.css already defines the two in use.
    if (/box-shadow|drop-shadow|text-shadow/.test(line)) return
    const m = line.match(/#[0-9a-fA-F]{3,8}\b|\brgba?\([^)]*\)/)
    if (m) offenders.push(`line ${i + 1}: ${line.trim()}`)
  })

  assert.deepEqual(
    offenders,
    [],
    `every color in style.css must come from a token in tokens.css, so the ` +
      `theme reaches it and the contrast tests above can see it:\n  ${offenders.join('\n  ')}`,
  )
})

// The strength meter's fill sits on a --background track. 1.4.11 wants 3:1
// for meaningful graphics; the first draft used --border as the track and
// --error measured 2.74:1 on it in dark sky. Pin the working combination
// across every palette so a tint change cannot quietly sink it again.
test('the strength meter fill clears 3:1 against its track in every palette', () => {
  for (const [name, tokens] of CONTEXTS) {
    for (const tok of ['--error', '--warning', '--success']) {
      const ratio = contrast(tokens[tok], tokens['--background'])
      assert.ok(
        ratio >= 3,
        `${name}: meter fill ${tok} on --background is ${ratio.toFixed(2)}:1, needs 3:1`,
      )
    }
  }
})

test('the meter CSS actually uses --background as its track', () => {
  const css = fs.readFileSync(new URL('../src/style.css', import.meta.url), 'utf8')
  const rule = /\.entropy-meter \{[^}]*\}/.exec(css)
  assert.ok(rule, '.entropy-meter rule missing')
  assert.match(rule[0], /background: var\(--background\)/,
    'the meter track must be --background — --error on --border fails 3:1 in dark')
})

// ---------------------------------------------------------------------------
// Text painted directly on the page gradient.
//
// The gap that let a 1.28:1 element reach production. Everything above checks
// TOKEN PAIRS -- that --text-secondary clears AA on --surface, and on
// --background, for every palette in both themes. All of it passed. What no
// pair test can know is which pairs actually meet on screen, and `.tabs-desc`
// -- the mode-description strip under the tab grid below 640px -- was
// --text-secondary rendered straight onto the blue band, a pair the design
// never intended and nothing enumerated.
//
// The --band-* tokens already existed for exactly this case, with a comment
// claiming 0.90 alpha is the lowest that clears 4.5:1 on every palette
// gradient. That claim was also untested. Both halves are pinned here: the
// tokens are measured against both gradient stops, and the stylesheets are
// linted so an on-gradient rule cannot reach for a surface-calibrated token.
//
// Finding NEW members of this category needs a browser, since it depends on
// what actually composites where -- test/tools/contrast-audit.js does that.

/**
 * Selectors known to render straight onto --page-gradient, with no card.
 *
 * Maintained by hand, because whether an element ends up on the band depends
 * on what composites where and no amount of CSS parsing settles it. The
 * browser tool is what FINDS new members; this list is what keeps the ones we
 * know about from regressing. Every entry here was a real failure once.
 */
const ON_GRADIENT = [
  { file: '../src/style.css', selector: '.tabs-desc' },       // measured 1.28:1
  { file: '../docs.html', selector: '.sidebar-label' },
  { file: '../changelog.html', selector: '.release-version' },
  { file: '../changelog.html', selector: '.release-date' },   // measured 3.44:1
  { file: '../changelog.html', selector: '.badge-minor' },    // measured 3.98:1
  { file: '../changelog.html', selector: '.badge-patch' },    // measured 3.59:1
  // The vault page's bare children -- everything not inside a card. These
  // only became visible to the audit once the vault was UNLOCKED, which is
  // why an earlier clean sweep of that page proved less than it looked.
  { file: '../src/vault.css', selector: '.vault-nag' },       // measured 1.00:1
  { file: '../src/vault.css', selector: '.vault-foot' },      // measured 1.00:1
  { file: '../src/vault.css', selector: '.vault-filters' },
  { file: '../src/vault.css', selector: '.vault-filter-label' },
  { file: '../src/vault.css', selector: '.vault-group-head' },
  { file: '../src/vault.css', selector: '.link-button' },
  // And the same lesson a second time: the empty state only exists when the
  // vault is unlocked AND has nothing in it, so both earlier sweeps -- locked,
  // then unlocked with entries -- walked straight past it. Measured 1.00:1 in
  // light sky, and failing in dark too (3.69-4.46:1), which is the range that
  // looks fine and is not.
  { file: '../src/vault.css', selector: '.vault-empty' },
]

/** Tokens calibrated against --surface. Using one on the band is the bug. */
const SURFACE_TEXT_TOKENS = ['--text', '--text-secondary', '--text-muted']

for (const { value } of PALETTES) {
  const isDefault = value === DEFAULT_PALETTE
  const pLight = isDefault ? light : resolveVars({ ...light, ...readBlock(`[data-palette='${value}']`) })
  const pDark = isDefault ? dark : resolveVars({ ...dark, ...readBlock(`[data-theme='dark'][data-palette='${value}']`) })

  for (const [themeName, tokens] of [['light', pLight], ['dark', pDark]]) {
    // WCAG 1.4.11: a control needs a 3:1 boundary against what is behind it.
    //
    // --primary IS the page gradient's first stop, so a primary button on the
    // band was painted the identical colour as the band -- measured at
    // 1.00:1 in light sky, with only its white label visible. Every existing
    // check passed: --on-primary on --primary is the pair the design intends
    // and it clears AA comfortably. The pair that mattered was --primary
    // against --page-gradient, which nothing thought to compare because the
    // two are not meant to meet.
    //
    // The fix is the boundary, not the fill: the --band-control-* tokens the
    // header and footer already use. This asserts the border they provide is
    // actually visible on every gradient this site can draw.
    test(`${value}/${themeName} controls on the band have a visible edge`, () => {
      const stops = gradientStops(tokens['--page-gradient'])
      const { hex: colour, alpha } = rgbaToken(tokens['--band-control-border'])
      for (const stop of stops) {
        const composited = alpha < 1 ? alphaOver(colour, alpha, stop) : colour
        const ratio = contrast(composited, stop)
        assert.ok(
          ratio >= 3,
          `${value}/${themeName}: --band-control-border on the gradient stop ${stop} is ` +
            `${ratio.toFixed(2)}:1, needs 3:1 for a control boundary.`,
        )
      }
    })

    test(`${value}/${themeName} band text is legible on the raw gradient`, () => {
      const stops = gradientStops(tokens['--page-gradient'])
      assert.equal(stops.length, 2, `expected two gradient stops for ${value}/${themeName}`)

      // Unlike the header, this text has no scrim under it -- it lands on the
      // gradient itself, so both stops have to carry it.
      for (const tokenName of ['--band-text', '--band-text-dim']) {
        const { hex: colour, alpha } = rgbaToken(tokens[tokenName])
        for (const stop of stops) {
          const composited = alpha < 1 ? alphaOver(colour, alpha, stop) : colour
          const ratio = contrast(composited, stop)
          assert.ok(
            ratio >= 4.5,
            `${value}/${themeName}: ${tokenName} on the gradient stop ${stop} is ` +
              `${ratio.toFixed(2)}:1, needs 4.5:1. The --band-* alphas are the lowest ` +
              'that clear AA on every palette; this palette has a lighter gradient than ' +
              'they were tuned for.',
          )
        }
      }
    })
  }
}

test('nothing on the page gradient uses a surface-calibrated text token', () => {
  for (const { file, selector } of ON_GRADIENT) {
    const source = fs.readFileSync(new URL(file, import.meta.url), 'utf8')
    // Every rule for this selector, including the ones inside media queries.
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const rules = [...source.matchAll(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`, 'g'))]
    assert.ok(rules.length, `${selector} not found in ${file}`)

    const declaring = rules.filter((r) => /(^|[;\s])color\s*:/.test(r[1]))
    assert.ok(
      declaring.length,
      `${selector} sits on the page gradient but never sets a color, so it inherits ` +
        'whatever the cascade hands it — which is how it ended up at 1.28:1',
    )

    for (const rule of declaring) {
      const colour = /(?:^|[;\s])color\s*:\s*([^;]+)/.exec(rule[1])[1].trim()
      for (const bad of SURFACE_TEXT_TOKENS) {
        assert.ok(
          !colour.includes(bad),
          `${file} ${selector} sets color: ${colour}. ${bad} is calibrated against ` +
            '--surface, and this element is on the page gradient — use --band-text or ' +
            '--band-text-dim.',
        )
      }
      assert.match(
        colour,
        /var\(--band-/,
        `${file} ${selector} sets color: ${colour}; on-gradient text must use a ` +
          '--band-* token so the gradient tests above actually cover it',
      )
    }
  }
})

// ---------------------------------------------------------------------------
// Tinted backdrops: a row that is no longer --surface.
//
// The second and third things the rendered audit found, and the same shape of
// mistake as the gradient one. A slot pill paints --badge-*-bg over the card
// and a selected history row paints --focus-tint over it, so text inside
// either is not on --surface any more -- but both kept tokens verified only
// against --surface.

test('slot-pill controls are legible on every tint, at rest and on hover', () => {
  const css = fs.readFileSync(new URL('../src/style.css', import.meta.url), 'utf8')

  // Colour: --error measured 3.28-4.41:1 on the four tints across both themes,
  // failing all eight combinations. Inheriting takes the pill's --badge-*-fg,
  // which is verified against its own --badge-*-bg, so it cannot drift.
  const rest = /\.slot-pill \.slot-arrow,\s*\n\.slot-pill \.slot-remove \{([^}]*)\}/.exec(css)
  assert.ok(rest, '.slot-pill .slot-arrow/.slot-remove rest rule missing')
  assert.match(rest[1], /color:\s*inherit/,
    'pill controls must inherit the pill foreground; --error fails AA on all four tints')

  // Fill: the overlays darken the tint in light and lighten it in dark, so an
  // overlay-filled control is NOT on the tint the badge pair was verified
  // against. That cost light teal its margin at rest (4.26:1) and took it to
  // 3.53:1 on hover. Both states must leave the tint alone.
  assert.match(rest[1], /background:\s*none/,
    'an overlay fill at rest puts the glyph on a backdrop no test verifies')
  const hover = /\.slot-pill \.slot-remove:hover \{([^}]*)\}/.exec(css)
  assert.ok(hover, '.slot-pill .slot-remove:hover rule missing')
  assert.match(hover[1], /background:\s*none/,
    '--overlay-strong on hover took light teal to 3.53:1 and dark amber to 4.38:1')
  assert.match(hover[1], /box-shadow:[^;]*currentColor/,
    'the hover affordance must be a ring, which sits beside the glyph rather than ' +
      'under it and so cannot move the contrast')

  // With no fill, the backdrop is exactly the tint, and this is the guarantee.
  for (const [name, tokens] of CONTEXTS) {
    for (const tint of ['blue', 'teal', 'slate', 'amber']) {
      const ratio = contrast(tokens[`--badge-${tint}-fg`], tokens[`--badge-${tint}-bg`])
      assert.ok(
        ratio >= 4.5,
        `${name}: inheriting on a ${tint} pill gives ${ratio.toFixed(2)}:1, needs 4.5:1`,
      )
    }
  }
})

test('the selected history row keeps its bits figure legible', () => {
  // --focus-tint over --surface lifts the backdrop out from under
  // --text-secondary: 4.00:1 in dark sky, just under the line.
  const css = fs.readFileSync(new URL('../src/style.css', import.meta.url), 'utf8')
  const rule = /\.history-item-active \.history-bits \{([^}]*)\}/.exec(css)
  assert.ok(rule, '.history-item-active .history-bits rule missing')
  assert.match(rule[1], /color:\s*var\(--text\)/,
    'the active row is --focus-tint over --surface, where --text-secondary measures 4.00:1')

  for (const [name, tokens] of CONTEXTS) {
    const { hex: tint, alpha } = rgbaToken(tokens['--focus-tint'])
    const backdrop = alphaOver(tint, alpha, tokens['--surface'])
    const ratio = contrast(tokens['--text'], backdrop)
    assert.ok(
      ratio >= 4.5,
      `${name}: --text on the active history row (${backdrop}) is ${ratio.toFixed(2)}:1`,
    )
  }
})

// ---------------------------------------------------------------------------
// A palette's dark block must restate everything its light block sets.
//
// This is a CSS specificity trap, not an oversight anyone would spot reading
// the file. `[data-palette='slate']` is two attribute selectors; the dark
// theme block `[data-theme='dark']` is one. So for any token the light
// palette block defines and the dark palette block does not, the LIGHT value
// wins in dark mode -- it outranks the theme.
//
// Slate shipped missing --surface, --background, --page-gradient and
// --header-bg, so slate/dark drew dark-theme text on the light slate surface:
// 1.04:1 for the password, 1.16:1 for every label. Not low contrast --
// invisible. Nine palettes happened to restate all four and one did not, and
// nothing in the suite noticed because every check reads the MERGED token map,
// where the leak looks like a deliberate value.
test('every palette overrides in dark whatever it overrides in light', () => {
  for (const { value } of PALETTES) {
    if (value === DEFAULT_PALETTE) continue      // the default lives in :root
    const light = readBlock(`[data-palette='${value}']`)
    const dark = readBlock(`[data-theme='dark'][data-palette='${value}']`)
    const leaking = Object.keys(light).filter((token) => !(token in dark))
    assert.deepEqual(
      leaking, [],
      `[data-palette='${value}'] sets ${leaking.join(', ')} but ` +
        `[data-theme='dark'][data-palette='${value}'] does not. Two attribute ` +
        'selectors beat one, so the LIGHT value wins in dark mode.',
    )
  }
})

// The merged maps every other check uses would have hidden the bug above, so
// this one measures the palette blocks as the CASCADE actually resolves them.
for (const { value } of PALETTES) {
  if (value === DEFAULT_PALETTE) continue
  test(`${value}/dark resolves to dark surfaces, not its light ones`, () => {
    const light = readBlock(`[data-palette='${value}']`)
    const dark = readBlock(`[data-theme='dark'][data-palette='${value}']`)
    // What the browser would actually use: :root, then the dark theme, then
    // the light palette, then the dark palette -- in specificity order.
    const resolved = resolveVars({
      ...light,
      ...readBlock("[data-theme='dark']"),
      ...light,          // two attributes beat one: the light palette wins again
      ...dark,           // unless the dark palette restates it
    })
    const merged = resolveVars({ ...dark })
    for (const token of ['--surface', '--background']) {
      if (!(token in light)) continue
      assert.equal(
        resolved[token], merged[token] ?? resolved[token],
        `${value}/dark ${token} resolves to ${resolved[token]}, its LIGHT value`,
      )
      // And the text has to be legible on whatever it resolved to.
      const ratio = contrast(resolveVars({ ...dark, ...readBlock("[data-theme='dark']") })['--text'], resolved[token])
      assert.ok(ratio >= 4.5,
        `${value}/dark: --text on ${token} (${resolved[token]}) is ${ratio.toFixed(2)}:1`)
    }
  })
}

// ---------------------------------------------------------------------------
// The changelog's Feature badge, which is the one badge that does NOT sit on
// the gradient.
//
// It is deliberately absent from ON_GRADIENT above. The minor and patch badges
// wash into the band -- their text lands on the gradient and that list is what
// checks them. Feature reverses out of it instead: an opaque white chip sits
// between its text and everything behind, so measuring its ink against the
// gradient would be measuring something the eye never sees.
//
// Two different things therefore have to hold, and neither is covered by the
// list. The first attempt at this badge passed no check at all because there
// was no check: --band-text over --band-fill, "the same pair as minor with
// foreground and background swapped, so the same ratio". It measured 1.53:1.
// --band-fill is a translucent wash, so as a FOREGROUND it is 18%-opacity
// black on white. Swapping a pair preserves the ratio only when both are
// opaque, and one was not.

test('band tokens really are theme-independent, which the badge relies on', () => {
  // --band-ink can be a single value only because the band is the same in both
  // themes. If that ever stops being true this badge needs a per-theme ink,
  // and this is the test that says so rather than a comment hoping someone
  // remembers.
  for (const token of ['--band-text', '--band-fill', '--band-ink']) {
    assert.equal(dark[token], light[token],
      `${token} differs between themes; anything reversed out of the band must be revisited`)
  }
})

test('the Security badge is the Feature badge inverted, and just as legible', () => {
  // Same two tokens the other way round, so it inherits the measurement above
  // rather than introducing a colour nothing checks -- and stays neutral under
  // the mono palette without needing its own value.
  const css = fs.readFileSync(new URL('../changelog.html', import.meta.url), 'utf8')
  assert.match(css, /\.badge-security \{ background: var\(--band-ink\); color: var\(--band-text\); \}/,
    'the Security badge must reuse the band ink/chip pair, inverted')
})

test('the Feature badge ink is legible on its own chip', () => {
  const ink = rgbaToken(light['--band-ink'])
  const chip = rgbaToken(light['--band-text'])
  assert.equal(ink.alpha, 1, '--band-ink is a foreground and must be opaque')
  const ratio = contrast(ink.hex, chip.hex)
  assert.ok(ratio >= 4.5,
    `--band-ink on --band-text is ${ratio.toFixed(2)}:1, needs 4.5:1`)
})

for (const { value } of PALETTES) {
  const isDefault = value === DEFAULT_PALETTE
  const pLight = isDefault ? light : resolveVars({ ...light, ...readBlock(`[data-palette='${value}']`) })
  const pDark = isDefault ? dark : resolveVars({ ...dark, ...readBlock(`[data-theme='dark'][data-palette='${value}']`) })

  for (const [themeName, tokens] of [['light', pLight], ['dark', pDark]]) {
    test(`${value}/${themeName} the Feature badge chip is visible against the band`, () => {
      // WCAG 1.4.11: the chip is the boundary that makes the badge readable,
      // so the chip itself has to be distinguishable from what it lands on --
      // the same rule the band's control borders are held to above.
      const { hex: chip, alpha } = rgbaToken(tokens['--band-text'])
      assert.equal(alpha, 1, 'the chip fill must be opaque or the gradient shows through')
      for (const stop of gradientStops(tokens['--page-gradient'])) {
        const ratio = contrast(chip, stop)
        assert.ok(ratio >= 3,
          `${value}/${themeName}: the white chip on gradient stop ${stop} is ` +
            `${ratio.toFixed(2)}:1, needs 3:1`)
      }
    })
  }
}

test('Known limits does not borrow a change-group colour', () => {
  // It shared --group-security for a while, which was invisible until a
  // release carried both a Security group and a Known limits group and the
  // same dot appeared twice in one entry.
  //
  // It is marked by FORM instead: a hollow dot in --text-secondary. That is
  // deliberate rather than lazy. A sixth hue would have to stay separable from
  // the other five under protan, deutan and tritan vision, which is a real
  // budget to spend on a group that is not a change category at all -- it is a
  // different kind of statement about the same release.
  const css = fs.readFileSync(new URL('../changelog.html', import.meta.url), 'utf8')
  const limits = /\.dot-limits \{([^}]*)\}/.exec(css)
  assert.ok(limits, 'the limits dot needs its own rule')
  assert.ok(!/var\(--group-/.test(limits[1]),
    'Known limits must not reuse a change-group colour')
  assert.match(limits[1], /background:\s*none/, 'hollow is what distinguishes it')

  // And nothing still points the old label at it.
  assert.ok(!/class="label-security">Known limits/.test(css),
    'Known limits should use label-limits, not label-security')
})
