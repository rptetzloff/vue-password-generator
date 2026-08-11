import test from 'node:test'
import assert from 'node:assert/strict'
import {
  applyCapitalization,
  applyLeet,
  resolveToken,
  isPerGapSeparator,
  joinPerGap,
  PER_GAP_SEPARATORS,
  SEPARATOR_OPTIONS,
  pickEmoji,
  isHistoryKey,
  historyKeysIn,
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

test('every per-gap separator is offered in the UI and maps to a real token', () => {
  const offered = new Set(SEPARATOR_OPTIONS.map(o => o.value))
  for (const [gapValue, base] of Object.entries(PER_GAP_SEPARATORS)) {
    assert.ok(offered.has(gapValue), `${gapValue} missing from SEPARATOR_OPTIONS`)
    assert.ok(isPerGapSeparator(gapValue))
    // The base token must expand to exactly one character, or joinPerGap's
    // per-gap pricing (gapCount × one draw) would be wrong.
    assert.equal(resolveToken(base).length, 1)
  }
  assert.ok(!isPerGapSeparator('r1sym'))
  assert.ok(!isPerGapSeparator(''))
})

test('resolveToken degrades a per-gap separator to a single draw', () => {
  for (let i = 0; i < 100; i++) {
    assert.ok(SPECIAL_CHARS.includes(resolveToken('r1sym-gap')))
    assert.ok(DIGITS.includes(resolveToken('r1num-gap')))
  }
})

test('joinPerGap draws an independent separator at every gap', () => {
  const words = Array.from({ length: 41 }, (_, i) => 'w' + i)
  const out = joinPerGap(words, 'r1sym-gap')
  const seps = out.split(/w\d+/).filter(Boolean)
  assert.equal(seps.length, 40)
  for (const s of seps) {
    assert.equal(s.length, 1)
    assert.ok(SPECIAL_CHARS.includes(s))
  }
  // With 40 independent draws from 18 symbols, all-identical has probability
  // 18^-39 — if this fails, the separator is being cached, not redrawn.
  assert.ok(new Set(seps).size > 1, 'every gap got the same separator')
  assert.equal(joinPerGap(['alone'], 'r1num-gap'), 'alone')
  assert.equal(joinPerGap([], 'r1num-gap'), '')
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

// Guards the "History: Off" privacy fix. Each generator stores its passwords
// under "<generator>.history"; settings keys must never be swept. The real
// localStorage keys below are taken from the seven useHistory() call sites and
// the persistedRef() settings keys in main.js.
test('isHistoryKey matches only per-generator history stores', () => {
  const historyKeys = [
    'simple.history', 'adv.history', 'words.history', 'nums.history',
    'phrase.history', 'wifi.history', 'madlib.history',
  ]
  for (const k of historyKeys) assert.ok(isHistoryKey(k), `${k} should match`)

  const settingsKeys = [
    'global.activeTab', 'global.historyMax', 'adv.passwordLength',
    'adv.activeSymbols', 'madlib.slotCats', 'madlib.useEmoji',
    'nums.maxRepeated', 'phrase.capitalization', 'wifi.separator',
    'history', 'historyMax', 'simple.historyLimit',
  ]
  for (const k of settingsKeys) assert.ok(!isHistoryKey(k), `${k} should NOT match`)
})

test('isHistoryKey tolerates non-string keys', () => {
  for (const v of [null, undefined, 42, {}, []]) {
    assert.equal(isHistoryKey(v), false)
  }
})

test('historyKeysIn selects every history store and nothing else', () => {
  const all = [
    'simple.history', 'global.activeTab', 'adv.history', 'adv.digits',
    'global.historyMax', 'madlib.history', 'madlib.slotCats',
  ]
  assert.deepEqual(historyKeysIn(all), ['simple.history', 'adv.history', 'madlib.history'])
  assert.deepEqual(historyKeysIn([]), [])
})

// A new generator must be swept automatically. If someone adds one and this
// starts failing, the naming convention was broken -- not the sweep.
test('historyKeysIn covers a hypothetical new generator', () => {
  assert.deepEqual(historyKeysIn(['brandnew.history', 'brandnew.length']), ['brandnew.history'])
})

test('history entries migrate from strings and reject junk', async () => {
  const { normalizeHistory } = await import('../src/lib.js')
  const out = normalizeHistory(['abc', { pw: 'def', bits: 56.4 }, { pw: 'ghi', bits: 'x' }, 7, null, { bits: 3 }])
  assert.deepEqual(out, [
    { pw: 'abc', bits: null },
    { pw: 'def', bits: 56.4 },
    { pw: 'ghi', bits: null },
  ])
  assert.deepEqual(normalizeHistory('not a list'), [])
})
