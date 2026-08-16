import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import {
  createVaultStore, DEFAULT_AUTOLOCK_MS, TOMBSTONE_TTL_MS, EXPORT_HISTORY, deviceNameFrom, mergeMeta
} from '../src/vault-store.js'
import {
  normalizeEntry, normalizeEntries, groupsOf, tagsOf, sortEntries, groupEntries, SORTS, UNGROUPED, reuseIndex, reuseCount, isTombstone
} from '../src/vault-entry.js'
import { KDF_ITERATIONS, sealVault, deriveKey, newSalt, createVault, openVault } from '../src/vault-crypto.js'

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
  // Including the payload's own fields: an entry count is a fact about the
  // contents, and it came out of the ciphertext with them.
  assert.equal(store.vaultId(), null)
  assert.equal(store.lastExport(), null)
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
  const oldSalt = store.envelope().wraps.passphrase.kdf.salt

  await store.rekey(PASS, 'a different passphrase entirely')
  assert.equal(store.list().length, 1)
  assert.notEqual(store.envelope().wraps.passphrase.kdf.salt, oldSalt, 'a re-key must re-salt')
  assert.equal(store.envelope().wraps.passphrase.kdf.iterations, KDF_ITERATIONS,
    're-keying is also the upgrade path for the cost parameter')

  store.lock()
  await assert.rejects(() => store.unlock(PASS), 'the old passphrase must stop working')
  await store.unlock('a different passphrase entirely')
  assert.equal(store.list()[0].label, 'email')
})

test('re-keying derives twice, which is the floor', async () => {
  // Two derivations: one to open with the old passphrase, one to seal with
  // the new. A third would be a visible stall on a phone for no reason.
  //
  // Counted, not timed. This was a wall-clock ratio -- re-key against one
  // unlock, fail above 2.75x -- which measures the machine as much as the
  // code: it passes alone at ~425ms and fails in the full suite at ~876ms,
  // because `node --test` runs files in parallel and the two halves of the
  // ratio get different amounts of CPU. A count cannot be loaded down.
  const derivations = []
  const real = crypto.subtle.deriveKey.bind(crypto.subtle)
  crypto.subtle.deriveKey = (algorithm, ...rest) => {
    if (algorithm && algorithm.name === 'PBKDF2') derivations.push(algorithm.iterations)
    return real(algorithm, ...rest)
  }
  try {
    const { store } = await freshStore()
    await store.create(PASS)
    derivations.length = 0
    await store.rekey(PASS, 'another passphrase')
    assert.deepEqual(derivations, [KDF_ITERATIONS, KDF_ITERATIONS],
      `re-key ran ${derivations.length} PBKDF2 derivations; two is the floor and the ceiling`)
  } finally {
    crypto.subtle.deriveKey = real
  }
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

// --- the in-progress entry ----------------------------------------------------

const draftStorage = () => {
  let envelope = null
  let draft = null
  return {
    load: async () => envelope,
    save: async (e) => { envelope = e },
    clear: async () => { envelope = null; draft = null },
    loadDraft: async () => draft,
    saveDraft: async (d) => { draft = d },
    clearDraft: async () => { draft = null },
    peek: () => draft,
  }
}

test('a draft survives a round trip, and is stored as ciphertext', async () => {
  const storage = draftStorage()
  const store = createVaultStore({ storage, now: () => 0 })
  await store.init()
  await store.create(PASS)

  const draft = { label: 'Half typed', pw: 'a-secret-in-progress', note: 'not saved yet' }
  assert.equal(await store.saveDraft(draft), true)

  // What actually landed in storage must not contain the password.
  const raw = JSON.stringify(storage.peek())
  assert.ok(!raw.includes('a-secret-in-progress'),
    'the draft holds a password and must not sit in storage in the clear')
  assert.ok(!raw.includes('Half typed'))

  assert.deepEqual(await store.loadDraft(), draft)
  assert.equal(await store.hasDraft(), true)
})

test('a draft needs the vault open, like everything else', async () => {
  const storage = draftStorage()
  const store = createVaultStore({ storage, now: () => 0 })
  await store.init()
  await store.create(PASS)
  await store.saveDraft({ label: 'x', pw: 'y' })

  store.lock()
  assert.equal(await store.loadDraft(), null, 'a locked vault cannot read its own draft')

  await store.unlock(PASS)
  assert.deepEqual(await store.loadDraft(), { label: 'x', pw: 'y' })
})

test('clearing the draft removes it', async () => {
  const storage = draftStorage()
  const store = createVaultStore({ storage, now: () => 0 })
  await store.init()
  await store.create(PASS)
  await store.saveDraft({ label: 'x', pw: 'y' })
  await store.clearDraft()
  assert.equal(await store.loadDraft(), null)
  assert.equal(await store.hasDraft(), false)
})

test('a draft sealed under an old key is discarded, not fatal', async () => {
  // After a passphrase change the old draft cannot be opened. Losing scratch
  // is a nuisance; refusing to open the vault over it would not be.
  const storage = draftStorage()
  const store = createVaultStore({ storage, now: () => 0 })
  await store.init()
  await store.create(PASS)
  await store.saveDraft({ label: 'stale', pw: 'z' })
  await store.rekey(PASS, 'an-entirely-different-passphrase')

  assert.equal(await store.loadDraft(), null)
  assert.equal(await store.hasDraft(), false, 'the unreadable draft is cleared away')
})

test('destroying the vault takes the draft with it', async () => {
  const storage = draftStorage()
  const store = createVaultStore({ storage, now: () => 0 })
  await store.init()
  await store.create(PASS)
  await store.saveDraft({ label: 'x', pw: 'y' })
  await store.destroy(PASS)
  assert.equal(storage.peek(), null, 'a destroyed vault must not leave a sealed draft behind')
})

// --- tags ---------------------------------------------------------------------

test('tags are many per entry, where a group is one', () => {
  const e = normalizeEntry({ pw: 'x', group: 'Finance', tags: ['work', 'card', 'shared'] })
  assert.equal(e.group, 'Finance')
  assert.deepEqual(e.tags, ['card', 'shared', 'work'], 'sorted, so the chips do not reshuffle')
})

test('tags are lower-cased and deduplicated', () => {
  // "Work" and "work" as two separate tags is the fastest way to make a tag
  // list useless.
  const e = normalizeEntry({ pw: 'x', tags: ['Work', 'work', ' WORK ', 'Finance'] })
  assert.deepEqual(e.tags, ['finance', 'work'])
})

test('tags accept a typed string as well as a list', () => {
  assert.deepEqual(normalizeEntry({ pw: 'x', tags: 'work, finance' }).tags, ['finance', 'work'])
  assert.deepEqual(normalizeEntry({ pw: 'x', tags: 'solo' }).tags, ['solo'])
})

test('an untagged entry is a normal state, not an unfiled one', () => {
  // Unlike a group, there is no "Untagged" bucket to fall into.
  assert.deepEqual(normalizeEntry({ pw: 'x' }).tags, [])
  assert.deepEqual(normalizeEntry({ pw: 'x', tags: ['', '  '] }).tags, [])
})

test('tags are capped and trimmed like every other text', () => {
  const e = normalizeEntry({
    pw: 'x',
    tags: [...Array.from({ length: 50 }, (_, i) => `t${i}`), 'g'.repeat(80)],
  })
  assert.equal(e.tags.length, 30)
  assert.ok(e.tags.every((t) => t.length <= 40))
})

test('tagsOf gathers every tag in use, once', () => {
  const list = normalizeEntries([
    { pw: '1', tags: ['work', 'card'] },
    { pw: '2', tags: ['work'] },
    { pw: '3' },
  ])
  assert.deepEqual(tagsOf(list), ['card', 'work'])
  assert.deepEqual(tagsOf([]), [])
})

// -- The recovery key (ROADMAP 9f) --------------------------------------------
//
// The failure this exists for: forgetting the passphrase. A backup does not
// help, because a backup you cannot decrypt is as lost as no backup at all.

const WORDS = fs
  .readFileSync(new URL('../data/orchard-street-long.txt', import.meta.url), 'utf8')
  .split('\n').map((w) => w.trim()).filter(Boolean)

test('a vault has no recovery key until one is asked for', async () => {
  const { store } = await freshStore()
  await store.create(PASS)
  assert.equal(store.hasRecoveryKey(), false)
})

test('the recovery key opens the vault and sets a new passphrase', async () => {
  const { store } = await freshStore()
  await store.create(PASS)
  await store.add({ label: 'email', pw: 'hunter2!' })

  const phrase = await store.addRecoveryKey(PASS, WORDS)
  assert.equal(phrase.split(' ').length, 16)
  assert.equal(store.hasRecoveryKey(), true)

  store.lock()
  await store.recoverWithKey(phrase, 'a brand new passphrase')
  assert.equal(store.state(), 'unlocked')
  assert.equal(store.list()[0].label, 'email', 'the entries must survive recovery')

  store.lock()
  await store.unlock('a brand new passphrase')
  assert.equal(store.list().length, 1)
})

test('the forgotten passphrase stops working after recovery', async () => {
  // The whole reason to be on this path is that nobody remembers the old one,
  // so leaving it live would mean an attacker who learned it still gets in.
  const { store } = await freshStore()
  await store.create(PASS)
  const phrase = await store.addRecoveryKey(PASS, WORDS)

  store.lock()
  await store.recoverWithKey(phrase, 'a brand new passphrase')
  store.lock()
  await assert.rejects(() => store.unlock(PASS), 'the old passphrase must be retired')
})

test('a recovery key is retired by using it', async () => {
  // It has just been typed into a screen, read off paper, possibly out loud.
  // A fresh one can be generated; this one should not keep working.
  const { store } = await freshStore()
  await store.create(PASS)
  const phrase = await store.addRecoveryKey(PASS, WORDS)

  await store.recoverWithKey(phrase, 'second passphrase')
  assert.equal(store.hasRecoveryKey(), false, 'recovery is single-use by design')
  await assert.rejects(() => store.recoverWithKey(phrase, 'third passphrase'),
    /no recovery key/)
})

test('generating a second recovery key retires the first', async () => {
  const { store } = await freshStore()
  await store.create(PASS)
  const first = await store.addRecoveryKey(PASS, WORDS)
  const second = await store.addRecoveryKey(PASS, WORDS)
  assert.notEqual(first, second)

  assert.equal(await store.verifyRecoveryKey(second), true)
  assert.equal(await store.verifyRecoveryKey(first), false, 'the old paper must stop working')
})

test('adding or removing a recovery key needs the passphrase, not just an open tab', async () => {
  // Same rule as destroy(). Minting a second permanent key to someone's vault
  // is not something a person who walked up to an unlocked browser may do.
  const { store } = await freshStore()
  await store.create(PASS)
  await assert.rejects(() => store.addRecoveryKey('wrong', WORDS))
  assert.equal(store.hasRecoveryKey(), false, 'a failed attempt must add nothing')

  await store.addRecoveryKey(PASS, WORDS)
  await assert.rejects(() => store.removeRecoveryKey('wrong'))
  assert.equal(store.hasRecoveryKey(), true, 'a failed removal must leave it in place')

  assert.equal(await store.removeRecoveryKey(PASS), true)
  assert.equal(store.hasRecoveryKey(), false)
})

test('the phrase is not recoverable from anything the store persists', async () => {
  const { store, storage } = await freshStore()
  await store.create(PASS)
  const phrase = await store.addRecoveryKey(PASS, WORDS)

  const onDisk = JSON.stringify(storage.box.value)
  for (const word of phrase.split(' ')) {
    assert.ok(!onDisk.includes(word), `"${word}" survives into storage`)
  }
})

test('a wrong recovery key changes nothing', async () => {
  const { store } = await freshStore()
  await store.create(PASS)
  await store.add({ label: 'email', pw: 'hunter2!' })
  await store.addRecoveryKey(PASS, WORDS)
  store.lock()

  const wrong = WORDS.slice(0, 16).join(' ')
  assert.equal(await store.verifyRecoveryKey(wrong), false)
  await assert.rejects(() => store.recoverWithKey(wrong, 'nope'))
  assert.equal(store.state(), 'locked', 'a failed recovery must not leave the vault open')

  await store.unlock(PASS)
  assert.equal(store.list()[0].label, 'email', 'and must not have touched the entries')
})

test('verifying a recovery key mutates nothing', async () => {
  const { store, storage } = await freshStore()
  await store.create(PASS)
  const phrase = await store.addRecoveryKey(PASS, WORDS)
  const before = storage.box.saves
  assert.equal(await store.verifyRecoveryKey(phrase), true)
  assert.equal(storage.box.saves, before, 'a check is not a write')
})

test('a recovery key is accepted however it was typed back', async () => {
  // Off paper, months later, in whatever case and spacing happened.
  const { store } = await freshStore()
  await store.create(PASS)
  const phrase = await store.addRecoveryKey(PASS, WORDS)
  const messy = `  ${phrase.toUpperCase().replace(/ /g, '\n')}  `
  assert.equal(await store.verifyRecoveryKey(messy), true)
})

test('a vault from before this release upgrades when recovery is added', async () => {
  // Every vault created before v2 encrypts its data directly under the
  // passphrase key, with nowhere to put a second wrap. It keeps opening
  // untouched; the format change happens at the one moment the passphrase is
  // already in hand and the user asked for something.
  const salt = newSalt()
  const kdf = {
    name: 'PBKDF2', hash: 'SHA-256', iterations: 1000,
    salt: btoa(String.fromCharCode(...salt)),
  }
  const legacy = await sealVault(
    await deriveKey(PASS, salt, 1000), kdf,
    [{ id: 'a', label: 'email', pw: 'hunter2!', at: '2026-08-13' }],
  )
  assert.equal(legacy.v, 1)

  const storage = fakeStorage()
  storage.box.value = legacy
  const store = createVaultStore({ storage, now: fakeClock().now })
  assert.equal(await store.init(), 'locked')

  // It opens as it always did, and honestly reports that it cannot yet carry
  // a recovery key.
  await store.unlock(PASS)
  assert.equal(store.list()[0].label, 'email')
  assert.equal(store.hasRecoveryKey(), false)

  const phrase = await store.addRecoveryKey(PASS, WORDS)
  assert.equal(store.envelope().v, 2, 'adding recovery upgrades the envelope')
  assert.equal(store.hasRecoveryKey(), true)
  assert.equal(store.list()[0].label, 'email', 'and the entries come through')

  // Both ways in work on the upgraded vault, and the old cost parameter is
  // gone with the old format.
  assert.equal(store.envelope().wraps.passphrase.kdf.iterations, KDF_ITERATIONS)
  store.lock()
  await store.unlock(PASS)
  assert.equal(store.list().length, 1)
  store.lock()
  await store.recoverWithKey(phrase, 'a new passphrase')
  assert.equal(store.list()[0].label, 'email')
})

test('re-keying a pre-v2 vault upgrades it too', async () => {
  const salt = newSalt()
  const kdf = {
    name: 'PBKDF2', hash: 'SHA-256', iterations: 1000,
    salt: btoa(String.fromCharCode(...salt)),
  }
  const legacy = await sealVault(await deriveKey(PASS, salt, 1000), kdf, [{ id: 'a', pw: 'x' }])

  const storage = fakeStorage()
  storage.box.value = legacy
  const store = createVaultStore({ storage, now: fakeClock().now })
  await store.init()
  await store.unlock(PASS)

  await store.rekey(PASS, 'another passphrase')
  assert.equal(store.envelope().v, 2)
  assert.equal(store.list().length, 1)
})

// -- Sync-shaped: timestamps and tombstones -----------------------------------

test('every write stamps updatedAt', async () => {
  const { store, clock } = await freshStore()
  await store.create(PASS)
  const made = await store.add({ label: 'Bank', pw: 'hunter2!' })
  assert.equal(made.updatedAt, new Date(clock.t).toISOString())

  clock.advance(60_000)
  const changed = await store.update(made.id, { label: 'Bank plc' })
  assert.equal(changed.updatedAt, new Date(clock.t).toISOString())
  assert.ok(changed.updatedAt > made.updatedAt, 'an edit must move the stamp forward')
})

test('a delete leaves a tombstone rather than a hole', async () => {
  // "Deleted here" and "not seen yet" have to be different things, or the
  // next replica hands the entry back.
  const { store } = await freshStore()
  await store.create(PASS)
  const made = await store.add({ label: 'Bank', pw: 'hunter2!' })
  await store.remove(made.id)

  assert.equal(store.list().length, 0, 'a tombstone is not shown to anyone')
  const kept = store.raw().filter((e) => e.id === made.id)
  assert.equal(kept.length, 1, 'but it is still in the vault')
  assert.ok(kept[0].deletedAt, 'with a time of death')
  assert.equal(kept[0].pw, undefined, 'and no secret')
  assert.equal(kept[0].label, undefined, 'nor a label, which is also information')
})

test('a tombstone survives a lock and unlock', async () => {
  const storage = fakeStorage()
  const first = createVaultStore({ storage, now: fakeClock().now })
  await first.init()
  await first.create(PASS)
  const made = await first.add({ label: 'Bank', pw: 'hunter2!' })
  await first.remove(made.id)

  const second = createVaultStore({ storage, now: fakeClock().now })
  await second.init()
  await second.unlock(PASS)
  assert.equal(second.list().length, 0)
  assert.equal(second.raw().filter((e) => e.deletedAt).length, 1,
    'the deletion has to be in the sealed vault, not just in memory')
})

test('deleting twice is not an error and does not restamp', async () => {
  const { store, clock } = await freshStore()
  await store.create(PASS)
  const made = await store.add({ label: 'Bank', pw: 'hunter2!' })
  assert.equal(await store.remove(made.id), true)
  const first = store.raw().find((e) => e.id === made.id).deletedAt

  clock.advance(60_000)
  assert.equal(await store.remove(made.id), false, 'nothing left to delete')
  assert.equal(store.raw().find((e) => e.id === made.id).deletedAt, first,
    'and the original time of death stands')
})

test('old tombstones are reaped, recent ones are not', async () => {
  // A tombstone that lives forever is a slow leak of what used to be here.
  const { store, clock } = await freshStore()
  await store.create(PASS)
  const old = await store.add({ label: 'Gone', pw: 'x' })
  await store.remove(old.id)

  clock.advance(TOMBSTONE_TTL_MS + 1000)
  const fresh = await store.add({ label: 'Also gone', pw: 'y' })
  await store.remove(fresh.id)

  const dead = store.raw().filter((e) => e.deletedAt)
  assert.equal(dead.length, 1, 'the ninety-day-old marker is gone')
  assert.equal(dead[0].id, fresh.id)
})

test('tombstones never reach an export', async () => {
  // The plain and CSV exports are for other tools, which have no idea what a
  // deletion marker is and would import it as a blank row.
  const { store } = await freshStore()
  await store.create(PASS)
  const keep = await store.add({ label: 'Keep', pw: 'x' })
  const drop = await store.add({ label: 'Drop', pw: 'y' })
  await store.remove(drop.id)

  const listed = store.list()
  assert.deepEqual(listed.map((e) => e.id), [keep.id])
  assert.ok(!JSON.stringify(listed).includes('deletedAt'))
})

test('the entry count ignores tombstones', async () => {
  const { store } = await freshStore()
  await store.create(PASS)
  const a = await store.add({ label: 'A', pw: 'x' })
  await store.add({ label: 'B', pw: 'y' })
  await store.remove(a.id)
  assert.equal(store.list().length, 1)
})

test('restore puts an entry back, over its own tombstone', async () => {
  // Undo after a delete. The deletion was already durable, so this is a
  // re-add that has to out-rank the tombstone rather than a rollback.
  const { store, clock } = await freshStore()
  await store.create(PASS)
  const made = await store.add({ label: 'Bank', pw: 'hunter2!', note: 'joint' })
  const copy = store.list()[0]
  await store.remove(made.id)
  clock.advance(3000)

  const back = await store.restore(copy)
  assert.equal(store.list().length, 1)
  assert.equal(back.id, made.id, 'the same entry, not a duplicate')
  assert.equal(back.note, 'joint', 'with everything it had')
  assert.ok(back.updatedAt > copy.updatedAt, 'stamped later than the deletion it undoes')
  assert.equal(store.raw().filter((e) => e.id === made.id).length, 1,
    'the tombstone is replaced, not left beside it')
})

test('a restored entry beats the deletion on another replica', async () => {
  // The reason restore takes a fresh stamp. Without it the tombstone is newer
  // and the next merge deletes the entry again.
  const { store, clock } = await freshStore()
  await store.create(PASS)
  const made = await store.add({ label: 'Bank', pw: 'hunter2!' })
  const copy = store.list()[0]
  await store.remove(made.id)
  const tombstone = store.raw().find((e) => e.id === made.id)

  clock.advance(3000)
  await store.restore(copy)
  const restored = store.raw().find((e) => e.id === made.id)
  assert.ok(restored.updatedAt > tombstone.deletedAt)
})

// -- The payload: facts about the vault, not just its contents ----------------

test('a vault has a stable id that survives everything', async () => {
  // What lets two replicas establish they are the same vault before trying to
  // reconcile. It must not change when the passphrase does, or a re-key would
  // look like a different vault to every other copy.
  const { store } = await freshStore()
  await store.create(PASS)
  const id = store.vaultId()
  assert.match(id, /\S/)

  await store.add({ label: 'Bank', pw: 'x' })
  assert.equal(store.vaultId(), id, 'adding an entry')

  await store.rekey(PASS, 'a different passphrase')
  assert.equal(store.vaultId(), id, 'changing the passphrase')

  store.lock()
  await store.unlock('a different passphrase')
  assert.equal(store.vaultId(), id, 'and a lock/unlock round trip')
})

test('two vaults have different ids', async () => {
  const a = await freshStore()
  await a.store.create(PASS)
  const b = await freshStore()
  await b.store.create(PASS)
  assert.notEqual(a.store.vaultId(), b.store.vaultId())
})

test('a vault written before payloads existed still opens, and gains an id', async () => {
  // Every vault made until today holds a bare array. It must load unchanged,
  // and acquire an id the first time it is opened rather than staying
  // anonymous forever.
  const legacyEntries = [{ id: 'a', label: 'Email', pw: 'hunter2!', at: '2026-08-14' }]
  const { envelope } = await createVault(PASS, legacyEntries)

  const storage = fakeStorage()
  storage.box.value = envelope
  const store = createVaultStore({ storage, now: fakeClock().now })
  await store.init()
  await store.unlock(PASS)

  assert.equal(store.list()[0].label, 'Email', 'the entries come through')
  assert.match(store.vaultId() || '', /\S/, 'and it now has an id')

  // And that id sticks, rather than being reinvented on every save.
  const id = store.vaultId()
  await store.add({ label: 'New', pw: 'y' })
  store.lock()
  await store.unlock(PASS)
  assert.equal(store.vaultId(), id)
})

test('the backup record lives in the vault, so every browser sees it', async () => {
  // It was in localStorage, which made it per-browser: Edge reported a vault
  // as never exported an hour after Chrome had exported it. With a shared
  // folder that is wrong rather than merely unhelpful.
  const storage = fakeStorage()
  const first = createVaultStore({ storage, now: fakeClock().now })
  await first.init()
  await first.create(PASS)
  await first.add({ label: 'Bank', pw: 'x' })
  assert.equal(first.lastExport(), null)

  const noted = await first.noteExport()
  assert.equal(noted.count, 1)
  assert.match(noted.at, /^\d{4}-\d{2}-\d{2}T/, 'a full timestamp, not a date')

  // A different browser over the same storage is the case that was broken.
  const second = createVaultStore({ storage, now: fakeClock().now })
  await second.init()
  await second.unlock(PASS)
  assert.deepEqual(second.lastExport(), noted, 'the other browser knows')
})

test('the export count ignores tombstones', async () => {
  const { store } = await freshStore()
  await store.create(PASS)
  const a = await store.add({ label: 'A', pw: 'x' })
  await store.add({ label: 'B', pw: 'y' })
  await store.remove(a.id)
  assert.equal((await store.noteExport()).count, 1)
})

test('each write records which device made it', async () => {
  // A label rather than a credential: it exists so a merge can say where a
  // change came from, and so an unexpected writer is visible.
  const storage = fakeStorage()
  const store = createVaultStore({ storage, now: fakeClock().now, deviceId: 'laptop' })
  await store.init()
  await store.create(PASS)
  await store.add({ label: 'Bank', pw: 'x' })

  const other = createVaultStore({ storage, now: fakeClock().now, deviceId: 'phone' })
  await other.init()
  await other.unlock(PASS)
  const opened = await openVault(storage.box.value, PASS)
  assert.equal(opened.data.meta.lastWriter, 'laptop')

  await other.add({ label: 'Email', pw: 'y' })
  const after = await openVault(storage.box.value, PASS)
  assert.equal(after.data.meta.lastWriter, 'phone')
})


test('the vault keeps a short history of backups, newest first', async () => {
  // The useful question is not "was there ever a backup" but "how long have I
  // been meaning to", and one record cannot answer it.
  const clock = fakeClock()
  const storage = fakeStorage()
  const store = createVaultStore({ storage, now: clock.now, deviceName: 'Edge on Windows' })
  await store.init()
  await store.create(PASS)
  await store.add({ label: 'A', pw: 'x' })
  assert.deepEqual(store.exports(), [])

  await store.noteExport()
  clock.advance(60_000)
  await store.add({ label: 'B', pw: 'y' })
  await store.noteExport()

  const list = store.exports()
  assert.equal(list.length, 2)
  assert.ok(list[0].at > list[1].at, 'newest first')
  assert.deepEqual(list.map((x) => x.count), [2, 1])
  assert.equal(list[0].by, 'Edge on Windows')
  assert.deepEqual(store.lastExport(), list[0], 'the nag reads the newest of these')
})

test('the history is capped, so it cannot grow inside the ciphertext forever', async () => {
  const clock = fakeClock()
  const { store } = await freshStore()
  await store.create(PASS)
  await store.add({ label: 'A', pw: 'x' })
  for (let i = 0; i < EXPORT_HISTORY + 4; i++) await store.noteExport()
  assert.equal(store.exports().length, EXPORT_HISTORY)
  void clock
})

test('a garbled backup record is dropped rather than rendered', async () => {
  // It comes out of the vault, but the vault may have been written by a
  // version that is not this one. A list is not worth a broken page.
  const { envelope } = await createVault(PASS, {
    v: 1,
    vaultId: 'abc',
    entries: [],
    meta: { exports: [null, { at: '2026-08-01T00:00:00.000Z', count: 3 }, { at: 7 }, { count: 1 }] },
  })
  const storage = fakeStorage()
  storage.box.value = envelope
  const store = createVaultStore({ storage, now: fakeClock().now })
  await store.init()
  await store.unlock(PASS)
  assert.deepEqual(store.exports(), [{ at: '2026-08-01T00:00:00.000Z', count: 3 }])
})

test('the device name says which browser, and gets the impersonators right', () => {
  // Every Chromium UA claims Safari, and Edge claims Chrome on top of that.
  // Testing in the wrong order is the only way to get this wrong, so the order
  // is what is asserted.
  const chrome = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36'
  const edge = chrome + ' Edg/140.0.0.0'
  const opera = chrome + ' OPR/117.0.0.0'
  assert.equal(deviceNameFrom(chrome), 'Chrome on Windows')
  assert.equal(deviceNameFrom(edge), 'Edge on Windows')
  assert.equal(deviceNameFrom(opera), 'Opera on Windows')
  assert.equal(
    deviceNameFrom('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15'),
    'Safari on macOS')
  assert.equal(
    deviceNameFrom('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1'),
    'Safari on iOS', 'an iPhone also says Mac OS X, and is not a Mac')
  assert.equal(
    deviceNameFrom('Mozilla/5.0 (X11; Linux x86_64; rv:130.0) Gecko/20100101 Firefox/130.0'),
    'Firefox on Linux')
  // It is a label. Nothing may depend on it, including being present.
  assert.equal(deviceNameFrom(''), 'an unknown browser')
  assert.equal(deviceNameFrom(undefined), 'an unknown browser')
})

// -- read-merge-write ---------------------------------------------------------

test('two tabs of one browser stop overwriting each other too', async () => {
  // Not only the folder case. Two tabs are two stores over the same IndexedDB,
  // which is the same lost update with a shorter distance to travel -- and far
  // more common, since nothing warns you that the vault is open twice.
  const clock = fakeClock()
  const storage = fakeStorage()
  const mk = () => createVaultStore({ storage, now: clock.now })

  const tabA = mk()
  await tabA.init()
  await tabA.create(PASS)
  const tabB = mk()
  await tabB.init()
  await tabB.unlock(PASS)

  await tabA.add({ label: 'Typed in A', pw: 'aaa' })
  clock.advance(1000)
  await tabB.add({ label: 'Typed in B', pw: 'bbb' })

  const fresh = mk()
  await fresh.init()
  await fresh.unlock(PASS)
  assert.deepEqual(fresh.list().map((e) => e.label).sort(), ['Typed in A', 'Typed in B'])
})

test('the merge is not run against our own writes', async () => {
  // seenCt is what makes the difference between "a peer wrote" and "we wrote".
  // Every path that re-seals has to record it -- re-key and the recovery slots
  // seal outside persist(), and missing one would have the next save merge the
  // vault with itself.
  const clock = fakeClock()
  const storage = fakeStorage()
  const store = createVaultStore({ storage, now: clock.now })
  await store.init()
  await store.create(PASS)
  await store.add({ label: 'Bank', pw: 'x' })

  for (const step of [
    () => store.rekey(PASS, 'a second passphrase'),
    () => store.addRecoveryKey('a second passphrase', WORDS),
    () => store.removeRecoveryKey('a second passphrase'),
  ]) {
    await step()
    clock.advance(1000)
    // If seenCt were stale here, this save would re-read our own envelope,
    // merge it with itself, and the entry count would be the tell.
    await store.add({ label: `after ${store.list().length}`, pw: 'y' })
    assert.equal(store.list().filter((e) => e.label === 'Bank').length, 1)
  }
  assert.equal(store.list().length, 4)
})

test('backup records from two devices are a union, not a disagreement', () => {
  // A backup made on the laptop and one made on the desktop are two facts.
  const laptop = { exports: [{ at: '2026-08-15T10:00:00.000Z', count: 3, by: 'Chrome on Windows' }] }
  const desktop = { exports: [{ at: '2026-08-14T09:00:00.000Z', count: 2, by: 'Edge on Windows' }] }

  const merged = mergeMeta(laptop, desktop)
  assert.deepEqual(merged.exports.map((x) => x.at),
    ['2026-08-15T10:00:00.000Z', '2026-08-14T09:00:00.000Z'], 'newest first')

  // Idempotent, or every save would grow the list.
  assert.deepEqual(mergeMeta(merged, desktop), merged)
  assert.deepEqual(mergeMeta(merged, merged), merged)
})

test('the backup list is capped after a merge, not just after a backup', async () => {
  const many = (n, from) => ({
    exports: Array.from({ length: n }, (_, i) => ({ at: `2026-08-${String(from + i).padStart(2, '0')}T00:00:00.000Z`, count: i })),
  })
  const merged = mergeMeta(many(4, 1), many(4, 10))
  assert.equal(merged.exports.length, EXPORT_HISTORY)
  assert.equal(merged.exports[0].at, '2026-08-13T00:00:00.000Z', 'the newest survive')
})

test('an unreadable replacement stops the save without guessing why', async () => {
  // A peer that re-keyed and a different vault dropped in the same place fail
  // identically -- both have a master key we do not hold -- so the message
  // names both rather than picking one. Overwriting either would be the worst
  // available answer: someone deliberately set that passphrase, or that is
  // somebody else's vault.
  const clock = fakeClock()
  const storage = fakeStorage()
  const mine = createVaultStore({ storage, now: clock.now })
  await mine.init()
  await mine.create(PASS)
  await mine.add({ label: 'Mine', pw: 'x' })

  const theirs = await createVault(PASS, { v: 1, vaultId: 'someone-else', entries: [], meta: {} })
  storage.box.value = theirs.envelope

  clock.advance(1000)
  await assert.rejects(() => mine.add({ label: 'Late', pw: 'y' }), /replaced or given a different passphrase/)
  // REVERSED. This used to assert the opposite -- that the typed entry stayed
  // in memory so nothing had to be retyped. It is the editor that keeps what
  // was typed, because the throw stops the caller before it closes the dialog;
  // the LIST must not keep it, or it shows a saved-looking row that is on no
  // disk anywhere and that a later save would write after all.
  assert.deepEqual(mine.list().map((e) => e.label), ['Mine'],
    'a refused save leaves the list exactly as storage has it')
})

test('a readable vault that claims a different identity is still refused', async () => {
  // The narrow case the id check is for: same master key, different vaultId.
  // Buildable only by sealing with the key in hand, which is the point -- it
  // is what a clone that diverged would look like, and merging two vaults is
  // interleaving two people's passwords into one list.
  const clock = fakeClock()
  const storage = fakeStorage()
  const made = await createVault(PASS, { v: 1, vaultId: 'ours', entries: [], meta: {} })
  storage.box.value = made.envelope

  const store = createVaultStore({ storage, now: clock.now })
  await store.init()
  await store.unlock(PASS)
  await store.add({ label: 'Mine', pw: 'x' })

  // Same key, so it decrypts; different id, so it must not be merged.
  storage.box.value = await sealVault(made.key, made.kdf, {
    v: 1, vaultId: 'not-ours', entries: [], meta: {},
  })
  clock.advance(1000)
  await assert.rejects(() => store.add({ label: 'Late', pw: 'y' }), /different vault is in that place/)
})
