// The seven generators, as pure functions.
//
// These lived as closures inside main.js's Vue components -- each
// `generatePassword` read reactive refs, wrote reactive refs, and raised
// notifications, so nothing outside that file could produce a password. That
// was fine while the generator was the whole product. The vault needs to
// generate into its own password fields, and the choice was to duplicate the
// logic or to lift it out; duplicated generation is how two code paths end up
// disagreeing about entropy, which is the one number this site cannot get
// wrong.
//
// So: settings in, password out. No Vue, no DOM, no storage writes. The bits
// were already pure in entropy.js and are simply called from here, which is
// what keeps the vault's figures exactly as trustworthy as the generator's.
//
// Two pieces of state deliberately stay with the caller:
//
//   Affix locking. The generator can pin a prefix/separator/suffix across
//   generations, which is a property of a session rather than of a draw. Pass
//   the previously used `affixes` back in to reuse them; every call returns
//   the ones it used so the caller can hold them.
//
//   Word data. Two files, fetched once. `loadWordData()` caches, so a page
//   with several generators pays for it once, but the caller decides when.
//
//   That was true of this module and false of the product for months. When
//   these loaders were extracted here, four component-local copies were left
//   behind in main.js -- one per word-based generator, each fetching straight
//   from ./data/ with no cache at all. So Passphrase, Wireless and Mad Lib
//   each refetched words.json on every mount: cycling the tabs twice cost nine
//   requests and 264 KB where two and 73 KB were needed. Noticed from a
//   network tab, not from reading this comment, which said the opposite.
//
//   There is a test now that no component fetches /data directly.

import {
  randInt, randPick, randChar, stripAmbiguous, pickEmoji, applyCapitalization,
  applyLeet, resolveToken, resolveSuffixToken, isPerGapSeparator, joinPerGap,
  EMOJI_POOLS,
} from './lib.js'
import {
  simpleBits, advancedBits, wordsBits, slotBits, wirelessBits, numbersBits,
} from './entropy.js'

/**
 * The modes, in the order the generator's tabs present them.
 *
 * `prefix` is the localStorage namespace each one's settings live under, which
 * is what lets readSettings() pick up whatever the user last chose on the
 * generator page without either side knowing about the other.
 */
export const MODES = [
  { id: 'simple', label: 'Simple', prefix: 'simple', icon: 'mdi-key-outline' },
  { id: 'advanced', label: 'Advanced', prefix: 'adv', icon: 'mdi-tune-variant' },
  { id: 'words', label: 'Words', prefix: 'words', icon: 'mdi-text-short' },
  { id: 'passphrase', label: 'Passphrase', prefix: 'phrase', icon: 'mdi-format-list-bulleted' },
  { id: 'wireless', label: 'Wireless', prefix: 'wifi', icon: 'mdi-wifi' },
  { id: 'madlib', label: 'Mad Lib', prefix: 'madlib', icon: 'mdi-book-open-page-variant-outline' },
  { id: 'numbers', label: 'Numbers', prefix: 'nums', icon: 'mdi-numeric' },
]

export const isMode = (id) => MODES.some((m) => m.id === id)

export const ALL_SYMBOLS = '!#$%&()*+,-./:;<=>?@[]^_`{|}~'.split('')

const CHARACTER_SETS = {
  lower: 'abcdefghijklmnopqrstuvwxyz',
  upper: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
  digits: '0123456789',
  special: '!#$%&()*+,-./:;<=>?@[]^_`{|}~',
}

/** Simple's symbol pool differs from Advanced's -- it is a fixed wider set. */
const SIMPLE_SPECIAL = '!#$%&()*+,-./:;<=>?@[]^_`{|}~'

/**
 * Mad Lib's sentence frames. Moved here from main.js because the template is
 * an input to generation, not a piece of the generator's UI -- the vault has
 * to be able to name one without importing three thousand lines of Vue.
 */
export const MADLIB_TEMPLATES = [
  { id: 'hero',      label: 'The Hero',       template: 'The {adj} {noun} {adv} {verb} the {adj} {noun}' },
  { id: 'villain',   label: 'The Villain',    template: 'A {adj} {noun} {adv} {verb} every {noun}' },
  { id: 'quest',     label: 'The Quest',      template: '{noun} {adv} {verb} beyond the {adj} {noun}' },
  { id: 'science',   label: 'Science!',       template: 'The {adj} {noun} {adv} {verb} any {noun}' },
  { id: 'proverb',   label: 'Wise Proverb',   template: 'A {adj} {noun} {adv} {verb} alone' },
  { id: 'news',      label: 'Breaking News',  template: '{adj} {noun} {adv} {verb} the {noun}' },
  { id: 'haiku',     label: 'Haiku-ish',      template: '{adj} {noun} {adv} {verb}' },
  { id: 'epic',      label: 'Epic Tale',      template: '{noun} and {noun} {adv} {verb} the {adj} world' },
  { id: 'mystery',   label: 'Mystery',        template: 'A {noun} {adv} {verb} the {adj} {noun}' },
  { id: 'romance',   label: 'Romance',        template: 'The {adj} {noun} {adv} {verb} a {adj} {noun}' },
  { id: 'scifi',     label: 'Sci-Fi',         template: '{adj} {noun} {adv} {verb} every {noun}' },
  { id: 'fable',     label: 'Fable',          template: 'Once the {adj} {noun} {adv} {verb} alone' },
]

/**
 * Defaults, mirroring main.js's persistedRef fallbacks exactly.
 *
 * Duplicated values are a drift risk, so generators.test.js asserts these
 * match the persistedRef calls in main.js rather than trusting the comment.
 */
export const DEFAULTS = {
  simple: {
    passwordLength: 20, lowerCase: true, upperCase: true, digits: true,
    specialChars: true, useEmoji: false, excludeAmbiguous: false,
  },
  advanced: {
    passwordLength: 20, lowerCase: [1, 20], upperCase: [1, 20], digits: [1, 20],
    specialChars: [1, 20], activeSymbols: null, emojiCount: [0, 0], excludeAmbiguous: false,
  },
  words: {
    wordCount: 4, separator: '$', customSeparator: '', capitalization: 'title',
    prefixMode: '', prefixCustom: '', suffixMode: '', suffixCustom: '',
    activeLeet: null, useEmoji: false, lockAffixes: false, excludeAmbiguous: false,
  },
  passphrase: {
    slots: [{ id: 0, type: 'adj', cat: 'random' }, { id: 1, type: 'noun', cat: 'random' }, { id: 2, type: 'verb', cat: 'random' }],
    separator: '$', customSeparator: '', capitalization: 'upper',
    prefixMode: '', prefixCustom: '', suffixMode: '', suffixCustom: '',
    activeLeet: null, useEmoji: false, lockAffixes: false, excludeAmbiguous: false,
  },
  wireless: {
    slots: [{ id: 0, type: 'adj', cat: 'random' }, { id: 1, type: 'noun', cat: 'random' }],
    separator: '-', customSeparator: '', capitalization: 'title',
    prefixMode: '', prefixCustom: '', suffixMode: 'r2num', suffixCustom: '',
    activeLeet: null, useEmoji: false, lockAffixes: false, excludeAmbiguous: true,
    alliterationMode: true,
  },
  madlib: {
    templateId: 'hero', slotCats: [], separator: '-', customSeparator: '',
    capitalization: 'title', prefixMode: '', prefixCustom: '', suffixMode: '',
    suffixCustom: '', activeLeet: null, useEmoji: false, lockAffixes: false,
    excludeAmbiguous: false,
  },
  numbers: { passwordLength: 8, maxRepeated: 3, maxSequential: 3 },
}

export const allOf = (cats) => [...new Set(Object.values(cats).flat())]

// --- shared assembly ---------------------------------------------------------

/**
 * Roll the prefix, separator and suffix, or reuse the ones handed in.
 *
 * The lock is the caller's state: main.js holds it for the session, the vault
 * always rolls fresh. Note the original's subtlety -- a locked affix set that
 * has never been rolled must still roll once, which falls out of `held` being
 * null on the first call.
 */
const resolveAffixes = (s, held) => {
  if (s.lockAffixes && held) return { ...held, rolled: false }
  const pre = resolveToken(s.prefixMode, s.prefixCustom, s.excludeAmbiguous)
  return {
    pre,
    suf: resolveSuffixToken(s.suffixMode, s.suffixCustom, pre, s.excludeAmbiguous),
    sep: resolveToken(s.separator, s.customSeparator, s.excludeAmbiguous),
    rolled: true,
  }
}

/** Cased words -> separator-joined -> affixed -> leet. Shared by four modes. */
const assemble = (words, s, affixes) => {
  const joined = isPerGapSeparator(s.separator)
    ? joinPerGap(words, s.separator, s.excludeAmbiguous)
    : words.join(affixes.sep)
  const full = affixes.pre + joined + affixes.suf
  return s.activeLeet.size > 0 ? applyLeet(full, s.activeLeet) : full
}

const titleCase = (w) => (w ? w.charAt(0).toUpperCase() + w.slice(1).toLowerCase() : '')

/** The emoji category a slot contributes, mirroring pickEmoji's own fallback. */
const emojiCatOf = (slot) => (slot?.cat === 'random' ? slot?.type : (slot?.cat || 'default'))

const slotPool = (wordData, type, cat) => {
  const cats = wordData?.[type] || {}
  return cat === 'random' ? allOf(cats) : (cats[cat] || allOf(cats))
}

// --- the generators ----------------------------------------------------------

const generateSimple = (s) => {
  const types = []
  if (s.lowerCase) types.push('lower')
  if (s.upperCase) types.push('upper')
  if (s.digits) types.push('digits')
  if (s.specialChars) types.push('special')
  if (s.useEmoji) types.push('emoji')
  if (!types.length) return { error: 'Please select at least one character type' }

  const full = { ...CHARACTER_SETS, special: SIMPLE_SPECIAL }
  const sets = s.excludeAmbiguous
    ? {
        lower: stripAmbiguous(full.lower), upper: stripAmbiguous(full.upper),
        digits: stripAmbiguous(full.digits), special: stripAmbiguous(full.special),
      }
    : full

  let password = ''
  for (let i = 0; i < parseInt(s.passwordLength); i++) {
    switch (randPick(types)) {
      case 'lower': password += randChar(sets.lower); break
      case 'upper': password += randChar(sets.upper); break
      case 'digits': password += randChar(sets.digits); break
      case 'special': password += randChar(sets.special); break
      case 'emoji': password += pickEmoji('default'); break
    }
  }

  const setSizes = []
  const fullSizes = []
  if (s.lowerCase) { setSizes.push(sets.lower.length); fullSizes.push(full.lower.length) }
  if (s.upperCase) { setSizes.push(sets.upper.length); fullSizes.push(full.upper.length) }
  if (s.digits) { setSizes.push(sets.digits.length); fullSizes.push(full.digits.length) }
  if (s.specialChars) { setSizes.push(sets.special.length); fullSizes.push(full.special.length) }
  if (s.useEmoji) { setSizes.push(EMOJI_POOLS.default.length); fullSizes.push(EMOJI_POOLS.default.length) }

  return {
    password,
    entropy: simpleBits({
      length: parseInt(s.passwordLength),
      setSizes,
      fullSetSizes: s.excludeAmbiguous ? fullSizes : undefined,
    }),
  }
}

const generateAdvanced = (s) => {
  const len = parseInt(s.passwordLength)
  if (len === 0) return { password: '', entropy: null }

  const [emMin, emMax] = s.emojiCount.map((n) => parseInt(n))
  const [lcMin, lcMax] = s.lowerCase.map((n) => parseInt(n))
  const [ucMin, ucMax] = s.upperCase.map((n) => parseInt(n))
  const [dgMin, dgMax] = s.digits.map((n) => parseInt(n))
  const [spMin, spMax] = s.specialChars.map((n) => parseInt(n))

  if (lcMin + ucMin + dgMin + spMin + emMin > len) {
    return { error: 'Minimum character requirements exceed password length' }
  }
  if (lcMax + ucMax + dgMax + spMax + emMax < len) {
    return { error: 'Maximum character limits are less than password length' }
  }

  const charTypes = []
  for (let i = 0; i < lcMin; i++) charTypes.push('lower')
  for (let i = 0; i < ucMin; i++) charTypes.push('upper')
  for (let i = 0; i < dgMin; i++) charTypes.push('digits')
  for (let i = 0; i < spMin; i++) charTypes.push('special')
  for (let i = 0; i < emMin; i++) charTypes.push('emoji')

  const caps = { lower: lcMax, upper: ucMax, digits: dgMax, special: spMax, emoji: emMax }
  while (charTypes.length < len) {
    const available = Object.keys(caps)
      .filter((t) => charTypes.filter((x) => x === t).length < caps[t])
    if (!available.length) break
    charTypes.push(randPick(available))
  }

  for (let i = charTypes.length - 1; i > 0; i--) {
    const j = randInt(i + 1)
    ;[charTypes[i], charTypes[j]] = [charTypes[j], charTypes[i]]
  }

  const customSymbols = ALL_SYMBOLS.filter((sym) => s.activeSymbols.has(sym)).join('')
  const sets = s.excludeAmbiguous
    ? {
        lower: stripAmbiguous(CHARACTER_SETS.lower),
        upper: stripAmbiguous(CHARACTER_SETS.upper),
        digits: stripAmbiguous(CHARACTER_SETS.digits),
      }
    : CHARACTER_SETS
  // If stripping empties a user-picked symbol set (e.g. only '|' selected),
  // the exclusion cannot apply there; fall back to the set as chosen.
  const symbols = (s.excludeAmbiguous ? stripAmbiguous(customSymbols) : customSymbols) || customSymbols

  let password = ''
  for (const type of charTypes) {
    switch (type) {
      case 'lower': password += randChar(sets.lower); break
      case 'upper': password += randChar(sets.upper); break
      case 'digits': password += randChar(sets.digits); break
      case 'special': password += randChar(symbols); break
      case 'emoji': password += pickEmoji('default'); break
    }
  }

  const typeSpecs = [
    ['lower', 'lowercase', sets.lower.length, CHARACTER_SETS.lower.length],
    ['upper', 'uppercase', sets.upper.length, CHARACTER_SETS.upper.length],
    ['digits', 'digits', sets.digits.length, CHARACTER_SETS.digits.length],
    ['special', 'symbols', Math.max(symbols.length, 1), Math.max(customSymbols.length, 1)],
    ['emoji', 'emoji', EMOJI_POOLS.default.length, EMOJI_POOLS.default.length],
  ]
  return {
    password,
    entropy: advancedBits({
      counts: typeSpecs.map(([key, label, size, fullSize]) => ({
        label, size, count: charTypes.filter((t) => t === key).length,
        fullSize: s.excludeAmbiguous ? fullSize : undefined,
      })),
    }),
  }
}

const drawWords = (s, { wordList }) => {
  if (!wordList || !wordList.length) return { error: 'Word list not loaded' }
  return { raw: Array.from({ length: s.wordCount }, () => randPick(wordList)) }
}

const buildWords = (s, { wordList }, rawWords, held) => {
  const affixes = resolveAffixes(s, held)
  const words = rawWords.map((w, i, arr) => {
    const cased = applyCapitalization(w, s.capitalization, i, arr.length)
    return s.useEmoji ? pickEmoji('default') + cased : cased
  })
  return {
    password: assemble(words, s, affixes),
    rawWords,
    preview: rawWords.map(titleCase).join(' '),
    affixes,
    entropy: wordsBits({
      wordCount: rawWords.length,
      listSize: Math.max(wordList.length, 1),
      capitalization: s.capitalization,
      letterCount: rawWords.join('').length,
      separator: s.separator,
      prefix: s.prefixMode,
      suffix: s.suffixMode,
      emoji: s.useEmoji,
      leetActive: s.activeLeet.size,
      affixesLocked: !affixes.rolled,
      ambiguousExcluded: s.excludeAmbiguous,
    }),
  }
}

const drawPassphrase = (s, { wordData }) => {
  if (!s.slots.length) return { error: 'Add at least one word slot' }
  return {
    raw: s.slots.map((slot) => {
      const pool = slotPool(wordData, slot.type, slot.cat)
      return pool.length ? randPick(pool) : slot.type
    }),
  }
}

const buildPassphrase = (s, { wordData }, rawWords, held) => {
  const affixes = resolveAffixes(s, held)
  const words = rawWords.map((w, i, arr) => {
    const cased = applyCapitalization(w, s.capitalization, i, arr.length)
    return s.useEmoji ? pickEmoji(emojiCatOf(s.slots[i])) + cased : cased
  })
  const slotInfos = s.slots.map((slot) => ({
    label: slot.cat === 'random' ? slot.type : `${slot.type} · ${slot.cat}`,
    poolSize: Math.max(slotPool(wordData, slot.type, slot.cat).length, 1),
    emojiPoolSize: (EMOJI_POOLS[emojiCatOf(slot)] || EMOJI_POOLS.default).length,
  }))
  return {
    password: assemble(words, s, affixes),
    rawWords,
    preview: rawWords.map(titleCase).join(' '),
    affixes,
    entropy: slotBits({
      slots: slotInfos,
      capitalization: s.capitalization,
      letterCount: rawWords.join('').length,
      separator: s.separator,
      prefix: s.prefixMode,
      suffix: s.suffixMode,
      emoji: s.useEmoji,
      leetActive: s.activeLeet.size,
      affixesLocked: !affixes.rolled,
      ambiguousExcluded: s.excludeAmbiguous,
    }),
  }
}

/** The letters every slot's pool can start with, for alliteration. */
export const commonInitials = (slots, wordData) => {
  const pools = slots.map((slot) =>
    new Set(slotPool(wordData, slot.type, slot.cat).map((w) => w.charAt(0).toLowerCase())))
  if (!pools.length) return []
  return [...pools[0]].filter((l) => pools.every((p) => p.has(l)))
}

/** One word for one Wireless slot, optionally forced to an initial letter. */
export const drawWirelessWord = (slot, wordData, letter = '') => {
  let pool = slotPool(wordData, slot.type, slot.cat)
    .filter((w) => typeof w === 'string' && w.length > 0)
  if (letter) {
    const filtered = pool.filter((w) => w.charAt(0).toLowerCase() === letter)
    if (filtered.length) pool = filtered
  }
  return pool.length ? randPick(pool) : slot.type
}

const drawWireless = (s, { wordData }) => {
  if (!s.slots.length) return { error: 'Add at least one word slot' }
  const common = s.alliterationMode ? commonInitials(s.slots, wordData) : []
  const letter = common.length ? randPick(common) : ''
  return {
    raw: s.slots.map((slot) => drawWirelessWord(slot, wordData, letter)),
    letter,
  }
}

const buildWireless = (s, { wordData }, rawWords, held, letter = '') => {
  const common = s.alliterationMode ? commonInitials(s.slots, wordData) : []
  const affixes = resolveAffixes(s, held)
  const words = rawWords.map((w, i, arr) => {
    const cased = applyCapitalization(w || '', s.capitalization, i, arr.length)
    return s.useEmoji ? pickEmoji(emojiCatOf(s.slots[i])) + cased : cased
  })

  const slotInfos = s.slots.map((slot) => {
    const freePool = slotPool(wordData, slot.type, slot.cat)
    const pool = letter ? freePool.filter((w) => w.charAt(0).toLowerCase() === letter) : freePool
    return {
      label: slot.cat === 'random' ? slot.type : `${slot.type} · ${slot.cat}`,
      poolSize: Math.max(pool.length, 1),
      freePoolSize: Math.max(freePool.length, 1),
      letter,
      emojiPoolSize: (EMOJI_POOLS[emojiCatOf(slot)] || EMOJI_POOLS.default).length,
    }
  })

  return {
    password: assemble(words, s, affixes),
    rawWords,
    preview: rawWords.map(titleCase).join(' '),
    affixes,
    alliterationLetter: letter,
    entropy: wirelessBits({
      alliteration: !!letter,
      commonLetters: Math.max(common.length, 1),
      slots: slotInfos,
      capitalization: s.capitalization,
      letterCount: rawWords.join('').length,
      separator: s.separator,
      prefix: s.prefixMode,
      suffix: s.suffixMode,
      emoji: s.useEmoji,
      leetActive: s.activeLeet.size,
      affixesLocked: !affixes.rolled,
      ambiguousExcluded: s.excludeAmbiguous,
    }),
  }
}

/** One word for one Mad Lib token, honouring that token's chosen category. */
export const drawMadlibWord = (seg, slotCats, wordData) => {
  const entry = slotCats.find((c) => c.type === seg.type && c.occurrence === seg.occurrence)
  const pool = slotPool(wordData, seg.type, entry?.cat ?? 'random')
  return (pool.length ? randPick(pool) : '') || ''
}

const drawMadlib = (s, { wordData, templates = MADLIB_TEMPLATES }) => {
  const tmpl = templates.find((t) => t.id === s.templateId)
  if (!tmpl) return { error: 'Unknown template' }
  const occurrences = {}
  return {
    raw: tmpl.template.split(/(\{[^}]+\})/).map((part) => {
      const m = part.match(/^\{(adj|adv|noun|verb)\}$/)
      if (!m) return { word: part, isToken: false }
      const type = m[1]
      occurrences[type] = (occurrences[type] || 0) + 1
      const seg = { isToken: true, type, occurrence: occurrences[type] }
      return { ...seg, word: drawMadlibWord(seg, s.slotCats, wordData) }
    }),
  }
}

const buildMadlib = (s, { wordData }, segments, held) => {
  const affixes = resolveAffixes(s, held)
  const tokenSegs = segments.filter((seg) => seg.isToken)
  let wordIndex = 0
  const filled = segments.map((seg) =>
    (seg.isToken ? applyCapitalization(seg.word, s.capitalization, wordIndex++, tokenSegs.length) : seg.word))

  const words = filled.filter((_, i) => segments[i]?.isToken).map((w, i) => {
    if (!s.useEmoji) return w
    const seg = tokenSegs[i]
    const entry = s.slotCats.find((c) => c.type === seg?.type && c.occurrence === seg?.occurrence)
    const cat = entry?.cat === 'random' ? (seg?.type || 'default') : (entry?.cat || seg?.type || 'default')
    return pickEmoji(cat) + w
  })

  const slotInfos = tokenSegs.map((seg) => {
    const entry = s.slotCats.find((c) => c.type === seg.type && c.occurrence === seg.occurrence)
    const cat = entry?.cat ?? 'random'
    return {
      label: cat === 'random' ? seg.type : `${seg.type} · ${cat}`,
      poolSize: Math.max(slotPool(wordData, seg.type, cat).length, 1),
      emojiPoolSize: (EMOJI_POOLS[cat === 'random' ? (seg.type || 'default') : cat] || EMOJI_POOLS.default).length,
    }
  })

  return {
    password: assemble(words, s, affixes),
    segments,
    preview: filled.join(''),
    affixes,
    entropy: slotBits({
      slots: slotInfos,
      capitalization: s.capitalization,
      letterCount: tokenSegs.map((seg) => seg.word).join('').length,
      separator: s.separator,
      prefix: s.prefixMode,
      suffix: s.suffixMode,
      emoji: s.useEmoji,
      leetActive: s.activeLeet.size,
      affixesLocked: !affixes.rolled,
      ambiguousExcluded: s.excludeAmbiguous,
    }),
  }
}

const generateNumbers = (s) => {
  const maxRepeated = parseInt(s.maxRepeated)
  const maxSequential = parseInt(s.maxSequential)
  let password = ''
  let repeated = 0
  let sequential = 0
  let direction = null

  for (let i = 0; i < s.passwordLength; i++) {
    let available = '0123456789'
    const last = password.slice(-1)
    if (last) {
      const lastNum = parseInt(last)
      if (repeated >= maxRepeated) available = available.replace(last, '')
      if (sequential >= maxSequential) {
        if (direction === 'up' && lastNum < 9) available = available.replace(String(lastNum + 1), '')
        if (direction === 'down' && lastNum > 0) available = available.replace(String(lastNum - 1), '')
      }
    }
    if (!available.length) available = '0123456789'

    const next = randChar(available)
    password += next

    if (last) {
      const lastNum = parseInt(last)
      const nextNum = parseInt(next)
      if (next === last) {
        repeated++; sequential = 1; direction = null
      } else if (nextNum === lastNum + 1) {
        if (direction === 'up') sequential++
        else { sequential = 2; direction = 'up' }
        repeated = 1
      } else if (nextNum === lastNum - 1) {
        if (direction === 'down') sequential++
        else { sequential = 2; direction = 'down' }
        repeated = 1
      } else {
        repeated = 1; sequential = 1; direction = null
      }
    } else {
      repeated = 1; sequential = 1
    }
  }

  return { password, entropy: numbersBits({ password, maxRepeated, maxSequential }) }
}

/**
 * Drawing and assembling are separate for the four word-based modes, because
 * the generator lets you reroll a single word and keep the rest. That is not a
 * fresh generation -- the other words, and a locked affix set, have to survive
 * it -- so the split mirrors what main.js already did with generatePassword()
 * and buildPassword(). The character modes have nothing to reroll and so have
 * no draw step.
 */
const DRAW = {
  words: drawWords,
  passphrase: drawPassphrase,
  wireless: drawWireless,
  madlib: drawMadlib,
}

const BUILD = {
  simple: (s) => generateSimple(s),
  advanced: (s) => generateAdvanced(s),
  numbers: (s) => generateNumbers(s),
  words: buildWords,
  passphrase: buildPassphrase,
  wireless: buildWireless,
  madlib: buildMadlib,
}

/** Draw the raw words (or segments) a build will assemble. */
export const draw = (modeId, settings, data = {}) => {
  const fn = DRAW[modeId]
  if (!fn) return { raw: null }
  return fn(settings, data)
}

/**
 * Assemble a password from already-drawn words.
 *
 * @param raw    what draw() returned, or the same list with one word replaced
 * @param held   previously used affixes, to honour the affix lock
 * @param extra  mode-specific carry-over -- Wireless's alliteration letter
 */
export const build = (modeId, settings, data = {}, raw = null, held = null, extra = '') => {
  const fn = BUILD[modeId]
  if (!fn) throw new Error(`unknown generator mode: ${modeId}`)
  return fn(settings, data, raw, held, extra)
}

/**
 * Generate one password: draw, then build.
 *
 * @param modeId   one of MODES
 * @param settings from readSettings(), or hand-built
 * @param data     { wordList, wordData, templates } from loadData()
 * @param held     previously used affixes, to honour the affix lock
 * @returns { password, entropy, error? } plus mode-specific extras
 *
 * Errors are returned rather than thrown, because every one of them is a
 * settings conflict the user can fix -- "minimums exceed length" is a
 * sentence for the UI, not an exception.
 */
export const generate = (modeId, settings, data = {}, held = null) => {
  if (!BUILD[modeId]) throw new Error(`unknown generator mode: ${modeId}`)
  const drawn = draw(modeId, settings, data)
  if (drawn.error) return { error: drawn.error }
  return build(modeId, settings, data, drawn.raw, held, drawn.letter || '')
}

/**
 * Wireless enforces an 8-character minimum by retrying, because a short WiFi
 * key is rejected by the router rather than merely weak. Kept here so both
 * callers get the same behaviour.
 */
export const WIRELESS_MIN = 8
export const generateWithRetry = (modeId, settings, data, held = null, limit = 10) => {
  let result = generate(modeId, settings, data, held)
  if (modeId !== 'wireless') return result
  for (let i = 0; i < limit && !result.error && result.password.length < WIRELESS_MIN; i++) {
    result = generate(modeId, settings, data, held)
  }
  return result
}
