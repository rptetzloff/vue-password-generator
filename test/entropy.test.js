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

test('words: a per-gap separator counts at every gap', () => {
  const opts = { wordCount: 6, listSize: 17576, capitalization: 'none', letterCount: 40, prefix: '', suffix: '', emoji: false, leetActive: 0 }
  const base = wordsBits({ ...opts, separator: '' })
  const sym = wordsBits({ ...opts, separator: 'r1sym-gap' })
  const num = wordsBits({ ...opts, separator: 'r1num-gap' })
  assert.ok(Math.abs((sym.total - base.total) - 5 * Math.log2(18)) < 1e-12)
  assert.ok(Math.abs((num.total - base.total) - 5 * Math.log2(10)) < 1e-12)
  const p = sym.parts.find((x) => /separator/.test(x.label))
  assert.ok(/5 × /.test(p.label), 'the gap count should be visible in the label')
  assert.ok(/every gap/.test(p.note))
  // One word has no gaps, so a per-gap separator is honestly worth nothing.
  const alone = wordsBits({ ...opts, wordCount: 1, separator: 'r1sym-gap' })
  const aloneBase = wordsBits({ ...opts, wordCount: 1, separator: '' })
  assert.ok(Math.abs(alone.total - aloneBase.total) < 1e-12)
})

test('locked affixes are reused constants and price at zero', () => {
  const opts = { wordCount: 4, listSize: 17576, capitalization: 'none', letterCount: 25, separator: 'r1sym', prefix: 'r2num', suffix: 'r1sym', emoji: false, leetActive: 0 }
  const free = wordsBits({ ...opts, affixesLocked: false })
  const locked = wordsBits({ ...opts, affixesLocked: true })
  // Unlocked: separator + prefix + suffix all price normally.
  assert.ok(Math.abs((free.total - locked.total) - (2 * Math.log2(18) + 2 * Math.log2(10))) < 1e-12)
  for (const label of ['separator', 'prefix', 'suffix']) {
    const p = locked.parts.find((x) => x.label === label)
    assert.equal(p.bits, 0, `${label} should price at 0 when locked`)
    assert.ok(/locked/.test(p.note), `${label} should say why`)
  }
  // Options that were already free stay honestly labelled, not "locked".
  const none = wordsBits({ ...opts, separator: '-', prefix: '', suffix: '', affixesLocked: true })
  assert.ok(/fixed/.test(none.parts.find((x) => x.label === 'separator').note))
})

test('a per-gap separator redraws even when the lock is held', () => {
  const opts = { wordCount: 4, listSize: 17576, capitalization: 'none', letterCount: 25, separator: 'r1sym-gap', prefix: '', suffix: '', emoji: false, leetActive: 0 }
  const locked = wordsBits({ ...opts, affixesLocked: true })
  const free = wordsBits({ ...opts, affixesLocked: false })
  assert.ok(Math.abs(locked.total - free.total) < 1e-12)
  assert.ok(Math.abs(locked.parts.find((x) => /separator/.test(x.label)).bits - 3 * Math.log2(18)) < 1e-12)
})

test('slots: a per-gap separator counts at every gap', () => {
  const opts = {
    slots: [{ label: 'adj', poolSize: 149 }, { label: 'noun', poolSize: 359 }, { label: 'verb', poolSize: 200 }],
    capitalization: 'title', letterCount: 15, prefix: '', suffix: '', emoji: false, leetActive: 0,
  }
  const base = slotBits({ ...opts, separator: '-' })
  const gap = slotBits({ ...opts, separator: 'r1num-gap' })
  assert.ok(Math.abs((gap.total - base.total) - 2 * Math.log2(10)) < 1e-12)
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

test('excluding look-alikes shrinks token bits to the reduced pools', () => {
  assert.ok(Math.abs(tokenBits('r1sym', true) - Math.log2(17)) < 1e-12)
  assert.ok(Math.abs(tokenBits('r1num', true) - Math.log2(8)) < 1e-12)
  assert.ok(Math.abs(tokenBits('r2s2n', true) - (2 * Math.log2(17) + 2 * Math.log2(8))) < 1e-12)
  assert.ok(Math.abs(suffixBits('mirror-newdig', 'r2num', true) - 2 * Math.log2(8)) < 1e-12)
  // Threaded through the word modes: separator, prefix, suffix all reprice.
  const opts = { wordCount: 4, listSize: 17576, capitalization: 'none', letterCount: 25, separator: 'r1sym', prefix: 'r1num', suffix: 'r1sym', emoji: false, leetActive: 0 }
  const full = wordsBits(opts)
  const excl = wordsBits({ ...opts, ambiguousExcluded: true })
  const expected = (Math.log2(18) - Math.log2(17)) * 2 + (Math.log2(10) - Math.log2(8))
  assert.ok(Math.abs((full.total - excl.total) - expected) < 1e-12)
})

test('simple states the exclusion cost and its remedy', () => {
  // 4 sets: lower 25, upper 24, digits 8, special 28 (from 26/26/10/29).
  const { total, parts } = simpleBits({
    length: 20, setSizes: [25, 24, 8, 28], fullSetSizes: [26, 26, 10, 29],
  })
  const p = parts.find((x) => /look-alikes excluded/.test(x.label))
  assert.ok(p, 'the exclusion must appear in the breakdown')
  assert.equal(p.bits, 0)
  assert.ok(/costs \d+\.\d bits — one more character returns \d+\.\d/.test(p.note))
  const fullTotal = simpleBits({ length: 20, setSizes: [26, 26, 10, 29] }).total
  const cost = parseFloat(p.note.match(/costs (\d+\.\d)/)[1])
  assert.ok(Math.abs((fullTotal - total) - cost) < 0.05, 'the stated cost must be the measured cost')
  // And without exclusion there is no such line.
  assert.ok(!simpleBits({ length: 20, setSizes: [26, 26, 10, 29] }).parts.some((x) => /look-alikes/.test(x.label)))
})

test('advanced states the exclusion cost from the realized counts', () => {
  const { parts } = advancedBits({
    counts: [
      { label: 'lowercase', count: 10, size: 25, fullSize: 26 },
      { label: 'digits', count: 10, size: 8, fullSize: 10 },
    ],
  })
  const p = parts.find((x) => /look-alikes excluded/.test(x.label))
  assert.ok(p && p.bits === 0)
  const expected = 10 * (Math.log2(26) - Math.log2(25)) + 10 * (Math.log2(10) - Math.log2(8))
  const stated = parseFloat(p.note.match(/costs (\d+\.\d)/)[1])
  assert.ok(Math.abs(stated - expected) < 0.05)
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

test('the comparison anchors are the figures the docs claim', async () => {
  const { REFERENCE_PER_CHAR, MAIN_LIST_WORD_BITS } = await import('../src/entropy.js')
  // One Simple character, all four sets: 2 + mean(log2 26, 26, 10, 29).
  const expected = 2 + (2 * Math.log2(26) + Math.log2(10) + Math.log2(29)) / 4
  assert.ok(Math.abs(REFERENCE_PER_CHAR - expected) < 1e-12)
  assert.ok(Math.abs(MAIN_LIST_WORD_BITS - Math.log2(17576)) < 1e-12)
})

test('crack times are average-case at the named scenario rates', async () => {
  const { ATTACK_SCENARIOS, crackSeconds } = await import('../src/entropy.js')
  assert.equal(ATTACK_SCENARIOS.length, 3)
  const rates = Object.fromEntries(ATTACK_SCENARIOS.map((s) => [s.id, s.rate]))
  assert.deepEqual(rates, { fast: 1e11, slow: 1e4, online: 10 })
  // 40 bits vs a GPU: 2^39 / 1e11 ≈ 5.5 seconds — the reason 40 is the floor.
  assert.ok(Math.abs(crackSeconds(40, 1e11) - 2 ** 39 / 1e11) < 1e-9)
  assert.ok(crackSeconds(40, 1e11) < 10)
  // The same 40 bits online: over 870 years. One number would mislead.
  assert.ok(crackSeconds(40, 10) / 31557600 > 800)
})

test('guess times format across the whole range', async () => {
  const { formatGuessTime } = await import('../src/entropy.js')
  assert.equal(formatGuessTime(0.2), 'under a second')
  assert.equal(formatGuessTime(5.5), '6 seconds')
  assert.equal(formatGuessTime(120), '2 minutes')
  assert.equal(formatGuessTime(7200), '2 hours')
  assert.equal(formatGuessTime(86400 * 3), '3 days')
  assert.equal(formatGuessTime(31557600), '1 year')
  assert.equal(formatGuessTime(31557600 * 250), '250 years')
  assert.match(formatGuessTime(31557600 * 1e15), /^about 10\^15 years$/)
})

test('meter tiers sit on the attack-anchored boundaries', async () => {
  const { entropyTier, METER_MAX, ENTROPY_FLOOR } = await import('../src/entropy.js')
  assert.equal(entropyTier(0).id, 'weak')
  assert.equal(entropyTier(39.9).id, 'weak')
  assert.equal(entropyTier(ENTROPY_FLOOR).id, 'fair') // the floor is the weak/fair line
  assert.equal(entropyTier(59.9).id, 'fair')
  assert.equal(entropyTier(60).id, 'good')
  assert.equal(entropyTier(79.9).id, 'good')
  assert.equal(entropyTier(80).id, 'strong')
  assert.equal(entropyTier(500).id, 'strong')
  assert.equal(METER_MAX, 100)
})
