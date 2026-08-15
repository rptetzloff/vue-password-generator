import test from 'node:test'
import assert from 'node:assert/strict'
import {
  resolveLocation, moveVaultToFolder, moveVaultToLocal, openVaultInFolder, releaseFolder,
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
    async * keys () { yield * Object.keys(store) },
  }
}

const fakeLocal = (envelope = null, draft = null) => {
  let held = envelope
  let scratch = draft
  return {
    cleared: 0,
    load: async () => held,
    save: async (e) => { held = e },
    async clear () { held = null; this.cleared++ },
    loadDraft: async () => scratch,
    saveDraft: async (d) => { scratch = d },
    clearDraft: async () => { scratch = null },
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

test('opening a vault that is already in a folder writes nothing', async () => {
  // The second-machine case, and the point of mode 2: a fresh browser pointed
  // at the folder your other computer syncs finds the vault already there.
  const envelope = await anEnvelope()
  const before = JSON.stringify(envelope)
  const dir = fakeDir({ [VAULT_FILENAME]: before })
  const local = fakeLocal(null)
  let remembered = null

  const at = await openVaultInFolder(dir, { local, remember: async (d) => { remembered = d } })
  assert.equal(at.kind, 'folder')
  assert.equal(remembered, dir)
  assert.equal(dir.store[VAULT_FILENAME], before, 'the folder copy is untouched')
  assert.equal(await local.load(), null, 'and nothing was written here either')
})

test('opening a folder with no vault says what it looked for and what is there', async () => {
  // "There is no vault in that folder" is useless when the folder plainly has
  // things in it and the real problem is a name. That is not hypothetical: the
  // file was renamed from vault.wrlck to wordlock-vault.json, and the very
  // next attempt to open an existing folder reported it as empty.
  const local = fakeLocal(null)
  await assert.rejects(
    () => openVaultInFolder(fakeDir(), { local, remember: async () => {} }),
    /no wordlock-vault[.]json in "Vault"[\s\S]*appears to be empty/,
  )
  await assert.rejects(
    () => openVaultInFolder(fakeDir({ 'notes.txt': 'x', 'holiday.jpg': 'y' }), { local, remember: async () => {} }),
    /contains: notes[.]txt, holiday[.]jpg/,
  )
})

test('a folder written by the previous build still opens', async () => {
  // The rename cost nothing because nothing had shipped, but a folder written
  // half an hour earlier still had the old name in it. Read, never written,
  // and gone from the folder on the next save.
  const envelope = await anEnvelope()
  const dir = fakeDir({ 'vault.wrlck': JSON.stringify(envelope) })
  const local = fakeLocal(null)
  const at = await openVaultInFolder(dir, { local, remember: async () => {} })
  assert.equal(at.kind, 'folder')
  assert.deepEqual(await at.storage.load(), envelope)
})

test('opening refuses to orphan the vault already in this browser', async () => {
  // Switching away would leave it in IndexedDB, unreachable through the UI and
  // invisible until someone switches back -- and if they never do, it is lost.
  const dir = fakeDir({ [VAULT_FILENAME]: JSON.stringify(await anEnvelope()) })
  const local = fakeLocal(await anEnvelope())
  let remembered = null
  await assert.rejects(
    () => openVaultInFolder(dir, { local, remember: async (d) => { remembered = d } }),
    /already holds its own vault/,
  )
  assert.equal(remembered, null, 'and the location was not changed')
  assert.ok(await local.load(), 'nor was the local vault touched')
})

test('open and move are opposites, which is why they are separate calls', async () => {
  // Move requires an empty folder and writes; open requires a full one and
  // does not. One function whose destructive behaviour depended on what it
  // happened to find would be the worst of both.
  const full = () => fakeDir({ [VAULT_FILENAME]: '{"v":2,"wraps":{"passphrase":{"kdf":{},"iv":"x","key":"y"}},"iv":"a","ct":"b"}' })
  const empty = () => fakeDir()
  const noop = async () => {}

  await assert.rejects(() => moveVaultToFolder(full(), { from: fakeLocal(null), remember: noop }), /already holds/)
  await assert.rejects(() => openVaultInFolder(empty(), { local: fakeLocal(null), remember: noop }), /no wordlock-vault/)
})

test('a folder holding an export says so, rather than "no vault"', async () => {
  // The near miss worth naming. Dropping a backup in a folder and pointing at
  // it is a reasonable thing to try, and "there is no vault here" is true and
  // unhelpful -- a backup is restored through Import, not opened in place.
  const local = fakeLocal(null)
  for (const name of [
    'wordlock-vault-2026-08-15.json',
    'wordlock-vault-PLAINTEXT-2026-08-15.json',
    'wordlock-vault-PLAINTEXT-2026-08-15.csv',
  ]) {
    await assert.rejects(
      () => openVaultInFolder(fakeDir({ [name]: 'x' }), { local, remember: async () => {} }),
      /holds an export[\s\S]*not a vault[\s\S]*Import/,
      `${name} should be recognised as an export`,
    )
  }
})

test('the live vault file is not mistaken for an export', async () => {
  // It shares the prefix and differs only by having no date, so the pattern
  // that spots exports must not spot this one.
  const envelope = await anEnvelope()
  const dir = fakeDir({ [VAULT_FILENAME]: JSON.stringify(envelope) })
  const at = await openVaultInFolder(dir, { local: fakeLocal(null), remember: async () => {} })
  assert.equal(at.kind, 'folder')
})


test('deleting the vault lets go of the folder it was in', async () => {
  // Reported from two browsers. Chrome deleted a vault from a shared folder,
  // Edge created a new one in the same folder, and Chrome then announced a
  // vault ready to open -- someone else's, with a passphrase it had never been
  // given. Keeping the pointer after the vault is gone is what did that.
  let saved = { dir: fakeDir(), name: 'Vault' }
  const forget = async () => { saved = null }
  const local = fakeLocal(null)

  const at = await releaseFolder({ to: local, forget })
  assert.equal(saved, null, 'the pointer must be gone')
  assert.equal(at.kind, 'local')
  assert.equal(at.storage, local)
  assert.equal(at.dir, null)
})

test('letting go of a folder is not a move, so it refuses nothing', async () => {
  // moveVaultToLocal declines when this browser already holds a vault, because
  // it would have to overwrite one. There is nothing to copy here, so that
  // refusal would only strand someone with a dead pointer they cannot clear.
  const local = fakeLocal(await anEnvelope())
  await assert.rejects(() => moveVaultToLocal(fakeDir(), { to: local, forget: async () => {} }),
    /already holds a vault/)

  let saved = 'still here'
  const at = await releaseFolder({ to: local, forget: async () => { saved = null } })
  assert.equal(saved, null)
  assert.equal(at.kind, 'local')
})


test('letting go of a folder takes the half-typed entry with it', async () => {
  // The draft is kept locally even for a folder vault -- deliberately, since
  // syncing keystrokes into a shared folder helps nobody. So it is still here
  // after the folder is gone, and it belongs to a vault this browser no longer
  // holds.
  const local = fakeLocal(null, { v: 2, wraps: {}, iv: 'x', ct: 'y' })
  await releaseFolder({ to: local, forget: async () => {} })
  assert.equal(await local.loadDraft(), null)
  assert.equal(local.cleared, 0, 'and clear() was NOT called -- that would take the envelope slot')
})

test('the vault in the folder is not touched by letting go of it', async () => {
  // The whole point. Delete removes the file for everyone sharing the folder;
  // this removes nothing, which is what makes it the safe way off one machine.
  const envelope = await anEnvelope()
  const dir = fakeDir({ [VAULT_FILENAME]: JSON.stringify(envelope) })
  await releaseFolder({ to: fakeLocal(null), forget: async () => {} })
  assert.ok(dir.store[VAULT_FILENAME], 'the file stays')
  assert.deepEqual(JSON.parse(dir.store[VAULT_FILENAME]), envelope, 'byte for byte')
})

test('a draft that will not clear does not block letting go', async () => {
  // Forgetting the pointer is the operation. Refusing to finish because the
  // scratch slot misbehaved would strand someone on the blocked screen, which
  // is the exact state this is the escape from.
  const stubborn = {
    ...fakeLocal(null),
    clearDraft: async () => { throw new Error('storage is unavailable') },
  }
  let saved = 'here'
  const at = await releaseFolder({ to: stubborn, forget: async () => { saved = null } })
  assert.equal(saved, null)
  assert.equal(at.kind, 'local')
})
