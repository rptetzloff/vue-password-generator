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
  groupsOf, groupEntries, sortEntries, reuseIndex, SORTS, UNGROUPED,
} from './vault-store.js'
import { MODES, readSettings, loadData, generateWithRetry } from './generators.js'
import { scheduleClipboardClear, clipboardClearSection } from './clipboard-clear.js'
import {
  exportBackup, exportPlainJson, exportCsv, parseTransfer, transferFilename,
} from './vault-transfer.js'
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

    const store = createVaultStore({
      autoLockMs: vaultLockMs(),
      // The same window governs idle auto-lock and staying unlocked between
      // pages, so there is one number for a reader to reason about.
      staySignedInMs: vaultLockMs(),
      onChange: (s) => {
        state.value = s
        entries.value = s === 'unlocked' ? store.list() : []
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
        flash('Vault created.')
      })
    }

    const unlock = () => run(
      async () => { await store.unlock(pass.value); clearPass() },
      'That passphrase did not open the vault.',
    )

    const lock = () => { store.lock(); revealed.value = new Set(); flash('Locked.') }

    const save = (entry) => run(async () => {
      const payload = { ...entry, urls: (entry.urlText || '').split('\n') }
      delete payload.urlText
      // View state, not entry data -- normalizeEntry would drop it anyway, but
      // sending it at all invites someone to start persisting it.
      delete payload.revealPw
      if (payload.id) await store.update(payload.id, payload)
      else await store.add(payload)
      entries.value = store.list()
      editing.value = null
      flash('Saved.')
    })

    const remove = (entry) => run(async () => {
      // The label is the only thing safe to echo in a confirm dialog.
      const what = entry.label || 'this entry'
      if (!confirm(`Delete ${what}? This cannot be undone.`)) return
      await store.remove(entry.id)
      entries.value = store.list()
      flash('Deleted.')
    })

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

    const toggleReveal = (id) => {
      const next = new Set(revealed.value)
      next.has(id) ? next.delete(id) : next.add(id)
      revealed.value = next
      store.touch()
    }

    const startAdd = () => {
      editing.value = {
        id: null, label: '', username: '', pw: '', urlText: '', note: '',
        // With exactly one group filtered to, a new entry lands in it -- that
        // is nearly always the one intended. With several, guessing would be
        // worse than leaving it blank.
        group: (groupFilter.value.size === 1 && [...groupFilter.value][0] !== UNGROUPED)
          ? [...groupFilter.value][0] : '',
        questions: [], fields: [], bits: null, revealPw: false,
      }
    }
    const startEdit = (entry) => {
      // URLs edit as one-per-line text; questions as a repeatable pair list.
      editing.value = {
        ...entry,
        urlText: (entry.urls || []).join('\n'),
        questions: (entry.questions || []).map((qa) => ({ ...qa })),
        fields: (entry.fields || []).map((f) => ({ ...f })),
        revealPw: false,
      }
    }
    const addQuestion = () => { editing.value.questions.push({ q: '', a: '' }) }
    const removeQuestion = (i) => { editing.value.questions.splice(i, 1) }

    const addField = (secret = false) => { editing.value.fields.push({ name: '', value: '', secret }) }
    const removeField = (i) => { editing.value.fields.splice(i, 1) }

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
      if (!groupMenuOpen.value) return
      if (event.type === 'keydown') {
        if (event.key === 'Escape') groupMenuOpen.value = false
        return
      }
      if (!event.target.closest('.vault-groupmenu')) groupMenuOpen.value = false
    }

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
     * A date and a count, nothing else -- this is the one piece of vault state
     * that has to survive being locked, so it cannot live inside the
     * ciphertext, and anything more revealing has no business in the clear.
     */
    const EXPORT_KEY = 'global.vaultExported'
    const lastExport = ref(null)
    const readLastExport = () => {
      try {
        const v = JSON.parse(localStorage.getItem(EXPORT_KEY))
        lastExport.value = v && Number.isFinite(v.count) ? v : null
      } catch { lastExport.value = null }
    }
    const noteExport = (count) => {
      const v = { at: new Date().toISOString().slice(0, 10), count }
      try { localStorage.setItem(EXPORT_KEY, JSON.stringify(v)) } catch {}
      lastExport.value = v
    }

    /**
     * The nag, and it is deliberately only a line of text. A vault in one
     * browser profile is one "clear site data" from gone, which is worth
     * saying -- but a modal between someone and their passwords would be a
     * worse thing to have built than no reminder at all.
     */
    const backupNag = computed(() => {
      if (!entries.value.length) return ''
      if (!lastExport.value) return 'This vault has never been exported. If this browser loses its data, it is gone.'
      const drift = entries.value.length - lastExport.value.count
      if (drift > 0) {
        return `${drift} ${drift === 1 ? 'entry' : 'entries'} added since the last backup on ${lastExport.value.at}.`
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

    const exportVault = (kind) => {
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
        if (kind === 'backup') noteExport(store.list().length)
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

    const destroy = () => {
      if (!confirm('Delete the entire vault and everything in it? This cannot be undone.')) return
      return run(async () => {
        await store.destroy(pass.value)
        clearPass()
        flash('Vault deleted.')
      }, 'That passphrase is not right, so nothing was deleted.')
    }

    const shown = computed(() => {
      const q = query.value.trim().toLowerCase()
      const groups = groupFilter.value
      return entries.value.filter((e) => {
        if (groups.size && !groups.has(e.group || UNGROUPED)) return false
        if (showReusedOnly.value && !reuse.value.has(e.id)) return false
        if (!q) return true
        return [e.label, e.username, e.note, e.group, ...(e.urls || [])]
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
    const activity = () => store.touch()
    onMounted(async () => {
      try {
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
      timer = setInterval(() => { if (store.lockIfIdle()) revealed.value = new Set() }, 5000)
      for (const ev of ['pointerdown', 'keydown']) window.addEventListener(ev, activity, true)
      for (const ev of ['pointerdown', 'keydown']) window.addEventListener(ev, dismissGroupMenu)
    })
    onUnmounted(() => {
      clearInterval(timer)
      for (const ev of ['pointerdown', 'keydown']) window.removeEventListener(ev, activity, true)
      for (const ev of ['pointerdown', 'keydown']) window.removeEventListener(ev, dismissGroupMenu)
    })

    return {
      state, entries, shown, error, notice, busy, query, revealed, editing,
      persisted, rekeyOpen, pass, passConfirm, oldPass, newPass,
      create, unlock, lock, save, remove, copy, copyText, hostOf, toggleReveal,
      startAdd, startEdit, rekey, destroy, tierOf,
      addQuestion, removeQuestion, addField, removeField,
      toggleGroupOpen, isGroupOpen, toggleEntryOpen, isEntryOpen, allCollapsed, toggleAll,
      exportVault, importFile, exported,
      backupNag, lastExport, openTransfer, transferEl,
      newStrength, rekeyStrength,
      genModes, genMode, generating, generateInto,
      sortBy, sorts: SORTS, knownGroups, grouped, showGroupHeadings,
      ungrouped: UNGROUPED, grouping,
      groupFilter, groupMenuOpen, toggleGroup, clearGroupFilter, groupFilterLabel,
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

      <div v-if="state === 'loading'" class="vault-empty">Opening…</div>

      <!-- No vault yet -->
      <section v-else-if="state === 'absent'" class="vault-card">
        <h2>Create a vault</h2>
        <p>
          Keep the passwords you generate, on this device only. The vault is encrypted with a
          passphrase you choose — {{ iterations }} PBKDF2 rounds — and nothing is ever sent anywhere.
        </p>
        <p class="vault-warn">
          <strong>There is no recovery.</strong> No account, no server, no reset link: if you forget
          this passphrase the vault cannot be opened by anyone, including us. Pick something you can
          remember, and export a backup once you have entries worth keeping.
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
        <details class="vault-danger">
          <summary>Forgotten the passphrase?</summary>
          <p>
            Then the vault cannot be opened — that is what the encryption means. The only thing left
            is to delete it and start again, which needs the passphrase too, so in practice a
            forgotten vault stays until you clear this site's data in your browser.
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
            This browser has not promised to keep the vault
          </summary>
          <p>
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
              <code>{{ revealed.has(e.id) ? e.pw : '••••••••••••' }}</code>
              <button class="vault-icon" @click="toggleReveal(e.id)"
                      :aria-label="revealed.has(e.id) ? 'Hide password' : 'Reveal password'"
                      :title="revealed.has(e.id) ? 'Hide' : 'Reveal'">
                <span :class="['mdi', revealed.has(e.id) ? 'mdi-eye-off' : 'mdi-eye']"></span>
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
                <span>{{ e.username }}</span>
                <button class="vault-icon" @click="copyText(e.username, 'Username copied.')"
                        aria-label="Copy username" title="Copy username">
                  <span class="mdi mdi-content-copy"></span>
                </button>
              </span>
              <a v-for="u in (e.urls || [])" :key="u" class="vault-url" :href="u" :title="u"
                 target="_blank" rel="noopener noreferrer nofollow">
                <span class="mdi mdi-open-in-new" aria-hidden="true"></span>{{ hostOf(u) }}
              </a>
            </div>
            <!-- Extra fields. A secret one is masked and copied through the
                 clipboard timer like the password; a plain one is just text,
                 because hiding a customer number helps nobody. -->
            <dl v-if="isEntryOpen(e.id) && e.fields && e.fields.length" class="vault-fields">
              <template v-for="(f, i) in e.fields" :key="i">
                <dt>{{ f.name || 'Field ' + (i + 1) }}</dt>
                <dd>
                  <code v-if="f.secret">{{ revealed.has(e.id) ? f.value : '••••••••' }}</code>
                  <span v-else class="vault-field-value">{{ f.value }}</span>
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
                    <code>{{ revealed.has(e.id) ? qa.a : '••••••••' }}</code>
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

        <!-- Add / edit -->
        <div v-if="editing" class="vault-card vault-editor">
          <h2>{{ editing.id ? 'Edit entry' : 'Add an entry' }}</h2>
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
                <a class="vault-gen-link" href="/">Change settings</a>
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
            <label class="vault-field">
              <span>Web addresses</span>
              <textarea v-model="editing.urlText" rows="2" spellcheck="false"
                        placeholder="One per line"></textarea>
            </label>
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
            <div class="vault-bar">
              <button class="btn btn-primary" :disabled="busy">Save</button>
              <button class="btn" type="button" @click="editing = null">Cancel</button>
            </div>
          </form>
        </div>

        <details class="vault-transfer" ref="transferEl">
          <summary>Backup, export and import</summary>
          <p>
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
