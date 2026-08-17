import { createApp, ref, computed, watch, onMounted, nextTick } from '../vendor/vue.runtime.esm-browser.prod.js'
import { renderAdvancedPassword, renderAffixPicker, renderApp, renderEntropyPanel, renderHistoryStrip, renderKeepButton, renderMadLib, renderNumbersPassword, renderPassphrase, renderSimplePassword, renderWifiWords, renderWordsPassword } from './main.render.js'
import {
  SPECIAL_CHARS,
  DIGITS,
  randInt,
  randPick,
  randBool,
  randChar,
  resolveToken,
  SEPARATOR_OPTIONS,
  AFFIX_OPTIONS,
  SUFFIX_OPTIONS,
  resolveSuffixToken,
  applyCapitalization,
  LEET_MAP,
  EMOJI_POOLS,
  pickEmoji,
  applyLeet,
  historyKeysIn,
  normalizeHistory,
  isPerGapSeparator,
  joinPerGap,
  PER_GAP_SEPARATORS,
  stripAmbiguous,
} from '../core/generate/lib.js'
import {
  simpleBits, advancedBits, wordsBits, slotBits, wirelessBits, numbersBits,
  ENTROPY_FLOOR, entropyTier, METER_MAX, tokenBits, suffixBits,
  REFERENCE_PER_CHAR, MAIN_LIST_WORD_BITS, ATTACK_SCENARIOS, crackSeconds, formatGuessTime,
} from '../core/generate/entropy.js'

// 6b, extended to the controls themselves: every option in the separator,
// affix and capitalization pickers states its worth where it is chosen. The
// separator/affix figures follow the look-alike toggle, since exclusion
// shrinks the pools they draw from.
const fmtBits = (b) => (b === 0 ? '0 bits' : `${b.toFixed(1)} bits`)
const sepOptionMeta = (value, excl) => {
  if (isPerGapSeparator(value)) return `${tokenBits(PER_GAP_SEPARATORS[value], excl).toFixed(1)} bits/gap`
  return fmtBits(tokenBits(value, excl))
}
const affixOptionMeta = (value, excl) => fmtBits(tokenBits(value, excl))
const suffixOptionMeta = (value, prefixValue, excl) => {
  if (value === 'mirror') return '0 bits'
  return fmtBits(suffixBits(value, prefixValue, excl))
}
const capOptionMeta = (mode) => (mode === 'random' ? '1 bit/letter' : mode === 'word-random' ? '1 bit/word' : '0 bits')
import { getHistoryKey, encryptJSON, decryptJSON, isEncryptedEnvelope } from './history-crypto.js'
import { createVaultStore } from './vault-store.js'
import { vaultLockMs, vaultLockSection } from './vault-settings.js'
import { scheduleClipboardClear, clipboardClearSection } from './clipboard-clear.js'
import {
  MODES, MADLIB_TEMPLATES, ALL_SYMBOLS, draw, build, generate, WIRELESS_MIN,
} from '../core/generate/generators.js'
import { loadWordList, loadWordData } from './generator-io.js'
import { initTheme } from '../ui/theme.js'
import { mountSiteHeader } from '../ui/site-header.js'
import { mountSiteFooter } from '../ui/site-footer.js'

const loadSetting = (key, fallback) => {
  try {
    const raw = localStorage.getItem(key)
    if (raw === null) return fallback
    const parsed = JSON.parse(raw)
    if (Array.isArray(fallback) && Array.isArray(parsed)) return parsed
    if (fallback instanceof Set) return new Set(parsed)
    return parsed
  } catch {
    return fallback
  }
}

const saveSetting = (key, value) => {
  try {
    const toStore = value instanceof Set ? [...value] : value
    localStorage.setItem(key, JSON.stringify(toStore))
  } catch {}
}

const persistedRef = (key, fallback) => {
  const r = ref(loadSetting(key, fallback))
  watch(r, (val) => saveSetting(key, val), { deep: true })
  return r
}


const historyMax = persistedRef('global.historyMax', 10)
// Copy is the primary action, and a copied password otherwise sits in the
// clipboard indefinitely. 0 = keep; otherwise seconds until it is wiped.

// The Generate bar floats at the viewport bottom by default; the pin on the
// bar itself puts it back into normal flow for anyone who finds the floating
// version in the way. One setting for all seven generators.
const floatBar = persistedRef('global.floatBar', true)

// The "vs last" chip and the per-option price tags are coaching, and some
// people find a coach noisy. One switch hides all of it; the total, tier,
// meter and breakdown stay.
const showBitHints = persistedRef('global.showBitHints', true)

// Tabs render through <component :is> with no <keep-alive>, so only the active
// generator is mounted and only its useHistory watcher can fire. Turning
// History off therefore cleared just the tab you happened to be on and left the
// other six generators' passwords sitting in localStorage. Sweep every history
// store directly instead, so "Off" means off everywhere.
const clearStoredHistories = () => {
  try {
    historyKeysIn(Object.keys(localStorage)).forEach(k => localStorage.removeItem(k))
  } catch {}
}

watch(historyMax, (max) => {
  if (max === 0) clearStoredHistories()
})

// The watcher above only fires when the setting changes. Anyone who chose Off
// before v2.8.2 therefore still has the other generators' passwords stored, and
// would have to toggle the control again to be rid of them. Sweep once at
// startup so that clears itself.
if (historyMax.value === 0) clearStoredHistories()

// Same lesson for the v2.20.0 encryption migration: only the mounted
// generator's useHistory runs, so per-component migration would leave the
// other six stores in plaintext indefinitely. Sweep them all at startup --
// and if the browser cannot encrypt, remove them, because after v2.20.0
// plaintext history does not stay on disk.
;(async () => {
  const plaintextKeys = () => historyKeysIn(Object.keys(localStorage))
    .filter((k) => Array.isArray(loadSetting(k, null)))
  try {
    const keys = plaintextKeys()
    if (!keys.length) return
    const cryptoKey = await getHistoryKey()
    for (const k of keys) {
      saveSetting(k, await encryptJSON(cryptoKey, normalizeHistory(loadSetting(k, []))))
    }
  } catch {
    try { plaintextKeys().forEach((k) => localStorage.removeItem(k)) } catch {}
  }
})()

const useHistory = (key) => {
  // Encrypted at rest since v2.20.0 (see history-crypto.js): only ciphertext
  // touches localStorage, and the key never leaves the browser. Loading is
  // therefore async -- the strip fills a beat after mount.
  const history = ref([])
  let ready = false
  let touched = false
  const persist = async () => {
    try {
      const k = await getHistoryKey()
      saveSetting(key, await encryptJSON(k, history.value))
    } catch {
      // No usable WebCrypto/IndexedDB: history stays in memory for the
      // session. Plaintext never goes back to disk.
      try { localStorage.removeItem(key) } catch {}
    }
  }
  ;(async () => {
    let list = []
    let migrate = false
    try {
      const raw = loadSetting(key, [])
      if (isEncryptedEnvelope(raw)) {
        list = await decryptJSON(await getHistoryKey(), raw)
      } else if (Array.isArray(raw) && raw.length) {
        // Pre-v2.20.0 plaintext (strings before v2.17.0, {pw, bits} after):
        // take it, then immediately re-save encrypted over the plaintext.
        list = raw
        migrate = true
      }
    } catch { list = [] }
    ready = true
    const stored = normalizeHistory(list)
    if (touched) {
      // A generation landed before the load resolved; it stays on top.
      const seen = new Set(history.value.map((h) => h.pw))
      history.value = [...history.value, ...stored.filter((h) => !seen.has(h.pw))].slice(0, historyMax.value)
    } else {
      history.value = stored.slice(0, historyMax.value)
    }
    if (migrate) persist()
  })()
  const pushHistory = (pw, bits = null) => {
    if (!pw || historyMax.value === 0) { history.value = []; return }
    const list = history.value.filter(h => h.pw !== pw)
    history.value = [{ pw, bits }, ...list].slice(0, historyMax.value)
  }
  watch(history, () => { touched = true; if (ready) persist() }, { deep: true })
  watch(historyMax, (max) => {
    history.value = max === 0 ? [] : history.value.slice(0, max)
  })
  return { history, pushHistory }
}

/**
 * The leet-substitution toggles, shared by the four generators that offer them.
 *
 * These were four identical copies of three functions, one set per component.
 * Nothing had gone wrong with them yet, which is the only reason to move them
 * now: the word loaders were four identical copies too, and by the time anyone
 * noticed, three of them had quietly stopped matching the one that was fixed.
 */
const useLeet = (activeLeet) => ({
  toggleLeet: (char) => {
    const next = new Set(activeLeet.value)
    if (next.has(char)) next.delete(char)
    else next.add(char)
    activeLeet.value = next
  },
  selectAllLeet: () => { activeLeet.value = new Set(LEET_MAP.map((m) => m.char)) },
  selectNoLeet: () => { activeLeet.value = new Set() },
})

/**
 * The per-category "N words, X bits" hint, shared by the three slot-based
 * generators. Three identical copies before this.
 *
 * Returns a function rather than a value because both inputs are refs and the
 * hint is read during render, so it has to re-evaluate rather than close over
 * a snapshot.
 */
const useCatInfo = (wordData, showBitHints) => (type, catId) => {
  if (!showBitHints.value) return ''
  const cats = wordData.value[type] || {}
  const pool = catId === 'random' ? allOf(cats) : (cats[catId] || [])
  if (!pool.length) return ''
  return `${pool.length} · ${Math.log2(pool.length).toFixed(1)} bits`
}

// Restore a history entry: the password, and the bits it was stored with.
// The full breakdown is deliberately not stored -- one number per entry -- so
// a recalled password shows its total with a note instead of a stale
// breakdown from a different password.
const recallEntry = (entry, password, entropy) => {
  password.value = entry.pw
  entropy.value = entry.bits != null
    ? { total: entry.bits, parts: [{ label: 'recalled from history', bits: entry.bits, note: 'breakdown is not stored' }] }
    : null
}

const useNotification = () => {
  const notification = ref({ show: false, message: '', type: 'success' })
  const showNotification = (message, type = 'success') => {
    notification.value = { show: true, message, type }
    setTimeout(() => { notification.value.show = false }, 3000)
  }
  return { notification, showNotification }
}

const useCopyPassword = (password, label = 'password') => {
  const copied = ref(false)
  const { notification, showNotification } = useNotification()
  const copyPassword = async () => {
    if (!password.value) { showNotification(`No ${label} to copy`, 'error'); return }
    try {
      await navigator.clipboard.writeText(password.value)
      showNotification(`${label.charAt(0).toUpperCase() + label.slice(1)} copied to clipboard!`, 'success')
      copied.value = true
      setTimeout(() => { copied.value = false }, 1500)
      scheduleClipboardClear(showNotification)
    } catch { showNotification(`Failed to copy ${label}`, 'error') }
  }
  return { copied, notification, showNotification, copyPassword }
}

// Keep-to-vault (ROADMAP 9a). The vault is only worth having if filing a
// password into it takes one click at the moment it is generated; a vault you
// have to visit and paste into is a notebook you will not use.
//
// The store is created lazily and shared by every generator tab, so the
// generator page touches IndexedDB only if someone actually keeps something.
let vaultStore = null

const getVaultStore = () => {
  if (!vaultStore) {
    // One number governs both the idle auto-lock and how long the vault may
    // stay unlocked across pages, read from the setting the vault page shares.
    const window = vaultLockMs()
    vaultStore = createVaultStore({ autoLockMs: window, staySignedInMs: window })
  }
  return vaultStore
}

const KeepButton = {
  name: 'KeepButton',
  // `compact` is the history-strip form: a small inline icon rather than one
  // overlaid on the output field, with the panel anchored to itself.
  props: { password: String, bits: Number, compact: Boolean },
  setup (props) {
    const open = ref(false)
    const state = ref('loading')
    const label = ref('')
    const pass = ref('')
    const busy = ref(false)
    const error = ref('')
    const kept = ref(false)
    const acknowledged = ref(false)

    const start = async () => {
      if (!props.password) return
      open.value = !open.value
      if (!open.value) return
      error.value = ''
      kept.value = false
      try {
        state.value = await getVaultStore().init()
      } catch (e) {
        state.value = 'error'
        error.value = e.message
      }
    }

    const unlock = async () => {
      busy.value = true
      error.value = ''
      await nextTick()
      try {
        state.value = await getVaultStore().unlock(pass.value)
        pass.value = ''
      } catch {
        error.value = 'That passphrase did not open the vault.'
      } finally {
        busy.value = false
      }
    }

    /**
     * Adopt the generated password as the vault's passphrase, when there is
     * no vault yet. The loop this closes is the point of the whole feature:
     * the site makes strong passphrases, and a vault needs exactly one.
     *
     * The warning is not decoration. A random character string as your only
     * unrecoverable key is a bad idea unless it is written down somewhere,
     * and the word modes make something you can actually remember -- so the
     * panel says both, and makes you tick the box.
     */
    const adopt = async () => {
      busy.value = true
      error.value = ''
      await nextTick()
      try {
        await getVaultStore().create(props.password)
        state.value = 'unlocked'
        acknowledged.value = false
        if (navigator.storage?.persist) { try { await navigator.storage.persist() } catch {} }
      } catch (e) {
        error.value = e.message
      } finally {
        busy.value = false
      }
    }

    const save = async () => {
      busy.value = true
      error.value = ''
      try {
        await getVaultStore().add({
          label: label.value,
          pw: props.password,
          bits: Number.isFinite(props.bits) ? props.bits : null,
          // Date only: the hour someone generated a password is not
          // information the vault needs to keep about them.
          at: new Date().toISOString().slice(0, 10),
        })
        label.value = ''
        kept.value = true
        open.value = false
      } catch (e) {
        error.value = e.message
      } finally {
        busy.value = false
      }
    }

    return { open, state, label, pass, busy, error, kept, acknowledged, start, unlock, save, adopt }
  },
  render: renderKeepButton,
}

const HistoryStrip = {
  name: 'HistoryStrip',
  components: { KeepButton },
  props: { history: { default: () => [] }, current: String, warnSet: { default: () => new Set() } },
  emits: ['select'],
  // Each row is a recall button plus a keep button, side by side rather than
  // nested: a button inside a button is invalid, and the keep action must not
  // also recall the password into the output field.
  render: renderHistoryStrip,
}

// The entropy readout (ROADMAP 6a/6b). One panel under every password field:
// the total in bits, the change since the last generation, a low warning
// under ENTROPY_FLOOR, and an expandable breakdown in which options that add
// nothing say so -- that zero-line is the 6b feature, not clutter.
const EntropyPanel = {
  name: 'EntropyPanel',
  props: { entropy: Object, password: String, words: Number, mode: String },
  setup(props) {
    const delta = ref(null)
    watch(() => props.entropy, (next, old) => {
      if (!next || !old) { delta.value = null; return }
      const d = next.total - old.total
      // Suppress noise: identical settings produce identical totals in most
      // modes, and sub-0.05 wobble in the rest is not worth announcing.
      delta.value = Math.abs(d) >= 0.05 ? d : null
    })
    const tier = computed(() => props.entropy ? entropyTier(props.entropy.total) : null)
    const pct = computed(() => props.entropy ? Math.min(100, (props.entropy.total / METER_MAX) * 100) : 0)
    // 6f: efficiency, and 6c: what the same size would carry elsewhere. Both
    // live inside the breakdown -- opened deliberately, so not gated by hints.
    const len = computed(() => (props.password ? [...props.password].length : 0))
    const perChar = computed(() => (len.value > 0 && props.entropy ? props.entropy.total / len.value : null))
    const charsRef = computed(() => {
      if (!len.value || props.mode === 'simple' || props.mode === 'advanced') return null
      return len.value * REFERENCE_PER_CHAR
    })
    const listRef = computed(() => (
      ['passphrase', 'wireless', 'madlib'].includes(props.mode) && props.words > 0
        ? props.words * MAIN_LIST_WORD_BITS : null
    ))
    // 6e: named scenarios only -- a bare "3 million years" would mislead.
    const crackRows = computed(() => (props.entropy
      ? ATTACK_SCENARIOS.map((s) => ({ ...s, time: formatGuessTime(crackSeconds(props.entropy.total, s.rate)) }))
      : []))
    // The two ends of that table, always visible: the same password lives in
    // different worlds depending on where it is attacked, and the spread is
    // the message -- not something to hide behind "how?".
    const range = computed(() => {
      if (!props.entropy) return null
      const t = (id) => {
        const s = ATTACK_SCENARIOS.find((x) => x.id === id)
        return formatGuessTime(crackSeconds(props.entropy.total, s.rate))
      }
      return { fast: t('fast'), lockout: t('lockout') }
    })
    return { delta, tier, pct, floor: ENTROPY_FLOOR, showDelta: showBitHints, len, perChar, charsRef, listRef, crackRows, range }
  },
  render: renderEntropyPanel,
}

// Reusable affix chip-picker + optional literal text — rendered as a template string component
const AffixPicker = {
  name: 'AffixPicker',
  props: { label: String, modelValue: String, customValue: String, options: { default: () => AFFIX_OPTIONS }, meta: Function },
  emits: ['update:modelValue', 'update:customValue'],
  setup(props, { emit }) {
    return {
      onMode(v) { emit('update:modelValue', v) },
      onCustom(e) { emit('update:customValue', e.target.value) },
    }
  },
  render: renderAffixPicker,
}

// Simple Password Generator Component
const SimplePassword = {
  name: 'SimplePassword',
  components: { HistoryStrip, EntropyPanel, KeepButton },
  setup() {
    const passwordLength = persistedRef('simple.passwordLength', 20)
    const lowerCase = persistedRef('simple.lowerCase', true)
    const upperCase = persistedRef('simple.upperCase', true)
    const digits = persistedRef('simple.digits', true)
    const specialChars = persistedRef('simple.specialChars', true)
    const useEmoji = persistedRef('simple.useEmoji', false)
    const excludeAmbiguous = persistedRef('simple.excludeAmbiguous', false)
    const password = ref('')
    const entropy = ref(null)
    const recallHistory = (entry) => recallEntry(entry, password, entropy)
    const { history, pushHistory } = useHistory('simple.history')

    const { copied, notification, showNotification, copyPassword } = useCopyPassword(password)

    const characterSets = {
      lower: 'abcdefghijklmnopqrstuvwxyz',
      upper: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
      digits: '0123456789',
      special: '!#$%&()*+,-./:;<=>?@[]^_`{|}~'
    }

    const generatePassword = () => {
      const result = generate('simple', {
        passwordLength: passwordLength.value,
        lowerCase: lowerCase.value,
        upperCase: upperCase.value,
        digits: digits.value,
        specialChars: specialChars.value,
        useEmoji: useEmoji.value,
        excludeAmbiguous: excludeAmbiguous.value,
      })
      if (result.error) { showNotification(result.error, 'error'); return }
      password.value = result.password
      entropy.value = result.entropy
      pushHistory(result.password, result.entropy.total)
    }

    onMounted(() => {
      generatePassword()
    })

    return {
      passwordLength,
      lowerCase,
      upperCase,
      digits,
      specialChars,
      useEmoji,
      excludeAmbiguous,
      password,
      entropy,
      recallHistory,
      history,
      copied,
      notification,
      generatePassword,
      floatBar,
      copyPassword
    }
  },
  render: renderSimplePassword,
}
const AdvancedPassword = {
  name: 'AdvancedPassword',
  components: { HistoryStrip, EntropyPanel, KeepButton },
  setup() {
    const passwordLength = persistedRef('adv.passwordLength', 20)
    const lowerCase = persistedRef('adv.lowerCase', [1, 20])
    const upperCase = persistedRef('adv.upperCase', [1, 20])
    const digits = persistedRef('adv.digits', [1, 20])
    const specialChars = persistedRef('adv.specialChars', [1, 20])
    const activeSymbols = persistedRef('adv.activeSymbols', new Set(ALL_SYMBOLS))
    const emojiCount = persistedRef('adv.emojiCount', [0, 0])
    const excludeAmbiguous = persistedRef('adv.excludeAmbiguous', false)
    const emojiOpen = persistedRef('adv.ui.emojiOpen', false)
    const customSymbols = computed(() =>
      ALL_SYMBOLS.filter(s => activeSymbols.value.has(s)).join('')
    )
    const toggleSymbol = (sym) => {
      const next = new Set(activeSymbols.value)
      if (next.has(sym)) {
        if (next.size > 1) next.delete(sym)
      } else {
        next.add(sym)
      }
      activeSymbols.value = next
    }
    const COMMON_SYMBOLS = new Set('!@#$%&*-_+=?'.split(''))
    const selectAllSymbols = () => { activeSymbols.value = new Set(ALL_SYMBOLS) }
    const selectNoSymbols = () => { activeSymbols.value = new Set([ALL_SYMBOLS[0]]) }
    const selectCommonSymbols = () => { activeSymbols.value = new Set(ALL_SYMBOLS.filter(s => COMMON_SYMBOLS.has(s))) }
    const password = ref('')
    const entropy = ref(null)
    const recallHistory = (entry) => recallEntry(entry, password, entropy)
    const { history, pushHistory } = useHistory('adv.history')
    const { copied, notification, showNotification, copyPassword } = useCopyPassword(password)

    const characterSets = {
      lower: 'abcdefghijklmnopqrstuvwxyz',
      upper: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
      digits: '0123456789'
    }

    const generatePassword = () => {
      const result = generate('advanced', {
        passwordLength: passwordLength.value,
        lowerCase: lowerCase.value,
        upperCase: upperCase.value,
        digits: digits.value,
        specialChars: specialChars.value,
        activeSymbols: activeSymbols.value,
        emojiCount: emojiCount.value,
        excludeAmbiguous: excludeAmbiguous.value,
      })
      if (result.error) { showNotification(result.error, 'error'); return }
      password.value = result.password
      // Length 0 is a valid state the slider can reach, not a failure.
      if (!result.entropy) { entropy.value = null; return }
      entropy.value = result.entropy
      pushHistory(result.password, result.entropy.total)
    }

    onMounted(() => {
      generatePassword()
    })

    return {
      passwordLength,
      lowerCase,
      upperCase,
      digits,
      specialChars,
      allSymbols: ALL_SYMBOLS,
      excludeAmbiguous,
      emojiOpen,
      activeSymbols,
      toggleSymbol,
      selectAllSymbols,
      selectNoSymbols,
      selectCommonSymbols,
      emojiCount,
      password,
      entropy,
      recallHistory,
      history,
      copied,
      notification,
      generatePassword,
      floatBar,
      copyPassword
    }
  },
  render: renderAdvancedPassword,
}

// Words Password Generator Component
const WordsPassword = {
  name: 'WordsPassword',
  components: { AffixPicker, HistoryStrip, EntropyPanel, KeepButton },
  setup() {
    const wordCount = persistedRef('words.wordCount', 4)
    const separator = persistedRef('words.separator', '$')
    const customSeparator = persistedRef('words.customSeparator', '')
    const capitalization = persistedRef('words.capitalization', 'title')
    const prefixMode = persistedRef('words.prefixMode', '')
    const prefixCustom = persistedRef('words.prefixCustom', '')
    const suffixMode = persistedRef('words.suffixMode', '')
    const suffixCustom = persistedRef('words.suffixCustom', '')
    const activeLeet = persistedRef('words.activeLeet', new Set())
    const useEmoji = persistedRef('words.useEmoji', false)
    const lockAffixes = persistedRef('words.lockAffixes', false)
    const excludeAmbiguous = persistedRef('words.excludeAmbiguous', false)
    // 7c: rarely-changed groups start collapsed; the open state is remembered
    // per generator so a person who uses affixes daily never re-opens them.
    const affixOpen = persistedRef('words.ui.affixOpen', false)
    const extrasOpen = persistedRef('words.ui.extrasOpen', false)
    const password = ref('')
    const entropy = ref(null)
    const recallHistory = (entry) => recallEntry(entry, password, entropy)
    const preview = ref('')
    const rawWords = ref([])
    const { history, pushHistory } = useHistory('words.history')
    const { copied, notification, showNotification, copyPassword } = useCopyPassword(password)
    const wordList = ref([])


    // The affix lock is session state, so it stays here; generators.js takes
    // the previously used set and hands back whatever it used.
    let heldAffixes = null

    const settingsOf = () => ({
      wordCount: wordCount.value,
      separator: separator.value,
      customSeparator: customSeparator.value,
      capitalization: capitalization.value,
      prefixMode: prefixMode.value,
      prefixCustom: prefixCustom.value,
      suffixMode: suffixMode.value,
      suffixCustom: suffixCustom.value,
      activeLeet: activeLeet.value,
      useEmoji: useEmoji.value,
      lockAffixes: lockAffixes.value,
      excludeAmbiguous: excludeAmbiguous.value,
    })

    const buildPassword = () => {
      const result = build('words', settingsOf(), { wordList: wordList.value },
        rawWords.value, heldAffixes)
      heldAffixes = result.affixes
      password.value = result.password
      entropy.value = result.entropy
      preview.value = result.preview
      pushHistory(result.password, result.entropy.total)
    }

    const generatePassword = () => {
      const drawn = draw('words', settingsOf(), { wordList: wordList.value })
      if (drawn.error) { showNotification(drawn.error, 'error'); return }
      rawWords.value = drawn.raw
      buildPassword()
    }

    const regenWord = (idx) => {
      if (wordList.value.length === 0) return
      const next = [...rawWords.value]
      next[idx] = randPick(wordList.value)
      rawWords.value = next
      buildPassword()
    }

    watch(useEmoji, () => { if (rawWords.value.length) buildPassword() })
    watch(excludeAmbiguous, () => { if (rawWords.value.length) buildPassword() })

    onMounted(async () => {
      wordList.value = await loadWordList()
      generatePassword()
    })

    const { toggleLeet, selectAllLeet, selectNoLeet } = useLeet(activeLeet)

    return {
      wordCount,
      separator,
      customSeparator,
      capitalization,
      prefixMode,
      prefixCustom,
      suffixMode,
      suffixCustom,
      leetMap: LEET_MAP,
      activeLeet,
      toggleLeet,
      selectAllLeet,
      selectNoLeet,
      useEmoji,
      lockAffixes,
      excludeAmbiguous,
      sepMeta: (v) => (showBitHints.value ? sepOptionMeta(v, excludeAmbiguous.value) : ''),
      prefixMeta: (v) => (showBitHints.value ? affixOptionMeta(v, excludeAmbiguous.value) : ''),
      suffixMeta: (v) => (showBitHints.value ? suffixOptionMeta(v, prefixMode.value, excludeAmbiguous.value) : ''),
      capMeta: (m) => (showBitHints.value ? capOptionMeta(m) : ''),
      affixOpen,
      extrasOpen,
      password,
      entropy,
      recallHistory,
      rawWords,
      history,
      copied,
      preview,
      notification,
      separatorOptions: SEPARATOR_OPTIONS,
      suffixOptions: SUFFIX_OPTIONS,
      generatePassword,
      floatBar,
      regenWord,
      copyPassword
    }
  },
  render: renderWordsPassword,
}

// Numbers Password Generator Component
const NumbersPassword = {
  name: 'NumbersPassword',
  components: { HistoryStrip, EntropyPanel, KeepButton },
  setup() {
    const passwordLength = persistedRef('nums.passwordLength', 8)
    const maxRepeated = persistedRef('nums.maxRepeated', 3)
    const maxSequential = persistedRef('nums.maxSequential', 3)
    const password = ref('')
    const entropy = ref(null)
    const recallHistory = (entry) => recallEntry(entry, password, entropy)
    const { history, pushHistory } = useHistory('nums.history')
    const { copied, notification, copyPassword } = useCopyPassword(password)

    const generatePassword = () => {
      const result = generate('numbers', {
        passwordLength: passwordLength.value,
        maxRepeated: maxRepeated.value,
        maxSequential: maxSequential.value,
      })
      password.value = result.password
      entropy.value = result.entropy
      pushHistory(result.password, result.entropy.total)
    }

    onMounted(() => {
      generatePassword()
    })

    return {
      passwordLength,
      maxRepeated,
      maxSequential,
      password,
      entropy,
      recallHistory,
      history,
      copied,
      notification,
      generatePassword,
      floatBar,
      copyPassword
    }
  },
  render: renderNumbersPassword,
}

// Passphrase Generator Component
const SLOT_TYPES = [
  { type: 'adj',  label: 'Adj',  color: 'slot-adj'  },
  { type: 'adv',  label: 'Adv',  color: 'slot-adv'  },
  { type: 'noun', label: 'Noun', color: 'slot-noun' },
  { type: 'verb', label: 'Verb', color: 'slot-verb' },
]


/**
 * Every distinct word across a part of speech.
 *
 * Categories overlap by design, so a flat concat would draw a word once per
 * category it appears in -- 268 nouns, 96 adverbs and 51 adjectives are in
 * more than one. Dedupe here rather than in the data, so a category keeps
 * every word that genuinely belongs to it while a random draw stays uniform.
 */
const allOf = (cats) => [...new Set(Object.values(cats).flat())]

const CATEGORY_META = {
  noun: [
    { id: 'random',   label: 'Random'   },
    { id: 'animals',  label: 'Animals'  },
    { id: 'vehicles', label: 'Vehicles' },
    { id: 'food',     label: 'Food'     },
    { id: 'places',   label: 'Places'   },
    { id: 'nature',   label: 'Nature'   },
    { id: 'tech',     label: 'Tech'     },
    { id: 'jobs',     label: 'Jobs'     },
    { id: 'music',    label: 'Music'    },
    { id: 'sports',   label: 'Sports'   },
  ],
  adj: [
    { id: 'random',   label: 'Random'  },
    { id: 'colors',   label: 'Colors'  },
    { id: 'size',     label: 'Size'    },
    { id: 'texture',  label: 'Texture' },
    { id: 'mood',     label: 'Mood'    },
    { id: 'weather',  label: 'Weather' },
    { id: 'time',     label: 'Time'    },
  ],
  adv: [
    { id: 'random',    label: 'Random'    },
    { id: 'manner',    label: 'Manner'    },
    { id: 'intensity', label: 'Intensity' },
    { id: 'time',      label: 'Time'      },
    { id: 'place',     label: 'Place'     },
  ],
  verb: [
    { id: 'random',    label: 'Random'    },
    { id: 'movement',  label: 'Movement'  },
    { id: 'action',    label: 'Action'    },
    { id: 'nature',    label: 'Nature'    },
    { id: 'cognition', label: 'Cognition' },
  ],
}

const Passphrase = {
  name: 'Passphrase',
  setup() {
    // Each slot: { id, type, cat }
    const defaultSlots = [{ id: 0, type: 'adj', cat: 'random' }, { id: 1, type: 'noun', cat: 'random' }, { id: 2, type: 'verb', cat: 'random' }]
    const slots = persistedRef('phrase.slots', defaultSlots)
    let nextId = slots.value.reduce((max, s) => Math.max(max, s.id + 1), 0)
    const makeSlot = (type) => ({ id: nextId++, type, cat: 'random' })

    const separator = persistedRef('phrase.separator', '$')
    const customSeparator = persistedRef('phrase.customSeparator', '')
    const capitalization = persistedRef('phrase.capitalization', 'upper')
    const prefixMode = persistedRef('phrase.prefixMode', '')
    const prefixCustom = persistedRef('phrase.prefixCustom', '')
    const suffixMode = persistedRef('phrase.suffixMode', '')
    const suffixCustom = persistedRef('phrase.suffixCustom', '')
    const activeLeet = persistedRef('phrase.activeLeet', new Set())
    const useEmoji = persistedRef('phrase.useEmoji', false)
    const lockAffixes = persistedRef('phrase.lockAffixes', false)
    const excludeAmbiguous = persistedRef('phrase.excludeAmbiguous', false)
    const affixOpen = persistedRef('phrase.ui.affixOpen', false)
    const extrasOpen = persistedRef('phrase.ui.extrasOpen', false)
    const password = ref('')
    const entropy = ref(null)
    const recallHistory = (entry) => recallEntry(entry, password, entropy)
    const preview = ref('')
    const rawWords = ref([])
    const { history, pushHistory } = useHistory('phrase.history')
    const { copied, notification, showNotification, copyPassword } = useCopyPassword(password, 'passphrase')
    const wordData = ref({})
    // 6d: the picker states what a category costs before it is chosen --
    // pool size and bits per slot, from the same data the generator draws on.


    const pickFrom = (type, catId) => {
      const cats = wordData.value[type]
      if (!cats) return type
      const pool = catId === 'random' ? allOf(cats) : (cats[catId] || allOf(cats))
      return randPick(pool)
    }

    // The affix lock is session state, so it stays here; generators.js takes
    // the previously used set and hands back whatever it used.
    let heldAffixes = null

    const settingsOf = () => ({
      slots: slots.value,
      separator: separator.value,
      customSeparator: customSeparator.value,
      capitalization: capitalization.value,
      prefixMode: prefixMode.value,
      prefixCustom: prefixCustom.value,
      suffixMode: suffixMode.value,
      suffixCustom: suffixCustom.value,
      activeLeet: activeLeet.value,
      useEmoji: useEmoji.value,
      lockAffixes: lockAffixes.value,
      excludeAmbiguous: excludeAmbiguous.value,
    })

    const buildPassword = () => {
      const result = build('passphrase', settingsOf(), { wordData: wordData.value },
        rawWords.value, heldAffixes)
      heldAffixes = result.affixes
      password.value = result.password
      entropy.value = result.entropy
      preview.value = result.preview
      pushHistory(result.password, result.entropy.total)
    }

    const generatePassword = () => {
      const drawn = draw('passphrase', settingsOf(), { wordData: wordData.value })
      if (drawn.error) { showNotification(drawn.error, 'error'); return }
      rawWords.value = drawn.raw
      buildPassword()
    }

    const regenWord = (idx) => {
      const slot = slots.value[idx]
      if (!slot) return
      const next = [...rawWords.value]
      next[idx] = pickFrom(slot.type, slot.cat)
      rawWords.value = next
      buildPassword()
    }

    const addSlot = (type) => {
      if (slots.value.length >= 8) return
      slots.value.push(makeSlot(type))
    }

    const removeSlot = (id) => {
      slots.value = slots.value.filter(s => s.id !== id)
    }

    const moveSlot = (idx, dir) => {
      const target = idx + dir
      if (target < 0 || target >= slots.value.length) return
      const arr = [...slots.value]
      ;[arr[idx], arr[target]] = [arr[target], arr[idx]]
      slots.value = arr
    }

    watch(useEmoji, () => { if (rawWords.value.length) buildPassword() })
    watch(excludeAmbiguous, () => { if (rawWords.value.length) buildPassword() })

    onMounted(async () => {
      wordData.value = await loadWordData()
      generatePassword()
    })

    const { toggleLeet, selectAllLeet, selectNoLeet } = useLeet(activeLeet)

    const catInfo = useCatInfo(wordData, showBitHints)

    return {
      slots,
      slotTypes: SLOT_TYPES,
      categoryMeta: CATEGORY_META,
      catInfo,
      addSlot, removeSlot, moveSlot,
      separator, customSeparator,
      capitalization,
      prefixMode, prefixCustom,
      suffixMode, suffixCustom,
      leetMap: LEET_MAP,
      activeLeet,
      toggleLeet,
      selectAllLeet,
      selectNoLeet,
      useEmoji,
      lockAffixes,
      excludeAmbiguous,
      sepMeta: (v) => (showBitHints.value ? sepOptionMeta(v, excludeAmbiguous.value) : ''),
      prefixMeta: (v) => (showBitHints.value ? affixOptionMeta(v, excludeAmbiguous.value) : ''),
      suffixMeta: (v) => (showBitHints.value ? suffixOptionMeta(v, prefixMode.value, excludeAmbiguous.value) : ''),
      capMeta: (m) => (showBitHints.value ? capOptionMeta(m) : ''),
      affixOpen,
      extrasOpen,
      password, entropy, recallHistory, rawWords, history, copied, preview, notification,
      separatorOptions: SEPARATOR_OPTIONS,
      suffixOptions: SUFFIX_OPTIONS,
      floatBar,
      generatePassword, regenWord, copyPassword
    }
  },
  components: { AffixPicker, HistoryStrip, EntropyPanel, KeepButton },
  render: renderPassphrase,
}

// WiFi Words Component
const WifiWords = {
  name: 'WifiWords',
  setup() {
    const defaultSlots = [{ id: 0, type: 'adj', cat: 'random' }, { id: 1, type: 'noun', cat: 'random' }]
    const slots = persistedRef('wifi.slots', defaultSlots)
    let nextId = slots.value.reduce((max, s) => Math.max(max, s.id + 1), 0)
    const makeSlot = (type) => ({ id: nextId++, type, cat: 'random' })

    const separator = persistedRef('wifi.separator', '-')
    const customSeparator = persistedRef('wifi.customSeparator', '')
    const capitalization = persistedRef('wifi.capitalization', 'title')
    const prefixMode = persistedRef('wifi.prefixMode', '')
    const prefixCustom = persistedRef('wifi.prefixCustom', '')
    const suffixMode = persistedRef('wifi.suffixMode', 'r2num')
    const suffixCustom = persistedRef('wifi.suffixCustom', '')
    const activeLeet = persistedRef('wifi.activeLeet', new Set())
    const useEmoji = persistedRef('wifi.useEmoji', false)
    const lockAffixes = persistedRef('wifi.lockAffixes', false)
    // 6g: on by default here -- Wireless keys get read off a screen and typed
    // on a TV remote, which is exactly where l/1 and O/0 misfire.
    const excludeAmbiguous = persistedRef('wifi.excludeAmbiguous', true)
    const affixOpen = persistedRef('wifi.ui.affixOpen', false)
    const extrasOpen = persistedRef('wifi.ui.extrasOpen', false)
    const password = ref('')
    const entropy = ref(null)
    const recallHistory = (entry) => recallEntry(entry, password, entropy)
    const preview = ref('')
    const rawWords = ref([])
    const { history, pushHistory } = useHistory('wifi.history')
    const { copied, notification, showNotification, copyPassword } = useCopyPassword(password, 'wifi')
    const wordData = ref({})
    // 6d: the picker states what a category costs before it is chosen --
    // pool size and bits per slot, from the same data the generator draws on.
    const alliterationMode = persistedRef('wifi.alliterationMode', true)
    const alliterationLetter = ref('')


    const pickFrom = (type, catId, forceLetter = '') => {
      const cats = wordData.value[type]
      if (!cats) return type
      let pool = catId === 'random' ? allOf(cats) : (cats[catId] || allOf(cats))
      pool = pool.filter(w => typeof w === 'string' && w.length > 0)
      if (forceLetter) {
        const filtered = pool.filter(w => w.charAt(0).toLowerCase() === forceLetter)
        if (filtered.length > 0) pool = filtered
      }
      if (pool.length === 0) return type
      return randPick(pool)
    }

    // The affix lock is session state, so it stays here; generators.js takes
    // the previously used set and hands back whatever it used.
    let heldAffixes = null

    // Short results are flagged rather than hidden -- see the retry below.
    const warnSet = ref(new Set())

    const settingsOf = () => ({
      slots: slots.value,
      separator: separator.value,
      customSeparator: customSeparator.value,
      capitalization: capitalization.value,
      prefixMode: prefixMode.value,
      prefixCustom: prefixCustom.value,
      suffixMode: suffixMode.value,
      suffixCustom: suffixCustom.value,
      activeLeet: activeLeet.value,
      useEmoji: useEmoji.value,
      lockAffixes: lockAffixes.value,
      excludeAmbiguous: excludeAmbiguous.value,
      alliterationMode: alliterationMode.value,
    })

    const buildPassword = () => {
      const result = build('wireless', settingsOf(), { wordData: wordData.value },
        rawWords.value, heldAffixes, alliterationLetter.value)
      heldAffixes = result.affixes
      password.value = result.password
      entropy.value = result.entropy
      preview.value = result.preview
    }

    // A key shorter than 8 characters is rejected by the router rather than
    // merely weak, so a short build is redrawn. Ten attempts, then the result
    // is flagged -- no number of redraws makes a three-letter word long enough.
    const generatePassword = (attempt = 0) => {
      if (typeof attempt !== 'number') attempt = 0
      const drawn = draw('wireless', settingsOf(), { wordData: wordData.value })
      if (drawn.error) { showNotification(drawn.error, 'error'); return }
      alliterationLetter.value = drawn.letter
      rawWords.value = drawn.raw
      buildPassword()
      if (password.value.length < WIRELESS_MIN && attempt < 10) {
        generatePassword(attempt + 1)
        return
      }
      if (password.value.length < WIRELESS_MIN) {
        warnSet.value = new Set([...warnSet.value, password.value])
      }
      pushHistory(password.value, entropy.value ? entropy.value.total : null)
    }

    const regenWord = (idx, attempt = 0) => {
      const slot = slots.value[idx]
      if (!slot) return
      const next = [...rawWords.value]
      next[idx] = pickFrom(slot.type, slot.cat, alliterationMode.value ? alliterationLetter.value : '')
      rawWords.value = next
      buildPassword()
      if (password.value.length < 8 && attempt < 10) {
        regenWord(idx, attempt + 1)
        return
      }
      if (password.value.length < 8) {
        warnSet.value = new Set([...warnSet.value, password.value])
      }
      pushHistory(password.value, entropy.value ? entropy.value.total : null)
    }

    const addSlot = (type) => {
      if (slots.value.length >= 8) return
      slots.value = [...slots.value, makeSlot(type)]
    }

    const removeSlot = (id) => {
      slots.value = slots.value.filter(s => s.id !== id)
    }

    const moveSlot = (idx, dir) => {
      const target = idx + dir
      if (target < 0 || target >= slots.value.length) return
      const arr = [...slots.value]
      ;[arr[idx], arr[target]] = [arr[target], arr[idx]]
      slots.value = arr
    }

    watch(useEmoji, () => { if (rawWords.value.length) buildPassword() })
    watch(excludeAmbiguous, () => { if (rawWords.value.length) buildPassword() })

    onMounted(async () => {
      wordData.value = await loadWordData()
      generatePassword()
    })

    const { toggleLeet, selectAllLeet, selectNoLeet } = useLeet(activeLeet)

    const catInfo = useCatInfo(wordData, showBitHints)

    return {
      slots,
      slotTypes: SLOT_TYPES,
      categoryMeta: CATEGORY_META,
      catInfo,
      addSlot, removeSlot, moveSlot,
      alliterationMode, alliterationLetter,
      separator, customSeparator,
      capitalization,
      prefixMode, prefixCustom,
      suffixMode, suffixCustom,
      leetMap: LEET_MAP,
      activeLeet,
      toggleLeet,
      selectAllLeet,
      selectNoLeet,
      useEmoji,
      lockAffixes,
      excludeAmbiguous,
      sepMeta: (v) => (showBitHints.value ? sepOptionMeta(v, excludeAmbiguous.value) : ''),
      prefixMeta: (v) => (showBitHints.value ? affixOptionMeta(v, excludeAmbiguous.value) : ''),
      suffixMeta: (v) => (showBitHints.value ? suffixOptionMeta(v, prefixMode.value, excludeAmbiguous.value) : ''),
      capMeta: (m) => (showBitHints.value ? capOptionMeta(m) : ''),
      affixOpen,
      extrasOpen,
      password, entropy, recallHistory, rawWords, history, warnSet, copied, preview, notification,
      separatorOptions: SEPARATOR_OPTIONS,
      suffixOptions: SUFFIX_OPTIONS,
      floatBar,
      generatePassword, regenWord, copyPassword
    }
  },
  components: { AffixPicker, HistoryStrip, EntropyPanel, KeepButton },
  render: renderWifiWords,
}

// Mad Lib Password Component
const MadLib = {
  name: 'MadLib',
  setup() {
    const templateId = persistedRef('madlib.templateId', 'hero')
    // One entry per token occurrence: { type, cat }
    const slotCats = persistedRef('madlib.slotCats', [])

    const rebuildSlotCats = (newId, oldSlotCats) => {
      const tmpl = MADLIB_TEMPLATES.find(t => t.id === newId)
      if (!tmpl) return []
      const tokens = [...tmpl.template.matchAll(/\{(adj|adv|noun|verb)\}/g)].map(m => m[1])
      // count occurrences per type so we can track "adj #1" vs "adj #2"
      const typeCount = {}
      return tokens.map(type => {
        typeCount[type] = (typeCount[type] || 0) + 1
        const prev = oldSlotCats.find(s => s.type === type && s.occurrence === typeCount[type])
        return { type, occurrence: typeCount[type], cat: prev?.cat ?? 'random' }
      })
    }

    // Derived: unique (type, occurrence) entries — same as slotCats but with extra
    // display info (showOrdinal: true when that type has > 1 occurrence in template)
    const slotCatRows = computed(() => {
      const typeTotals = {}
      slotCats.value.forEach(s => { typeTotals[s.type] = (typeTotals[s.type] || 0) + 1 })
      return slotCats.value.map(s => ({ ...s, showOrdinal: typeTotals[s.type] > 1 }))
    })

    const separator = persistedRef('madlib.separator', '-')
    const customSeparator = persistedRef('madlib.customSeparator', '')
    const capitalization = persistedRef('madlib.capitalization', 'title')
    const prefixMode = persistedRef('madlib.prefixMode', '')
    const prefixCustom = persistedRef('madlib.prefixCustom', '')
    const suffixMode = persistedRef('madlib.suffixMode', '')
    const suffixCustom = persistedRef('madlib.suffixCustom', '')
    const activeLeet = persistedRef('madlib.activeLeet', new Set())
    const useEmoji = persistedRef('madlib.useEmoji', false)
    const password = ref('')
    const entropy = ref(null)
    const recallHistory = (entry) => recallEntry(entry, password, entropy)
    const preview = ref('')
    // rawWords stores the plain words from the template fill (no caps/leet) alongside their token types
    const rawSegments = ref([]) // [{ word, isToken, type? }]
    const lockAffixes = persistedRef('madlib.lockAffixes', false)
    const excludeAmbiguous = persistedRef('madlib.excludeAmbiguous', false)
    const affixOpen = persistedRef('madlib.ui.affixOpen', false)
    const extrasOpen = persistedRef('madlib.ui.extrasOpen', false)
    const { history, pushHistory } = useHistory('madlib.history')
    const { copied, notification, copyPassword } = useCopyPassword(password)
    const wordData = ref({})
    // 6d: the picker states what a category costs before it is chosen --
    // pool size and bits per slot, from the same data the generator draws on.


    const pickFrom = (type, catId) => {
      const typeCats = wordData.value[type]
      if (!typeCats) return type
      const pool = catId === 'random' ? allOf(typeCats) : (typeCats[catId] || allOf(typeCats))
      return randPick(pool) || ''
    }

    // The affix lock is session state, so it stays here; generators.js takes
    // the previously used set and hands back whatever it used.
    let heldAffixes = null

    const settingsOf = () => ({
      templateId: templateId.value,
      slotCats: slotCats.value,
      separator: separator.value,
      customSeparator: customSeparator.value,
      capitalization: capitalization.value,
      prefixMode: prefixMode.value,
      prefixCustom: prefixCustom.value,
      suffixMode: suffixMode.value,
      suffixCustom: suffixCustom.value,
      activeLeet: activeLeet.value,
      useEmoji: useEmoji.value,
      lockAffixes: lockAffixes.value,
      excludeAmbiguous: excludeAmbiguous.value,
    })

    const buildPassword = () => {
      const result = build('madlib', settingsOf(), { wordData: wordData.value },
        rawSegments.value, heldAffixes)
      if (result.error) return
      heldAffixes = result.affixes
      password.value = result.password
      entropy.value = result.entropy
      preview.value = result.preview
      pushHistory(result.password, result.entropy.total)
    }

    const generatePassword = () => {
      const drawn = draw('madlib', settingsOf(), { wordData: wordData.value })
      if (drawn.error) return
      rawSegments.value = drawn.raw
      buildPassword()
    }

    const regenWord = (segIdx) => {
      const seg = rawSegments.value[segIdx]
      if (!seg || !seg.isToken) return
      const slotEntry = slotCats.value.find(s => s.type === seg.type && s.occurrence === seg.occurrence)
      const next = [...rawSegments.value]
      next[segIdx] = { ...seg, word: pickFrom(seg.type, slotEntry?.cat ?? 'random') }
      rawSegments.value = next
      buildPassword()
    }

    watch(templateId, (newId) => {
      slotCats.value = rebuildSlotCats(newId, slotCats.value)
      generatePassword()
    })

    watch(useEmoji, () => { if (rawSegments.value.length) buildPassword() })
    watch(excludeAmbiguous, () => { if (rawSegments.value.length) buildPassword() })

    onMounted(async () => {
      wordData.value = await loadWordData()
      slotCats.value = rebuildSlotCats(templateId.value, slotCats.value)
      generatePassword()
    })

    const { toggleLeet, selectAllLeet, selectNoLeet } = useLeet(activeLeet)

    const catInfo = useCatInfo(wordData, showBitHints)

    return {
      templateId,
      templates: MADLIB_TEMPLATES,
      slotCats,
      slotCatRows,
      categoryMeta: CATEGORY_META,
      catInfo,
      separator, customSeparator,
      capitalization,
      prefixMode, prefixCustom,
      suffixMode, suffixCustom,
      leetMap: LEET_MAP,
      activeLeet,
      toggleLeet,
      selectAllLeet,
      selectNoLeet,
      useEmoji,
      lockAffixes,
      excludeAmbiguous,
      sepMeta: (v) => (showBitHints.value ? sepOptionMeta(v, excludeAmbiguous.value) : ''),
      prefixMeta: (v) => (showBitHints.value ? affixOptionMeta(v, excludeAmbiguous.value) : ''),
      suffixMeta: (v) => (showBitHints.value ? suffixOptionMeta(v, prefixMode.value, excludeAmbiguous.value) : ''),
      capMeta: (m) => (showBitHints.value ? capOptionMeta(m) : ''),
      affixOpen,
      extrasOpen,
      password, entropy, recallHistory, rawSegments, history, copied, preview, notification,
      separatorOptions: SEPARATOR_OPTIONS,
      suffixOptions: SUFFIX_OPTIONS,
      floatBar,
      generatePassword, regenWord, copyPassword,
    }
  },
  components: { AffixPicker, HistoryStrip, EntropyPanel, KeepButton },
  render: renderMadLib,
}

// Main App Component
const App = {
  name: 'App',
  setup() {
    const activeTab = persistedRef('global.activeTab', 0)
    // `mode` is the id from generators.js, which is what makes a tab
    // addressable: /#words opens Words. The vault's "Change settings" link
    // uses it to land on the generator being used rather than on whichever
    // tab happened to be open last, which was the whole complaint.
    const tabs = [
      // Icons and descriptions mirror the docs intro tiles, so the switcher
      // and the reference describe each mode in the same words.
      { id: 1, mode: 'simple',     name: 'Simple',     icon: 'mdi-key-outline',           desc: 'Classic random characters', component: SimplePassword },
      { id: 2, mode: 'advanced',   name: 'Advanced',   icon: 'mdi-tune',                  desc: 'Per-type min/max control',  component: AdvancedPassword },
      { id: 3, mode: 'words',      name: 'Words',      icon: 'mdi-text',                  desc: 'Random word strings',       component: WordsPassword },
      { id: 4, mode: 'passphrase', name: 'Passphrase', icon: 'mdi-format-list-bulleted',  desc: 'Grammar-aware phrases',     component: Passphrase },
      { id: 5, mode: 'wireless',   name: 'Wireless',   icon: 'mdi-wifi',                  desc: 'WiFi-friendly passphrases', component: WifiWords },
      { id: 6, mode: 'madlib',     name: 'Mad Lib',    icon: 'mdi-theater',               desc: 'Sentence-template phrases', component: MadLib },
      { id: 7, mode: 'numbers',    name: 'Numbers',    icon: 'mdi-numeric',               desc: 'PIN & numeric codes',       component: NumbersPassword },
    ]

    /**
     * A hash names a tab: /#words. Read once on load, and kept in step
     * afterwards with replaceState rather than a new history entry -- flipping
     * between tabs is not navigation, and filling the back button with it
     * would make leaving the page take seven presses.
     *
     * No router. One id, one hash, one lookup; a routing library for this
     * would be more code than the app it routes.
     */
    const tabFromHash = () => {
      const wanted = decodeURIComponent(location.hash.replace(/^#/, '')).toLowerCase()
      return tabs.findIndex((t) => t.mode === wanted)
    }
    const fromHash = tabFromHash()
    if (fromHash >= 0) activeTab.value = fromHash

    watch(activeTab, (i) => {
      const tab = tabs[i]
      if (!tab) return
      try { history.replaceState(null, '', `#${tab.mode}`) } catch {}
    })

    // Back/forward, or someone editing the hash directly.
    window.addEventListener('hashchange', () => {
      const i = tabFromHash()
      if (i >= 0) activeTab.value = i
    })

    // The settings panel is plain DOM so that all five pages share one
    // implementation. History is contributed as an extra section rather than
    // being known to the panel, with get/set bridging to the Vue ref so the
    // rest of the app stays reactive.
    onMounted(() => {
      // 7d: R regenerates. One listener at the root, driving whichever
      // generator is mounted -- the primary button in the tab content is
      // always the active tab's Generate. Skipped while a form control has
      // focus so typing in a custom field never fires it.
      window.addEventListener('keydown', (e) => {
        if (e.key !== 'r' && e.key !== 'R') return
        if (e.ctrlKey || e.metaKey || e.altKey) return
        const t = e.target
        if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return
        const btn = document.querySelector('.tab-content .btn.btn-primary')
        if (btn) { e.preventDefault(); btn.click() }
      })
      initTheme()
      mountSiteHeader(document.querySelector('[data-site-header]'), {
        description:
          '🔒 <strong>Privacy Notice:</strong> All passwords are generated locally in your browser and never transmitted. ' +
          "Your settings and generation history are stored only in your browser's local storage — history is cleared when " +
          'you set History to Off, or when you clear your browser data.',
      })
    })

    /**
     * A vault entry is waiting to be finished.
     *
     * Set by the vault before it sends you here to change a setting. The flag
     * says only that a draft exists -- the draft itself is sealed in the
     * vault's own storage, and the generator has no business reading it.
     */
    const returningToVault = ref(false)
    try { returningToVault.value = sessionStorage.getItem('vault.hasDraft') === '1' } catch {}

    return {
      activeTab,
      tabs,
      returningToVault,
      historyMax
    }
  },
  render: renderApp,
}

createApp(App).mount('#app')

// The footer is the floating navigation bar, and the settings gear rides in
// it -- so the app's extra settings rows are contributed here rather than
// through the header. The get/set closures reach the module-scope refs above.
mountSiteFooter(document.querySelector('[data-site-footer]'), {
  settings: {
    extraSections: [{
      label: 'History',
      options: [0, 5, 10, 20, 50].map(n => ({ value: n, label: n === 0 ? 'Off' : String(n) })),
      get: () => historyMax.value,
      set: (v) => { historyMax.value = Number(v) },
    }, {
      label: 'Bit hints',
      options: [{ value: 'on', label: 'On' }, { value: 'off', label: 'Off' }],
      get: () => (showBitHints.value ? 'on' : 'off'),
      set: (v) => { showBitHints.value = v === 'on' },
    }, clipboardClearSection(), vaultLockSection()],
  },
})