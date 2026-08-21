// The vault's cryptography (ROADMAP 9a). Storage-agnostic on purpose: this
// module turns a passphrase and some data into a sealed envelope and back,
// and knows nothing about where the envelope is kept.
//
// How this differs from history-crypto.js, and why it has to:
//
//   History is encrypted with an ambient key -- generated once, marked
//   non-extractable, and left in IndexedDB. That stops anything reading
//   localStorage off the disk, but not someone driving the browser profile,
//   because the browser can use the key without being asked for anything.
//   That is an honest floor for a list of recent output.
//
//   A vault has to beat that bar. The key here is derived from a passphrase
//   the user knows and is held in memory only while unlocked, so a stolen
//   profile yields ciphertext and a KDF cost, not passwords. What it still
//   cannot defend against is code running on this origin while the vault is
//   open, or a keylogger -- no browser-side design can, and the UI should say
//   so rather than imply otherwise.
//
// Format, versioned so the parameters can move without stranding old vaults.
//
//   v1: { v: 1, kdf: { name, hash, iterations, salt }, iv, ct }
//
//       The data is encrypted directly under the passphrase-derived key.
//       Still opened, never written again.
//
//   v2: { v: 2, wraps: { passphrase: SLOT, recovery: SLOT? }, iv, ct }
//       SLOT = { kdf: { name, hash, iterations, salt }, iv, key }
//
//       The data is encrypted under a random master key, and the master key is
//       wrapped once per way in. Either wrap opens the vault.
//
// WHY THE INDIRECTION (ROADMAP 9f). A recovery key has to reach the same
// plaintext as the passphrase does. With v1 that is impossible without either
// storing the passphrase somewhere -- absurd -- or keeping two full copies of
// the ciphertext in step, which is two chances to save one and lose the other.
// A wrapped master key is the standard answer and it buys two more things:
// changing the passphrase re-wraps 32 bytes instead of re-encrypting the whole
// vault, and revoking recovery is deleting one field.
//
// The master key is generated extractable, because wrapKey cannot export a key
// that is not -- and is immediately re-imported non-extractable for use, so
// what the running page holds still cannot be read out by script. The
// extractable original is not retained. `holdsSession` is the one exception,
// exactly as before: "stay unlocked between pages" needs a key it can store.
//
// The iteration count travels *with* each slot rather than being read from the
// constant below, so raising the default later still opens every existing
// vault -- and each slot carries its own, since the recovery slot may have
// been added under a different default than the passphrase slot.

export const VAULT_VERSION = 2

/** Envelope versions this build can open. Writing is always the latest. */
export const SUPPORTED_VERSIONS = [1, 2]

/**
 * PBKDF2-SHA256 iterations for new vaults. Stated in the UI rather than
 * hidden, because an iteration count is the one KDF parameter a user can
 * meaningfully be told.
 *
 * Why 1,000,000 and not 10,000,000. Attacker cost scales LINEARLY with this
 * number, so the strength it buys is logarithmic: measured on a 2026 desktop,
 * derivation is almost exactly 0.1ms per thousand iterations, and
 *
 *     600k -> 54ms      1M -> 93ms      2M -> 191ms
 *       5M -> 475ms    10M -> 1032ms
 *
 * Going from 600k to 10M is a 16.7x cost increase, which is log2(16.7) = 4.1
 * bits -- less than one extra random lowercase letter (4.7 bits). It would
 * buy that for a full second of unlock latency on a fast desktop, and several
 * on a phone, on a screen the user hits every time the lock window expires.
 * One more word in the passphrase beats the whole trade and costs nothing.
 *
 * So this is not tuned for maximum bits; it is tuned to sit clear of OWASP's
 * 2023 floor of 600k as hardware improves, at a latency nobody notices. The
 * count travels inside each envelope, so raising it again later never strands
 * an existing vault -- needsRekey() flags those and re-encrypts on the next
 * passphrase change.
 *
 * Argon2id would be the better primitive, being memory-hard where PBKDF2 is
 * merely slow, and no amount of PBKDF2 iterations closes that gap: it changes
 * the constant, not the attacker's parallelism. But Web Crypto does not
 * implement it -- deriveBits offers PBKDF2, HKDF and ECDH only -- so it
 * arrives as a WebAssembly blob in the most security-critical path in the
 * product, which is a trade worth making deliberately rather than in passing.
 * See ROADMAP 9f.
 */
export const KDF_ITERATIONS = 1_000_000

const SALT_BYTES = 16
const IV_BYTES = 12

// btoa(String.fromCharCode(...bytes)) overflows the argument limit somewhere
// around 100k entries, which a vault export can plausibly reach. Chunked, so
// size is not a correctness cliff.
const toB64 = (bytes) => {
  let out = ''
  for (let i = 0; i < bytes.length; i += 0x8000) {
    out += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  }
  return btoa(out)
}
const fromB64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0))

export const newSalt = () => crypto.getRandomValues(new Uint8Array(SALT_BYTES))

/**
 * Passphrase + salt -> AES-GCM key. Non-extractable: the derived bytes never
 * become readable to script, so a vault open in a tab cannot have its key
 * exfiltrated as a value even if something is running on the origin.
 */
export const deriveKey = async (
  passphrase, salt, iterations = KDF_ITERATIONS, extractable = false,
  // A key-encryption key needs wrapKey/unwrapKey; Web Crypto refuses to wrap
  // with a key that only claims encrypt/decrypt. Defaulted to the data-key
  // usages so every existing caller is unchanged.
  usages = ['encrypt', 'decrypt'],
) => {
  if (typeof passphrase !== 'string' || passphrase === '') {
    throw new Error('a passphrase is required')
  }
  const material = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(passphrase), 'PBKDF2', false, ['deriveKey'],
  )
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations },
    material,
    { name: 'AES-GCM', length: 256 },
    // Non-extractable by default: the derived bytes never become readable to
    // script. Only the "stay unlocked between pages" setting turns this on,
    // because a key that cannot be exported cannot be held for later either
    // -- see vault-session.js for what that costs.
    extractable,
    usages,
  )
}

const isSlot = (s) =>
  !!s && typeof s === 'object' && !!s.kdf &&
  typeof s.iv === 'string' && typeof s.key === 'string'

export const isVaultEnvelope = (value) => {
  if (!value || typeof value !== 'object') return false
  if (typeof value.ct !== 'string' || typeof value.iv !== 'string') return false
  if (value.v === 1) return !!value.kdf
  if (value.v === 2) return !!value.wraps && isSlot(value.wraps.passphrase)
  return false
}

/** Which ways in an envelope has. v1 has exactly one and cannot grow another. */
export const slotsOf = (envelope) =>
  envelope && envelope.v === 2 && envelope.wraps
    ? Object.keys(envelope.wraps).filter((k) => isSlot(envelope.wraps[k]))
    : ['passphrase']

export const hasRecovery = (envelope) => slotsOf(envelope).includes('recovery')

/**
 * Encrypt `data` under an already-derived key. A fresh IV every time, which
 * is GCM's one unbreakable rule: reusing an IV under the same key leaks the
 * relationship between the two plaintexts.
 *
 * `kdf` is carried through unchanged so a reseal after an ordinary edit costs
 * one AES pass instead of a million PBKDF2 rounds -- the difference between a
 * save that is instant and one that visibly stalls.
 */
export const sealVault = async (key, kdf, data) => {
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES))
  const plaintext = new TextEncoder().encode(JSON.stringify(data))
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plaintext))
  // `kdf` is the whole wraps object on a v2 envelope and the single kdf on a
  // v1 one; sealing does not care which, it only re-attaches what it was given.
  const carried = kdf && kdf.passphrase ? { v: 2, wraps: kdf } : { v: 1, kdf: { ...kdf } }
  return { ...carried, iv: toB64(iv), ct: toB64(ct) }
}

const newKdf = (iterations = KDF_ITERATIONS) => ({
  name: 'PBKDF2',
  hash: 'SHA-256',
  iterations,
  salt: toB64(newSalt()),
})

const checkKdf = (kdf) => {
  if (!kdf || kdf.name !== 'PBKDF2' || kdf.hash !== 'SHA-256') {
    throw new Error(`unsupported kdf: ${kdf && kdf.name}/${kdf && kdf.hash}`)
  }
  if (!Number.isInteger(kdf.iterations) || kdf.iterations < 1) {
    throw new Error('malformed kdf iterations')
  }
  return kdf
}

/**
 * A fresh master key. Generated extractable because `wrapKey` refuses to
 * export a key that is not; `unwrapKey` then produces the non-extractable copy
 * that actually gets used, and this one is dropped.
 */
const newMasterKey = () =>
  crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt'])

/**
 * Wrap the master key for one way in. Each slot gets its own salt and its own
 * IV -- sharing either between the passphrase and recovery slots would relate
 * two ciphertexts of the same plaintext under different keys, which is exactly
 * the thing GCM's IV rule exists to prevent.
 */
const wrapMaster = async (masterKey, secret, iterations = KDF_ITERATIONS) => {
  const kdf = newKdf(iterations)
  // Both usages from one derivation. Creating a vault needs to wrap the master
  // and then unwrap it again to get the non-extractable working copy, and
  // deriving twice for that would double the cost of the slowest operation in
  // the product for no reason -- one million rounds, not two.
  const kek = await deriveKey(secret, fromB64(kdf.salt), kdf.iterations, false, ['wrapKey', 'unwrapKey'])
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES))
  const wrapped = new Uint8Array(
    await crypto.subtle.wrapKey('raw', masterKey, kek, { name: 'AES-GCM', iv }),
  )
  return { slot: { kdf, iv: toB64(iv), key: toB64(wrapped) }, kek }
}

/**
 * Unwrap the master key from one slot. A wrong secret throws here rather than
 * further down: GCM authenticates the wrap, so this is where "that passphrase
 * is not the one" is actually discovered.
 */
const unwrapWith = (slot, kek, extractable = false) =>
  crypto.subtle.unwrapKey(
    'raw', fromB64(slot.key), kek,
    { name: 'AES-GCM', iv: fromB64(slot.iv) },
    { name: 'AES-GCM', length: 256 },
    extractable,
    ['encrypt', 'decrypt'],
  )

const unwrapMaster = async (slot, secret, extractable = false) => {
  checkKdf(slot.kdf)
  const kek = await deriveKey(secret, fromB64(slot.kdf.salt), slot.kdf.iterations, false, ['unwrapKey'])
  return crypto.subtle.unwrapKey(
    'raw', fromB64(slot.key), kek,
    { name: 'AES-GCM', iv: fromB64(slot.iv) },
    { name: 'AES-GCM', length: 256 },
    extractable,
    ['encrypt', 'decrypt'],
  )
}

/** A brand new vault: a random master key, wrapped under the passphrase. */
export const createVault = async (passphrase, data = [], extractable = false) => {
  if (typeof passphrase !== 'string' || passphrase === '') {
    throw new Error('a passphrase is required')
  }
  const master = await newMasterKey()
  const { slot, kek } = await wrapMaster(master, passphrase)
  const wraps = { passphrase: slot }
  // Re-import non-extractable for use, reusing the KEK just derived, and let
  // the extractable original go.
  const key = await unwrapWith(slot, kek, extractable)
  return { envelope: await sealVault(key, wraps, data), key, kdf: wraps }
}

/**
 * Add a second way in, given the master key of an already-open vault. Returns
 * a new envelope; the caller stores it.
 *
 * Requires the vault to be unlocked, which is the point: enabling recovery is
 * something only the person who can already open it may do.
 */
export const addSlot = async (envelope, name, secret, masterKey) => {
  if (envelope.v !== 2) throw new Error('only a v2 envelope has slots')
  if (!masterKey || !masterKey.extractable) {
    // Wrapping needs an exportable key, and the working copy deliberately is
    // not one. The store re-derives an extractable master for this operation.
    throw new Error('adding a slot needs an extractable master key')
  }
  const { slot } = await wrapMaster(masterKey, secret)
  return { ...envelope, wraps: { ...envelope.wraps, [name]: slot } }
}

/** Remove a way in. The passphrase slot is not removable -- that is a delete. */
export const removeSlot = (envelope, name) => {
  if (envelope.v !== 2 || name === 'passphrase') return envelope
  if (!envelope.wraps || !envelope.wraps[name]) return envelope
  const wraps = { ...envelope.wraps }
  delete wraps[name]
  return { ...envelope, wraps }
}

/**
 * Open an envelope. Returns the data plus the live key and kdf, so the caller
 * can reseal on save without touching the passphrase again.
 *
 * A wrong passphrase throws rather than returning empty: GCM authenticates,
 * so "decrypted to nothing" is not a state that can be confused with "the
 * vault is empty". That distinction matters -- silently presenting an empty
 * vault to someone who mistyped would invite them to start over on top of
 * their real data.
 */
export const openVault = async (
  envelope, passphrase, existingKey = null, extractable = false, slot = 'passphrase',
) => {
  if (!isVaultEnvelope(envelope)) throw new Error('not a vault envelope')

  // An already-derived key skips the KDF entirely. Used when the key comes
  // back from the session holder after a page navigation -- re-deriving there
  // would need the passphrase, which is the whole thing being avoided. A key
  // that does not match still fails, because GCM authenticates.
  let key = existingKey
  let kdf

  if (envelope.v === 1) {
    // v1 has no master key: the passphrase key *is* the data key. Read-only
    // from here on -- anything that writes upgrades to v2 first.
    if (slot !== 'passphrase') throw new Error('a v1 vault has no recovery key')
    kdf = checkKdf(envelope.kdf)
    if (!key) key = await deriveKey(passphrase, fromB64(kdf.salt), kdf.iterations, extractable)
  } else {
    const wrap = envelope.wraps[slot]
    if (!wrap) throw new Error(`this vault has no ${slot} key`)
    kdf = envelope.wraps
    if (!key) key = await unwrapMaster(wrap, passphrase, extractable)
  }

  const pt = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: fromB64(envelope.iv) }, key, fromB64(envelope.ct),
  )
  return { data: JSON.parse(new TextDecoder().decode(pt)), key, kdf, version: envelope.v }
}

// Re-keying lives in vault-store.js rather than here. A helper at this level
// would open the envelope and then hand its result to createVault, which
// re-opens what it just sealed -- three derivations where two is the floor,
// and on a phone that is a visible stall. The store already has to update its
// in-memory state, so it does both in one pass.

/**
 * Whether a vault should be re-sealed at a higher cost than it was created
 * with. Kept as a pure predicate so the UI can offer it rather than doing it
 * silently -- re-keying needs the passphrase, and asking for it out of
 * nowhere is exactly the pattern phishing imitates.
 */
export const needsRekey = (envelope) => {
  if (!isVaultEnvelope(envelope)) return false
  // A v1 envelope is behind by definition -- not because its cost is wrong,
  // but because the format cannot hold a recovery key.
  if (envelope.v === 1) return true
  return Object.values(envelope.wraps).some((s) => s.kdf.iterations < KDF_ITERATIONS)
}

/** Whether the envelope predates the wrapped-master-key format. */
export const needsUpgrade = (envelope) => isVaultEnvelope(envelope) && envelope.v === 1
