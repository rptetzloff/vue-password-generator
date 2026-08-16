// What a vault entry is, and the rules for reading, sorting and grouping one
// (ROADMAP 9a).
//
// Extracted from vault-store.js. Pure functions over plain objects: no key,
// no storage, no clock beyond what is handed in. That is the reason to have
// it separate -- these are the rules with the most tests and the least
// machinery, and they were buried in the middle of a file whose other job is
// holding a decryption key in memory.

import { normalizeTotp } from './totp.js'

// --- entries -----------------------------------------------------------------

const newId = () => (
  typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    // Only reached on an origin without randomUUID; the id is a local handle,
    // never a secret, so Math.random is adequate here and nowhere else.
    : `e${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`
)

/**
 * Coerce one stored or imported record into a vault entry, or null.
 *
 * Deliberately strict about the password and forgiving about everything else:
 * an entry without a password is not an entry, but a missing label or a
 * corrupted date is a cosmetic problem and should not cost someone the
 * password itself. Ids are stable and generated when absent, so edits and
 * deletions key on identity rather than on the password (which can change) or
 * the label (which can repeat).
 */
const text = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '')

/**
 * Security questions, as question/answer pairs.
 *
 * These belong in a vault more than almost anything else: the answers are
 * credentials, people are told to invent false ones precisely so they cannot
 * be researched, and an invented answer you cannot remember is a locked
 * account. A pair with no answer is dropped -- the question alone is not a
 * secret worth storing.
 */
const questionList = (v) => {
  if (!Array.isArray(v)) return []
  return v
    .map((qa) => (qa && typeof qa === 'object'
      ? { q: text(qa.q, 300), a: text(qa.a, 300) }
      : null))
    .filter((qa) => qa && qa.a)
    .slice(0, 20)
}

/**
 * Arbitrary extra fields, rather than a fixed list of named ones.
 *
 * The request was "a second password or username, and other relevant fields",
 * and the tempting answer is `username2` and `pw2`. That answer runs out
 * immediately: the next account wants a PIN, then a customer number, then a
 * recovery email, then a support passphrase. A name/value pair with a secret
 * flag covers all of them and every one nobody has thought of yet.
 *
 * `secret` is what earns a field the password treatment -- masked, revealed
 * deliberately, copied through the clipboard timer, and offered the generator.
 * A customer number is not a secret and should not be hidden behind a dot row.
 */
/**
 * Web addresses, each optionally named.
 *
 * One login routinely covers several hosts that are not interchangeable --
 * the site, its admin panel, the staging copy, the app store listing -- and a
 * bare list of URLs makes you read hostnames to tell which is which. A name
 * turns that into "Main", "Dev", "Store".
 *
 * Accepts the old shape too. Entries saved before this existed are plain
 * strings, and so are the URLs in every CSV any other manager exports; both
 * arrive here as an unnamed address rather than as nothing.
 */
const urlList = (v) => {
  const raw = Array.isArray(v) ? v : (typeof v === 'string' ? v.split(/[\s,]+/) : [])
  const seen = new Set()
  const out = []
  for (const item of raw) {
    const url = typeof item === 'string' ? text(item, 500) : text(item?.url, 500)
    if (!url || seen.has(url)) continue
    seen.add(url)
    out.push({ name: typeof item === 'string' ? '' : text(item?.name, 40), url })
    if (out.length >= 20) break
  }
  return out
}

/**
 * Tags: zero or many per entry, unlike the group's exactly-one.
 *
 * That difference is the entire point, and it is not presentational. A folder
 * forces a choice -- the company credit card is under Work or under Finance,
 * and it is genuinely both -- while a tag asks for none. It also means there
 * is no equivalent of "Ungrouped": an entry with no tags is not unfiled
 * awaiting a decision, it is simply untagged, which is a normal resting state.
 *
 * Lower-cased on the way in, because "Work" and "work" being two tags is the
 * fastest way to make a tag list useless.
 */
const tagList = (v) => {
  const raw = Array.isArray(v) ? v : (typeof v === 'string' ? v.split(/[,\n]/) : [])
  const seen = new Set()
  const out = []
  for (const item of raw) {
    const tag = text(item, 40).toLowerCase().replace(/\s+/g, ' ')
    if (!tag || seen.has(tag)) continue
    seen.add(tag)
    out.push(tag)
    if (out.length >= 30) break
  }
  return out.sort()
}

const fieldList = (v) => {
  if (!Array.isArray(v)) return []
  return v
    .map((f) => (f && typeof f === 'object'
      ? { name: text(f.name, 100), value: text(f.value, 2000), secret: !!f.secret }
      : null))
    .filter((f) => f && f.value)
    .slice(0, 30)
}

/**
 * An ISO-8601 UTC instant, or null. Used for `updatedAt` and `deletedAt`.
 *
 * ISO rather than epoch milliseconds because it is readable in an exported
 * file, and because strings in this format compare lexicographically in the
 * same order they compare chronologically -- so a merge can sort them without
 * parsing anything. The existing `at` field stays a plain date: it is what the
 * UI shows, day granularity is right for that, and two edits on one day would
 * be indistinguishable if merges relied on it.
 */
const stamp = (v) => {
  if (typeof v !== 'string' || !v) return null
  const t = Date.parse(v)
  return Number.isFinite(t) ? new Date(t).toISOString() : null
}

/**
 * A deleted entry, kept as a marker rather than removed (ROADMAP: sync-shaped).
 *
 * Without this, "deleted here" and "not seen yet" are the same thing to a
 * merge, so any second replica resurrects everything the first one deleted --
 * silently, and specifically for the entries someone most wanted gone.
 *
 * A tombstone carries no secret: the id, when it died, and nothing else. It is
 * deliberately not an entry with a `deleted` flag, because then every consumer
 * of an entry has to remember to check.
 */
export const isTombstone = (e) => !!e && typeof e === 'object' && !!e.deletedAt && !e.pw

const normalizeTombstone = (raw) => {
  const deletedAt = stamp(raw.deletedAt)
  if (!deletedAt) return null
  const id = typeof raw.id === 'string' && raw.id ? raw.id : null
  return id ? { id, deletedAt } : null
}

export const normalizeEntry = (raw) => {
  if (!raw || typeof raw !== 'object') return null
  // Checked before the password rule, since a tombstone has no password and
  // dropping it here is how a deletion gets forgotten.
  if (raw.deletedAt) return normalizeTombstone(raw)
  if (typeof raw.pw !== 'string' || raw.pw === '') return null
  return {
    id: typeof raw.id === 'string' && raw.id ? raw.id : newId(),
    label: text(raw.label, 200),
    // What most sites actually ask for alongside the password, and the field
    // whose absence made the vault a notepad rather than a record.
    username: text(raw.username, 200),
    pw: raw.pw,
    // Plural: one login often covers several hosts, and matching a saved
    // entry to the site in front of you is what 9c's autofill will need.
    urls: urlList(raw.urls),
    questions: questionList(raw.questions),
    fields: fieldList(raw.fields),
    // A one-time-code seed, when the account has one. Stored beside the
    // password, which is exactly the trade the UI warns about -- see totp.js.
    totp: normalizeTotp(raw.totp),
    // Free text rather than a managed list of folders. A vault of a few dozen
    // entries does not need a taxonomy, and the cost of one is that every new
    // entry becomes a filing decision. An empty group is "Ungrouped", which is
    // a perfectly good place for most things to stay.
    group: text(raw.group, 60),
    // n:m, where group is 1:1. See tagList for why that is the whole point.
    tags: tagList(raw.tags),
    bits: Number.isFinite(raw.bits) ? raw.bits : null,
    at: typeof raw.at === 'string' && raw.at ? raw.at : null,
    // When this entry last changed, to the millisecond. `at` is the day it was
    // created and is what the UI shows; this is what a merge compares. Null on
    // everything written before this existed, which a merge reads as "older
    // than anything stamped" -- the safe direction, since it means a replica
    // that does know the time wins rather than an unknown clobbering it.
    updatedAt: stamp(raw.updatedAt),
    note: text(raw.note, 2000),
  }
}

/** Every group in use, sorted, for the datalist and the group headings. */
/** Every tag in use, for the picker and the suggestions. */
export const tagsOf = (entries) =>
  [...new Set((entries || []).flatMap((e) => e.tags || []))]
    .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }))

export const groupsOf = (entries) =>
  [...new Set((entries || []).map((e) => e.group).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }))

export const UNGROUPED = 'Ungrouped'

/**
 * How the list can be ordered. Recent first is the default because the thing
 * you just saved is the thing you are most likely to want back.
 */
export const SORTS = [
  { id: 'recent', label: 'Newest first' },
  { id: 'oldest', label: 'Oldest first' },
  { id: 'label', label: 'Name (A–Z)' },
  { id: 'strength', label: 'Weakest first' },
]

const byLabel = (a, b) =>
  (a.label || '').localeCompare(b.label || '', undefined, { sensitivity: 'base' }) ||
  (a.username || '').localeCompare(b.username || '', undefined, { sensitivity: 'base' })

/**
 * Sort a copy of the entries.
 *
 * Weakest-first puts entries with no recorded entropy last rather than first:
 * an unknown figure is not evidence of weakness, and sorting them to the top
 * would bury the ones actually worth changing. Anything undated sorts as
 * oldest, since an entry that predates the date field genuinely is.
 */
export const sortEntries = (entries, sortId) => {
  const list = [...(entries || [])]
  switch (sortId) {
    case 'oldest':
      return list.sort((a, b) => String(a.at || '').localeCompare(String(b.at || '')) || byLabel(a, b))
    case 'label':
      return list.sort(byLabel)
    case 'strength':
      return list.sort((a, b) => {
        const known = (e) => Number.isFinite(e.bits)
        if (known(a) !== known(b)) return known(a) ? -1 : 1
        if (!known(a)) return byLabel(a, b)
        return a.bits - b.bits || byLabel(a, b)
      })
    default:
      return list.sort((a, b) => String(b.at || '').localeCompare(String(a.at || '')) || byLabel(a, b))
  }
}

/**
 * Which entries share a password with which others.
 *
 * Reuse is the failure that turns one breach into several, and it is the one
 * piece of password health a vault can assess with certainty -- no guessing,
 * no corpus, no network. ROADMAP 9e allows exactly this and rules out the
 * remote kind: local analysis of what is already in front of us.
 *
 * Compared on the password itself. Not hashed, not truncated: the vault is
 * decrypted in memory at this point, so a hash would add ceremony without
 * adding protection, and it would introduce collisions where there are none.
 *
 * @returns Map of entry id -> the other entries sharing its password
 */
export const reuseIndex = (entries) => {
  const byPassword = new Map()
  for (const entry of entries || []) {
    if (!entry.pw) continue
    if (!byPassword.has(entry.pw)) byPassword.set(entry.pw, [])
    byPassword.get(entry.pw).push(entry)
  }
  const index = new Map()
  for (const shared of byPassword.values()) {
    if (shared.length < 2) continue
    for (const entry of shared) {
      index.set(entry.id, shared.filter((other) => other.id !== entry.id))
    }
  }
  return index
}

/** How many entries are involved in reuse at all, for a one-line summary. */
export const reuseCount = (entries) => reuseIndex(entries).size

/**
 * Entries bucketed by group, in the order the groups should appear.
 *
 * Ungrouped goes last: it is where things sit when nobody has decided, and
 * putting it first would make the undecided pile the headline.
 */
export const groupEntries = (entries, sortId) => {
  const buckets = new Map()
  for (const entry of sortEntries(entries, sortId)) {
    const key = entry.group || UNGROUPED
    if (!buckets.has(key)) buckets.set(key, [])
    buckets.get(key).push(entry)
  }
  const named = [...buckets.keys()].filter((k) => k !== UNGROUPED)
    .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }))
  if (buckets.has(UNGROUPED)) named.push(UNGROUPED)
  return named.map((name) => ({ name, entries: buckets.get(name) }))
}

export const normalizeEntries = (list) =>
  (Array.isArray(list) ? list : []).map(normalizeEntry).filter(Boolean)
