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
// Storage, the clock and the session holder are injected, and since this
// moved into core/ none of them defaults to a browser: storage is required,
// the session holder defaults to one that holds nothing, and the device id
// and name default to "unknown". src/vault-settings.js supplies the real
// ones. Every rule in here -- state machine, auto-lock, entry normalization
// -- is therefore testable in node without a DOM, which is the same bargain
// isCurrentPage and shouldCondense already make.

import {
  createVault, openVault, sealVault, isVaultEnvelope,
  addSlot, removeSlot, needsUpgrade, hasRecovery as cryptoHasRecovery,
} from './crypto.js'
import { generateRecoveryPhrase, normalizeRecoveryPhrase } from './recovery-key.js'
import { mergeEntries, mergeReplicas } from './transfer.js'
import {
  isTombstone, normalizeEntry, normalizeEntries, tagsOf, groupsOf,
  UNGROUPED, SORTS, sortEntries, reuseIndex, reuseCount, groupEntries,
} from './entry.js'

/**
 * A session holder that holds nothing.
 *
 * ~~`session = realSession` and `storage = indexedDbStorage`.~~ The store
 * always injected both, but it imported the browser adapters to default them,
 * which is what kept this file out of core/ -- a module cannot be portable and
 * name IndexedDB in the same breath. The defaults are inert now and the
 * browser supplies the real ones from `src/`.
 *
 * Inert rather than absent because the whole stay-unlocked path is optional:
 * with `staySignedInMs` at 0 nothing here is ever called, which is exactly the
 * configuration the tests run in.
 */
const noSession = {
  rememberSession: async () => {},
  recallSession: async () => null,
  touchSession: () => {},
  forgetSession: () => {},
}


/** Fifteen minutes, matching the lockout scenario the entropy panel quotes. */
export const DEFAULT_AUTOLOCK_MS = 15 * 60 * 1000

/** How long a deletion marker is kept before it is reaped. See reap(). */
export const TOMBSTONE_TTL_MS = 90 * 24 * 60 * 60 * 1000


// --- the payload -------------------------------------------------------------
//
// What sits inside the encrypted envelope. It used to be a bare array of
// entries, which left nowhere to record anything ABOUT the vault -- so the
// backup date went into localStorage and was therefore per-browser, and two
// replicas of the same vault had no way to establish that they were the same
// vault (ROADMAP 9d).
//
//   { v, vaultId, entries: [...], meta: { lastExport, lastWriter } }
//
// A bare array still loads and becomes this shape on the next save, so nothing
// written before today is stranded. The version is the PAYLOAD's, separate
// from the envelope's: one is what the ciphertext holds, the other is how the
// ciphertext is wrapped, and conflating them would mean a change to either
// forcing a migration of both.

export const PAYLOAD_VERSION = 1

/**
 * How many backup records the vault keeps.
 *
 * Five, not all of them: enough to see whether backing up is a habit or a
 * thing that happened once in March, and few enough that the list cannot
 * become a slow leak of activity inside the ciphertext.
 */
export const EXPORT_HISTORY = 5

export const newVaultId = () => (
  typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : `v${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`
)


/**
 * Something a person can read, for the backup list: "Edge on Windows".
 *
 * The id above answers "which replica" for a merge; this answers "which of my
 * browsers" for me, and a UUID in a list of backups is noise. Derived rather
 * than stored, so it corrects itself after a browser update, and deliberately
 * coarse -- browser and platform, no versions. It never leaves the vault it is
 * written into, which is the only reason recording it is reasonable at all.
 *
 * Order matters twice over: Edge's UA claims Chrome, and Chrome's claims
 * Safari. Testing in that sequence is the whole implementation.
 */
export const deviceNameFrom = (ua) => {
  if (typeof ua !== 'string' || !ua) return 'an unknown browser'
  const browser = /\bEdgA?\//.test(ua) ? 'Edge'
    : /\bOPR\//.test(ua) ? 'Opera'
      : /\bFirefox\//.test(ua) ? 'Firefox'
        : /\bChrome\//.test(ua) ? 'Chrome'
          : /\bSafari\//.test(ua) ? 'Safari'
            : 'a browser'
  const os = /\bWindows\b/.test(ua) ? 'Windows'
    : /\b(iPhone|iPad|iPod)\b/.test(ua) ? 'iOS'
      : /\bAndroid\b/.test(ua) ? 'Android'
        : /\bMac OS X\b|\bMacintosh\b/.test(ua) ? 'macOS'
          : /\bLinux\b/.test(ua) ? 'Linux'
            : null
  return os ? `${browser} on ${os}` : browser
}


/**
 * Read whatever was in the envelope, in any shape it has ever had.
 *
 * vaultId is minted here when absent rather than left null, so a vault created
 * before this existed acquires one the first time it is opened and keeps it
 * from then on -- which is what makes "are these the same vault?" answerable
 * for vaults that predate the question.
 */
export const readPayload = (data) => {
  if (Array.isArray(data)) {
    return { v: PAYLOAD_VERSION, vaultId: newVaultId(), entries: data, meta: {} }
  }
  if (!data || typeof data !== 'object') {
    return { v: PAYLOAD_VERSION, vaultId: newVaultId(), entries: [], meta: {} }
  }
  return {
    v: PAYLOAD_VERSION,
    vaultId: typeof data.vaultId === 'string' && data.vaultId ? data.vaultId : newVaultId(),
    entries: Array.isArray(data.entries) ? data.entries : [],
    meta: data.meta && typeof data.meta === 'object' ? { ...data.meta } : {},
  }
}

/**
 * Reconcile the vault's own metadata between two replicas.
 *
 * Only the backup list needs thinking about, and it is a union rather than a
 * pick: a backup made on the laptop and one made on the desktop are two facts,
 * not a disagreement about one. Sorted newest first and capped, so two
 * replicas that have each been backed up five times do not arrive at ten.
 *
 * Deduplicated on the timestamp, which is what makes this idempotent -- the
 * same merge run twice has to give the same list, or every save would grow it.
 *
 * lastWriter is deliberately NOT merged. Whoever is writing now is the last
 * writer; payloadOut stamps it.
 */
export const mergeMeta = (mine = {}, theirs = {}) => {
  const seen = new Set()
  const exports_ = [...(Array.isArray(mine.exports) ? mine.exports : []),
    ...(Array.isArray(theirs.exports) ? theirs.exports : [])]
    .filter((x) => x && typeof x.at === 'string' && Number.isFinite(x.count))
    .filter((x) => (seen.has(x.at) ? false : seen.add(x.at)))
    .sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0))
    .slice(0, EXPORT_HISTORY)
  return { ...theirs, ...mine, exports: exports_ }
}

/**
 * Thrown by a save that would have overwritten someone else's change to the
 * same entry. Carries both versions so the caller can show them; the vault is
 * untouched and the decision belongs to whoever is looking at it.
 */
export const conflictError = (mine, theirs) => Object.assign(
  new Error('this entry was changed somewhere else while you had it open'),
  { name: 'VaultConflict', conflict: { mine, theirs } },
)

// --- the store ---------------------------------------------------------------

/**
 * @param storage      { load, save, clear } -- defaults to IndexedDB
 * @param now          () => ms, injectable so auto-lock is testable
 * @param autoLockMs   idle timeout; 0 disables
 * @param onChange     called after every state change, for the UI to re-render
 */
export const createVaultStore = ({
  // No default: a store without storage is a bug, and a silent in-memory
  // fallback would look like it worked right up until the page reloaded.
  storage,
  now = Date.now,
  autoLockMs = DEFAULT_AUTOLOCK_MS,
  // How long the vault may stay unlocked ACROSS page loads. 0 means never,
  // which also keeps the key non-extractable -- see vault-session.js for the
  // trade this makes when it is on.
  staySignedInMs = 0,
  // Injectable for the same reason storage and the clock are: the whole
  // stay-unlocked lifecycle is then testable without IndexedDB.
  session = noSession,
  deviceId = 'unknown-device',
  deviceName = 'an unknown browser',
  onChange = () => {},
} = {}) => {
  if (!storage) throw new Error('createVaultStore needs a storage adapter')
  const holdsSession = staySignedInMs > 0
  let envelope = null
  let key = null
  let kdf = null
  let entries = null
  let vaultId = null
  let meta = {}
  let lastActivity = now()

  // Every write is stamped from the injected clock rather than Date.now, so
  // the merge tests can drive time instead of sleeping.
  const stampNow = () => new Date(now()).toISOString()

  /** Take a decrypted payload into memory, in whatever shape it arrived. */
  const adopt = (data) => {
    const payload = readPayload(data)
    vaultId = payload.vaultId
    meta = payload.meta
    entries = normalizeEntries(payload.entries)
    return payload
  }

  /** What goes back into the envelope. */
  const payloadOut = () => ({
    v: PAYLOAD_VERSION,
    vaultId: vaultId || (vaultId = newVaultId()),
    entries,
    meta: { ...meta, lastWriter: deviceId },
  })
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
      seenCt = envelope ? envelope.ct : null
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
          adopt(opened.data)
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
    // The payload's own fields go with them. They are not passwords, but they
    // came out of the ciphertext and one of them is an entry count -- a locked
    // vault that can still say how much is in it has not really locked.
    vaultId = null
    meta = {}
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

  /**
   * The ciphertext this store last read or wrote.
   *
   * The whole conflict detector. If what is in storage now is not this, some
   * other replica has written since we last looked -- another machine sharing
   * a folder, or just a second tab of this browser over the same IndexedDB.
   * Comparing ct rather than a version counter means nothing has to be
   * maintained: every seal produces a fresh IV, so no two writes collide.
   */
  let seenCt = null

  /**
   * Fold in whatever another replica wrote, before writing over it.
   *
   * save() overwrote, so the slower of two devices discarded the faster one's
   * work -- silently, and specifically for the entries someone had just
   * decided to keep. This is the read half of read-merge-write, and it is why
   * updatedAt and tombstones exist (ROADMAP 9d).
   *
   * The peer's file opens with the master key already in memory: openVault
   * takes an existing key and skips the KDF entirely, so this costs one AES
   * pass rather than a million PBKDF2 rounds. It also means a peer that has
   * been RE-KEYED cannot be opened -- GCM authenticates, so the decrypt throws
   * rather than producing rubbish, and refusing to write is then the only
   * honest answer. Overwriting would delete a vault whose new passphrase
   * someone deliberately set.
   */
  const reconcile = async (guard = null) => {
    // Nothing read yet means this store created the vault, so there is
    // nothing of anyone else's to merge with.
    if (seenCt === null) return null

    // A present-but-unreadable file throws out of load(), and it is allowed to
    // throw all the way out of the save. Writing over a file we cannot read is
    // how you destroy the one copy of something.
    const current = await storage.load()
    if (!current || current.ct === seenCt) return null

    let opened
    try {
      opened = await openVault(current, null, key)
    } catch {
      // Deliberately does not guess which. Every vault has its own random
      // master key, so a re-keyed peer and a different vault entirely fail
      // here identically -- there is nothing in an unreadable envelope to tell
      // them apart, and naming one would be a coin flip presented as a fact.
      throw new Error(
        'the vault in that place has been replaced or given a different passphrase, so it '
        + 'can no longer be read from here. This save was stopped rather than overwriting it.',
      )
    }

    // Reachable only for a vault that shares our master key and yet claims a
    // different identity, which the decrypt above has already made unlikely.
    // Kept because the alternative to checking is interleaving two people's
    // passwords into one list, and the check costs a string compare.
    const remote = readPayload(opened.data)
    if (vaultId && remote.vaultId && remote.vaultId !== vaultId) {
      throw new Error(
        'a different vault is in that place now, so this save was stopped rather than '
        + 'overwriting it',
      )
    }

    const theirs = normalizeEntries(remote.entries)

    // Did the entry being saved move underneath us?
    //
    // Last-write-wins is right for two devices editing DIFFERENT entries, and
    // wrong for two editing the same one: "last" means saved last, not knew
    // most. An edit box open in one browser holds a copy from before the other
    // browser saved, so its patch lands on stale data and wins on a fresh
    // timestamp -- silently discarding a password someone deliberately set.
    // The window is not the milliseconds between read and write; it is however
    // long the dialog stays open.
    //
    // Detectable because the caller passes the entry as it loaded it, so its
    // updatedAt is the base. A remote copy standing on anything else means the
    // entry moved on, and the answer to that is a question, not a guess.
    if (guard) {
      const remoteCopy = theirs.find((e) => e.id === guard.id)
      const at = remoteCopy && (remoteCopy.deletedAt || remoteCopy.updatedAt || '')
      if (remoteCopy && at !== guard.base) throw conflictError(guard.mine, remoteCopy)
    }

    // Ours first: strictly newer wins, and ties keep the local copy, so the
    // edit that triggered this save survives a peer that saved in the same
    // second.
    const result = mergeReplicas(entries, theirs)
    entries = result.merged
    meta = mergeMeta(meta, remote.meta)
    seenCt = current.ct
    return result
  }

  /**
   * Change the entry list and write it, putting memory back if the write is
   * refused.
   *
   * Without the rollback a refused save leaves entries in memory that are on
   * no disk anywhere -- the list would show a saved-looking row that the next
   * reload does not have, and any later save would quietly write it after all.
   * Nothing is lost by undoing it: the editor keeps what was typed, because
   * the throw stops the caller before it closes.
   */
  const commit = async (next, guard = null) => {
    const beforeEntries = entries
    const beforeMeta = meta
    entries = next
    try {
      return await persist(guard)
    } catch (e) {
      entries = beforeEntries
      meta = beforeMeta
      throw e
    }
  }

  const persist = async (guard = null) => {
    const folded = await reconcile(guard)
    entries = reap(entries)
    envelope = await sealVault(key, kdf, payloadOut())
    await storage.save(envelope)
    // What is in storage is now ours. Every path that re-seals for a reason
    // other than an ordinary edit lands here, and missing one would make the
    // NEXT save mistake our own file for a peer's and try to merge with it.
    seenCt = envelope.ct
    seenCt = envelope.ct
    return folded
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
    vaultId = newVaultId()
    meta = {}
    entries = []
    const made = await createVault(passphrase, payloadOut(), holdsSession)
    envelope = made.envelope
    key = made.key
    kdf = made.kdf
    await storage.save(envelope)
    // What is in storage is now ours. Every path that re-seals for a reason
    // other than an ordinary edit lands here, and missing one would make the
    // NEXT save mistake our own file for a peer's and try to merge with it.
    seenCt = envelope.ct
    await session.rememberSession(key, kdf, staySignedInMs)
    touch()
    emit()
    return state()
  }

  const unlock = async (passphrase) => {
    if (!envelope) throw new Error('no vault to unlock')
    // Any failure here leaves the store locked rather than half-open.
    const opened = await openVault(envelope, passphrase, null, holdsSession)
    adopt(opened.data)
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

  /**
   * The recent encrypted backups: when, from where, and how much was in the
   * vault at the time. Newest first, EXPORT_HISTORY of them.
   *
   * In the vault rather than beside it, because it is a fact about the vault.
   * It lived in localStorage until now, which made it per-browser: Edge
   * reported a vault as never backed up an hour after Chrome had exported it,
   * and with a shared folder that is simply wrong rather than merely unhelpful.
   *
   * A list rather than one record because the useful question is not "was
   * there a backup" but "how long have I been meaning to". Three dated lines
   * answer that; the whole history would be a log of nothing, and it would
   * grow inside the ciphertext forever.
   *
   * Full timestamps, not dates: two backups on the same afternoon are common,
   * and a list of identical-looking rows is worse than no list. The device is
   * recorded because with a shared folder "which machine did that" is the
   * first thing you want to know.
   */
  const exports = () => (Array.isArray(meta.exports) ? meta.exports : [])
    .filter((x) => x && typeof x.at === 'string' && Number.isFinite(x.count))
    .slice(0, EXPORT_HISTORY)
    .map((x) => ({ ...x }))

  const lastExport = () => exports()[0] || null

  const noteExport = async () => {
    requireUnlocked()
    const record = {
      at: stampNow(),
      count: entries.filter((e) => !isTombstone(e)).length,
      by: deviceName,
    }
    meta = { ...meta, exports: [record, ...exports()].slice(0, EXPORT_HISTORY) }
    await persist()
    emit()
    return { ...record }
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
    await commit([normalized, ...entries])
    emit()
    return normalized
  }

  /**
   * @param patch  the entry AS THE CALLER LOADED IT, plus the changes. Its
   *               updatedAt is read as the base version, which is what makes
   *               "someone else changed this while you had it open"
   *               distinguishable from "you made the newer edit".
   * @param resolve  'mine' to write anyway, after the caller has asked.
   */
  const update = async (id, patch, { resolve = null } = {}) => {
    requireUnlocked()
    const idx = entries.findIndex((e) => e.id === id)
    if (idx === -1) throw new Error('no such entry')
    const merged = normalizeEntry({ ...entries[idx], ...patch, id, updatedAt: stampNow() })
    if (!merged) throw new Error('an entry needs a password')

    const base = resolve === 'mine' || typeof patch.updatedAt !== 'string'
      ? null
      : patch.updatedAt
    const next = entries.map((e, i) => (i === idx ? merged : e))
    await commit(next, base === null ? null : { id, base, mine: merged })
    emit()
    return merged
  }

  /**
   * Take in what another replica wrote, without writing anything back.
   *
   * The "keep theirs" half of resolving a conflict: their version is already
   * on disk, so there is nothing to save -- this only stops us showing a copy
   * we know is stale. Also the honest thing to offer a UI that wants to look
   * before it writes.
   */
  const refresh = async () => {
    requireUnlocked()
    const folded = await reconcile()
    if (folded) emit()
    return folded
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
    await commit(entries.map((e, i) => (i === idx ? { id, deletedAt: stampNow() } : e)))
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
    await commit(idx === -1 ? [back, ...entries] : entries.map((e, i) => (i === idx ? back : e)))
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
    await commit(result.merged)
    emit()
    return { added: result.added, skipped: result.skipped }
  }

  const rekey = async (oldPassphrase, newPassphrase) => {
    if (!envelope) throw new Error('no vault to re-key')
    const opened = await openVault(envelope, oldPassphrase)
    adopt(opened.data)
    const made = await createVault(newPassphrase, payloadOut(), holdsSession)
    envelope = made.envelope
    key = made.key
    kdf = made.kdf
    await storage.save(envelope)
    // What is in storage is now ours. Every path that re-seals for a reason
    // other than an ordinary edit lands here, and missing one would make the
    // NEXT save mistake our own file for a peer's and try to merge with it.
    seenCt = envelope.ct
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
      adopt(opened.data)
      const made = await createVault(passphrase, payloadOut(), holdsSession)
      live = made.envelope
      key = made.key
      kdf = made.kdf
    }
    const master = (await openVault(live, passphrase, null, true)).key

    envelope = await addSlot(live, 'recovery', phrase, master)
    kdf = envelope.wraps
    await storage.save(envelope)
    // What is in storage is now ours. Every path that re-seals for a reason
    // other than an ordinary edit lands here, and missing one would make the
    // NEXT save mistake our own file for a peer's and try to merge with it.
    seenCt = envelope.ct
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
    // What is in storage is now ours. Every path that re-seals for a reason
    // other than an ordinary edit lands here, and missing one would make the
    // NEXT save mistake our own file for a peer's and try to merge with it.
    seenCt = envelope.ct
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
    adopt(opened.data)
    const made = await createVault(newPassphrase, payloadOut(), holdsSession)
    envelope = made.envelope
    key = made.key
    kdf = made.kdf
    await storage.save(envelope)
    // What is in storage is now ours. Every path that re-seals for a reason
    // other than an ordinary edit lands here, and missing one would make the
    // NEXT save mistake our own file for a peer's and try to merge with it.
    seenCt = envelope.ct
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
    list, raw, add, update, remove, restore, refresh,
    // Identity and facts about the vault itself, as opposed to its contents.
    vaultId: () => vaultId,
    lastExport, exports, noteExport,
    saveDraft, loadDraft, clearDraft, hasDraft,
    // The sealed envelope, for 9b's export. Never the key, and never the
    // decrypted entries -- an export is ciphertext by construction.
    envelope: () => envelope,
    isLoaded: () => loaded,
  }
}
