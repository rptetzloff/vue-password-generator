// The vault page (ROADMAP 9a). A second small Vue app, separate from the
// generator's, because the two share nothing but the design tokens -- and
// main.js is already three thousand lines.
//
// Everything cryptographic lives in vault-crypto.js and everything stateful
// in vault-store.js; this file is the view. It holds the passphrase only for
// the instant it takes to unlock, and never writes it anywhere.

import { createApp, ref, computed, onMounted, onUnmounted, nextTick } from '../vendor/vue.esm-browser.prod.js'
import { createVaultStore, vaultLockMs, vaultLockSection } from './vault-store.js'
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
      busy.value = true
      // Let the button's disabled state paint before a 600k-round derivation
      // blocks the thread, or the UI appears frozen with no explanation.
      await nextTick()
      try {
        await fn()
      } catch (e) {
        error.value = failure || e.message
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
      if (entry.id) await store.update(entry.id, entry)
      else await store.add(entry)
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

    const copy = async (entry) => {
      try {
        await navigator.clipboard.writeText(entry.pw)
        flash('Copied.')
      } catch { error.value = 'The clipboard refused the copy.' }
    }

    const toggleReveal = (id) => {
      const next = new Set(revealed.value)
      next.has(id) ? next.delete(id) : next.add(id)
      revealed.value = next
      store.touch()
    }

    const startAdd = () => { editing.value = { id: null, label: '', pw: '', note: '', bits: null } }
    const startEdit = (entry) => { editing.value = { ...entry } }

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
      return entries.value.filter((e) =>
        e.label.toLowerCase().includes(q) || e.note.toLowerCase().includes(q))
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
      create, unlock, lock, save, remove, copy, toggleReveal,
      startAdd, startEdit, rekey, destroy, tierOf,
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
                 placeholder="Search labels and notes" aria-label="Search the vault" />
          <button class="btn btn-primary" @click="startAdd"><span class="mdi mdi-plus"></span> Add</button>
          <button class="btn" @click="lock"><span class="mdi mdi-lock"></span> Lock</button>
        </div>

        <p v-if="persisted === false" class="vault-warn">
          Your browser has not promised to keep this vault: it may be evicted if the device runs
          short of storage. Export a backup.
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
            <p v-if="e.note" class="vault-note">{{ e.note }}</p>
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
              <span>Password</span>
              <input v-model="editing.pw" type="text" required spellcheck="false" />
            </label>
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
  settings: { extraSections: [vaultLockSection()] },
})
createApp(App).mount('#vault-app')
