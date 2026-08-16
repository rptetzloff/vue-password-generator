import test from 'node:test'
import assert from 'node:assert/strict'
import {
  exportBackup, exportPlainJson, exportCsv, parseTransfer, parseCsv,
  mapCsvHeaders, mergeEntries, mergeReplicas, transferFilename,
} from '../src/vault-transfer.js'
import { normalizeEntries } from '../src/vault-entry.js'

const ENTRIES = [
  {
    id: 'a', label: 'Email', group: 'Mail', username: 'me@example.com', pw: 'Tireless4Marimba',
    urls: [{ name: 'Main', url: 'https://mail.example.com' }, { url: 'https://example.com/login' }],
    questions: [{ q: 'First pet?', a: 'not-really-a-pet-name' }],
    bits: 58.2, at: '2026-08-13', note: 'the good one',
  },
  {
    id: 'b', label: 'Router', username: 'admin', pw: 'silent-sparrow-storm-84',
    urls: [], questions: [], bits: 44.1, at: '2026-08-13', note: '',
  },
]

test('a backup round-trips the sealed envelope untouched', () => {
  const envelope = { v: 1, kdf: { name: 'PBKDF2', iterations: 600000, salt: 'c2FsdA==' }, iv: 'aXY=', ct: 'Y3Q=' }
  const file = exportBackup(envelope)
  assert.ok(!file.includes('Marimba'), 'a backup carries ciphertext, nothing else')
  const parsed = parseTransfer(file)
  assert.equal(parsed.kind, 'backup')
  assert.deepEqual(parsed.envelope, envelope)
})

test('a bare envelope is still recognised as a backup', () => {
  // Someone who saved just the inner object should not be told their own
  // vault is not a WordLock file.
  const envelope = { v: 1, kdf: { salt: 'x' }, iv: 'aXY=', ct: 'Y3Q=' }
  assert.equal(parseTransfer(JSON.stringify(envelope)).kind, 'backup')
})

test('plain JSON round-trips every field, including the questions', () => {
  const parsed = parseTransfer(exportPlainJson(ENTRIES))
  assert.equal(parsed.kind, 'plain')
  const back = normalizeEntries(parsed.entries)
  assert.equal(back.length, 2)
  assert.equal(back[0].username, 'me@example.com')
  assert.deepEqual(back[0].urls, [
    { name: 'Main', url: 'https://mail.example.com' },
    { name: '', url: 'https://example.com/login' },
  ])
  assert.deepEqual(back[0].questions, [{ q: 'First pet?', a: 'not-really-a-pet-name' }])
})

test('a plain export says in the file that it is not encrypted', () => {
  // The file outlives the moment of exporting it, so the warning has to
  // travel with it rather than only appearing in the UI.
  const file = exportPlainJson(ENTRIES)
  assert.match(file, /NOT encrypted/)
  assert.ok(file.includes('Tireless4Marimba'), 'it is, after all, the plaintext export')
})

test('CSV carries the fields other managers read', () => {
  const csv = exportCsv(ENTRIES)
  const rows = parseCsv(csv)
  assert.deepEqual(rows[0], ['folder', 'name', 'url', 'username', 'password', 'note', 'tags'])
  assert.equal(rows[1][0], 'Mail')
  assert.equal(rows[1][1], 'Email')
  assert.equal(rows[1][2], 'https://mail.example.com', 'only the first URL fits a flat row')
  assert.equal(rows[1][3], 'me@example.com')
  assert.equal(rows[1][4], 'Tireless4Marimba')
  assert.match(rows[1][5], /First pet\?: not-really-a-pet-name/,
    'questions fold into the note rather than vanishing')
})

test('CSV survives commas, quotes and newlines in the data', () => {
  const awkward = [{
    label: 'Comma, Inc "quoted"', username: 'a"b', pw: 'has,comma',
    urls: [{ url: 'https://x.example' }], questions: [], note: 'line one\nline two',
  }]
  const rows = parseCsv(exportCsv(awkward))
  assert.equal(rows.length, 2)
  assert.equal(rows[1][1], 'Comma, Inc "quoted"')
  assert.equal(rows[1][3], 'a"b')
  assert.equal(rows[1][4], 'has,comma')
  assert.equal(rows[1][5], 'line one\nline two')
})

test('CSV export neutralises spreadsheet formulas', () => {
  // A password beginning with = would otherwise be executed by Excel or
  // Sheets on open, which is a real and well-known CSV hazard.
  const csv = exportCsv([{ label: '=cmd', pw: '=1+1', username: '+x', urls: [], questions: [], note: '@here' }])
  const rows = parseCsv(csv)
  for (const cell of rows[1]) {
    assert.ok(!/^[=+\-@]/.test(cell), `"${cell}" would be read as a formula`)
  }
})

test('a foreign CSV is mapped by its header names', () => {
  // Bitwarden-ish, LastPass-ish and 1Password-ish headers all differ; the
  // point is to read the common ones rather than demand our own.
  const foreign = [
    'name,login_uri,login_username,login_password,notes',
    'Bank,https://bank.example,jane,hunter2!,savings',
  ].join('\n')
  const parsed = parseTransfer(foreign)
  assert.equal(parsed.kind, 'csv')
  assert.equal(parsed.entries.length, 1)
  assert.deepEqual(normalizeEntries(parsed.entries)[0].urls,
    [{ name: '', url: 'https://bank.example' }],
    'a CSV has no column for a name, so the address arrives unnamed')
  assert.equal(parsed.entries[0].username, 'jane')
  assert.equal(parsed.entries[0].pw, 'hunter2!')

  const idx = mapCsvHeaders(['Title', 'URL', 'Username', 'Password'])
  assert.equal(idx.name, 0)
  assert.equal(idx.url, 1)
  assert.equal(idx.note, -1, 'a missing column is absent, not guessed at')
})

test('unreadable files fail with a reason, not a stack trace', () => {
  assert.throws(() => parseTransfer(''), /empty/)
  assert.throws(() => parseTransfer('{not json'), /not valid JSON/)
  assert.throws(() => parseTransfer('{"format":"something-else"}'), /not a WordLock export/)
  assert.throws(() => parseTransfer('name,url\nx,y'), /no password column/)
  assert.throws(() => parseTransfer('name,password\nx,'), /no rows .* had a password/)
})

test('importing merges and never deletes', () => {
  // The rule that matters: restoring an old backup must not remove work done
  // since. Existing entries win, new ones are added, duplicates are skipped.
  const existing = normalizeEntries(ENTRIES)
  const incoming = normalizeEntries([
    { id: 'a', label: 'Email', pw: 'Tireless4Marimba' },        // same id
    { label: 'Router', pw: 'silent-sparrow-storm-84' },          // same pw+label, no id
    { label: 'New Thing', pw: 'brand-new-password' },            // genuinely new
  ])
  const { merged, added, skipped } = mergeEntries(existing, incoming)
  assert.equal(added, 1)
  assert.equal(skipped, 2)
  assert.equal(merged.length, 3)
  assert.ok(merged.some((e) => e.label === 'New Thing'))
  assert.equal(merged.find((e) => e.id === 'a').note, 'the good one',
    'the existing entry must not be overwritten by the imported one')
})

test('the same password under two labels is two entries', () => {
  // People really do reuse a password across accounts; collapsing them on
  // the password alone would silently lose one.
  const existing = normalizeEntries([{ label: 'One', pw: 'shared' }])
  const { added } = mergeEntries(existing, normalizeEntries([{ label: 'Two', pw: 'shared' }]))
  assert.equal(added, 1)
})

test('importing the same file twice adds nothing the second time', () => {
  const existing = normalizeEntries(ENTRIES)
  const once = mergeEntries(existing, normalizeEntries(ENTRIES))
  assert.equal(once.added, 0)
  const twice = mergeEntries(once.merged, normalizeEntries(ENTRIES))
  assert.equal(twice.added, 0)
  assert.equal(twice.merged.length, 2)
})

test('filenames are dated, and the clear ones say so', () => {
  assert.equal(transferFilename('backup', '2026-08-13'), 'wordlock-vault-2026-08-13.json')
  assert.match(transferFilename('plain', '2026-08-13'), /PLAINTEXT/)
  assert.match(transferFilename('csv', '2026-08-13'), /PLAINTEXT.*\.csv$/)
})

test('groups survive every format that can carry them', () => {
  const withGroups = normalizeEntries(ENTRIES)
  assert.equal(withGroups[0].group, 'Mail')

  const plain = normalizeEntries(parseTransfer(exportPlainJson(withGroups)).entries)
  assert.equal(plain[0].group, 'Mail', 'plain JSON must round-trip the group')

  const csv = normalizeEntries(parseTransfer(exportCsv(withGroups)).entries)
  assert.equal(csv[0].group, 'Mail', 'CSV has a folder column for exactly this')
})

test("a foreign CSV's folder column is recognised under its various names", () => {
  // Every manager names this differently and all of them have one, so an
  // import that dropped it would silently flatten someone's filing.
  for (const header of ['folder', 'group', 'category', 'collection']) {
    const foreign = `name,${header},password\nBank,Finance,hunter2!`
    const [entry] = normalizeEntries(parseTransfer(foreign).entries)
    assert.equal(entry.group, 'Finance', `${header} should map to the group`)
  }
})

test('a CSV with no folder column simply leaves entries ungrouped', () => {
  const [entry] = normalizeEntries(parseTransfer('name,password\nBank,hunter2!\n').entries)
  assert.equal(entry.group, '')
})

test('the merge key cannot confuse two different pairs', () => {
  // ("a b", "c") and ("a", "b c") join to the same string under any plain
  // separator. Colliding here does not just mis-sort: the second entry is
  // treated as already present and silently dropped from the import.
  const existing = normalizeEntries([{ pw: 'a b', label: 'c' }])
  const { added, merged } = mergeEntries(existing, normalizeEntries([{ pw: 'a', label: 'b c' }]))
  assert.equal(added, 1, 'these are two different entries and both must survive')
  assert.equal(merged.length, 2)
})

test('custom fields round-trip in JSON and fold into the CSV note', () => {
  const withFields = normalizeEntries([{
    label: 'Bank', pw: 'p', note: 'the joint one',
    fields: [
      { name: 'PIN', value: '4417', secret: true },
      { name: 'Customer number', value: 'CN-99120' },
    ],
  }])

  const plain = normalizeEntries(parseTransfer(exportPlainJson(withFields)).entries)[0]
  assert.equal(plain.fields.length, 2)
  assert.equal(plain.fields[0].secret, true, 'the secret flag must survive, or a PIN comes back public')

  // CSV has no column for them, so they go where a person will still find them.
  const note = parseCsv(exportCsv(withFields))[1][5]
  assert.match(note, /the joint one/)
  assert.match(note, /PIN: 4417/)
  assert.match(note, /Customer number: CN-99120/)
})

test('a named address keeps its name where the format has room', () => {
  const entry = normalizeEntries([{
    label: 'App', pw: 'p',
    urls: [{ name: 'Store', url: 'https://store.example' }, { name: 'Dev', url: 'https://dev.example' }],
  }])[0]

  const plain = normalizeEntries(parseTransfer(exportPlainJson([entry])).entries)[0]
  assert.deepEqual(plain.urls, entry.urls, 'plain JSON has room for both')

  // A CSV row has one url column, so the first address survives without its
  // name. Lossy, and labelled lossy.
  assert.equal(parseCsv(exportCsv([entry]))[1][2], 'https://store.example')
})

test('tags survive JSON and CSV, in and out', () => {
  // Both directions matter: CSV is how tags reach us from 1Password, which is
  // the only common export format that carries them at all.
  const entry = normalizeEntries([{ label: 'Card', pw: 'p', tags: ['Finance', 'work'] }])[0]
  assert.deepEqual(entry.tags, ['finance', 'work'])

  const plain = normalizeEntries(parseTransfer(exportPlainJson([entry])).entries)[0]
  assert.deepEqual(plain.tags, ['finance', 'work'])

  const csv = normalizeEntries(parseTransfer(exportCsv([entry])).entries)[0]
  assert.deepEqual(csv.tags, ['finance', 'work'], 'the CSV has a column of its own for these')

  const foreign = normalizeEntries(parseTransfer('name,password,tags\nBank,hunter2!,"finance shared"').entries)[0]
  assert.deepEqual(foreign.tags, ['finance', 'shared'])
})

test('addresses saved before names existed still load', () => {
  // Every entry written before this change is a plain array of strings, and
  // so is every URL any other manager exports.
  const entry = normalizeEntries([{ label: 'Old', pw: 'p', urls: ['https://a.example', 'https://b.example'] }])[0]
  assert.deepEqual(entry.urls, [
    { name: '', url: 'https://a.example' },
    { name: '', url: 'https://b.example' },
  ])
})

// -- Reconciling two replicas (ROADMAP: sync-shaped) --------------------------
//
// A different job from mergeEntries above, and the tests are here together on
// purpose: the two must not drift into each other. Import must never delete;
// replica merge must delete, or every second device resurrects what the first
// one removed.

const at = (iso) => iso
const live = (id, pw, updatedAt, extra = {}) => ({ id, pw, label: id, updatedAt, ...extra })
const dead = (id, deletedAt) => ({ id, deletedAt })

test('a newer edit on the other replica wins', () => {
  const local = [live('a', 'old', at('2026-08-14T10:00:00.000Z'))]
  const remote = [live('a', 'new', at('2026-08-14T11:00:00.000Z'))]
  const { merged, updated } = mergeReplicas(local, remote)
  assert.equal(merged.length, 1)
  assert.equal(merged[0].pw, 'new')
  assert.equal(updated, 1)
})

test('an older edit on the other replica loses', () => {
  const local = [live('a', 'mine', at('2026-08-14T11:00:00.000Z'))]
  const remote = [live('a', 'theirs', at('2026-08-14T10:00:00.000Z'))]
  const { merged, unchanged } = mergeReplicas(local, remote)
  assert.equal(merged[0].pw, 'mine')
  assert.equal(unchanged, 1)
})

test('a deletion on the other replica is applied, not ignored', () => {
  // The bug this whole exercise exists to prevent. Under mergeEntries the
  // local copy would simply survive and the deletion would be lost.
  const local = [live('a', 'secret', at('2026-08-14T10:00:00.000Z'))]
  const remote = [dead('a', at('2026-08-14T11:00:00.000Z'))]
  const { merged, deleted } = mergeReplicas(local, remote)
  assert.equal(deleted, 1)
  assert.equal(merged.length, 1, 'the tombstone stays, or the entry returns next sync')
  assert.equal(merged[0].deletedAt, '2026-08-14T11:00:00.000Z')
  assert.equal(merged[0].pw, undefined, 'a tombstone carries no secret')
})

test('an entry edited after it was deleted elsewhere comes back', () => {
  // Undelete has to be possible, or a stale tombstone kills an entry someone
  // has since re-created or edited on another device.
  const local = [dead('a', at('2026-08-14T10:00:00.000Z'))]
  const remote = [live('a', 'revived', at('2026-08-14T12:00:00.000Z'))]
  const { merged } = mergeReplicas(local, remote)
  assert.equal(merged[0].pw, 'revived')
})

test('a deletion that arrives before the entry it deletes is kept', () => {
  // Out-of-order arrival is normal with file-based sync. Dropping the
  // tombstone because there is nothing to delete yet means the entry lands
  // on the next pass and never goes away.
  const { merged, added } = mergeReplicas([], [dead('a', at('2026-08-14T10:00:00.000Z'))])
  assert.equal(merged.length, 1)
  assert.equal(added, 0, 'a tombstone is not an addition')
  const second = mergeReplicas(merged, [live('a', 'late', at('2026-08-14T09:00:00.000Z'))])
  assert.equal(second.merged[0].deletedAt, '2026-08-14T10:00:00.000Z',
    'the older entry must not undo the newer deletion')
})

test('entries only on one side survive from both directions', () => {
  const local = [live('a', 'x', at('2026-08-14T10:00:00.000Z'))]
  const remote = [live('b', 'y', at('2026-08-14T10:00:00.000Z'))]
  const { merged, added } = mergeReplicas(local, remote)
  assert.deepEqual(merged.map((e) => e.id).sort(), ['a', 'b'])
  assert.equal(added, 1)
})

test('merging is idempotent, and converges whichever way round it runs', () => {
  // Run it twice and nothing moves; run it both directions and both replicas
  // reach the same state. Without that, two devices ping-pong forever.
  const a = [live('1', 'a1', at('2026-08-14T10:00:00.000Z')), dead('2', at('2026-08-14T10:30:00.000Z'))]
  const b = [live('1', 'b1', at('2026-08-14T11:00:00.000Z')), live('3', 'b3', at('2026-08-14T09:00:00.000Z'))]

  const once = mergeReplicas(a, b).merged
  const twice = mergeReplicas(once, b).merged
  assert.deepEqual(twice, once, 'merging the same remote again must change nothing')

  const other = mergeReplicas(b, a).merged
  const key = (l) => l.map((e) => `${e.id}:${e.pw || 'X'}:${when2(e)}`).sort()
  assert.deepEqual(key(once), key(other), 'both replicas must converge on the same state')
})

const when2 = (e) => e.deletedAt || e.updatedAt || ''

test('an entry with no timestamp loses to one that has any', () => {
  // Every entry written before this feature is in that position. A replica
  // that knows when it changed should beat one that does not, rather than an
  // unknown clobbering a known.
  const legacy = [{ id: 'a', pw: 'legacy', label: 'a' }]
  const stamped = [live('a', 'stamped', at('2026-08-14T10:00:00.000Z'))]
  assert.equal(mergeReplicas(legacy, stamped).merged[0].pw, 'stamped')
  assert.equal(mergeReplicas(stamped, legacy).merged[0].pw, 'stamped',
    'and the same regardless of which side it is on')
})

test('importing a foreign file still never deletes anything', () => {
  // The guard that keeps the two merges apart. If mergeEntries ever grows
  // tombstone handling, a malicious or malformed CSV becomes a delete
  // instruction.
  const existing = normalizeEntries([{ id: 'a', pw: 'keep', label: 'Bank' }])
  const hostile = [{ id: 'a', deletedAt: '2099-01-01T00:00:00.000Z' }]
  const { merged } = mergeEntries(existing, hostile)
  assert.equal(merged.length, 1)
  assert.equal(merged[0].pw, 'keep', 'an import must not be able to remove an entry')
})
