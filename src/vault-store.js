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

import { createVault, openVault, sealVault, isVaultEnvelope } from './vault-crypto.js'
import * as realSession from './vault-session.js'
import { mergeEntries } from './vault-transfer.js'

const DB_NAME = 'pwgen-vault'
const STORE = 'vault'
const ENVELOPE_ID = 'envelope-v1'

/** Fifteen minutes, matching the lockout scenario the entropy panel quotes. */
export const DEFAULT_AUTOLOCK_MS = 15 * 60 * 1000

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

/** A list of non-empty strings, deduplicated, from anything list-shaped. */
const textList = (v, max, cap = 20) => {
  const raw = Array.isArray(v) ? v : (typeof v === 'string' ? v.split(/[\s,]+/) : [])
  return [...new Set(raw.map((x) => text(x, max)).filter(Boolean))].slice(0, cap)
}

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

export const normalizeEntry = (raw) => {
  if (!raw || typeof raw !== 'object') return null
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
    urls: textList(raw.urls, 500),
    questions: questionList(raw.questions),
    bits: Number.isFinite(raw.bits) ? raw.bits : null,
    at: typeof raw.at === 'string' && raw.at ? raw.at : null,
    note: text(raw.note, 2000),
  }
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

  const persist = async () => {
    envelope = await sealVault(key, kdf, entries)
    await storage.save(envelope)
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

  const requireUnlocked = () => {
    if (!key) throw new Error('the vault is locked')
    touch()
  }

  const list = () => {
    requireUnlocked()
    return entries.map((e) => ({ ...e }))
  }

  const add = async (entry) => {
    requireUnlocked()
    const normalized = normalizeEntry(entry)
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
    const merged = normalizeEntry({ ...entries[idx], ...patch, id })
    if (!merged) throw new Error('an entry needs a password')
    entries = entries.map((e, i) => (i === idx ? merged : e))
    await persist()
    emit()
    return merged
  }

  const remove = async (id) => {
    requireUnlocked()
    const before = entries.length
    entries = entries.filter((e) => e.id !== id)
    if (entries.length === before) return false
    await persist()
    emit()
    return true
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
    init, state, touch, lock, lockIfIdle, shouldAutoLock,
    create, unlock, rekey, destroy, importEntries,
    list, add, update, remove,
    // The sealed envelope, for 9b's export. Never the key, and never the
    // decrypted entries -- an export is ciphertext by construction.
    envelope: () => envelope,
    isLoaded: () => loaded,
  }
}
