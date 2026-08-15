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

test('two devices sharing a folder still lose writes, which is the next piece', async () => {
  // Recorded as a failing property rather than left implied. save() overwrites,
  // so the slower writer discards the faster one's work. mergeReplicas exists
  // and is tested; wiring it in changes what saving means, and until then this
  // adapter is for one device.
  const dir = fakeDir()
  const mk = () => createVaultStore({
    storage: createFolderStorage(dir, { drafts: fakeDrafts() }),
    now: () => 1_000_000,
  })

  const a = mk()
  await a.init()
  await a.create(PASS)
  await a.add({ label: 'From A', pw: 'aaa' })

  const b = mk()
  await b.init()
  await b.unlock(PASS)
  await b.add({ label: 'From B', pw: 'bbb' })

  // A saves again, knowing nothing of B.
  await a.add({ label: 'Also A', pw: 'ccc' })

  const fresh = mk()
  await fresh.init()
  await fresh.unlock(PASS)
  const labels = fresh.list().map((e) => e.label).sort()
  assert.ok(!labels.includes('From B'),
    'B is lost today -- when this assertion starts failing, read-merge-write works')
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
