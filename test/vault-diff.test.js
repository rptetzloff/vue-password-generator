import test from 'node:test'
import assert from 'node:assert/strict'
import {
  diffEntries, diffHasSecrets, diffHasTotp, shownValue, describeTotp, MASK,
} from '../src/vault-diff.js'
import { normalizeEntry } from '../src/vault-entry.js'
import { parseTotpInput } from '../src/totp.js'

// The conflict dialog is the only place in WordLock that puts two versions of
// an entry side by side, which makes it the one place a secret can reach the
// screen without anyone asking for it. These are the rules that stop that.

const SEED = 'JBSWY3DPEHPK3PXP'
const totp = () => parseTotpInput(`otpauth://totp/Example:alice@example.com?secret=${SEED}&issuer=Example`)

const entry = (over = {}) => normalizeEntry({
  id: 'e1', label: 'Bank', pw: 'original-password', updatedAt: '2026-08-15T10:00:00.000Z', ...over,
})

test('the one-time code seed never reaches the diff, revealed or not', async () => {
  // The bug this file exists for. The first version stringified the totp object
  // with Object.values().join(), and normalizeTotp emits `secret` first, so the
  // row opened with the base32 seed. It is rendered nowhere else in the product
  // -- not the editor, not the list -- and unlike a password it does not rotate
  // when the password does.
  const mine = entry({ totp: totp() })
  const theirs = entry({ totp: parseTotpInput('otpauth://totp/Example:alice@example.com?secret=MZXW6YTBOI======&issuer=Example') })

  for (const reveal of [false, true]) {
    const rows = diffEntries(mine, theirs, { reveal })
    const printed = JSON.stringify(rows)
    assert.ok(!printed.includes(SEED), `the seed must not appear (reveal=${reveal})`)
    assert.ok(!printed.includes('MZXW6YTBOI'), `nor the other one (reveal=${reveal})`)
  }
})

test('a changed seed still produces a row, even though it cannot be shown', async () => {
  // The trap in fixing the above. Comparing the RENDERED text would make two
  // different seeds both read "Code for Example (alice@…)", compare equal, and
  // the row would vanish -- hiding the one change worth warning about. The
  // comparison runs on the raw values; only the rendering is redacted.
  const mine = entry({ totp: totp() })
  const theirs = entry({ totp: parseTotpInput('otpauth://totp/Example:alice@example.com?secret=MZXW6YTBOI======&issuer=Example') })

  const rows = diffEntries(mine, theirs)
  const row = rows.find((r) => r.key === 'totp')
  assert.ok(row, 'a differing seed must still be reported as differing')
  assert.equal(row.mine, row.theirs, 'and the two descriptions are identical, which is the point')
  assert.match(row.mine, /Code for Example \(alice@example\.com\)/)
  assert.equal(row.masked, true)
  assert.equal(diffHasTotp(rows), true)
})

test('an identical seed produces no row', async () => {
  const t = totp()
  assert.deepEqual(diffEntries(entry({ totp: t }), entry({ totp: t })), [])
})

test('the password is masked until asked for', async () => {
  const rows = () => diffEntries(entry({ pw: 'mine-secret' }), entry({ pw: 'theirs-secret' }))
  const hidden = rows()
  assert.equal(hidden[0].key, 'pw')
  assert.equal(hidden[0].mine, MASK)
  assert.equal(hidden[0].theirs, MASK)
  assert.equal(hidden[0].masked, true)
  assert.ok(!JSON.stringify(hidden).includes('secret'), 'nothing of either value leaks')

  const shown = diffEntries(entry({ pw: 'mine-secret' }), entry({ pw: 'theirs-secret' }), { reveal: true })
  assert.equal(shown[0].mine, 'mine-secret', 'and revealing is what shows it')
  assert.equal(shown[0].masked, false)
})

test('a custom field marked secret is masked, and the flag is never printed', async () => {
  // Two bugs in one row: the value was printed despite `secret: true`, and the
  // literal `true` was printed after it, because the renderer joined every
  // value of the object including the flag.
  const mine = entry({ fields: [{ name: 'PIN', value: '8149', secret: true }] })
  const theirs = entry({ fields: [{ name: 'PIN', value: '2277', secret: true }] })

  const row = diffEntries(mine, theirs).find((r) => r.key === 'fields')
  assert.equal(row.mine, `PIN — ${MASK}`)
  assert.equal(row.theirs, `PIN — ${MASK}`)
  assert.ok(!row.mine.includes('true'), 'the secret flag is not content')
  assert.ok(!row.mine.includes('8149'))

  const shown = diffEntries(mine, theirs, { reveal: true }).find((r) => r.key === 'fields')
  assert.equal(shown.mine, 'PIN — 8149')
})

test('a custom field NOT marked secret is shown, because it is not one', async () => {
  const mine = entry({ fields: [{ name: 'Customer number', value: 'A-1', secret: false }] })
  const theirs = entry({ fields: [{ name: 'Customer number', value: 'A-2', secret: false }] })
  const row = diffEntries(mine, theirs).find((r) => r.key === 'fields')
  assert.equal(row.mine, 'Customer number — A-1')
})

test('security answers are masked, and their questions are not', async () => {
  // The question is a label; the answer is the credential, and people are told
  // to invent answers precisely so they cannot be guessed.
  const mine = entry({ questions: [{ q: 'First pet', a: 'Rumpelstiltskin' }] })
  const theirs = entry({ questions: [{ q: 'First pet', a: 'Bucephalus' }] })
  const row = diffEntries(mine, theirs).find((r) => r.key === 'questions')
  assert.equal(row.mine, `First pet — ${MASK}`)
  assert.ok(!JSON.stringify(row).includes('Rumpel'))
  assert.ok(!JSON.stringify(row).includes('Bucephalus'))
})

test('ordinary fields are shown plainly, since nothing masks them anywhere', async () => {
  const rows = diffEntries(entry({ label: 'Bank' }), entry({ label: 'Building society' }))
  assert.deepEqual(rows.map((r) => [r.key, r.mine, r.theirs]),
    [['label', 'Bank', 'Building society']])
  assert.equal(rows[0].masked, false)
  assert.equal(diffHasSecrets(rows), false, 'so no reveal control is offered')
})

test('only what differs is listed', async () => {
  const mine = entry({ label: 'Bank', username: 'me@example.com', note: 'same note' })
  const theirs = entry({ label: 'Bank', username: 'other@example.com', note: 'same note' })
  assert.deepEqual(diffEntries(mine, theirs).map((r) => r.key), ['username'])
})

test('absent and empty are the same thing, not a difference', async () => {
  // Otherwise every conflict would list half the entry as changed, and the
  // rows that matter would be lost in the noise.
  assert.deepEqual(diffEntries(entry({ note: '' }), entry({})), [])
  assert.deepEqual(diffEntries(entry({ tags: [] }), entry({})), [])
})

test('describeTotp says enough to identify the code and no more', async () => {
  const d = describeTotp(totp())
  assert.match(d, /Example/)
  assert.match(d, /alice@example\.com/)
  assert.match(d, /6 digits/)
  assert.ok(!d.includes(SEED))
  assert.equal(describeTotp(null), '')
})

test('shownValue leaks nothing for a secret key whatever it is handed', async () => {
  // A blunt guard on the function itself, so a future key added to the diff
  // cannot quietly route around the masking above.
  for (const [key, value] of [
    ['pw', 'plain-text-password'],
    ['questions', [{ q: 'Q', a: 'plain-text-password' }]],
    ['fields', [{ name: 'N', value: 'plain-text-password', secret: true }]],
  ]) {
    assert.ok(!shownValue(key, value).includes('plain-text-password'), `${key} must mask by default`)
  }
})
