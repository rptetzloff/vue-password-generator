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
// Format, versioned so the parameters can move without stranding old vaults:
//
//   { v: 1, kdf: { name, hash, iterations, salt }, iv, ct }
//
// The iteration count travels *with* the envelope rather than being read from
// the constant below, so raising the default later still opens every vault
// sealed under the old one.

export const VAULT_VERSION = 1

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
export const deriveKey = async (passphrase, salt, iterations = KDF_ITERATIONS, extractable = false) => {
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
    ['encrypt', 'decrypt'],
  )
}

export const isVaultEnvelope = (value) =>
  !!value && typeof value === 'object' && value.v === VAULT_VERSION &&
  !!value.kdf && typeof value.ct === 'string' && typeof value.iv === 'string'

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
  return { v: VAULT_VERSION, kdf: { ...kdf }, iv: toB64(iv), ct: toB64(ct) }
}

/** A brand new vault: fresh salt, key derived at the current default cost. */
export const createVault = async (passphrase, data = [], extractable = false) => {
  const salt = newSalt()
  const kdf = {
    name: 'PBKDF2',
    hash: 'SHA-256',
    iterations: KDF_ITERATIONS,
    salt: toB64(salt),
  }
  const key = await deriveKey(passphrase, salt, kdf.iterations, extractable)
  return { envelope: await sealVault(key, kdf, data), key, kdf }
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
export const openVault = async (envelope, passphrase, existingKey = null, extractable = false) => {
  if (!isVaultEnvelope(envelope)) throw new Error('not a vault envelope')
  const { kdf } = envelope
  if (kdf.name !== 'PBKDF2' || kdf.hash !== 'SHA-256') {
    throw new Error(`unsupported kdf: ${kdf.name}/${kdf.hash}`)
  }
  if (!Number.isInteger(kdf.iterations) || kdf.iterations < 1) {
    throw new Error('malformed kdf iterations')
  }
  // An already-derived key skips the KDF entirely. Used when the key comes
  // back from the session holder after a page navigation -- re-deriving there
  // would need the passphrase, which is the whole thing being avoided. A key
  // that does not match still fails, because GCM authenticates.
  const key = existingKey || await deriveKey(passphrase, fromB64(kdf.salt), kdf.iterations, extractable)
  const pt = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: fromB64(envelope.iv) }, key, fromB64(envelope.ct),
  )
  return { data: JSON.parse(new TextDecoder().decode(pt)), key, kdf }
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
export const needsRekey = (envelope) =>
  isVaultEnvelope(envelope) && envelope.kdf.iterations < KDF_ITERATIONS
