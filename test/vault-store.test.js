import test from 'node:test'
import assert from 'node:assert/strict'
import {
  createVaultStore, normalizeEntry, normalizeEntries, DEFAULT_AUTOLOCK_MS,
  groupsOf, sortEntries, groupEntries, SORTS, UNGROUPED, reuseIndex, reuseCount,
} from '../src/vault-store.js'
import { KDF_ITERATIONS } from '../src/vault-crypto.js'

// Storage and the clock are injected, so the state machine, the auto-lock and
// the entry rules are all exercised here without a browser. Only the
// IndexedDB adapter itself is left to the live page.

const PASS = 'correct horse battery staple'

const fakeStorage = () => {
  const box = { value: null, saves: 0, cleared: 0 }
  return {
    box,
    load: async () => box.value,
    save: async (envelope) => { box.value = envelope; box.saves++ },
    clear: async () => { box.value = null; box.cleared++ },
  }
}

const fakeClock = (start = 1_000_000) => {
  const c = { t: start }
  c.now = () => c.t
  c.advance = (ms) => { c.t += ms }
  return c
}

const freshStore = async (opts = {}) => {
  const storage = fakeStorage()
  const clock = fakeClock()
  const store = createVaultStore({ storage, now: clock.now, ...opts })
  await store.init()
  return { store, storage, clock }
}

test('a device with no vault reports absent, not empty', async () => {
  const { store } = await freshStore()
  assert.equal(store.state(), 'absent')
  // Reading a vault that does not exist is a programming error, not an
  // empty list -- an empty list would render as "your vault is empty".
  assert.throws(() => store.list(), /locked/)
})

test('create, lock, unlock: the round trip', async () => {
  const { store, storage } = await freshStore()
  await store.create(PASS)
  assert.equal(store.state(), 'unlocked')
  await store.add({ label: 'email', pw: 'hunter2!', bits: 30 })

  store.lock()
  assert.equal(store.state(), 'locked')
  assert.throws(() => store.list(), /locked/)

  await store.unlock(PASS)
  assert.equal(store.state(), 'unlocked')
  assert.equal(store.list()[0].label, 'email')
  assert.ok(storage.box.value, 'the envelope should be on disk')
})

test('locking forgets, rather than hiding', async () => {
  // The failure this guards against is a "locked" vault whose entries are
  // still sitting in a closure. Nothing readable may survive the lock.
  const { store, storage } = await freshStore()
  await store.create(PASS)
  await store.add({ label: 'router', pw: 'silent-sparrow-storm', bits: 44 })
  store.lock()

  const onDisk = JSON.stringify(storage.box.value)
  assert.ok(!onDisk.includes('sparrow'), 'the stored envelope must be ciphertext')
  assert.throws(() => store.list(), /locked/)
  await assert.rejects(() => store.add({ pw: 'x' }), /locked/)
  await assert.rejects(() => store.update('any', { pw: 'x' }), /locked/)
  await assert.rejects(() => store.remove('any'), /locked/)
})

test('a wrong passphrase leaves the vault locked, not half-open', async () => {
  const { store } = await freshStore()
  await store.create(PASS)
  await store.add({ label: 'email', pw: 'hunter2!' })
  store.lock()

  await assert.rejects(() => store.unlock('wrong'))
  assert.equal(store.state(), 'locked', 'a failed unlock must not leave state unlocked')
  assert.throws(() => store.list(), /locked/)

  await store.unlock(PASS)
  assert.equal(store.list().length, 1)
})

test('entries survive a reload from storage', async () => {
  const storage = fakeStorage()
  const first = createVaultStore({ storage, now: fakeClock().now })
  await first.init()
  await first.create(PASS)
  await first.add({ label: 'email', pw: 'hunter2!', bits: 30 })
  await first.add({ label: 'bank', pw: 'Tireless4Marimba', bits: 58 })

  // A new store over the same storage is what a page reload looks like.
  const second = createVaultStore({ storage, now: fakeClock().now })
  assert.equal(await second.init(), 'locked')
  await second.unlock(PASS)
  const labels = second.list().map((e) => e.label)
  assert.deepEqual(labels, ['bank', 'email'], 'newest first, and both present')
})

test('add, update and remove persist each time', async () => {
  const { store, storage } = await freshStore()
  await store.create(PASS)
  const saved = storage.box.saves

  const entry = await store.add({ label: 'email', pw: 'hunter2!', bits: 30 })
  assert.equal(storage.box.saves, saved + 1)

  await store.update(entry.id, { label: 'work email', note: 'the good one' })
  assert.equal(storage.box.saves, saved + 2)
  assert.equal(store.list()[0].label, 'work email')
  assert.equal(store.list()[0].note, 'the good one')
  assert.equal(store.list()[0].pw, 'hunter2!', 'an unrelated patch must not disturb the password')

  assert.equal(await store.remove(entry.id), true)
  assert.equal(store.list().length, 0)
  assert.equal(await store.remove(entry.id), false, 'removing twice is not an error')
})

test('auto-lock fires on idle and is deferred by activity', async () => {
  const { store, clock } = await freshStore({ autoLockMs: 60_000 })
  await store.create(PASS)

  clock.advance(59_000)
  assert.equal(store.lockIfIdle(), false)
  assert.equal(store.state(), 'unlocked')

  // Any use of the vault counts as activity and restarts the clock.
  store.touch()
  clock.advance(59_000)
  assert.equal(store.lockIfIdle(), false)

  clock.advance(1_500)
  assert.equal(store.shouldAutoLock(), true)
  assert.equal(store.lockIfIdle(), true)
  assert.equal(store.state(), 'locked')

  // A locked vault has nothing left to auto-lock.
  assert.equal(store.lockIfIdle(), false)
})

test('reading the vault counts as activity', async () => {
  const { store, clock } = await freshStore({ autoLockMs: 60_000 })
  await store.create(PASS)
  clock.advance(59_000)
  store.list()
  clock.advance(59_000)
  assert.equal(store.shouldAutoLock(), false, 'listing entries should defer the lock')
})

test('auto-lock can be switched off, and defaults to the quarter hour', async () => {
  assert.equal(DEFAULT_AUTOLOCK_MS, 15 * 60 * 1000)
  const { store, clock } = await freshStore({ autoLockMs: 0 })
  await store.create(PASS)
  clock.advance(365 * 24 * 60 * 60 * 1000)
  assert.equal(store.shouldAutoLock(), false)
})

test('re-keying keeps the entries, re-salts, and retires the old passphrase', async () => {
  const { store } = await freshStore()
  await store.create(PASS)
  await store.add({ label: 'email', pw: 'hunter2!' })
  const oldSalt = store.envelope().kdf.salt

  await store.rekey(PASS, 'a different passphrase entirely')
  assert.equal(store.list().length, 1)
  assert.notEqual(store.envelope().kdf.salt, oldSalt, 'a re-key must re-salt')
  assert.equal(store.envelope().kdf.iterations, KDF_ITERATIONS,
    're-keying is also the upgrade path for the cost parameter')

  store.lock()
  await assert.rejects(() => store.unlock(PASS), 'the old passphrase must stop working')
  await store.unlock('a different passphrase entirely')
  assert.equal(store.list()[0].label, 'email')
})

test('re-keying derives twice, which is the floor', async () => {
  // Two derivations: one to open with the old passphrase, one to seal with
  // the new. A third would be a visible stall on a phone for no reason.
  const { store } = await freshStore()
  await store.create(PASS)
  const started = process.hrtime.bigint()
  await store.rekey(PASS, 'another passphrase')
  const ms = Number(process.hrtime.bigint() - started) / 1e6
  const oneDerivation = await (async () => {
    const t = process.hrtime.bigint()
    await store.unlock('another passphrase')
    return Number(process.hrtime.bigint() - t) / 1e6
  })()
  assert.ok(ms < oneDerivation * 2.75,
    `re-key took ${ms.toFixed(0)}ms against ${oneDerivation.toFixed(0)}ms per derivation; that looks like three`)
})

test('destroying the vault requires the passphrase', async () => {
  // Someone who walks up to an unlocked browser should not be able to erase
  // the vault with one click; forgetting a passphrase is the common case.
  const { store, storage } = await freshStore()
  await store.create(PASS)
  await store.add({ label: 'email', pw: 'hunter2!' })

  await assert.rejects(() => store.destroy('wrong'))
  assert.equal(storage.box.cleared, 0)
  assert.equal(store.state(), 'unlocked')

  assert.equal(await store.destroy(PASS), true)
  assert.equal(store.state(), 'absent')
  assert.equal(storage.box.value, null)
})

test('a second vault cannot be created over an existing one', async () => {
  const { store } = await freshStore()
  await store.create(PASS)
  await assert.rejects(() => store.create('another'), /already exists/)
})

test('storage failure surfaces rather than presenting as no vault', async () => {
  // Reporting "absent" after a read error would invite creating a fresh vault
  // on top of one that is merely unreadable right now.
  const store = createVaultStore({
    storage: { load: async () => { throw new Error('disk gone') }, save: async () => {}, clear: async () => {} },
  })
  await assert.rejects(() => store.init(), /could not be read/)
})

test('export exposes the sealed envelope and never the contents', async () => {
  const { store } = await freshStore()
  await store.create(PASS)
  await store.add({ label: 'email', pw: 'Tireless4Marimba' })
  const serialized = JSON.stringify(store.envelope())
  assert.ok(!serialized.includes('Marimba'))
  assert.ok(!serialized.includes('email'))
})

test('entry normalization keeps the password and forgives the rest', async () => {
  // An entry without a password is not an entry; everything else is cosmetic
  // and must never be a reason to drop someone's password.
  assert.equal(normalizeEntry(null), null)
  assert.equal(normalizeEntry({ label: 'no password' }), null)
  assert.equal(normalizeEntry({ pw: '' }), null)

  const e = normalizeEntry({ pw: 'x9!kQ' })
  assert.equal(e.pw, 'x9!kQ')
  assert.equal(e.label, '')
  assert.equal(e.bits, null)
  assert.ok(e.id, 'an id is generated when absent')

  const junk = normalizeEntry({ pw: 'p', label: 42, bits: 'lots', at: 7, note: {} })
  assert.equal(junk.label, '')
  assert.equal(junk.bits, null)
  assert.equal(junk.at, null)
  assert.equal(junk.note, '')

  assert.equal(normalizeEntry({ pw: 'p', label: '  spaced  ' }).label, 'spaced')
  assert.equal(normalizeEntry({ pw: 'p', label: 'x'.repeat(500) }).label.length, 200)
  assert.equal(normalizeEntries([{ pw: 'a' }, null, { nope: 1 }, { pw: 'b' }]).length, 2)
  assert.deepEqual(normalizeEntries('not a list'), [])
})

test('ids are stable across edits and unique across entries', async () => {
  const { store } = await freshStore()
  await store.create(PASS)
  const a = await store.add({ label: 'one', pw: 'same-password' })
  const b = await store.add({ label: 'two', pw: 'same-password' })
  assert.notEqual(a.id, b.id, 'identical passwords must still be distinct entries')

  // Changing the password must not change which entry it is.
  const updated = await store.update(a.id, { pw: 'rotated!' })
  assert.equal(updated.id, a.id)
  assert.equal(store.list().find((e) => e.id === a.id).pw, 'rotated!')
  assert.equal(store.list().find((e) => e.id === b.id).pw, 'same-password')
})

test('the caller cannot mutate the vault by holding a listed entry', async () => {
  const { store } = await freshStore()
  await store.create(PASS)
  await store.add({ label: 'email', pw: 'hunter2!' })
  const copy = store.list()[0]
  copy.pw = 'tampered'
  copy.label = 'tampered'
  assert.equal(store.list()[0].pw, 'hunter2!')
  assert.equal(store.list()[0].label, 'email')
})

test('onChange reports every state transition', async () => {
  const seen = []
  const { store } = await freshStore({ onChange: (s) => seen.push(s) })
  await store.create(PASS)
  store.lock()
  await store.unlock(PASS)
  assert.deepEqual(seen.slice(-3), ['unlocked', 'locked', 'unlocked'])
})

// --- staying unlocked between pages -----------------------------------------
// A page navigation destroys the in-memory key, so without this the generator
// and the vault each demand the passphrase. The session holder is injected
// here, exactly as storage and the clock are, so the whole lifecycle is
// exercised without IndexedDB.

const fakeSession = () => {
  const box = { held: null, ttl: 0, forgets: 0 }
  return {
    box,
    rememberSession: async (key, kdf, ttl) => {
      if (!ttl) { box.held = null; return false }
      box.held = { key, kdf }
      box.ttl = ttl
      return true
    },
    recallSession: async () => box.held,
    touchSession: async (ttl) => { if (box.held) box.ttl = ttl },
    forgetSession: async () => { box.held = null; box.forgets++ },
  }
}

test('an unlocked vault survives a page load when a window is set', async () => {
  const storage = fakeStorage()
  const session = fakeSession()
  const opts = { storage, session, staySignedInMs: 60_000, now: fakeClock().now }

  const first = createVaultStore(opts)
  await first.init()
  await first.create(PASS)
  await first.add({ label: 'email', pw: 'hunter2!' })

  // A second store over the same storage and session is what navigating to
  // another page looks like.
  const second = createVaultStore(opts)
  assert.equal(await second.init(), 'unlocked', 'the vault should still be open')
  assert.equal(second.list()[0].label, 'email')
})

test('with the window off, nothing is held and every page asks again', async () => {
  const storage = fakeStorage()
  const session = fakeSession()
  const opts = { storage, session, staySignedInMs: 0, now: fakeClock().now }

  const first = createVaultStore(opts)
  await first.init()
  await first.create(PASS)
  assert.equal(session.box.held, null, 'nothing may be held when the window is off')

  const second = createVaultStore(opts)
  assert.equal(await second.init(), 'locked')
})

test('locking clears the held session, so it locks everywhere', async () => {
  // The bug this pins: lock() cleared local state but left the key with the
  // session holder, so the next page walked straight back in and the lock
  // button was a lie.
  const storage = fakeStorage()
  const session = fakeSession()
  const opts = { storage, session, staySignedInMs: 60_000, now: fakeClock().now }

  const first = createVaultStore(opts)
  await first.init()
  await first.create(PASS)
  first.lock()
  assert.equal(session.box.held, null)

  const second = createVaultStore(opts)
  assert.equal(await second.init(), 'locked')
})

test('idle auto-lock also clears the held session', async () => {
  const storage = fakeStorage()
  const session = fakeSession()
  const clock = fakeClock()
  const opts = { storage, session, staySignedInMs: 60_000, autoLockMs: 60_000, now: clock.now }

  const store = createVaultStore(opts)
  await store.init()
  await store.create(PASS)
  clock.advance(61_000)
  assert.equal(store.lockIfIdle(), true)
  assert.equal(session.box.held, null, 'an idle lock must not leave the key behind')
})

test('a session the holder rejects just means asking again', async () => {
  // A stale or mismatched key must degrade to "locked", never to an error
  // page or a half-open vault.
  const storage = fakeStorage()
  const good = fakeSession()
  const opts = { storage, session: good, staySignedInMs: 60_000, now: fakeClock().now }
  const first = createVaultStore(opts)
  await first.init()
  await first.create(PASS)

  const wrongKey = await crypto.subtle.generateKey(
    { name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt'],
  )
  const liar = { ...good, recallSession: async () => ({ key: wrongKey, kdf: good.box.held.kdf }) }
  const second = createVaultStore({ ...opts, session: liar })
  assert.equal(await second.init(), 'locked')
})

// --- groups and sorting ------------------------------------------------------

const entry = (over) => normalizeEntry({ pw: 'x', ...over })

test('a group is optional free text, trimmed and capped', () => {
  assert.equal(entry({ group: '  Work  ' }).group, 'Work')
  assert.equal(entry({}).group, '')
  assert.equal(entry({ group: 'g'.repeat(200) }).group.length, 60)
  assert.equal(entry({ group: 42 }).group, '')
})

test('groupsOf lists each group once, case-insensitively sorted', () => {
  const groups = groupsOf(normalizeEntries([
    { pw: '1', group: 'work' }, { pw: '2', group: 'Banking' },
    { pw: '3', group: 'work' }, { pw: '4', group: '' }, { pw: '5' },
  ]))
  assert.deepEqual(groups, ['Banking', 'work'])
})

test('every offered sort is implemented', () => {
  const list = normalizeEntries([{ pw: 'a', label: 'A' }, { pw: 'b', label: 'B' }])
  for (const { id } of SORTS) {
    const sorted = sortEntries(list, id)
    assert.equal(sorted.length, 2, `${id} lost an entry`)
  }
})

test('sorting does not mutate the list it was given', () => {
  const list = normalizeEntries([
    { pw: 'a', label: 'Zebra' }, { pw: 'b', label: 'Alpha' },
  ])
  const before = list.map((e) => e.label)
  sortEntries(list, 'label')
  assert.deepEqual(list.map((e) => e.label), before)
})

test('newest first, oldest first, and by name', () => {
  const list = normalizeEntries([
    { pw: 'a', label: 'Middle', at: '2026-02-01' },
    { pw: 'b', label: 'Oldest', at: '2026-01-01' },
    { pw: 'c', label: 'Newest', at: '2026-03-01' },
  ])
  assert.deepEqual(sortEntries(list, 'recent').map((e) => e.label), ['Newest', 'Middle', 'Oldest'])
  assert.deepEqual(sortEntries(list, 'oldest').map((e) => e.label), ['Oldest', 'Middle', 'Newest'])
  assert.deepEqual(sortEntries(list, 'label').map((e) => e.label), ['Middle', 'Newest', 'Oldest'])
})

test('weakest first, with unknown strength last rather than first', () => {
  // An entry with no recorded entropy is not evidence of a weak password, and
  // sorting the unknowns to the top would bury the ones worth changing.
  const list = normalizeEntries([
    { pw: 'a', label: 'Strong', bits: 90 },
    { pw: 'b', label: 'Unknown' },
    { pw: 'c', label: 'Weak', bits: 20 },
    { pw: 'd', label: 'Fair', bits: 55 },
  ])
  assert.deepEqual(sortEntries(list, 'strength').map((e) => e.label),
    ['Weak', 'Fair', 'Strong', 'Unknown'])
})

test('an undated entry sorts as the oldest, which is what it is', () => {
  const list = normalizeEntries([
    { pw: 'a', label: 'Dated', at: '2026-01-01' },
    { pw: 'b', label: 'Undated' },
  ])
  assert.equal(sortEntries(list, 'recent')[0].label, 'Dated')
  assert.equal(sortEntries(list, 'oldest')[0].label, 'Undated')
})

test('grouping buckets by group and puts Ungrouped last', () => {
  const grouped = groupEntries(normalizeEntries([
    { pw: 'a', label: 'Loose' },
    { pw: 'b', label: 'Pay', group: 'Banking' },
    { pw: 'c', label: 'Mail', group: 'work' },
    { pw: 'd', label: 'Chat', group: 'work' },
  ]), 'label')
  assert.deepEqual(grouped.map((g) => g.name), ['Banking', 'work', UNGROUPED])
  assert.deepEqual(grouped[1].entries.map((e) => e.label), ['Chat', 'Mail'])
  assert.deepEqual(grouped[2].entries.map((e) => e.label), ['Loose'])
})

test('grouping keeps every entry exactly once', () => {
  const list = normalizeEntries(
    Array.from({ length: 25 }, (_, i) => ({ pw: `p${i}`, label: `E${i}`, group: i % 4 ? `g${i % 4}` : '' })))
  for (const { id } of SORTS) {
    const flat = groupEntries(list, id).flatMap((g) => g.entries)
    assert.equal(flat.length, list.length, `${id} changed the count`)
    assert.equal(new Set(flat.map((e) => e.id)).size, list.length, `${id} duplicated an entry`)
  }
})

test('a vault with no groups at all is one Ungrouped bucket', () => {
  const grouped = groupEntries(normalizeEntries([{ pw: 'a' }, { pw: 'b' }]), 'recent')
  assert.equal(grouped.length, 1)
  assert.equal(grouped[0].name, UNGROUPED)
})

// --- password reuse ----------------------------------------------------------

test('reuse is found across entries, whatever else differs', () => {
  const list = normalizeEntries([
    { pw: 'shared-one', label: 'Bank', group: 'Finance' },
    { pw: 'unique', label: 'Email' },
    { pw: 'shared-one', label: 'Broker', group: 'Finance' },
    { pw: 'shared-one', label: 'Card' },
    { pw: 'shared-two', label: 'Forum' },
    { pw: 'shared-two', label: 'Wiki' },
  ])
  const index = reuseIndex(list)

  assert.equal(index.size, 5, 'five of the six entries share with someone')
  assert.equal(reuseCount(list), 5)

  const bank = list.find((e) => e.label === 'Bank')
  assert.deepEqual(
    index.get(bank.id).map((e) => e.label).sort(),
    ['Broker', 'Card'],
    'an entry is told who it shares with, not merely that it does',
  )
  const email = list.find((e) => e.label === 'Email')
  assert.equal(index.get(email.id), undefined, 'a unique password is not flagged')
})

test('an entry is never listed as reusing its own password', () => {
  const list = normalizeEntries([{ pw: 'p', label: 'Only' }])
  assert.equal(reuseIndex(list).size, 0)
})

test('reuse is exact: a near-miss is not a match', () => {
  // Deliberately no fuzzy matching. "Password1" and "Password2" are two
  // passwords, and claiming otherwise would be a guess dressed as a finding.
  const list = normalizeEntries([
    { pw: 'Password1', label: 'A' }, { pw: 'Password2', label: 'B' },
    { pw: 'password1', label: 'C' }, { pw: 'Password1 ', label: 'D' },
  ])
  assert.equal(reuseIndex(list).size, 0)
})

test('an empty vault and a vault of one have nothing to report', () => {
  assert.equal(reuseCount([]), 0)
  assert.equal(reuseCount(normalizeEntries([{ pw: 'x' }])), 0)
})

test('every member of a reuse set knows about every other', () => {
  const list = normalizeEntries(
    Array.from({ length: 4 }, (_, i) => ({ pw: 'same', label: `E${i}` })))
  const index = reuseIndex(list)
  assert.equal(index.size, 4)
  for (const entry of list) {
    assert.equal(index.get(entry.id).length, 3, `${entry.label} should see the other three`)
    assert.ok(!index.get(entry.id).some((o) => o.id === entry.id))
  }
})

test('grouping and a flat sort disagree, which is why the toggle exists', () => {
  // Grouped, "weakest first" means weakest-within-each-group, so the weakest
  // password in the whole vault can sit halfway down the page under a heading.
  // That is right for finding a known entry and wrong for an audit, and no
  // single default serves both.
  const list = normalizeEntries([
    { pw: 'a', label: 'Bank', group: 'Finance', bits: 128 },
    { pw: 'b', label: 'Broker', group: 'Finance', bits: 56 },
    { pw: 'c', label: 'Email', bits: 26 },
    { pw: 'd', label: 'Loose end', bits: 56 },
  ])

  const grouped = groupEntries(list, 'strength').flatMap((g) => g.entries).map((e) => e.bits)
  const flat = sortEntries(list, 'strength').map((e) => e.bits)

  assert.deepEqual(flat, [26, 56, 56, 128], 'flat is a true weakest-first order')
  assert.deepEqual(grouped, [56, 128, 26, 56], 'grouped orders within each group')
  assert.notDeepEqual(grouped, flat)
  assert.notEqual(grouped[0], Math.min(...flat),
    'the weakest entry is NOT first when grouped — the toggle is what fixes that')
})

// --- custom fields -----------------------------------------------------------

test('custom fields are name/value pairs with a secret flag', () => {
  const e = normalizeEntry({
    pw: 'x',
    fields: [
      { name: 'PIN', value: '4417', secret: true },
      { name: 'Customer number', value: 'CN-99120' },
    ],
  })
  assert.equal(e.fields.length, 2)
  assert.deepEqual(e.fields[0], { name: 'PIN', value: '4417', secret: true })
  assert.equal(e.fields[1].secret, false, 'a field is public unless it says otherwise')
})

test('a field with no value is dropped; a field with no name is kept', () => {
  // An unnamed value is still someone's data. An empty value is a blank row
  // left behind by the editor, and saving those would grow the entry forever.
  const e = normalizeEntry({
    pw: 'x',
    fields: [{ name: 'Empty', value: '' }, { name: '', value: 'orphaned' }, null, 'nonsense'],
  })
  assert.equal(e.fields.length, 1)
  assert.equal(e.fields[0].value, 'orphaned')
})

test('custom fields are capped and trimmed like every other text', () => {
  const e = normalizeEntry({
    pw: 'x',
    fields: [
      { name: '  Spaced  ', value: '  padded  ' },
      ...Array.from({ length: 50 }, (_, i) => ({ name: `f${i}`, value: 'v' })),
    ],
  })
  assert.equal(e.fields[0].name, 'Spaced')
  assert.equal(e.fields[0].value, 'padded')
  assert.equal(e.fields.length, 30)
})

test('the secret flag is a real boolean, whatever was handed in', () => {
  const e = normalizeEntry({
    pw: 'x',
    fields: [{ name: 'a', value: '1', secret: 'yes' }, { name: 'b', value: '2', secret: 0 }],
  })
  assert.equal(e.fields[0].secret, true)
  assert.equal(e.fields[1].secret, false)
})

test('an entry with no fields has an empty list, not undefined', () => {
  assert.deepEqual(normalizeEntry({ pw: 'x' }).fields, [])
})
