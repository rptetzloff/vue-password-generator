// The vault in a folder you chose (ROADMAP 9d, mode 2).
//
// Same six methods as the IndexedDB adapter -- load, save, clear, and the
// three draft ones -- so the store cannot tell the difference. Point this at a
// directory inside Dropbox, OneDrive, iCloud Drive or anything else that
// already syncs, and their client does the moving. No account with us, no
// server of ours, and we never learn which provider it is.
//
// A FOLDER RATHER THAN A FILE, decided before it costs anything to change: a
// vault plus N attachment blobs (10a) cannot be one file, and switching later
// would strand everyone who had already pointed at a file.
//
//   <chosen folder>/
//     vault.wrlck        the sealed envelope, exactly as IndexedDB holds it
//     attachments/       later
//
// WHAT THIS DOES NOT DO YET: reconcile. save() overwrites, which is correct
// for one device and wrong the moment a second one shares the folder -- the
// slower writer silently discards the faster one's work. mergeReplicas and the
// entry model are already built for that; wiring them in is the next step, and
// it changes what saving *means* rather than adding an adapter. Until then
// this is "my vault lives in my Dropbox", which is worth having on its own:
// the backup stops being a thing you remember to do.
//
// Drafts deliberately stay local. A half-typed entry is scratch that must
// survive a navigation and nothing more, and syncing it would push keystrokes
// into a shared folder for no benefit.

import { indexedDbStorage } from './vault-store.js'
import { isVaultEnvelope } from './vault-crypto.js'

export const VAULT_FILENAME = 'vault.wrlck'

/** Whether this browser can do any of it. Chromium desktop, today. */
export const canUseFolder = () =>
  typeof window !== 'undefined' &&
  typeof window.showDirectoryPicker === 'function'

/**
 * Ask for a folder. Must be called from a user gesture, which is a browser
 * rule rather than a choice: a page that could silently open a directory
 * picker could silently read a directory.
 */
export const pickFolder = () => window.showDirectoryPicker({
  id: 'wordlock-vault',
  mode: 'readwrite',
  // Documents rather than Downloads: this is a file someone keeps, and the
  // picker's starting point is the only nudge available.
  startIn: 'documents',
})

/**
 * Whether we may still read and write the folder from an earlier session.
 *
 * Handles survive in IndexedDB but permission does not always survive with
 * them, so this is asked on every load rather than assumed. 'prompt' means a
 * user gesture is needed to get it back; 'denied' means the folder is gone
 * as far as this origin is concerned.
 */
export const folderPermission = async (dir, mode = 'readwrite') => {
  if (!dir || typeof dir.queryPermission !== 'function') return 'denied'
  try { return await dir.queryPermission({ mode }) } catch { return 'denied' }
}

export const requestFolderPermission = async (dir, mode = 'readwrite') => {
  if (!dir || typeof dir.requestPermission !== 'function') return 'denied'
  try { return await dir.requestPermission({ mode }) } catch { return 'denied' }
}

const readTextFile = async (dir, name) => {
  let handle
  try {
    handle = await dir.getFileHandle(name)
  } catch (e) {
    // Missing is a normal answer -- it means no vault has been put here yet.
    // Anything else is not, and swallowing it would look identical.
    if (e && (e.name === 'NotFoundError' || e.code === 8)) return null
    throw e
  }
  const file = await handle.getFile()
  return file.text()
}

/**
 * A storage adapter over a directory handle.
 *
 * @param dir     a FileSystemDirectoryHandle the user has granted readwrite
 * @param drafts  where scratch goes; local by default, and it should stay that
 *                way -- see the note at the top of this file
 */
export const createFolderStorage = (dir, { drafts = indexedDbStorage } = {}) => {
  if (!dir) throw new Error('a folder is required')

  return {
    /**
     * The envelope, or null if this folder has never held one.
     *
     * A file that exists but does not parse THROWS rather than returning
     * null, and the distinction matters more than it looks: null means "no
     * vault here", which the UI answers by offering to create one. Returning
     * null for a corrupt file would offer to create a new vault on top of
     * somebody's real one, and the first save would finish the job.
     */
    async load () {
      const text = await readTextFile(dir, VAULT_FILENAME)
      if (text === null) return null
      let parsed
      try {
        parsed = JSON.parse(text)
      } catch {
        throw new Error(`${VAULT_FILENAME} is in this folder but is not readable as JSON`)
      }
      // Accept the backup wrapper too, since that is what someone is most
      // likely to have copied in by hand.
      const envelope = parsed && parsed.vault ? parsed.vault : parsed
      if (!isVaultEnvelope(envelope)) {
        throw new Error(`${VAULT_FILENAME} is in this folder but is not a WordLock vault`)
      }
      return envelope
    },

    /**
     * Write the envelope.
     *
     * createWritable() writes through a swap file that is moved into place on
     * close(), so an interrupted write leaves the previous vault intact rather
     * than a truncated one. That is the browser's guarantee rather than ours,
     * and it is the reason this does not hand-roll a temp-file dance.
     */
    async save (envelope) {
      const handle = await dir.getFileHandle(VAULT_FILENAME, { create: true })
      const writable = await handle.createWritable()
      try {
        await writable.write(JSON.stringify(envelope, null, 2) + '\n')
      } finally {
        await writable.close()
      }
    },

    /**
     * Remove the vault file, and nothing else.
     *
     * Deliberately not the folder: it is the user's, it may hold anything, and
     * a password manager that deletes directories is one bug away from being
     * a story.
     */
    async clear () {
      try {
        await dir.removeEntry(VAULT_FILENAME)
      } catch (e) {
        if (e && (e.name === 'NotFoundError' || e.code === 8)) return
        throw e
      }
    },

    loadDraft: () => drafts.loadDraft(),
    saveDraft: (sealed) => drafts.saveDraft(sealed),
    clearDraft: () => drafts.clearDraft(),
  }
}
