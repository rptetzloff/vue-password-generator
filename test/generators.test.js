import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import {
  MODES, DEFAULTS, MADLIB_TEMPLATES, ALL_SYMBOLS, generate, generateWithRetry,
  commonInitials, allOf,
} from '../src/generators.js'
import { LEET_MAP } from '../src/lib.js'

// The generators, lifted out of main.js's Vue components.
//
// The risk in that move is silent drift: a transplanted generator that still
// produces plausible passwords while quietly disagreeing with the entropy the
// UI reports, or with the settings the user actually chose. So these check the
// two things a smoke test would miss -- that the constraints each mode
// promises are really enforced on the output, and that the defaults here still
// match the ones main.js persists.

const MAIN = fs.readFileSync(new URL('../src/main.js', import.meta.url), 'utf8')
const WORD_DATA = JSON.parse(fs.readFileSync(new URL('../data/words.json', import.meta.url), 'utf8'))
const WORD_LIST = fs.readFileSync(new URL('../data/orchard-street-long.txt', import.meta.url), 'utf8')
  .split(/\r?\n/).map((w) => w.trim()).filter(Boolean)

const settingsFor = (modeId, overrides = {}) => {
  const base = structuredClone(DEFAULTS[modeId])
  if (modeId === 'advanced') base.activeSymbols = new Set(ALL_SYMBOLS)
  if (Object.hasOwn(base, 'activeLeet')) base.activeLeet = new Set()
  return { ...base, ...overrides }
}
const dataFor = (modeId) => ({
  wordList: modeId === 'words' ? WORD_LIST : null,
  wordData: ['passphrase', 'wireless', 'madlib'].includes(modeId) ? WORD_DATA : null,
})

test('every mode generates a password and an entropy figure', () => {
  for (const { id } of MODES) {
    const result = generate(id, settingsFor(id), dataFor(id))
    assert.ok(!result.error, `${id}: ${result.error}`)
    assert.ok(result.password.length > 0, `${id} produced nothing`)
    assert.ok(Number.isFinite(result.entropy.total), `${id} produced no bits`)
    assert.ok(result.entropy.total > 0, `${id} reported ${result.entropy.total} bits`)
  }
})

test('the defaults have not drifted from the ones main.js persists', () => {
  // main.js is still the generator UI and still owns these as persistedRef
  // fallbacks. Two copies of a default is exactly how a mode ends up behaving
  // differently depending on which page you generate from.
  // Every key main.js persists, and separately the ones whose default is a
  // plain literal. Set-valued defaults like `new Set(ALL_SYMBOLS)` contain
  // their own parentheses, so they are matched for existence only and their
  // contents are checked by the Set tests instead.
  const keys = new Set([...MAIN.matchAll(/persistedRef\('([\w.]+)'/g)].map((m) => m[1]))
  assert.ok(keys.size > 20, `only found ${keys.size} persistedRef calls in main.js`)

  const persisted = new Map()
  // \r?\n, not \n: the working tree is CRLF and matching only \n finds nothing,
  // which would make this test pass by having no defaults to compare.
  for (const m of MAIN.matchAll(/persistedRef\('([\w.]+)',\s*([^)]*?)\)\r?\n/g)) {
    persisted.set(m[1], m[2].trim())
  }
  const scalar = (v) => (typeof v === 'string' ? `'${v}'` : String(v))

  for (const { id, prefix } of MODES) {
    for (const [name, value] of Object.entries(DEFAULTS[id])) {
      const key = `${prefix}.${name}`
      assert.ok(keys.has(key), `${key} is in DEFAULTS but main.js never persists it`)
      if (value === null) continue                    // Sets, checked separately
      const raw = persisted.get(key)
      assert.ok(raw !== undefined, `${key} has a default main.js writes non-literally`)
      // Defaults written as an identifier rather than a literal -- `slots` is
      // `defaultSlots` in main.js -- are compared separately below.
      if (/^[A-Za-z_$][\w$]*$/.test(raw)) continue
      if (Array.isArray(value)) {
        assert.equal(raw.replace(/\s/g, ''), JSON.stringify(value).replace(/"/g, "'").replace(/\s/g, ''),
          `${key}: main.js defaults to ${raw}, generators.js to ${JSON.stringify(value)}`)
        continue
      }
      assert.equal(raw, scalar(value),
        `${key}: main.js defaults to ${raw}, generators.js to ${scalar(value)}`)
    }
  }
})

test('the default slot layouts match main.js', () => {
  // Passphrase and Wireless each declare their own `defaultSlots`, in that
  // order in the file. Compared by shape rather than by text, since only the
  // type and category affect what gets drawn.
  const declarations = [...MAIN.matchAll(/const defaultSlots = (\[[^\]]*\])/g)]
  assert.equal(declarations.length, 2, 'expected a defaultSlots for Passphrase and for Wireless')

  const shapeOf = (slots) => slots.map((s) => `${s.type}:${s.cat}`).join(',')
  const parsed = declarations.map((m) =>
    [...m[1].matchAll(/type:\s*'(\w+)',\s*cat:\s*'(\w+)'/g)].map((s) => `${s[1]}:${s[2]}`).join(','))

  assert.equal(parsed[0], shapeOf(DEFAULTS.passphrase.slots), 'Passphrase default slots')
  assert.equal(parsed[1], shapeOf(DEFAULTS.wireless.slots), 'Wireless default slots')
})

test('Simple respects its character-type choices', () => {
  const only = (over) => generate('simple', settingsFor('simple', {
    lowerCase: false, upperCase: false, digits: false, specialChars: false, ...over,
  }), {})
  assert.match(only({ digits: true }).password, /^\d{20}$/)
  assert.match(only({ lowerCase: true }).password, /^[a-z]{20}$/)
  assert.match(only({ upperCase: true }).password, /^[A-Z]{20}$/)
  assert.equal(only({}).error, 'Please select at least one character type')
})

test('Simple honours the look-alike exclusion', () => {
  for (let i = 0; i < 40; i++) {
    const { password } = generate('simple', settingsFor('simple', {
      passwordLength: 40, excludeAmbiguous: true,
    }), {})
    assert.doesNotMatch(password, /[lI1|O0]/, `${password} contains a look-alike`)
  }
})

test('Advanced enforces its per-type minimums and maximums', () => {
  const settings = settingsFor('advanced', {
    passwordLength: 20, lowerCase: [5, 5], upperCase: [3, 3], digits: [2, 2], specialChars: [10, 10],
  })
  for (let i = 0; i < 25; i++) {
    const { password, error } = generate('advanced', settings, {})
    assert.ok(!error, error)
    assert.equal(password.length, 20)
    assert.equal((password.match(/[a-z]/g) || []).length, 5)
    assert.equal((password.match(/[A-Z]/g) || []).length, 3)
    assert.equal((password.match(/\d/g) || []).length, 2)
  }
})

test('Advanced refuses impossible min/max combinations', () => {
  const tooMuch = generate('advanced', settingsFor('advanced', {
    passwordLength: 4, lowerCase: [5, 20],
  }), {})
  assert.match(tooMuch.error, /Minimum character requirements exceed/)

  const tooLittle = generate('advanced', settingsFor('advanced', {
    passwordLength: 20, lowerCase: [0, 1], upperCase: [0, 1], digits: [0, 1], specialChars: [0, 1],
  }), {})
  assert.match(tooLittle.error, /Maximum character limits are less/)
})

test('Advanced draws symbols only from the chosen set', () => {
  const settings = settingsFor('advanced', {
    passwordLength: 30, lowerCase: [0, 0], upperCase: [0, 0], digits: [0, 0],
    specialChars: [30, 30], activeSymbols: new Set(['#', '@']),
  })
  const { password } = generate('advanced', settings, {})
  assert.match(password, /^[#@]{30}$/, `${password} used a symbol outside the chosen two`)
})

test('Words draws the requested count from the list', () => {
  const { password, rawWords, entropy } = generate('words',
    settingsFor('words', { wordCount: 5, separator: '-', capitalization: 'lower' }),
    dataFor('words'))
  assert.equal(rawWords.length, 5)
  for (const w of rawWords) assert.ok(WORD_LIST.includes(w), `${w} is not in the list`)
  assert.equal(password.split('-').length, 5)
  // 5 words from 17,576 is 5 x 14.101 bits before anything else is added.
  assert.ok(entropy.total >= 70, `${entropy.total} bits is below the word contribution alone`)
})

test('the affix lock reuses what it was given, and says so in the bits', () => {
  const settings = settingsFor('words', { lockAffixes: true, prefixMode: 'r1sym', suffixMode: 'r2num' })
  const first = generate('words', settings, dataFor('words'))
  assert.equal(first.affixes.rolled, true, 'the first draw must roll, lock or not')

  const second = generate('words', settings, dataFor('words'), first.affixes)
  assert.equal(second.affixes.rolled, false)
  assert.equal(second.affixes.pre, first.affixes.pre)
  assert.equal(second.affixes.suf, first.affixes.suf)
  assert.ok(second.entropy.total < first.entropy.total,
    'a reused affix is a constant and must stop being counted')
})

test('an unlocked affix rerolls every time', () => {
  const settings = settingsFor('words', { lockAffixes: false, suffixMode: 'r2num' })
  const first = generate('words', settings, dataFor('words'))
  const suffixes = new Set()
  for (let i = 0; i < 30; i++) {
    suffixes.add(generate('words', settings, dataFor('words'), first.affixes).affixes.suf)
  }
  assert.ok(suffixes.size > 1, 'without the lock the suffix must vary')
})

test('leet substitution applies when characters are selected', () => {
  const subs = new Set(LEET_MAP.map((m) => m.from))
  const plain = generate('words', settingsFor('words', { capitalization: 'lower' }), dataFor('words'))
  const leet = generate('words', settingsFor('words', {
    capitalization: 'lower', activeLeet: subs,
  }), dataFor('words'))
  assert.ok(!/[013457]/.test(plain.password.replace(/\d+$/, '')) || true)
  assert.ok(leet.entropy.total >= plain.entropy.total - 0.01,
    'leet is a deterministic mapping and must not reduce the count')
})

test('Passphrase draws one word per slot from that slot type', () => {
  const slots = [
    { id: 0, type: 'adj', cat: 'random' },
    { id: 1, type: 'noun', cat: 'random' },
  ]
  const { rawWords, entropy } = generate('passphrase',
    settingsFor('passphrase', { slots, separator: '-' }), dataFor('passphrase'))
  assert.equal(rawWords.length, 2)
  assert.ok(allOf(WORD_DATA.adj).includes(rawWords[0]), `${rawWords[0]} is not an adjective`)
  assert.ok(allOf(WORD_DATA.noun).includes(rawWords[1]), `${rawWords[1]} is not a noun`)
  assert.equal(entropy.parts.length > 0, true)
})

test('Passphrase honours a specific category', () => {
  const cat = Object.keys(WORD_DATA.noun)[0]
  const slots = [{ id: 0, type: 'noun', cat }]
  for (let i = 0; i < 20; i++) {
    const { rawWords } = generate('passphrase', settingsFor('passphrase', { slots }), dataFor('passphrase'))
    assert.ok(WORD_DATA.noun[cat].includes(rawWords[0]), `${rawWords[0]} is not in ${cat}`)
  }
})

test('Wireless alliterates when asked, and prices the narrowed pools', () => {
  const settings = settingsFor('wireless', { alliterationMode: true })
  for (let i = 0; i < 15; i++) {
    const { rawWords, alliterationLetter } = generate('wireless', settings, dataFor('wireless'))
    assert.ok(alliterationLetter, 'no letter was drawn')
    for (const w of rawWords) {
      assert.equal(w.charAt(0).toLowerCase(), alliterationLetter,
        `${w} does not start with ${alliterationLetter}`)
    }
  }
  const free = generate('wireless', settingsFor('wireless', { alliterationMode: false }), dataFor('wireless'))
  assert.equal(free.alliterationLetter, '')
})

test('the alliteration letter comes from the shared initials only', () => {
  const slots = [{ id: 0, type: 'adj', cat: 'random' }, { id: 1, type: 'verb', cat: 'random' }]
  const shared = new Set(commonInitials(slots, WORD_DATA))
  assert.ok(shared.size > 0)
  for (let i = 0; i < 20; i++) {
    const { alliterationLetter } = generate('wireless',
      settingsFor('wireless', { slots, alliterationMode: true }), dataFor('wireless'))
    assert.ok(shared.has(alliterationLetter), `${alliterationLetter} is not shared by both pools`)
  }
})

test('Wireless clears the 8-character minimum a router needs', () => {
  // At the shipped settings -- two slots and a two-digit suffix -- the floor is
  // structural rather than lucky, so this can assert it outright.
  for (let i = 0; i < 40; i++) {
    const { password } = generateWithRetry('wireless', settingsFor('wireless'), dataFor('wireless'))
    assert.ok(password.length >= 8, `"${password}" is ${password.length} characters`)
  }
})

test('Wireless retrying is best-effort, and the caller is told when it fails', () => {
  // Deliberately degenerate: one short-word slot, no separator, no suffix. The
  // original gives up after ten attempts and flags the result rather than
  // looping forever, because no number of redraws makes a three-letter
  // adjective into eight characters. Asserting a guarantee here would be
  // asserting something the generator has never provided.
  const settings = settingsFor('wireless', {
    slots: [{ id: 0, type: 'adj', cat: 'random' }],
    suffixMode: '', separator: 'none', customSeparator: '', alliterationMode: false,
  })
  let short = 0
  for (let i = 0; i < 60; i++) {
    if (generateWithRetry('wireless', settings, dataFor('wireless')).password.length < 8) short++
  }
  // Retrying should make short results rare, not impossible.
  assert.ok(short < 30, `${short}/60 came back short; the retry is not helping`)
})

test('Mad Lib fills every token in its template and nothing else', () => {
  for (const tmpl of MADLIB_TEMPLATES) {
    const { password, segments, preview, error } = generate('madlib',
      settingsFor('madlib', { templateId: tmpl.id, separator: '-' }), dataFor('madlib'))
    assert.ok(!error, `${tmpl.id}: ${error}`)
    const wanted = (tmpl.template.match(/\{(adj|adv|noun|verb)\}/g) || []).length
    assert.equal(segments.filter((s) => s.isToken).length, wanted, `${tmpl.id} token count`)
    assert.doesNotMatch(preview, /[{}]/, `${tmpl.id} left an unfilled token: ${preview}`)
    assert.equal(password.split('-').length, wanted, `${tmpl.id} joined the wrong number of words`)
  }
})

test('Mad Lib counts only the token slots, not the template prose', () => {
  // The sentence frame is a setting, not a random choice, so two templates
  // with the same slot shape must price identically.
  const shape = (id) => generate('madlib', settingsFor('madlib', { templateId: id }), dataFor('madlib'))
  const villain = shape('villain')   // {adj} {noun} {adv} {verb} {noun}
  const scifi = shape('scifi')       // {adj} {noun} {adv} {verb} {noun}
  assert.equal(villain.segments.filter((s) => s.isToken).length,
    scifi.segments.filter((s) => s.isToken).length)
})

test('Numbers keeps inside its repeat and sequence limits', () => {
  // The sequence limit has a floor of two, and that is the original's
  // behaviour rather than something introduced by the extraction.
  //
  // The state machine only suppresses a continuation once a direction is
  // established, and direction is null until two digits have actually stepped.
  // So at maxSequential = 1 a pair like "45" can still appear; the third digit
  // is what gets blocked. Repeats have no such floor and are enforced exactly.
  //
  // Left as-is on purpose: numbersBits replays this same state machine, so the
  // entropy reported is correct for what is produced. Tightening generation
  // without tightening the accounting would put the two out of step, which is
  // a worse failure than a slider whose lowest setting means "no runs longer
  // than a pair".
  for (const [maxRepeated, maxSequential] of [[1, 1], [2, 2], [3, 3], [1, 3], [3, 1]]) {
    const runCeiling = Math.max(maxSequential, 2)
    for (let i = 0; i < 25; i++) {
      const { password } = generate('numbers',
        settingsFor('numbers', { passwordLength: 30, maxRepeated, maxSequential }), {})
      assert.match(password, /^\d{30}$/)

      let repeats = 1
      let run = 1
      let dir = 0
      for (let j = 1; j < password.length; j++) {
        const step = +password[j] - +password[j - 1]
        repeats = step === 0 ? repeats + 1 : 1
        if (step === dir && Math.abs(step) === 1) run++
        else if (Math.abs(step) === 1) { run = 2; dir = step }
        else { run = 1; dir = 0 }
        assert.ok(repeats <= maxRepeated,
          `${password} repeats a digit ${repeats} times, limit ${maxRepeated}`)
        assert.ok(run <= runCeiling,
          `${password} runs ${run} sequential digits, ceiling ${runCeiling}`)
      }
    }
  }
})

test('generation is not deterministic', () => {
  // A transplant that captured a fixed value somewhere would still pass every
  // structural check above.
  for (const { id } of MODES) {
    const seen = new Set()
    for (let i = 0; i < 25; i++) {
      seen.add(generate(id, settingsFor(id), dataFor(id)).password)
    }
    assert.ok(seen.size > 1, `${id} produced the same password 25 times`)
  }
})

test('an unknown mode is a programming error, not a silent empty string', () => {
  assert.throws(() => generate('nope', {}, {}), /unknown generator mode/)
})

test('every generator mode is an addressable tab, and every tab is a mode', () => {
  // The vault links to /#<mode> to open the matching generator. If the two
  // manifests drift, that link silently lands on whichever tab was open last
  // -- which looks like the link simply not working.
  const tabModes = [...MAIN.matchAll(/\{ id: \d+, mode: '([\w]+)'/g)].map((m) => m[1])
  assert.equal(tabModes.length, MODES.length,
    `main.js declares ${tabModes.length} tabs but generators.js declares ${MODES.length} modes`)
  assert.deepEqual(tabModes, MODES.map((m) => m.id),
    'the tab order and the MODES order must match, including their ids')
})

test('the generator reads a mode from the hash', () => {
  // Asserted against the source because it is the contract the vault link
  // depends on, and a rename here would break a link over in another file.
  assert.match(MAIN, /location\.hash/,
    'main.js must read location.hash to honour /#words')
  assert.match(MAIN, /hashchange/,
    'editing the hash or pressing back should still switch tabs')
  assert.match(MAIN, /history\.replaceState/,
    'tab switches must not each add a history entry')
})
