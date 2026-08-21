// The browser-storage adapter for the vault (ROADMAP 9a).
//
// Extracted from vault-store.js, where it sat above the state machine it
// serves. It belongs on its own because it is the one piece that knows
// nothing about the vault: it moves opaque bytes in and out of IndexedDB and
// could not tell a sealed envelope from any other object.
//
// That is also why vault-fs.js and vault-location.js import it. They were
// reaching into the STORE for a storage adapter, which read as a cycle that
// happened not to be one.

// The one database, and the keys inside it. These moved here with the
// adapter: they were declared in vault-store.js above the section marker, so
// the extraction took the code that uses them and left the names behind.
// Every call then threw ReferenceError at runtime -- invisible to
// `node --check`, and invisible to the suite, which injects a fake storage
// and never touches this file.
const DB_NAME = 'pwgen-vault'
const STORE = 'vault'
const ENVELOPE_ID = 'envelope-v1'
const DRAFT_ID = 'draft-v1'

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
