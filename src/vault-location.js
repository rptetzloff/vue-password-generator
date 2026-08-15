// Where the vault lives, and remembering that across reloads (ROADMAP 9d).
//
// Two places today: this browser's IndexedDB, or a folder the user picked. The
// handle for that folder is itself stored in IndexedDB, because a
// FileSystemDirectoryHandle survives structured cloning -- which is the only
// reason "point at it once" is possible rather than picking the folder on
// every visit.
//
// THE PROPERTY THIS MODULE EXISTS TO PROTECT: a configured folder that cannot
// be read right now must never look like an absent vault.
//
// Permission does not always survive with the handle. A drive can be
// unmounted, a folder renamed, a profile copied to another machine. In every
// one of those cases the honest answer is "your vault is in a folder I cannot
// read", and the dangerous answer is "no vault found, create one?" -- because
// someone will say yes, and the first save writes a brand new empty vault over
// the top. So resolve() reports `blocked` and refuses to fall back to local
// storage, and the UI has to render that state rather than treating it as
// absent.

import { indexedDbStorage } from './vault-store.js'
import { createFolderStorage, folderPermission, requestFolderPermission } from './vault-fs.js'

// Same database as the vault, a different key. Opened here rather than
// imported so this module does not need vault-store to expose its internals.
const DB_NAME = 'pwgen-vault'
const STORE = 'vault'
const LOCATION_ID = 'location-v1'

const openDb = () => new Promise((resolve, reject) => {
  const rq = indexedDB.open(DB_NAME, 1)
  rq.onupgradeneeded = () => rq.result.createObjectStore(STORE)
  rq.onsuccess = () => resolve(rq.result)
  rq.onerror = () => reject(rq.error)
})

const readLocation = async () => {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const rq = db.transaction(STORE).objectStore(STORE).get(LOCATION_ID)
    rq.onsuccess = () => resolve(rq.result ?? null)
    rq.onerror = () => reject(rq.error)
  })
}

const writeLocation = async (value) => {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite')
    if (value === null) tx.objectStore(STORE).delete(LOCATION_ID)
    else tx.objectStore(STORE).put(value, LOCATION_ID)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

/** The remembered folder handle, or null for "this browser". */
export const savedFolder = async () => {
  try {
    const saved = await readLocation()
    return saved && saved.dir ? saved.dir : null
  } catch { return null }
}

export const rememberFolder = (dir, name) => writeLocation({ dir, name: name || dir.name })
export const forgetFolder = () => writeLocation(null)

/**
 * Work out where the vault is and hand back something the store can use.
 *
 * Returns { kind, storage, dir, name }:
 *   local    -> IndexedDB, the default and the fallback for a browser that
 *               cannot do folders at all
 *   folder   -> the chosen folder, permission confirmed
 *   blocked  -> a folder is configured and is NOT readable right now. storage
 *               is null on purpose: there is nothing safe to do with it, and
 *               returning local here is the bug this module exists to avoid.
 */
export const resolveLocation = async ({ storage = indexedDbStorage, saved = savedFolder } = {}) => {
  const dir = await saved()
  if (!dir) return { kind: 'local', storage, dir: null, name: null }

  const state = await folderPermission(dir)
  if (state !== 'granted') {
    return { kind: 'blocked', storage: null, dir, name: dir.name, permission: state }
  }
  return { kind: 'folder', storage: createFolderStorage(dir), dir, name: dir.name }
}

/**
 * Try to get a blocked folder back. Needs a user gesture, so the UI calls this
 * from a button rather than on load.
 */
export const unblockFolder = async (dir) => {
  const state = await requestFolderPermission(dir)
  return state === 'granted'
}

/**
 * Move the vault from wherever it is into a folder.
 *
 * Copy, verify, switch, and only then clear the old copy -- in that order, and
 * never move. If anything fails partway the original is still where it was,
 * which is the difference between an error message and a lost vault.
 *
 * Refuses rather than overwrites if the folder already holds a vault. Two
 * vaults meeting is a merge, and merging is not built yet; silently replacing
 * one with the other is the worst available answer.
 */
export const moveVaultToFolder = async (dir, { from = indexedDbStorage, remember = rememberFolder } = {}) => {
  const target = createFolderStorage(dir)

  // load() throws on a file that is present but unreadable, which is exactly
  // the case where stopping is right.
  const existing = await target.load()
  if (existing) {
    throw new Error('that folder already holds a WordLock vault; choose an empty folder, or open that one instead')
  }

  const envelope = await from.load()
  if (envelope) {
    await target.save(envelope)
    // Read it back before believing the write. A folder can be full, read-only,
    // or a sync client can reject the file, and every one of those looks like
    // success until you look.
    const written = await target.load()
    if (!written || written.ct !== envelope.ct) {
      throw new Error('the vault did not survive the copy, so nothing was changed')
    }
  }

  await remember(dir)
  // Only now, with the copy verified and the new location recorded.
  if (envelope && from.clear) await from.clear()
  return { kind: 'folder', storage: target, dir, name: dir.name }
}

/**
 * Adopt a vault that is ALREADY in a folder.
 *
 * The second-machine case, and the one that makes mode 2 worth having: point a
 * fresh browser at the folder your other computer already syncs, and the vault
 * is simply there. Nothing is copied and nothing is written -- this only
 * records where to look.
 *
 * The opposite of moveVaultToFolder in every respect, which is why it is a
 * separate call rather than a flag. Move refuses when the folder is occupied;
 * open requires it. Move writes; open does not. Conflating them would mean one
 * function whose destructive behaviour depends on what it happens to find.
 */
export const openVaultInFolder = async (dir, { local = indexedDbStorage, remember = rememberFolder } = {}) => {
  const target = createFolderStorage(dir)
  const envelope = await target.load()
  if (!envelope) {
    throw new Error('there is no WordLock vault in that folder; use Move if you meant to put one there')
  }

  // Refuse rather than orphan. Switching away from a local vault would leave
  // it sitting in this browser, unreachable through the UI and invisible until
  // someone switches back -- and if they never do, it is simply lost.
  if (await local.load()) {
    throw new Error('this browser already holds its own vault; export or delete it before opening another')
  }

  await remember(dir)
  return { kind: 'folder', storage: target, dir, name: dir.name }
}

/** The same journey in reverse, with the same order and the same refusal. */
export const moveVaultToLocal = async (dir, { to = indexedDbStorage, forget = forgetFolder } = {}) => {
  const source = createFolderStorage(dir)
  const existing = await to.load()
  if (existing) {
    throw new Error('this browser already holds a vault; it would have to be deleted first')
  }

  const envelope = await source.load()
  if (envelope) {
    await to.save(envelope)
    const written = await to.load()
    if (!written || written.ct !== envelope.ct) {
      throw new Error('the vault did not survive the copy, so nothing was changed')
    }
  }

  await forget()
  if (envelope) await source.clear()
  return { kind: 'local', storage: to, dir: null, name: null }
}
