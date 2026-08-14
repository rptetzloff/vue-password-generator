import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import {
  RECOVERY_WORDS, recoveryBits, generateRecoveryPhrase,
  normalizeRecoveryPhrase, checkRecoveryPhrase,
} from '../src/recovery-key.js'

// The real list, because the entropy claim is about this list and no other.
const WORDS = fs
  .readFileSync(new URL('../data/orchard-street-long.txt', import.meta.url), 'utf8')
  .split('\n').map((w) => w.trim()).filter(Boolean)

test('the entropy claim matches the list actually shipped', () => {
  // ROADMAP 9f and the docs both state 225 bits from 17,576 words. If the list
  // is ever swapped, this is the number that has to move with it.
  assert.equal(WORDS.length, 17576)
  assert.equal(RECOVERY_WORDS, 16)
  const bits = recoveryBits(WORDS.length)
  assert.ok(bits > 225 && bits < 226, `expected ~225.6 bits, got ${bits.toFixed(1)}`)
  // The bottom of the range the roadmap considered is still far out of reach.
  assert.ok(recoveryBits(WORDS.length, 10) > 140)
})

test('a generated phrase is the right shape and comes from the list', () => {
  const known = new Set(WORDS)
  for (let i = 0; i < 20; i++) {
    const phrase = generateRecoveryPhrase(WORDS)
    const words = phrase.split(' ')
    assert.equal(words.length, RECOVERY_WORDS)
    for (const w of words) assert.ok(known.has(w), `${w} is not in the list`)
    assert.equal(phrase, phrase.toLowerCase(), 'phrases are lower case')
    assert.equal(phrase.trim(), phrase, 'no stray whitespace')
  }
})

test('two phrases are never the same, and the draw covers the list', () => {
  // Not a randomness test -- random.test.js owns that -- but a generator stuck
  // on one word, or seeded identically per call, would pass every other test
  // here while producing a key an attacker could guess in one try.
  const phrases = new Set()
  const seen = new Set()
  for (let i = 0; i < 60; i++) {
    const p = generateRecoveryPhrase(WORDS)
    phrases.add(p)
    for (const w of p.split(' ')) seen.add(w)
  }
  assert.equal(phrases.size, 60, 'every phrase should be distinct')
  assert.ok(seen.size > 800, `only ${seen.size} distinct words across 960 draws`)
})

test('words may repeat, because independence is what the entropy figure means', () => {
  // Deduplicating would feel tidier and would silently lower the bit count.
  // With 16 draws from 17,576 the chance of a repeat inside one phrase is
  // about 0.7%, so this asserts the mechanism rather than waiting to see one.
  const tiny = Array.from({ length: 1024 }, (_, i) => `w${i}`)
  let sawRepeat = false
  for (let i = 0; i < 200 && !sawRepeat; i++) {
    const words = generateRecoveryPhrase(tiny, 40).split(' ')
    sawRepeat = new Set(words).size < words.length
  }
  assert.ok(sawRepeat, 'draws should be independent, so repeats must be possible')
})

test('a phrase cannot be generated from a list too small to carry one', () => {
  // The guard exists because passing an empty or half-loaded list would
  // otherwise produce a "key" of undefineds, or one drawn from six words.
  assert.throws(() => generateRecoveryPhrase([]), /real word list/)
  assert.throws(() => generateRecoveryPhrase(['alpha', 'bravo']), /real word list/)
  assert.throws(() => generateRecoveryPhrase(null), /real word list/)
  assert.throws(() => generateRecoveryPhrase(WORDS, 0), /bad word count/)
})

test('typed input is forgiven its spacing and its capitals', () => {
  // What someone copies off paper, out of a text editor, or across two lines.
  assert.equal(normalizeRecoveryPhrase('  Alpha   BRAVO\ncharlie  '), 'alpha bravo charlie')
  assert.equal(normalizeRecoveryPhrase('alpha\tbravo'), 'alpha bravo')
  assert.equal(normalizeRecoveryPhrase(null), '')
  assert.equal(normalizeRecoveryPhrase(undefined), '')
})

test('the wrong number of words is named as such', () => {
  const short = WORDS.slice(0, 15).join(' ')
  const result = checkRecoveryPhrase(short, WORDS)
  assert.equal(result.ok, false)
  assert.equal(result.reason, 'length')
  assert.match(result.message, /16 words; that is 15/)
})

test('a misspelled word is named rather than swallowed', () => {
  // "invalid recovery key" is useless to someone holding the paper it is
  // written on; the difference is usually one letter.
  const words = generateRecoveryPhrase(WORDS).split(' ')
  words[3] = 'brambel'
  const result = checkRecoveryPhrase(words.join(' '), WORDS)
  assert.equal(result.ok, false)
  assert.equal(result.reason, 'unknown')
  assert.deepEqual(result.unknown, ['brambel'])
  assert.match(result.message, /brambel/)
})

test('several bad words are all reported at once', () => {
  const words = generateRecoveryPhrase(WORDS).split(' ')
  words[0] = 'zzzz'
  words[9] = 'qqqq'
  const result = checkRecoveryPhrase(words.join(' '), WORDS)
  assert.deepEqual(result.unknown, ['zzzz', 'qqqq'])
  assert.match(result.message, /zzzz, qqqq/)
})

test('a good phrase passes, in whatever case it was typed', () => {
  const phrase = generateRecoveryPhrase(WORDS)
  const result = checkRecoveryPhrase(`  ${phrase.toUpperCase()}  `, WORDS)
  assert.equal(result.ok, true)
  assert.equal(result.phrase, phrase, 'the normalised phrase comes back ready to use')
})

test('an empty phrase is its own case, not a length complaint', () => {
  const result = checkRecoveryPhrase('   ', WORDS)
  assert.equal(result.reason, 'empty')
  assert.match(result.message, /Enter your recovery key/)
})

test('the check still works without a list to check against', () => {
  // The vault page can reach the unlock screen before the wordlist has loaded.
  // Word count is still checkable, and the unwrap is the real verdict anyway.
  const phrase = generateRecoveryPhrase(WORDS)
  assert.equal(checkRecoveryPhrase(phrase, null).ok, true)
  assert.equal(checkRecoveryPhrase('one two three', null).reason, 'length')
})
