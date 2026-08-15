import test from 'node:test'
import assert from 'node:assert/strict'
import { createFolderStorage, VAULT_FILENAME } from '../src/vault-fs.js'
import { createVault, openVault } from '../src/vault-crypto.js'
import { createVaultStore } from '../src/vault-store.js'

// The File System Access API does not exist in node, so the directory handle
// is faked -- the same bargain the store already makes for storage and the
// clock. What that leaves untested is the browser's own behaviour, and the one
// piece of it this design leans on is named in the module: createWritable
// commits through a swap file, so an interrupted write does not truncate the
// vault. That is a browser guarantee and only a browser can prove it.

const notFound = () => Object.assign(new Error('missing'), { name: 'NotFoundError' })

/** Enough of FileSystemDirectoryHandle to exercise the adapter. */
const fakeDir = (files = {}) => {
  const store = { ...files }
  const dir = {
    store,
    writes: 0,
    removed: [],
    async getFileHandle (name, opts = {}) {
      if (!(name in store) && !opts.create) throw notFound()
      if (!(name in store)) store[name] = ''
      return {
        async getFile () { return { text: async () => store[name] } },
        async createWritable () {
          let buffer = ''
          return {
            async write (chunk) { buffer += chunk },
            async close () { store[name] = buffer; dir.writes++ },
          }
        },
      }
    },
    async removeEntry (name) {
      if (!(name in store)) throw notFound()
      delete store[name]
      dir.removed.push(name)
    },
  }
  return dir
}

const fakeDrafts = () => {
  let held = null
  return {
    loadDraft: async () => held,
    saveDraft: async (v) => { held = v },
    clearDraft: async () => { held = null },
  }
}

// Merges are decided by updatedAt, so these tests have to be able to say which
// write came second. A driven clock does that without sleeping.
const fakeClock = (start = 1_000_000) => {
  const c = { t: start }
  c.now = () => c.t
  c.advance = (ms) => { c.t += ms }
  return c
}

const PASS = 'correct horse battery staple'

test('an empty folder reports no vault rather than an error', async () => {
  // Which is what lets the UI offer to create one.
  const fs = createFolderStorage(fakeDir(), { drafts: fakeDrafts() })
  assert.equal(await fs.load(), null)
})

test('a vault round-trips through the folder', async () => {
  const dir = fakeDir()
  const fs = createFolderStorage(dir, { drafts: fakeDrafts() })
  const { envelope } = await createVault(PASS, [{ id: 'a', label: 'Bank', pw: 'hunter2!' }])

  await fs.save(envelope)
  assert.ok(dir.store[VAULT_FILENAME], 'it should write vault.wrlck')

  const back = await fs.load()
  assert.deepEqual(back, envelope)
  const { data } = await openVault(back, PASS)
  assert.equal(data[0].label, 'Bank')
})

test('what lands in the folder is ciphertext', async () => {
  // It is going into someone's Dropbox. This is the property that makes that
  // acceptable, so it is asserted rather than assumed.
  const dir = fakeDir()
  const fs = createFolderStorage(dir, { drafts: fakeDrafts() })
  const { envelope } = await createVault(PASS, [{ id: 'a', label: 'Bank', pw: 'hunter2-secret' }])
  await fs.save(envelope)

  const onDisk = dir.store[VAULT_FILENAME]
  assert.ok(!onDisk.includes('hunter2-secret'))
  assert.ok(!onDisk.includes('Bank'))
  assert.ok(!onDisk.includes(PASS))
})

test('a corrupt vault file throws instead of looking like an empty folder', async () => {
  // The dangerous failure. null means "no vault here", which the UI answers by
  // offering to create one -- on top of whatever is actually in that file, and
  // the first save finishes the job.
  const bad = createFolderStorage(fakeDir({ [VAULT_FILENAME]: 'not json at all' }), { drafts: fakeDrafts() })
  await assert.rejects(() => bad.load(), /not readable as JSON/)

  const wrong = createFolderStorage(fakeDir({ [VAULT_FILENAME]: '{"hello":"world"}' }), { drafts: fakeDrafts() })
  await assert.rejects(() => wrong.load(), /not a WordLock vault/)
})

test('a hand-copied backup file is recognised', async () => {
  // Someone moving a vault in by hand will most likely copy the backup export,
  // which wraps the envelope rather than being one.
  const { envelope } = await createVault(PASS, [])
  const wrapped = JSON.stringify({ format: 'wordlock-vault-backup', vault: envelope })
  const fs = createFolderStorage(fakeDir({ [VAULT_FILENAME]: wrapped }), { drafts: fakeDrafts() })
  assert.deepEqual(await fs.load(), envelope)
})

test('clear removes the vault file and nothing else', async () => {
  // Never the folder. It is the user's, it may hold anything, and a password
  // manager that deletes directories is one bug from being a story.
  const dir = fakeDir({ [VAULT_FILENAME]: '{}', 'holiday-photo.jpg': 'binary' })
  const fs = createFolderStorage(dir, { drafts: fakeDrafts() })
  await fs.clear()
  assert.deepEqual(dir.removed, [VAULT_FILENAME])
  assert.ok('holiday-photo.jpg' in dir.store, 'everything else must survive')
})

test('clearing an already-empty folder is not an error', async () => {
  const fs = createFolderStorage(fakeDir(), { drafts: fakeDrafts() })
  await fs.clear()
})

test('drafts stay local rather than going into the shared folder', async () => {
  // A half-typed entry is scratch. Syncing it would push keystrokes into a
  // folder someone else may be reading, for no benefit.
  const dir = fakeDir()
  const drafts = fakeDrafts()
  const fs = createFolderStorage(dir, { drafts })

  await fs.saveDraft({ v: 2, wraps: {}, iv: 'x', ct: 'y' })
  assert.equal(Object.keys(dir.store).length, 0, 'nothing may reach the folder')
  assert.ok(await fs.loadDraft(), 'and it is still readable from where it did go')
  await fs.clearDraft()
  assert.equal(await fs.loadDraft(), null)
})

test('the store drives a folder exactly as it drives IndexedDB', async () => {
  // The point of matching the interface: nothing in the state machine changes.
  const dir = fakeDir()
  const storage = createFolderStorage(dir, { drafts: fakeDrafts() })
  const store = createVaultStore({ storage, now: () => 1_000_000 })

  assert.equal(await store.init(), 'absent')
  await store.create(PASS)
  await store.add({ label: 'Email', pw: 'hunter2!' })
  store.lock()

  // A second store over the same folder is what another device looks like --
  // or the same one tomorrow.
  const second = createVaultStore({ storage: createFolderStorage(dir, { drafts: fakeDrafts() }), now: () => 1_000_000 })
  assert.equal(await second.init(), 'locked')
  await second.unlock(PASS)
  assert.equal(second.list()[0].label, 'Email')
})

test('two devices sharing a folder keep each other\'s work', async () => {
  // This test used to assert the opposite, and said so: "B is lost today --
  // when this assertion starts failing, read-merge-write works". It started
  // failing. save() no longer overwrites; it reads what is in the folder,
  // merges, and writes the result.
  const clock = fakeClock()
  const dir = fakeDir()
  const mk = () => createVaultStore({
    storage: createFolderStorage(dir, { drafts: fakeDrafts() }),
    now: clock.now,
  })

  const a = mk()
  await a.init()
  await a.create(PASS)
  await a.add({ label: 'From A', pw: 'aaa' })

  const b = mk()
  await b.init()
  await b.unlock(PASS)
  clock.advance(1000)
  await b.add({ label: 'From B', pw: 'bbb' })

  // A saves again, knowing nothing of B until it looks.
  clock.advance(1000)
  await a.add({ label: 'Also A', pw: 'ccc' })

  const fresh = mk()
  await fresh.init()
  await fresh.unlock(PASS)
  assert.deepEqual(fresh.list().map((e) => e.label).sort(),
    ['Also A', 'From A', 'From B'])
})

test('a deletion on one device is not resurrected by the other', async () => {
  // The failure the tombstones were built for, and the one that matters most:
  // a merge that only ever adds brings back the entry someone most wanted
  // gone. It has to survive a peer that still holds the entry and saves after.
  const clock = fakeClock()
  const dir = fakeDir()
  const mk = () => createVaultStore({
    storage: createFolderStorage(dir, { drafts: fakeDrafts() }),
    now: clock.now,
  })

  const a = mk()
  await a.init()
  await a.create(PASS)
  const doomed = await a.add({ label: 'Old account', pw: 'aaa' })

  // B reads the vault WITH the entry in it, then A deletes it.
  const b = mk()
  await b.init()
  await b.unlock(PASS)
  assert.equal(b.list().length, 1)

  clock.advance(1000)
  await a.remove(doomed.id)

  // B now saves something unrelated, still holding its stale copy.
  clock.advance(1000)
  await b.add({ label: 'Something else', pw: 'bbb' })

  const fresh = mk()
  await fresh.init()
  await fresh.unlock(PASS)
  assert.deepEqual(fresh.list().map((e) => e.label), ['Something else'],
    'the deleted entry must stay deleted')
})

test('the newer edit of the same entry wins, whichever device made it', async () => {
  const clock = fakeClock()
  const dir = fakeDir()
  const mk = () => createVaultStore({
    storage: createFolderStorage(dir, { drafts: fakeDrafts() }),
    now: clock.now,
  })

  const a = mk()
  await a.init()
  await a.create(PASS)
  const entry = await a.add({ label: 'Bank', pw: 'first' })

  const b = mk()
  await b.init()
  await b.unlock(PASS)

  clock.advance(1000)
  await a.update(entry.id, { pw: 'from-A' })
  clock.advance(1000)
  await b.update(entry.id, { pw: 'from-B-later' })

  const fresh = mk()
  await fresh.init()
  await fresh.unlock(PASS)
  assert.equal(fresh.list()[0].pw, 'from-B-later')
  assert.equal(fresh.list().length, 1, 'one entry, not two copies of it')
})

test('a peer re-keyed to a new passphrase stops the save rather than erasing it', async () => {
  // The one case where merging is impossible and overwriting is unforgivable.
  // A re-key makes a new master key, so the peer's file will not open with the
  // one in memory -- GCM authenticates, so this fails loudly rather than
  // decrypting to rubbish. Someone deliberately set that passphrase.
  const clock = fakeClock()
  const dir = fakeDir()
  const mk = () => createVaultStore({
    storage: createFolderStorage(dir, { drafts: fakeDrafts() }),
    now: clock.now,
  })

  const a = mk()
  await a.init()
  await a.create(PASS)
  await a.add({ label: 'Bank', pw: 'aaa' })

  const b = mk()
  await b.init()
  await b.unlock(PASS)
  clock.advance(1000)
  await b.rekey(PASS, 'an entirely different passphrase')

  clock.advance(1000)
  await assert.rejects(() => a.add({ label: 'Late', pw: 'bbb' }), /different passphrase/)

  // And B's vault is still there, opening with the passphrase B set.
  const fresh = mk()
  await fresh.init()
  await fresh.unlock('an entirely different passphrase')
  assert.deepEqual(fresh.list().map((e) => e.label), ['Bank'])
})

test('a save with no peer write does not re-read and merge for nothing', async () => {
  // The merge costs a read and a decrypt. One device editing its own vault --
  // which is most of the time -- must not pay for it on every keystroke-sized
  // save, so an unchanged ciphertext short-circuits.
  const dir = fakeDir()
  const storage = createFolderStorage(dir, { drafts: fakeDrafts() })
  let loads = 0
  const counted = { ...storage, load: async () => { loads++; return storage.load() } }

  const store = createVaultStore({ storage: counted, now: () => 1_000_000 })
  await store.init()
  await store.create(PASS)
  const before = loads
  await store.add({ label: 'A', pw: 'x' })
  await store.add({ label: 'B', pw: 'y' })
  await store.add({ label: 'C', pw: 'z' })
  assert.equal(loads - before, 3, 'one look per save, and no more')
})

test('reload re-reads after the storage underneath changes', async () => {
  // init() returns early once it has run, which is right for a page load and
  // wrong when the vault moves to a different backend mid-session. Without
  // reload the UI sat on "create a vault" until the page was navigated away
  // from and back, because only a fresh store ever re-read.
  const dir = fakeDir()
  const folder = createFolderStorage(dir, { drafts: fakeDrafts() })

  // Put a vault in the folder using one store...
  const first = createVaultStore({ storage: folder, now: () => 1_000_000 })
  await first.init()
  await first.create(PASS)
  await first.add({ label: 'Email', pw: 'hunter2!' })

  // ...and point a second store at local storage, then switch it to the folder.
  let backing = { load: async () => null, save: async () => {}, clear: async () => {},
    loadDraft: async () => null, saveDraft: async () => {}, clearDraft: async () => {} }
  const proxy = {
    load: () => backing.load(), save: (e) => backing.save(e), clear: () => backing.clear(),
    loadDraft: () => backing.loadDraft(), saveDraft: (s) => backing.saveDraft(s),
    clearDraft: () => backing.clearDraft(),
  }
  const second = createVaultStore({ storage: proxy, now: () => 1_000_000 })
  assert.equal(await second.init(), 'absent')

  backing = folder
  assert.equal(await second.init(), 'absent', 'init alone cannot see the change -- this is the bug')
  assert.equal(await second.reload(), 'locked', 'reload does')
  await second.unlock(PASS)
  assert.equal(second.list()[0].label, 'Email')
})

test('reload drops the key, because it may be a different vault', async () => {
  // Carrying a key or a decrypted entry list across a location change is how
  // one vault's contents end up displayed under another's name.
  const dir = fakeDir()
  const store = createVaultStore({
    storage: createFolderStorage(dir, { drafts: fakeDrafts() }),
    now: () => 1_000_000,
  })
  await store.init()
  await store.create(PASS)
  await store.add({ label: 'Email', pw: 'hunter2!' })
  assert.equal(store.state(), 'unlocked')

  await store.reload()
  assert.equal(store.state(), 'locked')
  assert.throws(() => store.list(), /locked/)
})

test('an entry changed on the other device while open stops the save', async () => {
  // Reported from two browsers, and the exact sequence is the test:
  //   Chrome opens the edit box
  //   Edge  opens the edit box, saves a new password
  //   Chrome saves a new password
  // Chrome used to win on a fresher timestamp and Edge's password vanished --
  // last-write-wins, where "last" means saved last rather than knew most.
  const clock = fakeClock()
  const dir = fakeDir()
  const mk = () => createVaultStore({
    storage: createFolderStorage(dir, { drafts: fakeDrafts() }),
    now: clock.now,
  })

  const chrome = mk()
  await chrome.init()
  await chrome.create(PASS)
  const made = await chrome.add({ label: 'Bank', pw: 'original' })

  const edge = mk()
  await edge.init()
  await edge.unlock(PASS)

  // Chrome opens the edit box: it now holds this copy of the entry.
  const asChromeLoadedIt = chrome.list().find((e) => e.id === made.id)

  clock.advance(1000)
  await edge.update(made.id, { ...edge.list()[0], pw: 'set-in-edge' })

  clock.advance(1000)
  const err = await chrome.update(made.id, { ...asChromeLoadedIt, pw: 'set-in-chrome' })
    .then(() => null, (e) => e)

  assert.ok(err, 'the save must not go through')
  assert.equal(err.name, 'VaultConflict')
  assert.equal(err.conflict.mine.pw, 'set-in-chrome')
  assert.equal(err.conflict.theirs.pw, 'set-in-edge', 'and it hands back what would have been lost')

  // Nothing was written, so Edge's password is still the one in the folder.
  const fresh = mk()
  await fresh.init()
  await fresh.unlock(PASS)
  assert.equal(fresh.list()[0].pw, 'set-in-edge')
})

test('resolving the conflict writes exactly what was chosen', async () => {
  const clock = fakeClock()
  const dir = fakeDir()
  const mk = () => createVaultStore({
    storage: createFolderStorage(dir, { drafts: fakeDrafts() }),
    now: clock.now,
  })

  const setup = async () => {
    const a = mk(); await a.init()
    if (a.state() === 'absent') await a.create(PASS); else await a.unlock(PASS)
    return a
  }

  const chrome = await setup()
  const made = await chrome.add({ label: 'Bank', pw: 'original' })
  const edge = await setup()
  const asLoaded = chrome.list().find((e) => e.id === made.id)
  clock.advance(1000)
  await edge.update(made.id, { ...edge.list()[0], pw: 'set-in-edge' })
  clock.advance(1000)
  await chrome.update(made.id, { ...asLoaded, pw: 'set-in-chrome' }).catch(() => {})

  // Keep mine: write anyway, now that it has been asked.
  await chrome.update(made.id, { ...asLoaded, pw: 'set-in-chrome' }, { resolve: 'mine' })
  const after = mk(); await after.init(); await after.unlock(PASS)
  assert.equal(after.list()[0].pw, 'set-in-chrome')
  assert.equal(after.list().length, 1, 'and one entry, not two')
})

test('keep theirs takes the peer\'s copy without writing anything', async () => {
  const clock = fakeClock()
  const dir = fakeDir()
  const mk = () => createVaultStore({
    storage: createFolderStorage(dir, { drafts: fakeDrafts() }),
    now: clock.now,
  })

  const chrome = mk(); await chrome.init(); await chrome.create(PASS)
  const made = await chrome.add({ label: 'Bank', pw: 'original' })
  const edge = mk(); await edge.init(); await edge.unlock(PASS)
  clock.advance(1000)
  await edge.update(made.id, { ...edge.list()[0], pw: 'set-in-edge' })

  const writesBefore = dir.writes
  await chrome.refresh()
  assert.equal(chrome.list()[0].pw, 'set-in-edge', 'the stale copy is gone from view')
  assert.equal(dir.writes, writesBefore, 'and nothing was written -- theirs is already there')
})

test('an entry deleted on the other device also stops the save', async () => {
  // Same shape, different loss: saving an edit to something someone deleted
  // would resurrect it, which is the failure tombstones exist to prevent.
  const clock = fakeClock()
  const dir = fakeDir()
  const mk = () => createVaultStore({
    storage: createFolderStorage(dir, { drafts: fakeDrafts() }),
    now: clock.now,
  })

  const chrome = mk(); await chrome.init(); await chrome.create(PASS)
  const made = await chrome.add({ label: 'Bank', pw: 'original' })
  const asLoaded = chrome.list().find((e) => e.id === made.id)

  const edge = mk(); await edge.init(); await edge.unlock(PASS)
  clock.advance(1000)
  await edge.remove(made.id)

  clock.advance(1000)
  const err = await chrome.update(made.id, { ...asLoaded, pw: 'edited' }).then(() => null, (e) => e)
  assert.equal(err && err.name, 'VaultConflict')
  assert.ok(err.conflict.theirs.deletedAt, 'their side is a tombstone, and the UI can say so')
})

test('editing different entries on two devices is not a conflict', async () => {
  // The check has to be narrow, or two people working in the same vault would
  // interrupt each other constantly for no reason.
  const clock = fakeClock()
  const dir = fakeDir()
  const mk = () => createVaultStore({
    storage: createFolderStorage(dir, { drafts: fakeDrafts() }),
    now: clock.now,
  })

  const chrome = mk(); await chrome.init(); await chrome.create(PASS)
  const bank = await chrome.add({ label: 'Bank', pw: 'b' })
  const mail = await chrome.add({ label: 'Mail', pw: 'm' })
  const asLoaded = chrome.list().find((e) => e.id === bank.id)

  const edge = mk(); await edge.init(); await edge.unlock(PASS)
  clock.advance(1000)
  await edge.update(mail.id, { ...edge.list().find((e) => e.id === mail.id), pw: 'm2' })

  clock.advance(1000)
  await chrome.update(bank.id, { ...asLoaded, pw: 'b2' })

  const fresh = mk(); await fresh.init(); await fresh.unlock(PASS)
  const by = Object.fromEntries(fresh.list().map((e) => [e.label, e.pw]))
  assert.deepEqual(by, { Bank: 'b2', Mail: 'm2' })
})
