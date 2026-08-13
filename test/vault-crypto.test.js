import test from 'node:test'
import assert from 'node:assert/strict'
import {
  createVault, openVault, sealVault, deriveKey, newSalt, changePassphrase,
  isVaultEnvelope, needsRekey, KDF_ITERATIONS, VAULT_VERSION,
} from '../src/vault-crypto.js'

// The vault is the one place in this project where a cryptographic mistake
// costs the user their passwords rather than a wrong number on a chart, so
// these tests are about the properties, not the happy path: a wrong
// passphrase must fail loudly, a tampered envelope must not decrypt at all,
// and no two seals may reuse an IV.
//
// Node's WebCrypto is the same spec the browser implements, so everything
// here except the storage layer is exercised for real.

const PASS = 'correct horse battery staple'
const ENTRIES = [
  { label: 'email', pw: 'Tireless4Marimba0Harvests', bits: 58.2, at: '2026-08-12' },
  { label: 'router', pw: 'silent-sparrow-storm-84', bits: 44.1, at: '2026-08-12' },
  { label: 'unicode ünïcödé 🎲', pw: '%V8p)c2Y=YQ3>9FDKK1E', bits: 118.8, at: '2026-08-12' },
]

test('a vault round-trips byte-for-byte', async () => {
  const { envelope } = await createVault(PASS, ENTRIES)
  assert.ok(isVaultEnvelope(envelope))
  assert.equal(envelope.v, VAULT_VERSION)
  const { data } = await openVault(envelope, PASS)
  assert.deepEqual(data, ENTRIES)
})

test('the envelope leaks nothing in plaintext', async () => {
  const { envelope } = await createVault(PASS, ENTRIES)
  const serialized = JSON.stringify(envelope)
  for (const needle of ['Marimba', 'sparrow', 'email', 'router', 'FDKK']) {
    assert.ok(!serialized.includes(needle), `"${needle}" survives into the envelope`)
  }
  // The KDF parameters are deliberately public -- they must be, to re-derive.
  assert.equal(envelope.kdf.name, 'PBKDF2')
  assert.equal(envelope.kdf.hash, 'SHA-256')
  assert.ok(typeof envelope.kdf.salt === 'string' && envelope.kdf.salt.length > 0)
})

test('the wrong passphrase fails loudly, never as an empty vault', async () => {
  // The dangerous failure is silent: presenting an empty vault to someone who
  // mistyped invites them to start over on top of their real data.
  const { envelope } = await createVault(PASS, ENTRIES)
  await assert.rejects(() => openVault(envelope, PASS + '!'))
  await assert.rejects(() => openVault(envelope, ''))
  await assert.rejects(() => openVault(envelope, PASS.toUpperCase()))
})

test('a tampered envelope refuses to decrypt', async () => {
  const { envelope } = await createVault(PASS, ENTRIES)
  const flip = (s) => {
    const i = s.length - 4
    return s.slice(0, i) + (s[i] === 'A' ? 'B' : 'A') + s.slice(i + 1)
  }
  // Ciphertext, IV and salt are all covered: GCM authenticates the first two,
  // and corrupting the salt derives a different key entirely.
  await assert.rejects(() => openVault({ ...envelope, ct: flip(envelope.ct) }, PASS))
  await assert.rejects(() => openVault({ ...envelope, iv: flip(envelope.iv) }, PASS))
  await assert.rejects(() => openVault(
    { ...envelope, kdf: { ...envelope.kdf, salt: flip(envelope.kdf.salt) } }, PASS,
  ))
})

test('every seal uses a fresh IV, and every vault a fresh salt', async () => {
  const a = await createVault(PASS, ENTRIES)
  const b = await createVault(PASS, ENTRIES)
  assert.notEqual(a.envelope.kdf.salt, b.envelope.kdf.salt, 'salt must not repeat across vaults')
  assert.notEqual(a.envelope.ct, b.envelope.ct)

  // Same key, same data, sealed twice: the IV must still differ. Reusing an
  // IV under one key is the single break that turns GCM into a toy.
  const one = await sealVault(a.key, a.kdf, ENTRIES)
  const two = await sealVault(a.key, a.kdf, ENTRIES)
  assert.notEqual(one.iv, two.iv)
  assert.notEqual(one.ct, two.ct)
})

test('resealing with the held key needs no passphrase and no re-derivation', async () => {
  // This is what makes saving an entry instant rather than a visible stall.
  const { envelope, key, kdf } = await createVault(PASS, ENTRIES)
  const updated = [...ENTRIES, { label: 'new', pw: 'x9!kQ', bits: 30, at: '2026-08-12' }]

  const started = process.hrtime.bigint()
  const resealed = await sealVault(key, kdf, updated)
  const ms = Number(process.hrtime.bigint() - started) / 1e6
  assert.ok(ms < 20, `reseal took ${ms.toFixed(1)}ms; it should be an AES pass, not a KDF run`)

  assert.equal(resealed.kdf.salt, envelope.kdf.salt, 'reseal must not re-salt')
  const { data } = await openVault(resealed, PASS)
  assert.deepEqual(data, updated)
})

test('the iteration count travels with the vault, so old vaults still open', async () => {
  // Sealed at a deliberately low cost, as a vault from an older release would
  // be. It must still open after the default is raised -- the envelope's own
  // count is what gets used, not today's constant.
  const salt = newSalt()
  const legacyKdf = { name: 'PBKDF2', hash: 'SHA-256', iterations: 1000, salt: btoa(String.fromCharCode(...salt)) }
  const legacyKey = await deriveKey(PASS, salt, 1000)
  const legacy = await sealVault(legacyKey, legacyKdf, ENTRIES)

  const { data } = await openVault(legacy, PASS)
  assert.deepEqual(data, ENTRIES)
  assert.ok(needsRekey(legacy), 'a vault below the current cost should be flagged for re-keying')

  const fresh = await createVault(PASS, ENTRIES)
  assert.ok(!needsRekey(fresh.envelope))
})

test('changing the passphrase re-keys, re-salts, and upgrades the cost', async () => {
  const salt = newSalt()
  const legacyKdf = { name: 'PBKDF2', hash: 'SHA-256', iterations: 1000, salt: btoa(String.fromCharCode(...salt)) }
  const legacy = await sealVault(await deriveKey(PASS, salt, 1000), legacyKdf, ENTRIES)

  const { envelope } = await changePassphrase(legacy, PASS, 'a different passphrase entirely')
  assert.equal(envelope.kdf.iterations, KDF_ITERATIONS, 'a re-key should adopt the current cost')
  assert.notEqual(envelope.kdf.salt, legacyKdf.salt)

  assert.deepEqual((await openVault(envelope, 'a different passphrase entirely')).data, ENTRIES)
  await assert.rejects(() => openVault(envelope, PASS), 'the old passphrase must stop working')
})

test('the cost parameter is defensible and stated in one place', async () => {
  // The UI quotes this number, so it lives in exactly one constant. 600k is
  // OWASP's 2023 floor for PBKDF2-SHA256; the assertion is a floor, not an
  // equality, so raising it later does not fail the suite.
  assert.ok(KDF_ITERATIONS >= 600_000, `${KDF_ITERATIONS} is below the OWASP floor`)
  const { envelope } = await createVault(PASS, [])
  assert.equal(envelope.kdf.iterations, KDF_ITERATIONS)
})

test('malformed input is rejected rather than guessed at', async () => {
  assert.ok(!isVaultEnvelope(null))
  assert.ok(!isVaultEnvelope('enc1:abc:def'))            // that is history's format
  assert.ok(!isVaultEnvelope({ v: 99, kdf: {}, iv: '', ct: '' }))
  assert.ok(!isVaultEnvelope({ v: VAULT_VERSION, ct: 'x' }))

  await assert.rejects(() => openVault({ nope: true }, PASS))
  const { envelope } = await createVault(PASS, ENTRIES)
  await assert.rejects(
    () => openVault({ ...envelope, kdf: { ...envelope.kdf, name: 'scrypt' } }, PASS),
    /unsupported kdf/,
  )
  await assert.rejects(
    () => openVault({ ...envelope, kdf: { ...envelope.kdf, iterations: 0 } }, PASS),
    /malformed kdf/,
  )
  await assert.rejects(() => deriveKey('', newSalt()), /passphrase is required/)
})

test('a large vault seals and opens without hitting an argument limit', async () => {
  // toB64 is chunked because the spread form overflows around 100k bytes, and
  // an exported vault can plausibly reach that. 4,000 entries is ~250 KB.
  const many = Array.from({ length: 4000 }, (_, i) => ({
    label: `entry ${i}`, pw: `p${i}-${'x'.repeat(40)}`, bits: 100 + (i % 30), at: '2026-08-12',
  }))
  const { envelope } = await createVault(PASS, many)
  const { data } = await openVault(envelope, PASS)
  assert.equal(data.length, 4000)
  assert.deepEqual(data[3999], many[3999])
})
