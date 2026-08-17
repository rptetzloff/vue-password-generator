import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import {
  GLOBAL_KEYS, PREFIXES, NOT_CARRIED,
  isCarried, collectSettings, shouldAccept, isHandoff, applyHandoff,
} from '../src/origin-handoff.js'

// The origin handoff moves a vault and its settings from wordlock.net to
// app.wordlock.net once. Its failure mode is silence -- nothing throws when a
// key is missed, and the thing being moved cannot be regenerated -- so the
// protocol is pure and tested here rather than discovered in a browser.

const fakeStore = (seed = {}) => {
  const map = new Map(Object.entries(seed))
  return {
    get length () { return map.size },
    key: (i) => [...map.keys()][i] ?? null,
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    all: () => Object.fromEntries(map),
  }
}

test('the carried set is the preferences and the per-generator settings', () => {
  for (const k of GLOBAL_KEYS) assert.equal(isCarried(k), true, `${k} should be carried`)
  for (const p of PREFIXES) assert.equal(isCarried(`${p}.separator`), true)
  assert.equal(isCarried('words.activeLeet'), true)
})

test('the device id is deliberately left behind', () => {
  // Two replicas claiming the same device id is the confusion the id exists to
  // prevent, and the new origin is a different install for every purpose a
  // merge cares about.
  assert.deepEqual(NOT_CARRIED, ['global.vaultDevice'])
  assert.equal(isCarried('global.vaultDevice'), false)
})

test('nothing outside the allow-list travels', () => {
  // An allow-list, not "everything in localStorage" -- the point is to move
  // what a person chose, not whatever another script left lying around.
  assert.equal(isCarried('some-other-app.token'), false)
  assert.equal(isCarried('globalXtheme'), false, 'a near-miss on a global key')
  assert.equal(isCarried('wordsy.separator'), false, 'a near-miss on a mode prefix')
  assert.equal(isCarried(''), false)
  assert.equal(isCarried(null), false)
  assert.equal(isCarried(undefined), false)
})

test('collectSettings takes the carried keys and leaves the rest', () => {
  const store = fakeStore({
    'global.theme': '"dark"',
    'global.vaultDevice': 'abc-123',
    'words.separator': '"-"',
    'analytics.session': 'nope',
  })
  assert.deepEqual(collectSettings(store), {
    'global.theme': '"dark"',
    'words.separator': '"-"',
  })
})

test('a handoff is refused over an existing vault, and refused twice', () => {
  assert.equal(shouldAccept({ alreadyMigrated: false, hasLocalVault: false }), true)
  // The destructive case: someone made a vault here before the old origin
  // handed over. Replacing it with an older one is the worst thing this can do.
  assert.equal(shouldAccept({ alreadyMigrated: false, hasLocalVault: true }), false)
  // And a second handoff would resurrect settings since changed.
  assert.equal(shouldAccept({ alreadyMigrated: true, hasLocalVault: false }), false)
  assert.equal(shouldAccept({ alreadyMigrated: true, hasLocalVault: true }), false)
})

test('a message from the wrong origin is not a handoff', () => {
  const good = { origin: 'https://wordlock.net', data: { kind: 'wordlock-handoff', settings: {} } }
  assert.equal(isHandoff(good, 'https://wordlock.net'), true)

  // Any page can frame any other and post to its parent, so this is the check
  // that stops an arbitrary site seeding a vault.
  assert.equal(isHandoff({ ...good, origin: 'https://evil.example' }, 'https://wordlock.net'), false)
  // Exact match, not a suffix: evilwordlock.net ends with the same letters.
  assert.equal(isHandoff({ ...good, origin: 'https://evilwordlock.net' }, 'https://wordlock.net'), false)
  assert.equal(isHandoff({ ...good, origin: 'http://wordlock.net' }, 'https://wordlock.net'), false,
    'scheme is part of the origin')
})

test('a message of the wrong shape is not a handoff', () => {
  const o = 'https://wordlock.net'
  assert.equal(isHandoff({ origin: o, data: null }, o), false)
  assert.equal(isHandoff({ origin: o, data: 'wordlock-handoff' }, o), false)
  assert.equal(isHandoff({ origin: o, data: { kind: 'something-else' } }, o), false)
  assert.equal(isHandoff({ origin: o, data: { kind: 'wordlock-handoff', settings: 'no' } }, o), false)
  assert.equal(isHandoff({ origin: o, data: { kind: 'wordlock-handoff', envelope: 'no' } }, o), false)
  assert.equal(isHandoff(null, o), false)
})

test('applying a handoff writes the settings and the envelope', async () => {
  const store = fakeStore()
  let saved = null
  const result = await applyHandoff(
    {
      settings: { 'global.theme': '"dark"', 'words.separator': '"-"' },
      envelope: { v: 2, wraps: { passphrase: {} }, ct: 'AAAA' },
    },
    { store, saveEnvelope: async (e) => { saved = e } },
  )

  assert.deepEqual(result, { settings: 2, vault: true })
  assert.equal(store.getItem('global.theme'), '"dark"')
  assert.equal(saved.v, 2, 'the envelope is handed over as-is')
})

test('applying a handoff re-filters, rather than trusting the sender', async () => {
  // isHandoff proves the message came from the right origin. It does not prove
  // the payload is well-behaved, and the sender is a page that could itself be
  // compromised. The allow-list runs on both ends.
  const store = fakeStore()
  const result = await applyHandoff(
    {
      settings: {
        'global.theme': '"dark"',
        'global.vaultDevice': 'should-not-travel',
        'evil.key': 'nope',
        'words.separator': 42,
      },
    },
    { store },
  )

  assert.equal(result.settings, 1, 'only the one legitimate string setting')
  assert.equal(store.getItem('global.vaultDevice'), null)
  assert.equal(store.getItem('evil.key'), null)
  assert.equal(store.getItem('words.separator'), null, 'a non-string value is not written')
})

test('a handoff with no vault still carries the settings', async () => {
  // Someone who used the generator and never made a vault: their history and
  // their configuration are the whole of what they would lose.
  const store = fakeStore()
  const result = await applyHandoff(
    { settings: { 'global.fontScale': '1.25' }, envelope: null },
    { store, saveEnvelope: async () => assert.fail('must not be called') },
  )
  assert.deepEqual(result, { settings: 1, vault: false })
  assert.equal(store.getItem('global.fontScale'), '1.25')
})

test('the session key is not in the carried set', () => {
  // Deliberate: it is a wrapped key with a live window. The new origin starts
  // locked and the passphrase is typed once, which is the cheaper mistake.
  const anySessionKey = [...GLOBAL_KEYS].some((k) => /session/i.test(k))
  assert.equal(anySessionKey, false)
  assert.equal(isCarried('global.vaultSession'), false)
})

test('the carried set is answerable to the source, not to itself', () => {
  // The test that was missing, and its absence cost five keys.
  //
  // The first version of GLOBAL_KEYS and the prefix list was written from
  // memory: `numbers` for the mode prefix (it is `nums`), and four
  // `global.vault*` keys for settings that actually live under `vault.`. Every
  // one would have been silently dropped by a migration whose entire purpose
  // is not silently dropping things -- and every test passed, because they
  // compared the list against itself.
  //
  // So this reads the real constants and the real mode prefixes out of the
  // source and asserts the allow-list covers them. It fails when a setting is
  // added and nobody thinks about the handoff, which is the realistic way this
  // breaks from here.
  const root = new URL('../', import.meta.url)
  const read = (p) => fs.readFileSync(new URL(p, root), 'utf8')

  const declared = []
  for (const f of ['src/theme.js', 'src/clipboard-clear.js', 'src/vault-settings.js',
    'src/vault-app.js', 'src/main.js', 'core/vault/store.js']) {
    for (const m of read(f).matchAll(/[A-Z_]*KEY\s*=\s*'([^']+)'/g)) declared.push(m[1])
  }
  assert.ok(declared.length >= 8, `only found ${declared.length} key constants to check against`)

  for (const key of new Set(declared)) {
    assert.equal(isCarried(key) || NOT_CARRIED.includes(key), true,
      `${key} is a real setting key that the handoff neither carries nor excludes. `
      + 'Add it to GLOBAL_KEYS, or to NOT_CARRIED with a reason.')
  }

  // And every generator mode's prefix must be covered.
  for (const m of read('core/generate/generators.js').matchAll(/prefix:\s*'([a-z]+)'/g)) {
    assert.ok(PREFIXES.includes(m[1]),
      `generator prefix "${m[1]}" is not in PREFIXES, so that mode's settings would not travel`)
  }
})
