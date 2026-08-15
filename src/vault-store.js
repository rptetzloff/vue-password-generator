// The vault's lifecycle and storage (ROADMAP 9a).
//
// Three states, and the transitions between them are the whole module:
//
//   absent    -> no vault has been created on this device
//   locked    -> an envelope exists; the key and the entries are not in memory
//   unlocked  -> the key is held, the entries are decrypted and readable
//
// Locking must actually forget. It drops the key and the decrypted entries,
// not just a flag the UI reads -- a "locked" vault whose contents are still
// sitting in a closure is theatre, and the point of 9a is to beat the bar
// history already sets rather than to look like it does.
//
// Storage and the clock are injected. The defaults are IndexedDB and
// Date.now, but every rule in here -- state machine, auto-lock, entry
// normalization -- is then testable in node without a DOM, which is the same
// bargain isCurrentPage and shouldCondense already make.

import {
  createVault, openVault, sealVault, isVaultEnvelope,
  addSlot, removeSlot, needsUpgrade, hasRecovery as cryptoHasRecovery,
} from './vault-crypto.js'
import { generateRecoveryPhrase, normalizeRecoveryPhrase } from './recovery-key.js'
import { normalizeTotp } from './totp.js'
import * as realSession from './vault-session.js'
import { mergeEntries } from './vault-transfer.js'

const DB_NAME = 'pwgen-vault'
const STORE = 'vault'
const ENVELOPE_ID = 'envelope-v1'
const DRAFT_ID = 'draft-v1'

/** Fifteen minutes, matching the lockout scenario the entropy panel quotes. */
export const DEFAULT_AUTOLOCK_MS = 15 * 60 * 1000

/** How long a deletion marker is kept before it is reaped. See reap(). */
export const TOMBSTONE_TTL_MS = 90 * 24 * 60 * 60 * 1000

export const VAULT_LOCK_KEY = 'global.vaultAutoLock'

/** The configured window, in ms. Shared by the generator and the vault page. */
export const vaultLockMs = () => {
  try {
    const v = JSON.parse(localStorage.getItem(VAULT_LOCK_KEY))
    return Number.isFinite(v) && v >= 0 ? v : DEFAULT_AUTOLOCK_MS
  } catch { return DEFAULT_AUTOLOCK_MS }
}

/**
 * The settings-panel row for the lock window, so the generator page and the
 * vault page offer the identical control rather than two that can drift.
 *
 * "Every page" is 0: the vault holds nothing between page loads and the
 * passphrase is asked for each time, which is where this started before
 * anyone complained about it. It is kept because it is the only setting that
 * leaves the key non-extractable, and some people will want that.
 */
export const vaultLockSection = () => ({
  label: 'Vault lock',
  options: [
    { value: 0, label: 'Every page' },
    { value: 60_000, label: '1 min' },
    { value: 5 * 60_000, label: '5 min' },
    { value: DEFAULT_AUTOLOCK_MS, label: '15 min' },
    { value: 60 * 60_000, label: '1 hour' },
  ],
  get: () => vaultLockMs(),
  set: (v) => {
    const ms = Number(v)
    try { localStorage.setItem(VAULT_LOCK_KEY, JSON.stringify(ms)) } catch {}
    // Tightening takes effect at once; a longer window only applies to the
    // next unlock, since the running store captured the old one. Turning it
    // off must not wait for a reload -- that is the security-relevant
    // direction, so the held key goes immediately.
    if (!ms) realSession.forgetSession()
  },
})

// --- IndexedDB adapter -------------------------------------------------------
// localStorage would work and is simpler, but it is synchronous, string-only
// and roughly 5 MB per origin; a vault is the one thing here that can grow.

const openDb = () => new Promise((resolve, reject) => {
  const rq = indexedDB.open(DB_NAME, 1)
  rq.onupgradeneeded = () => rq.result.createObjectStore(STORE)
  rq.onsuccess = () => resolve(rq.result)
  rq.onerror = () => reject(rq.error)
})

export const indexedDbStorage = {
  async load () {
    const db = await openDb()
    return new Promise((resolve, reject) => {
      const rq = db.transaction(STORE).objectStore(STORE).get(ENVELOPE_ID)
      rq.onsuccess = () => resolve(rq.result ?? null)
      rq.onerror = () => reject(rq.error)
    })
  },
  async save (envelope) {
    const db = await openDb()
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite')
      tx.objectStore(STORE).put(envelope, ENVELOPE_ID)
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })
  },
  async clear () {
    const db = await openDb()
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite')
      tx.objectStore(STORE).delete(ENVELOPE_ID)
      tx.objectStore(STORE).delete(DRAFT_ID)
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })
  },

  /**
   * The half-finished entry, kept across a trip to the generator and back.
   *
   * A separate slot rather than part of the vault, because it is scratch: it
   * must survive a navigation and nothing more, and folding it into the
   * envelope would mean rewriting the whole vault on every keystroke-ish save.
   * It is stored SEALED -- see saveDraft -- so this adapter only moves bytes.
   */
  async loadDraft () {
    const db = await openDb()
    return new Promise((resolve, reject) => {
      const rq = db.transaction(STORE).objectStore(STORE).get(DRAFT_ID)
      rq.onsuccess = () => resolve(rq.result ?? null)
      rq.onerror = () => reject(rq.error)
    })
  },
  async saveDraft (sealed) {
    const db = await openDb()
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite')
      tx.objectStore(STORE).put(sealed, DRAFT_ID)
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })
  },
  async clearDraft () {
    const db = await openDb()
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite')
      tx.objectStore(STORE).delete(DRAFT_ID)
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })
  },
}

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

// --- the store ---------------------------------------------------------------

/**
 * @param storage      { load, save, clear } -- defaults to IndexedDB
 * @param now          () => ms, injectable so auto-lock is testable
 * @param autoLockMs   idle timeout; 0 disables
 * @param onChange     called after every state change, for the UI to re-render
 */
export const createVaultStore = ({
  storage = indexedDbStorage,
  now = Date.now,
  autoLockMs = DEFAULT_AUTOLOCK_MS,
  // How long the vault may stay unlocked ACROSS page loads. 0 means never,
  // which also keeps the key non-extractable -- see vault-session.js for the
  // trade this makes when it is on.
  staySignedInMs = 0,
  // Injectable for the same reason storage and the clock are: the whole
  // stay-unlocked lifecycle is then testable without IndexedDB.
  session = realSession,
  onChange = () => {},
} = {}) => {
  const holdsSession = staySignedInMs > 0
  let envelope = null
  let key = null
  let kdf = null
  let entries = null
  let lastActivity = now()

  // Every write is stamped from the injected clock rather than Date.now, so
  // the merge tests can drive time instead of sleeping.
  const stampNow = () => new Date(now()).toISOString()
  let loaded = false

  const state = () => {
    if (!envelope) return 'absent'
    return key ? 'unlocked' : 'locked'
  }

  const emit = () => onChange(state())

  /** Read whatever is on disk. Safe to call repeatedly; only the first hits storage. */
  const init = async () => {
    if (loaded) return state()
    try {
      const stored = await storage.load()
      envelope = isVaultEnvelope(stored) ? stored : null
    } catch {
      // A storage failure must not present as "no vault" -- that would invite
      // creating a second one over the top. Surfaced as a throw instead.
      loaded = true
      throw new Error('the vault could not be read from storage')
    }
    loaded = true

    // A session held by the SharedWorker means the vault was unlocked on
    // another page and has not timed out; restoring it here is what stops
    // the generator and the vault asking separately. Failure is silent and
    // simply leaves the vault locked.
    if (envelope && holdsSession) {
      try {
        const held = await session.recallSession()
        if (held) {
          const opened = await openVault(envelope, null, held.key, holdsSession)
          entries = normalizeEntries(opened.data)
          key = held.key
          kdf = held.kdf
          touch()
        }
      } catch { /* a stale or mismatched key just means asking again */ }
    }

    emit()
    return state()
  }

  const touch = () => {
    lastActivity = now()
    if (key && holdsSession) session.touchSession(staySignedInMs)
  }

  const lock = () => {
    key = null
    kdf = null
    entries = null
    // Locking on one page must lock every page; leaving the key with the
    // worker would make the lock button a lie.
    session.forgetSession()
    emit()
  }

  /** True if the idle timeout has elapsed; the caller decides how often to ask. */
  const shouldAutoLock = () =>
    !!key && autoLockMs > 0 && now() - lastActivity >= autoLockMs

  const lockIfIdle = () => {
    if (!shouldAutoLock()) return false
    lock()
    return true
  }

  /**
   * Drop tombstones old enough that every replica has certainly seen them.
   *
   * A tombstone that lives forever is a slow leak of what used to be in the
   * vault -- ids and dates accumulating with nothing to show for them. Ninety
   * days is far longer than any plausible gap between two replicas syncing,
   * and the cost of being wrong is one resurrected entry rather than a lost
   * one, which is the right direction to fail in.
   */
  const reap = (list) => {
    const cutoff = now() - TOMBSTONE_TTL_MS
    return list.filter((e) => !isTombstone(e) || Date.parse(e.deletedAt) >= cutoff)
  }

  const persist = async () => {
    entries = reap(entries)
    envelope = await sealVault(key, kdf, entries)
    await storage.save(envelope)
  }

  // --- the in-progress entry ---------------------------------------------------

  /**
   * Keep a half-finished entry across a navigation.
   *
   * Going to the generator to change a setting used to lose whatever had been
   * typed, which made the link a trap. The draft has to survive the round
   * trip, and a draft contains a password -- so it is sealed with the vault's
   * own key and stored as ciphertext, exactly like the entries are. Putting it
   * in sessionStorage would have been four lines and a plaintext secret at
   * rest, undoing the point of the vault for as long as the tab lived.
   *
   * Reuses the vault's kdf block so the sealed draft is self-describing, but
   * it is never merged into the vault: it is scratch until it is saved.
   */
  const saveDraft = async (draft) => {
    if (!key || !storage.saveDraft) return false
    await storage.saveDraft(await sealVault(key, kdf, draft))
    return true
  }

  /** The draft, or null. Unreadable without the key, so this needs unlocking. */
  const loadDraft = async () => {
    if (!key || !storage.loadDraft) return null
    const sealed = await storage.loadDraft()
    if (!isVaultEnvelope(sealed)) return null
    try {
      // The key is already in hand, so no passphrase and no derivation.
      const { data } = await openVault(sealed, '', key)
      return data && typeof data === 'object' ? data : null
    } catch {
      // Sealed under a previous key, or corrupt. A draft is scratch: losing
      // one is a nuisance, and failing to open the vault over it would not be.
      await clearDraft()
      return null
    }
  }

  const clearDraft = async () => {
    if (storage.clearDraft) await storage.clearDraft()
  }

  const hasDraft = async () => {
    if (!storage.loadDraft) return false
    return isVaultEnvelope(await storage.loadDraft())
  }

  const create = async (passphrase) => {
    if (envelope) throw new Error('a vault already exists on this device')
    const made = await createVault(passphrase, [], holdsSession)
    envelope = made.envelope
    key = made.key
    kdf = made.kdf
    entries = []
    await storage.save(envelope)
    await session.rememberSession(key, kdf, staySignedInMs)
    touch()
    emit()
    return state()
  }

  const unlock = async (passphrase) => {
    if (!envelope) throw new Error('no vault to unlock')
    // Any failure here leaves the store locked rather than half-open.
    const opened = await openVault(envelope, passphrase, null, holdsSession)
    entries = normalizeEntries(opened.data)
    key = opened.key
    kdf = opened.kdf
    // Hand it to the session holder so the other pages do not ask again.
    await session.rememberSession(key, kdf, staySignedInMs)
    touch()
    emit()
    return state()
  }

  /**
   * Read again, because the storage underneath changed.
   *
   * init() returns early once it has run, which is right for a page load and
   * wrong when the vault moves to a different backend mid-session -- pointing
   * at a folder left the UI showing "create a vault" until the page was
   * navigated away from and back, since only a fresh store ever re-read.
   *
   * Locks first, deliberately. This may be an entirely different vault, and
   * carrying a key or a decrypted entry list across that boundary is how one
   * vault's contents end up displayed under another's name.
   */
  const reload = async () => {
    lock()
    loaded = false
    envelope = null
    return init()
  }

  const requireUnlocked = () => {
    if (!key) throw new Error('the vault is locked')
    touch()
  }

  const list = () => {
    requireUnlocked()
    return entries.filter((e) => !isTombstone(e)).map((e) => ({ ...e }))
  }

  /**
   * Everything, tombstones included. What a replica has to hand over.
   *
   * Separate from list() rather than a flag on it, because every existing
   * caller wants the UI view and would have to remember to filter. The one
   * caller that must NOT filter is the merge, and making it ask for something
   * differently named is the point.
   */
  const raw = () => {
    requireUnlocked()
    return entries.map((e) => ({ ...e }))
  }

  const add = async (entry) => {
    requireUnlocked()
    const normalized = normalizeEntry({ ...entry, updatedAt: stampNow() })
    if (!normalized) throw new Error('an entry needs a password')
    entries = [normalized, ...entries]
    await persist()
    emit()
    return normalized
  }

  const update = async (id, patch) => {
    requireUnlocked()
    const idx = entries.findIndex((e) => e.id === id)
    if (idx === -1) throw new Error('no such entry')
    const merged = normalizeEntry({ ...entries[idx], ...patch, id, updatedAt: stampNow() })
    if (!merged) throw new Error('an entry needs a password')
    entries = entries.map((e, i) => (i === idx ? merged : e))
    await persist()
    emit()
    return merged
  }

  /**
   * Delete an entry, leaving a marker behind.
   *
   * The secret goes immediately -- the tombstone holds an id and a time and
   * nothing else -- but the id has to survive, or a replica that still has the
   * entry will hand it back on the next merge.
   */
  const remove = async (id) => {
    requireUnlocked()
    const idx = entries.findIndex((e) => e.id === id && !isTombstone(e))
    if (idx === -1) return false
    entries = entries.map((e, i) => (i === idx ? { id, deletedAt: stampNow() } : e))
    await persist()
    emit()
    return true
  }

  /**
   * Put back an entry that was just deleted.
   *
   * Deletion is durable the moment it is asked for -- the tombstone is already
   * written and already on disk -- so this is a genuine re-add rather than a
   * rollback. It keeps the id, which is what makes it an undelete rather than
   * a duplicate, and takes a fresh stamp so it beats its own tombstone on
   * every replica that has already seen the deletion.
   */
  const restore = async (entry) => {
    requireUnlocked()
    const back = normalizeEntry({ ...entry, updatedAt: stampNow() })
    if (!back) throw new Error('nothing to restore')
    // Replace the tombstone in place where it still exists, so the entry does
    // not jump to the top of the list for having been briefly deleted.
    const idx = entries.findIndex((e) => e.id === back.id)
    entries = idx === -1 ? [back, ...entries] : entries.map((e, i) => (i === idx ? back : e))
    await persist()
    emit()
    return back
  }

  /**
   * Re-key under a new passphrase. Two derivations, which is the floor: one
   * to open with the old, one to seal with the new. Going through a
   * crypto-level changePassphrase() helper cost a third by re-opening what it
   * had just sealed, and on a phone that is a visible stall for no reason.
   *
   * This is also the upgrade path for the iteration count -- createVault
   * always seals at today's default.
   */
  /**
   * Merge imported entries in. Never replaces: restoring an old backup must
   * not delete work done since, so the merge rules live in vault-transfer.js
   * and existing entries win every conflict.
   */
  const importEntries = async (incoming) => {
    requireUnlocked()
    const result = mergeEntries(entries, normalizeEntries(incoming))
    entries = result.merged
    await persist()
    emit()
    return { added: result.added, skipped: result.skipped }
  }

  const rekey = async (oldPassphrase, newPassphrase) => {
    if (!envelope) throw new Error('no vault to re-key')
    const opened = await openVault(envelope, oldPassphrase)
    const made = await createVault(newPassphrase, opened.data, holdsSession)
    envelope = made.envelope
    key = made.key
    kdf = made.kdf
    entries = normalizeEntries(opened.data)
    await storage.save(envelope)
    await session.rememberSession(key, kdf, staySignedInMs)
    touch()
    emit()
  }

  // -- The recovery key (ROADMAP 9f) ----------------------------------------
  //
  // A second way into the vault, for the failure a backup cannot touch:
  // forgetting the passphrase. See recovery-key.js for why it is generated
  // rather than chosen, and vault-crypto.js for how two keys reach one
  // plaintext.
  //
  // Every operation below takes the passphrase, even though the vault is
  // already open. That is deliberate and matches destroy(): minting a second
  // permanent key to someone's vault, or removing the one they are relying
  // on, are not things a person who merely walked up to an unlocked browser
  // should be able to do. Being open proves a tab is open; the passphrase
  // proves who is asking.

  const hasRecoveryKey = () => cryptoHasRecovery(envelope)

  /**
   * Generate a recovery key and wrap the master key under it.
   *
   * Returns the phrase, once. It is never stored in a form we can read back:
   * the envelope holds the master key encrypted *under* it, which is not the
   * same thing. Losing it means generating another, which is why calling this
   * again simply replaces the slot -- and retires the previous phrase.
   */
  const addRecoveryKey = async (passphrase, wordList) => {
    if (!envelope) throw new Error('no vault to add a recovery key to')
    const phrase = generateRecoveryPhrase(wordList)

    // The working key is deliberately non-extractable, and wrapKey cannot
    // export one, so the master is unwrapped again -- extractable this time,
    // and only for the moment it takes to wrap it under the new key.
    let live = envelope
    if (needsUpgrade(live)) {
      // A v1 vault encrypts data directly under the passphrase key and has
      // nowhere to put a second wrap. Re-seal it as v2 first: this is the
      // lazy upgrade, run at the one moment the passphrase is already in hand.
      const opened = await openVault(live, passphrase)
      const made = await createVault(passphrase, opened.data, holdsSession)
      live = made.envelope
      key = made.key
      kdf = made.kdf
      entries = normalizeEntries(opened.data)
    }
    const master = (await openVault(live, passphrase, null, true)).key

    envelope = await addSlot(live, 'recovery', phrase, master)
    kdf = envelope.wraps
    await storage.save(envelope)
    touch()
    emit()
    return phrase
  }

  /** Retire the recovery key. The passphrase keeps working; the phrase stops. */
  const removeRecoveryKey = async (passphrase) => {
    if (!envelope) throw new Error('no vault')
    if (!hasRecoveryKey()) return false
    // Verifying rather than trusting the open tab, as above. Throws on a wrong
    // passphrase, which leaves the recovery key in place -- the safe direction.
    await openVault(envelope, passphrase)
    envelope = removeSlot(envelope, 'recovery')
    kdf = envelope.wraps
    await storage.save(envelope)
    touch()
    emit()
    return true
  }

  /**
   * Check a recovery key without changing anything, so the unlock screen can
   * say "that is not the right key" before asking for a new passphrase.
   */
  const verifyRecoveryKey = async (phrase) => {
    if (!envelope || !hasRecoveryKey()) return false
    try {
      await openVault(envelope, normalizeRecoveryPhrase(phrase), null, false, 'recovery')
      return true
    } catch {
      return false
    }
  }

  /**
   * Open with the recovery key and immediately set a new passphrase.
   *
   * One operation rather than two, so the vault is never sitting open with no
   * passphrase anybody knows. The old passphrase stops working, because the
   * slot it lived in is replaced -- which is the point, since the reason to be
   * here is that nobody remembers it.
   *
   * The recovery key is retired too. It has just been typed into a screen,
   * possibly read aloud off a piece of paper, and a key that opens the vault
   * should not survive its own use by default; a fresh one can be generated
   * from settings. That is stated in the UI rather than done quietly.
   */
  const recoverWithKey = async (phrase, newPassphrase) => {
    if (!envelope) throw new Error('no vault to recover')
    if (!hasRecoveryKey()) throw new Error('this vault has no recovery key')
    const opened = await openVault(
      envelope, normalizeRecoveryPhrase(phrase), null, false, 'recovery',
    )
    // A brand new master key, not a re-wrap: whoever knew the old passphrase
    // should not still be able to open this vault afterwards.
    const made = await createVault(newPassphrase, opened.data, holdsSession)
    envelope = made.envelope
    key = made.key
    kdf = made.kdf
    entries = normalizeEntries(opened.data)
    await storage.save(envelope)
    await session.rememberSession(key, kdf, staySignedInMs)
    touch()
    emit()
    return state()
  }

  /**
   * Delete the vault entirely. Requires the passphrase: forgetting a
   * passphrase is the common case, and someone who has merely walked up to an
   * unlocked browser should not be able to erase the vault with one click.
   */
  const destroy = async (passphrase) => {
    if (!envelope) return false
    await openVault(envelope, passphrase)
    await storage.clear()
    envelope = null
    lock()
    return true
  }

  return {
    init, reload, state, touch, lock, lockIfIdle, shouldAutoLock,
    create, unlock, rekey, destroy, importEntries,
    hasRecoveryKey, addRecoveryKey, removeRecoveryKey, verifyRecoveryKey, recoverWithKey,
    list, raw, add, update, remove, restore,
    saveDraft, loadDraft, clearDraft, hasDraft,
    // The sealed envelope, for 9b's export. Never the key, and never the
    // decrypted entries -- an export is ciphertext by construction.
    envelope: () => envelope,
    isLoaded: () => loaded,
  }
}
