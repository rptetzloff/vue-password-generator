import test from 'node:test'
import assert from 'node:assert/strict'
import {
  createVault, openVault, sealVault, deriveKey, newSalt,
  isVaultEnvelope, needsRekey, needsUpgrade, KDF_ITERATIONS, VAULT_VERSION,
  addSlot, removeSlot, slotsOf, hasRecovery,
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
  const slot = envelope.wraps.passphrase
  assert.equal(slot.kdf.name, 'PBKDF2')
  assert.equal(slot.kdf.hash, 'SHA-256')
  assert.ok(typeof slot.kdf.salt === 'string' && slot.kdf.salt.length > 0)
  // And the wrapped master key is 32 bytes plus a GCM tag, not the data.
  assert.ok(slot.key.length > 0 && slot.key.length < 100, 'the wrap holds a key, not a vault')
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
  await assert.rejects(() => openVault({
    ...envelope,
    wraps: {
      passphrase: {
        ...envelope.wraps.passphrase,
        kdf: { ...envelope.wraps.passphrase.kdf, salt: flip(envelope.wraps.passphrase.kdf.salt) },
      },
    },
  }, PASS))
  // Tampering with the wrapped key itself must fail the unwrap, not produce a
  // key that decrypts to nonsense.
  await assert.rejects(() => openVault({
    ...envelope,
    wraps: { passphrase: { ...envelope.wraps.passphrase, key: flip(envelope.wraps.passphrase.key) } },
  }, PASS))
})

test('every seal uses a fresh IV, and every vault a fresh salt', async () => {
  const a = await createVault(PASS, ENTRIES)
  const b = await createVault(PASS, ENTRIES)
  assert.notEqual(a.envelope.wraps.passphrase.kdf.salt, b.envelope.wraps.passphrase.kdf.salt,
    'salt must not repeat across vaults')
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

  // Counted rather than timed, for the reason spelled out on the re-key test
  // in vault-store.test.js: a wall-clock budget measures the machine's load
  // as much as the code. Zero PBKDF2 runs is the claim being made anyway.
  let derivations = 0
  const real = crypto.subtle.deriveKey.bind(crypto.subtle)
  crypto.subtle.deriveKey = (algorithm, ...rest) => {
    if (algorithm && algorithm.name === 'PBKDF2') derivations++
    return real(algorithm, ...rest)
  }
  let resealed
  try {
    resealed = await sealVault(key, kdf, updated)
  } finally {
    crypto.subtle.deriveKey = real
  }
  assert.equal(derivations, 0, 'a reseal should be an AES pass, not a KDF run')

  assert.equal(resealed.wraps.passphrase.kdf.salt, envelope.wraps.passphrase.kdf.salt,
    'reseal must not re-salt')
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

test('the cost parameter is defensible and stated in one place', async () => {
  // The UI quotes this number, so it lives in exactly one constant. 600k is
  // OWASP's 2023 floor for PBKDF2-SHA256; the assertion is a floor, not an
  // equality, so raising it later does not fail the suite.
  assert.ok(KDF_ITERATIONS >= 600_000, `${KDF_ITERATIONS} is below the OWASP floor`)
  const { envelope } = await createVault(PASS, [])
  assert.equal(envelope.wraps.passphrase.kdf.iterations, KDF_ITERATIONS)
})

test('malformed input is rejected rather than guessed at', async () => {
  assert.ok(!isVaultEnvelope(null))
  assert.ok(!isVaultEnvelope('enc1:abc:def'))            // that is history's format
  assert.ok(!isVaultEnvelope({ v: 99, kdf: {}, iv: '', ct: '' }))
  assert.ok(!isVaultEnvelope({ v: VAULT_VERSION, ct: 'x' }))

  await assert.rejects(() => openVault({ nope: true }, PASS))
  const { envelope } = await createVault(PASS, ENTRIES)
  const reslot = (patch) => ({
    ...envelope,
    wraps: { passphrase: { ...envelope.wraps.passphrase, kdf: { ...envelope.wraps.passphrase.kdf, ...patch } } },
  })
  await assert.rejects(() => openVault(reslot({ name: 'scrypt' }), PASS), /unsupported kdf/)
  await assert.rejects(() => openVault(reslot({ iterations: 0 }), PASS), /malformed kdf/)
  await assert.rejects(() => openVault(envelope, PASS, null, false, 'recovery'), /no recovery key/)
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

// -- Two ways in (ROADMAP 9f) ------------------------------------------------
//
// The property that matters: either key reaches the same plaintext, and
// neither reveals the other. A vault with two keys is only as strong as the
// weaker one, which is why the recovery key is generated rather than chosen --
// enforced in recovery-key.js, not here. What is enforced here is that adding
// one cannot happen without already being able to open the vault.

const RECOVERY = 'clover tundra basil ember quartz willow harbor jasper ' +
  'nimbus cobalt fennel marrow trellis pumice sorrel vellum'

/** A vault with both ways in, as the store builds one. */
const withRecovery = async (pass = PASS, data = ENTRIES) => {
  const made = await createVault(pass, data)
  const master = await unwrapForTest(made.envelope, pass)
  return { ...made, envelope: await addSlot(made.envelope, 'recovery', RECOVERY, master) }
}

/** Adding a slot needs an extractable master, which the store re-derives. */
const unwrapForTest = async (envelope, secret, slot = 'passphrase') => {
  const opened = await openVault(envelope, secret, null, true, slot)
  return opened.key
}

test('either key opens the same vault', async () => {
  const { envelope } = await withRecovery()
  assert.deepEqual((await openVault(envelope, PASS)).data, ENTRIES)
  assert.deepEqual((await openVault(envelope, RECOVERY, null, false, 'recovery')).data, ENTRIES)
})

test('each way in is sealed independently', async () => {
  // Shared salt or shared IV between the slots would relate two ciphertexts of
  // the same plaintext under different keys, which is the thing GCM's IV rule
  // exists to prevent.
  const { envelope } = await withRecovery()
  const p = envelope.wraps.passphrase
  const r = envelope.wraps.recovery
  assert.notEqual(p.kdf.salt, r.kdf.salt, 'each slot needs its own salt')
  assert.notEqual(p.iv, r.iv, 'each slot needs its own IV')
  assert.notEqual(p.key, r.key)
})

test('the recovery key is not recoverable from the envelope', async () => {
  const { envelope } = await withRecovery()
  const serialized = JSON.stringify(envelope)
  for (const word of RECOVERY.split(' ')) {
    assert.ok(!serialized.includes(word), `"${word}" survives into the envelope`)
  }
  // Nor does holding one key let you read the other's secret back out.
  await assert.rejects(() => openVault(envelope, PASS, null, false, 'recovery'))
  await assert.rejects(() => openVault(envelope, RECOVERY))
})

test('a recovery key cannot be added to a vault you cannot open', async () => {
  // The gate is structural rather than a check: wrapping needs the master key,
  // and the only way to hold one is to have already opened the vault.
  const { envelope } = await createVault(PASS, ENTRIES)
  const wrongMaster = await unwrapForTest(await createVault('a different vault', []).then((v) => v.envelope), 'a different vault')

  const bogus = await addSlot(envelope, 'recovery', RECOVERY, wrongMaster)
  // It "succeeds" -- nothing can tell one AES key from another -- but the slot
  // it writes opens a different vault, so the data still will not decrypt.
  await assert.rejects(() => openVault(bogus, RECOVERY, null, false, 'recovery'))
  assert.deepEqual((await openVault(bogus, PASS)).data, ENTRIES,
    'and the real key is untouched by the attempt')
})

test('revoking recovery leaves the passphrase working', async () => {
  const { envelope } = await withRecovery()
  assert.equal(hasRecovery(envelope), true)

  const revoked = removeSlot(envelope, 'recovery')
  assert.equal(hasRecovery(revoked), false)
  assert.deepEqual(slotsOf(revoked), ['passphrase'])
  assert.deepEqual((await openVault(revoked, PASS)).data, ENTRIES)
  await assert.rejects(() => openVault(revoked, RECOVERY, null, false, 'recovery'), /no recovery key/)
})

test('the passphrase slot cannot be removed', async () => {
  // Removing the only way in is not revocation, it is destruction, and it has
  // its own deliberate path with its own confirmation.
  const { envelope } = await withRecovery()
  assert.equal(removeSlot(envelope, 'passphrase'), envelope)
  assert.deepEqual((await openVault(envelope, PASS)).data, ENTRIES)
})

test('regenerating a recovery key revokes the old one', async () => {
  // The UI never shows a key twice: "I lost it" means a new one, and the old
  // paper must stop working the moment the new one is made.
  const { envelope } = await withRecovery()
  const master = await unwrapForTest(envelope, PASS)
  const second = 'aspen ' + RECOVERY.split(' ').slice(1).join(' ')
  const rolled = await addSlot(envelope, 'recovery', second, master)

  assert.deepEqual((await openVault(rolled, second, null, false, 'recovery')).data, ENTRIES)
  await assert.rejects(() => openVault(rolled, RECOVERY, null, false, 'recovery'))
})

test('a v1 vault still opens, and is flagged for upgrade', async () => {
  // Every vault created before this release. They must keep working untouched
  // until the user does something that has the passphrase in hand anyway.
  const salt = newSalt()
  const kdf = { name: 'PBKDF2', hash: 'SHA-256', iterations: 1000, salt: btoa(String.fromCharCode(...salt)) }
  const v1 = await sealVault(await deriveKey(PASS, salt, 1000), kdf, ENTRIES)

  assert.equal(v1.v, 1)
  assert.ok(isVaultEnvelope(v1))
  assert.deepEqual((await openVault(v1, PASS)).data, ENTRIES)
  assert.ok(needsUpgrade(v1), 'v1 cannot hold a recovery key, so it needs the new format')
  assert.equal(hasRecovery(v1), false)
  await assert.rejects(() => openVault(v1, RECOVERY, null, false, 'recovery'), /no recovery key/)
})

test('a v2 vault is not flagged for upgrade', async () => {
  const { envelope } = await createVault(PASS, ENTRIES)
  assert.equal(needsUpgrade(envelope), false)
  assert.equal(needsRekey(envelope), false)
})

test('a slot below the current cost flags a re-key', async () => {
  // Each slot carries its own iteration count, because a recovery key added
  // next year may be wrapped at a different default than the passphrase was.
  const { envelope } = await createVault(PASS, ENTRIES)
  const stale = {
    ...envelope,
    wraps: {
      ...envelope.wraps,
      recovery: { ...envelope.wraps.passphrase, kdf: { ...envelope.wraps.passphrase.kdf, iterations: 1000 } },
    },
  }
  assert.ok(needsRekey(stale), 'any slot below the floor should flag')
})
