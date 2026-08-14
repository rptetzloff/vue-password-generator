// The recovery key: a second way into the vault, for the one failure the
// product otherwise has no answer to (ROADMAP 9f).
//
// What this solves, and what it does not. A backup protects against *losing
// the data*. A recovery key protects against *forgetting the passphrase*, and
// those are different failures -- a backup you cannot decrypt is as lost as no
// backup at all. Forget the passphrase without one of these and every copy you
// own, including every backup, is ciphertext forever. Conversely, if the vault
// is gone and was never exported, no key recovers it. The two are complements.
//
// THE CONSTRAINT THAT MAKES THIS SAFE: the key is generated, never chosen.
//
// An attacker takes whichever path is cheaper, so a vault with two keys is
// only as strong as the weaker one. A user-chosen recovery phrase would
// therefore lower the security of every vault that had one, silently, no
// matter how good the passphrase was. At 225 bits of generated randomness the
// recovery path is not attackable at all, so the passphrase stays the binding
// constraint and this costs nothing. Between those two positions is a trap:
// anything memorable is anything guessable. There is deliberately no API here
// for a phrase someone typed up themselves.
//
// Words rather than a base32 blob, because this gets written on paper and
// typed back by hand under stress, months later, by someone who is already
// having a bad day.

import { randInt } from './lib.js'

/**
 * Sixteen words from the 17,576-word Orchard Street list: log2(17576) = 14.1
 * bits each, so 225.6 bits total. Preposterous overkill, and free -- ten words
 * would already be 141 bits and unreachable. The number trades transcription
 * effort against a margin that is enormous at either end, and 16 keeps it to
 * about two written lines.
 */
export const RECOVERY_WORDS = 16

/** Bits of entropy in a phrase of `count` words drawn from `size` options. */
export const recoveryBits = (size, count = RECOVERY_WORDS) =>
  size > 1 ? Math.log2(size) * count : 0

/**
 * Generate a phrase. The word list is passed in rather than fetched, so this
 * module stays testable in Node and honest about its one input.
 *
 * Words may repeat: each draw is independent, which is what makes the entropy
 * exactly count * log2(size). Removing duplicates would feel tidier and would
 * quietly reduce the number, which is the kind of trade that should never be
 * made by accident in a key generator.
 */
export const generateRecoveryPhrase = (wordList, count = RECOVERY_WORDS) => {
  if (!Array.isArray(wordList) || wordList.length < 1024) {
    throw new Error('a recovery phrase needs a real word list')
  }
  if (!Number.isInteger(count) || count < 1) throw new Error('bad word count')
  const words = []
  // randInt is the project's rejection-sampled draw. `% length` would skew
  // toward the front of the list, which in a key is a real loss of entropy
  // rather than a curiosity.
  for (let i = 0; i < count; i++) words.push(wordList[randInt(wordList.length)])
  return words.join(' ')
}

/**
 * Clean up something a person typed. Lower-cased, whitespace collapsed, and
 * line breaks treated as spaces -- a phrase written across two lines and
 * pasted back should just work.
 *
 * Deliberately forgiving about spacing and case and nothing else. Correcting a
 * misspelled word would mean guessing at a key, and a near miss must fail
 * loudly rather than be silently repaired into someone else's phrase.
 */
export const normalizeRecoveryPhrase = (input) =>
  String(input == null ? '' : input).toLowerCase().replace(/\s+/g, ' ').trim()

/**
 * Check a typed phrase before spending a million PBKDF2 rounds on it.
 *
 * This is a usability check, not a security one: the real verdict is whether
 * the unwrap authenticates. But "that is 15 words, not 16" and "brambel is not
 * a word in the list" are answerable instantly and are what someone
 * transcribing from paper actually gets wrong.
 */
export const checkRecoveryPhrase = (input, wordList, count = RECOVERY_WORDS) => {
  const phrase = normalizeRecoveryPhrase(input)
  if (!phrase) return { ok: false, reason: 'empty', message: 'Enter your recovery key.' }

  const words = phrase.split(' ')
  if (words.length !== count) {
    return {
      ok: false,
      reason: 'length',
      message: `A recovery key is ${count} words; that is ${words.length}.`,
      words: words.length,
    }
  }

  if (Array.isArray(wordList) && wordList.length) {
    const known = wordList instanceof Set ? wordList : new Set(wordList)
    const unknown = [...new Set(words.filter((w) => !known.has(w)))]
    if (unknown.length) {
      return {
        ok: false,
        reason: 'unknown',
        // Naming them beats "invalid recovery key" by a wide margin when the
        // difference is one letter and the paper is in the other room.
        message: unknown.length === 1
          ? `“${unknown[0]}” is not one of the words a recovery key is made from.`
          : `These are not words a recovery key is made from: ${unknown.join(', ')}.`,
        unknown,
      }
    }
  }

  return { ok: true, phrase, words: words.length }
}
