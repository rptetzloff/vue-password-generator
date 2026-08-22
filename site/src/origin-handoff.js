// Carrying a vault across an origin change (ROADMAP 11).
//
// localStorage and IndexedDB are scoped to an origin. Moving the app from
// wordlock.net to app.wordlock.net therefore strands every existing vault and
// every saved setting on the old host -- not deleted, not visible, just
// somewhere the new app cannot reach. For a password manager that is the worst
// possible way to move house.
//
// So the old origin serves a page that hands its own storage over, once, to a
// window it opens on the new one. ~~To a parent frame on the new one.~~ That
// was the plan and the CSP forbids it -- see READY at the bottom for why the
// direction reversed. Two things make this safe enough to do at all:
//
//   1. The vault is ONE sealed envelope in ONE IndexedDB record, so this is a
//      single JSON blob rather than a schema migration.
//   2. That envelope is ciphertext. It crosses the origin boundary as bytes
//      nobody can read without the passphrase, which is not travelling with
//      it. The worst case for an interception is possession of something
//      already sitting in the user's own browser.
//
// WHAT DELIBERATELY DOES NOT TRAVEL: the between-pages session key. It is a
// wrapped key with a live window, and re-typing a passphrase once is a small
// price against handing a usable key to a frame. The new origin starts locked.
//
// Everything here is pure or takes its storage as an argument, so the whole
// protocol is testable in node -- which matters more than usual, because the
// failure mode is silent and the thing being moved is irreplaceable.

/**
 * The settings worth carrying, by exact key.
 *
 * An allow-list rather than "everything in localStorage", because the point is
 * to move what a person chose, not whatever happens to be lying around. Two
 * kinds: the global preferences, and every per-generator setting, which are
 * namespaced by mode prefix and cannot be enumerated in advance.
 */
export const GLOBAL_KEYS = [
  'global.theme',
  'global.palette',
  'global.fontScale',
  'global.clipboardClear',
  'global.vaultAutoLock',
]

/**
 * Namespaced settings, by prefix. The seven generator modes carry their own
 * configuration and history -- `words.separator`, `adv.activeSymbols` -- and
 * the vault page keeps its view preferences under `vault.`.
 *
 * ~~`numbers`, and four `global.vault*` keys.~~ Written from memory and five of
 * the nine were wrong: the mode prefix is `nums`, and the vault's preferences
 * are `vault.genMode`, `vault.grouping`, `vault.sort` and
 * `vault.collapsedGroups` rather than anything under `global.`. Every one
 * would have been dropped in silence, which is the exact failure this module
 * exists to prevent -- and the tests passed, because they checked the list
 * against itself. `test/origin-handoff.test.js` now derives the truth from
 * the source instead.
 */
export const PREFIXES = ['simple', 'adv', 'words', 'phrase', 'wifi', 'madlib', 'nums', 'vault']

/**
 * `global.vaultDevice` is NOT carried, on purpose.
 *
 * It is the replica label a merge uses to say which device a change came from.
 * The new origin is, for every purpose that matters to a merge, a different
 * install -- and duplicating the id would make two replicas claim to be one,
 * which is precisely the confusion the id exists to prevent.
 */
export const NOT_CARRIED = ['global.vaultDevice']

/** Does this key belong to the set we carry? */
export const isCarried = (key) => {
  if (typeof key !== 'string' || !key) return false
  if (NOT_CARRIED.includes(key)) return false
  if (GLOBAL_KEYS.includes(key)) return true
  return PREFIXES.some((p) => key.startsWith(`${p}.`))
}

/** Everything worth carrying, read out of a storage-like object. */
export const collectSettings = (store) => {
  const out = {}
  for (let i = 0; i < store.length; i++) {
    const key = store.key(i)
    if (!isCarried(key)) continue
    const value = store.getItem(key)
    if (value !== null) out[key] = value
  }
  return out
}

/**
 * Whether the new origin should accept a handoff at all.
 *
 * Never over the top of a vault that already exists here. Someone who created
 * a vault on the new origin before the old one handed over has made a choice,
 * and silently replacing it with an older one would be the single most
 * destructive thing this module could do. Once only, too -- a second handoff
 * would resurrect settings the user has since changed.
 */
export const shouldAccept = ({ alreadyMigrated, hasLocalVault }) =>
  !alreadyMigrated && !hasLocalVault

/**
 * Is this message a handoff we asked for, from the origin we asked?
 *
 * Both halves matter. Any page may frame any other and any frame may post to
 * its parent, so an unchecked listener is a way for an arbitrary site to seed
 * a vault. The origin comparison is exact -- no suffix matching, since
 * `evilwordlock.net` ends with the same letters as the real one.
 */
export const isHandoff = (event, expectedOrigin) => {
  if (!event || event.origin !== expectedOrigin) return false
  const d = event.data
  if (!d || typeof d !== 'object' || d.kind !== 'wordlock-handoff') return false
  if (d.settings !== undefined && (typeof d.settings !== 'object' || d.settings === null)) return false
  if (d.envelope !== undefined && d.envelope !== null && typeof d.envelope !== 'object') return false
  return true
}

/**
 * Apply a handoff. Returns what was taken, so the caller can say so.
 *
 * Settings are written individually rather than as a blob: the values are
 * already JSON strings as localStorage holds them, and re-parsing them here
 * would mean this module knowing the shape of every setting in the product.
 */
export const applyHandoff = async ({ settings = {}, envelope = null }, { store, saveEnvelope }) => {
  let written = 0
  for (const [key, value] of Object.entries(settings)) {
    if (!isCarried(key) || typeof value !== 'string') continue
    try { store.setItem(key, value); written++ } catch { /* quota, or storage off */ }
  }
  let vault = false
  if (envelope && saveEnvelope) {
    await saveEnvelope(envelope)
    vault = true
  }
  return { settings: written, vault }
}

/**
 * The kind field on the readiness signal the receiving window sends first.
 *
 * ~~The app iframes the old origin and pulls.~~ It cannot: the site sends
 * `frame-ancestors 'none'`, and carving an exception for one page would put
 * two Content-Security-Policy rules on one request -- the coin flip this
 * project measured on /vendor/* and banned.
 *
 * So the direction is reversed. The OLD origin opens the new one with
 * window.open and pushes, which frame-ancestors does not govern, so no header
 * changes at all. It is also the more honest behaviour: a password manager
 * quietly moving a vault between origins on page load is a worse thing to do
 * than a button that says what it is about to do.
 *
 * The opened window signals when it is listening, because there is no way to
 * know from outside when a page has finished loading its modules. Push-then-
 * hope loses the message if it arrives first.
 */
export const READY = 'wordlock-handoff-ready'

/**
 * Is this the opened window telling us it is ready to receive?
 *
 * Same exactness as isHandoff, for the same reason and in the other direction:
 * whoever answers this gets handed a vault.
 */
export const isReadySignal = (event, expectedOrigin) => {
  if (!event || event.origin !== expectedOrigin) return false
  const d = event.data
  return !!d && typeof d === 'object' && d.kind === READY
}
