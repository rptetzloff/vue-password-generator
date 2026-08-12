// AES-GCM at rest for generation history.
//
// The key is generated once, marked non-extractable, and lives in IndexedDB;
// only ciphertext ever touches localStorage. Threat-model honesty: this
// shields the history from casual inspection and from anything that scrapes
// localStorage off disk, but it cannot protect against code running on this
// origin or anyone with full control of the browser profile -- the browser
// must be able to use the key, so such an attacker can too. It raises the
// floor; it is not a vault.

const DB_NAME = 'pwgen-keys'
const STORE = 'keys'
const KEY_ID = 'history-v1'
export const ENVELOPE_PREFIX = 'enc1:'

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
    rq.onsuccess = () => resolve(rq.result)
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

/** The one history key, created on first use. Non-extractable: the browser
 *  can use it, but no script can read its raw bytes back out. */
export const getHistoryKey = async () => {
  let key = await idbGet(KEY_ID)
  if (!key) {
    key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'])
    await idbPut(KEY_ID, key)
  }
  return key
}

const toB64 = (bytes) => btoa(String.fromCharCode(...bytes))
const fromB64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0))

export const isEncryptedEnvelope = (value) =>
  typeof value === 'string' && value.startsWith(ENVELOPE_PREFIX)

/** JSON value -> "enc1:<iv>:<ciphertext>", both parts base64. Fresh IV each
 *  call -- GCM's one hard rule is never to reuse one under the same key. */
export const encryptJSON = async (key, value) => {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const plaintext = new TextEncoder().encode(JSON.stringify(value))
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plaintext))
  return ENVELOPE_PREFIX + toB64(iv) + ':' + toB64(ct)
}

/** Inverse of encryptJSON. Throws on a malformed envelope, a wrong key, or a
 *  tampered ciphertext -- GCM authenticates, so corruption cannot decrypt to
 *  quiet garbage. */
export const decryptJSON = async (key, blob) => {
  if (!isEncryptedEnvelope(blob)) throw new Error('not an encrypted envelope')
  const [ivB64, ctB64] = blob.slice(ENVELOPE_PREFIX.length).split(':')
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromB64(ivB64) }, key, fromB64(ctB64))
  return JSON.parse(new TextDecoder().decode(pt))
}
