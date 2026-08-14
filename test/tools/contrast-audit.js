// Rendered-page contrast audit -- a browser tool, not a Node test.
//
// Why this exists alongside test/contrast.test.js, which already checks WCAG
// AA exhaustively: that suite checks TOKEN PAIRS. It proves --text-secondary
// clears AA on --surface, and on --background, for all ten palettes in both
// themes. What it cannot know is which pairs actually meet on screen.
//
// The gap is real and it shipped. `.tabs-desc` -- the one-line mode
// description that appears under the tab grid below 640px -- is coloured
// --text-secondary, a token verified against --surface, but it is rendered
// directly on the page gradient because it sits outside any card. 71,85,105
// on the blue band is 1.25:1. Every token test passed. It was in production.
//
// So this measures the composite instead of the intent: walk every rendered
// text node, climb its ancestors compositing translucent backgrounds until
// something opaque is found, and compare against that. It needs a real
// browser, which is why it is a tool you point at a running page rather than
// something `npm test` can run.
//
// Usage, from a browser console or an automation harness:
//
//   const { auditContrast } = await import('/test/tools/contrast-audit.js')
//   auditContrast()
//
// Findings come in two kinds:
//
//   fail      measured, and below the threshold. A bug.
//   gradient  the backdrop is a gradient, so a single ratio is meaningless.
//             Reported rather than measured, because "text on the page
//             gradient" is exactly the category that produced the bug above.
//             Anything landing here needs a deliberate on-gradient colour,
//             not a surface-calibrated token.

const parseColor = (value) => {
  const m = value.match(/rgba?\(([^)]+)\)/)
  if (!m) return null
  const parts = m[1].split(/[\s,/]+/).filter(Boolean).map(Number)
  return { r: parts[0], g: parts[1], b: parts[2], a: parts.length > 3 ? parts[3] : 1 }
}

const over = (fg, bg) => ({
  r: fg.r * fg.a + bg.r * (1 - fg.a),
  g: fg.g * fg.a + bg.g * (1 - fg.a),
  b: fg.b * fg.a + bg.b * (1 - fg.a),
  a: 1,
})

const luminance = ({ r, g, b }) => {
  const channel = (v) => {
    const s = v / 255
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4)
  }
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)
}

const contrast = (a, b) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

/** A short, readable selector for pointing a human at the element. */
const describe = (el) => {
  if (!el) return '?'
  const bits = []
  let node = el
  for (let i = 0; node && i < 3; i++, node = node.parentElement) {
    let s = node.tagName.toLowerCase()
    if (node.id) { bits.unshift(`${s}#${node.id}`); break }
    if (typeof node.className === 'string' && node.className.trim()) {
      s += '.' + node.className.trim().split(/\s+/).slice(0, 2).join('.')
    }
    bits.unshift(s)
  }
  return bits.join(' > ')
}

/** Every colour stop in a linear/radial-gradient declaration. */
const gradientStops = (backgroundImage) => {
  const found = []
  for (const m of backgroundImage.matchAll(/rgba?\([^)]+\)|#[0-9a-f]{6}\b/gi)) {
    const raw = m[0]
    if (raw[0] === '#') {
      found.push({
        r: parseInt(raw.slice(1, 3), 16),
        g: parseInt(raw.slice(3, 5), 16),
        b: parseInt(raw.slice(5, 7), 16),
        a: 1,
      })
    } else {
      const c = parseColor(raw)
      if (c && c.a > 0) found.push(c)
    }
  }
  return found
}

/**
 * The colours actually painted behind an element -- plural, because a gradient
 * has more than one.
 *
 * Climbs ancestors stacking translucent backgrounds until it reaches something
 * opaque. Reaching a gradient does NOT end the measurement: each of its stops
 * is a real backdrop that some part of the element sits on, so the stack is
 * composited over every stop and the caller takes the worst. An earlier
 * version bailed out here and reported "gradient, unknown", which quietly
 * excused exactly the cases most likely to be wrong -- the changelog's release
 * dates and badges are translucent white on the band, and went unmeasured.
 */
const backdropsOf = (el) => {
  const stack = []
  let node = el
  while (node) {
    const cs = getComputedStyle(node)
    const bg = parseColor(cs.backgroundColor)
    if (bg && bg.a > 0) stack.push(bg)
    if (bg && bg.a === 1) {
      return { colors: [stack.reduceRight((acc, c) => over(c, acc))], gradient: false }
    }
    if (cs.backgroundImage && cs.backgroundImage !== 'none') {
      const stops = gradientStops(cs.backgroundImage)
      if (stops.length) {
        return {
          colors: stops.map((stop) => stack.reduceRight((acc, c) => over(c, acc), stop)),
          gradient: true,
          on: node,
        }
      }
      // An image rather than a gradient: nothing numeric to measure against.
      return { colors: [], gradient: true, unmeasurable: true, on: node }
    }
    node = node.parentElement
  }
  // Nothing opaque anywhere: the canvas, which the UA paints white.
  const canvas = { r: 255, g: 255, b: 255, a: 1 }
  return { colors: [stack.reduceRight((acc, c) => over(c, acc), canvas)], gradient: false }
}

/** WCAG 1.4.3: 24px, or 18.66px at bold or heavier, is "large text" at 3:1. */
const thresholdFor = (px, weight) => (px >= 24 || (px >= 18.66 && weight >= 700) ? 3 : 4.5)

/**
 * Freeze transitions for the duration of a measurement.
 *
 * getComputedStyle reports the CURRENT animated value, so a run that starts
 * while a colour is transitioning measures a colour that exists only for a
 * few frames. Worse, a page that is not compositing -- a background tab, or
 * an automation harness whose viewport is not displayed -- never advances a
 * transition at all, so the reported value stays pinned at the start value
 * indefinitely. That produced a confident 1.93:1 report against `.tab-name`
 * which was pure fiction: the tab had simply not repainted since the theme
 * flipped, so it was still wearing the light theme's text colour.
 */
const withoutTransitions = (fn) => {
  const style = document.createElement('style')
  style.textContent =
    '*, *::before, *::after { transition: none !important; animation: none !important; }'
  document.head.appendChild(style)
  // Force a style recalc so the frozen values are what we read.
  void document.body.offsetHeight
  try {
    return fn()
  } finally {
    style.remove()
  }
}

export const auditContrast = (options = {}) => withoutTransitions(() => measure(options))

const measure = ({ root = document.body } = {}) => {
  const findings = []
  const seen = new Set()
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)

  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const text = n.nodeValue.trim()
    if (!text) continue
    const el = n.parentElement
    if (!el || seen.has(el)) continue
    seen.add(el)

    const cs = getComputedStyle(el)
    if (cs.visibility === 'hidden' || cs.display === 'none' || cs.opacity === '0') continue
    const rect = el.getBoundingClientRect()
    if (!rect.width || !rect.height) continue

    const fg = parseColor(cs.color)
    if (!fg || fg.a === 0) continue

    const size = parseFloat(cs.fontSize)
    const weight = parseInt(cs.fontWeight, 10) || 400
    const need = thresholdFor(size, weight)
    const backdrop = backdropsOf(el)

    if (backdrop.unmeasurable) {
      findings.push({
        kind: 'unmeasurable',
        text: text.slice(0, 45),
        selector: describe(el),
        color: cs.color,
        reason: `sits on a background-image at ${describe(backdrop.on)}`,
      })
      continue
    }

    // The worst stop is the one that decides: text has to be legible along the
    // whole band, not on average.
    let worst = null
    for (const back of backdrop.colors) {
      const composited = fg.a < 1 ? over(fg, back) : fg
      const ratio = contrast(composited, back)
      if (!worst || ratio < worst.ratio) worst = { ratio, back }
    }
    if (worst && worst.ratio < need) {
      const { r, g, b } = worst.back
      findings.push({
        kind: 'fail',
        text: text.slice(0, 45),
        selector: describe(el),
        ratio: +worst.ratio.toFixed(2),
        need,
        size,
        weight,
        color: cs.color,
        backdrop: `rgb(${[r, g, b].map(Math.round).join(', ')})`,
        onGradient: backdrop.gradient || undefined,
      })
    }
  }
  return findings
}

export default auditContrast
