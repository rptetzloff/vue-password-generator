import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

// The Words list is the one data file whose *properties* are load-bearing:
// About, Legal and the README all state its size and what follows from it, and
// Epic 6a will put the bit count on screen. The EFF list before it was exactly
// 7,776 entries because that is 6^5, which is what made "five dice rolls per
// word" true -- a claim that would have quietly become false if anyone had
// edited the file. These tests exist so the same cannot happen again.

const WORDS = fs
  .readFileSync(new URL('../data/orchard-street-long.txt', import.meta.url), 'utf8')
  .trim()
  .split(/\r?\n/)
  .map((w) => w.trim())
  .filter(Boolean)

test('the list is exactly 17,576 words', () => {
  // 26^3. Not a coincidence and not arbitrary: it is the size the upstream
  // list is built to, and it is what 14.101 bits per word rests on.
  assert.equal(WORDS.length, 17576)
  assert.equal(WORDS.length, 26 ** 3)
})

test('entropy per word is the 14.101 bits the site claims', () => {
  const bits = Math.log2(WORDS.length)
  assert.equal(bits.toFixed(3), '14.101')
})

test('every entry is lowercase a-z with no duplicates', () => {
  const bad = WORDS.filter((w) => !/^[a-z]+$/.test(w))
  assert.deepEqual(bad, [], `non a-z entries: ${bad.slice(0, 5).join(', ')}`)
  assert.equal(new Set(WORDS).size, WORDS.length, 'the list contains duplicates')
})

test('word lengths stay within 3-15 characters', () => {
  const lengths = WORDS.map((w) => w.length)
  assert.equal(Math.min(...lengths), 3)
  assert.equal(Math.max(...lengths), 15)
})

test('no entry contains a character used as a separator', () => {
  // The generator joins with hyphens, underscores, dots and spaces. A word
  // containing one would make the output ambiguous to read back. The EFF list
  // did contain hyphenated entries -- drop-down, t-shirt, yo-yo -- which is
  // one of the reasons it was replaced.
  const offenders = WORDS.filter((w) => /[-_. ]/.test(w))
  assert.deepEqual(offenders, [], `entries with separator characters: ${offenders.slice(0, 5).join(', ')}`)
})

// The claim that costs the most if it is wrong.
//
// About and the README both say no sequence of these words can be read as a
// different sequence, which is what makes the None separator safe. That is the
// uniquely-decodable property, and it is decidable -- Sardinas-Patterson, 1953
// -- so it is checked here rather than taken from the upstream README.
//
// The algorithm: start with the dangling suffixes of every pair where one word
// prefixes another, then repeatedly extend. If a dangling suffix is itself a
// codeword, two different sequences produce the same string and the code is
// ambiguous.
test('the list is uniquely decodable, so words can be joined with no separator', () => {
  const codewords = new Set(WORDS)
  const sorted = [...WORDS].sort()

  /**
   * Codewords having `p` as a proper prefix, via binary search on the sorted
   * list. The naive form compares every suffix against all 17,576 words, which
   * put this test at ten seconds -- longer than the entire rest of the suite.
   */
  const startingWith = (p) => {
    let lo = 0
    let hi = sorted.length
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if (sorted[mid] < p) lo = mid + 1
      else hi = mid
    }
    const out = []
    for (let i = lo; i < sorted.length && sorted[i].startsWith(p); i++) {
      if (sorted[i] !== p) out.push(sorted[i])
    }
    return out
  }

  /** Codewords that are a proper prefix of `s`. Cheap: test each cut point. */
  const prefixesOf = (s) => {
    const out = []
    for (let i = 1; i < s.length; i++) {
      const head = s.slice(0, i)
      if (codewords.has(head)) out.push(head)
    }
    return out
  }

  // First generation: suffixes dangling between the code and itself.
  let dangling = new Set()
  for (const w of WORDS) {
    for (const longer of startingWith(w)) dangling.add(longer.slice(w.length))
  }

  const seen = new Set(dangling)
  let rounds = 0
  while (dangling.size) {
    for (const s of dangling) {
      assert.ok(
        !codewords.has(s),
        `not uniquely decodable: the dangling suffix "${s}" is itself a word, so some ` +
          'joined sequence can be read two ways',
      )
    }

    // Next generation, both directions: a codeword may extend a dangling
    // suffix, or a dangling suffix may extend a codeword.
    const next = new Set()
    for (const s of dangling) {
      for (const longer of startingWith(s)) next.add(longer.slice(s.length))
      for (const head of prefixesOf(s)) next.add(s.slice(head.length))
    }

    dangling = new Set()
    for (const s of next) {
      if (!seen.has(s)) { seen.add(s); dangling.add(s) }
    }

    // Sardinas-Patterson terminates because suffixes are bounded by the longest
    // codeword; this guard just turns a hang into a readable failure.
    assert.ok(++rounds < 100, 'Sardinas-Patterson did not converge')
  }
})
