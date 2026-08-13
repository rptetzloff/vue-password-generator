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

const DB_NAME = 'pwgen-vault'
const STORE = 'vault'
const ENVELOPE_ID = 'envelope-v1'

/** Fifteen minutes, matching the lockout scenario the entropy panel quotes. */
export const DEFAULT_AUTOLOCK_MS = 15 * 60 * 1000

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
export const normalizeEntry = (raw) => {
  if (!raw || typeof raw !== 'object') return null
  if (typeof raw.pw !== 'string' || raw.pw === '') return null
  const label = typeof raw.label === 'string' ? raw.label.trim().slice(0, 200) : ''
  const note = typeof raw.note === 'string' ? raw.note.trim().slice(0, 2000) : ''
  return {
    id: typeof raw.id === 'string' && raw.id ? raw.id : newId(),
    label,
    pw: raw.pw,
    bits: Number.isFinite(raw.bits) ? raw.bits : null,
    at: typeof raw.at === 'string' && raw.at ? raw.at : null,
    note,
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
  onChange = () => {},
} = {}) => {
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
    emit()
    return state()
  }

  const touch = () => { lastActivity = now() }

  const lock = () => {
    key = null
    kdf = null
    entries = null
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
    const made = await createVault(passphrase, [])
    envelope = made.envelope
    key = made.key
    kdf = made.kdf
    entries = []
    await storage.save(envelope)
    touch()
    emit()
    return state()
  }

  const unlock = async (passphrase) => {
    if (!envelope) throw new Error('no vault to unlock')
    // Any failure here leaves the store locked rather than half-open.
    const opened = await openVault(envelope, passphrase)
    entries = normalizeEntries(opened.data)
    key = opened.key
    kdf = opened.kdf
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
  const rekey = async (oldPassphrase, newPassphrase) => {
    if (!envelope) throw new Error('no vault to re-key')
    const opened = await openVault(envelope, oldPassphrase)
    const made = await createVault(newPassphrase, opened.data)
    envelope = made.envelope
    key = made.key
    kdf = made.kdf
    entries = normalizeEntries(opened.data)
    await storage.save(envelope)
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
    create, unlock, rekey, destroy,
    list, add, update, remove,
    // The sealed envelope, for 9b's export. Never the key, and never the
    // decrypted entries -- an export is ciphertext by construction.
    envelope: () => envelope,
    isLoaded: () => loaded,
  }
}
