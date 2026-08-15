import test from 'node:test'
import assert from 'node:assert/strict'
import {
  resolveLocation, moveVaultToFolder, moveVaultToLocal,
} from '../src/vault-location.js'
import { VAULT_FILENAME } from '../src/vault-fs.js'
import { createVault } from '../src/vault-crypto.js'

// Moving a vault is the operation with the worst failure mode in the product:
// get it wrong and someone's passwords are gone, with no backup unless they
// happened to make one. So the order is copy, verify, switch, clear -- and
// every step of that order has a test that fails if it is reordered.

const notFound = () => Object.assign(new Error('missing'), { name: 'NotFoundError' })

const fakeDir = (files = {}, permission = 'granted') => {
  const store = { ...files }
  return {
    name: 'Vault',
    store,
    async queryPermission () { return permission },
    async requestPermission () { return permission },
    async getFileHandle (name, opts = {}) {
      if (!(name in store) && !opts.create) throw notFound()
      if (!(name in store)) store[name] = ''
      return {
        async getFile () { return { text: async () => store[name] } },
        async createWritable () {
          let buf = ''
          return {
            async write (c) { buf += c },
            async close () { store[name] = buf },
          }
        },
      }
    },
    async removeEntry (name) {
      if (!(name in store)) throw notFound()
      delete store[name]
    },
  }
}

const fakeLocal = (envelope = null) => {
  let held = envelope
  return {
    cleared: 0,
    load: async () => held,
    save: async (e) => { held = e },
    async clear () { held = null; this.cleared++ },
  }
}

const PASS = 'correct horse battery staple'
const anEnvelope = async () => (await createVault(PASS, [{ id: 'a', label: 'Bank', pw: 'x' }])).envelope

test('no folder configured means this browser, quietly', async () => {
  const local = fakeLocal()
  const at = await resolveLocation({ storage: local, saved: async () => null })
  assert.equal(at.kind, 'local')
  assert.equal(at.storage, local)
})

test('a granted folder resolves to folder storage', async () => {
  const dir = fakeDir({}, 'granted')
  const at = await resolveLocation({ saved: async () => dir })
  assert.equal(at.kind, 'folder')
  assert.equal(at.name, 'Vault')
  assert.ok(at.storage)
})

test('a folder we cannot read is blocked, never absent', async () => {
  // The whole reason this module exists. Falling back to local here would
  // present "no vault found, create one?" -- and someone will say yes, and the
  // first save writes an empty vault over the real one.
  for (const permission of ['prompt', 'denied']) {
    const at = await resolveLocation({ saved: async () => fakeDir({}, permission) })
    assert.equal(at.kind, 'blocked', `${permission} must block`)
    assert.equal(at.storage, null, 'there is nothing safe to hand the store')
    assert.equal(at.permission, permission)
  }
})

test('moving to a folder copies, verifies, then clears', async () => {
  const envelope = await anEnvelope()
  const local = fakeLocal(envelope)
  const dir = fakeDir()
  let remembered = null

  const at = await moveVaultToFolder(dir, { from: local, remember: async (d) => { remembered = d } })

  assert.equal(at.kind, 'folder')
  assert.ok(dir.store[VAULT_FILENAME], 'the vault is in the folder')
  assert.equal(remembered, dir, 'and the location was recorded')
  assert.equal(await local.load(), null, 'and only then was the old copy cleared')
})

test('a folder that already holds a vault is refused, not overwritten', async () => {
  // Two vaults meeting is a merge, and merging is not built. Replacing one
  // with the other is the worst available answer.
  const theirs = await anEnvelope()
  const dir = fakeDir({ [VAULT_FILENAME]: JSON.stringify(theirs) })
  const local = fakeLocal(await anEnvelope())

  await assert.rejects(
    () => moveVaultToFolder(dir, { from: local, remember: async () => {} }),
    /already holds a WordLock vault/,
  )
  assert.ok(await local.load(), 'and ours is untouched')
  assert.deepEqual(JSON.parse(dir.store[VAULT_FILENAME]), theirs, 'as is theirs')
})

test('a folder holding an unreadable file stops the move', async () => {
  // load() throws rather than reporting an empty folder, which is exactly the
  // case where continuing would destroy whatever that file really is.
  const dir = fakeDir({ [VAULT_FILENAME]: 'garbage' })
  const local = fakeLocal(await anEnvelope())
  await assert.rejects(() => moveVaultToFolder(dir, { from: local, remember: async () => {} }))
  assert.ok(await local.load(), 'nothing was moved')
  assert.equal(dir.store[VAULT_FILENAME], 'garbage', 'and nothing was written over')
})

test('a write that does not survive readback changes nothing', async () => {
  // A full disk, a read-only folder, a sync client rejecting the file: all of
  // them look like a successful write until you look again.
  const envelope = await anEnvelope()
  const local = fakeLocal(envelope)
  const dir = fakeDir()
  // Accept the write, then lose it.
  const realGet = dir.getFileHandle.bind(dir)
  dir.getFileHandle = async (name, opts) => {
    const h = await realGet(name, opts)
    const realWritable = h.createWritable.bind(h)
    h.createWritable = async () => {
      const w = await realWritable()
      return { write: w.write, close: async () => { delete dir.store[name] } }
    }
    return h
  }

  await assert.rejects(
    () => moveVaultToFolder(dir, { from: local, remember: async () => {} }),
    /did not survive the copy/,
  )
  assert.ok(await local.load(), 'the original is still there, which is the point')
})

test('an empty vault still switches location', async () => {
  // Someone who has not created a vault yet can still choose where it will go.
  const local = fakeLocal(null)
  const dir = fakeDir()
  let remembered = null
  const at = await moveVaultToFolder(dir, { from: local, remember: async (d) => { remembered = d } })
  assert.equal(at.kind, 'folder')
  assert.equal(remembered, dir)
  assert.equal(dir.store[VAULT_FILENAME], undefined, 'with nothing written, because there is nothing to write')
})

test('moving back to this browser is the same journey in reverse', async () => {
  const envelope = await anEnvelope()
  const dir = fakeDir({ [VAULT_FILENAME]: JSON.stringify(envelope) })
  const local = fakeLocal(null)
  let forgotten = false

  const at = await moveVaultToLocal(dir, { to: local, forget: async () => { forgotten = true } })
  assert.equal(at.kind, 'local')
  assert.ok(forgotten)
  assert.deepEqual(await local.load(), envelope)
  assert.equal(dir.store[VAULT_FILENAME], undefined, 'and the folder copy is gone')
})

test('moving back refuses if this browser already holds a vault', async () => {
  const dir = fakeDir({ [VAULT_FILENAME]: JSON.stringify(await anEnvelope()) })
  const local = fakeLocal(await anEnvelope())
  await assert.rejects(
    () => moveVaultToLocal(dir, { to: local, forget: async () => {} }),
    /already holds a vault/,
  )
  assert.ok(dir.store[VAULT_FILENAME], 'the folder copy stays put')
})
