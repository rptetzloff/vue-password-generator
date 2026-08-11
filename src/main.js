import { createApp, ref, computed, watch, onMounted } from '../vendor/vue.esm-browser.prod.js'
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
} from './lib.js'
import { simpleBits, advancedBits, wordsBits, slotBits, wirelessBits, numbersBits, ENTROPY_FLOOR, entropyTier, METER_MAX } from './entropy.js'
import { initTheme } from './theme.js'
import { mountSiteHeader } from './site-header.js'
import { mountSiteFooter } from './site-footer.js'

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

const useHistory = (key) => {
  const history = persistedRef(key, [])
  // Entries were plain strings until v2.17.0; they are { pw, bits } now so a
  // recalled password can show the strength it actually had. Migrate on read.
  history.value = normalizeHistory(history.value)
  const pushHistory = (pw, bits = null) => {
    if (!pw || historyMax.value === 0) { history.value = []; return }
    const list = history.value.filter(h => h.pw !== pw)
    history.value = [{ pw, bits }, ...list].slice(0, historyMax.value)
  }
  watch(historyMax, (max) => {
    history.value = max === 0 ? [] : history.value.slice(0, max)
  })
  return { history, pushHistory }
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
    } catch { showNotification(`Failed to copy ${label}`, 'error') }
  }
  return { copied, notification, showNotification, copyPassword }
}

const HistoryStrip = {
  name: 'HistoryStrip',
  props: { history: { default: () => [] }, current: String, warnSet: { default: () => new Set() } },
  emits: ['select'],
  template: `
    <div v-if="history.length > 1" class="history-strip">
      <div class="history-label">History</div>
      <div class="history-list">
        <button
          v-for="(entry, i) in history"
          :key="i"
          class="history-item"
          :class="{ 'history-item-active': entry.pw === current, 'history-item-warn': warnSet.has(entry.pw) }"
          @click="$emit('select', entry)"
          :title="warnSet.has(entry.pw) ? entry.pw + ' (under 8 characters)' : entry.pw"
        ><span class="history-pw">{{ entry.pw }}</span><span v-if="entry.bits != null" class="history-bits">{{ entry.bits.toFixed(1) }} bits</span><span v-if="warnSet.has(entry.pw)" class="history-warn-badge" title="Under 8 characters">!</span></button>
      </div>
    </div>
  `
}

// The entropy readout (ROADMAP 6a/6b). One panel under every password field:
// the total in bits, the change since the last generation, a low warning
// under ENTROPY_FLOOR, and an expandable breakdown in which options that add
// nothing say so -- that zero-line is the 6b feature, not clutter.
const EntropyPanel = {
  name: 'EntropyPanel',
  props: { entropy: Object },
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
    return { delta, tier, pct, floor: ENTROPY_FLOOR }
  },
  template: `
    <details v-if="entropy" class="entropy-panel" :class="{ 'entropy-low': entropy.total < floor }">
      <summary class="entropy-summary">
        <span class="entropy-meter" :class="'meter-' + tier.id" aria-hidden="true"><span class="entropy-meter-fill" :style="{ width: pct + '%' }"></span></span>
        <span class="entropy-total">{{ entropy.total.toFixed(1) }} bits</span>
        <span class="entropy-tier" :class="'meter-' + tier.id" :title="tier.id === 'weak' ? ('Below ' + floor + ' bits. Add a word, a character type, or length.') : ('The bar fills at 100 bits; ' + floor + ' is the weak line, 60 good, 80 strong.')">{{ tier.label }}</span>
        <span v-if="delta !== null" class="entropy-delta" :class="delta > 0 ? 'is-up' : 'is-down'" :title="'This password is ' + Math.abs(delta).toFixed(1) + ' bits ' + (delta > 0 ? 'stronger' : 'weaker') + ' than the previous one'">{{ delta > 0 ? '&#9650;' : '&#9660;' }} {{ Math.abs(delta).toFixed(1) }} vs last</span>
        <span class="entropy-how" aria-hidden="true">how?</span>
      </summary>
      <ul class="entropy-parts">
        <li v-for="p in entropy.parts" :key="p.label" :class="{ 'ep-zero': p.bits === 0 }">
          <span class="ep-bits">{{ p.bits === 0 ? '0' : '+' + p.bits.toFixed(1) }}</span>
          <span class="ep-label">{{ p.label }}</span>
          <span v-if="p.note" class="ep-note">{{ p.note }}</span>
        </li>
      </ul>
    </details>
  `
}

// Reusable affix chip-picker + optional literal text — rendered as a template string component
const AffixPicker = {
  name: 'AffixPicker',
  props: { label: String, modelValue: String, customValue: String, options: { default: () => AFFIX_OPTIONS } },
  emits: ['update:modelValue', 'update:customValue'],
  setup(props, { emit }) {
    return {
      onMode(v) { emit('update:modelValue', v) },
      onCustom(e) { emit('update:customValue', e.target.value) },
    }
  },
  template: `
    <div class="affix-block">
      <div class="affix-label">{{ label }}</div>
      <div class="separator-grid">
        <label
          v-for="opt in options"
          :key="opt.value"
          class="sep-option"
          :class="{ active: modelValue === opt.value }"
        >
          <input :value="opt.value" :checked="modelValue === opt.value" @change="onMode(opt.value)" type="radio" class="sr-only" />
          <span>{{ opt.label }}</span>
        </label>
      </div>
      <div v-if="modelValue === 'custom'" class="custom-sep-row">
        <input
          :value="customValue"
          @input="onCustom"
          type="text"
          class="form-input"
          placeholder="Type literal text"
        />
      </div>
    </div>
  `
}

// Simple Password Generator Component
const SimplePassword = {
  name: 'SimplePassword',
  components: { HistoryStrip, EntropyPanel },
  setup() {
    const passwordLength = persistedRef('simple.passwordLength', 20)
    const lowerCase = persistedRef('simple.lowerCase', true)
    const upperCase = persistedRef('simple.upperCase', true)
    const digits = persistedRef('simple.digits', true)
    const specialChars = persistedRef('simple.specialChars', true)
    const useEmoji = persistedRef('simple.useEmoji', false)
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
      if (!lowerCase.value && !upperCase.value && !digits.value && !specialChars.value && !useEmoji.value) {
        showNotification('Please select at least one character type', 'error')
        return
      }

      const availableTypes = []
      if (lowerCase.value) availableTypes.push('lower')
      if (upperCase.value) availableTypes.push('upper')
      if (digits.value) availableTypes.push('digits')
      if (specialChars.value) availableTypes.push('special')
      if (useEmoji.value) availableTypes.push('emoji')

      let newPassword = ''
      for (let i = 0; i < passwordLength.value; i++) {
        const type = randPick(availableTypes)
        switch (type) {
          case 'lower':   newPassword += randChar(characterSets.lower); break
          case 'upper':   newPassword += randChar(characterSets.upper); break
          case 'digits':  newPassword += randChar(characterSets.digits); break
          case 'special': newPassword += randChar(characterSets.special); break
          case 'emoji':   newPassword += pickEmoji('default'); break
        }
      }

      password.value = newPassword

      // Bits of the process as written: a type uniformly, then a character
      // within it. Characters are NOT uniform over the union pool, so the
      // naive log2(union^length) would overstate -- see simpleBits.
      const setSizes = []
      if (lowerCase.value) setSizes.push(characterSets.lower.length)
      if (upperCase.value) setSizes.push(characterSets.upper.length)
      if (digits.value) setSizes.push(characterSets.digits.length)
      if (specialChars.value) setSizes.push(characterSets.special.length)
      if (useEmoji.value) setSizes.push(EMOJI_POOLS.default.length)
      entropy.value = simpleBits({ length: parseInt(passwordLength.value), setSizes })
      pushHistory(newPassword, entropy.value.total)
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
      password,
      entropy,
      recallHistory,
      history,
      copied,
      notification,
      generatePassword,
      copyPassword
    }
  },
  template: `
    <div class="password-generator">
      <div class="card">
        <div class="card-header">Password Length</div>
        <div class="slider-container">
          <button class="stepper-btn" aria-label="Decrease password length" @click="passwordLength = Math.max(6, passwordLength - 1)"><span class="mdi mdi-minus"></span></button>
          <input
            v-model="passwordLength"
            type="range"
            aria-label="Password Length"
            min="6"
            max="128"
            class="slider"
          />
          <button class="stepper-btn" aria-label="Increase password length" @click="passwordLength = Math.min(128, passwordLength + 1)"><span class="mdi mdi-plus"></span></button>
          <div class="slider-value">{{ passwordLength }}</div>
        </div>
      </div>

      <div class="card">
        <div class="card-header">Character Types</div>
        <div class="checkbox-group">
          <label class="checkbox-item">
            <input v-model="lowerCase" type="checkbox" class="checkbox" />
            <span>Lowercase letters (a-z)</span>
          </label>
          <label class="checkbox-item">
            <input v-model="upperCase" type="checkbox" class="checkbox" />
            <span>Uppercase letters (A-Z)</span>
          </label>
          <label class="checkbox-item">
            <input v-model="digits" type="checkbox" class="checkbox" />
            <span>Numbers (0-9)</span>
          </label>
          <label class="checkbox-item">
            <input v-model="specialChars" type="checkbox" class="checkbox" />
            <span>Symbols (!@#$%^&*)</span>
          </label>
          <label class="checkbox-item">
            <input v-model="useEmoji" type="checkbox" class="checkbox" />
            <span>Emoji 🎲</span>
          </label>
        </div>
      </div>

      <div class="card">
        <button @click="generatePassword" class="btn btn-primary">
          <span class="mdi mdi-shuffle-variant"></span> Generate Password
        </button>
      </div>

      <div class="card">
        <div class="password-display">
          <div
            class="form-input password-input"
            role="textbox"
            aria-readonly="true"
            aria-label="Generated password"
            tabindex="0"
          >{{ password }}<span v-if="!password" class="password-placeholder" aria-hidden="true">Generated password will appear here...</span></div>
          <button @click="copyPassword" :class="['copy-btn', { copied }]" :title="copied ? 'Copied!' : 'Copy to clipboard'">
            <span :class="['mdi', copied ? 'mdi-check' : 'mdi-content-copy']"></span>
          </button>
        </div>
        <EntropyPanel :entropy="entropy" />
        <HistoryStrip :history="history" :current="password" @select="recallHistory($event)" />
        <div v-if="notification.show" :class="['notification', notification.type]" role="status" aria-live="polite">
          {{ notification.message }}
        </div>
      </div>
    </div>
  `
}
const AdvancedPassword = {
  name: 'AdvancedPassword',
  components: { HistoryStrip, EntropyPanel },
  setup() {
    const passwordLength = persistedRef('adv.passwordLength', 20)
    const lowerCase = persistedRef('adv.lowerCase', [1, 20])
    const upperCase = persistedRef('adv.upperCase', [1, 20])
    const digits = persistedRef('adv.digits', [1, 20])
    const specialChars = persistedRef('adv.specialChars', [1, 20])
    const ALL_SYMBOLS = '!#$%&()*+,-./:;<=>?@[]^_`{|}~'.split('')
    const activeSymbols = persistedRef('adv.activeSymbols', new Set(ALL_SYMBOLS))
    const emojiCount = persistedRef('adv.emojiCount', [0, 0])
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
      if (passwordLength.value === 0) {
        password.value = ''
        return
      }

      const len = parseInt(passwordLength.value)
      const emMin = parseInt(emojiCount.value[0]), emMax = parseInt(emojiCount.value[1])
      const minTotal = parseInt(lowerCase.value[0]) + parseInt(upperCase.value[0]) + parseInt(digits.value[0]) + parseInt(specialChars.value[0]) + emMin
      const maxTotal = parseInt(lowerCase.value[1]) + parseInt(upperCase.value[1]) + parseInt(digits.value[1]) + parseInt(specialChars.value[1]) + emMax

      if (minTotal > len) {
        showNotification('Minimum character requirements exceed password length', 'error')
        return
      }

      if (maxTotal < len) {
        showNotification('Maximum character limits are less than password length', 'error')
        return
      }

      const lcMin = parseInt(lowerCase.value[0]), lcMax = parseInt(lowerCase.value[1])
      const ucMin = parseInt(upperCase.value[0]), ucMax = parseInt(upperCase.value[1])
      const dgMin = parseInt(digits.value[0]), dgMax = parseInt(digits.value[1])
      const spMin = parseInt(specialChars.value[0]), spMax = parseInt(specialChars.value[1])

      let charTypes = []

      // Add minimum required characters
      for (let i = 0; i < lcMin; i++) charTypes.push('lower')
      for (let i = 0; i < ucMin; i++) charTypes.push('upper')
      for (let i = 0; i < dgMin; i++) charTypes.push('digits')
      for (let i = 0; i < spMin; i++) charTypes.push('special')
      for (let i = 0; i < emMin; i++) charTypes.push('emoji')

      // Fill remaining slots randomly within limits
      while (charTypes.length < len) {
        const lowerCount = charTypes.filter(t => t === 'lower').length
        const upperCount = charTypes.filter(t => t === 'upper').length
        const digitCount = charTypes.filter(t => t === 'digits').length
        const specialCount = charTypes.filter(t => t === 'special').length
        const emojiCountCur = charTypes.filter(t => t === 'emoji').length

        const availableTypes = []
        if (lowerCount < lcMax) availableTypes.push('lower')
        if (upperCount < ucMax) availableTypes.push('upper')
        if (digitCount < dgMax) availableTypes.push('digits')
        if (specialCount < spMax) availableTypes.push('special')
        if (emojiCountCur < emMax) availableTypes.push('emoji')

        if (availableTypes.length === 0) break

        const randomType = randPick(availableTypes)
        charTypes.push(randomType)
      }

      // Shuffle character types
      for (let i = charTypes.length - 1; i > 0; i--) {
        const j = randInt(i + 1)
        ;[charTypes[i], charTypes[j]] = [charTypes[j], charTypes[i]]
      }

      // Generate actual password
      let newPassword = ''
      for (const type of charTypes) {
        switch (type) {
          case 'lower':   newPassword += randChar(characterSets.lower); break
          case 'upper':   newPassword += randChar(characterSets.upper); break
          case 'digits':  newPassword += randChar(characterSets.digits); break
          case 'special':  newPassword += randChar(customSymbols.value); break
          case 'emoji':   newPassword += pickEmoji('default'); break
        }
      }

      password.value = newPassword

      // Bits for the composition that was actually drawn: uniform arrangement
      // of the type multiset plus a uniform character per position. The type
      // composition itself carries a little extra entropy with no closed form,
      // so this is a floor -- under-reporting is the safe direction.
      const typeSpecs = [
        ['lower', 'lowercase', characterSets.lower.length],
        ['upper', 'uppercase', characterSets.upper.length],
        ['digits', 'digits', characterSets.digits.length],
        ['special', 'symbols', Math.max(customSymbols.value.length, 1)],
        ['emoji', 'emoji', EMOJI_POOLS.default.length],
      ]
      entropy.value = advancedBits({
        counts: typeSpecs.map(([key, label, size]) => ({
          label, size, count: charTypes.filter((t) => t === key).length,
        })),
      })
      pushHistory(newPassword, entropy.value.total)
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
      copyPassword
    }
  },
  template: `
    <div class="password-generator">
      <div class="card">
        <div class="card-header">Password Length</div>
        <div class="slider-container">
          <button class="stepper-btn" aria-label="Decrease password length" @click="passwordLength = Math.max(6, passwordLength - 1)"><span class="mdi mdi-minus"></span></button>
          <input
            v-model="passwordLength"
            type="range"
            aria-label="Password Length"
            min="6"
            max="128"
            class="slider"
          />
          <button class="stepper-btn" aria-label="Increase password length" @click="passwordLength = Math.min(128, passwordLength + 1)"><span class="mdi mdi-plus"></span></button>
          <div class="slider-value">{{ passwordLength }}</div>
        </div>
      </div>

      <div class="card">
        <div class="card-header">Lowercase Letters</div>
        <div class="slider-container">
          <div class="stepper-label">
            <button class="stepper-btn" aria-label="Decrease min lowercase letters" @click="lowerCase[0] = Math.max(0, lowerCase[0] - 1)"><span class="mdi mdi-minus"></span></button>
            <span class="stepper-label-text">Min: {{ lowerCase[0] }}</span>
            <button class="stepper-btn" aria-label="Increase min lowercase letters" @click="lowerCase[0] = Math.min(passwordLength, lowerCase[0] + 1)"><span class="mdi mdi-plus"></span></button>
          </div>
          <input
            v-model="lowerCase[0]"
            type="range"
            aria-label="Lowercase Letters"
            min="0"
            :max="passwordLength"
            class="slider"
          />
          <input
            v-model="lowerCase[1]"
            type="range"
            aria-label="Lowercase Letters"
            min="0"
            :max="passwordLength"
            class="slider"
          />
          <div class="stepper-label">
            <button class="stepper-btn" aria-label="Decrease max lowercase letters" @click="lowerCase[1] = Math.max(0, lowerCase[1] - 1)"><span class="mdi mdi-minus"></span></button>
            <span class="stepper-label-text">Max: {{ lowerCase[1] }}</span>
            <button class="stepper-btn" aria-label="Increase max lowercase letters" @click="lowerCase[1] = Math.min(passwordLength, lowerCase[1] + 1)"><span class="mdi mdi-plus"></span></button>
          </div>
        </div>
      </div>

      <div class="card">
        <div class="card-header">Uppercase Letters</div>
        <div class="slider-container">
          <div class="stepper-label">
            <button class="stepper-btn" aria-label="Decrease min uppercase letters" @click="upperCase[0] = Math.max(0, upperCase[0] - 1)"><span class="mdi mdi-minus"></span></button>
            <span class="stepper-label-text">Min: {{ upperCase[0] }}</span>
            <button class="stepper-btn" aria-label="Increase min uppercase letters" @click="upperCase[0] = Math.min(passwordLength, upperCase[0] + 1)"><span class="mdi mdi-plus"></span></button>
          </div>
          <input
            v-model="upperCase[0]"
            type="range"
            aria-label="Uppercase Letters"
            min="0"
            :max="passwordLength"
            class="slider"
          />
          <input
            v-model="upperCase[1]"
            type="range"
            aria-label="Uppercase Letters"
            min="0"
            :max="passwordLength"
            class="slider"
          />
          <div class="stepper-label">
            <button class="stepper-btn" aria-label="Decrease max uppercase letters" @click="upperCase[1] = Math.max(0, upperCase[1] - 1)"><span class="mdi mdi-minus"></span></button>
            <span class="stepper-label-text">Max: {{ upperCase[1] }}</span>
            <button class="stepper-btn" aria-label="Increase max uppercase letters" @click="upperCase[1] = Math.min(passwordLength, upperCase[1] + 1)"><span class="mdi mdi-plus"></span></button>
          </div>
        </div>
      </div>

      <div class="card">
        <div class="card-header">Numbers</div>
        <div class="slider-container">
          <div class="stepper-label">
            <button class="stepper-btn" aria-label="Decrease min numbers" @click="digits[0] = Math.max(0, digits[0] - 1)"><span class="mdi mdi-minus"></span></button>
            <span class="stepper-label-text">Min: {{ digits[0] }}</span>
            <button class="stepper-btn" aria-label="Increase min numbers" @click="digits[0] = Math.min(passwordLength, digits[0] + 1)"><span class="mdi mdi-plus"></span></button>
          </div>
          <input
            v-model="digits[0]"
            type="range"
            aria-label="Numbers"
            min="0"
            :max="passwordLength"
            class="slider"
          />
          <input
            v-model="digits[1]"
            type="range"
            aria-label="Numbers"
            min="0"
            :max="passwordLength"
            class="slider"
          />
          <div class="stepper-label">
            <button class="stepper-btn" aria-label="Decrease max numbers" @click="digits[1] = Math.max(0, digits[1] - 1)"><span class="mdi mdi-minus"></span></button>
            <span class="stepper-label-text">Max: {{ digits[1] }}</span>
            <button class="stepper-btn" aria-label="Increase max numbers" @click="digits[1] = Math.min(passwordLength, digits[1] + 1)"><span class="mdi mdi-plus"></span></button>
          </div>
        </div>
      </div>

      <div class="card">
        <div class="card-header">Symbols</div>
        <div class="slider-container">
          <div class="stepper-label">
            <button class="stepper-btn" aria-label="Decrease min symbols" @click="specialChars[0] = Math.max(0, specialChars[0] - 1)"><span class="mdi mdi-minus"></span></button>
            <span class="stepper-label-text">Min: {{ specialChars[0] }}</span>
            <button class="stepper-btn" aria-label="Increase min symbols" @click="specialChars[0] = Math.min(passwordLength, specialChars[0] + 1)"><span class="mdi mdi-plus"></span></button>
          </div>
          <input
            v-model="specialChars[0]"
            type="range"
            aria-label="Symbols"
            min="0"
            :max="passwordLength"
            class="slider"
          />
          <input
            v-model="specialChars[1]"
            type="range"
            aria-label="Symbols"
            min="0"
            :max="passwordLength"
            class="slider"
          />
          <div class="stepper-label">
            <button class="stepper-btn" aria-label="Decrease max symbols" @click="specialChars[1] = Math.max(0, specialChars[1] - 1)"><span class="mdi mdi-minus"></span></button>
            <span class="stepper-label-text">Max: {{ specialChars[1] }}</span>
            <button class="stepper-btn" aria-label="Increase max symbols" @click="specialChars[1] = Math.min(passwordLength, specialChars[1] + 1)"><span class="mdi mdi-plus"></span></button>
          </div>
        </div>
        <div class="form-group">
          <div class="symbol-chips-header">
            <label class="form-label">Symbol Set</label>
            <div class="symbol-chips-actions">
              <button type="button" class="chip-action" @click="selectAllSymbols">All</button>
              <button type="button" class="chip-action" @click="selectCommonSymbols">Common</button>
              <button type="button" class="chip-action" @click="selectNoSymbols">None</button>
            </div>
          </div>
          <div class="symbol-chips">
            <button
              v-for="sym in allSymbols"
              :key="sym"
              type="button"
              class="symbol-chip"
              :class="{ active: activeSymbols.has(sym) }"
              @click="toggleSymbol(sym)"
            >{{ sym }}</button>
          </div>
        </div>
      </div>

      <div class="card">
        <div class="card-header">Emoji 🎲</div>
        <div class="slider-container">
          <div class="stepper-label">
            <button class="stepper-btn" aria-label="Decrease min emoji 🎲" @click="emojiCount[0] = Math.max(0, emojiCount[0] - 1)"><span class="mdi mdi-minus"></span></button>
            <span class="stepper-label-text">Min: {{ emojiCount[0] }}</span>
            <button class="stepper-btn" aria-label="Increase min emoji 🎲" @click="emojiCount[0] = Math.min(passwordLength, emojiCount[0] + 1)"><span class="mdi mdi-plus"></span></button>
          </div>
          <input
            v-model="emojiCount[0]"
            type="range"
            aria-label="Emoji"
            min="0"
            :max="passwordLength"
            class="slider"
          />
          <input
            v-model="emojiCount[1]"
            type="range"
            aria-label="Emoji 🎲"
            min="0"
            :max="passwordLength"
            class="slider"
          />
          <div class="stepper-label">
            <button class="stepper-btn" aria-label="Decrease max emoji 🎲" @click="emojiCount[1] = Math.max(0, emojiCount[1] - 1)"><span class="mdi mdi-minus"></span></button>
            <span class="stepper-label-text">Max: {{ emojiCount[1] }}</span>
            <button class="stepper-btn" aria-label="Increase max emoji 🎲" @click="emojiCount[1] = Math.min(passwordLength, emojiCount[1] + 1)"><span class="mdi mdi-plus"></span></button>
          </div>
        </div>
      </div>

      <div class="card">
        <button @click="generatePassword" class="btn btn-primary">
          <span class="mdi mdi-shuffle-variant"></span> Generate Password
        </button>
      </div>

      <div class="card">
        <div class="password-display">
          <div
            class="form-input password-input"
            role="textbox"
            aria-readonly="true"
            aria-label="Generated password"
            tabindex="0"
          >{{ password }}<span v-if="!password" class="password-placeholder" aria-hidden="true">Generated password will appear here...</span></div>
          <button @click="copyPassword" :class="['copy-btn', { copied }]" :title="copied ? 'Copied!' : 'Copy to clipboard'">
            <span :class="['mdi', copied ? 'mdi-check' : 'mdi-content-copy']"></span>
          </button>
        </div>
        <EntropyPanel :entropy="entropy" />
        <HistoryStrip :history="history" :current="password" @select="recallHistory($event)" />
        <div v-if="notification.show" :class="['notification', notification.type]" role="status" aria-live="polite">
          {{ notification.message }}
        </div>
      </div>
    </div>
  `
}

// Words Password Generator Component
const WordsPassword = {
  name: 'WordsPassword',
  components: { AffixPicker, HistoryStrip, EntropyPanel },
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
    const toggleLeet = (char) => {
      const next = new Set(activeLeet.value)
      if (next.has(char)) next.delete(char)
      else next.add(char)
      activeLeet.value = next
    }
    const selectAllLeet = () => { activeLeet.value = new Set(LEET_MAP.map(m => m.char)) }
    const selectNoLeet = () => { activeLeet.value = new Set() }
    const lockAffixes = persistedRef('words.lockAffixes', false)
    const password = ref('')
    const entropy = ref(null)
    const recallHistory = (entry) => recallEntry(entry, password, entropy)
    const preview = ref('')
    const rawWords = ref([])
    const cachedPre = ref('')
    const cachedSep = ref('')
    const cachedSuf = ref('')
    const { history, pushHistory } = useHistory('words.history')
    const { copied, notification, showNotification, copyPassword } = useCopyPassword(password)
    const wordList = ref([])

    const loadWordList = async () => {
      try {
        // Orchard Street Long: 17,576 words (26^3), 14.101 bits each, against
        // the EFF list's 7,776 and 12.925. It is also uniquely decodable, which
        // matters here because the separator can be set to None -- concatenated
        // EFF words could parse more than one way. One word per line, where the
        // EFF file was comma-separated.
        const response = await fetch('./data/orchard-street-long.txt')
        const text = await response.text()
        wordList.value = text.split(/\r?\n/).map(word => word.trim()).filter(word => word.length > 0)
      } catch (err) {
        console.error('Failed to load word list:', err)
        wordList.value = ['ability', 'account', 'action', 'active', 'address', 'advance', 'agency', 'agent', 'agree', 'allow', 'amount', 'animal', 'answer', 'appear', 'approach', 'area', 'argue', 'around', 'arrive', 'article', 'artist', 'assume', 'attack', 'attempt', 'attend', 'author', 'avoid', 'balance', 'become', 'before', 'begin', 'believe', 'benefit', 'better', 'between', 'beyond', 'budget', 'build', 'business']
      }
    }

    const rollAffixes = () => {
      cachedPre.value = resolveToken(prefixMode.value, prefixCustom.value)
      cachedSuf.value = resolveSuffixToken(suffixMode.value, suffixCustom.value, cachedPre.value)
      cachedSep.value = resolveToken(separator.value, customSeparator.value)
    }

    const buildPassword = (rerollAffixes = false) => {
      if (rerollAffixes || !lockAffixes.value) rollAffixes()
      preview.value = rawWords.value.map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ')
      const words = rawWords.value.map((w, i, arr) => {
        const cased = applyCapitalization(w, capitalization.value, i, arr.length)
        return useEmoji.value ? pickEmoji('default') + cased : cased
      })
      const joined = isPerGapSeparator(separator.value) ? joinPerGap(words, separator.value) : words.join(cachedSep.value)
      const assembled = cachedPre.value + joined + cachedSuf.value
      password.value = activeLeet.value.size > 0 ? applyLeet(assembled, activeLeet.value) : assembled
      entropy.value = wordsBits({
        wordCount: rawWords.value.length,
        listSize: Math.max(wordList.value.length, 1),
        capitalization: capitalization.value,
        letterCount: rawWords.value.join('').length,
        separator: separator.value,
        prefix: prefixMode.value,
        suffix: suffixMode.value,
        emoji: useEmoji.value,
        leetActive: activeLeet.value.size,
      })
      pushHistory(password.value, entropy.value.total)
    }

    const generatePassword = () => {
      if (wordList.value.length === 0) {
        showNotification('Word list not loaded', 'error')
        return
      }
      rawWords.value = Array.from({ length: wordCount.value }, () =>
        randPick(wordList.value)
      )
      buildPassword(true)
    }

    const regenWord = (idx) => {
      if (wordList.value.length === 0) return
      const next = [...rawWords.value]
      next[idx] = randPick(wordList.value)
      rawWords.value = next
      buildPassword(false)
    }

    watch(useEmoji, () => { if (rawWords.value.length) buildPassword() })

    onMounted(async () => {
      await loadWordList()
      generatePassword()
    })

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
      regenWord,
      copyPassword
    }
  },
  template: `
    <div class="password-generator">
      <div class="card">
        <div class="card-header">Number of Words</div>
        <div class="slider-container">
          <button class="stepper-btn" aria-label="Decrease number of words" @click="wordCount = Math.max(2, wordCount - 1)"><span class="mdi mdi-minus"></span></button>
          <input
            v-model="wordCount"
            type="range"
            aria-label="Number of Words"
            min="2"
            max="20"
            class="slider"
          />
          <button class="stepper-btn" aria-label="Increase number of words" @click="wordCount = Math.min(20, wordCount + 1)"><span class="mdi mdi-plus"></span></button>
          <div class="slider-value">{{ wordCount }}</div>
        </div>
      </div>

      <div class="card">
        <div class="card-header">Word Separator</div>
        <div class="separator-grid">
          <label v-for="opt in separatorOptions" :key="opt.value" class="sep-option" :class="{ active: separator === opt.value }">
            <input v-model="separator" :value="opt.value" type="radio" class="radio sr-only" />
            <span>{{ opt.label }}</span>
          </label>
        </div>
        <div v-if="separator === 'custom'" class="custom-sep-row">
          <input
            v-model="customSeparator"
            type="text"
            class="form-input"
            placeholder="Type your separator"
          />
        </div>
      </div>

      <div class="card">
        <div class="card-header">Capitalization</div>
        <div class="separator-grid">
          <label class="sep-option" :class="{ active: capitalization === 'title' }">
            <input v-model="capitalization" value="title" type="radio" class="sr-only" />
            <span>Title Case</span>
          </label>
          <label class="sep-option" :class="{ active: capitalization === 'none' }">
            <input v-model="capitalization" value="none" type="radio" class="sr-only" />
            <span>lowercase</span>
          </label>
          <label class="sep-option" :class="{ active: capitalization === 'upper' }">
            <input v-model="capitalization" value="upper" type="radio" class="sr-only" />
            <span>UPPERCASE</span>
          </label>
          <label class="sep-option" :class="{ active: capitalization === 'random' }">
            <input v-model="capitalization" value="random" type="radio" class="sr-only" />
            <span>rAndOm LetTerS</span>
          </label>
          <label class="sep-option" :class="{ active: capitalization === 'char-alt' }">
            <input v-model="capitalization" value="char-alt" type="radio" class="sr-only" />
            <span>AlTeRnAtInG</span>
          </label>
          <label class="sep-option" :class="{ active: capitalization === 'last-upper' }">
            <input v-model="capitalization" value="last-upper" type="radio" class="sr-only" />
            <span>lasT letteR</span>
          </label>
          <label class="sep-option" :class="{ active: capitalization === 'first-only' }">
            <input v-model="capitalization" value="first-only" type="radio" class="sr-only" />
            <span>FIRST word only</span>
          </label>
          <label class="sep-option" :class="{ active: capitalization === 'last-only' }">
            <input v-model="capitalization" value="last-only" type="radio" class="sr-only" />
            <span>last word ONLY</span>
          </label>
          <label class="sep-option" :class="{ active: capitalization === 'word-alt' }">
            <input v-model="capitalization" value="word-alt" type="radio" class="sr-only" />
            <span>WORD word WORD word</span>
          </label>
          <label class="sep-option" :class="{ active: capitalization === 'word-random' }">
            <input v-model="capitalization" value="word-random" type="radio" class="sr-only" />
            <span>WORD word is RANDOM</span>
          </label>
        </div>
      </div>

      <div class="card">
        <div class="card-header">Prefix &amp; Suffix</div>
        <div class="affix-pair">
          <AffixPicker
            label="Prefix"
            :modelValue="prefixMode"
            :customValue="prefixCustom"
            @update:modelValue="prefixMode = $event"
            @update:customValue="prefixCustom = $event"
          />
          <div class="affix-divider"></div>
          <AffixPicker
            label="Suffix"
            :modelValue="suffixMode"
            :customValue="suffixCustom"
            :options="suffixOptions"
            @update:modelValue="suffixMode = $event"
            @update:customValue="suffixCustom = $event"
          />
        </div>
      </div>

      <div class="card">
        <div class="form-group">
          <div class="symbol-chips-header">
            <label class="form-label">Leet Speak Substitutions</label>
            <div class="symbol-chips-actions">
              <button type="button" class="chip-action" @click="selectAllLeet">All</button>
              <button type="button" class="chip-action" @click="selectNoLeet">None</button>
            </div>
          </div>
          <div class="symbol-chips">
            <button
              v-for="entry in leetMap"
              :key="entry.char"
              type="button"
              class="symbol-chip leet-chip"
              :class="{ active: activeLeet.has(entry.char) }"
              @click="toggleLeet(entry.char)"
            >{{ entry.label }}</button>
          </div>
        </div>
        <div class="emoji-toggle-row">
          <label class="form-label">Emoji</label>
          <button type="button" class="emoji-toggle-btn" :class="{ active: useEmoji }" @click="useEmoji = !useEmoji" title="Prepend a random emoji to each word">
            <span class="emoji-toggle-icon">🎲</span>
            <span class="emoji-toggle-label">{{ useEmoji ? 'On' : 'Off' }}</span>
          </button>
        </div>
      </div>

      <div class="card">
        <button @click="generatePassword" class="btn btn-primary">
          <span class="mdi mdi-shuffle-variant"></span> Generate Password
        </button>
      </div>

      <div class="card">
        <div v-if="rawWords.length" class="word-pills-row">
          <div class="word-pills">
            <button
              v-for="(w, i) in rawWords"
              :key="i"
              class="word-pill"
              @click="regenWord(i)"
              title="Click to swap this word"
            >
              <span class="word-pill-text">{{ w }}</span>
              <span class="mdi mdi-shuffle-variant word-pill-icon"></span>
            </button>
          </div>
          <button
            class="lock-affixes-btn"
            :class="{ active: lockAffixes }"
            @click="lockAffixes = !lockAffixes"
            :title="lockAffixes ? 'Prefix/separator/suffix locked — click to unlock' : 'Click to lock prefix/separator/suffix when swapping words'"
          >
            <span :class="['mdi', lockAffixes ? 'mdi-lock' : 'mdi-lock-open-outline']"></span>
          </button>
        </div>

        <div class="password-display">
          <div
            :class="['form-input', 'password-input', { 'has-length-pill': password.length > 0 }]"
            role="textbox"
            aria-readonly="true"
            aria-label="Generated password"
            tabindex="0"
          >{{ password }}<span v-if="!password" class="password-placeholder" aria-hidden="true">Generated password will appear here...</span></div>
          <span v-if="password.length > 0" class="length-pill">{{ password.length }}</span>
          <button @click="copyPassword" :class="['copy-btn', { copied }]" :title="copied ? 'Copied!' : 'Copy to clipboard'">
            <span :class="['mdi', copied ? 'mdi-check' : 'mdi-content-copy']"></span>
          </button>
        </div>
        <EntropyPanel :entropy="entropy" />
        <HistoryStrip :history="history" :current="password" @select="recallHistory($event)" />
        <div v-if="notification.show" :class="['notification', notification.type]" role="status" aria-live="polite">
          {{ notification.message }}
        </div>
      </div>
    </div>
  `
}

// Numbers Password Generator Component
const NumbersPassword = {
  name: 'NumbersPassword',
  components: { HistoryStrip, EntropyPanel },
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
      let newPassword = ''
      let repeatedCount = 0
      let sequentialCount = 0
      let sequenceDirection = null // 'up', 'down', or null
      
      for (let i = 0; i < passwordLength.value; i++) {
        let availableDigits = '0123456789'
        const lastDigit = newPassword.slice(-1)
        
        if (lastDigit) {
          const lastNum = parseInt(lastDigit)
          
          // Remove digits that would exceed repeat limit
          if (repeatedCount >= maxRepeated.value) {
            availableDigits = availableDigits.replace(lastDigit, '')
          }
          
          // Remove digits that would exceed sequential limit
          if (sequentialCount >= maxSequential.value) {
            if (sequenceDirection === 'up' && lastNum < 9) {
              availableDigits = availableDigits.replace((lastNum + 1).toString(), '')
            }
            if (sequenceDirection === 'down' && lastNum > 0) {
              availableDigits = availableDigits.replace((lastNum - 1).toString(), '')
            }
          }
        }
        
        if (availableDigits.length === 0) {
          availableDigits = '0123456789'
        }
        
        const nextDigit = randChar(availableDigits)
        newPassword += nextDigit
        
        // Update counters
        if (lastDigit) {
          const lastNum = parseInt(lastDigit)
          const nextNum = parseInt(nextDigit)
          
          if (nextDigit === lastDigit) {
            repeatedCount++
            sequentialCount = 1
            sequenceDirection = null
          } else if (nextNum === lastNum + 1) {
            if (sequenceDirection === 'up') {
              sequentialCount++
            } else {
              sequentialCount = 2
              sequenceDirection = 'up'
            }
            repeatedCount = 1
          } else if (nextNum === lastNum - 1) {
            if (sequenceDirection === 'down') {
              sequentialCount++
            } else {
              sequentialCount = 2
              sequenceDirection = 'down'
            }
            repeatedCount = 1
          } else {
            repeatedCount = 1
            sequentialCount = 1
            sequenceDirection = null
          }
        } else {
          repeatedCount = 1
          sequentialCount = 1
        }
      }
      
      password.value = newPassword

      // Exact: replays the filtered-pool state machine over the password just
      // produced, so the repeat and sequence limits are priced at what they
      // actually removed on this path.
      entropy.value = numbersBits({
        password: newPassword,
        maxRepeated: parseInt(maxRepeated.value),
        maxSequential: parseInt(maxSequential.value),
      })
      pushHistory(newPassword, entropy.value.total)
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
      copyPassword
    }
  },
  template: `
    <div class="password-generator">
      <div class="card">
        <div class="card-header">Number of Digits</div>
        <div class="slider-container">
          <button class="stepper-btn" aria-label="Decrease number of digits" @click="passwordLength = Math.max(4, passwordLength - 1)"><span class="mdi mdi-minus"></span></button>
          <input
            v-model="passwordLength"
            type="range"
            aria-label="Number of Digits"
            min="4"
            max="32"
            class="slider"
          />
          <button class="stepper-btn" aria-label="Increase number of digits" @click="passwordLength = Math.min(32, passwordLength + 1)"><span class="mdi mdi-plus"></span></button>
          <div class="slider-value">{{ passwordLength }}</div>
        </div>
      </div>

      <div class="card">
        <div class="card-header">Maximum Repeated Digits</div>
        <div class="slider-container">
          <button class="stepper-btn" aria-label="Decrease maximum repeated digits" @click="maxRepeated = Math.max(2, maxRepeated - 1)"><span class="mdi mdi-minus"></span></button>
          <input
            v-model="maxRepeated"
            type="range"
            aria-label="Maximum Repeated Digits"
            min="2"
            max="5"
            class="slider"
          />
          <button class="stepper-btn" aria-label="Increase maximum repeated digits" @click="maxRepeated = Math.min(5, maxRepeated + 1)"><span class="mdi mdi-plus"></span></button>
          <div class="slider-value">{{ maxRepeated }}</div>
        </div>
      </div>

      <div class="card">
        <div class="card-header">Maximum Sequential Digits</div>
        <div class="slider-container">
          <button class="stepper-btn" aria-label="Decrease maximum sequential digits" @click="maxSequential = Math.max(2, maxSequential - 1)"><span class="mdi mdi-minus"></span></button>
          <input
            v-model="maxSequential"
            type="range"
            aria-label="Maximum Sequential Digits"
            min="2"
            max="5"
            class="slider"
          />
          <button class="stepper-btn" aria-label="Increase maximum sequential digits" @click="maxSequential = Math.min(5, maxSequential + 1)"><span class="mdi mdi-plus"></span></button>
          <div class="slider-value">{{ maxSequential }}</div>
        </div>
      </div>

      <div class="card">
        <button @click="generatePassword" class="btn btn-primary">
          <span class="mdi mdi-shuffle-variant"></span> Generate Password
        </button>
      </div>

      <div class="card">
        <div class="password-display">
          <div
            class="form-input password-input"
            role="textbox"
            aria-readonly="true"
            aria-label="Generated password"
            tabindex="0"
          >{{ password }}<span v-if="!password" class="password-placeholder" aria-hidden="true">Generated password will appear here...</span></div>
          <button @click="copyPassword" :class="['copy-btn', { copied }]" :title="copied ? 'Copied!' : 'Copy to clipboard'">
            <span :class="['mdi', copied ? 'mdi-check' : 'mdi-content-copy']"></span>
          </button>
        </div>
        <EntropyPanel :entropy="entropy" />
        <HistoryStrip :history="history" :current="password" @select="recallHistory($event)" />
        <div v-if="notification.show" :class="['notification', notification.type]" role="status" aria-live="polite">
          {{ notification.message }}
        </div>
      </div>
    </div>
  `
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
    const toggleLeet = (char) => {
      const next = new Set(activeLeet.value)
      if (next.has(char)) next.delete(char)
      else next.add(char)
      activeLeet.value = next
    }
    const selectAllLeet = () => { activeLeet.value = new Set(LEET_MAP.map(m => m.char)) }
    const selectNoLeet = () => { activeLeet.value = new Set() }
    const lockAffixes = persistedRef('phrase.lockAffixes', false)
    const password = ref('')
    const entropy = ref(null)
    const recallHistory = (entry) => recallEntry(entry, password, entropy)
    const preview = ref('')
    const rawWords = ref([])
    const cachedPre = ref('')
    const cachedSep = ref('')
    const cachedSuf = ref('')
    const { history, pushHistory } = useHistory('phrase.history')
    const { copied, notification, showNotification, copyPassword } = useCopyPassword(password, 'passphrase')
    const wordData = ref({})

    const loadWordData = async () => {
      try {
        const res = await fetch('./data/words.json')
        wordData.value = await res.json()
      } catch (err) {
        console.error('Failed to load word data:', err)
      }
    }

    const pickFrom = (type, catId) => {
      const cats = wordData.value[type]
      if (!cats) return type
      const pool = catId === 'random' ? allOf(cats) : (cats[catId] || allOf(cats))
      return randPick(pool)
    }

    const rollAffixes = () => {
      cachedPre.value = resolveToken(prefixMode.value, prefixCustom.value)
      cachedSuf.value = resolveSuffixToken(suffixMode.value, suffixCustom.value, cachedPre.value)
      cachedSep.value = resolveToken(separator.value, customSeparator.value)
    }

    const buildPassword = (rerollAffixes = false) => {
      if (rerollAffixes || !lockAffixes.value) rollAffixes()
      preview.value = rawWords.value.map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ')
      const words = rawWords.value.map((w, i, arr) => {
        const cased = applyCapitalization(w, capitalization.value, i, arr.length)
        if (useEmoji.value) {
          const slot = slots.value[i]
          const emojiCat = slot?.cat === 'random' ? slot?.type : (slot?.cat || 'default')
          return pickEmoji(emojiCat) + cased
        }
        return cased
      })
      const joined = isPerGapSeparator(separator.value) ? joinPerGap(words, separator.value) : words.join(cachedSep.value)
      const assembled = cachedPre.value + joined + cachedSuf.value
      password.value = activeLeet.value.size > 0 ? applyLeet(assembled, activeLeet.value) : assembled
      const slotInfos = slots.value.map((s) => {
        const cats = wordData.value[s.type] || {}
        const pool = s.cat === 'random' ? allOf(cats) : (cats[s.cat] || allOf(cats))
        const emojiCat = s.cat === 'random' ? s.type : (s.cat || 'default')
        return {
          label: s.cat === 'random' ? s.type : `${s.type} · ${s.cat}`,
          poolSize: Math.max(pool.length, 1),
          // Mirrors pickEmoji's lookup exactly, fallback included.
          emojiPoolSize: (EMOJI_POOLS[emojiCat] || EMOJI_POOLS.default).length,
        }
      })
      entropy.value = slotBits({
        slots: slotInfos,
        capitalization: capitalization.value,
        letterCount: rawWords.value.join('').length,
        separator: separator.value,
        prefix: prefixMode.value,
        suffix: suffixMode.value,
        emoji: useEmoji.value,
        leetActive: activeLeet.value.size,
      })
      pushHistory(password.value, entropy.value.total)
    }

    const generatePassword = () => {
      if (slots.value.length === 0) {
        showNotification('Add at least one word slot', 'error')
        return
      }
      rawWords.value = slots.value.map(s => pickFrom(s.type, s.cat))
      buildPassword(true)
    }

    const regenWord = (idx) => {
      const slot = slots.value[idx]
      if (!slot) return
      const next = [...rawWords.value]
      next[idx] = pickFrom(slot.type, slot.cat)
      rawWords.value = next
      buildPassword(false)
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

    onMounted(async () => {
      await loadWordData()
      generatePassword()
    })

    return {
      slots,
      slotTypes: SLOT_TYPES,
      categoryMeta: CATEGORY_META,
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
      password, entropy, recallHistory, rawWords, history, copied, preview, notification,
      separatorOptions: SEPARATOR_OPTIONS,
      suffixOptions: SUFFIX_OPTIONS,
      generatePassword, regenWord, copyPassword
    }
  },
  components: { AffixPicker, HistoryStrip, EntropyPanel },
  template: `
    <div class="password-generator">

      <div class="card">
        <div class="card-header">Word Slots</div>

        <div class="slot-add-row">
          <span class="slot-add-label">Add:</span>
          <button
            v-for="t in slotTypes"
            :key="t.type"
            class="slot-add-btn"
            :class="t.color"
            @click="addSlot(t.type)"
            :disabled="slots.length >= 8"
          >+ {{ t.label }}</button>
        </div>

        <div class="slot-tray" v-if="slots.length > 0">
          <div
            v-for="(slot, idx) in slots"
            :key="slot.id"
            class="slot-pill"
            :class="'slot-' + slot.type"
          >
            <span class="slot-pill-label">{{ slot.type }}</span>
            <div class="slot-pill-actions">
              <button class="slot-arrow" @click="moveSlot(idx, -1)" :disabled="idx === 0" title="Move left">&#8592;</button>
              <button class="slot-arrow" @click="moveSlot(idx, 1)" :disabled="idx === slots.length - 1" title="Move right">&#8594;</button>
              <button class="slot-remove" @click="removeSlot(slot.id)" title="Remove">&#215;</button>
            </div>
            <select class="slot-cat-select" v-model="slot.cat">
              <option v-for="opt in categoryMeta[slot.type]" :key="opt.id" :value="opt.id">{{ opt.label }}</option>
            </select>
          </div>
        </div>

        <div v-else class="slot-empty">
          Add word slots above to build your passphrase structure.
        </div>
      </div>

      <div class="card">
        <div class="card-header">Word Separator</div>
        <div class="separator-grid">
          <label v-for="opt in separatorOptions" :key="opt.value" class="sep-option" :class="{ active: separator === opt.value }">
            <input v-model="separator" :value="opt.value" type="radio" class="sr-only" />
            <span>{{ opt.label }}</span>
          </label>
        </div>
        <div v-if="separator === 'custom'" class="custom-sep-row">
          <input v-model="customSeparator" type="text" class="form-input" placeholder="Type your separator" />
        </div>
      </div>

      <div class="card">
        <div class="card-header">Capitalization</div>
        <div class="separator-grid">
          <label class="sep-option" :class="{ active: capitalization === 'title' }">
            <input v-model="capitalization" value="title" type="radio" class="sr-only" />
            <span>Title Case</span>
          </label>
          <label class="sep-option" :class="{ active: capitalization === 'none' }">
            <input v-model="capitalization" value="none" type="radio" class="sr-only" />
            <span>lowercase</span>
          </label>
          <label class="sep-option" :class="{ active: capitalization === 'upper' }">
            <input v-model="capitalization" value="upper" type="radio" class="sr-only" />
            <span>UPPERCASE</span>
          </label>
          <label class="sep-option" :class="{ active: capitalization === 'random' }">
            <input v-model="capitalization" value="random" type="radio" class="sr-only" />
            <span>rAndOm LetTerS</span>
          </label>
          <label class="sep-option" :class="{ active: capitalization === 'char-alt' }">
            <input v-model="capitalization" value="char-alt" type="radio" class="sr-only" />
            <span>AlTeRnAtInG</span>
          </label>
          <label class="sep-option" :class="{ active: capitalization === 'last-upper' }">
            <input v-model="capitalization" value="last-upper" type="radio" class="sr-only" />
            <span>lasT letteR</span>
          </label>
          <label class="sep-option" :class="{ active: capitalization === 'first-only' }">
            <input v-model="capitalization" value="first-only" type="radio" class="sr-only" />
            <span>FIRST word only</span>
          </label>
          <label class="sep-option" :class="{ active: capitalization === 'last-only' }">
            <input v-model="capitalization" value="last-only" type="radio" class="sr-only" />
            <span>last word ONLY</span>
          </label>
          <label class="sep-option" :class="{ active: capitalization === 'word-alt' }">
            <input v-model="capitalization" value="word-alt" type="radio" class="sr-only" />
            <span>WORD word WORD word</span>
          </label>
          <label class="sep-option" :class="{ active: capitalization === 'word-random' }">
            <input v-model="capitalization" value="word-random" type="radio" class="sr-only" />
            <span>WORD word is RANDOM</span>
          </label>
        </div>
      </div>

      <div class="card">
        <div class="card-header">Prefix &amp; Suffix</div>
        <div class="affix-pair">
          <AffixPicker
            label="Prefix"
            :modelValue="prefixMode"
            :customValue="prefixCustom"
            @update:modelValue="prefixMode = $event"
            @update:customValue="prefixCustom = $event"
          />
          <div class="affix-divider"></div>
          <AffixPicker
            label="Suffix"
            :modelValue="suffixMode"
            :customValue="suffixCustom"
            :options="suffixOptions"
            @update:modelValue="suffixMode = $event"
            @update:customValue="suffixCustom = $event"
          />
        </div>
      </div>

      <div class="card">
        <div class="form-group">
          <div class="symbol-chips-header">
            <label class="form-label">Leet Speak Substitutions</label>
            <div class="symbol-chips-actions">
              <button type="button" class="chip-action" @click="selectAllLeet">All</button>
              <button type="button" class="chip-action" @click="selectNoLeet">None</button>
            </div>
          </div>
          <div class="symbol-chips">
            <button
              v-for="entry in leetMap"
              :key="entry.char"
              type="button"
              class="symbol-chip leet-chip"
              :class="{ active: activeLeet.has(entry.char) }"
              @click="toggleLeet(entry.char)"
            >{{ entry.label }}</button>
          </div>
        </div>
        <div class="emoji-toggle-row">
          <label class="form-label">Emoji</label>
          <button type="button" class="emoji-toggle-btn" :class="{ active: useEmoji }" @click="useEmoji = !useEmoji" title="Prepend a category-matched emoji to each word">
            <span class="emoji-toggle-icon">🎲</span>
            <span class="emoji-toggle-label">{{ useEmoji ? 'On' : 'Off' }}</span>
          </button>
        </div>
      </div>

      <div class="card">
        <button @click="generatePassword" class="btn btn-primary"><span class="mdi mdi-shuffle-variant"></span> Generate Passphrase</button>
      </div>

      <div class="card">
        <div v-if="rawWords.length" class="word-pills-row">
          <div class="word-pills">
            <button
              v-for="(w, i) in rawWords"
              :key="i"
              class="word-pill"
              :class="'word-pill-' + slots[i]?.type"
              @click="regenWord(i)"
              title="Click to swap this word"
            >
              <span class="word-pill-text">{{ w }}</span>
              <span class="mdi mdi-shuffle-variant word-pill-icon"></span>
            </button>
          </div>
          <button
            class="lock-affixes-btn"
            :class="{ active: lockAffixes }"
            @click="lockAffixes = !lockAffixes"
            :title="lockAffixes ? 'Prefix/separator/suffix locked — click to unlock' : 'Click to lock prefix/separator/suffix when swapping words'"
          >
            <span :class="['mdi', lockAffixes ? 'mdi-lock' : 'mdi-lock-open-outline']"></span>
          </button>
        </div>

        <div class="password-display">
          <div
            :class="['form-input', 'password-input', { 'has-length-pill': password.length > 0 }]"
            role="textbox"
            aria-readonly="true"
            aria-label="Generated password"
            tabindex="0"
          >{{ password }}<span v-if="!password" class="password-placeholder" aria-hidden="true">Generated password will appear here...</span></div>
          <span v-if="password.length > 0" class="length-pill">{{ password.length }}</span>
          <button @click="copyPassword" :class="['copy-btn', { copied }]" :title="copied ? 'Copied!' : 'Copy to clipboard'">
            <span :class="['mdi', copied ? 'mdi-check' : 'mdi-content-copy']"></span>
          </button>
        </div>
        <EntropyPanel :entropy="entropy" />
        <HistoryStrip :history="history" :current="password" @select="recallHistory($event)" />
        <div v-if="notification.show" :class="['notification', notification.type]" role="status" aria-live="polite">
          {{ notification.message }}
        </div>
      </div>
    </div>
  `
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
    const toggleLeet = (char) => {
      const next = new Set(activeLeet.value)
      if (next.has(char)) next.delete(char)
      else next.add(char)
      activeLeet.value = next
    }
    const selectAllLeet = () => { activeLeet.value = new Set(LEET_MAP.map(m => m.char)) }
    const selectNoLeet = () => { activeLeet.value = new Set() }
    const lockAffixes = persistedRef('wifi.lockAffixes', false)
    const password = ref('')
    const entropy = ref(null)
    const recallHistory = (entry) => recallEntry(entry, password, entropy)
    const preview = ref('')
    const rawWords = ref([])
    const cachedPre = ref('')
    const cachedSep = ref('')
    const cachedSuf = ref('')
    const { history, pushHistory } = useHistory('wifi.history')
    const { copied, notification, showNotification, copyPassword } = useCopyPassword(password, 'wifi')
    const wordData = ref({})
    const alliterationMode = persistedRef('wifi.alliterationMode', true)
    const alliterationLetter = ref('')

    const loadWordData = async () => {
      try {
        const res = await fetch('./data/words.json')
        wordData.value = await res.json()
      } catch (err) {
        console.error('Failed to load word data:', err)
      }
    }

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

    const pickAlliterationLetter = () => {
      const allPools = slots.value.map(s => {
        const cats = wordData.value[s.type]
        if (!cats) return new Set()
        const pool = s.cat === 'random' ? allOf(cats) : (cats[s.cat] || allOf(cats))
        return new Set(pool.map(w => w.charAt(0).toLowerCase()))
      })
      if (allPools.length === 0) return ''
      const common = [...allPools[0]].filter(l => allPools.every(p => p.has(l)))
      if (common.length === 0) return ''
      return randPick(common)
    }

    const rollAffixes = () => {
      cachedPre.value = resolveToken(prefixMode.value, prefixCustom.value)
      cachedSuf.value = resolveSuffixToken(suffixMode.value, suffixCustom.value, cachedPre.value)
      cachedSep.value = resolveToken(separator.value, customSeparator.value)
    }

    const warnSet = ref(new Set())

    const buildPassword = (rerollAffixes = false) => {
      if (rerollAffixes || !lockAffixes.value) rollAffixes()
      preview.value = rawWords.value.map(w => w ? w.charAt(0).toUpperCase() + w.slice(1).toLowerCase() : '').join(' ')
      const words = rawWords.value.map((w, i, arr) => {
        const cased = applyCapitalization(w || '', capitalization.value, i, arr.length)
        if (useEmoji.value) {
          const slot = slots.value[i]
          const emojiCat = slot?.cat === 'random' ? slot?.type : (slot?.cat || 'default')
          return pickEmoji(emojiCat) + cased
        }
        return cased
      })
      const joined = isPerGapSeparator(separator.value) ? joinPerGap(words, separator.value) : words.join(cachedSep.value)
      const assembled = cachedPre.value + joined + cachedSuf.value
      const result = activeLeet.value.size > 0 ? applyLeet(assembled, activeLeet.value) : assembled
      password.value = result

      // With alliteration on, the free pools shrink to the drawn letter and
      // the breakdown states the measured cost of that. The 8-character
      // minimum's retry can shave a further fraction of a bit at very small
      // settings; it is not modelled.
      const letter = alliterationMode.value ? alliterationLetter.value : ''
      let commonLetters = 0
      if (letter) {
        const pools = slots.value.map((s) => {
          const cats = wordData.value[s.type] || {}
          const p = s.cat === 'random' ? allOf(cats) : (cats[s.cat] || allOf(cats))
          return new Set(p.map((w) => w.charAt(0).toLowerCase()))
        })
        commonLetters = pools.length
          ? [...pools[0]].filter((l) => pools.every((p) => p.has(l))).length
          : 0
      }
      const slotInfos = slots.value.map((s) => {
        const cats = wordData.value[s.type] || {}
        const freePool = s.cat === 'random' ? allOf(cats) : (cats[s.cat] || allOf(cats))
        const pool = letter ? freePool.filter((w) => w.charAt(0).toLowerCase() === letter) : freePool
        const emojiCat = s.cat === 'random' ? s.type : (s.cat || 'default')
        return {
          label: s.cat === 'random' ? s.type : `${s.type} · ${s.cat}`,
          poolSize: Math.max(pool.length, 1),
          freePoolSize: Math.max(freePool.length, 1),
          letter,
          emojiPoolSize: (EMOJI_POOLS[emojiCat] || EMOJI_POOLS.default).length,
        }
      })
      entropy.value = wirelessBits({
        alliteration: !!letter,
        commonLetters: Math.max(commonLetters, 1),
        slots: slotInfos,
        capitalization: capitalization.value,
        letterCount: rawWords.value.join('').length,
        separator: separator.value,
        prefix: prefixMode.value,
        suffix: suffixMode.value,
        emoji: useEmoji.value,
        leetActive: activeLeet.value.size,
      })
    }

    const generatePassword = (attempt = 0) => {
      if (typeof attempt !== 'number') attempt = 0
      if (slots.value.length === 0) {
        showNotification('Add at least one word slot', 'error')
        return
      }
      if (alliterationMode.value) {
        const letter = pickAlliterationLetter()
        alliterationLetter.value = letter
        rawWords.value = slots.value.map(s => pickFrom(s.type, s.cat, letter))
      } else {
        alliterationLetter.value = ''
        rawWords.value = slots.value.map(s => pickFrom(s.type, s.cat))
      }
      buildPassword(true)
      if (password.value.length < 8 && attempt < 10) {
        generatePassword(attempt + 1)
        return
      }
      if (password.value.length < 8) {
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
      buildPassword(false)
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

    onMounted(async () => {
      await loadWordData()
      generatePassword()
    })

    return {
      slots,
      slotTypes: SLOT_TYPES,
      categoryMeta: CATEGORY_META,
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
      password, entropy, recallHistory, rawWords, history, warnSet, copied, preview, notification,
      separatorOptions: SEPARATOR_OPTIONS,
      suffixOptions: SUFFIX_OPTIONS,
      generatePassword, regenWord, copyPassword
    }
  },
  components: { AffixPicker, HistoryStrip, EntropyPanel },
  template: `
    <div class="password-generator">

      <div class="card">
        <div class="card-header card-header-row">
          <span>Word Slots</span>
          <label class="alliteration-toggle" :class="{ active: alliterationMode }" title="All words share the same starting letter">
            <input type="checkbox" v-model="alliterationMode" class="sr-only" />
            <span class="mdi mdi-alpha-a-box"></span>
            <span>Alliteration</span>
            <span v-if="alliterationMode && alliterationLetter" class="alliteration-letter">{{ alliterationLetter.toUpperCase() }}</span>
          </label>
        </div>

        <div class="slot-add-row">
          <span class="slot-add-label">Add:</span>
          <button
            v-for="t in slotTypes"
            :key="t.type"
            class="slot-add-btn"
            :class="t.color"
            @click="addSlot(t.type)"
            :disabled="slots.length >= 8"
          >+ {{ t.label }}</button>
        </div>

        <div class="slot-tray" v-if="slots.length > 0">
          <div
            v-for="(slot, idx) in slots"
            :key="slot.id"
            class="slot-pill"
            :class="'slot-' + slot.type"
          >
            <span class="slot-pill-label">{{ slot.type }}</span>
            <div class="slot-pill-actions">
              <button class="slot-arrow" @click="moveSlot(idx, -1)" :disabled="idx === 0" title="Move left">&#8592;</button>
              <button class="slot-arrow" @click="moveSlot(idx, 1)" :disabled="idx === slots.length - 1" title="Move right">&#8594;</button>
              <button class="slot-remove" @click="removeSlot(slot.id)" title="Remove">&#215;</button>
            </div>
            <select class="slot-cat-select" v-model="slot.cat">
              <option v-for="opt in categoryMeta[slot.type]" :key="opt.id" :value="opt.id">{{ opt.label }}</option>
            </select>
          </div>
        </div>

        <div v-else class="slot-empty">
          Add word slots above to build your WiFi password structure.
        </div>
      </div>

      <div class="card">
        <div class="card-header">Word Separator</div>
        <div class="separator-grid">
          <label v-for="opt in separatorOptions" :key="opt.value" class="sep-option" :class="{ active: separator === opt.value }">
            <input v-model="separator" :value="opt.value" type="radio" class="sr-only" />
            <span>{{ opt.label }}</span>
          </label>
        </div>
        <div v-if="separator === 'custom'" class="custom-sep-row">
          <input v-model="customSeparator" type="text" class="form-input" placeholder="Type your separator" />
        </div>
      </div>

      <div class="card">
        <div class="card-header">Capitalization</div>
        <div class="separator-grid">
          <label class="sep-option" :class="{ active: capitalization === 'title' }">
            <input v-model="capitalization" value="title" type="radio" class="sr-only" />
            <span>Title Case</span>
          </label>
          <label class="sep-option" :class="{ active: capitalization === 'none' }">
            <input v-model="capitalization" value="none" type="radio" class="sr-only" />
            <span>lowercase</span>
          </label>
          <label class="sep-option" :class="{ active: capitalization === 'upper' }">
            <input v-model="capitalization" value="upper" type="radio" class="sr-only" />
            <span>UPPERCASE</span>
          </label>
          <label class="sep-option" :class="{ active: capitalization === 'random' }">
            <input v-model="capitalization" value="random" type="radio" class="sr-only" />
            <span>rAndOm LetTerS</span>
          </label>
          <label class="sep-option" :class="{ active: capitalization === 'char-alt' }">
            <input v-model="capitalization" value="char-alt" type="radio" class="sr-only" />
            <span>AlTeRnAtInG</span>
          </label>
          <label class="sep-option" :class="{ active: capitalization === 'last-upper' }">
            <input v-model="capitalization" value="last-upper" type="radio" class="sr-only" />
            <span>lasT letteR</span>
          </label>
          <label class="sep-option" :class="{ active: capitalization === 'first-only' }">
            <input v-model="capitalization" value="first-only" type="radio" class="sr-only" />
            <span>FIRST word only</span>
          </label>
          <label class="sep-option" :class="{ active: capitalization === 'last-only' }">
            <input v-model="capitalization" value="last-only" type="radio" class="sr-only" />
            <span>last word ONLY</span>
          </label>
          <label class="sep-option" :class="{ active: capitalization === 'word-alt' }">
            <input v-model="capitalization" value="word-alt" type="radio" class="sr-only" />
            <span>WORD word WORD word</span>
          </label>
          <label class="sep-option" :class="{ active: capitalization === 'word-random' }">
            <input v-model="capitalization" value="word-random" type="radio" class="sr-only" />
            <span>WORD word is RANDOM</span>
          </label>
        </div>
      </div>

      <div class="card">
        <div class="card-header">Prefix &amp; Suffix</div>
        <div class="affix-pair">
          <AffixPicker
            label="Prefix"
            :modelValue="prefixMode"
            :customValue="prefixCustom"
            @update:modelValue="prefixMode = $event"
            @update:customValue="prefixCustom = $event"
          />
          <div class="affix-divider"></div>
          <AffixPicker
            label="Suffix"
            :modelValue="suffixMode"
            :customValue="suffixCustom"
            :options="suffixOptions"
            @update:modelValue="suffixMode = $event"
            @update:customValue="suffixCustom = $event"
          />
        </div>
      </div>

      <div class="card">
        <div class="form-group">
          <div class="symbol-chips-header">
            <label class="form-label">Leet Speak Substitutions</label>
            <div class="symbol-chips-actions">
              <button type="button" class="chip-action" @click="selectAllLeet">All</button>
              <button type="button" class="chip-action" @click="selectNoLeet">None</button>
            </div>
          </div>
          <div class="symbol-chips">
            <button
              v-for="entry in leetMap"
              :key="entry.char"
              type="button"
              class="symbol-chip leet-chip"
              :class="{ active: activeLeet.has(entry.char) }"
              @click="toggleLeet(entry.char)"
            >{{ entry.label }}</button>
          </div>
        </div>
        <div class="emoji-toggle-row">
          <label class="form-label">Emoji</label>
          <button type="button" class="emoji-toggle-btn" :class="{ active: useEmoji }" @click="useEmoji = !useEmoji" title="Prepend a category-matched emoji to each word">
            <span class="emoji-toggle-icon">🎲</span>
            <span class="emoji-toggle-label">{{ useEmoji ? 'On' : 'Off' }}</span>
          </button>
        </div>
      </div>

      <div class="card">
        <button @click="generatePassword" class="btn btn-primary"><span class="mdi mdi-wifi"></span> Generate WiFi Password</button>
      </div>

      <div class="card">
        <div v-if="rawWords.length" class="word-pills-row">
          <div class="word-pills">
            <button
              v-for="(w, i) in rawWords"
              :key="i"
              class="word-pill"
              :class="'word-pill-' + slots[i]?.type"
              @click="regenWord(i)"
              title="Click to swap this word"
            >
              <span class="word-pill-text">{{ w }}</span>
              <span class="mdi mdi-shuffle-variant word-pill-icon"></span>
            </button>
          </div>
          <button
            class="lock-affixes-btn"
            :class="{ active: lockAffixes }"
            @click="lockAffixes = !lockAffixes"
            :title="lockAffixes ? 'Prefix/separator/suffix locked — click to unlock' : 'Click to lock prefix/separator/suffix when swapping words'"
          >
            <span :class="['mdi', lockAffixes ? 'mdi-lock' : 'mdi-lock-open-outline']"></span>
          </button>
        </div>

        <div class="password-display">
          <div
            :class="['form-input', 'password-input', { 'has-length-pill': password.length > 0 }]"
            role="textbox"
            aria-readonly="true"
            aria-label="Generated password"
            tabindex="0"
          >{{ password }}<span v-if="!password" class="password-placeholder" aria-hidden="true">Generated password will appear here...</span></div>
          <span v-if="password.length > 0" class="length-pill">{{ password.length }}</span>
          <button @click="copyPassword" :class="['copy-btn', { copied }]" :title="copied ? 'Copied!' : 'Copy to clipboard'">
            <span :class="['mdi', copied ? 'mdi-check' : 'mdi-content-copy']"></span>
          </button>
        </div>
        <EntropyPanel :entropy="entropy" />
        <HistoryStrip :history="history" :current="password" :warnSet="warnSet" @select="recallHistory($event)" />
        <div v-if="notification.show" :class="['notification', notification.type]" role="status" aria-live="polite">
          {{ notification.message }}
        </div>
      </div>
    </div>
  `
}

// Mad Lib Password Component
const MADLIB_TEMPLATES = [
  { id: 'hero',      label: 'The Hero',       template: 'The {adj} {noun} {adv} {verb} the {adj} {noun}' },
  { id: 'villain',   label: 'The Villain',    template: 'A {adj} {noun} {adv} {verb} every {noun}' },
  { id: 'quest',     label: 'The Quest',      template: '{noun} {adv} {verb} beyond the {adj} {noun}' },
  { id: 'science',   label: 'Science!',       template: 'The {adj} {noun} {adv} {verb} any {noun}' },
  { id: 'proverb',   label: 'Wise Proverb',   template: 'A {adj} {noun} {adv} {verb} alone' },
  { id: 'news',      label: 'Breaking News',  template: '{adj} {noun} {adv} {verb} the {noun}' },
  { id: 'haiku',     label: 'Haiku-ish',      template: '{adj} {noun} {adv} {verb}' },
  { id: 'epic',      label: 'Epic Tale',      template: '{noun} and {noun} {adv} {verb} the {adj} world' },
  { id: 'mystery',   label: 'Mystery',        template: 'A {noun} {adv} {verb} the {adj} {noun}' },
  { id: 'romance',   label: 'Romance',        template: 'The {adj} {noun} {adv} {verb} a {adj} {noun}' },
  { id: 'scifi',     label: 'Sci-Fi',         template: '{adj} {noun} {adv} {verb} every {noun}' },
  { id: 'fable',     label: 'Fable',          template: 'Once the {adj} {noun} {adv} {verb} alone' },
]

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
    const toggleLeet = (char) => {
      const next = new Set(activeLeet.value)
      if (next.has(char)) next.delete(char)
      else next.add(char)
      activeLeet.value = next
    }
    const selectAllLeet = () => { activeLeet.value = new Set(LEET_MAP.map(m => m.char)) }
    const selectNoLeet = () => { activeLeet.value = new Set() }
    const password = ref('')
    const entropy = ref(null)
    const recallHistory = (entry) => recallEntry(entry, password, entropy)
    const preview = ref('')
    // rawWords stores the plain words from the template fill (no caps/leet) alongside their token types
    const rawSegments = ref([]) // [{ word, isToken, type? }]
    const lockAffixes = persistedRef('madlib.lockAffixes', false)
    const cachedPre = ref('')
    const cachedSep = ref('')
    const cachedSuf = ref('')
    const { history, pushHistory } = useHistory('madlib.history')
    const { copied, notification, copyPassword } = useCopyPassword(password)
    const wordData = ref({})

    const loadWordData = async () => {
      try {
        const res = await fetch('./data/words.json')
        wordData.value = await res.json()
      } catch { console.error('Failed to load word data') }
    }

    const pickFrom = (type, catId) => {
      const typeCats = wordData.value[type]
      if (!typeCats) return type
      const pool = catId === 'random' ? allOf(typeCats) : (typeCats[catId] || allOf(typeCats))
      return randPick(pool) || ''
    }

    const rollAffixes = () => {
      cachedPre.value = resolveToken(prefixMode.value, prefixCustom.value)
      cachedSuf.value = resolveSuffixToken(suffixMode.value, suffixCustom.value, cachedPre.value)
      cachedSep.value = resolveToken(separator.value, customSeparator.value)
    }

    const buildPassword = (rerollAffixes = false) => {
      const tmpl = MADLIB_TEMPLATES.find(t => t.id === templateId.value)
      if (!tmpl) return
      if (rerollAffixes || !lockAffixes.value) rollAffixes()
      const totalWords = rawSegments.value.filter(s => s.isToken).length
      let wordIndex = 0
      const filledSegments = rawSegments.value.map(seg => {
        if (!seg.isToken) return seg.word
        return applyCapitalization(seg.word, capitalization.value, wordIndex++, totalWords)
      })
      preview.value = filledSegments.join('')
      const tokenSegs = rawSegments.value.filter(s => s.isToken)
      const words = filledSegments.filter((_, i) => rawSegments.value[i]?.isToken).map((w, i) => {
        if (useEmoji.value) {
          const seg = tokenSegs[i]
          const slotEntry = slotCats.value.find(s => s.type === seg?.type && s.occurrence === seg?.occurrence)
          const emojiCat = slotEntry?.cat === 'random' ? (seg?.type || 'default') : (slotEntry?.cat || seg?.type || 'default')
          return pickEmoji(emojiCat) + w
        }
        return w
      })
      const joined = isPerGapSeparator(separator.value) ? joinPerGap(words, separator.value) : words.join(cachedSep.value)
      const assembled = cachedPre.value + joined + cachedSuf.value
      password.value = activeLeet.value.size > 0 ? applyLeet(assembled, activeLeet.value) : assembled
      // Only the token slots carry entropy -- the template text is a setting.
      const entropySegs = rawSegments.value.filter(s => s.isToken)
      const slotInfos = entropySegs.map((seg) => {
        const slotEntry = slotCats.value.find(s => s.type === seg.type && s.occurrence === seg.occurrence)
        const cat = slotEntry?.cat ?? 'random'
        const typeCats = wordData.value[seg.type] || {}
        const pool = cat === 'random' ? allOf(typeCats) : (typeCats[cat] || allOf(typeCats))
        const emojiCat = cat === 'random' ? (seg.type || 'default') : cat
        return {
          label: cat === 'random' ? seg.type : `${seg.type} · ${cat}`,
          poolSize: Math.max(pool.length, 1),
          emojiPoolSize: (EMOJI_POOLS[emojiCat] || EMOJI_POOLS.default).length,
        }
      })
      entropy.value = slotBits({
        slots: slotInfos,
        capitalization: capitalization.value,
        letterCount: entropySegs.map(s => s.word).join('').length,
        separator: separator.value,
        prefix: prefixMode.value,
        suffix: suffixMode.value,
        emoji: useEmoji.value,
        leetActive: activeLeet.value.size,
      })
      pushHistory(password.value, entropy.value.total)
    }

    const generatePassword = () => {
      const tmpl = MADLIB_TEMPLATES.find(t => t.id === templateId.value)
      if (!tmpl) return
      const typeOccurrence = {}
      const parts = tmpl.template.split(/(\{[^}]+\})/)
      rawSegments.value = parts.map(part => {
        const m = part.match(/^\{(adj|adv|noun|verb)\}$/)
        if (!m) return { word: part, isToken: false }
        const type = m[1]
        typeOccurrence[type] = (typeOccurrence[type] || 0) + 1
        const slotEntry = slotCats.value.find(s => s.type === type && s.occurrence === typeOccurrence[type])
        return { word: pickFrom(type, slotEntry?.cat ?? 'random'), isToken: true, type, occurrence: typeOccurrence[type] }
      })
      buildPassword(true)
    }

    const regenWord = (segIdx) => {
      const seg = rawSegments.value[segIdx]
      if (!seg || !seg.isToken) return
      const slotEntry = slotCats.value.find(s => s.type === seg.type && s.occurrence === seg.occurrence)
      const next = [...rawSegments.value]
      next[segIdx] = { ...seg, word: pickFrom(seg.type, slotEntry?.cat ?? 'random') }
      rawSegments.value = next
      buildPassword(false)
    }

    watch(templateId, (newId) => {
      slotCats.value = rebuildSlotCats(newId, slotCats.value)
      generatePassword()
    })

    watch(useEmoji, () => { if (rawSegments.value.length) buildPassword() })

    onMounted(async () => {
      await loadWordData()
      slotCats.value = rebuildSlotCats(templateId.value, slotCats.value)
      generatePassword()
    })

    return {
      templateId,
      templates: MADLIB_TEMPLATES,
      slotCats,
      slotCatRows,
      categoryMeta: CATEGORY_META,
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
      password, entropy, recallHistory, rawSegments, history, copied, preview, notification,
      separatorOptions: SEPARATOR_OPTIONS,
      suffixOptions: SUFFIX_OPTIONS,
      generatePassword, regenWord, copyPassword,
    }
  },
  components: { AffixPicker, HistoryStrip, EntropyPanel },
  template: `
    <div class="password-generator">

      <div class="card">
        <div class="card-header">Template</div>
        <div class="separator-grid">
          <label
            v-for="t in templates"
            :key="t.id"
            class="sep-option"
            :class="{ active: templateId === t.id }"
          >
            <input v-model="templateId" :value="t.id" type="radio" class="sr-only" @change="generatePassword" />
            <span>{{ t.label }}</span>
          </label>
        </div>
        <div class="madlib-template-preview">
          <span
            v-for="(token, i) in templates.find(t => t.id === templateId)?.template.split(/(\{[^}]+\})/)"
            :key="i"
            :class="token.match(/^\{(adj|adv|noun|verb)\}$/) ? ('madlib-token slot-' + token.slice(1,-1)) : 'madlib-literal'"
          >{{ token.match(/^\{(adj|adv|noun|verb)\}$/) ? token.slice(1,-1) : token }}</span>
        </div>
      </div>

      <div class="card">
        <div class="card-header">Word Categories</div>
        <div class="word-cats">
          <div v-for="(slot, idx) in slotCatRows" :key="idx" class="word-cat-row">
            <div class="word-cat-label" :class="'wc-label-' + slot.type">
              {{ slot.type }}<span v-if="slot.showOrdinal" class="wc-ordinal">&nbsp;{{ slot.occurrence }}</span>
            </div>
            <div class="separator-grid">
              <label
                v-for="opt in categoryMeta[slot.type]"
                :key="opt.id"
                class="sep-option"
                :class="{ active: slotCats[idx].cat === opt.id }"
              >
                <input v-model="slotCats[idx].cat" :value="opt.id" type="radio" class="sr-only" />
                <span>{{ opt.label }}</span>
              </label>
            </div>
          </div>
        </div>
      </div>

      <div class="card">
        <div class="card-header">Word Separator</div>
        <div class="separator-grid">
          <label v-for="opt in separatorOptions" :key="opt.value" class="sep-option" :class="{ active: separator === opt.value }">
            <input v-model="separator" :value="opt.value" type="radio" class="sr-only" />
            <span>{{ opt.label }}</span>
          </label>
        </div>
        <div v-if="separator === 'custom'" class="custom-sep-row">
          <input v-model="customSeparator" type="text" class="form-input" placeholder="Type your separator" />
        </div>
      </div>

      <div class="card">
        <div class="card-header">Capitalization</div>
        <div class="separator-grid">
          <label class="sep-option" :class="{ active: capitalization === 'title' }">
            <input v-model="capitalization" value="title" type="radio" class="sr-only" />
            <span>Title Case</span>
          </label>
          <label class="sep-option" :class="{ active: capitalization === 'none' }">
            <input v-model="capitalization" value="none" type="radio" class="sr-only" />
            <span>lowercase</span>
          </label>
          <label class="sep-option" :class="{ active: capitalization === 'upper' }">
            <input v-model="capitalization" value="upper" type="radio" class="sr-only" />
            <span>UPPERCASE</span>
          </label>
          <label class="sep-option" :class="{ active: capitalization === 'random' }">
            <input v-model="capitalization" value="random" type="radio" class="sr-only" />
            <span>rAndOm LetTerS</span>
          </label>
          <label class="sep-option" :class="{ active: capitalization === 'char-alt' }">
            <input v-model="capitalization" value="char-alt" type="radio" class="sr-only" />
            <span>AlTeRnAtInG</span>
          </label>
          <label class="sep-option" :class="{ active: capitalization === 'last-upper' }">
            <input v-model="capitalization" value="last-upper" type="radio" class="sr-only" />
            <span>lasT letteR</span>
          </label>
          <label class="sep-option" :class="{ active: capitalization === 'first-only' }">
            <input v-model="capitalization" value="first-only" type="radio" class="sr-only" />
            <span>FIRST word only</span>
          </label>
          <label class="sep-option" :class="{ active: capitalization === 'last-only' }">
            <input v-model="capitalization" value="last-only" type="radio" class="sr-only" />
            <span>last word ONLY</span>
          </label>
          <label class="sep-option" :class="{ active: capitalization === 'word-alt' }">
            <input v-model="capitalization" value="word-alt" type="radio" class="sr-only" />
            <span>WORD word WORD word</span>
          </label>
          <label class="sep-option" :class="{ active: capitalization === 'word-random' }">
            <input v-model="capitalization" value="word-random" type="radio" class="sr-only" />
            <span>WORD word is RANDOM</span>
          </label>
        </div>
      </div>

      <div class="card">
        <div class="card-header">Prefix &amp; Suffix</div>
        <div class="affix-pair">
          <AffixPicker
            label="Prefix"
            :modelValue="prefixMode"
            :customValue="prefixCustom"
            @update:modelValue="prefixMode = $event"
            @update:customValue="prefixCustom = $event"
          />
          <div class="affix-divider"></div>
          <AffixPicker
            label="Suffix"
            :modelValue="suffixMode"
            :customValue="suffixCustom"
            :options="suffixOptions"
            @update:modelValue="suffixMode = $event"
            @update:customValue="suffixCustom = $event"
          />
        </div>
      </div>

      <div class="card">
        <div class="form-group">
          <div class="symbol-chips-header">
            <label class="form-label">Leet Speak Substitutions</label>
            <div class="symbol-chips-actions">
              <button type="button" class="chip-action" @click="selectAllLeet">All</button>
              <button type="button" class="chip-action" @click="selectNoLeet">None</button>
            </div>
          </div>
          <div class="symbol-chips">
            <button
              v-for="entry in leetMap"
              :key="entry.char"
              type="button"
              class="symbol-chip leet-chip"
              :class="{ active: activeLeet.has(entry.char) }"
              @click="toggleLeet(entry.char)"
            >{{ entry.label }}</button>
          </div>
        </div>
        <div class="emoji-toggle-row">
          <label class="form-label">Emoji</label>
          <button type="button" class="emoji-toggle-btn" :class="{ active: useEmoji }" @click="useEmoji = !useEmoji" title="Prepend a category-matched emoji to each word">
            <span class="emoji-toggle-icon">🎲</span>
            <span class="emoji-toggle-label">{{ useEmoji ? 'On' : 'Off' }}</span>
          </button>
        </div>
      </div>

      <div class="card">
        <button @click="generatePassword" class="btn btn-primary"><span class="mdi mdi-shuffle-variant"></span> Generate Mad Lib</button>
      </div>

      <div class="card">
        <div v-if="rawSegments.some(s => s.isToken)" class="word-pills-row">
          <div class="word-pills">
            <template v-for="(seg, i) in rawSegments" :key="i">
              <button
                v-if="seg.isToken"
                class="word-pill"
                :class="'word-pill-' + seg.type"
                @click="regenWord(i)"
                title="Click to swap this word"
              >
                <span class="word-pill-text">{{ seg.word }}</span>
                <span class="mdi mdi-shuffle-variant word-pill-icon"></span>
              </button>
            </template>
          </div>
          <button
            class="lock-affixes-btn"
            :class="{ active: lockAffixes }"
            @click="lockAffixes = !lockAffixes"
            :title="lockAffixes ? 'Prefix/separator/suffix locked — click to unlock' : 'Click to lock prefix/separator/suffix when swapping words'"
          >
            <span :class="['mdi', lockAffixes ? 'mdi-lock' : 'mdi-lock-open-outline']"></span>
          </button>
        </div>

        <div v-if="preview" class="madlib-preview-card">
          <div class="madlib-preview-label">Readable phrase</div>
          <div class="madlib-preview-phrase">{{ preview }}</div>
        </div>

        <div class="password-display">
          <div
            :class="['form-input', 'password-input', { 'has-length-pill': password.length > 0 }]"
            role="textbox"
            aria-readonly="true"
            aria-label="Generated password"
            tabindex="0"
          >{{ password }}<span v-if="!password" class="password-placeholder" aria-hidden="true">Generated password will appear here...</span></div>
          <span v-if="password.length > 0" class="length-pill">{{ password.length }}</span>
          <button @click="copyPassword" :class="['copy-btn', { copied }]" :title="copied ? 'Copied!' : 'Copy to clipboard'">
            <span :class="['mdi', copied ? 'mdi-check' : 'mdi-content-copy']"></span>
          </button>
        </div>
        <EntropyPanel :entropy="entropy" />
        <HistoryStrip :history="history" :current="password" @select="recallHistory($event)" />
        <div v-if="notification.show" :class="['notification', notification.type]" role="status" aria-live="polite">
          {{ notification.message }}
        </div>
      </div>
    </div>
  `
}

// Main App Component
const App = {
  name: 'App',
  setup() {
    const activeTab = persistedRef('global.activeTab', 0)
    const tabs = [
      { id: 1, name: 'Simple',     component: SimplePassword },
      { id: 2, name: 'Advanced',   component: AdvancedPassword },
      { id: 3, name: 'Words',      component: WordsPassword },
      { id: 4, name: 'Passphrase', component: Passphrase },
      { id: 5, name: 'Wireless',   component: WifiWords },
      { id: 6, name: 'Mad Lib',    component: MadLib },
      { id: 7, name: 'Numbers',    component: NumbersPassword },
    ]

    // The settings panel is plain DOM so that all five pages share one
    // implementation. History is contributed as an extra section rather than
    // being known to the panel, with get/set bridging to the Vue ref so the
    // rest of the app stays reactive.
    onMounted(() => {
      initTheme()
      mountSiteHeader(document.querySelector('[data-site-header]'), {
        description:
          '🔒 <strong>Privacy Notice:</strong> All passwords are generated locally in your browser and never transmitted. ' +
          "Your settings and generation history are stored only in your browser's local storage — history is cleared when " +
          'you set History to Off, or when you clear your browser data.',
        settings: {
          extraSections: [{
            label: 'History',
            options: [0, 5, 10, 20, 50].map(n => ({ value: n, label: n === 0 ? 'Off' : String(n) })),
            get: () => historyMax.value,
            set: (v) => { historyMax.value = Number(v) },
          }],
        },
      })
    })

    return {
      activeTab,
      tabs,
      historyMax
    }
  },
  template: `
    <div id="app">
      <!-- Replaced at mount by the shared header, so the app carries the same
           title, subtitle and nav bar as every other page. -->
      <div data-site-header></div>

      <main class="main">
        <div class="container">
          <div class="tabs">
            <button 
              v-for="(tab, index) in tabs" 
              :key="tab.id"
              :class="['tab', { active: activeTab === index }]"
              @click="activeTab = index"
            >
              {{ tab.name }}
            </button>
          </div>
          
          <div class="tab-content">
            <component :is="tabs[activeTab].component" />
          </div>
        </div>
      </main>

      <div data-site-footer></div>
    </div>
  `
}

createApp(App).mount('#app')

// The footer markup used to live in the template above -- a sixth copy of the
// same links. It comes from the shared module now, like the header, so adding
// a page updates every navigation at once. wrap: true keeps the .container
// width limiter this page needs and the standalone pages do not.
mountSiteFooter(document.querySelector('[data-site-footer]'), { wrap: true })