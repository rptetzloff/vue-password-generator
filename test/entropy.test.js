import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import {
  log2Multinomial, tokenBits, suffixBits, capitalizationBits,
  simpleBits, advancedBits, wordsBits, slotBits, alliterationSlotParts,
  numbersSurprisal, numbersBits, ENTROPY_FLOOR,
} from '../src/entropy.js'

// The entropy display is only worth shipping if the numbers are true. Where a
// formula can be PROVEN against enumeration, it is; where it mirrors a
// generator's code, a canary asserts the mirrored code has not drifted.

// --- numbers: the strongest check ------------------------------------------
// numbersSurprisal claims to be the exact -log2 P(password) of the digit
// generator's process. If that is true, then over every possible output the
// probabilities must sum to exactly 1. Enumerate all 10^n strings for small n
// and check it -- for several constraint settings, including the pathological
// ones.
for (const [maxRep, maxSeq] of [[1, 1], [1, 2], [2, 2], [3, 3], [1, 5], [5, 1]]) {
  test(`numbers process is a true distribution (maxRep=${maxRep}, maxSeq=${maxSeq})`, () => {
    const n = 4
    let sum = 0
    let reachable = 0
    for (let v = 0; v < 10 ** n; v++) {
      const pw = String(v).padStart(n, '0')
      const bits = numbersSurprisal(pw, maxRep, maxSeq)
      if (Number.isNaN(bits)) continue
      reachable++
      sum += 2 ** -bits
    }
    assert.ok(Math.abs(sum - 1) < 1e-9, `probabilities sum to ${sum}, not 1`)
    assert.ok(reachable > 0 && reachable <= 10 ** n)
  })
}

test('numbers with loose limits is exactly free digits', () => {
  // Limits the password never hits must cost nothing.
  const bits = numbersSurprisal('married-to-none-0192837465'.replace(/\D/g, ''), 9, 9)
  assert.ok(Math.abs(bits - 10 * Math.log2(10)) < 1e-9)
})

test('numbers breakdown reports the cost of the limits', () => {
  // 000000 is unreachable at maxRep=1; 010101 is reachable but constrained.
  assert.ok(Number.isNaN(numbersSurprisal('000000', 1, 3)))
  const { total, parts } = numbersBits({ password: '010101', maxRepeated: 1, maxSequential: 3 })
  assert.ok(total < 6 * Math.log2(10))
  assert.ok(parts.some((p) => /limits/.test(p.label)))
})

// The surprisal replays main.js's transition logic. It cannot import main.js
// (which mounts an app), so this canary fails if the generator's code changes
// without the replica being revisited.
test('canary: the Numbers generator in main.js still matches the replica', () => {
  const main = fs.readFileSync(new URL('../src/main.js', import.meta.url), 'utf8')
  for (const line of [
    'if (repeatedCount >= maxRepeated.value)',
    'if (sequentialCount >= maxSequential.value)',
    "if (sequenceDirection === 'up' && lastNum < 9)",
    "if (sequenceDirection === 'down' && lastNum > 0)",
    'if (availableDigits.length === 0)',
  ]) {
    assert.ok(main.includes(line),
      `main.js no longer contains "${line}" — the Numbers generator changed; update numbersSurprisal to match`)
  }
})

// --- multinomial -------------------------------------------------------------
test('log2Multinomial matches direct computation', () => {
  // 6! / (2! 2! 2!) = 90
  assert.ok(Math.abs(log2Multinomial([2, 2, 2]) - Math.log2(90)) < 1e-12)
  // n choose k
  assert.ok(Math.abs(log2Multinomial([3, 5]) - Math.log2(56)) < 1e-12)
  assert.equal(log2Multinomial([7]), 0)
})

// --- tokens --------------------------------------------------------------------
test('token bits match the pools resolveToken draws from', () => {
  const SYM = Math.log2(18)
  const NUM = Math.log2(10)
  assert.equal(tokenBits('r1sym'), SYM)
  assert.equal(tokenBits('r2s2n'), 2 * SYM + 2 * NUM)
  assert.equal(tokenBits('-'), 0)
  assert.equal(tokenBits('custom'), 0)
  assert.equal(tokenBits(''), 0)
})

test('mirror suffixes: copy is free, new digits are not', () => {
  assert.equal(suffixBits('mirror', 'r2s2n'), 0)
  assert.equal(suffixBits('mirror-newdig', 'r2s2n'), 2 * Math.log2(10))
  assert.equal(suffixBits('mirror-newdig', 'r2sym'), 0) // no digits to redraw
})

// --- capitalization: 6b's headline claim ---------------------------------------
test('only the two random capitalization modes add bits', () => {
  for (const mode of ['title', 'none', 'upper', 'char-alt', 'last-upper', 'first-only', 'last-only', 'word-alt']) {
    assert.equal(capitalizationBits(mode, 20, 4).bits, 0, `${mode} should be 0 bits`)
  }
  assert.equal(capitalizationBits('random', 20, 4).bits, 20)
  assert.equal(capitalizationBits('word-random', 20, 4).bits, 4)
})

// --- simple ---------------------------------------------------------------------
test('simple entropy is type-then-character, below the uniform-pool figure', () => {
  // 4 types: 26, 26, 10, 18. Union = 80.
  const { total } = simpleBits({ length: 1, setSizes: [26, 26, 10, 18] })
  const perCharUniform = Math.log2(80)
  const expected = 2 + (Math.log2(26) * 2 + Math.log2(10) + Math.log2(18)) / 4
  assert.ok(Math.abs(total - expected) < 1e-12)
  assert.ok(total < perCharUniform, 'the naive union formula would overstate')
})

test('simple with one type is a plain uniform pool', () => {
  const { total } = simpleBits({ length: 8, setSizes: [26] })
  assert.ok(Math.abs(total - 8 * Math.log2(26)) < 1e-12)
})

// --- advanced --------------------------------------------------------------------
test('advanced bits are arrangement plus per-type draws', () => {
  const { total } = advancedBits({
    counts: [
      { label: 'lowercase', count: 2, size: 26 },
      { label: 'digits', count: 2, size: 10 },
    ],
  })
  const expected = Math.log2(6) + 2 * Math.log2(26) + 2 * Math.log2(10)
  assert.ok(Math.abs(total - expected) < 1e-12)
})

// --- words -----------------------------------------------------------------------
test('words: the list dominates and dead options report zero', () => {
  const { total, parts } = wordsBits({
    wordCount: 4, listSize: 17576, capitalization: 'title', letterCount: 30,
    separator: '-', prefix: '', suffix: '', emoji: false, leetActive: 3,
  })
  assert.ok(Math.abs(total - 4 * Math.log2(17576)) < 1e-9)
  const zeros = parts.filter((p) => p.bits === 0)
  assert.ok(zeros.some((p) => /capitalization/.test(p.label)))
  assert.ok(zeros.some((p) => /leet/.test(p.label)))
})

test('words: random separator counts once, not once per gap', () => {
  const base = wordsBits({ wordCount: 6, listSize: 17576, capitalization: 'none', letterCount: 40, separator: '', prefix: '', suffix: '', emoji: false, leetActive: 0 })
  const withSep = wordsBits({ wordCount: 6, listSize: 17576, capitalization: 'none', letterCount: 40, separator: 'r1sym', prefix: '', suffix: '', emoji: false, leetActive: 0 })
  assert.ok(Math.abs((withSep.total - base.total) - Math.log2(18)) < 1e-12)
})

// --- slots ------------------------------------------------------------------------
test('slot bits are the sum of log2 pool sizes', () => {
  const { total } = slotBits({
    slots: [{ label: 'adj', poolSize: 149 }, { label: 'noun', poolSize: 359 }],
    capitalization: 'title', letterCount: 12, separator: '-', prefix: '', suffix: '',
    emoji: false, leetActive: 0,
  })
  assert.ok(Math.abs(total - (Math.log2(149) + Math.log2(359))) < 1e-12)
})

test('alliteration parts price the letter and the narrowed pools', () => {
  const parts = alliterationSlotParts({
    commonLetters: 21,
    slots: [
      { label: 'adj', poolSize: 9, letter: 's' },
      { label: 'noun', poolSize: 14, letter: 's' },
    ],
  })
  const total = parts.reduce((s, p) => s + p.bits, 0)
  assert.ok(Math.abs(total - (Math.log2(21) + Math.log2(9) + Math.log2(14))) < 1e-12)
})

test('the floor is where the roadmap put it', () => {
  assert.equal(ENTROPY_FLOOR, 40)
})

test('wireless with alliteration prices the letter, the pools, and names the cost', async () => {
  const { wirelessBits } = await import('../src/entropy.js')
  const { total, parts } = wirelessBits({
    alliteration: true, commonLetters: 21,
    slots: [
      { label: 'adj', poolSize: 9, freePoolSize: 830, letter: 's' },
      { label: 'noun', poolSize: 14, freePoolSize: 2305, letter: 's' },
    ],
    capitalization: 'title', letterCount: 10, separator: '-', prefix: '', suffix: 'r2num',
    emoji: false, leetActive: 0,
  })
  const expected = Math.log2(21) + Math.log2(9) + Math.log2(14) + 2 * Math.log2(10)
  assert.ok(Math.abs(total - expected) < 1e-9)
  const cost = parts.find((p) => p.label === 'alliteration')
  assert.ok(cost && /costs \d+\.\d bits/.test(cost.note), 'the cost must be stated, not implied')
})
