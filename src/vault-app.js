// The vault page (ROADMAP 9a). A second small Vue app, separate from the
// generator's, because the two share nothing but the design tokens -- and
// main.js is already three thousand lines.
//
// Everything cryptographic lives in vault-crypto.js and everything stateful
// in vault-store.js; this file is the view. It holds the passphrase only for
// the instant it takes to unlock, and never writes it anywhere.

import { createApp, ref, computed, watch, onMounted, onUnmounted, nextTick } from '../vendor/vue.runtime.esm-browser.prod.js'
import { renderApp } from './vault.render.js'
import { createVaultStore } from './vault-store.js'
import { vaultLockMs, vaultLockSection } from './vault-settings.js'
import {
  groupsOf, tagsOf, groupEntries, sortEntries, reuseIndex, SORTS, UNGROUPED
} from '../core/vault/entry.js'
import { MODES, generateWithRetry } from '../core/generate/generators.js'
import { readSettings, loadData, loadWordList } from './generator-io.js'
import { checkRecoveryPhrase, RECOVERY_WORDS } from '../core/vault/recovery-key.js'
import { canUseFolder, pickFolder } from './vault-fs.js'
import { diffEntries, diffHasSecrets, diffHasTotp } from '../core/vault/diff.js'
import { resolveLocation, moveVaultToFolder, moveVaultToLocal, openVaultInFolder, unblockFolder, releaseFolder } from './vault-location.js'
import { scheduleClipboardClear, clipboardClearSection } from './clipboard-clear.js'
import {
  exportBackup, exportPlainJson, exportCsv, parseTransfer, transferFilename,
} from '../core/vault/transfer.js'
import { totpCode, secondsRemaining, formatCode, parseTotpInput } from '../core/totp.js'
import { openVault } from '../core/vault/crypto.js'
import { KDF_ITERATIONS, needsRekey } from '../core/vault/crypto.js'
import { entropyTier } from '../core/generate/entropy.js'
import { estimatePassphrase } from '../core/generate/passphrase-strength.js'
import { initTheme } from './theme.js'
import { mountSiteHeader } from './site-header.js'
import { mountSiteFooter } from './site-footer.js'

const App = {
  setup () {
    const state = ref('loading')
    const entries = ref([])
    const error = ref('')
    const notice = ref('')
    const busy = ref(false)
    const query = ref('')
    const revealed = ref(new Set())
    const editing = ref(null)
    const persisted = ref(null)
    const rekeyOpen = ref(false)
    // Whether anything has been exported this session, for the backup nudge.
    const exported = ref(false)

    // Passphrase fields. Cleared the moment they are used -- a value sitting
    // in a ref is a value in a heap dump.
    const pass = ref('')
    const passConfirm = ref('')
    const oldPass = ref('')
    const newPass = ref('')

    // Where the vault lives. Resolved once on mount, before init, because
    // the store is built synchronously and the answer is not.
    //
    // The store gets a proxy rather than the backend itself, so switching
    // folders later swaps what is underneath without rebuilding the store or
    // reloading the page.
    const vaultLocation = ref({ kind: 'local', name: null })
    const canFolder = canUseFolder()
    let backend = null
    let currentDir = null

    const at = () => {
      if (!backend) throw new Error('the vault location has not been resolved yet')
      return backend
    }
    const lazyStorage = {
      load: () => at().load(),
      save: (e) => at().save(e),
      clear: () => at().clear(),
      loadDraft: () => at().loadDraft(),
      saveDraft: (sealed) => at().saveDraft(sealed),
      clearDraft: () => at().clearDraft(),
    }

    const store = createVaultStore({
      storage: lazyStorage,
      autoLockMs: vaultLockMs(),
      // The same window governs idle auto-lock and staying unlocked between
      // pages, so there is one number for a reader to reason about.
      staySignedInMs: vaultLockMs(),
      onChange: (s) => {
        state.value = s
        entries.value = s === 'unlocked' ? store.list() : []
        // Any exit from unlocked -- the Lock button, the idle timer, deleting
        // the vault -- drops the undo copy. Doing it here rather than in
        // lock() is the difference between covering one path and all of them;
        // the idle timer does not go through lock().
        if (s !== 'unlocked') forgetPending()
        // The envelope is loaded even while locked, so the lock screen can
        // offer recovery only to vaults that actually have a key for it.
        hasRecovery.value = store.hasRecoveryKey()
        // The backup record is inside the vault, so it arrives at unlock and
        // leaves at lock along with everything else it describes.
        readLastExport()
      },
    })

    const clearPass = () => { pass.value = ''; passConfirm.value = ''; oldPass.value = ''; newPass.value = '' }
    const flash = (msg) => { notice.value = msg; setTimeout(() => { notice.value = '' }, 2500) }

    const run = async (fn, failure) => {
      error.value = ''
      // The success notice from the last action lingers for 2.5s. Without
      // clearing it, a failure now shows a green "done" beside a red "did
      // not" -- seen after a bad import landed under a good one.
      notice.value = ''
      busy.value = true
      // Let the button's disabled state paint before a 600k-round derivation
      // blocks the thread, or the UI appears frozen with no explanation.
      await nextTick()
      try {
        await fn()
      } catch (e) {
        const msg = failure || e.message
        // Module-level messages are phrased as clause fragments ("that CSV has
        // no password column"); in a banner they are the whole sentence.
        const s = msg.charAt(0).toUpperCase() + msg.slice(1)
        error.value = /[.!?]$/.test(s) ? s : s + '.'
      } finally {
        busy.value = false
      }
    }

    const create = () => {
      if (pass.value.length < 8) { error.value = 'Use at least 8 characters.'; return }
      // Refused outright rather than merely scored badly. This one passphrase
      // is the only key to everything in the vault, and a password from the
      // first few hundred an attacker tries is not a weak key, it is no key.
      if (newStrength.value?.common) {
        error.value = 'That is one of the passwords attackers try first. Please choose another.'
        return
      }
      if (pass.value !== passConfirm.value) { error.value = 'The two passphrases do not match.'; return }
      return run(async () => {
        await store.create(pass.value)
        clearPass()
        // Ask the browser not to evict the vault under storage pressure. An
        // installed app is usually granted this silently; a tab may not be.
        if (navigator.storage?.persist) {
          try { persisted.value = await navigator.storage.persist() } catch {}
        }
        // Offered here rather than left in settings, because this is the
        // moment someone is thinking about losing access, and nobody goes
        // looking in settings for a feature they do not know exists.
        offerRecovery.value = true
        flash('Vault created.')
      })
    }

    const unlock = () => run(
      async () => {
        await store.unlock(pass.value)
        clearPass()
        // A draft written before the lock window closed is only readable now.
        await restoreDraft()
      },
      'That passphrase did not open the vault.',
    )

    const lock = () => {
      // The undo copy is dropped by the onChange above, which also catches
      // the idle timer -- this path is not the only way out of unlocked.
      store.lock()
      revealed.value = new Set()
      flash('Locked.')
    }

    /**
     * The entry moved underneath this editor while it was open.
     *
     * Held rather than resolved: the two versions are both somebody's
     * deliberate work, and picking one by rule is how a password someone set
     * on another machine disappears without anyone being told. See the note in
     * the store's reconcile() for why the timestamp cannot decide this.
     */
    const conflict = ref(null)

    // The diff itself is pure and lives in vault-diff.js, so the rule it holds
    // -- compare the real values, render the masked ones, never the seed -- is
    // asserted by test rather than by opening the dialog and looking.
    const revealConflict = ref(false)
    const conflictFields = computed(() => (conflict.value
      ? diffEntries(conflict.value.mine, conflict.value.theirs, { reveal: revealConflict.value })
      : []))
    const conflictHasSecrets = computed(() => diffHasSecrets(conflictFields.value))
    const conflictHasTotp = computed(() => diffHasTotp(conflictFields.value))

    // Closing the dialog re-hides. A watcher rather than a line in each of the
    // four exits, because two of the four had already been missed by hand and
    // the failure is a dialog that opens pre-revealed.
    watch(conflict, (open) => { if (!open) revealConflict.value = false })

    const conflictDeleted = computed(() => !!(conflict.value && conflict.value.theirs.deletedAt))

    const save = (entry, resolve = null) => run(async () => {
      const payload = { ...entry }
      // Rows now, not a textarea -- urlList drops any with an empty address.
      delete payload.urlText
      // View state, not entry data -- normalizeEntry would drop it anyway, but
      // sending it at all invites someone to start persisting it.
      delete payload.revealPw
      try {
        if (payload.id) await store.update(payload.id, payload, { resolve })
        else await store.add(payload)
      } catch (e) {
        // Not an error to report and move on from -- it is a question. The
        // editor stays open behind the dialog holding everything that was
        // typed, and the vault is untouched until an answer comes back.
        if (e.name === 'VaultConflict') { conflict.value = e.conflict; return }
        throw e
      }
      conflict.value = null
      entries.value = store.list()
      editing.value = null
      await store.clearDraft()
      flash('Saved.')
    })

    /** Write what was typed here, now that it has been asked about. */
    const keepMine = () => save(editing.value, 'mine')

    /** Take the other device's version and abandon this edit. */
    const keepTheirs = () => run(async () => {
      await store.refresh()
      conflict.value = null
      entries.value = store.list()
      editing.value = null
      await store.clearDraft()
      flash(conflictDeleted.value
        ? 'Kept the deletion. Your changes were not saved.'
        : 'Kept the other version. Your changes were not saved.')
    })

    /**
     * Keep both, as two entries.
     *
     * A new id rather than a second copy of the same one: two entries with one
     * id is not a state the merge can represent, and the next save on either
     * device would silently pick a winner all over again.
     */
    const keepBoth = () => run(async () => {
      const mine = { ...editing.value }
      delete mine.urlText
      delete mine.revealPw
      delete mine.id
      delete mine.updatedAt
      mine.label = `${mine.label || 'Untitled'} (this device)`
      await store.refresh()
      await store.add(mine)
      conflict.value = null
      entries.value = store.list()
      editing.value = null
      await store.clearDraft()
      flash('Kept both. Yours is filed separately — delete whichever is wrong.')
    })

    /**
     * Deleting, with fifteen seconds to change your mind.
     *
     * The deletion itself is NOT deferred. The tombstone is written and on
     * disk before the toast appears, so closing the tab, locking, or losing
     * power leaves the entry deleted -- which is what the word has to mean.
     * What the window buys is an undo, and the undo works by holding the
     * entry in memory and re-adding it (see store.restore).
     *
     * That in-memory copy is a plaintext password living slightly longer than
     * the user asked for, which is why it is fifteen seconds rather than
     * sixty, why "Delete permanently" exists to drop it early, and why
     * locking the vault discards it immediately.
     */
    const UNDO_SECONDS = 15
    const pending = ref(null)
    let undoTimer = null

    const forgetPending = () => {
      if (undoTimer) { clearInterval(undoTimer); undoTimer = null }
      pending.value = null
    }

    const remove = (entry) => run(async () => {
      // Deleting is now reversible for a few seconds, so it no longer needs a
      // modal confirm in front of it -- the undo IS the confirmation, and it
      // does not interrupt anyone who meant it.
      const copy = { ...entry }
      await store.remove(entry.id)
      entries.value = store.list()

      // A second delete while the first toast is up commits the first: two
      // pending undos would need two toasts, and the older secret should not
      // sit in memory waiting for a slot.
      forgetPending()
      pending.value = { entry: copy, label: copy.label || 'that entry', left: UNDO_SECONDS }
      undoTimer = setInterval(() => {
        if (!pending.value) return forgetPending()
        pending.value = { ...pending.value, left: pending.value.left - 1 }
        if (pending.value.left <= 0) forgetPending()
      }, 1000)
    })

    const undoDelete = () => {
      const held = pending.value
      if (!held) return
      forgetPending()
      return run(async () => {
        await store.restore(held.entry)
        entries.value = store.list()
        flash('Restored.')
      })
    }

    /** Drop the in-memory copy now rather than waiting out the countdown. */
    const finishDelete = () => {
      forgetPending()
      flash('Deleted.')
    }

    /**
     * Copy a secret. The wipe timer applies to anything secret, not only the
     * password field -- a security answer left on the clipboard is the same
     * exposure under a different name.
     */
    const copyText = async (value, message = 'Copied.') => {
      try {
        await navigator.clipboard.writeText(value)
        flash(message)
        // The same timer the generator uses; a password copied out of the
        // vault is no less worth wiping than one copied out of the bar.
        scheduleClipboardClear((msg) => flash(msg))
      } catch { error.value = 'The clipboard refused the copy.' }
    }
    const copy = (entry) => copyText(entry.pw)

    /** Show a URL by its host, so a long link does not blow out the row. */
    const hostOf = (url) => {
      try { return new URL(url).host || url } catch { return url }
    }

    /**
     * Reveal state, per secret rather than per entry.
     *
     * It used to be one flag on the entry, so unmasking the password also
     * unmasked every security answer and every secret field at once. Reading
     * one of them out loud should not put the rest on screen -- the whole
     * reason for masking is that someone might be looking.
     *
     * Keys are `<entryId>:<what>`: ":pw", ":f3" for the fourth field, ":q1"
     * for the second answer.
     */
    const secretKey = (entry, what = 'pw') => `${entry.id}:${what}`

    const toggleSecret = (entry, what = 'pw') => {
      const key = secretKey(entry, what)
      const next = new Set(revealed.value)
      next.has(key) ? next.delete(key) : next.add(key)
      revealed.value = next
      store.touch()
    }
    const isRevealed = (entry, what = 'pw') => revealed.value.has(secretKey(entry, what))

    /** Every maskable thing on one entry, for the show-all toggle. */
    const secretsOf = (entry) => [
      'pw',
      ...(entry.fields || []).map((f, i) => (f.secret ? `f${i}` : null)).filter(Boolean),
      ...(entry.questions || []).map((_, i) => `q${i}`),
    ]

    const allRevealed = (entry) =>
      secretsOf(entry).every((what) => revealed.value.has(secretKey(entry, what)))

    const toggleAllSecrets = (entry) => {
      const keys = secretsOf(entry).map((what) => secretKey(entry, what))
      const next = new Set(revealed.value)
      if (allRevealed(entry)) keys.forEach((k) => next.delete(k))
      else keys.forEach((k) => next.add(k))
      revealed.value = next
      store.touch()
    }

    /** Whether the show-all control is worth drawing at all. */
    const hasSeveralSecrets = (entry) => secretsOf(entry).length > 1

    const startAdd = () => {
      editing.value = {
        id: null, label: '', username: '', pw: '', urls: [], note: '',
        // With exactly one group filtered to, a new entry lands in it -- that
        // is nearly always the one intended. With several, guessing would be
        // worse than leaving it blank.
        group: (groupFilter.value.size === 1 && [...groupFilter.value][0] !== UNGROUPED)
          ? [...groupFilter.value][0] : '',
        // Filtered to some tags? The new entry almost certainly wants them.
        tags: [...tagFilter.value],
        questions: [], fields: [], totp: null, bits: null, revealPw: false,
      }
    }
    const startEdit = (entry) => {
      // URLs edit as one-per-line text; questions as a repeatable pair list.
      editing.value = {
        ...entry,
        urls: (entry.urls || []).map((u) => ({ ...u })),
        questions: (entry.questions || []).map((qa) => ({ ...qa })),
        fields: (entry.fields || []).map((f) => ({ ...f })),
        tags: [...(entry.tags || [])],
        totp: entry.totp ? { ...entry.totp } : null,
        revealPw: false,
      }
    }
    // --- the editor dialog -----------------------------------------------------

    const editorEl = ref(null)

    /** What the entry looked like when the editor opened, to detect edits. */
    let editorOpenedAs = ''
    const snapshot = (e) => (e ? JSON.stringify({ ...e, revealPw: false }) : '')
    const editorDirty = () => snapshot(editing.value) !== editorOpenedAs

    /**
     * Close, asking first if there is unsaved work.
     *
     * A dialog you can dismiss by clicking beside it needs this: the whole
     * point of the modal is that it sits over the list, and the click that
     * closes it is one slip away from the click that scrolls.
     */
    const cancelEdit = () => {
      if (editorDirty() && !confirm('Discard the changes to this entry?')) return
      conflict.value = null
      editing.value = null
      store.clearDraft()
    }

    /**
     * Leaving for the generator, and coming back to the same half-typed entry.
     *
     * Without this the "Change settings" link was a trap: click it to adjust
     * the word count and the entry you were partway through was simply gone.
     * The draft is sealed with the vault key (see vault-store) rather than
     * dropped into sessionStorage, because it contains a password.
     *
     * The marker is separate and deliberately says nothing: the generator only
     * needs to know that a draft exists, never what is in it.
     */
    const DRAFT_FLAG = 'vault.hasDraft'
    const leaveForGenerator = async (event) => {
      if (!editing.value) return
      event.preventDefault()
      const saved = await store.saveDraft(editing.value)
      try { sessionStorage.setItem(DRAFT_FLAG, saved ? '1' : '') } catch {}
      // window.location explicitly: a `location` in scope here used to be
      // the vault's location ref, and this line silently set a property
      // on it instead of navigating.
      window.location.href = `/#${genMode.value}`
    }

    const restoreDraft = async () => {
      try { sessionStorage.removeItem(DRAFT_FLAG) } catch {}
      const draft = await store.loadDraft()
      if (!draft) return
      editing.value = draft
      // The snapshot has to be the draft as restored, or returning and
      // immediately closing would claim there are unsaved changes.
      await nextTick()
      editorOpenedAs = snapshot(draft)
      flash('Picked up where you left off.')
    }

    /**
     * While the dialog is up: Escape closes it, Tab stays inside it, and the
     * list behind does not scroll. A modal that lets the background scroll is
     * how you lose your place in a long vault, which is the thing this was
     * built to stop.
     */
    const onEditorKey = (event) => {
      if (!editing.value) return
      if (event.key === 'Escape') {
        event.preventDefault()
        // The innermost thing first. Escape out of an open generator menu must
        // not also throw away the entry being edited -- that would make trying
        // the menu cost you the form.
        if (genMenuOpen.value !== null) { genMenuOpen.value = null; return }
        cancelEdit()
        return
      }
      if (event.key !== 'Tab' || !editorEl.value) return
      const focusable = [...editorEl.value.querySelectorAll(
        'a[href], button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])',
      )].filter((el) => el.offsetParent !== null)
      if (!focusable.length) return
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault(); last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault(); first.focus()
      }
    }

    /**
     * Fit the dialog between the fixed header and the floating nav bar.
     *
     * Both are `position: fixed` at z-index 100, above the dialog's 60, so a
     * full-viewport backdrop puts the top and bottom of the form underneath
     * them -- most visibly on a phone, where there is least room to spare.
     *
     * Measured rather than hardcoded because the header condenses on scroll,
     * so its height is a runtime fact and not a constant. Reading two
     * bounding boxes is worth more than a magic number that is wrong in one
     * of the two states.
     */
    const fitModalToChrome = () => {
      // The EDGES, not the heights. The nav floats clear of the bottom of the
      // viewport, so its height is 12px short of the gap it actually needs --
      // measured as a 45px inset against a bar whose top edge is 57px up.
      const edgesOf = (sel) => {
        const el = document.querySelector(sel)
        if (!el || getComputedStyle(el).position !== 'fixed') return null
        return el.getBoundingClientRect()
      }
      const gap = 8
      const header = edgesOf('.site-header')
      const nav = edgesOf('.site-footer')
      const root = document.documentElement
      root.style.setProperty('--vault-modal-top',
        `${Math.max(0, Math.ceil(header ? header.bottom : 0)) + (header ? gap : 0)}px`)
      root.style.setProperty('--vault-modal-bottom',
        `${Math.max(0, Math.ceil(nav ? window.innerHeight - nav.top : 0)) + (nav ? gap : 0)}px`)
    }

    watch(editing, async (now, before) => {
      if (now && !before) {
        editorOpenedAs = snapshot(now)
        document.body.classList.add('vault-modal-open')
        fitModalToChrome()
        await nextTick()
        // The label is where an entry starts, so that is where the cursor goes.
        editorEl.value?.querySelector('input, textarea')?.focus()
      } else if (!now) {
        document.body.classList.remove('vault-modal-open')
      } else {
        // Reopened onto a different entry without closing first.
        editorOpenedAs = snapshot(now)
      }
    })

    const addQuestion = () => { editing.value.questions.push({ q: '', a: '' }) }
    const removeQuestion = (i) => { editing.value.questions.splice(i, 1) }

    const addField = (secret = false) => { editing.value.fields.push({ name: '', value: '', secret }) }
    const removeField = (i) => { editing.value.fields.splice(i, 1) }

    // --- one-time codes --------------------------------------------------------

    /**
     * Live TOTP codes for every entry that has a seed.
     *
     * Recomputed on a one-second tick rather than per render, because the
     * code is a function of the clock and Vue has no reason to know that.
     */
    const totpCodes = ref(new Map())
    const totpLeft = ref(0)

    const refreshTotp = async () => {
      const next = new Map()
      for (const entry of entries.value) {
        if (!entry.totp) continue
        try { next.set(entry.id, await totpCode(entry.totp)) } catch { /* a bad seed shows nothing */ }
      }
      totpCodes.value = next
      const withTotp = entries.value.find((e) => e.totp)
      totpLeft.value = withTotp ? secondsRemaining(withTotp.totp) : 0
    }

    const codeFor = (entry) => formatCode(totpCodes.value.get(entry.id) || '')

    /** The editor's own field, which accepts a link or a bare secret. */
    const totpInput = ref('')
    const totpError = ref('')
    const applyTotp = () => {
      totpError.value = ''
      const text = totpInput.value.trim()
      if (!text) { editing.value.totp = null; return }
      try {
        editing.value.totp = parseTotpInput(text)
        totpInput.value = ''
      } catch (e) {
        totpError.value = e.message
      }
    }
    const clearTotp = () => { editing.value.totp = null; totpInput.value = ''; totpError.value = '' }

    // --- collapsing ------------------------------------------------------------

    /**
     * Which groups and entries are folded shut.
     *
     * Stored as the set of things CLOSED rather than open, so a newly added
     * entry or group starts visible. The alternative -- remembering what is
     * open -- makes everything new arrive collapsed, which looks like the save
     * failed.
     *
     * Group state persists because it is a filing preference. Entry state does
     * not: entries are collapsed to skim a long list, and coming back to a
     * vault with a particular row still folded from last week is noise.
     */
    const COLLAPSED_KEY = 'vault.collapsedGroups'
    const collapsedGroups = ref((() => {
      try {
        const saved = JSON.parse(localStorage.getItem(COLLAPSED_KEY))
        return new Set(Array.isArray(saved) ? saved : [])
      } catch { return new Set() }
    })())
    watch(collapsedGroups, (v) => {
      try { localStorage.setItem(COLLAPSED_KEY, JSON.stringify([...v])) } catch {}
    })

    const toggleGroupOpen = (name) => {
      const next = new Set(collapsedGroups.value)
      next.has(name) ? next.delete(name) : next.add(name)
      collapsedGroups.value = next
    }
    const isGroupOpen = (name) => !collapsedGroups.value.has(name)

    const collapsedEntries = ref(new Set())
    const toggleEntryOpen = (id) => {
      const next = new Set(collapsedEntries.value)
      next.has(id) ? next.delete(id) : next.add(id)
      collapsedEntries.value = next
    }
    const isEntryOpen = (id) => !collapsedEntries.value.has(id)

    /**
     * Fold or unfold every entry at once, for a vault too long to click
     * through. Entries only -- groups keep their own toggles. Folding both
     * would leave nothing on screen but two headings, which is a different
     * thing from the scannable list of labels this is for.
     */
    const allCollapsed = computed(() =>
      shown.value.length > 0 && shown.value.every((e) => collapsedEntries.value.has(e.id)))
    const toggleAll = () => {
      // Snapshot first. Reading allCollapsed again after the assignment reads
      // the value the assignment just produced, which had this collapsing
      // everything on the second click instead of expanding it.
      const collapse = !allCollapsed.value
      collapsedEntries.value = collapse ? new Set(shown.value.map((e) => e.id)) : new Set()
      // An entry hidden inside a folded group cannot be unfolded, so expanding
      // has to open the groups too.
      if (!collapse) collapsedGroups.value = new Set()
    }

    // --- generating into the vault's own fields ------------------------------

    /**
     * The generator, reached without leaving the page.
     *
     * Deliberately not a second set of options. It runs whichever mode you
     * pick using that mode's settings exactly as the generator page has them,
     * so there is one place to configure Words and it is the Words tab. The
     * entropy comes back with the password, which is what lets an entry
     * created here carry the same exact figure a Kept one does.
     */
    const GEN_MODE_KEY = 'vault.genMode'
    const genModes = MODES
    const genMode = ref((() => {
      try {
        const saved = JSON.parse(localStorage.getItem(GEN_MODE_KEY))
        return MODES.some((m) => m.id === saved) ? saved : 'words'
      } catch { return 'words' }
    })())
    watch(genMode, (v) => {
      try { localStorage.setItem(GEN_MODE_KEY, JSON.stringify(v)) } catch {}
    })

    const generating = ref(false)

    /**
     * Which generator to run, chosen at the field you are filling.
     *
     * Every secret box had a Generate button but only the password had the
     * mode picker, so generating an answer with a different generator meant
     * scrolling up to the password, changing the select, scrolling back down,
     * and clicking. Three of those four steps are the bug.
     *
     * So each Generate is a split button: the left half runs whatever is in
     * use, the right half opens the list. Picking from the list SETS the mode
     * rather than running once with it -- there is one generator in use and
     * the password row shows which, and a per-field override would quietly
     * make that display a lie.
     *
     * Click, not hover. A hover menu cannot be opened from a keyboard or a
     * touchscreen, and the rest of this page already opens menus by clicking.
     */
    const genMenuOpen = ref(null)
    const genTargetKey = (target) => (
      target === 'pw' ? 'pw'
        : target && typeof target === 'object' && 'field' in target ? `field:${target.field}`
          : `q:${target}`
    )
    const toggleGenMenu = (target) => {
      const key = genTargetKey(target)
      genMenuOpen.value = genMenuOpen.value === key ? null : key
    }
    const genModeLabel = computed(() =>
      (genModes.find((m) => m.id === genMode.value) || {}).label || genMode.value)

    /**
     * @param target 'pw' for the password, a question index for its answer,
     *               or { field: i } for a custom field's value
     */
    const generateInto = async (target = 'pw') => {
      if (!editing.value) return
      generating.value = true
      error.value = ''
      try {
        const mode = genMode.value
        const result = generateWithRetry(mode, readSettings(mode), await loadData(mode))
        if (result.error) { error.value = result.error; return }
        if (target === 'pw') {
          editing.value.pw = result.password
          // The figure is only exact for the password itself, so it is only
          // recorded there -- an entry's bits describe its password.
          editing.value.bits = result.entropy ? result.entropy.total : null
          editing.value.revealPw = true
        } else if (target && typeof target === 'object' && 'field' in target) {
          editing.value.fields[target.field].value = result.password
        } else {
          editing.value.questions[target].a = result.password
        }
      } catch (e) {
        error.value = `The generator could not run: ${e.message}`
      } finally {
        generating.value = false
      }
    }

    const generateWith = (mode, target) => {
      genMode.value = mode
      genMenuOpen.value = null
      return generateInto(target)
    }

    // --- grouping and sorting -------------------------------------------------

    const SORT_KEY = 'vault.sort'
    const sortBy = ref((() => {
      try {
        const saved = JSON.parse(localStorage.getItem(SORT_KEY))
        return SORTS.some((s) => s.id === saved) ? saved : 'recent'
      } catch { return 'recent' }
    })())
    watch(sortBy, (v) => {
      try { localStorage.setItem(SORT_KEY, JSON.stringify(v)) } catch {}
    })

    /**
     * Which groups to show. Empty means all of them, which is different from
     * none selected -- unticking everything shows everything rather than an
     * empty list, because an empty list is never what someone wanted.
     */
    const groupFilter = ref(new Set())
    const groupMenuOpen = ref(false)

    const toggleGroup = (name) => {
      const next = new Set(groupFilter.value)
      next.has(name) ? next.delete(name) : next.add(name)
      groupFilter.value = next
    }
    const clearGroupFilter = () => { groupFilter.value = new Set() }

    // A menu that only closes by pressing its own button is a menu people
    // leave open over the list they are trying to read.
    const dismissGroupMenu = (event) => {
      if (!groupMenuOpen.value && !tagMenuOpen.value && genMenuOpen.value === null) return
      if (event.type === 'keydown') {
        if (event.key === 'Escape') {
          groupMenuOpen.value = false; tagMenuOpen.value = false; genMenuOpen.value = null
        }
        return
      }
      if (!event.target.closest('.vault-groupmenu')) groupMenuOpen.value = false
      if (!event.target.closest('.vault-tagmenu')) tagMenuOpen.value = false
      if (!event.target.closest('.vault-genmenu')) genMenuOpen.value = null
    }

    // A dropdown anchored to its button's left edge runs off the right of the
    // screen once the button sits far enough across, and the tag button is the
    // rightmost thing in the filter row. Measured at 320px: its panel's right
    // edge landed exactly on the viewport edge, so one more character in the
    // label ("12 tags") would have put it outside. Nudge it back rather than
    // right-aligning, which breaks the other way when the row wraps and the
    // button is the leftmost thing instead.
    const keepMenuOnScreen = async (selector) => {
      await nextTick()
      const panel = document.querySelector(`${selector} .vault-groupmenu-panel`)
      if (!panel) return
      panel.style.transform = ''
      const gap = 8
      const over = panel.getBoundingClientRect().right - document.documentElement.clientWidth + gap
      if (over > 0) panel.style.transform = `translateX(${-Math.ceil(over)}px)`
    }

    watch(groupMenuOpen, (open) => { if (open) keepMenuOnScreen('.vault-groupmenu') })

    const groupFilterLabel = computed(() => {
      const n = groupFilter.value.size
      if (n === 0) return 'All groups'
      if (n === 1) return [...groupFilter.value][0]
      return `${n} groups`
    })

    /**
     * Whether to bucket by group at all.
     *
     * Off gives one flat list in pure sort order. Grouping is the right
     * default for finding a known entry, and exactly wrong for auditing: with
     * it on, "weakest first" means weakest-within-each-group, so the worst
     * password in the vault can sit halfway down the page under a heading.
     */
    const GROUPING_KEY = 'vault.grouping'
    const grouping = ref((() => {
      try {
        const saved = JSON.parse(localStorage.getItem(GROUPING_KEY))
        return typeof saved === 'boolean' ? saved : true
      } catch { return true }
    })())
    watch(grouping, (v) => {
      try { localStorage.setItem(GROUPING_KEY, JSON.stringify(v)) } catch {}
    })

    const knownGroups = computed(() => groupsOf(entries.value))

    /**
     * Tag filtering, which is set INTERSECTION rather than the group's union.
     *
     * Groups filter as OR -- "Finance or Work" -- because an entry has exactly
     * one, so asking for two as AND would always return nothing. Tags are the
     * opposite: an entry has many, and ticking `work` and `needs-2fa` means
     * things that are both. Same widget, opposite operator, and getting it
     * backwards makes tags feel broken in a way nobody can quite name.
     */
    const tagFilter = ref(new Set())
    const tagMenuOpen = ref(false)
    watch(tagMenuOpen, (open) => { if (open) keepMenuOnScreen('.vault-tagmenu') })

    const toggleTag = (tag) => {
      const next = new Set(tagFilter.value)
      next.has(tag) ? next.delete(tag) : next.add(tag)
      tagFilter.value = next
    }
    const clearTagFilter = () => { tagFilter.value = new Set() }
    const knownTags = computed(() => tagsOf(entries.value))
    const tagFilterLabel = computed(() => {
      const n = tagFilter.value.size
      if (n === 0) return 'Any tag'
      if (n === 1) return [...tagFilter.value][0]
      return `${n} tags`
    })

    /** Toggle a tag on the entry being edited, keeping the list sorted. */
    const editTag = (tag) => {
      const tags = editing.value.tags
      const i = tags.indexOf(tag)
      i >= 0 ? tags.splice(i, 1) : tags.push(tag)
      tags.sort()
    }
    const tagDraft = ref('')
    const addTypedTag = () => {
      const raw = tagDraft.value.trim().toLowerCase().replace(/\s+/g, ' ')
      if (raw && !editing.value.tags.includes(raw)) {
        editing.value.tags.push(raw)
        editing.value.tags.sort()
      }
      tagDraft.value = ''
    }

    /** One bucket per group, or a single unnamed bucket when grouping is off. */
    const grouped = computed(() => (grouping.value
      ? groupEntries(shown.value, sortBy.value)
      : [{ name: '', entries: sortEntries(shown.value, sortBy.value) }]))

    const showGroupHeadings = computed(() => grouping.value && (
      grouped.value.length > 1 || (grouped.value[0] && grouped.value[0].name !== UNGROUPED)))

    // --- password reuse --------------------------------------------------------

    // --- persistent storage ----------------------------------------------------

    /**
     * Whether the browser has promised to keep this vault, and what can be
     * done when it has not.
     *
     * The permission state is what makes this actionable rather than a shrug.
     * Chromium never prompts: it grants `persistent-storage` on its own once
     * the site is installed, bookmarked, or has enough engagement history, and
     * reports "denied" until then -- which reads like a refusal but is really
     * "not yet earned". Firefox does prompt, so there the button is the
     * request. Telling someone their data may be evicted without telling them
     * which of those situations they are in is not much of a warning.
     */
    const storagePermission = ref('unknown')
    const installed = ref(false)

    const readStorageState = async () => {
      try { persisted.value = await navigator.storage.persisted() } catch {}
      try {
        storagePermission.value = (await navigator.permissions.query({ name: 'persistent-storage' })).state
      } catch { storagePermission.value = 'unknown' }
      installed.value = window.matchMedia('(display-mode: standalone)').matches
    }

    const askingPersistence = ref(false)
    const requestPersistence = async () => {
      askingPersistence.value = true
      try {
        const granted = await navigator.storage.persist()
        await readStorageState()
        flash(granted
          ? 'The browser has promised to keep this vault.'
          : 'The browser still will not promise. Installing the app is the reliable fix.')
      } catch {
        error.value = 'This browser does not offer persistent storage.'
      } finally {
        askingPersistence.value = false
      }
    }

    /** How much room the vault has, for the "is this actually likely" question. */
    const storageEstimate = ref(null)
    const readEstimate = async () => {
      try {
        const { usage, quota } = await navigator.storage.estimate()
        if (!quota) return
        // Whole units a person reads at a glance -- "11 GB" rather than the
        // literal 11,259 MB, which invites arithmetic instead of reassurance.
        const size = (bytes) => {
          if (bytes >= 1024 ** 3) return `${Math.round(bytes / 1024 ** 3)} GB`
          if (bytes >= 1024 ** 2) return `${Math.round(bytes / 1024 ** 2)} MB`
          return `${Math.max(1, Math.round(bytes / 1024))} KB`
        }
        storageEstimate.value = { used: size(usage), quota: size(quota) }
      } catch {}
    }

    /** entry id -> the other entries sharing its password. */
    const reuse = computed(() => reuseIndex(entries.value))
    const reusedWith = (entry) => reuse.value.get(entry.id) || []
    const reuseTitle = (entry) => {
      const others = reusedWith(entry)
      if (!others.length) return ''
      const names = others.map((e) => e.label || 'an untitled entry')
      return `The same password is on ${names.join(', ')}. One breach exposes all of them.`
    }
    const reuseSummary = computed(() => {
      const n = reuse.value.size
      if (!n) return ''
      return `${n} entries share a password with another entry.`
    })
    const showReusedOnly = ref(false)

    /** Reuse for the entry being edited, checked live against the others. */
    const editingReuse = computed(() => {
      if (!editing.value || !editing.value.pw) return []
      return entries.value.filter((e) => e.pw === editing.value.pw && e.id !== editing.value.id)
    })

    // --- export and import (9b) ---------------------------------------------

    /**
     * When the vault was last exported, and how much was in it at the time.
     *
     * REVERSED. This was a localStorage key, on the reasoning that the record
     * "has to survive being locked, so it cannot live inside the ciphertext".
     * The premise was wrong twice over: the nag only renders when entries are
     * on screen, which means unlocked, and a per-browser record is not a fact
     * about the vault. Sharing a folder made that visible -- Edge called a
     * vault un-backed-up an hour after Chrome had exported it. It is now
     * meta.lastExport inside the payload, so it travels with the vault.
     */
    const backups = ref([])
    const lastExport = computed(() => backups.value[0] || null)
    const readLastExport = () => {
      backups.value = store.state() === 'unlocked' ? store.exports() : []
    }

    /**
     * A backup's timestamp, in the reader's own locale and clock.
     *
     * Stored as full ISO-8601 UTC and rendered here, rather than stored
     * pre-formatted: the vault is shared between machines that may not agree
     * on either. Date and time both, since two backups in one afternoon is the
     * normal case and a list of identical dates would say nothing.
     */
    const backupWhen = (at) => {
      const d = new Date(at)
      if (Number.isNaN(d.getTime())) return at
      return d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
    }
    const backupDay = (at) => {
      const d = new Date(at)
      if (Number.isNaN(d.getTime())) return at
      return d.toLocaleDateString(undefined, { dateStyle: 'medium' })
    }

    /**
     * The nag, and it is deliberately only a line of text. A vault in one
     * browser profile is one "clear site data" from gone, which is worth
     * saying -- but a modal between someone and their passwords would be a
     * worse thing to have built than no reminder at all.
     */
    const backupNag = computed(() => {
      if (!entries.value.length) return ''
      if (!lastExport.value) {
        // No hedge about "this browser" any more: the record is in the vault,
        // so an export from anywhere that opens it counts here. What differs
        // between the two is what is actually at risk -- a vault in a folder
        // is not lost when this browser's storage is.
        return vaultLocation.value.kind === 'folder'
          ? 'This vault has never been exported. The folder is the only copy.'
          : 'This vault has never been exported. If this browser loses its data, it is gone.'
      }
      const drift = entries.value.length - lastExport.value.count
      if (drift > 0) {
        return `${drift} ${drift === 1 ? 'entry' : 'entries'} added since the last backup on ${backupDay(lastExport.value.at)}.`
      }
      return ''
    })

    // Opened imperatively rather than through a bound :open, so a re-render
    // cannot slam shut a section the reader opened themselves.
    const transferEl = ref(null)
    const openTransfer = () => {
      const el = transferEl.value
      if (!el) return
      el.open = true
      el.scrollIntoView({ block: 'center', behavior: 'smooth' })
    }

    const download = (text, filename, type) => {
      const url = URL.createObjectURL(new Blob([text], { type }))
      const a = document.createElement('a')
      a.href = url
      a.download = filename
      a.click()
      // Revoking immediately can beat the download in some browsers.
      setTimeout(() => URL.revokeObjectURL(url), 10_000)
    }

    const exportVault = async (kind) => {
      if (kind !== 'backup') {
        const ok = confirm(
          'This file will contain your passwords in plain text, readable by anything that opens it.\n\n' +
          'Only do this to move into another password manager, and delete the file as soon as you have.\n\n' +
          'Continue?',
        )
        if (!ok) return
      }
      try {
        const list = kind === 'backup' ? null : store.list()
        const text = kind === 'backup' ? exportBackup(store.envelope())
          : kind === 'csv' ? exportCsv(list) : exportPlainJson(list)
        download(text, transferFilename(kind),
          kind === 'csv' ? 'text/csv' : 'application/json')
        exported.value = true
        // Only the encrypted backup counts as a backup. A plaintext file is a
        // migration artefact meant to be deleted, so treating it as one would
        // silence the reminder for something the user is about to shred.
        //
        // Recorded after the download has been handed off, and a failure to
        // record does not un-download the file -- so it is not allowed to
        // become an error the reader has to act on.
        if (kind === 'backup') {
          try { await store.noteExport(); readLastExport() } catch {}
        }
        flash(kind === 'backup' ? 'Backup saved.' : 'Plain-text file saved — delete it when you are done.')
      } catch (e) {
        error.value = e.message
      }
    }

    /**
     * Import a file. An encrypted backup needs its own passphrase, which may
     * differ from this vault's -- so it is asked for separately rather than
     * assumed, and the entries are merged in rather than replacing anything.
     */
    const importFile = async (event) => {
      const file = event.target.files && event.target.files[0]
      event.target.value = ''
      if (!file) return
      // No blanket failure message here: parseTransfer already says exactly
      // what is wrong with a file ("no password column", "not valid JSON"),
      // and replacing that with "could not be imported" throws away the only
      // thing that would tell someone how to fix it. The one case that needs
      // its own wording is a wrong passphrase, handled where it happens.
      await run(async () => {
        const text = await file.text()
        const parsed = parseTransfer(text)
        let incoming
        if (parsed.kind === 'backup') {
          const phrase = prompt('This backup is encrypted. Enter the passphrase it was created with:')
          if (phrase === null) return
          let opened
          try {
            opened = await openVault(parsed.envelope, phrase)
          } catch {
            throw new Error('That passphrase did not open the backup.')
          }
          incoming = opened.data
        } else {
          incoming = parsed.entries
        }
        const { added, skipped } = await store.importEntries(incoming)
        entries.value = store.list()
        flash(added
          ? `Imported ${added} ${added === 1 ? 'entry' : 'entries'}${skipped ? `, skipped ${skipped} already here` : ''}.`
          : 'Nothing new to import — every entry was already in the vault.')
      })
    }

    const rekey = () => {
      if (newPass.value.length < 8) { error.value = 'Use at least 8 characters.'; return }
      if (rekeyStrength.value?.common) {
        error.value = 'That is one of the passwords attackers try first. Please choose another.'
        return
      }
      return run(async () => {
        await store.rekey(oldPass.value, newPass.value)
        clearPass()
        rekeyOpen.value = false
        flash('Passphrase changed.')
      }, 'The current passphrase is not right.')
    }

    // -- The recovery key (ROADMAP 9f) ---------------------------------------
    //
    // Shown exactly once. The vault stores the master key encrypted *under*
    // the phrase, which is not the same as storing the phrase, so there is no
    // "show it to me again" -- losing it means generating another, and the
    // old one stops working the moment you do.

    /** The phrase, while it is on screen and only then. */
    const shownPhrase = ref('')
    const phraseAck = ref(false)
    // The recovery-key dialog shares the editor's backdrop, so it needs the
    // same treatment: measure the chrome, and stop the page behind it
    // scrolling. Without this it inherited whatever --vault-modal-top the
    // editor last left behind -- or the 0px default, if the editor had never
    // been opened, which put the dialog underneath the fixed header.
    watch(shownPhrase, async (now) => {
      document.body.classList.toggle('vault-modal-open', !!now)
      if (!now) return
      fitModalToChrome()
      await nextTick()
      // Focus the dialog itself rather than the copy button: this is a
      // read-this screen, and a screen reader should start at the heading.
      document.querySelector('.vault-phrase-modal')?.focus()
    })
    const recoveryPass = ref('')
    const recoveryOpen = ref(false)
    /** Set after creating a vault, to offer this once at the useful moment. */
    const offerRecovery = ref(false)
    const hasRecovery = ref(false)

    // The recovery words come from the same list the Words generator draws
    // from. Fetched once, on demand: the lock screen may need it to check a
    // typed phrase, and the settings panel to make one.
    let wordsPromise = null
    const words = () => (wordsPromise || (wordsPromise = loadWordList()))

    const refreshRecovery = () => { hasRecovery.value = store.hasRecoveryKey() }

    const enableRecovery = () => run(async () => {
      const phrase = await store.addRecoveryKey(recoveryPass.value, await words())
      recoveryPass.value = ''
      phraseAck.value = false
      shownPhrase.value = phrase
      offerRecovery.value = false
      refreshRecovery()
    }, 'That passphrase is not right, so no recovery key was made.')

    const dismissPhrase = () => { shownPhrase.value = ''; phraseAck.value = false }

    const copyPhrase = async () => {
      try {
        await navigator.clipboard.writeText(shownPhrase.value)
        // Deliberately NOT on the clipboard timer. Everything else here is
        // wiped after 30 seconds because it is a password in transit; this is
        // being copied in order to be pasted somewhere permanent, and clearing
        // it mid-paste would be the opposite of helpful.
        flash('Recovery key copied. Paste it somewhere safe.')
      } catch { error.value = 'The clipboard is not available.' }
    }

    const downloadPhrase = () => {
      const body = [
        'WordLock recovery key',
        '',
        shownPhrase.value,
        '',
        'This opens your vault without the passphrase. Anyone holding it can read',
        'everything in the vault, so keep it somewhere you would keep a spare house',
        'key -- not in the vault, and not on the same device if you can help it.',
        '',
        'It does not protect against losing the vault itself. For that, export a',
        'backup as well; the two solve different problems.',
        '',
        `Made ${new Date().toISOString().slice(0, 10)}.`,
      ].join('\n')
      const url = URL.createObjectURL(new Blob([body], { type: 'text/plain' }))
      const a = document.createElement('a')
      a.href = url
      a.download = `wordlock-recovery-key-${new Date().toISOString().slice(0, 10)}.txt`
      a.click()
      URL.revokeObjectURL(url)
    }

    const disableRecovery = () => {
      if (!confirm('Remove the recovery key? If you forget the passphrase after this, nothing can open the vault.')) return
      return run(async () => {
        await store.removeRecoveryKey(recoveryPass.value)
        recoveryPass.value = ''
        refreshRecovery()
        flash('Recovery key removed.')
      }, 'That passphrase is not right, so the recovery key is still in place.')
    }

    // -- Recovering, from the lock screen ------------------------------------

    const recoverOpen = ref(false)
    const recoverPhrase = ref('')
    const recoverPass = ref('')
    const recoverConfirm = ref('')
    const recoverWords = ref(null)

    // Checked as they type, so "that is 15 words" and "brambel is not one of
    // the words" arrive before a million PBKDF2 rounds rather than after.
    const recoverCheck = computed(() => {
      if (!recoverPhrase.value.trim()) return null
      return checkRecoveryPhrase(recoverPhrase.value, recoverWords.value)
    })

    const openRecover = async () => {
      recoverOpen.value = true
      try { recoverWords.value = await words() } catch {}
    }

    const doRecover = () => {
      if (recoverPass.value.length < 8) { error.value = 'Use at least 8 characters.'; return }
      if (recoverPass.value !== recoverConfirm.value) {
        error.value = 'The two passphrases do not match.'
        return
      }
      return run(async () => {
        await store.recoverWithKey(recoverPhrase.value, recoverPass.value)
        recoverPhrase.value = ''
        recoverPass.value = ''
        recoverConfirm.value = ''
        recoverOpen.value = false
        refreshRecovery()
        flash('Vault recovered. The old passphrase and that recovery key no longer work.')
      }, 'That recovery key did not open the vault.')
    }

    // -- Where the vault is kept (ROADMAP 9d, mode 2) ------------------------

    /** Adopt a resolved location, swapping what the store's proxy points at. */
    const useLocation = (resolved) => {
      backend = resolved.storage
      currentDir = resolved.dir
      vaultLocation.value = { kind: resolved.kind, name: resolved.name, permission: resolved.permission }
    }

    const chooseFolder = () => run(async () => {
      let dir
      try {
        dir = await pickFolder()
      } catch {
        return // The picker was dismissed, which is not an error.
      }
      const wasUnlocked = store.state() === 'unlocked'
      useLocation(await moveVaultToFolder(dir, { from: backend }))
      // The envelope moved underneath a running store, so re-read it. An
      // unlocked vault stays unlocked -- the key is in memory and unrelated to
      // where the ciphertext sits.
      if (!wasUnlocked) await store.init()
      flash(`The vault now lives in ${dir.name}.`)
    })

    /**
     * Point at a folder that already holds a vault -- the second machine.
     *
     * Separate from chooseFolder because the two are opposites: that one
     * requires an empty folder and writes, this one requires a full one and
     * does not. A single button that guessed would be a button whose
     * destructive behaviour depended on what it found.
     */
    const openFolder = () => run(async () => {
      let dir
      try {
        dir = await pickFolder()
      } catch {
        return
      }
      useLocation(await openVaultInFolder(dir))
      // reload rather than init: this is a different vault, and init() returns
      // early once it has run. Without it the page sits on "create a vault"
      // until you navigate away and back.
      await store.reload()
      flash(`Opened the vault in ${dir.name}. Unlock it with its own passphrase.`)
    })

    const useThisBrowser = () => run(async () => {
      if (!vaultLocation.value.dir && vaultLocation.value.kind !== 'folder') return
      const dir = currentDir
      if (!dir) throw new Error('there is no folder to move from')
      const wasUnlocked = store.state() === 'unlocked'
      useLocation(await moveVaultToLocal(dir, {}))
      currentDir = null
      if (!wasUnlocked) await store.init()
      flash('The vault is back in this browser.')
    })

    /**
     * Ask for the folder back after a permission lapse. Needs a user gesture,
     * which is why it is a button rather than something tried on load.
     */
    const reconnectFolder = () => run(async () => {
      if (!currentDir) throw new Error('there is no folder to reconnect')
      if (!await unblockFolder(currentDir)) {
        throw new Error('the browser did not grant access to that folder')
      }
      useLocation(await resolveLocation())
      await store.init()
      flash('Folder reconnected.')
    }, 'That folder could not be reopened.')

    /**
     * Stop using a folder vault here, without touching the vault.
     *
     * The missing third option. Delete destroys it for everyone sharing the
     * folder, and moving it back here takes it away from them; neither is
     * "I am done with this vault ON THIS COMPUTER", which is the ordinary
     * thing to want on a work machine, a shared desktop, or a browser you
     * were only trying. Clearing site data does it today and takes the
     * settings and every other site's data with it.
     *
     * No passphrase, because nothing is destroyed and asking for one would
     * imply otherwise. What it costs is a click on "Open a vault in a folder"
     * to come back, and that is the whole risk.
     */
    const disconnectFolder = () => {
      const name = vaultLocation.value.name || 'that folder'
      const ok = confirm(
        `Stop using the vault in ${name} on this browser?\n\n` +
        'The file stays exactly where it is and other devices go on using it. ' +
        'This browser locks it, forgets where it was, and offers to make a new one.\n\n' +
        'You can point it back at that folder any time with "Open a vault in a folder".',
      )
      if (!ok) return
      return run(async () => {
        useLocation(await releaseFolder())
        currentDir = null
        // reload rather than init: this browser is being sent somewhere else
        // entirely, and reload is what drops the key on the way.
        await store.reload()
        flash(`This browser no longer uses the vault in ${name}. The file is untouched.`)
      })
    }

    const destroy = () => {
      if (!confirm('Delete the entire vault and everything in it? This cannot be undone.')) return
      return run(async () => {
        const wasFolder = vaultLocation.value.kind === 'folder'
        const folderName = vaultLocation.value.name
        await store.destroy(pass.value)
        clearPass()
        // Deleting the vault also lets go of the folder it was in. Keeping the
        // pointer meant this browser stayed aimed at a folder with nothing of
        // ours in it -- see releaseFolder for what that then did.
        if (wasFolder) {
          useLocation(await releaseFolder())
          currentDir = null
          await store.reload()
        }
        flash(wasFolder
          ? `Vault deleted, and this browser no longer points at ${folderName}.`
          : 'Vault deleted.')
      }, 'That passphrase is not right, so nothing was deleted.')
    }

    const shown = computed(() => {
      const q = query.value.trim().toLowerCase()
      const groups = groupFilter.value
      return entries.value.filter((e) => {
        if (groups.size && !groups.has(e.group || UNGROUPED)) return false
        // Every ticked tag must be present, not any of them -- see tagFilter.
        for (const tag of tagFilter.value) if (!(e.tags || []).includes(tag)) return false
        if (showReusedOnly.value && !reuse.value.has(e.id)) return false
        if (!q) return true
        return [e.label, e.username, e.note, e.group, ...(e.tags || []),
          ...(e.urls || []).flatMap((u) => [u.name, u.url])]
          .some((field) => (field || '').toLowerCase().includes(q))
      })
    })

    const tierOf = (bits) => (Number.isFinite(bits) ? entropyTier(bits) : null)

    /**
     * Live strength of whatever is being typed into a passphrase field.
     *
     * Reported as a ceiling, never as a score -- see passphrase-strength.js.
     * The generator's figures are exact because it made the choices; this one
     * cannot be, and the label says so rather than letting a number the site
     * cannot stand behind sit next to numbers it can.
     */
    const strengthOf = (value) => {
      const s = estimatePassphrase(value)
      if (!s.length) return null
      return { ...s, tier: entropyTier(s.bits), pct: Math.min(100, (s.bits / 100) * 100) }
    }
    const newStrength = computed(() => strengthOf(pass.value))
    const rekeyStrength = computed(() => strengthOf(newPass.value))

    // Auto-lock: poll rather than schedule, so a laptop that slept through
    // the deadline locks on wake instead of trusting a timer that did not run.
    let timer = null
    let totpTimer = null
    const activity = () => store.touch()
    onMounted(async () => {
      try {
        const resolved = await resolveLocation()
        useLocation(resolved)
        // A folder we cannot read is its own state. Falling through to init
        // here would report an absent vault and offer to create one, over the
        // top of a real vault sitting in a folder we simply cannot open --
        // see the note at the top of vault-location.js.
        if (resolved.kind === 'blocked') {
          state.value = 'blocked'
          return
        }
        await store.init()
      } catch (e) {
        state.value = 'error'
        error.value = e.message
        return
      }
      // Re-checked on every load, not just at creation: the grant can arrive
      // later, when the app is installed or the browser decides the site has
      // been used enough to be worth keeping.
      await readStorageState()
      readEstimate()
      readLastExport()
      if (store.state() === 'unlocked') restoreDraft()
      timer = setInterval(() => { if (store.lockIfIdle()) revealed.value = new Set() }, 5000)
      // A code is a function of the clock, so it needs its own tick.
      totpTimer = setInterval(refreshTotp, 1000)
      refreshTotp()
      for (const ev of ['pointerdown', 'keydown']) window.addEventListener(ev, activity, true)
      for (const ev of ['pointerdown', 'keydown']) window.addEventListener(ev, dismissGroupMenu)
      window.addEventListener('keydown', onEditorKey, true)
      // The header condenses at different widths, so the inset is not a
      // constant across a resize or a rotation.
      window.addEventListener('resize', fitModalToChrome)
    })
    onUnmounted(() => {
      forgetPending()
      clearInterval(timer)
      clearInterval(totpTimer)
      for (const ev of ['pointerdown', 'keydown']) window.removeEventListener(ev, activity, true)
      for (const ev of ['pointerdown', 'keydown']) window.removeEventListener(ev, dismissGroupMenu)
      window.removeEventListener('keydown', onEditorKey, true)
      window.removeEventListener('resize', fitModalToChrome)
      document.body.classList.remove('vault-modal-open')
    })

    return {
      state, entries, shown, error, notice, busy, query, revealed, editing,
      persisted, rekeyOpen, pass, passConfirm, oldPass, newPass,
      create, unlock, lock, save, remove, copy, copyText, hostOf,
      toggleSecret, isRevealed, toggleAllSecrets, allRevealed, hasSeveralSecrets,
      startAdd, startEdit, rekey, destroy, tierOf,
      conflict, conflictFields, conflictDeleted, keepMine, keepTheirs, keepBoth,
      revealConflict, conflictHasSecrets, conflictHasTotp,
      addQuestion, removeQuestion, addField, removeField, cancelEdit, editorEl,
      leaveForGenerator,
      codeFor, totpLeft, totpInput, totpError, applyTotp, clearTotp,
      toggleGroupOpen, isGroupOpen, toggleEntryOpen, isEntryOpen, allCollapsed, toggleAll,
      exportVault, importFile, exported,
      backupNag, lastExport, backups, backupWhen, openTransfer, transferEl,
      newStrength, rekeyStrength,
      genModes, genMode, generating, generateInto,
      genMenuOpen, toggleGenMenu, generateWith, genModeLabel,
      sortBy, sorts: SORTS, knownGroups, grouped, showGroupHeadings,
      ungrouped: UNGROUPED, grouping,
      vaultLocation, canFolder, chooseFolder, openFolder, useThisBrowser, reconnectFolder,
      disconnectFolder,
      pending, undoDelete, finishDelete,
      shownPhrase, phraseAck, recoveryPass, recoveryOpen, offerRecovery, hasRecovery,
      recoveryWords: RECOVERY_WORDS,
      enableRecovery, disableRecovery, dismissPhrase, copyPhrase, downloadPhrase,
      recoverOpen, recoverPhrase, recoverPass, recoverConfirm, recoverCheck,
      openRecover, doRecover,
      groupFilter, groupMenuOpen, toggleGroup, clearGroupFilter, groupFilterLabel,
      tagFilter, tagMenuOpen, toggleTag, clearTagFilter, tagFilterLabel, knownTags,
      editTag, tagDraft, addTypedTag,
      reusedWith, reuseTitle, reuseSummary, showReusedOnly, editingReuse,
      storagePermission, installed, requestPersistence, askingPersistence, storageEstimate,
      iterations: KDF_ITERATIONS.toLocaleString(),
      autoLockMinutes: Math.round(vaultLockMs() / 60000),
      needsRekey: () => needsRekey(store.envelope()),
    }
  },
  render: renderApp,
}

initTheme()
mountSiteHeader(document.querySelector('[data-site-header]'))
mountSiteFooter(document.querySelector('[data-site-footer]'), {
  settings: { extraSections: [clipboardClearSection(), vaultLockSection()] },
})
createApp(App).mount('#vault-app')
