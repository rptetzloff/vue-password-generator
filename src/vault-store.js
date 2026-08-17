// The browser's wiring for the vault store.
//
// The state machine itself is core/vault/store.js and names no browser API:
// storage is required, the session holder defaults to one that holds nothing,
// and the device id and name default to "unknown". That is what let it move
// into core/, and it would be undone by giving those defaults back.
//
// So the defaults live here instead, one level up, where IndexedDB and
// navigator are ordinary things to mention. Both apps construct through this
// and pass only what they actually vary -- the lock windows -- which is why
// neither call site changed when the split happened.

import { createVaultStore as createCoreVaultStore } from '../core/vault/store.js'
import { indexedDbStorage } from './vault-idb.js'
import * as session from './vault-session.js'
import { localDeviceId, localDeviceName } from './vault-settings.js'

/**
 * A vault store wired to this browser.
 *
 * Anything passed in wins, so a caller can still substitute a storage adapter
 * -- which is exactly what the folder-storage path does when the vault lives
 * in a directory rather than in IndexedDB.
 */
export const createVaultStore = (opts = {}) => createCoreVaultStore({
  storage: indexedDbStorage,
  session,
  deviceId: localDeviceId(),
  deviceName: localDeviceName(),
  ...opts,
})
