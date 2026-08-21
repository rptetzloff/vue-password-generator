// Vault settings and device identity -- the three things the store used to
// read out of the browser itself.
//
// The state machine always injected its storage, clock and session; these
// three were exports that reached for localStorage and navigator directly,
// and they are what kept vault-store.js out of core/. They are settings and
// identity rather than state, so they live on this side of the line and the
// store takes their results as arguments.

import { DEFAULT_AUTOLOCK_MS, deviceNameFrom, newVaultId } from '../core/vault/store.js'
import * as realSession from './vault-session.js'

export const VAULT_LOCK_KEY = 'global.vaultAutoLock'

/** The configured window, in ms. Shared by the generator and the vault page. */
export const vaultLockMs = () => {
  try {
    const v = JSON.parse(localStorage.getItem(VAULT_LOCK_KEY))
    return Number.isFinite(v) && v >= 0 ? v : DEFAULT_AUTOLOCK_MS
  } catch { return DEFAULT_AUTOLOCK_MS }
}

/**
 * The settings-panel row for the lock window, so the generator page and the
 * vault page offer the identical control rather than two that can drift.
 *
 * "Every page" is 0: the vault holds nothing between page loads and the
 * passphrase is asked for each time, which is where this started before
 * anyone complained about it. It is kept because it is the only setting that
 * leaves the key non-extractable, and some people will want that.
 */
export const vaultLockSection = () => ({
  label: 'Vault lock',
  options: [
    { value: 0, label: 'Every page' },
    { value: 60_000, label: '1 min' },
    { value: 5 * 60_000, label: '5 min' },
    { value: DEFAULT_AUTOLOCK_MS, label: '15 min' },
    { value: 60 * 60_000, label: '1 hour' },
  ],
  get: () => vaultLockMs(),
  set: (v) => {
    const ms = Number(v)
    try { localStorage.setItem(VAULT_LOCK_KEY, JSON.stringify(ms)) } catch {}
    // Tightening takes effect at once; a longer window only applies to the
    // next unlock, since the running store captured the old one. Turning it
    // off must not wait for a reload -- that is the security-relevant
    // direction, so the held key goes immediately.
    if (!ms) realSession.forgetSession()
  },
})
export const DEVICE_KEY = 'global.vaultDevice'

/**
 * A stable id for THIS browser, recorded in the vault as lastWriter.
 *
 * Not in the payload the way vaultId is -- it identifies the client, not the
 * vault, so it lives locally and is stamped into each write. It exists so a
 * merge can say which replica a change came from, and so an unexpected writer
 * is visible rather than silent. Nothing depends on it being unforgeable; it
 * is a label, not a credential.
 */
export const localDeviceId = () => {
  try {
    let id = localStorage.getItem(DEVICE_KEY)
    if (!id) {
      id = newVaultId()
      localStorage.setItem(DEVICE_KEY, id)
    }
    return id
  } catch {
    // No localStorage (node, or a locked-down browser). An unstable id is
    // still better than a crash: it degrades the label, nothing else.
    return 'unknown-device'
  }
}
export const localDeviceName = () => deviceNameFrom(
  typeof navigator !== 'undefined' ? navigator.userAgent : '',
)
