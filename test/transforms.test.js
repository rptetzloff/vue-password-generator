import test from 'node:test'
import assert from 'node:assert/strict'
import {
  applyCapitalization,
  applyLeet,
  resolveToken,
  pickEmoji,
  DIGITS,
  SPECIAL_CHARS,
  LEET_MAP,
  EMOJI_POOLS,
} from '../src/lib.js'

test('deterministic capitalization modes', () => {
  assert.equal(applyCapitalization('haNDle', 'title'), 'Handle')
  assert.equal(applyCapitalization('haNDle', 'none'), 'handle')
  assert.equal(applyCapitalization('haNDle', 'upper'), 'HANDLE')
  assert.equal(applyCapitalization('abcd', 'char-alt'), 'AbCd')
  assert.equal(applyCapitalization('abcd', 'last-upper'), 'abcD')
  assert.equal(applyCapitalization('word', 'first-only', 0, 3), 'WORD')
  assert.equal(applyCapitalization('word', 'first-only', 1, 3), 'word')
  assert.equal(applyCapitalization('word', 'last-only', 2, 3), 'WORD')
  assert.equal(applyCapitalization('word', 'last-only', 1, 3), 'word')
  assert.equal(applyCapitalization('word', 'word-alt', 0), 'WORD')
  assert.equal(applyCapitalization('word', 'word-alt', 1), 'word')
})

// Characterization test, not an endorsement: it pins down the fact that most
// capitalization modes contribute zero entropy. Only 'random' and
// 'word-random' vary. If a mode is ever made random, this test should fail and
// be updated deliberately -- see ROADMAP Epic 6b.
test('only random capitalization modes are non-deterministic', () => {
  const deterministic = ['title', 'none', 'upper', 'char-alt', 'last-upper', 'first-only', 'last-only', 'word-alt']
  for (const mode of deterministic) {
    const runs = new Set()
    for (let i = 0; i < 50; i++) runs.add(applyCapitalization('sample', mode, 0, 2))
    assert.equal(runs.size, 1, `'${mode}' varied across runs`)
  }

  const random = new Set()
  for (let i = 0; i < 200; i++) random.add(applyCapitalization('sample', 'random'))
  assert.ok(random.size > 1, "'random' should vary")

  const wordRandom = new Set()
  for (let i = 0; i < 200; i++) wordRandom.add(applyCapitalization('sample', 'word-random'))
  assert.deepEqual([...wordRandom].sort(), ['SAMPLE', 'sample'])
})

test('applyCapitalization passes unknown modes through unchanged', () => {
  assert.equal(applyCapitalization('LeAvE', 'no-such-mode'), 'LeAvE')
})

// Also a characterization test: leet substitution is a fixed public mapping and
// therefore adds no entropy. Pinned so the claim in ROADMAP Epic 6b stays true.
test('applyLeet is a deterministic fixed mapping', () => {
  const subs = new Set(LEET_MAP.map(m => m.char))
  const first = applyLeet('the cat sat', subs)
  for (let i = 0; i < 25; i++) {
    assert.equal(applyLeet('the cat sat', subs), first)
  }
  assert.equal(first, '+h3 c@+ $@+')
})

test('applyLeet only substitutes enabled characters', () => {
  assert.equal(applyLeet('the cat', new Set(['a'])), 'the c@t')
  assert.equal(applyLeet('the cat', new Set(['e'])), 'th3 cat')
  assert.equal(applyLeet('the cat', new Set()), 'the cat')
  assert.equal(applyLeet('the cat', null), 'the cat')
})

test('applyLeet preserves characters with no mapping', () => {
  // x and y have no entry; z maps to 2.
  assert.equal(applyLeet('xyz', new Set(LEET_MAP.map(m => m.char))), 'xy2')
  assert.equal(applyLeet('wxy', new Set(LEET_MAP.map(m => m.char))), 'wxy')
})

test('resolveToken expands random tokens to the right shape', () => {
  const cases = [
    ['r1sym', 1, SPECIAL_CHARS],
    ['r2sym', 2, SPECIAL_CHARS],
    ['r1num', 1, DIGITS],
    ['r2num', 2, DIGITS],
  ]
  for (const [token, len, pool] of cases) {
    for (let i = 0; i < 200; i++) {
      const out = resolveToken(token)
      assert.equal(out.length, len, `${token} wrong length`)
      for (const c of out) assert.ok(pool.includes(c), `${token} produced '${c}'`)
    }
  }
})

test('resolveToken handles mixed and literal tokens', () => {
  for (let i = 0; i < 200; i++) {
    const m = resolveToken('r1s1n')
    assert.equal(m.length, 2)
    assert.ok(SPECIAL_CHARS.includes(m[0]) && DIGITS.includes(m[1]))

    const n = resolveToken('r1n1s')
    assert.equal(n.length, 2)
    assert.ok(DIGITS.includes(n[0]) && SPECIAL_CHARS.includes(n[1]))

    assert.equal(resolveToken('r2s2n').length, 4)
    assert.equal(resolveToken('r2n2s').length, 4)
  }
  assert.equal(resolveToken('custom', 'zz'), 'zz')
  assert.equal(resolveToken('-'), '-')
  assert.equal(resolveToken(''), '')
})

test('pickEmoji returns a member of the requested pool', () => {
  for (const cat of ['Animals', 'Food', 'default']) {
    for (let i = 0; i < 200; i++) {
      assert.ok(EMOJI_POOLS[cat].includes(pickEmoji(cat)))
    }
  }
})

test('pickEmoji falls back to the default pool for unknown categories', () => {
  for (let i = 0; i < 100; i++) {
    assert.ok(EMOJI_POOLS.default.includes(pickEmoji('NoSuchCategory')))
  }
})
