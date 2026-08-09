import test from 'node:test'
import assert from 'node:assert/strict'
import { shouldCondense, CONDENSE_AT, EXPAND_AT } from '../src/site-header.js'

// The sticky header shrinks once scrolled so it stops eating the viewport.
// These rules exist to stop it flickering, which is hard to observe from
// automation: requestAnimationFrame is paused while a tab is hidden, so a
// scroll-driven check cannot be verified reliably in a browser.

const base = { small: false, scrollY: 0, scrollable: 2000, headerHeight: 152, condensed: false }
const at = (o) => shouldCondense({ ...base, ...o })

test('condenses once scrolled past the threshold', () => {
  assert.equal(at({ scrollY: 0 }), false)
  assert.equal(at({ scrollY: CONDENSE_AT }), false, 'the threshold itself is not past it')
  assert.equal(at({ scrollY: CONDENSE_AT + 1 }), true)
})

test('small screens condense regardless of scroll position', () => {
  assert.equal(at({ small: true, scrollY: 0 }), true)
  assert.equal(at({ small: true, scrollY: 0, scrollable: 0 }), true)
})

// Measured on about.html before the fix: the class changed every frame, with
// scrollY bouncing 70 -> 57 -> 14 -> 39 as the shortened page clamped the
// scroll position back and forth across a single threshold.
test('hysteresis keeps it condensed through a small upward clamp', () => {
  const condensed = { condensed: true }
  assert.equal(at({ ...condensed, scrollY: 57 }), true, 'a clamp to 57 must not expand it')
  assert.equal(at({ ...condensed, scrollY: EXPAND_AT }), true, 'the lower threshold still holds')
  assert.equal(at({ ...condensed, scrollY: EXPAND_AT - 1 }), false, 'below it, expand')
})

test('the two thresholds cannot both be crossed by one clamp', () => {
  assert.ok(EXPAND_AT < CONDENSE_AT, 'expanding must need less scroll than condensing')
})

test('a page with too little scroll room never condenses', () => {
  // Condensing gives back roughly the header's height. If the page cannot
  // absorb that, condensing would clamp the scroll and immediately undo itself.
  const tight = { scrollable: 100, headerHeight: 152, scrollY: 90 }
  assert.equal(at(tight), false)
  assert.equal(at({ ...tight, condensed: true }), false, 'and it un-condenses if room disappears')
})

test('room is judged against the header height, not a fixed number', () => {
  const tall = { headerHeight: 300, scrollY: 200 }
  assert.equal(at({ ...tall, scrollable: 300 }), false, '300 is not more than 300 + 64')
  assert.equal(at({ ...tall, scrollable: 400 }), true)
})
