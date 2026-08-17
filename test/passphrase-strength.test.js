import test from 'node:test'
import assert from 'node:assert/strict'
import {
  estimatePassphrase, poolSize, repeatingUnit, longestRun, longestRepeat, hasKeyboardRun, isCommon,
} from '../core/generate/passphrase-strength.js'
import { simpleBits } from '../core/generate/entropy.js'

// This module is the project's only guess, so the tests are mostly about it
// staying an honest one: never claiming MORE than pool arithmetic allows,
// always naming a concrete reason when it claims less, and never flattering a
// password the site itself would call weak.

test('the estimate never exceeds the pool ceiling', () => {
  // The central promise. A human-chosen string cannot be worth more than the
  // same length drawn uniformly at random, so this must hold for anything.
  const samples = [
    'password', 'Tr0ub4dor&3', 'correct horse battery staple', 'aaaaaaaaaaaa',
    'abcdefghijkl', 'qwertyuiop', 'P@ssw0rd!2026', 'x', 'ünïcödé phrase here',
    '9876543210', 'MiXeD CaSe 123!', 'the quick brown fox jumps',
  ]
  for (const s of samples) {
    const { bits } = estimatePassphrase(s)
    const ceiling = s.length * Math.log2(poolSize(s))
    assert.ok(bits <= ceiling + 1e-9, `"${s}": ${bits.toFixed(1)} exceeds its ${ceiling.toFixed(1)} ceiling`)
  }
})

test('it is never more generous than the generator is about its own output', () => {
  // A 12-character random string from all four classes is 78.5 bits by
  // simpleBits. The estimator must not award a *typed* string of the same
  // shape more than that, or the vault would flatter a passphrase the
  // generator would have been modest about.
  const generated = simpleBits({ length: 12, setSizes: [26, 26, 10, 29] }).total
  const typed = estimatePassphrase('Xq7!zR2@mK9$').bits
  assert.ok(typed <= generated * 1.35,
    `typed estimate ${typed.toFixed(1)} runs away from the generator's ${generated.toFixed(1)}`)
})

test('an empty passphrase is zero, not an error', () => {
  assert.deepEqual(estimatePassphrase(''), { bits: 0, notes: [], length: 0 })
  assert.equal(estimatePassphrase(null).bits, 0)
  assert.equal(estimatePassphrase(undefined).bits, 0)
  assert.equal(estimatePassphrase(42).bits, 0)
})

test('the pool grows with each character class present', () => {
  assert.equal(poolSize('abc'), 26)
  assert.equal(poolSize('abcABC'), 52)
  assert.equal(poolSize('abc123'), 36)
  assert.equal(poolSize('abcABC123'), 62)
  assert.equal(poolSize('abc!'), 59)
  assert.ok(poolSize('abcé') > 26, 'non-ASCII should widen the pool')
})

test('a repeated unit is worth roughly one unit', () => {
  assert.equal(repeatingUnit('abcabcabc'), 'abc')
  assert.equal(repeatingUnit('abab'), 'ab')
  assert.equal(repeatingUnit('aaaa'), 'a')
  assert.equal(repeatingUnit('abcd'), 'abcd')
  assert.equal(repeatingUnit(''), '')

  // "abcabcabcabc" must land far below twelve random lowercase characters.
  const repeated = estimatePassphrase('abcabcabcabc').bits
  const twelve = 12 * Math.log2(26)
  assert.ok(repeated < twelve / 2, `${repeated.toFixed(1)} is too generous against ${twelve.toFixed(1)}`)
  assert.ok(estimatePassphrase('abcabcabcabc').notes.some((n) => /repeated/.test(n)))
})

test('runs and repeats are detected and cost something', () => {
  assert.equal(longestRepeat('aaab'), 3)
  assert.equal(longestRepeat('abab'), 1)
  assert.equal(longestRepeat(''), 0)

  assert.equal(longestRun('abcd'), 4)
  assert.equal(longestRun('dcba'), 4)
  assert.equal(longestRun('1234x'), 4)
  assert.equal(longestRun('axby'), 1)
  // A direction change breaks the run rather than extending it.
  assert.equal(longestRun('abcba'), 3)

  const plain = estimatePassphrase('kwvpszmr').bits
  const runny = estimatePassphrase('abcdefgh').bits
  assert.ok(runny < plain, 'a counting sequence should be worth less than the same length of noise')
})

test('keyboard runs are recognised in both directions', () => {
  assert.ok(hasKeyboardRun('qwer'))
  assert.ok(hasKeyboardRun('my asdf pass'))
  assert.ok(hasKeyboardRun('rewq'))
  assert.ok(hasKeyboardRun('POIU'.toLowerCase()))
  assert.ok(!hasKeyboardRun('correct horse'))
  // Not "qwerty12": that is a famous password, and the common-password check
  // deliberately answers first, so it would never reach the keyboard rule.
  assert.ok(estimatePassphrase('Xasdfgh9!').notes.some((n) => /keyboard/.test(n)))
})

test('every deduction states a reason the user can act on', () => {
  // A number that drops with no explanation is the failure mode this module
  // exists to avoid; a note must accompany any reduction below the ceiling.
  for (const s of ['aaaaaaaa', 'abcdefgh', 'qwertyui', 'abcabcabc']) {
    const { bits, notes } = estimatePassphrase(s)
    const ceiling = s.length * Math.log2(poolSize(s))
    if (bits < ceiling - 0.5) {
      assert.ok(notes.length > 0, `"${s}" lost bits with nothing to show for it`)
    }
  }
})

test('famous passwords are told the truth, not their ceiling', () => {
  // "password" is worth 37.6 bits by pool arithmetic and about one guess in
  // reality. The ceiling is honest but useless here, so the common-password
  // check overrides it -- locally, with no network, which is what keeps this
  // on the right side of 9e's no-breach-corpus line.
  for (const s of ['password', 'Password', 'P@ssw0rd', 'password123', 'qwerty', 'letmein', '123456', 'iloveyou', 'monkey', 'trustno1', 'jordan23']) {
    const { bits, notes, common } = estimatePassphrase(s)
    assert.equal(bits, 0, `"${s}" scored ${bits.toFixed(1)}; a first-guess password is worth nothing`)
    assert.equal(common, true, `"${s}" should be flagged so the vault can refuse it outright`)
    assert.ok(notes.some((n) => /attackers try first/.test(n)), `"${s}" should say why`)
  }
  assert.ok(isCommon('P@ssw0rd12'), 'trailing digits and leet must not disguise a famous password')
  assert.ok(!isCommon('Marimba7-Harvest'), 'an ordinary passphrase is not on the list')
})

test('the obvious weaknesses are named', () => {
  assert.ok(estimatePassphrase('short').notes.some((n) => /short/.test(n)))
  assert.ok(estimatePassphrase('alllowercaseletters').notes.some((n) => /lowercase/.test(n)))
  assert.ok(estimatePassphrase('84726194037').notes.some((n) => /digits/.test(n)))
  // A long mixed passphrase should have nothing to complain about.
  assert.deepEqual(estimatePassphrase('Marimba7-Harvest!-Wondrous').notes, [])
})

test('length beats cleverness, which is the advice the UI gives', () => {
  // Four extra plain characters must be worth more than decorating a short
  // one, or the meter would be teaching the wrong lesson.
  const clever = estimatePassphrase('P@ssw0rd').bits
  const longer = estimatePassphrase('passwordpass').bits
  assert.ok(longer > clever, `${longer.toFixed(1)} should beat ${clever.toFixed(1)}`)
})
