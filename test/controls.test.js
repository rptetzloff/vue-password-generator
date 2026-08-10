import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

// Two WCAG failures that shipped for a long time, and the checks that would
// have caught them. Both were found by measuring the running site rather than
// by reading the CSS, which is why they lasted: nothing in the stylesheet
// looked wrong.

const STYLE = fs
  .readFileSync(new URL('../src/style.css', import.meta.url), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '')
const TOKENS = fs.readFileSync(new URL('../src/tokens.css', import.meta.url), 'utf8')

/** The declarations of a rule, by exact selector. */
const ruleBody = (selector) => {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const m = new RegExp(`(^|\\n)\\s*${escaped}\\s*\\{([^}]*)\\}`).exec(STYLE)
  assert.ok(m, `${selector} not found in style.css`)
  return m[2]
}

test('--control-min is at least the 24px WCAG 2.2 SC 2.5.8 requires', () => {
  const m = /--control-min:\s*([\d.]+)rem/.exec(TOKENS)
  assert.ok(m, 'tokens.css should define --control-min')
  // rem here is the browser default of 16px; the site never overrides the root
  // size downward, only up via the text-size setting.
  const px = parseFloat(m[1]) * 16
  assert.ok(px >= 24, `--control-min is ${px}px, below the 24px minimum`)
})

// Each of these measured under 24x24 in a live browser: the slider thumb and
// the checkboxes at 20, the slot arrows and remove buttons at 22. They must
// size from the token rather than from a literal, so raising the token raises
// all of them at once.
const SIZED_FROM_TOKEN = [
  '.slider',
  '.slider::-webkit-slider-thumb',
  '.slider::-moz-range-thumb',
  '.checkbox',
  '.radio',
  '.slot-arrow,\n.slot-remove',
]

for (const selector of SIZED_FROM_TOKEN) {
  test(`${selector.replace(/\n/g, ' ')} sizes from --control-min`, () => {
    const body = ruleBody(selector)
    const dims = [...body.matchAll(/(?:^|\s)(width|height):\s*([^;]+);/g)]
    assert.ok(dims.length > 0, `${selector} should declare a width or height`)
    for (const [, prop, value] of dims) {
      assert.match(
        value.trim(),
        /var\(--control-min\)/,
        `${selector} sets ${prop}: ${value.trim()}; it must use var(--control-min) so the ` +
          '24px floor applies',
      )
    }
  })
}

test('the slider has a focus ring, and does not suppress the global one', () => {
  // `.slider { outline: none }` is (0,1,0), the same specificity as the global
  // :where(...):focus-visible rule in tokens.css. style.css loads second, so it
  // won on source order and the sliders had no focus indicator at all.
  const base = ruleBody('.slider')
  assert.doesNotMatch(
    base,
    /outline:\s*none/,
    '.slider must not set outline: none -- it ties with the global focus ring on ' +
      'specificity and beats it on source order, leaving no indicator (WCAG 2.4.7)',
  )

  const focus = ruleBody('.slider:focus-visible')
  const width = /outline:\s*(\d+(?:\.\d+)?)px/.exec(focus)
  assert.ok(width, '.slider:focus-visible should set an explicit outline width')
  assert.ok(parseFloat(width[1]) >= 2, `slider focus ring is ${width[1]}px; 2px is the minimum`)
  assert.match(focus, /var\(--border-focus\)/, 'the ring should use the verified token')
})

test('no control in style.css suppresses its focus outline', () => {
  // The general form of the bug above. A control that hides its outline must
  // put something visible back, and none currently need to.
  const offenders = []
  for (const m of STYLE.matchAll(/(^|\n)([^{}@\n][^{}]*?)\{([^}]*)\}/g)) {
    const selector = m[2].trim()
    if (!/outline:\s*none/.test(m[3])) continue
    // A rule that removes the outline and immediately supplies its own ring is
    // fine; nothing here does that today, so any match is a regression.
    offenders.push(selector)
  }
  assert.deepEqual(
    offenders,
    [],
    `these suppress the focus outline: ${offenders.join(', ')}. Removing the ring without ` +
      'replacing it is WCAG 2.4.7.',
  )
})
