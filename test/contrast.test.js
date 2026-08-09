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
const GROUPS = ['added', 'improved', 'fixed', 'removed', 'security']

// The changelog change-group colours. These lived hardcoded in changelog.html
// and so were never covered: seven of the ten theme/group combinations failed
// AA, having been picked for a white card before dark mode existed.
//
// There was briefly a second [data-palette='cvd'] set behind a Colours
// setting. The separation-optimised values are simply the default now.
//
// Every check below runs against every palette, not just the default, because
// palettes tint --surface and --background in dark mode. That tinting is what
// stops each theme rendering as the same grey box, but it also means the group
// colours, the badges and the body text are all sitting on a different
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
    isDefault ? light : { ...light, ...readBlock(`[data-palette='${value}']`) },
  ])
  CONTEXTS.push([
    `${value}/dark`,
    isDefault ? dark : { ...dark, ...readBlock(`[data-theme='dark'][data-palette='${value}']`) },
  ])
}

for (const [name, tokens] of CONTEXTS) {
  test(`changelog group colours meet WCAG AA in ${name}`, () => {
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
// some controls and 2px on others, in colours that vary by browser. A sub-pixel
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
  const pLight = { ...light, ...readBlock(`[data-palette='${value}']`) }
  const pDark = { ...dark, ...readBlock(`[data-theme='dark'][data-palette='${value}']`) }
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

// The header and footer are bands over --page-gradient, not surfaces, so no
// token pair describes them: the effective background is a scrim composited
// over a gradient stop. They were previously exempt from every check here, on
// the stated grounds that "the gradient is dark in both themes". That was true
// of dark and false of light -- the light gradient was sky-500, and white nav
// links on it measured 2.52:1 against the 4.5:1 they need. An exemption is
// only as good as its reason, and this one was never checked.
//
// So compose the actual stack instead. Both gradient stops are tested, because
// a 135deg gradient puts different colours behind different parts of the band.
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
// value -- a perfectly legible colour that is simply the wrong one. Every
// contrast check would pass while a violet theme wore a blue header. This also
// catches a gradient edited without updating the header to match.
const BAND_SCRIM = { light: ['#000000', 0.10], dark: ['#ffffff', 0.10] }

for (const { value } of PALETTES) {
  const isDefault = value === DEFAULT_PALETTE
  const pLight = isDefault ? light : { ...light, ...readBlock(`[data-palette='${value}']`) }
  const pDark = isDefault ? dark : { ...dark, ...readBlock(`[data-theme='dark'][data-palette='${value}']`) }

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
// class of bug: no colour was wrong, so no contrast check could see it.
//
// `:checked` only ever matches a form control, which makes the rule precise --
// if a family styles a checked state and paints a pseudo-element indicator, it
// has taken over rendering and must say so.
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
        `${rel.replace('../', '')}: "${e.indicator}" paints its own indicator, but ` +
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
    const re = new RegExp(`(^|\\n)\\s*${selector.replace(/\./g, '\\.')}\\s*\\{([^}]*)\\}`)
    const m = re.exec(css)
    assert.ok(m, `${selector} not found in style.css`)
    return m[2]
  }

  const base = ruleFor('.notification')
  const baseColour = /(?:^|[;\s])color:\s*var\((--[\w-]+)\)/.exec(base)
  assert.ok(baseColour, '.notification should set a text colour from a token')

  for (const variant of ['success', 'error']) {
    const body = ruleFor(`.notification.${variant}`)
    const bg = /background:\s*var\((--[\w-]+)\)/.exec(body)
    assert.ok(bg, `.notification.${variant} should set its fill from a token`)
    // An override in the variant wins; otherwise the base colour applies.
    const own = /(?:^|[;\s])color:\s*var\((--[\w-]+)\)/.exec(body)
    const fgToken = (own || baseColour)[1]

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

test('no stylesheet puts a literal colour on a themed fill', () => {
  const sheets = ['../src/style.css', '../src/site-footer.css', '../src/settings-panel.css', '../src/site-header.css']
  const themedBg = /background:\s*var\(--(primary|primary-dark|secondary|success|warning|error)\)/
  // Any literal, not just white: the history warning badge was `color: #000` on
  // `background: var(--warning)`, which the white-only version of this pattern
  // walked straight past.
  // Anchored on a declaration boundary rather than a newline: anchoring on `\n`
  // meant a rule written on one line hid its own violation.
  const literalColour = /(?:^|[\n{;])\s*color:\s*(white|black|#[0-9a-f]{3,8}|rgba?\()/i

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

// The stronger version of the rule above, and the one that would have caught
// every wave of this bug at once rather than after a user reported it.
//
// A literal colour in style.css cannot follow the theme and is invisible to
// every contrast test in this file, because those read tokens.css. That is the
// entire reason the part-of-speech pills sat at 1.01:1 in dark mode, the
// changelog groups failed seven of ten combinations, and the toast sat at
// 1.81:1 -- in each case the colour was real, rendered, and untested.
//
// site-header.css and site-footer.css are deliberately exempt: both sit on
// --page-gradient, which is dark in both themes, so their translucent whites
// are correct against a known backdrop rather than an unknown surface. Their
// contrast is fixed by construction, not by the theme.
test('style.css carries no literal colours', () => {
  const text = fs
    .readFileSync(new URL('../src/style.css', import.meta.url), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')

  const offenders = []
  text.split('\n').forEach((line, i) => {
    // Shadows are the one honest exception: a shadow is an alpha wash rather
    // than a colour choice, and tokens.css already defines the two in use.
    if (/box-shadow|drop-shadow|text-shadow/.test(line)) return
    const m = line.match(/#[0-9a-fA-F]{3,8}\b|\brgba?\([^)]*\)/)
    if (m) offenders.push(`line ${i + 1}: ${line.trim()}`)
  })

  assert.deepEqual(
    offenders,
    [],
    `every colour in style.css must come from a token in tokens.css, so the ` +
      `theme reaches it and the contrast tests above can see it:\n  ${offenders.join('\n  ')}`,
  )
})
