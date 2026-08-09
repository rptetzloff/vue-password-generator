import test from 'node:test'
import assert from 'node:assert/strict'
import { randInt, randPick, randBool, randChar, DIGITS, SPECIAL_CHARS } from '../src/lib.js'

test('randInt stays within [0, max)', () => {
  for (const n of [2, 3, 7, 10, 26, 62, 91]) {
    for (let i = 0; i < 2000; i++) {
      const v = randInt(n)
      assert.ok(Number.isInteger(v), `${v} is not an integer`)
      assert.ok(v >= 0 && v < n, `${v} out of range for max=${n}`)
    }
  }
})

test('randInt handles degenerate maxima', () => {
  assert.equal(randInt(1), 0)
  assert.equal(randInt(0), 0)
  assert.equal(randInt(-5), 0)
})

test('randInt reaches every value in its range', () => {
  const n = 26
  const seen = new Set()
  for (let i = 0; i < 20000; i++) seen.add(randInt(n))
  assert.equal(seen.size, n, `only hit ${seen.size} of ${n} values`)
})

// Guards the rejection-sampling branch directly by stubbing the CSPRNG.
//
// For max=3 the acceptance limit is floor(2^32 / 3) * 3 = 4294967295, so the
// single value 0xFFFFFFFF must be rejected and re-drawn. A `% max`
// implementation would accept it and return 0. Statistical tests cannot catch
// this: with a 32-bit source the real modulo bias is ~1 part in 10^8 and is
// invisible at any practical sample size, so this stub is the only honest way
// to prove the tail is actually discarded.
test('randInt rejects the ragged tail instead of taking it modulo', () => {
  const real = globalThis.crypto.getRandomValues.bind(globalThis.crypto)
  const queue = [0xffffffff, 7]
  let draws = 0
  globalThis.crypto.getRandomValues = (buf) => {
    buf[0] = queue[draws] ?? 0
    draws++
    return buf
  }
  try {
    const v = randInt(3)
    assert.equal(draws, 2, 'should have re-drawn after the out-of-range value')
    assert.equal(v, 1, '7 % 3 === 1; got the rejected draw instead')
  } finally {
    globalThis.crypto.getRandomValues = real
  }
})

// Catches gross breakage -- a stuck value, an off-by-one, a truncated pool.
// The bound is deliberately loose: chi-square above 3x the degrees of freedom
// has probability ~1e-14, so this will not flake, while a genuinely broken
// distribution blows well past it.
test('randInt is close to uniform', () => {
  for (const n of [3, 10, 26]) {
    const counts = new Array(n).fill(0)
    const N = 60000
    for (let i = 0; i < N; i++) counts[randInt(n)]++
    const expected = N / n
    const chi2 = counts.reduce((s, c) => s + ((c - expected) ** 2) / expected, 0)
    assert.ok(chi2 < 3 * (n - 1), `chi2=${chi2.toFixed(1)} too high for n=${n}`)
  }
})

test('randChar returns a character from the given string', () => {
  for (const pool of [DIGITS, SPECIAL_CHARS, 'abc']) {
    for (let i = 0; i < 500; i++) {
      assert.ok(pool.includes(randChar(pool)))
    }
  }
})

test('randChar covers the whole pool', () => {
  const seen = new Set()
  for (let i = 0; i < 5000; i++) seen.add(randChar(DIGITS))
  assert.equal(seen.size, DIGITS.length)
})

test('randPick returns a member of the array', () => {
  const arr = ['a', 'b', 'c', 'd']
  const seen = new Set()
  for (let i = 0; i < 2000; i++) {
    const v = randPick(arr)
    assert.ok(arr.includes(v))
    seen.add(v)
  }
  assert.equal(seen.size, arr.length)
})

test('randBool produces both values at roughly even odds', () => {
  let trues = 0
  const N = 20000
  for (let i = 0; i < N; i++) if (randBool()) trues++
  assert.ok(trues > N * 0.45 && trues < N * 0.55, `${trues}/${N} is skewed`)
})
