// Entropy accounting for every generator -- ROADMAP 6a/6b.
//
// The rule here is that bits are computed from what the code actually does,
// not from an idealised model of it. Each function mirrors one generator's
// real sequence of random draws, and the tests in test/entropy.test.js verify
// exactness where it can be verified (the probabilities of every reachable
// output summing to 1).
//
// Everything returns a breakdown: { total, parts: [{ label, bits, note }] }.
// Parts with 0 bits are included on purpose -- showing that Title Case or
// leet substitution contributes nothing IS the feature (6b), not noise.

import { SPECIAL_CHARS, DIGITS, EMOJI_POOLS, PER_GAP_SEPARATORS, stripAmbiguous } from './lib.js'

// Grouped by what confuses with what, which is easier to read than the raw
// character list: 0 vs O, and the four vertical strokes.
export const AMBIGUOUS_LABEL = '0/O, 1/l/I/|'

const log2 = Math.log2

/** log2(n!) via lgamma-free summation; n <= a few hundred here. */
const log2Factorial = (n) => {
  let s = 0
  for (let i = 2; i <= n; i++) s += log2(i)
  return s
}

/** log2 of the multinomial coefficient n! / prod(k_i!). */
export const log2Multinomial = (counts) => {
  const n = counts.reduce((a, b) => a + b, 0)
  let s = log2Factorial(n)
  for (const k of counts) s -= log2Factorial(k)
  return s
}

const part = (label, bits, note) => ({ label, bits, note })
const finish = (parts) => ({
  total: parts.reduce((s, p) => s + p.bits, 0),
  parts,
})

// --- affix / separator tokens ----------------------------------------------
// resolveToken draws each character uniformly and independently, ONCE per
// generation (the result is cached and reused for every gap), so a random
// separator contributes its bits once -- not once per gap. The per-gap
// separator modes are the exception: joinPerGap redraws at every gap, so
// they are priced gapCount times.
const SYM = log2(SPECIAL_CHARS.length) // 18 symbols
const NUM = log2(DIGITS.length)        // 10 digits
// 6g: with look-alikes excluded the random pools shrink ('|' leaves the
// symbols, '0' and '1' the digits) and every draw is worth a little less.
const SYM_X = log2(stripAmbiguous(SPECIAL_CHARS).length) // 17
const NUM_X = log2(stripAmbiguous(DIGITS).length)        // 8

export const tokenBits = (value, ambiguousExcluded = false) => {
  const S = ambiguousExcluded ? SYM_X : SYM
  const N = ambiguousExcluded ? NUM_X : NUM
  switch (value) {
    case 'r1sym': return S
    case 'r2sym': return 2 * S
    case 'r1num': return N
    case 'r2num': return 2 * N
    case 'r1s1n': case 'r1n1s': return S + N
    case 'r2s2n': case 'r2n2s': return 2 * S + 2 * N
    default: return 0 // literals, custom strings, and '' are constants
  }
}

/**
 * Suffix tokens: 'mirror' copies the prefix (0 new bits); 'mirror-newdig'
 * redraws each digit in the prefix, so its bits depend on the prefix token.
 */
// With the affix lock held, the cached prefix/suffix/separator are reused
// verbatim from an earlier generation -- constants now, so they honestly add
// nothing. Per-gap separators are the exception: they bypass the cache and
// redraw every build, locked or not.
const LOCKED_NOTE = 'locked — reused, adds nothing'

const separatorPart = (separator, gapCount, locked, excl) => {
  const base = PER_GAP_SEPARATORS[separator]
  if (base) {
    const per = tokenBits(base, excl)
    return part(`separator (${gapCount} × ${per.toFixed(2)})`, gapCount * per, 'a new draw at every gap')
  }
  const bits = tokenBits(separator, excl)
  if (locked && bits > 0) return part('separator', 0, LOCKED_NOTE)
  return part('separator', bits, bits === 0 ? 'fixed — adds nothing' : 'drawn once, reused between words')
}

const prefixPart = (prefix, locked, excl) => {
  const bits = tokenBits(prefix, excl)
  if (locked && bits > 0) return part('prefix', 0, LOCKED_NOTE)
  return part('prefix', bits, bits === 0 ? 'none or fixed' : undefined)
}

const suffixPart = (suffix, prefix, locked, excl) => {
  const bits = suffixBits(suffix, prefix, excl)
  if (suffix === 'mirror') return part('suffix', 0, 'copies the prefix — adds nothing')
  if (locked && bits > 0) return part('suffix', 0, LOCKED_NOTE)
  return part('suffix', bits, bits === 0 ? 'none or fixed' : undefined)
}

export const suffixBits = (value, prefixValue, ambiguousExcluded = false) => {
  if (value === 'mirror') return 0
  if (value === 'mirror-newdig') {
    const digitsInPrefix = { r1num: 1, r2num: 2, r1s1n: 1, r1n1s: 1, r2s2n: 2, r2n2s: 2 }[prefixValue] || 0
    return digitsInPrefix * (ambiguousExcluded ? NUM_X : NUM)
  }
  return tokenBits(value, ambiguousExcluded)
}

// --- capitalization -----------------------------------------------------------
// Only two of the ten modes draw randomness. Everything else is a fixed
// transform of the words, worth exactly 0 bits -- and saying so is the point.
export const capitalizationBits = (mode, letterCount, wordCount) => {
  if (mode === 'random') {
    return part('capitalization (random letters)', letterCount, '1 bit per letter')
  }
  if (mode === 'word-random') {
    return part('capitalization (random words)', wordCount, '1 bit per word')
  }
  return part('capitalization', 0, 'deterministic — adds nothing')
}

export const leetPart = (activeCount) =>
  part('leet substitution', 0, activeCount > 0
    ? 'fixed mapping — a → @ every time, adds nothing'
    : 'off')

// --- Simple -------------------------------------------------------------------
/**
 * Simple picks a TYPE uniformly, then a character within that type. Characters
 * are therefore not uniform over the union pool -- a digit is more likely than
 * any given lowercase letter -- and the honest figure is the Shannon entropy of
 * the two-step draw: log2(T) + mean of log2(set size). That is slightly BELOW
 * log2(union size); the naive formula would overstate.
 */
export const simpleBits = ({ length, setSizes, fullSetSizes }) => {
  const T = setSizes.length
  if (T === 0 || length === 0) return finish([part('characters', 0)])
  const perChar = log2(T) + setSizes.reduce((s, n) => s + log2(n), 0) / T
  const parts = [
    part(`characters (${length} × ${perChar.toFixed(2)})`, length * perChar,
      T > 1 ? 'type then character — slightly below a uniform pool' : undefined),
  ]
  parts.push(...exclusionCostPart(length * perChar, length, setSizes, fullSetSizes, length))
  return finish(parts)
}

/**
 * 6g: when look-alikes are excluded, state the measured cost and its remedy in
 * the breakdown -- "costs 2.0 bits" reads as a penalty until you see that one
 * more character more than pays for it.
 */
const exclusionCostPart = (totalBits, drawCount, setSizes, fullSetSizes, length) => {
  if (!fullSetSizes || fullSetSizes.length !== setSizes.length) return []
  const delta = setSizes.reduce((s, n, i) => s + (log2(fullSetSizes[i]) - log2(n)), 0) / setSizes.length
  const cost = drawCount * delta
  if (cost < 0.005) return []
  const perChar = totalBits / length
  return [part(`look-alikes excluded (${AMBIGUOUS_LABEL})`, 0,
    `costs ${cost.toFixed(1)} bits — one more character returns ${perChar.toFixed(1)}`)]
}

// --- Advanced -----------------------------------------------------------------
/**
 * Advanced fixes a type composition (minimums first, then constrained draws),
 * shuffles it uniformly, then draws each character. Given the composition K
 * this password's probability is exactly 1/(multinomial × prod sizes^k); the
 * composition itself also carries some entropy, WHICH THIS OMITS because its
 * distribution has no closed form. The figure is therefore a floor: the true
 * bits are this plus a little. Under-reporting is the safe direction.
 *
 * counts: realized per-type counts for the password just generated.
 */
export const advancedBits = ({ counts }) => {
  const active = counts.filter((c) => c.count > 0)
  const arrangement = log2Multinomial(active.map((c) => c.count))
  const parts = [
    part('arrangement of types', arrangement, 'which positions hold which type'),
  ]
  for (const c of active) {
    parts.push(part(`${c.label} (${c.count} × ${log2(c.size).toFixed(2)})`, c.count * log2(c.size)))
  }
  // 6g: fullSize carries what each set would be without the exclusion, so the
  // cost can be stated rather than silently absorbed into smaller draws.
  const cost = active.reduce((s, c) => s + (c.fullSize && c.fullSize > c.size ? c.count * (log2(c.fullSize) - log2(c.size)) : 0), 0)
  if (cost >= 0.005) {
    const length = active.reduce((s, c) => s + c.count, 0)
    const total = arrangement + active.reduce((s, c) => s + c.count * log2(c.size), 0)
    parts.push(part(`look-alikes excluded (${AMBIGUOUS_LABEL})`, 0,
      `costs ${cost.toFixed(1)} bits — one more character returns ${(total / length).toFixed(1)}`))
  }
  return finish(parts)
}

// --- Words --------------------------------------------------------------------
export const wordsBits = ({ wordCount, listSize, capitalization, letterCount, separator, prefix, suffix, emoji, leetActive, affixesLocked, ambiguousExcluded }) => {
  const gapCount = Math.max(0, wordCount - 1)
  const parts = [
    part(`words (${wordCount} × ${log2(listSize).toFixed(2)})`, wordCount * log2(listSize)),
    capitalizationBits(capitalization, letterCount, wordCount),
  ]
  if (emoji) parts.push(part(`emoji (${wordCount} × ${log2(EMOJI_POOLS.default.length).toFixed(2)})`, wordCount * log2(EMOJI_POOLS.default.length)))
  parts.push(separatorPart(separator, gapCount, affixesLocked, ambiguousExcluded))
  parts.push(prefixPart(prefix, affixesLocked, ambiguousExcluded))
  parts.push(suffixPart(suffix, prefix, affixesLocked, ambiguousExcluded))
  parts.push(leetPart(leetActive))
  return finish(parts)
}

// --- slot modes (Passphrase, Mad Lib, Wireless) --------------------------------
/** The draws every word mode shares after its words are chosen. */
const tailParts = ({ slots, capitalization, letterCount, separator, prefix, suffix, emoji, leetActive, affixesLocked, ambiguousExcluded }) => {
  const gapCount = Math.max(0, slots.length - 1)
  const parts = [capitalizationBits(capitalization, letterCount, slots.length)]
  if (emoji) {
    let bits = 0
    for (const s of slots) bits += log2(s.emojiPoolSize || EMOJI_POOLS.default.length)
    parts.push(part('emoji', bits))
  }
  parts.push(separatorPart(separator, gapCount, affixesLocked, ambiguousExcluded))
  parts.push(prefixPart(prefix, affixesLocked, ambiguousExcluded))
  parts.push(suffixPart(suffix, prefix, affixesLocked, ambiguousExcluded))
  parts.push(leetPart(leetActive))
  return parts
}

export const slotBits = (opts) => {
  const parts = opts.slots.map((s) =>
    part(`${s.label} (${s.poolSize} words)`, log2(s.poolSize)))
  parts.push(...tailParts(opts))
  return finish(parts)
}

/**
 * Wireless with alliteration on. The slot pools here are the ones filtered to
 * the drawn letter, and freePoolSize carries what each pool would have been --
 * so the breakdown can state the toggle's measured cost instead of leaving the
 * shrunken numbers to speak for themselves.
 */
export const wirelessBits = (opts) => {
  if (!opts.alliteration) return slotBits(opts)
  const parts = alliterationSlotParts({ commonLetters: opts.commonLetters, slots: opts.slots })
  const free = opts.slots.reduce((s, x) => s + log2(x.freePoolSize || x.poolSize), 0)
  const got = parts.reduce((s, p) => s + p.bits, 0)
  if (free > got) {
    parts.push(part('alliteration', 0,
      `costs ${(free - got).toFixed(1)} bits versus free word choice`))
  }
  parts.push(...tailParts(opts))
  return finish(parts)
}

/**
 * Alliteration replaces the free slot draws: one common letter uniformly, then
 * each slot uniformly among its words with that letter. Bits depend on which
 * letter was drawn, so this takes the REALIZED letter's pool sizes. The
 * difference from the free draw is the measured cost of the toggle.
 */
export const alliterationSlotParts = ({ commonLetters, slots }) => {
  const parts = [part(`alliteration letter (1 of ${commonLetters})`, log2(commonLetters))]
  for (const s of slots) {
    parts.push(part(`${s.label} (${s.poolSize} ${s.letter}-words)`, log2(s.poolSize)))
  }
  return parts
}

// --- Numbers ------------------------------------------------------------------
/**
 * Numbers filters the digit pool at each position based on repeat/sequence
 * state, so the bits ARE the sum of log2(pool size) along the exact path the
 * generator took. This replays the generator's own state machine over the
 * finished password -- same transitions, same fallback -- and is exact:
 * test/entropy.test.js proves the probabilities of all reachable outputs sum
 * to 1.
 */
export const numbersSurprisal = (pw, maxRepeated, maxSequential) => {
  let bits = 0
  let repeatedCount = 0
  let sequentialCount = 0
  let sequenceDirection = null
  let out = ''
  for (let i = 0; i < pw.length; i++) {
    let availableDigits = '0123456789'
    const lastDigit = out.slice(-1)
    if (lastDigit) {
      const lastNum = parseInt(lastDigit)
      if (repeatedCount >= maxRepeated) {
        availableDigits = availableDigits.replace(lastDigit, '')
      }
      if (sequentialCount >= maxSequential) {
        if (sequenceDirection === 'up' && lastNum < 9) {
          availableDigits = availableDigits.replace((lastNum + 1).toString(), '')
        }
        if (sequenceDirection === 'down' && lastNum > 0) {
          availableDigits = availableDigits.replace((lastNum - 1).toString(), '')
        }
      }
    }
    if (availableDigits.length === 0) availableDigits = '0123456789'

    const nextDigit = pw[i]
    if (!availableDigits.includes(nextDigit)) return NaN // unreachable output
    bits += log2(availableDigits.length)

    if (lastDigit) {
      const lastNum = parseInt(lastDigit)
      const nextNum = parseInt(nextDigit)
      if (nextDigit === lastDigit) {
        repeatedCount++
        sequentialCount = 1
        sequenceDirection = null
      } else if (nextNum === lastNum + 1) {
        if (sequenceDirection === 'up') sequentialCount++
        else { sequentialCount = 2; sequenceDirection = 'up' }
        repeatedCount = 1
      } else if (nextNum === lastNum - 1) {
        if (sequenceDirection === 'down') sequentialCount++
        else { sequentialCount = 2; sequenceDirection = 'down' }
        repeatedCount = 1
      } else {
        repeatedCount = 1
        sequentialCount = 1
        sequenceDirection = null
      }
    } else {
      repeatedCount = 1
      sequentialCount = 1
    }
    out += nextDigit
  }
  return bits
}

export const numbersBits = ({ password, maxRepeated, maxSequential }) => {
  const bits = numbersSurprisal(password, maxRepeated, maxSequential)
  const free = password.length * log2(10)
  const parts = [part(`digits (${password.length})`, bits)]
  if (bits < free - 0.005) {
    parts.push(part('repeat/sequence limits', 0,
      `cost ${(free - bits).toFixed(1)} bits vs unrestricted digits`))
  }
  return finish(parts)
}

// --- presentation --------------------------------------------------------------
/** One decimal place; the maths is exact but the display should not pretend to more. */
export const formatBits = (bits) => `${bits.toFixed(1)} bits`

/**
 * The floor below which the pill warns. 40 bits is well under any offline
 * attack margin; the warning is a nudge, not a blocker (6a).
 */
export const ENTROPY_FLOOR = 40

/**
 * Tiers for the strength meter. The boundaries are attack-anchored rather
 * than vibes: under ~40 bits is within reach of an offline fast-hash attack
 * (ENTROPY_FLOOR, same line the warning uses); 60 is where offline attacks
 * get expensive; 80+ is comfortable against anything foreseeable. The bar
 * fills linearly and caps at 100 bits -- past that, more bar is just bragging.
 */
export const METER_MAX = 100
export const entropyTier = (bits) => {
  if (bits < ENTROPY_FLOOR) return { id: 'weak', label: 'weak' }
  if (bits < 60) return { id: 'fair', label: 'fair' }
  if (bits < 80) return { id: 'good', label: 'good' }
  return { id: 'strong', label: 'strong' }
}
