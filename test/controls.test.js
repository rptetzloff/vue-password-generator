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
const TOKENS = fs.readFileSync(new URL('../ui/tokens.css', import.meta.url), 'utf8')

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

// The three controls overlaid on the password output field: copy, keep, and
// the character-count pill.
//
// They were positioned by hand, in three separate edits, and the third one
// collided. Keep (9a) was given `right: 2.6rem` while the length pill already
// sat at `right: 2.75rem` -- two 2rem-wide controls whose left edges landed on
// the same pixel. Rendered, it looked like one corrupt glyph, and that is how
// it was reported: "what is this icon?".
//
// Nothing about either declaration looked wrong on its own, which is the whole
// problem with hand-placed absolute positions. They derive from shared
// variables now, and this asserts they still do.
test('the controls overlaid on the password field cannot collide', () => {
  const vars = ruleBody('.password-display')
  for (const name of ['--pw-edge', '--pw-btn', '--pw-slot']) {
    // `\\s`, not `\s`: inside a template literal a lone backslash collapses,
    // so `\s*` reached the RegExp as `s*` -- zero or more literal letter s.
    // It passed only because the CSS has no space before the colon, which is
    // an assertion holding by luck rather than by what it says.
    assert.match(vars, new RegExp(`${name}\\s*:`),
      `.password-display must define ${name}; the overlay positions derive from it`)
  }

  // Each control's offset must be computed, not a literal, or it can drift
  // back on top of its neighbour.
  const positioned = {
    '.password-display .copy-btn': /right:\s*var\(--pw-edge\)/,
    '.password-display .keep-btn': /right:\s*calc\(.*--pw-btn/,
    '.password-display .length-pill': /right:\s*calc\(.*--pw-btn/,
  }
  for (const [selector, pattern] of Object.entries(positioned)) {
    assert.match(ruleBody(selector), pattern,
      `${selector} must derive its offset from the --pw-* variables, not a literal rem`)
  }

  // And the text has to stop before the leftmost of them.
  assert.match(
    ruleBody('.password-display .password-input.has-length-pill'),
    /padding-right:\s*calc\(.*--pw-btn/,
    'the field padding must track the overlay width, or long output runs under the pill',
  )
})

test('the overlay controls tile without overlapping, at the declared sizes', () => {
  // Arithmetic on the same numbers the CSS uses: each control occupies
  // [right, right + width] measured from the field's right edge, and no two
  // spans may intersect.
  const num = (name) => {
    const m = new RegExp(`${name}\\s*:\\s*([\\d.]+)rem`).exec(ruleBody('.password-display'))
    assert.ok(m, `${name} should be a rem value`)
    return parseFloat(m[1])
  }
  const edge = num('--pw-edge')
  const btn = num('--pw-btn')
  const slot = num('--pw-slot')

  const spans = [
    ['copy', edge, edge + btn],
    ['keep', edge + btn + slot, edge + 2 * btn + slot],
    // The pill's width varies with the digit count; 2.6rem covers three digits.
    ['pill', edge + 2 * (btn + slot), edge + 2 * (btn + slot) + 2.6],
  ]
  for (let i = 1; i < spans.length; i++) {
    const [prevName, , prevEnd] = spans[i - 1]
    const [name, start] = spans[i]
    assert.ok(start >= prevEnd,
      `${name} starts at ${start}rem but ${prevName} runs to ${prevEnd}rem — they overlap`)
  }
})

// An absolutely positioned dropdown resolves against its nearest POSITIONED
// ancestor, not its markup parent. The tag menu reused every
// .vault-groupmenu-* child class but its own wrapper was a new class, so it
// inherited the styling and not the `position: relative` that made the
// styling work -- and its panel rendered near the top of the document,
// hundreds of pixels from the button that opened it. Nothing about either
// file looks wrong on its own; the bug lives in the gap between them.
test('every dropdown wrapper is a positioning context', () => {
  const css = fs
    .readFileSync(new URL('../src/vault.css', import.meta.url), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
  // The markup moved to src/templates/vault/ when templates were
  // precompiled; the component file is logic only now.
  const app = fs.readFileSync(new URL('../src/templates/vault/App.html', import.meta.url), 'utf8')

  // The wrappers are whatever the template actually uses, so a third menu is
  // covered the day it is added rather than the day it is noticed.
  const wrappers = new Set()
  // Any element whose class list contains a vault-*menu, wherever it sits.
  // This was scoped to `class="vault-filter vault-*menu"`, which quietly
  // stopped covering new menus the moment one appeared outside the filter row
  // -- and a menu with no positioning context renders at the top of the page,
  // which is the bug this test exists for.
  for (const m of app.matchAll(/(?:^|[\s"])(vault-[a-z]+menu)(?=[\s"])/g)) wrappers.add(m[1])
  assert.ok(wrappers.size >= 3, 'expected the group, tag and generator menus to be found in the template')

  const positioned = new Set()
  for (const m of css.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
    if (!/position:\s*(relative|absolute|fixed|sticky)/.test(m[2])) continue
    for (const sel of m[1].split(',')) positioned.add(sel.trim())
  }
  for (const w of wrappers) {
    assert.ok(positioned.has(`.${w}`),
      `.${w} holds an absolutely positioned panel but is not itself positioned`)
  }
})

test('the blocked screen has a way out that is not clearing site data', () => {
  // A folder that is gone for good -- a deleted directory, a machine that is
  // not this one -- used to leave the only exit as clearing site data, because
  // the screen offered nothing but "reconnect" to a folder that was never
  // coming back. Asserted against the template rather than the running page
  // because reaching the state needs a real revoked handle, which no browser
  // will hand out on request.
  // The markup moved to src/templates/vault/ when templates were
  // precompiled; the component file is logic only now.
  const app = fs.readFileSync(new URL('../src/templates/vault/App.html', import.meta.url), 'utf8')
  const blocked = app.slice(
    app.indexOf(`state === 'blocked'`),
    app.indexOf(`state === 'absent'`),
  )
  assert.ok(blocked.length > 200, 'the blocked section should have been found')
  assert.match(blocked, /@click="disconnectFolder"/,
    'the blocked screen must offer a way to let go of the folder')
  assert.ok(!/@click="destroy"/.test(blocked),
    'and never a delete, since the vault it would delete is the one it cannot read')
})

test('letting go of a folder is offered wherever a folder is in use', () => {
  // Two places, and they are not interchangeable: the settings panel is the
  // deliberate "I am done with this machine", the blocked screen is the
  // escape. Missing either one leaves someone stuck.
  // The markup moved to src/templates/vault/ when templates were
  // precompiled; the component file is logic only now.
  const app = fs.readFileSync(new URL('../src/templates/vault/App.html', import.meta.url), 'utf8')
  const uses = [...app.matchAll(/@click="disconnectFolder"/g)]
  assert.equal(uses.length, 2, 'expected it on the blocked screen and in the location panel')
})

test('the way out of a blocked folder is never behind the folder-support gate', () => {
  // Gating folder storage off on mobile must not strand anyone who already
  // moved a vault there. The blocked screen is what they land on at every
  // launch, and its two exits -- reconnect, or let go of the folder -- have to
  // work on exactly the platform where the feature is no longer offered.
  const app = fs.readFileSync(new URL('../src/templates/vault/App.html', import.meta.url), 'utf8')
  const start = app.indexOf("state === 'blocked'")
  assert.ok(start > 0, 'the blocked screen should exist')
  const end = app.indexOf("state === 'absent'", start)
  const blocked = app.slice(start, end)

  assert.match(blocked, /@click="reconnectFolder"/)
  assert.match(blocked, /@click="disconnectFolder"/)
  assert.ok(!/v-if="canFolder"/.test(blocked),
    'the blocked screen must not be conditional on folder support being offered')
})
