// Estimating the strength of a passphrase somebody TYPED (ROADMAP 9a).
//
// This is the one place in the project that guesses, and it has to be labelled
// as such. Everywhere else the entropy figure is exact or a floor, because the
// site did the generating and knows every random draw it made. A passphrase
// the user invented has no such history: we see the result and nothing about
// how it was chosen. The changelog has been rude about meters that "guess at a
// typed password with heuristics", so this module must not quietly become one.
//
// The honest framing is a CEILING, not a score. Pool arithmetic gives the most
// a string of this length and character mix could be worth, if every character
// were chosen uniformly at random. Nothing a human does makes it worth MORE
// than that, and almost everything makes it worth less: real words, names,
// dates, keyboard runs, l33t substitutions of any of those. So the number is
// reported as "at most", the deductions below only ever subtract, and the UI
// says plainly that a real attacker's dictionary knows things this does not.
//
// What this deliberately is not: a breach-corpus check (9e -- needs a network)
// or a dictionary attack simulator (would need a dependency, and a convincing
// one would still be a guess).

const CLASSES = [
  { test: /[a-z]/, size: 26 },
  { test: /[A-Z]/, size: 26 },
  { test: /[0-9]/, size: 10 },
  // The printable ASCII punctuation a keyboard offers.
  { test: /[ -/:-@[-`{-~]/, size: 33 },
]

/** Everything outside ASCII counted conservatively as one modest bucket. */
const NON_ASCII_POOL = 100

export const poolSize = (s) => {
  let pool = 0
  for (const c of CLASSES) if (c.test.test(s)) pool += c.size
  if (/[^\x20-\x7e]/.test(s)) pool += NON_ASCII_POOL
  return pool
}

/** The shortest unit the string is a whole repetition of: "abcabc" -> "abc". */
export const repeatingUnit = (s) => {
  for (let len = 1; len <= s.length / 2; len++) {
    if (s.length % len !== 0) continue
    const unit = s.slice(0, len)
    if (unit.repeat(s.length / len) === s) return unit
  }
  return s
}

/**
 * The longest run of characters stepping by ±1 in code point -- "abcd",
 * "9876". Three is where a run stops being coincidence.
 */
export const longestRun = (s) => {
  let best = 1
  let current = 1
  let direction = 0
  for (let i = 1; i < s.length; i++) {
    const step = s.charCodeAt(i) - s.charCodeAt(i - 1)
    if ((step === 1 || step === -1) && (direction === 0 || step === direction)) {
      direction = step
      current++
    } else {
      current = (step === 1 || step === -1) ? 2 : 1
      direction = (step === 1 || step === -1) ? step : 0
    }
    if (current > best) best = current
  }
  return best
}

/** Longest run of one repeated character: "aaab" -> 3. */
export const longestRepeat = (s) => {
  let best = 0
  let current = 0
  let prev = null
  for (const c of s) {
    current = c === prev ? current + 1 : 1
    prev = c
    if (current > best) best = current
  }
  return best
}

/**
 * The passwords that top every leaked-credential list, plus the words people
 * reach for when asked to invent one on the spot.
 *
 * This is NOT the breach-corpus check 9e rules out: that one needs a network
 * request per password, which would break the site's central promise. This is
 * fifty-odd strings compiled in, checked locally, and it exists because
 * "password" scoring 38 bits from pool arithmetic is true and useless -- the
 * ceiling is real, but the floor for a word an attacker tries first is about
 * one guess. Anything matching gets told the truth instead of the ceiling.
 */
const COMMON = new Set([
  'password', 'passw0rd', 'p@ssword', 'p@ssw0rd', 'password1', 'password123',
  '123456', '1234567', '12345678', '123456789', '1234567890', '12345',
  'qwerty', 'qwerty123', 'qwertyuiop', 'abc123', 'letmein', 'welcome',
  'monkey', 'dragon', 'master', 'sunshine', 'princess', 'football',
  'baseball', 'iloveyou', 'trustno1', 'superman', 'batman', 'starwars',
  'admin', 'administrator', 'root', 'guest', 'login', 'test', 'changeme',
  'secret', 'whatever', 'freedom', 'shadow', 'michael', 'jennifer',
  'hunter2', 'ninja', 'azerty', 'zaq12wsx', '1qaz2wsx', 'qazwsx',
  'correcthorsebatterystaple', 'correct horse battery staple',
])

/** Strip the substitutions people believe disguise a word. */
const unLeet = (s) => s.toLowerCase()
  .replace(/[@4]/g, 'a').replace(/[3]/g, 'e').replace(/[1!|]/g, 'i')
  .replace(/[0]/g, 'o').replace(/[5$]/g, 's').replace(/[7]/g, 't')

/**
 * Whether this is a famous password, allowing for capitalisation, leet
 * substitution and a couple of trailing digits -- "P@ssw0rd12" is not a
 * different secret from "password".
 */
export const isCommon = (s) => {
  const lower = s.toLowerCase()
  const stripped = lower.replace(/[0-9]{1,4}[!?.]?$/, '')
  for (const candidate of [lower, stripped, unLeet(lower), unLeet(stripped)]) {
    if (COMMON.has(candidate)) return true
  }
  return false
}

const QWERTY_ROWS = ['qwertyuiop', 'asdfghjkl', 'zxcvbnm', '1234567890']

/** Whether the string contains four or more adjacent keys from one row. */
export const hasKeyboardRun = (s) => {
  const lower = s.toLowerCase()
  for (const row of QWERTY_ROWS) {
    for (let i = 0; i + 4 <= row.length; i++) {
      const seq = row.slice(i, i + 4)
      if (lower.includes(seq) || lower.includes([...seq].reverse().join(''))) return true
    }
  }
  return false
}

/**
 * Estimate the ceiling, in bits, for a typed passphrase.
 *
 * Returns { bits, notes } where bits is an upper bound and notes are concrete,
 * explainable reasons it was reduced -- never a vague score. Each deduction
 * corresponds to something an attacker's rules would exploit, and each one is
 * something the user can act on.
 */
export const estimatePassphrase = (raw) => {
  const s = typeof raw === 'string' ? raw : ''
  if (!s) return { bits: 0, notes: [], length: 0 }

  const notes = []
  const pool = poolSize(s)

  // A famous password is not worth its ceiling; it is worth the position it
  // holds in the list an attacker tries first. Reported before any arithmetic
  // so no other rule can talk the number back up.
  if (isCommon(s)) {
    return {
      bits: 1,
      notes: ['one of the first passwords anyone would guess — a decoration like “123” does not hide it'],
      length: s.length,
    }
  }

  // A string that is one short unit repeated is worth its unit, not its
  // length: "abcabcabcabc" costs an attacker what "abc" costs plus the
  // trivial guess that it repeats.
  const unit = repeatingUnit(s)
  let effectiveLength = s.length
  if (unit.length < s.length) {
    effectiveLength = unit.length + 1
    notes.push(`“${unit}” repeated — worth about as much as typing it once`)
  }

  let bits = effectiveLength * Math.log2(pool)

  const repeat = longestRepeat(s)
  if (repeat >= 3) {
    // Each character past the second in a run is nearly free to guess.
    bits -= (repeat - 2) * Math.log2(pool) * 0.8
    notes.push(`${repeat} of the same character in a row`)
  }

  const run = longestRun(s)
  if (run >= 4) {
    bits -= (run - 2) * Math.log2(pool) * 0.7
    notes.push(`${run} characters in a counting sequence, like “abcd” or “1234”`)
  }

  if (hasKeyboardRun(s)) {
    bits -= Math.log2(pool) * 2
    notes.push('a run of adjacent keyboard keys')
  }

  if (s.length < 12) notes.push('short — length is the cheapest strength there is')
  if (/^[a-z]+$/.test(s)) notes.push('all lowercase letters')
  if (/^[0-9]+$/.test(s)) notes.push('all digits')

  return { bits: Math.max(0, bits), notes, length: s.length }
}
