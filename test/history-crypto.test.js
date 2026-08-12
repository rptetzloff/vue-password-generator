import test from 'node:test'
import assert from 'node:assert/strict'
import { encryptJSON, decryptJSON, isEncryptedEnvelope, ENVELOPE_PREFIX } from '../src/history-crypto.js'

// getHistoryKey needs IndexedDB (browser-only); the crypto itself does not.
// Node's global WebCrypto stands in for the browser's -- same spec, same
// algorithm -- so the envelope logic is proven here and only the key storage
// is trusted to the browser.
const freshKey = () =>
  crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'])

test('history encrypts to an envelope and decrypts back byte-for-byte', async () => {
  const key = await freshKey()
  const history = [
    { pw: 'Tireless4Marimba0Harvests7Wondrously', bits: 43.4 },
    { pw: 'correct-horse-battery-staple', bits: null },
    { pw: 'emoji 🎲 and unicode ünïcödé survive', bits: 12.5 },
  ]
  const blob = await encryptJSON(key, history)
  assert.ok(isEncryptedEnvelope(blob))
  assert.ok(blob.startsWith(ENVELOPE_PREFIX))
  assert.ok(!blob.includes('Marimba'), 'the ciphertext must not leak plaintext')
  assert.deepEqual(await decryptJSON(key, blob), history)
})

test('every encryption uses a fresh IV', async () => {
  const key = await freshKey()
  const a = await encryptJSON(key, ['same'])
  const b = await encryptJSON(key, ['same'])
  assert.notEqual(a, b, 'identical plaintext must not produce identical envelopes')
})

test('a tampered envelope refuses to decrypt rather than returning garbage', async () => {
  const key = await freshKey()
  const blob = await encryptJSON(key, [{ pw: 'secret', bits: 1 }])
  // Flip a character in the ciphertext half.
  const flipAt = blob.length - 4
  const tampered = blob.slice(0, flipAt) + (blob[flipAt] === 'A' ? 'B' : 'A') + blob.slice(flipAt + 1)
  await assert.rejects(() => decryptJSON(key, tampered))
})

test('the wrong key refuses to decrypt', async () => {
  const blob = await encryptJSON(await freshKey(), [{ pw: 'secret', bits: 1 }])
  const otherKey = await freshKey()
  await assert.rejects(() => decryptJSON(otherKey, blob))
})

test('envelope detection accepts only its own format', async () => {
  assert.ok(!isEncryptedEnvelope(['plain', 'array']))
  assert.ok(!isEncryptedEnvelope(null))
  assert.ok(!isEncryptedEnvelope('enc2:future:format'))
  assert.ok(isEncryptedEnvelope('enc1:abc:def'))
  const key = await freshKey()
  await assert.rejects(() => decryptJSON(key, ['not', 'a', 'string']))
})
