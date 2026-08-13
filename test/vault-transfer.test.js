import test from 'node:test'
import assert from 'node:assert/strict'
import {
  exportBackup, exportPlainJson, exportCsv, parseTransfer, parseCsv,
  mapCsvHeaders, mergeEntries, transferFilename,
} from '../src/vault-transfer.js'
import { normalizeEntries } from '../src/vault-store.js'

const ENTRIES = [
  {
    id: 'a', label: 'Email', group: 'Mail', username: 'me@example.com', pw: 'Tireless4Marimba',
    urls: ['https://mail.example.com', 'https://example.com/login'],
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
  assert.deepEqual(back[0].urls, ['https://mail.example.com', 'https://example.com/login'])
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
  assert.deepEqual(rows[0], ['folder', 'name', 'url', 'username', 'password', 'note'])
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
    urls: ['https://x.example'], questions: [], note: 'line one\nline two',
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
  assert.deepEqual(normalizeEntries(parsed.entries)[0].urls, ['https://bank.example'])
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
