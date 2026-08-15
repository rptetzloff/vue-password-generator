// The vault page (ROADMAP 9a). A second small Vue app, separate from the
// generator's, because the two share nothing but the design tokens -- and
// main.js is already three thousand lines.
//
// Everything cryptographic lives in vault-crypto.js and everything stateful
// in vault-store.js; this file is the view. It holds the passphrase only for
// the instant it takes to unlock, and never writes it anywhere.

import { createApp, ref, computed, watch, onMounted, onUnmounted, nextTick } from '../vendor/vue.esm-browser.prod.js'
import {
  createVaultStore, vaultLockMs, vaultLockSection,
  groupsOf, tagsOf, groupEntries, sortEntries, reuseIndex, SORTS, UNGROUPED,
} from './vault-store.js'
import { MODES, readSettings, loadData, generateWithRetry, loadWordList } from './generators.js'
import { checkRecoveryPhrase, RECOVERY_WORDS } from './recovery-key.js'
import { canUseFolder, pickFolder } from './vault-fs.js'
import { resolveLocation, moveVaultToFolder, moveVaultToLocal, openVaultInFolder, unblockFolder, releaseFolder } from './vault-location.js'
import { scheduleClipboardClear, clipboardClearSection } from './clipboard-clear.js'
import {
  exportBackup, exportPlainJson, exportCsv, parseTransfer, transferFilename,
} from './vault-transfer.js'
import { totpCode, secondsRemaining, formatCode, parseTotpInput } from './totp.js'
import { openVault } from './vault-crypto.js'
import { KDF_ITERATIONS, needsRekey } from './vault-crypto.js'
import { entropyTier } from './entropy.js'
import { estimatePassphrase } from './passphrase-strength.js'
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
    const location = ref({ kind: 'local', name: null })
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

    const save = (entry) => run(async () => {
      const payload = { ...entry }
      // Rows now, not a textarea -- urlList drops any with an empty address.
      delete payload.urlText
      // View state, not entry data -- normalizeEntry would drop it anyway, but
      // sending it at all invites someone to start persisting it.
      delete payload.revealPw
      if (payload.id) await store.update(payload.id, payload)
      else await store.add(payload)
      entries.value = store.list()
      editing.value = null
      await store.clearDraft()
      flash('Saved.')
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
      location.href = `/#${genMode.value}`
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
      if (event.key === 'Escape') { event.preventDefault(); cancelEdit(); return }
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
      if (!groupMenuOpen.value && !tagMenuOpen.value) return
      if (event.type === 'keydown') {
        if (event.key === 'Escape') { groupMenuOpen.value = false; tagMenuOpen.value = false }
        return
      }
      if (!event.target.closest('.vault-groupmenu')) groupMenuOpen.value = false
      if (!event.target.closest('.vault-tagmenu')) tagMenuOpen.value = false
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
        return location.value.kind === 'folder'
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
      location.value = { kind: resolved.kind, name: resolved.name, permission: resolved.permission }
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
      if (!location.value.dir && location.value.kind !== 'folder') return
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

    const destroy = () => {
      if (!confirm('Delete the entire vault and everything in it? This cannot be undone.')) return
      return run(async () => {
        const wasFolder = location.value.kind === 'folder'
        const folderName = location.value.name
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
      addQuestion, removeQuestion, addField, removeField, cancelEdit, editorEl,
      leaveForGenerator,
      codeFor, totpLeft, totpInput, totpError, applyTotp, clearTotp,
      toggleGroupOpen, isGroupOpen, toggleEntryOpen, isEntryOpen, allCollapsed, toggleAll,
      exportVault, importFile, exported,
      backupNag, lastExport, backups, backupWhen, openTransfer, transferEl,
      newStrength, rekeyStrength,
      genModes, genMode, generating, generateInto,
      sortBy, sorts: SORTS, knownGroups, grouped, showGroupHeadings,
      ungrouped: UNGROUPED, grouping,
      location, canFolder, chooseFolder, openFolder, useThisBrowser, reconnectFolder,
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
  template: `
    <div class="vault">
      <div v-if="error" class="vault-error" role="alert">{{ error }}</div>
      <div v-if="notice" class="vault-notice" role="status" aria-live="polite">{{ notice }}</div>

      <!-- Deleted, with a way back for a few seconds. The entry is already
           gone from the vault; this holds a copy in memory so Undo can put it
           back. Announced once, not once per second. -->
      <div v-if="pending" class="vault-undo" role="status" aria-live="polite">
        <span class="vault-undo-text">
          Deleted <strong>{{ pending.label }}</strong>.
          <span class="vault-undo-count" aria-hidden="true">{{ pending.left }}</span>
          <span class="sr-only">You can undo this for {{ pending.left }} more seconds.</span>
        </span>
        <div class="vault-undo-actions">
          <button class="btn btn-small" type="button" @click="undoDelete">
            <span class="mdi mdi-undo" aria-hidden="true"></span> Undo
          </button>
          <button class="btn btn-small" type="button" @click="finishDelete"
                  title="Drop the copy held for undo, now rather than in a few seconds">
            Delete permanently
          </button>
        </div>
      </div>

      <!-- The recovery key, shown exactly once.
           A dialog rather than a panel, because this is the only moment these
           words exist anywhere outside the encrypted envelope, and scrolling
           past them by accident has no undo. -->
      <div v-if="shownPhrase" class="vault-modal-backdrop">
        <div class="vault-modal vault-phrase-modal" role="dialog" aria-modal="true"
             aria-labelledby="phrase-title" tabindex="-1">
          <h2 id="phrase-title">Write this down now</h2>
          <p>
            This is the only time it will be shown. It is not stored anywhere you can read it
            back — the vault holds your master key encrypted <em>under</em> these words, which is
            not the same as keeping them.
          </p>

          <p class="vault-phrase" aria-label="Your recovery key">{{ shownPhrase }}</p>

          <div class="vault-row-actions">
            <button class="btn" type="button" @click="copyPhrase">
              <span class="mdi mdi-content-copy" aria-hidden="true"></span> Copy
            </button>
            <button class="btn" type="button" @click="downloadPhrase">
              <span class="mdi mdi-download" aria-hidden="true"></span> Download
            </button>
          </div>

          <p class="vault-warn">
            <strong>Anyone holding these words can open your vault.</strong> They are a second key
            to every password in it, so store them the way you would a spare house key. Not in the
            vault, and not in the same place as the device if you can manage it.
          </p>
          <p class="vault-hint">
            This does not replace a backup. It gets you back in when the passphrase is gone; a
            backup gets you back the data when the vault is gone. Different failures.
          </p>

          <label class="vault-check">
            <input v-model="phraseAck" type="checkbox" />
            <span>I have written it down or saved it somewhere safe.</span>
          </label>
          <button class="btn btn-primary" type="button" :disabled="!phraseAck" @click="dismissPhrase">
            Done
          </button>
        </div>
      </div>

      <div v-if="state === 'loading'" class="vault-empty">Opening…</div>

      <!-- A folder is configured and cannot be read. Deliberately NOT the
           "create a vault" screen: the vault exists, it is just out of reach,
           and offering to make a new one here is how someone loses the old. -->
      <section v-else-if="state === 'blocked'" class="vault-card">
        <h2>Your vault is in a folder this browser cannot open</h2>
        <p>
          It is kept in <strong>{{ location.name || 'a folder you chose' }}</strong>, and nothing
          here can read it right now. <strong>Your vault is not lost</strong> — the file is where
          you put it, and this is a permission, not a deletion.
        </p>
        <p class="vault-hint">
          Browsers forget folder access after a while, and after a restart. Reconnecting asks for
          it again, which has to come from a button because a page that could reopen a folder on
          its own would not need to ask at all.
        </p>
        <div class="vault-row-actions">
          <button class="btn btn-primary" :disabled="busy" @click="reconnectFolder">
            <span class="mdi mdi-folder-key-outline" aria-hidden="true"></span>
            {{ busy ? 'Asking…' : 'Reconnect the folder' }}
          </button>
        </div>
        <p class="vault-hint">
          If that folder is gone for good — a different machine, a deleted directory — restore an
          encrypted backup instead. Moving this browser back to local storage would start an empty
          vault, not recover that one.
        </p>
      </section>

      <!-- No vault yet -->
      <section v-else-if="state === 'absent'" class="vault-card">
        <h2>Create a vault</h2>
        <p>
          Keep the passwords you generate, on this device only. The vault is encrypted with a
          passphrase you choose — {{ iterations }} PBKDF2 rounds — and nothing is ever sent anywhere.
        </p>
        <p class="vault-warn">
          <strong>Nobody can reset this for you.</strong> No account, no server, no reset link — if you
          forget this passphrase, we cannot open the vault and neither can anyone else. Pick something
          you can remember, make a <strong>recovery key</strong> once the vault exists, and export a
          backup once you have entries worth keeping. The recovery key is a second key you hold; it is
          not a way for us to get in.
        </p>
        <form @submit.prevent="create">
          <label class="vault-field">
            <span>Passphrase</span>
            <input v-model="pass" type="password" autocomplete="new-password" required />
          </label>

          <div v-if="newStrength" class="pass-strength">
            <span class="pass-meter" :class="'meter-' + newStrength.tier.id">
              <span class="pass-meter-fill" :style="{ width: newStrength.pct + '%' }"></span>
            </span>
            <span class="pass-figure">at most {{ newStrength.bits.toFixed(0) }} bits</span>
            <span class="pass-tier" :class="'meter-' + newStrength.tier.id">{{ newStrength.tier.label }}</span>
          </div>
          <ul v-if="newStrength && newStrength.notes.length" class="pass-notes">
            <li v-for="n in newStrength.notes" :key="n">{{ n }}</li>
          </ul>
          <p v-if="newStrength" class="pass-caveat">
            An estimate, and an upper bound — unlike the generator's figures, which are exact because
            it made every choice itself. A real attacker's dictionary knows words, names and dates
            that this does not. <a href="/">Generate a passphrase</a> instead and the number stops
            being a guess.
          </p>

          <label class="vault-field">
            <span>Confirm passphrase</span>
            <input v-model="passConfirm" type="password" autocomplete="new-password" required />
          </label>
          <button class="btn btn-primary" :disabled="busy">
            <span class="mdi mdi-lock-plus"></span> {{ busy ? 'Creating…' : 'Create vault' }}
          </button>
        </form>

        <!-- The second machine. Someone whose vault is already in a synced
             folder should not have to create a new one and import; they should
             point at the folder and be done. -->
        <template v-if="canFolder">
          <hr class="vault-rule" />
          <p class="vault-hint">
            <strong>Already have a vault in a folder?</strong> If another computer keeps its vault in
            a folder this one also syncs — Dropbox, OneDrive, iCloud Drive — open it here instead of
            starting again. Nothing is copied and nothing is written; this browser just learns where
            to look, and asks for the same passphrase.
          </p>
          <button class="btn" type="button" :disabled="busy" @click="openFolder">
            <span class="mdi mdi-folder-open-outline" aria-hidden="true"></span>
            {{ busy ? 'Opening…' : 'Open a vault in a folder…' }}
          </button>
        </template>
      </section>

      <!-- Locked -->
      <section v-else-if="state === 'locked'" class="vault-card">
        <h2>Vault locked</h2>
        <form @submit.prevent="unlock">
          <label class="vault-field">
            <span>Passphrase</span>
            <input v-model="pass" type="password" autocomplete="current-password" autofocus required />
          </label>
          <button class="btn btn-primary" :disabled="busy">
            <span class="mdi mdi-lock-open-variant"></span> {{ busy ? 'Unlocking…' : 'Unlock' }}
          </button>
        </form>
        <details class="vault-danger" :open="recoverOpen" @toggle="$event.target.open && openRecover()">
          <summary>Forgotten the passphrase?</summary>

          <template v-if="hasRecovery">
            <p>
              This vault has a recovery key — the {{ recoveryWords }} words you were shown when you
              made it. Enter them and choose a new passphrase.
            </p>
            <form @submit.prevent="doRecover">
              <label class="vault-field">
                <span>Recovery key</span>
                <textarea v-model="recoverPhrase" rows="3" spellcheck="false" autocomplete="off"
                          placeholder="The words, in order, separated by spaces"></textarea>
              </label>
              <p v-if="recoverCheck && !recoverCheck.ok" class="vault-hint">{{ recoverCheck.message }}</p>
              <p v-else-if="recoverCheck && recoverCheck.ok" class="vault-hint">
                <span class="mdi mdi-check" aria-hidden="true"></span>
                {{ recoveryWords }} words, all recognised. The vault will say whether they are the right ones.
              </p>
              <label class="vault-field">
                <span>New passphrase</span>
                <input v-model="recoverPass" type="password" autocomplete="new-password" />
              </label>
              <label class="vault-field">
                <span>Confirm new passphrase</span>
                <input v-model="recoverConfirm" type="password" autocomplete="new-password" />
              </label>
              <p class="vault-hint">
                The forgotten passphrase stops working, and so does this recovery key — it has just
                been typed onto a screen. Make a fresh one afterwards from
                <strong>Recovery key</strong> in settings.
              </p>
              <button class="btn btn-primary" :disabled="busy">
                {{ busy ? 'Recovering…' : 'Recover the vault' }}
              </button>
            </form>
          </template>

          <p v-else>
            Then the vault cannot be opened — that is what the encryption means. There is no
            recovery key on this vault, and one cannot be added without the passphrase, so nothing
            here or anywhere can read it. The only thing left is to clear this site's data in your
            browser and start again.
          </p>
        </details>
      </section>

      <!-- Unlocked -->
      <template v-else-if="state === 'unlocked'">
        <div class="vault-bar">
          <input v-model="query" class="form-input vault-search" type="search"
                 placeholder="Search labels, usernames, sites" aria-label="Search the vault" />
          <button class="btn btn-primary" @click="startAdd"><span class="mdi mdi-plus"></span> Add</button>
          <button class="btn" @click="lock"><span class="mdi mdi-lock"></span> Lock</button>
        </div>

        <!-- Only worth the row once there is enough in the vault to order. -->
        <div v-if="entries.length > 1" class="vault-bar vault-filters">
          <label class="vault-filter">
            <span class="mdi mdi-sort" aria-hidden="true"></span>
            <span class="vault-filter-label">Sort</span>
            <select v-model="sortBy" class="vault-select" aria-label="Sort entries">
              <option v-for="s in sorts" :key="s.id" :value="s.id">{{ s.label }}</option>
            </select>
          </label>
          <!-- Checkboxes rather than a <select>, so several groups can be
               shown at once. Unticking everything means "all", not "none". -->
          <div v-if="knownGroups.length" class="vault-filter vault-groupmenu">
            <button class="vault-select vault-groupmenu-btn" type="button"
                    @click="groupMenuOpen = !groupMenuOpen"
                    :aria-expanded="String(groupMenuOpen)">
              <span class="mdi mdi-folder-outline" aria-hidden="true"></span>
              {{ groupFilterLabel }}
              <span class="mdi mdi-menu-down" aria-hidden="true"></span>
            </button>
            <div v-if="groupMenuOpen" class="vault-groupmenu-panel" role="group" aria-label="Groups to show">
              <label v-for="g in knownGroups" :key="g" class="vault-groupmenu-item">
                <input type="checkbox" :checked="groupFilter.has(g)" @change="toggleGroup(g)" />
                <span>{{ g }}</span>
              </label>
              <label class="vault-groupmenu-item">
                <input type="checkbox" :checked="groupFilter.has(ungrouped)" @change="toggleGroup(ungrouped)" />
                <span>{{ ungrouped }}</span>
              </label>
              <button v-if="groupFilter.size" class="link-button vault-groupmenu-clear" type="button"
                      @click="clearGroupFilter">Show all</button>
            </div>
          </div>
          <!-- Tags intersect where groups union: ticking two means BOTH. -->
          <div v-if="knownTags.length" class="vault-filter vault-tagmenu">
            <button class="vault-select vault-groupmenu-btn" type="button"
                    @click="tagMenuOpen = !tagMenuOpen"
                    :aria-expanded="String(tagMenuOpen)">
              <span class="mdi mdi-tag-multiple-outline" aria-hidden="true"></span>
              {{ tagFilterLabel }}
              <span class="mdi mdi-menu-down" aria-hidden="true"></span>
            </button>
            <div v-if="tagMenuOpen" class="vault-groupmenu-panel" role="group" aria-label="Tags to require">
              <p class="vault-menu-note">Entries must have <strong>all</strong> ticked tags.</p>
              <label v-for="t in knownTags" :key="t" class="vault-groupmenu-item">
                <input type="checkbox" :checked="tagFilter.has(t)" @change="toggleTag(t)" />
                <span>{{ t }}</span>
              </label>
              <button v-if="tagFilter.size" class="link-button vault-groupmenu-clear" type="button"
                      @click="clearTagFilter">Clear tags</button>
            </div>
          </div>
          <label class="vault-filter">
            <input type="checkbox" v-model="grouping" />
            <span class="vault-filter-label">Group them</span>
          </label>
          <button v-if="shown.length > 1" class="link-button vault-foldall" type="button" @click="toggleAll">
            {{ allCollapsed ? 'Expand all' : 'Collapse all' }}
          </button>
          <span class="vault-count">{{ shown.length }} of {{ entries.length }}</span>
        </div>

        <p v-if="reuseSummary" class="vault-nag vault-nag-warn">
          <span class="mdi mdi-content-duplicate" aria-hidden="true"></span>
          {{ reuseSummary }}
          <button class="link-button" type="button" @click="showReusedOnly = !showReusedOnly">
            {{ showReusedOnly ? 'Show all entries' : 'Show only those' }}
          </button>
        </p>

        <!-- Not a bare warning. The old version stated the risk and offered
             nothing to do about it, which is the least useful shape a warning
             can take. -->
        <details v-if="persisted === false" class="vault-warn vault-persist">
          <summary>
            <span class="mdi mdi-database-alert-outline" aria-hidden="true"></span>
            {{ location.kind === 'folder'
              ? 'This browser has not promised to remember where the vault is'
              : 'This browser has not promised to keep the vault' }}
          </summary>

          <!-- What is actually at risk depends on where the vault lives, and
               the difference is the whole point of putting it in a folder.
               Telling someone with a vault in Dropbox that "there is no copy
               of this anywhere else" is simply false. -->
          <p v-if="location.kind === 'folder'">
            Your vault is a file in <strong>{{ location.name }}</strong>, so clearing this
            browser's storage would not touch it. What this browser keeps is the pointer to that
            folder — lose it and the vault is still there, but this browser forgets where, and you
            would open it again with <strong>Open a vault in a folder</strong>.
            <template v-if="storageEstimate">
              This site is using about {{ storageEstimate.used }} of roughly
              {{ storageEstimate.quota }} available.
            </template>
          </p>
          <p v-else>
            Browser storage can be cleared automatically if the device runs short of space. It is
            unlikely
            <template v-if="storageEstimate">
              — this site is using about {{ storageEstimate.used }} of roughly
              {{ storageEstimate.quota }} available
            </template>
            — but "unlikely" is not "no", and there is no copy of this anywhere else.
          </p>
          <p v-if="storagePermission === 'prompt'">
            Your browser will ask you to allow it. <strong>Ask it now</strong> below.
          </p>
          <p v-else-if="storagePermission === 'denied'">
            This browser does not ask — it decides. Chrome and Edge grant it once a site is
            <strong>installed</strong>, bookmarked, or used often enough, and report it as refused
            until then. Installing is the reliable one: use <em>Install</em> or <em>Add to Home
            Screen</em> in the browser menu, and it is usually granted the next time you open the
            vault.
          </p>
          <p v-else>
            Installing the app is the reliable way to get the promise: use <em>Install</em> or
            <em>Add to Home Screen</em> in your browser's menu.
          </p>
          <div class="vault-bar">
            <button class="btn btn-small" type="button" :disabled="askingPersistence"
                    @click="requestPersistence">
              {{ askingPersistence ? 'Asking…' : 'Ask again' }}
            </button>
            <button class="btn btn-small" type="button" @click="openTransfer">Export a backup</button>
          </div>
          <p class="vault-hint">
            Worth saying plainly: none of this is a substitute for a backup. A promise not to evict
            is not a promise against a lost laptop, and clearing your browsing data ignores it
            entirely.
          </p>
        </details>
        <p v-if="backupNag" class="vault-nag">
          <span class="mdi mdi-cloud-off-outline" aria-hidden="true"></span>
          {{ backupNag }}
          <button class="link-button" type="button" @click="openTransfer">Export a backup</button>
        </p>
        <p v-if="needsRekey()" class="vault-warn">
          This vault was created with an older key strength. Changing the passphrase below will
          re-encrypt it at the current {{ iterations }} rounds.
        </p>

        <p v-if="!entries.length" class="vault-empty">
          Nothing kept yet. Generate a password, then use <strong>Keep</strong> to file it here.
        </p>
        <p v-else-if="!shown.length" class="vault-empty">Nothing matches “{{ query }}”.</p>

        <template v-for="g in grouped" :key="g.name">
        <h2 v-if="showGroupHeadings" class="vault-group-head">
          <button class="vault-group-toggle" type="button" @click="toggleGroupOpen(g.name)"
                  :aria-expanded="String(isGroupOpen(g.name))">
            <span :class="['mdi', isGroupOpen(g.name) ? 'mdi-chevron-down' : 'mdi-chevron-right']"
                  aria-hidden="true"></span>
            <span class="mdi mdi-folder-outline" aria-hidden="true"></span>
            {{ g.name }}
            <span class="vault-group-count">{{ g.entries.length }}</span>
          </button>
        </h2>
        <ul v-if="!showGroupHeadings || isGroupOpen(g.name)" class="vault-list">
          <li v-for="e in g.entries" :key="e.id" class="vault-entry"
              :class="{ 'is-collapsed': !isEntryOpen(e.id) }">
            <div class="vault-entry-head">
              <button class="vault-entry-toggle" type="button" @click="toggleEntryOpen(e.id)"
                      :aria-expanded="String(isEntryOpen(e.id))"
                      :aria-label="(isEntryOpen(e.id) ? 'Collapse ' : 'Expand ') + (e.label || 'this entry')">
                <span :class="['mdi', isEntryOpen(e.id) ? 'mdi-chevron-down' : 'mdi-chevron-right']"></span>
              </button>
              <span class="vault-label">{{ e.label || 'Untitled' }}</span>
              <!-- Collapsed, the username is the one thing that still tells
                   two entries on the same site apart. -->
              <span v-if="!isEntryOpen(e.id) && e.username" class="vault-collapsed-user">{{ e.username }}</span>
              <span v-if="tierOf(e.bits)" class="vault-bits" :class="'meter-' + tierOf(e.bits).id">
                {{ e.bits.toFixed(1) }} bits
              </span>
              <!-- Reuse is the one health finding a vault can make with
                   certainty, so it is stated on the entry rather than buried. -->
              <span v-if="reusedWith(e).length" class="vault-reuse" :title="reuseTitle(e)">
                <span class="mdi mdi-content-duplicate" aria-hidden="true"></span>
                reused on {{ reusedWith(e).length }} other{{ reusedWith(e).length === 1 ? '' : 's' }}
              </span>
              <span v-if="e.at" class="vault-date">{{ e.at }}</span>
            </div>
            <div v-if="isEntryOpen(e.id)" class="vault-entry-pw">
              <span class="vault-row-label">Password</span>
              <code>{{ isRevealed(e) ? e.pw : '••••••••••••' }}</code>
              <span class="vault-row-actions">
              <button class="vault-icon" @click="toggleSecret(e)"
                      :aria-label="isRevealed(e) ? 'Hide password' : 'Reveal password'"
                      :title="isRevealed(e) ? 'Hide password' : 'Reveal password'">
                <span :class="['mdi', isRevealed(e) ? 'mdi-eye-off' : 'mdi-eye']"></span>
              </button>
              <!-- Only when there is more than the password to unmask. -->
              <button v-if="hasSeveralSecrets(e)" class="vault-icon" @click="toggleAllSecrets(e)"
                      :aria-label="allRevealed(e) ? 'Hide everything on this entry' : 'Reveal everything on this entry'"
                      :title="allRevealed(e) ? 'Hide all' : 'Reveal all'">
                <span :class="['mdi', allRevealed(e) ? 'mdi-eye-off-outline' : 'mdi-eye-outline']"></span>
              </button>
              <button class="vault-icon" @click="copy(e)" aria-label="Copy password" title="Copy">
                <span class="mdi mdi-content-copy"></span>
              </button>
              <button class="vault-icon" @click="startEdit(e)" aria-label="Edit entry" title="Edit">
                <span class="mdi mdi-pencil"></span>
              </button>
              <button class="vault-icon" @click="remove(e)" aria-label="Delete entry" title="Delete">
                <span class="mdi mdi-delete-outline"></span>
              </button>
              </span>
            </div>
            <div v-if="isEntryOpen(e.id) && (e.username || e.group || (e.urls && e.urls.length))" class="vault-meta">
              <!-- Only when there is no heading above it saying the same thing.
                   Sets the filter to just this group -- the filter is a Set of
                   selected names now, so assigning the bare string would have
                   quietly broken every group comparison. -->
              <button v-if="e.group && !showGroupHeadings" class="vault-group-chip" type="button"
                      @click="groupFilter = new Set([e.group])" :title="'Show only ' + e.group">
                <span class="mdi mdi-folder-outline" aria-hidden="true"></span>{{ e.group }}
              </button>
              <span v-if="e.username" class="vault-user">
                <span class="mdi mdi-account-outline" aria-hidden="true"></span>
                <span class="vault-row-label">User</span>
                <span class="vault-user-value">{{ e.username }}</span>
                <button class="vault-icon" @click="copyText(e.username, 'Username copied.')"
                        aria-label="Copy username" title="Copy username">
                  <span class="mdi mdi-content-copy"></span>
                </button>
              </span>
              <!-- The name when there is one, the host when there is not.
                   "Dev" beats "staging-7.internal.example.com" at a glance,
                   and the full address is still the title and the href. -->
              <a v-for="(u, i) in (e.urls || [])" :key="i" class="vault-url"
                 :href="u.url" :title="u.name ? u.name + ' — ' + u.url : u.url"
                 target="_blank" rel="noopener noreferrer nofollow">
                <span class="mdi mdi-open-in-new" aria-hidden="true"></span>{{ u.name || hostOf(u.url) }}
              </a>
            </div>
            <!-- Tags. Clicking one filters to it, which is the whole reason
                 to have tagged anything. -->
            <div v-if="isEntryOpen(e.id) && e.tags && e.tags.length" class="vault-tags">
              <button v-for="t in e.tags" :key="t" class="vault-tag" type="button"
                      @click="tagFilter = new Set([t])" :title="'Show everything tagged ' + t">
                <span class="mdi mdi-tag-outline" aria-hidden="true"></span>{{ t }}
              </button>
            </div>

            <!-- The current one-time code, with how long it has left. Never
                 masked: it is worthless in seconds, and hiding it behind a
                 reveal would only add a click to the one thing here that is
                 genuinely time-critical. -->
            <div v-if="isEntryOpen(e.id) && e.totp && codeFor(e)" class="vault-totp">
              <span class="mdi mdi-timer-outline" aria-hidden="true"></span>
              <span class="vault-row-label">One-time</span>
              <code class="vault-totp-code">{{ codeFor(e) }}</code>
              <span class="vault-totp-left" :class="{ 'is-expiring': totpLeft <= 5 }">{{ totpLeft }}s</span>
              <button class="vault-icon" @click="copyText(codeFor(e).replace(' ', ''), 'Code copied.')"
                      aria-label="Copy one-time code" title="Copy code">
                <span class="mdi mdi-content-copy"></span>
              </button>
            </div>

            <!-- Extra fields. A secret one is masked and copied through the
                 clipboard timer like the password; a plain one is just text,
                 because hiding a customer number helps nobody. -->
            <dl v-if="isEntryOpen(e.id) && e.fields && e.fields.length" class="vault-fields">
              <template v-for="(f, i) in e.fields" :key="i">
                <dt>{{ f.name || 'Field ' + (i + 1) }}</dt>
                <dd>
                  <code v-if="f.secret">{{ isRevealed(e, 'f' + i) ? f.value : '••••••••' }}</code>
                  <span v-else class="vault-field-value">{{ f.value }}</span>
                  <button v-if="f.secret" class="vault-icon" @click="toggleSecret(e, 'f' + i)"
                          :aria-label="(isRevealed(e, 'f' + i) ? 'Hide ' : 'Reveal ') + (f.name || 'field')"
                          :title="isRevealed(e, 'f' + i) ? 'Hide' : 'Reveal'">
                    <span :class="['mdi', isRevealed(e, 'f' + i) ? 'mdi-eye-off' : 'mdi-eye']"></span>
                  </button>
                  <button class="vault-icon"
                          @click="copyText(f.value, (f.name || 'Field') + ' copied.')"
                          :aria-label="'Copy ' + (f.name || 'field')" :title="'Copy ' + (f.name || 'field')">
                    <span class="mdi mdi-content-copy"></span>
                  </button>
                </dd>
              </template>
            </dl>
            <p v-if="isEntryOpen(e.id) && e.note" class="vault-note">{{ e.note }}</p>
            <details v-if="isEntryOpen(e.id) && e.questions && e.questions.length" class="vault-questions">
              <summary>{{ e.questions.length }} security {{ e.questions.length === 1 ? 'answer' : 'answers' }}</summary>
              <dl>
                <template v-for="(qa, i) in e.questions" :key="i">
                  <dt>{{ qa.q || 'Question ' + (i + 1) }}</dt>
                  <dd>
                    <code>{{ isRevealed(e, 'q' + i) ? qa.a : '••••••••' }}</code>
                    <button class="vault-icon" @click="toggleSecret(e, 'q' + i)"
                            :aria-label="isRevealed(e, 'q' + i) ? 'Hide answer' : 'Reveal answer'"
                            :title="isRevealed(e, 'q' + i) ? 'Hide' : 'Reveal'">
                      <span :class="['mdi', isRevealed(e, 'q' + i) ? 'mdi-eye-off' : 'mdi-eye']"></span>
                    </button>
                    <button class="vault-icon" @click="copyText(qa.a, 'Answer copied.')"
                            aria-label="Copy answer" title="Copy answer">
                      <span class="mdi mdi-content-copy"></span>
                    </button>
                  </dd>
                </template>
              </dl>
            </details>
          </li>
        </ul>
        </template>

        <!-- Add / edit.
             A dialog rather than a panel appended to the page. It used to be
             the last thing in the list, which is fine at two entries and
             absurd at two hundred: editing the first one scrolled you past
             every other to reach the form, and again to get back. -->
        <div v-if="editing" class="vault-modal-backdrop" @pointerdown.self="cancelEdit">
        <div class="vault-card vault-editor" role="dialog" aria-modal="true"
             aria-labelledby="vault-editor-title" ref="editorEl">
          <div class="vault-editor-head">
            <h2 id="vault-editor-title">{{ editing.id ? 'Edit entry' : 'Add an entry' }}</h2>
            <button class="vault-icon" type="button" @click="cancelEdit"
                    aria-label="Close without saving" title="Close">
              <span class="mdi mdi-close"></span>
            </button>
          </div>
          <form @submit.prevent="save(editing)">
            <label class="vault-field">
              <span>Label</span>
              <input v-model="editing.label" type="text" placeholder="What is this for?" />
            </label>
            <!-- Filing goes with the name. Username and password are the
                 credential pair and belong next to each other, so the group
                 sits above them rather than between them. -->
            <label class="vault-field">
              <span>Group</span>
              <input v-model="editing.group" type="text" list="vault-groups"
                     placeholder="Optional — e.g. Finance, Work" />
              <datalist id="vault-groups">
                <option v-for="g in knownGroups" :key="g" :value="g"></option>
              </datalist>
            </label>
            <fieldset class="vault-field vault-qa">
              <legend>Tags</legend>
              <p class="vault-hint">
                As many as you like, unlike the group — the company card really is both Work and
                Finance, and a tag does not make you choose.
              </p>
              <div v-if="editing.tags.length" class="vault-tags vault-tags-edit">
                <button v-for="t in editing.tags" :key="t" class="vault-tag is-on" type="button"
                        @click="editTag(t)" :title="'Remove ' + t">
                  {{ t }}<span class="mdi mdi-close" aria-hidden="true"></span>
                </button>
              </div>
              <div class="vault-qa-row vault-tag-row">
                <input v-model="tagDraft" type="text" spellcheck="false" autocomplete="off"
                       list="vault-tags" placeholder="Add a tag"
                       @keydown.enter.prevent="addTypedTag" />
                <button class="btn btn-small" type="button" @click="addTypedTag">Add</button>
              </div>
              <datalist id="vault-tags">
                <option v-for="t in knownTags" :key="t" :value="t"></option>
              </datalist>
              <div v-if="knownTags.length" class="vault-tags vault-tags-suggest">
                <button v-for="t in knownTags" :key="t" type="button"
                        class="vault-tag" :class="{ 'is-on': editing.tags.includes(t) }"
                        @click="editTag(t)">{{ t }}</button>
              </div>
            </fieldset>
            <label class="vault-field">
              <span>Username</span>
              <input v-model="editing.username" type="text" spellcheck="false"
                     autocomplete="off" placeholder="Email or sign-in name" />
            </label>
            <div class="vault-field">
              <span>Password</span>
              <div class="vault-pw-field">
                <input v-model="editing.pw" :type="editing.revealPw ? 'text' : 'password'"
                       required spellcheck="false" autocomplete="off" aria-label="Password" />
                <button class="vault-icon" type="button" @click="editing.revealPw = !editing.revealPw"
                        :aria-label="editing.revealPw ? 'Hide password' : 'Reveal password'"
                        :title="editing.revealPw ? 'Hide' : 'Reveal'">
                  <span :class="['mdi', editing.revealPw ? 'mdi-eye-off' : 'mdi-eye']"></span>
                </button>
              </div>
              <!-- The generator, without leaving the page. Not a second set of
                   options: each mode runs on the settings its own tab holds. -->
              <div class="vault-gen">
                <select v-model="genMode" class="vault-select" aria-label="Generator to use">
                  <option v-for="m in genModes" :key="m.id" :value="m.id">{{ m.label }}</option>
                </select>
                <button class="btn btn-small" type="button" :disabled="generating"
                        @click="generateInto('pw')">
                  <span class="mdi mdi-refresh"></span> {{ generating ? 'Generating…' : 'Generate' }}
                </button>
                <span v-if="tierOf(editing.bits)" class="vault-bits" :class="'meter-' + tierOf(editing.bits).id">
                  {{ editing.bits.toFixed(1) }} bits
                </span>
                <!-- To the tab being used, not to whichever one was open
                     last. The generator reads the hash as a mode id. -->
                <a class="vault-gen-link" :href="'/#' + genMode" @click="leaveForGenerator"
                   :title="'Open the ' + (genModes.find(m => m.id === genMode) || {}).label + ' generator — this entry is kept'">
                  Change settings
                </a>
              </div>
              <!-- Caught while typing, not on save: the moment to reconsider a
                   reused password is before it is filed under a second name. -->
              <p v-if="editingReuse.length" class="vault-reuse-warn">
                <span class="mdi mdi-alert-outline" aria-hidden="true"></span>
                Already used by
                <strong>{{ editingReuse.map(e => e.label || 'an untitled entry').join(', ') }}</strong>.
                Reuse is what turns one breach into several — generate a new one instead.
              </p>
            </div>
            <!-- Named, because one login routinely covers several hosts that
                 are not interchangeable, and reading hostnames to work out
                 which is the admin panel is a poor way to find out. -->
            <fieldset class="vault-field vault-qa">
              <legend>Web addresses</legend>
              <div v-for="(u, i) in editing.urls" :key="i" class="vault-qa-row vault-url-row">
                <input v-model="u.name" type="text" placeholder="Name (optional)" />
                <input v-model="u.url" type="url" spellcheck="false" autocomplete="off"
                       placeholder="https://…" />
                <button class="vault-icon" type="button" @click="editing.urls.splice(i, 1)"
                        aria-label="Remove this address" title="Remove">
                  <span class="mdi mdi-close"></span>
                </button>
              </div>
              <button class="btn btn-small" type="button" @click="editing.urls.push({ name: '', url: '' })">
                <span class="mdi mdi-plus"></span> Add an address
              </button>
            </fieldset>
            <!-- Not "second username" and "second password" fields. The next
                 account wants a PIN, then a customer number, then a recovery
                 address; a named pair covers all of them. -->
            <fieldset class="vault-field vault-qa">
              <legend>Other fields</legend>
              <p class="vault-hint">
                Anything else the account needs — a second login, a PIN, a customer number.
                Mark it secret and it is masked, copied through the clipboard timer, and can be
                generated like a password.
              </p>
              <div v-for="(f, i) in editing.fields" :key="i" class="vault-qa-row vault-extra-row">
                <input v-model="f.name" type="text" placeholder="Name" />
                <input v-model="f.value" :type="f.secret ? 'password' : 'text'"
                       spellcheck="false" autocomplete="off" placeholder="Value" />
                <label class="vault-secret-toggle" :title="f.secret ? 'Treated as a secret' : 'Stored as plain text'">
                  <input type="checkbox" v-model="f.secret" />
                  <span class="mdi" :class="f.secret ? 'mdi-lock' : 'mdi-lock-open-variant-outline'"
                        aria-hidden="true"></span>
                  <span class="vault-secret-label">Secret</span>
                </label>
                <button class="vault-icon" type="button" :disabled="generating"
                        @click="generateInto({ field: i })"
                        aria-label="Generate a value" title="Generate a value">
                  <span class="mdi mdi-refresh"></span>
                </button>
                <button class="vault-icon" type="button" @click="removeField(i)"
                        aria-label="Remove this field" title="Remove">
                  <span class="mdi mdi-close"></span>
                </button>
              </div>
              <div class="vault-bar">
                <button class="btn btn-small" type="button" @click="addField(false)">
                  <span class="mdi mdi-plus"></span> Add a field
                </button>
                <button class="btn btn-small" type="button" @click="addField(true)">
                  <span class="mdi mdi-lock"></span> Add a secret
                </button>
              </div>
            </fieldset>
            <fieldset class="vault-field vault-qa">
              <legend>One-time code</legend>
              <!-- The warning is above the input, not below it, and not
                   collapsed. It is the reason to hesitate and it should be
                   read before the secret is pasted, not after. -->
              <p class="vault-totp-warn">
                <span class="mdi mdi-alert-outline" aria-hidden="true"></span>
                <span>
                  <strong>Lose this vault and you are locked out of the account.</strong>
                  The seed lives only here. If this browser's data goes and you have no backup,
                  the password is gone <em>and</em> so is the second factor — which is exactly the
                  situation the second factor exists to survive. Export a backup, and keep the
                  provider's own recovery codes somewhere else entirely.
                </span>
              </p>
              <p class="vault-totp-warn">
                <span class="mdi mdi-shield-alert-outline" aria-hidden="true"></span>
                <span>
                  <strong>And it weakens two-factor authentication.</strong> A one-time code is a
                  second factor only while it is kept apart from the password. Storing the seed
                  here means whoever opens this vault has both. It still helps against a password
                  leaked by the site — the common case — and it is the same trade every password
                  manager offering this makes quietly. Keep the codes in a separate app if you
                  would rather not make it.
                </span>
              </p>
              <div v-if="editing.totp" class="vault-totp-set">
                <span class="mdi mdi-check-circle-outline" aria-hidden="true"></span>
                <span>
                  Code set{{ editing.totp.issuer ? ' for ' + editing.totp.issuer : '' }}<template
                    v-if="editing.totp.account"> ({{ editing.totp.account }})</template> —
                  {{ editing.totp.digits }} digits, every {{ editing.totp.period }}s,
                  {{ editing.totp.algorithm }}
                </span>
                <button class="btn btn-small" type="button" @click="clearTotp">Remove</button>
              </div>
              <template v-else>
                <div class="vault-qa-row vault-totp-row">
                  <input v-model="totpInput" type="text" spellcheck="false" autocomplete="off"
                         placeholder="otpauth://… link, or the base32 secret"
                         @keydown.enter.prevent="applyTotp" />
                  <button class="btn btn-small" type="button" @click="applyTotp">Add</button>
                </div>
                <p v-if="totpError" class="vault-reuse-warn">
                  <span class="mdi mdi-alert-outline" aria-hidden="true"></span>
                  {{ totpError }}
                </p>
                <p class="vault-hint">
                  Most sites show a "can't scan the code?" link next to the QR image with the secret
                  in text. Pasting the whole <code>otpauth://</code> link is safest — it carries the
                  digit count and interval too.
                </p>
              </template>
            </fieldset>
            <fieldset class="vault-field vault-qa">
              <legend>Security questions</legend>
              <p class="vault-hint">
                Answers are secrets too — and they need not be true. An invented answer you keep here
                is stronger than your real mother's maiden name, which is a matter of public record.
              </p>
              <div v-for="(qa, i) in editing.questions" :key="i" class="vault-qa-row">
                <input v-model="qa.q" type="text" placeholder="Question" />
                <input v-model="qa.a" type="text" spellcheck="false" placeholder="Answer" />
                <button class="vault-icon" type="button" :disabled="generating"
                        @click="generateInto(i)"
                        aria-label="Generate an answer" title="Generate an answer">
                  <span class="mdi mdi-refresh"></span>
                </button>
                <button class="vault-icon" type="button" @click="removeQuestion(i)"
                        aria-label="Remove this question" title="Remove">
                  <span class="mdi mdi-close"></span>
                </button>
              </div>
              <button class="btn btn-small" type="button" @click="addQuestion">
                <span class="mdi mdi-plus"></span> Add a question
              </button>
            </fieldset>
            <label class="vault-field">
              <span>Note</span>
              <textarea v-model="editing.note" rows="2"></textarea>
            </label>
            <div class="vault-bar vault-editor-actions">
              <button class="btn btn-primary" :disabled="busy">Save</button>
              <button class="btn" type="button" @click="cancelEdit">Cancel</button>
            </div>
          </form>
        </div>
        </div>

        <details class="vault-transfer" ref="transferEl">
          <summary>Backup, export and import</summary>
          <p v-if="location.kind === 'folder'">
            The vault is a file in <strong>{{ location.name }}</strong>, so it is as safe as that
            folder is. A backup is still worth having: it is a snapshot, and the file in the folder
            is not — an entry deleted there is deleted everywhere the folder goes.
          </p>
          <p v-else>
            The vault lives in this browser and nowhere else. Clearing site data, losing the device,
            or a browser deciding it needs the space would all take it with them, so keep a backup
            somewhere you would still have it afterwards.
          </p>
          <p v-if="exported" class="vault-hint">
            Saved this session. A backup is a snapshot: anything added after it was made is not in it.
          </p>
          <div class="vault-bar">
            <button class="btn btn-primary" type="button" @click="exportVault('backup')">
              <span class="mdi mdi-download-lock"></span> Encrypted backup
            </button>
            <label class="btn vault-file-btn">
              <span class="mdi mdi-upload"></span> Import a file
              <input type="file" accept=".json,.csv,application/json,text/csv"
                     class="vault-file" @change="importFile" />
            </label>
          </div>
          <p class="vault-hint">
            A backup is the sealed vault itself: encrypted, safe to keep in cloud storage, and it
            opens with the passphrase it was made with — which is not necessarily the one this vault
            uses now. Importing adds entries; it never removes or overwrites what is already here.
          </p>

          <!-- Recorded inside the vault, so this is every browser's history of
               it rather than this one's. The count is what the vault held at
               the time, which is what makes an old backup legible: "3 entries"
               against today's 40 says more than the date does. -->
          <details v-if="backups.length" class="vault-backups">
            <summary>
              {{ backups.length === 1 ? 'One backup recorded' : backups.length + ' recent backups' }}
            </summary>
            <ul>
              <li v-for="(b, i) in backups" :key="b.at + '-' + i">
                <span class="vault-backup-when">{{ backupWhen(b.at) }}</span>
                <span class="vault-backup-what">
                  {{ b.count }} {{ b.count === 1 ? 'entry' : 'entries' }}<template v-if="b.by"> · {{ b.by }}</template>
                </span>
              </li>
            </ul>
            <p class="vault-hint">
              Kept in the vault, not in this browser, so every machine that opens it sees the same
              list. Only encrypted backups are recorded — a plain-text export is not a backup. This
              is a note that a file was made, not proof it still exists.
            </p>
          </details>

          <div class="vault-plain">
            <p>
              <strong>Plain-text export.</strong> For moving into another password manager, and only
              that. These files are readable by anything that opens them — including whatever else
              can read your downloads folder. Delete the file as soon as the move is done.
            </p>
            <div class="vault-bar">
              <button class="btn btn-small" type="button" @click="exportVault('plain')">JSON, unencrypted</button>
              <button class="btn btn-small" type="button" @click="exportVault('csv')">CSV, unencrypted</button>
            </div>
            <p class="vault-hint">
              CSV is what other managers read, and it is flat: only the first web address survives,
              and security questions are folded into the note.
            </p>
          </div>
        </details>

        <details class="vault-danger">
          <summary>
            Where the vault is kept
            <span class="vault-chip-on">{{ location.kind === 'folder' ? location.name : 'this browser' }}</span>
          </summary>

          <p v-if="location.kind === 'folder'">
            The encrypted vault is a file in <strong>{{ location.name }}</strong>. If that folder is
            one your computer already syncs — Dropbox, OneDrive, iCloud Drive — then it is backed up
            and carried between machines by whatever you already use, and we never see any of it.
          </p>
          <p v-else>
            The vault lives in this browser's storage, on this device only. That works, and it means
            the vault is exactly as durable as this browser profile: clearing site data takes it with
            everything else.
          </p>

          <p class="vault-hint">
            Either way the file is the same ciphertext. Putting it in a synced folder tells your
            cloud provider that a file changed and roughly how big it is — never what is in it.
          </p>
          <p v-if="location.kind === 'folder'" class="vault-warn">
            <strong>One device at a time, for now.</strong> Two computers writing the same folder
            will overwrite each other rather than merging, and the slower one loses. Reconciling two
            copies is built and tested but not yet wired in.
          </p>

          <template v-if="canFolder">
            <div class="vault-row-actions">
              <template v-if="location.kind !== 'folder'">
                <button class="btn" type="button" :disabled="busy" @click="chooseFolder">
                  <span class="mdi mdi-folder-outline" aria-hidden="true"></span>
                  {{ busy ? 'Moving…' : 'Move it to a folder…' }}
                </button>
                <button class="btn" type="button" :disabled="busy" @click="openFolder">
                  <span class="mdi mdi-folder-open-outline" aria-hidden="true"></span>
                  Open a vault in a folder…
                </button>
              </template>
              <template v-else>
                <button class="btn" type="button" :disabled="busy" @click="chooseFolder">
                  Move to a different folder…
                </button>
                <button class="btn" type="button" :disabled="busy" @click="useThisBrowser">
                  Bring it back to this browser
                </button>
              </template>
            </div>
            <p class="vault-hint">
              <strong>Move</strong> takes the vault from here and puts it there: copy, read it back
              to check it arrived, record the new location, and only then remove the old copy. If any
              step fails nothing is changed, and a folder that already holds a vault is refused
              rather than overwritten. <strong>Open</strong> is the opposite — it expects a vault to
              be there already, writes nothing, and is how a second computer joins.
            </p>
          </template>
          <p v-else class="vault-hint">
            This browser cannot open folders — the File System Access API is Chromium desktop only
            today. The vault stays in this browser here, and an encrypted backup is the way to move
            it somewhere else.
          </p>
        </details>

        <details class="vault-danger" :open="recoveryOpen || offerRecovery">
          <summary>Recovery key <span v-if="hasRecovery" class="vault-chip-on">on</span></summary>

          <p v-if="offerRecovery" class="vault-hint">
            Worth doing now, while you are thinking about it. A vault with no recovery key and a
            forgotten passphrase is unreadable by everyone, including us.
          </p>

          <p>
            A second way in, for the one failure a backup cannot fix: forgetting the passphrase. A
            backup protects the <em>data</em>; if you cannot decrypt it, it is as lost as no backup
            at all. These solve different problems and you want both.
          </p>
          <p class="vault-warn">
            <strong>It is a second key to everything in the vault.</strong> Anyone holding it can
            read the lot without knowing your passphrase, so keep it where you would keep a spare
            house key — on paper is fine, in the vault is not.
          </p>
          <p class="vault-hint">
            {{ recoveryWords }} words, generated here and never chosen by you. That is not fussiness:
            an attacker takes whichever key is cheaper to break, so a memorable recovery phrase
            would quietly become the real strength of your vault no matter how good the passphrase
            is.
          </p>

          <form @submit.prevent="hasRecovery ? disableRecovery() : enableRecovery()">
            <label class="vault-field">
              <span>Passphrase</span>
              <input v-model="recoveryPass" type="password" autocomplete="current-password" />
            </label>
            <p class="vault-hint">
              Required even though the vault is open: an unlocked tab proves a tab is open, not who
              is asking.
            </p>
            <div class="vault-row-actions">
              <button v-if="!hasRecovery" class="btn btn-primary" :disabled="busy">
                {{ busy ? 'Making…' : 'Make a recovery key' }}
              </button>
              <template v-else>
                <button class="btn" type="button" :disabled="busy" @click="enableRecovery">
                  {{ busy ? 'Making…' : 'Replace it' }}
                </button>
                <button class="btn" :disabled="busy">Remove it</button>
              </template>
            </div>
            <p v-if="hasRecovery" class="vault-hint">
              Replacing retires the old one immediately — the paper you already have stops working.
              There is no way to show the current key again; the vault holds it encrypted, not
              stored.
            </p>
          </form>
        </details>

        <details class="vault-danger" :open="rekeyOpen">
          <summary>Change the passphrase</summary>
          <form @submit.prevent="rekey">
            <label class="vault-field">
              <span>Current passphrase</span>
              <input v-model="oldPass" type="password" autocomplete="current-password" />
            </label>
            <label class="vault-field">
              <span>New passphrase</span>
              <input v-model="newPass" type="password" autocomplete="new-password" />
            </label>
            <div v-if="rekeyStrength" class="pass-strength">
              <span class="pass-meter" :class="'meter-' + rekeyStrength.tier.id">
                <span class="pass-meter-fill" :style="{ width: rekeyStrength.pct + '%' }"></span>
              </span>
              <span class="pass-figure">at most {{ rekeyStrength.bits.toFixed(0) }} bits</span>
              <span class="pass-tier" :class="'meter-' + rekeyStrength.tier.id">{{ rekeyStrength.tier.label }}</span>
            </div>
            <button class="btn" :disabled="busy">{{ busy ? 'Re-encrypting…' : 'Change passphrase' }}</button>
          </form>
        </details>

        <details class="vault-danger">
          <summary>Delete the vault</summary>
          <p>Everything in it goes with it. Your passphrase is required.</p>
          <form @submit.prevent="destroy">
            <label class="vault-field">
              <span>Passphrase</span>
              <input v-model="pass" type="password" autocomplete="current-password" />
            </label>
            <button class="btn" :disabled="busy">Delete vault</button>
          </form>
        </details>

        <p class="vault-foot">
          Locks itself after {{ autoLockMinutes }} minutes idle. Encrypted with {{ iterations }}
          PBKDF2 rounds; the key exists only while the vault is open.
        </p>
      </template>

      <section v-else-if="state === 'error'" class="vault-card">
        <h2>The vault could not be read</h2>
        <p>{{ error }} Reload the page; if this persists, your browser may be blocking storage for this site.</p>
      </section>
    </div>
  `,
}

initTheme()
mountSiteHeader(document.querySelector('[data-site-header]'))
mountSiteFooter(document.querySelector('[data-site-footer]'), {
  settings: { extraSections: [clipboardClearSection(), vaultLockSection()] },
})
createApp(App).mount('#vault-app')
