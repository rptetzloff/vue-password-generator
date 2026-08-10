import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

// data/words.json feeds the slot-based generators. Unlike the flat Words list
// it is hand-curated, so the risks are different: not "did the file change
// size" but "did something get in that should not have".

const WORDS = JSON.parse(
  fs.readFileSync(new URL('../data/words.json', import.meta.url), 'utf8'),
)
const MAIN = fs.readFileSync(new URL('../src/main.js', import.meta.url), 'utf8')

const PARTS = ['noun', 'adj', 'adv', 'verb']

test('the file has exactly the four parts of speech', () => {
  assert.deepEqual(Object.keys(WORDS).sort(), [...PARTS].sort())
})

test('every entry is lowercase a-z', () => {
  // jalapeño was the one non-ASCII entry for a long time. A password with a
  // character that is awkward to type -- and that some systems reject
  // outright -- is a bad password however strong it measures.
  const bad = []
  for (const pos of PARTS) {
    for (const [cat, words] of Object.entries(WORDS[pos])) {
      for (const w of words) if (!/^[a-z]+$/.test(w)) bad.push(`${pos}.${cat}: ${JSON.stringify(w)}`)
    }
  }
  assert.deepEqual(bad, [], `non a-z entries: ${bad.join(', ')}`)
})

test('word lengths stay within 3-15 characters', () => {
  const bad = []
  for (const pos of PARTS) {
    for (const [cat, words] of Object.entries(WORDS[pos])) {
      for (const w of words) {
        if (w.length < 3 || w.length > 15) bad.push(`${pos}.${cat}: ${w} (${w.length})`)
      }
    }
  }
  assert.deepEqual(bad, [], `out of range: ${bad.slice(0, 6).join(', ')}`)
})

test('no category is empty, and none is small enough to be guessable', () => {
  // A slot's contribution is log2(pool). Anything under 32 words gives less
  // than 5 bits, at which point the category is decoration rather than
  // strength. The smallest today is adv.place at 60.
  for (const pos of PARTS) {
    for (const [cat, words] of Object.entries(WORDS[pos])) {
      assert.ok(words.length >= 32, `${pos}.${cat} has only ${words.length} words`)
    }
  }
})

test('no category contains a duplicate of its own', () => {
  // Words are deliberately allowed in *several* categories -- golden is a
  // color and a weather word -- but never twice in the same one, which would
  // silently weight it.
  for (const pos of PARTS) {
    for (const [cat, words] of Object.entries(WORDS[pos])) {
      assert.equal(new Set(words).size, words.length, `${pos}.${cat} repeats a word`)
    }
  }
})

test('the random pool dedupes across categories', () => {
  // Categories overlap on purpose, so flattening them for the "Random" option
  // would draw an overlapping word once per category it appears in. 193 nouns,
  // 96 adverbs and 51 adjectives are in more than one, so this is not
  // hypothetical -- it skewed the draw and overstated the entropy.
  assert.match(
    MAIN,
    /const allOf = \(cats\) => \[\.\.\.new Set\(Object\.values\(cats\)\.flat\(\)\)\]/,
    'main.js should define allOf() to dedupe a flattened category set',
  )
  assert.doesNotMatch(
    MAIN,
    /catId === 'random' \? Object\.values\(cats\)\.flat\(\)/,
    'the random pool must go through allOf(), not a bare flat()',
  )
})

test('every category offered in the UI exists in the data, and the reverse', () => {
  // The categories live in two places -- CATEGORY_META in main.js drives the
  // dropdowns, words.json holds the words -- so they can drift. Adding music
  // and sports meant editing both.
  const block = /const CATEGORY_META = \{([\s\S]*?)\n\}/.exec(MAIN)
  assert.ok(block, 'CATEGORY_META not found in main.js')

  for (const pos of PARTS) {
    const section = new RegExp(`${pos}: \\[([\\s\\S]*?)\\]`).exec(block[1])
    assert.ok(section, `CATEGORY_META has no ${pos} list`)
    const ids = [...section[1].matchAll(/id: '([\w-]+)'/g)]
      .map((m) => m[1])
      .filter((id) => id !== 'random')

    const inData = Object.keys(WORDS[pos])
    for (const id of ids) {
      assert.ok(inData.includes(id), `the UI offers ${pos}.${id} but words.json has no such category`)
    }
    for (const cat of inData) {
      assert.ok(ids.includes(cat), `words.json has ${pos}.${cat} but the UI never offers it`)
    }
  }
})
