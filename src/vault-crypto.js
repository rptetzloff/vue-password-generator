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
 * PBKDF2-SHA256 iterations for new vaults. OWASP's 2023 floor for this
 * algorithm; stated in the UI rather than hidden, because an iteration count
 * is the one KDF parameter a user can meaningfully be told.
 *
 * Argon2id would be the better primitive, but every browser implementation
 * arrives as a WebAssembly dependency, and this project has none. PBKDF2 is
 * what the platform gives us, so the answer is to use it at a defensible
 * count rather than to add a build step -- see the note in About.
 */
export const KDF_ITERATIONS = 600_000

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
export const deriveKey = async (passphrase, salt, iterations = KDF_ITERATIONS) => {
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
    false,
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
 * one AES pass instead of 600,000 PBKDF2 rounds -- the difference between a
 * save that is instant and one that visibly stalls.
 */
export const sealVault = async (key, kdf, data) => {
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES))
  const plaintext = new TextEncoder().encode(JSON.stringify(data))
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plaintext))
  return { v: VAULT_VERSION, kdf: { ...kdf }, iv: toB64(iv), ct: toB64(ct) }
}

/** A brand new vault: fresh salt, key derived at the current default cost. */
export const createVault = async (passphrase, data = []) => {
  const salt = newSalt()
  const kdf = {
    name: 'PBKDF2',
    hash: 'SHA-256',
    iterations: KDF_ITERATIONS,
    salt: toB64(salt),
  }
  const key = await deriveKey(passphrase, salt, kdf.iterations)
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
export const openVault = async (envelope, passphrase) => {
  if (!isVaultEnvelope(envelope)) throw new Error('not a vault envelope')
  const { kdf } = envelope
  if (kdf.name !== 'PBKDF2' || kdf.hash !== 'SHA-256') {
    throw new Error(`unsupported kdf: ${kdf.name}/${kdf.hash}`)
  }
  if (!Number.isInteger(kdf.iterations) || kdf.iterations < 1) {
    throw new Error('malformed kdf iterations')
  }
  const key = await deriveKey(passphrase, fromB64(kdf.salt), kdf.iterations)
  const pt = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: fromB64(envelope.iv) }, key, fromB64(envelope.ct),
  )
  return { data: JSON.parse(new TextDecoder().decode(pt)), key, kdf }
}

/**
 * Re-key an existing vault under a new passphrase: new salt, current default
 * iteration count, same data. Also the upgrade path for the cost parameter --
 * a vault sealed at an older count is re-sealed at today's whenever the
 * passphrase changes.
 */
export const changePassphrase = async (envelope, oldPassphrase, newPassphrase) => {
  const { data } = await openVault(envelope, oldPassphrase)
  return createVault(newPassphrase, data)
}

/**
 * Whether a vault should be re-sealed at a higher cost than it was created
 * with. Kept as a pure predicate so the UI can offer it rather than doing it
 * silently -- re-keying needs the passphrase, and asking for it out of
 * nowhere is exactly the pattern phishing imitates.
 */
export const needsRekey = (envelope) =>
  isVaultEnvelope(envelope) && envelope.kdf.iterations < KDF_ITERATIONS
