import test from 'node:test'
import assert from 'node:assert/strict'
import { shouldCondense, CONDENSE_AT, EXPAND_AT } from '../ui/site-header.js'

// The header shrinks once scrolled so it stops eating the viewport. It is
// position: fixed with a spacer holding its expanded height, so condensing
// changes no layout -- which is why this decision is only a scroll threshold.

const base = { small: false, scrollY: 0, condensed: false }
const at = (o) => shouldCondense({ ...base, ...o })

test('condenses once scrolled past the threshold', () => {
  assert.equal(at({ scrollY: 0 }), false)
  assert.equal(at({ scrollY: CONDENSE_AT }), false, 'the threshold itself is not past it')
  assert.equal(at({ scrollY: CONDENSE_AT + 1 }), true)
})

test('small screens condense regardless of scroll position', () => {
  assert.equal(at({ small: true, scrollY: 0 }), true)
})

// Hysteresis keeps jitter around the boundary from fluttering the class.
test('hysteresis holds the state through jitter near the boundary', () => {
  const condensed = { condensed: true }
  assert.equal(at({ ...condensed, scrollY: 57 }), true, 'just under the condense point must not expand it')
  assert.equal(at({ ...condensed, scrollY: EXPAND_AT }), true, 'the lower threshold still holds')
  assert.equal(at({ ...condensed, scrollY: EXPAND_AT - 1 }), false, 'below it, expand')
})

test('expanding requires less scroll than condensing', () => {
  assert.ok(EXPAND_AT < CONDENSE_AT, 'expanding must need less scroll than condensing')
})

