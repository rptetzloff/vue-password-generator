// Comparing two versions of one entry, for the conflict dialog (ROADMAP 9d).
//
// Pure, and extracted from vault-app.js so it can be asserted directly. The
// rule it exists to hold is a security rule, and a security rule that can only
// be checked by opening a dialog and looking at it is not really checked.
//
// THE RULE: compare on the real values, render from the masked ones. Those are
// two different operations and conflating them fails in both directions.
//
// Comparing what is DISPLAYED means two different passwords -- or two different
// TOTP seeds -- both rendering as dots, comparing equal, and the row vanishing:
// the one change worth warning about becomes the one silently hidden.
//
// Rendering what is COMPARED is how this started. The first version stringified
// anything object-shaped with `Object.values(v).join(' — ')`, and normalizeTotp
// emits `secret` first, so the One-time code row opened with the base32 seed in
// clear text. That seed is rendered nowhere else in WordLock: the editor shows
// only "Code set for issuer (account)", the list shows only the six digits
// derived from it. A dialog that appears unasked, in the middle of someone
// else's save, was the last place it should have appeared.

/** The fields worth diffing, in the order they are shown. */
export const FIELD_LABELS = {
  label: 'Name',
  username: 'Username',
  pw: 'Password',
  note: 'Note',
  group: 'Group',
  tags: 'Tags',
  urls: 'Web addresses',
  questions: 'Security questions',
  fields: 'Custom fields',
  totp: 'One-time code',
}

/**
 * Masked by default, revealable on request -- because every one of these can
 * be revealed elsewhere in the app with one click, so hiding them harder here
 * would be theatre rather than protection.
 */
export const SECRET_FIELDS = new Set(['pw', 'questions', 'fields'])

export const MASK = '•'.repeat(8)

/**
 * The one-time code, described and never quoted.
 *
 * NOT in SECRET_FIELDS, because that set is "masked unless revealed" and this
 * is stronger: the seed has no reveal. It is the only secret the product
 * renders nowhere at all, and unlike a password it does not rotate when the
 * password does -- retiring an exposed seed means re-enrolling the
 * authenticator, which is a separate act people forget. Same wording as the
 * editor, so the two agree.
 */
export const describeTotp = (t) => {
  if (!t) return ''
  const who = t.issuer || 'this account'
  const acct = t.account ? ` (${t.account})` : ''
  return `Code for ${who}${acct} — ${t.digits} digits, every ${t.period}s, ${t.algorithm}`
}

const listOf = (v) => (Array.isArray(v) ? v : [])

/** What one field looks like on screen. Never the seed; secrets only if asked. */
export const shownValue = (key, v, reveal = false) => {
  if (v === null || v === undefined || v === '') return ''
  if (key === 'totp') return describeTotp(v)
  if (key === 'pw') return reveal ? String(v) : MASK
  if (key === 'questions') {
    return listOf(v).map((qa) => `${qa.q || 'Question'} — ${reveal ? qa.a : MASK}`).join(', ')
  }
  if (key === 'fields') {
    // The secret flag decides the masking and is itself never printed -- the
    // first version emitted it as a bare `true` at the end of the row.
    return listOf(v)
      .map((f) => `${f.name || 'Unnamed'} — ${f.secret && !reveal ? MASK : f.value}`)
      .join(', ')
  }
  if (Array.isArray(v)) {
    return v
      .map((x) => (typeof x === 'string' ? x : Object.values(x).filter(Boolean).join(' — ')))
      .join(', ')
  }
  return String(v)
}

/**
 * Both entries come through normalizeEntry, so their keys are in a fixed order
 * and JSON is a sound equality test. Absent and empty compare equal on
 * purpose: an entry that never had a note does not "differ" from one whose
 * note is the empty string.
 */
const same = (a, b) => {
  const norm = (v) => (v === undefined || v === null || v === '' ? null
    : Array.isArray(v) && !v.length ? null : v)
  return JSON.stringify(norm(a) ?? null) === JSON.stringify(norm(b) ?? null)
}

/**
 * The rows for the conflict table: only the fields that actually differ.
 *
 * @param reveal  show the maskable secrets. Never affects totp.
 */
export const diffEntries = (mine = {}, theirs = {}, { reveal = false } = {}) =>
  Object.keys(FIELD_LABELS)
    .filter((key) => !same(mine[key], theirs[key]))
    .map((key) => ({
      key,
      label: FIELD_LABELS[key],
      masked: key === 'totp' || (SECRET_FIELDS.has(key) && !reveal),
      mine: shownValue(key, mine[key], reveal),
      theirs: shownValue(key, theirs[key], reveal),
    }))

/** Whether the table is holding anything back that a reveal would show. */
export const diffHasSecrets = (rows) => rows.some((r) => SECRET_FIELDS.has(r.key))

/** Whether the one-time code is one of the things that differs. */
export const diffHasTotp = (rows) => rows.some((r) => r.key === 'totp')
