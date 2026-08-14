// Staying unlocked between pages (ROADMAP 9a).
//
// The problem: the vault key is deliberately never written anywhere, so a
// page navigation destroys it and the generator and the vault each demand the
// passphrase separately. Correct, and unusable.
//
// A SharedWorker was tried first, on the strength of a measured fact -- a
// non-extractable CryptoKey survives structured cloning intact -- which would
// have kept the key in RAM and out of storage entirely. It does not work: a
// shared worker dies with its last document, and navigating away from the
// only open tab is exactly that. Measured, not assumed.
//
// So this is the honest version of what every password manager calls "remember
// for N minutes", and the trade has to be stated rather than buried:
//
//   While the window is open, the vault key sits in IndexedDB encrypted under
//   an ambient key that also sits in IndexedDB. That is history's protection
//   level, not the vault's: it stops casual inspection and anything reading
//   the database off disk, but NOT someone in control of this browser
//   profile, because the browser can use the ambient key without being asked
//   for anything. When the window expires the record is deleted and the vault
//   is back to being worth only the passphrase.
//
// Which is why the timeout is a setting, "Off" is one of its values, and with
// it off the vault key is never even made extractable.

const DB_NAME = 'pwgen-vault'
const STORE = 'vault'
const SESSION_ID = 'session-v1'
const WRAP_ID = 'session-wrap-v1'

const openDb = () => new Promise((resolve, reject) => {
  const rq = indexedDB.open(DB_NAME, 1)
  rq.onupgradeneeded = () => rq.result.createObjectStore(STORE)
  rq.onsuccess = () => resolve(rq.result)
  rq.onerror = () => reject(rq.error)
})

const idbGet = async (id) => {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const rq = db.transaction(STORE).objectStore(STORE).get(id)
    rq.onsuccess = () => resolve(rq.result ?? null)
    rq.onerror = () => reject(rq.error)
  })
}

const idbPut = async (id, value) => {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite')
    tx.objectStore(STORE).put(value, id)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

const idbDelete = async (id) => {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite')
    tx.objectStore(STORE).delete(id)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

/** The ambient key that protects a held session. Non-extractable, like history's. */
const wrapKey = async () => {
  let key = await idbGet(WRAP_ID)
  if (!key) {
    key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'])
    await idbPut(WRAP_ID, key)
  }
  return key
}

// Set the moment a session is granted and cleared the moment it is revoked,
// synchronously, ahead of the IndexedDB work either one implies.
//
// It exists because touchSession is a read-modify-write: without this, a
// touch that had already read the record could write it back AFTER lock()
// deleted it, resurrecting a session the user had just ended. Measured -- the
// lock button genuinely failed to lock across pages until this was added.
let sessionActive = false

/**
 * Hold the unlocked key for `ttl` milliseconds. A ttl of 0 holds nothing and
 * clears anything already held -- that is the "Off" setting doing its job.
 *
 * The vault key must be extractable to be stored at all, which is why the
 * store only derives it that way when a window is actually configured.
 */
export const rememberSession = async (key, kdf, ttl) => {
  try {
    if (!ttl) { await forgetSession(); return false }
    sessionActive = true
    if (!key.extractable) return false
    const raw = new Uint8Array(await crypto.subtle.exportKey('raw', key))
    const iv = crypto.getRandomValues(new Uint8Array(12))
    const ct = new Uint8Array(await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv }, await wrapKey(), raw,
    ))
    // Overwrite the exported bytes; they have no business lingering.
    raw.fill(0)
    await idbPut(SESSION_ID, { iv, ct, kdf, expiresAt: Date.now() + ttl })
    return true
  } catch {
    return false
  }
}

/** Push the deadline out without re-encrypting; called whenever the vault is used. */
export const touchSession = async (ttl) => {
  try {
    if (!ttl || !sessionActive) return
    const held = await idbGet(SESSION_ID)
    if (!held || Date.now() >= held.expiresAt) return
    // Re-check after the await: a lock may have happened while we were
    // reading, and writing now would undo it.
    if (!sessionActive) return
    await idbPut(SESSION_ID, { ...held, expiresAt: Date.now() + ttl })
  } catch { /* a session that cannot be extended simply expires */ }
}

/**
 * The held key, or null. Expiry is enforced here and the record deleted, so a
 * lapsed session leaves nothing behind even if nothing else runs.
 */
export const recallSession = async () => {
  try {
    const held = await idbGet(SESSION_ID)
    if (!held) return null
    if (Date.now() >= held.expiresAt) { await forgetSession(); return null }
    sessionActive = true
    const raw = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: held.iv }, await wrapKey(), held.ct,
    )
    const key = await crypto.subtle.importKey(
      'raw', raw, { name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt'],
    )
    return { key, kdf: held.kdf }
  } catch {
    return null
  }
}

export const forgetSession = async () => {
  sessionActive = false
  try { await idbDelete(SESSION_ID) } catch {}
}
