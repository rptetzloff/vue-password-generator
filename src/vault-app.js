// The vault page (ROADMAP 9a). A second small Vue app, separate from the
// generator's, because the two share nothing but the design tokens -- and
// main.js is already three thousand lines.
//
// Everything cryptographic lives in vault-crypto.js and everything stateful
// in vault-store.js; this file is the view. It holds the passphrase only for
// the instant it takes to unlock, and never writes it anywhere.

import { createApp, ref, computed, onMounted, onUnmounted, nextTick } from '../vendor/vue.esm-browser.prod.js'
import { createVaultStore, vaultLockMs, vaultLockSection } from './vault-store.js'
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
      editing.value = { id: null, label: '', username: '', pw: '', urlText: '', note: '', questions: [], bits: null }
    }
    const startEdit = (entry) => {
      // URLs edit as one-per-line text; questions as a repeatable pair list.
      editing.value = {
        ...entry,
        urlText: (entry.urls || []).join('\n'),
        questions: (entry.questions || []).map((qa) => ({ ...qa })),
      }
    }
    const addQuestion = () => { editing.value.questions.push({ q: '', a: '' }) }
    const removeQuestion = (i) => { editing.value.questions.splice(i, 1) }

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
      if (!q) return entries.value
      return entries.value.filter((e) => [e.label, e.username, e.note, ...(e.urls || [])]
        .some((field) => (field || '').toLowerCase().includes(q)))
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
      if (navigator.storage?.persisted) {
        try { persisted.value = await navigator.storage.persisted() } catch {}
      }
      readLastExport()
      timer = setInterval(() => { if (store.lockIfIdle()) revealed.value = new Set() }, 5000)
      for (const ev of ['pointerdown', 'keydown']) window.addEventListener(ev, activity, true)
    })
    onUnmounted(() => {
      clearInterval(timer)
      for (const ev of ['pointerdown', 'keydown']) window.removeEventListener(ev, activity, true)
    })

    return {
      state, entries, shown, error, notice, busy, query, revealed, editing,
      persisted, rekeyOpen, pass, passConfirm, oldPass, newPass,
      create, unlock, lock, save, remove, copy, copyText, hostOf, toggleReveal,
      startAdd, startEdit, rekey, destroy, tierOf,
      addQuestion, removeQuestion, exportVault, importFile, exported,
      backupNag, lastExport, openTransfer, transferEl,
      newStrength, rekeyStrength,
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

        <p v-if="persisted === false" class="vault-warn">
          Your browser has not promised to keep this vault: it may be evicted if the device runs
          short of storage. Export a backup.
        </p>
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

        <ul class="vault-list">
          <li v-for="e in shown" :key="e.id" class="vault-entry">
            <div class="vault-entry-head">
              <span class="vault-label">{{ e.label || 'Untitled' }}</span>
              <span v-if="tierOf(e.bits)" class="vault-bits" :class="'meter-' + tierOf(e.bits).id">
                {{ e.bits.toFixed(1) }} bits
              </span>
              <span v-if="e.at" class="vault-date">{{ e.at }}</span>
            </div>
            <div class="vault-entry-pw">
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
            <div v-if="e.username || (e.urls && e.urls.length)" class="vault-meta">
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
            <p v-if="e.note" class="vault-note">{{ e.note }}</p>
            <details v-if="e.questions && e.questions.length" class="vault-questions">
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

        <!-- Add / edit -->
        <div v-if="editing" class="vault-card vault-editor">
          <h2>{{ editing.id ? 'Edit entry' : 'Add an entry' }}</h2>
          <form @submit.prevent="save(editing)">
            <label class="vault-field">
              <span>Label</span>
              <input v-model="editing.label" type="text" placeholder="What is this for?" />
            </label>
            <label class="vault-field">
              <span>Username</span>
              <input v-model="editing.username" type="text" spellcheck="false"
                     autocomplete="off" placeholder="Email or sign-in name" />
            </label>
            <label class="vault-field">
              <span>Password</span>
              <input v-model="editing.pw" type="text" required spellcheck="false" />
            </label>
            <label class="vault-field">
              <span>Web addresses</span>
              <textarea v-model="editing.urlText" rows="2" spellcheck="false"
                        placeholder="One per line"></textarea>
            </label>
            <fieldset class="vault-field vault-qa">
              <legend>Security questions</legend>
              <p class="vault-hint">
                Answers are secrets too — and they need not be true. An invented answer you keep here
                is stronger than your real mother's maiden name, which is a matter of public record.
              </p>
              <div v-for="(qa, i) in editing.questions" :key="i" class="vault-qa-row">
                <input v-model="qa.q" type="text" placeholder="Question" />
                <input v-model="qa.a" type="text" spellcheck="false" placeholder="Answer" />
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
