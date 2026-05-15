import { createApp, ref, computed, watch, onMounted } from 'https://unpkg.com/vue@3.4.0/dist/vue.esm-browser.prod.js'

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

const SPECIAL_CHARS = '!#$%&*+-/:;=?@^_|~'
const DIGITS = '0123456789'

const randChar = (str) => str.charAt(Math.floor(Math.random() * str.length))

const resolveToken = (value, custom) => {
  switch (value) {
    case 'r1sym':  return randChar(SPECIAL_CHARS)
    case 'r2sym':  return randChar(SPECIAL_CHARS) + randChar(SPECIAL_CHARS)
    case 'r1num':  return randChar(DIGITS)
    case 'r2num':  return randChar(DIGITS) + randChar(DIGITS)
    case 'r2s2n':  return randChar(SPECIAL_CHARS) + randChar(SPECIAL_CHARS) + randChar(DIGITS) + randChar(DIGITS)
    case 'r2n2s':  return randChar(DIGITS) + randChar(DIGITS) + randChar(SPECIAL_CHARS) + randChar(SPECIAL_CHARS)
    case 'r1s1n':  return randChar(SPECIAL_CHARS) + randChar(DIGITS)
    case 'r1n1s':  return randChar(DIGITS) + randChar(SPECIAL_CHARS)
    case 'custom': return custom
    default:       return value  // literal: '', ' ', '-', '_', '.', '$', etc.
  }
}

const SEPARATOR_OPTIONS = [
  { value: '',       label: 'None' },
  { value: ' ',      label: 'Space' },
  { value: '-',      label: 'Hyphen  -' },
  { value: '_',      label: 'Underscore  _' },
  { value: '.',      label: 'Period  .' },
  { value: '$',      label: 'Dollar  $' },
  { value: 'r1sym',  label: '1 Random Symbol' },
  { value: 'r2sym',  label: '2 Random Symbols' },
  { value: 'r1num',  label: '1 Random Number' },
  { value: 'r2num',  label: '2 Random Numbers' },
  { value: 'r1s1n',  label: '1 Symbol + 1 Number' },
  { value: 'r1n1s',  label: '1 Number + 1 Symbol' },
  { value: 'r2s2n',  label: '2 Symbols + 2 Numbers' },
  { value: 'r2n2s',  label: '2 Numbers + 2 Symbols' },
  { value: 'custom', label: 'Custom...' },
]

const AFFIX_OPTIONS = [
  { value: '',       label: 'None' },
  { value: 'r1sym',  label: '1 Random Symbol' },
  { value: 'r2sym',  label: '2 Random Symbols' },
  { value: 'r1num',  label: '1 Random Number' },
  { value: 'r2num',  label: '2 Random Numbers' },
  { value: 'r1s1n',  label: '1 Symbol + 1 Number' },
  { value: 'r1n1s',  label: '1 Number + 1 Symbol' },
  { value: 'r2s2n',  label: '2 Symbols + 2 Numbers' },
  { value: 'r2n2s',  label: '2 Numbers + 2 Symbols' },
  { value: 'custom', label: 'Custom...' },
]

const SUFFIX_OPTIONS = [
  { value: '',              label: 'None' },
  { value: 'r1sym',         label: '1 Random Symbol' },
  { value: 'r2sym',         label: '2 Random Symbols' },
  { value: 'r1num',         label: '1 Random Number' },
  { value: 'r2num',         label: '2 Random Numbers' },
  { value: 'r1s1n',         label: '1 Symbol + 1 Number' },
  { value: 'r1n1s',         label: '1 Number + 1 Symbol' },
  { value: 'r2s2n',         label: '2 Symbols + 2 Numbers' },
  { value: 'r2n2s',         label: '2 Numbers + 2 Symbols' },
  { value: 'mirror',        label: 'Mirror Prefix' },
  { value: 'mirror-newdig', label: 'Mirror Prefix (new digits)' },
  { value: 'custom',        label: 'Custom...' },
]

// Resolves suffix token; 'mirror' and 'mirror-newdig' require the already-resolved prefix string.
const resolveSuffixToken = (value, custom, resolvedPrefix) => {
  if (value === 'mirror') {
    return resolvedPrefix.split('').reverse().join('')
  }
  if (value === 'mirror-newdig') {
    // Keep same symbol characters but replace each digit with a fresh random digit
    return resolvedPrefix
      .split('')
      .reverse()
      .map(c => DIGITS.includes(c) ? randChar(DIGITS) : c)
      .join('')
  }
  return resolveToken(value, custom)
}

const applyCapitalization = (word, mode, index = 0) => {
  switch (mode) {
    case 'title':      return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()
    case 'upper':      return word.toUpperCase()
    case 'none':       return word.toLowerCase()
    case 'random':     return word.split('').map(c => Math.random() > 0.5 ? c.toUpperCase() : c.toLowerCase()).join('')
    case 'word-alt':   return index % 2 === 0 ? word.toUpperCase() : word.toLowerCase()
    case 'word-random': return Math.random() > 0.5 ? word.toUpperCase() : word.toLowerCase()
    default:           return word
  }
}

const LEET_MAP = [
  { char: 'a', sub: '@',  label: 'a → @'  },
  { char: 'e', sub: '3',  label: 'e → 3'  },
  { char: 'i', sub: '1',  label: 'i → 1'  },
  { char: 'o', sub: '0',  label: 'o → 0'  },
  { char: 's', sub: '$',  label: 's → $'  },
  { char: 't', sub: '+',  label: 't → +'  },
  { char: 'l', sub: '!',  label: 'l → !'  },
  { char: 'b', sub: '8',  label: 'b → 8'  },
  { char: 'g', sub: '9',  label: 'g → 9'  },
  { char: 'z', sub: '2',  label: 'z → 2'  },
]

const applyLeet = (str, activeSubs) => {
  if (!activeSubs || activeSubs.size === 0) return str
  return str.split('').map(c => {
    const entry = LEET_MAP.find(m => m.char === c.toLowerCase())
    if (entry && activeSubs.has(entry.char)) {
      return c === c.toUpperCase() ? entry.sub.toUpperCase?.() ?? entry.sub : entry.sub
    }
    return c
  }).join('')
}

const historyMax = persistedRef('global.historyMax', 10)

const useHistory = (key) => {
  const history = persistedRef(key, [])
  const pushHistory = (pw) => {
    if (!pw || historyMax.value === 0) { history.value = []; return }
    const list = history.value.filter(h => h !== pw)
    history.value = [pw, ...list].slice(0, historyMax.value)
  }
  watch(historyMax, (max) => {
    history.value = max === 0 ? [] : history.value.slice(0, max)
  })
  return { history, pushHistory }
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
  props: { history: { default: () => [] }, current: String },
  emits: ['select'],
  template: `
    <div v-if="history.length > 1" class="history-strip">
      <div class="history-label">History</div>
      <div class="history-list">
        <button
          v-for="(pw, i) in history"
          :key="i"
          class="history-item"
          :class="{ 'history-item-active': pw === current }"
          @click="$emit('select', pw)"
          :title="pw"
        >{{ pw }}</button>
      </div>
    </div>
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
  components: { HistoryStrip },
  setup() {
    const passwordLength = persistedRef('simple.passwordLength', 20)
    const lowerCase = persistedRef('simple.lowerCase', true)
    const upperCase = persistedRef('simple.upperCase', true)
    const digits = persistedRef('simple.digits', true)
    const specialChars = persistedRef('simple.specialChars', true)
    const password = ref('')
    const { history, pushHistory } = useHistory('simple.history')

    const { copied, notification, showNotification, copyPassword } = useCopyPassword(password)

    const characterSets = {
      lower: 'abcdefghijklmnopqrstuvwxyz',
      upper: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
      digits: '0123456789',
      special: '!#$%&()*+,-./:;<=>?@[]^_`{|}~'
    }

    const generatePassword = () => {
      if (!lowerCase.value && !upperCase.value && !digits.value && !specialChars.value) {
        showNotification('Please select at least one character type', 'error')
        return
      }

      let charset = ''
      if (lowerCase.value) charset += characterSets.lower
      if (upperCase.value) charset += characterSets.upper
      if (digits.value) charset += characterSets.digits
      if (specialChars.value) charset += characterSets.special

      let newPassword = ''
      for (let i = 0; i < passwordLength.value; i++) {
        newPassword += charset.charAt(Math.floor(Math.random() * charset.length))
      }

      password.value = newPassword
      pushHistory(newPassword)
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
      password,
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
          <input
            v-model="passwordLength"
            type="range"
            min="6"
            max="128"
            class="slider"
          />
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
        </div>
      </div>

      <div class="card">
        <button @click="generatePassword" class="btn btn-primary">
          🎲 Generate Password
        </button>
      </div>

      <div class="card">
        <div class="password-display">
          <input
            v-model="password"
            type="text"
            readonly
            class="form-input password-input"
            autocomplete="off"
            data-1p-ignore
            data-lpignore="true"
            data-form-type="other"
            data-keeper-autofill="off"
            placeholder="Generated password will appear here..."
          />
          <button @click="copyPassword" :class="['copy-btn', { copied }]" :title="copied ? 'Copied!' : 'Copy to clipboard'">
            <span :class="['mdi', copied ? 'mdi-check' : 'mdi-content-copy']"></span>
          </button>
        </div>
        <HistoryStrip :history="history" :current="password" @select="password = $event" />
        <div v-if="notification.show" :class="['notification', notification.type]">
          {{ notification.message }}
        </div>
      </div>
    </div>
  `
}

// Advanced Password Generator Component
const AdvancedPassword = {
  name: 'AdvancedPassword',
  components: { HistoryStrip },
  setup() {
    const passwordLength = persistedRef('adv.passwordLength', 20)
    const lowerCase = persistedRef('adv.lowerCase', [1, 20])
    const upperCase = persistedRef('adv.upperCase', [1, 20])
    const digits = persistedRef('adv.digits', [1, 20])
    const specialChars = persistedRef('adv.specialChars', [1, 20])
    const ALL_SYMBOLS = '!#$%&()*+,-./:;<=>?@[]^_`{|}~'.split('')
    const activeSymbols = persistedRef('adv.activeSymbols', new Set(ALL_SYMBOLS))
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
      const minTotal = parseInt(lowerCase.value[0]) + parseInt(upperCase.value[0]) + parseInt(digits.value[0]) + parseInt(specialChars.value[0])
      const maxTotal = parseInt(lowerCase.value[1]) + parseInt(upperCase.value[1]) + parseInt(digits.value[1]) + parseInt(specialChars.value[1])

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

      let newPassword = ''
      let charTypes = []

      // Add minimum required characters
      for (let i = 0; i < lcMin; i++) charTypes.push('lower')
      for (let i = 0; i < ucMin; i++) charTypes.push('upper')
      for (let i = 0; i < dgMin; i++) charTypes.push('digits')
      for (let i = 0; i < spMin; i++) charTypes.push('special')

      // Fill remaining slots randomly within limits
      while (charTypes.length < len) {
        const availableTypes = []

        const lowerCount = charTypes.filter(t => t === 'lower').length
        const upperCount = charTypes.filter(t => t === 'upper').length
        const digitCount = charTypes.filter(t => t === 'digits').length
        const specialCount = charTypes.filter(t => t === 'special').length

        if (lowerCount < lcMax) availableTypes.push('lower')
        if (upperCount < ucMax) availableTypes.push('upper')
        if (digitCount < dgMax) availableTypes.push('digits')
        if (specialCount < spMax) availableTypes.push('special')
        
        if (availableTypes.length === 0) break
        
        const randomType = availableTypes[Math.floor(Math.random() * availableTypes.length)]
        charTypes.push(randomType)
      }

      // Shuffle character types
      for (let i = charTypes.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1))
        ;[charTypes[i], charTypes[j]] = [charTypes[j], charTypes[i]]
      }

      // Generate actual password
      for (const type of charTypes) {
        let charset = ''
        switch (type) {
          case 'lower':
            charset = characterSets.lower
            break
          case 'upper':
            charset = characterSets.upper
            break
          case 'digits':
            charset = characterSets.digits
            break
          case 'special':
            charset = customSymbols.value
            break
        }
        newPassword += charset.charAt(Math.floor(Math.random() * charset.length))
      }

      password.value = newPassword
      pushHistory(newPassword)
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
      password,
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
          <input
            v-model="passwordLength"
            type="range"
            min="6"
            max="128"
            class="slider"
          />
          <div class="slider-value">{{ passwordLength }}</div>
        </div>
      </div>

      <div class="card">
        <div class="card-header">Lowercase Letters</div>
        <div class="slider-container">
          <span>Min: {{ lowerCase[0] }}</span>
          <input
            v-model="lowerCase[0]"
            type="range"
            min="0"
            :max="passwordLength"
            class="slider"
          />
          <input
            v-model="lowerCase[1]"
            type="range"
            min="0"
            :max="passwordLength"
            class="slider"
          />
          <span>Max: {{ lowerCase[1] }}</span>
        </div>
      </div>

      <div class="card">
        <div class="card-header">Uppercase Letters</div>
        <div class="slider-container">
          <span>Min: {{ upperCase[0] }}</span>
          <input
            v-model="upperCase[0]"
            type="range"
            min="0"
            :max="passwordLength"
            class="slider"
          />
          <input
            v-model="upperCase[1]"
            type="range"
            min="0"
            :max="passwordLength"
            class="slider"
          />
          <span>Max: {{ upperCase[1] }}</span>
        </div>
      </div>

      <div class="card">
        <div class="card-header">Numbers</div>
        <div class="slider-container">
          <span>Min: {{ digits[0] }}</span>
          <input
            v-model="digits[0]"
            type="range"
            min="0"
            :max="passwordLength"
            class="slider"
          />
          <input
            v-model="digits[1]"
            type="range"
            min="0"
            :max="passwordLength"
            class="slider"
          />
          <span>Max: {{ digits[1] }}</span>
        </div>
      </div>

      <div class="card">
        <div class="card-header">Symbols</div>
        <div class="slider-container">
          <span>Min: {{ specialChars[0] }}</span>
          <input
            v-model="specialChars[0]"
            type="range"
            min="0"
            :max="passwordLength"
            class="slider"
          />
          <input
            v-model="specialChars[1]"
            type="range"
            min="0"
            :max="passwordLength"
            class="slider"
          />
          <span>Max: {{ specialChars[1] }}</span>
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
        <button @click="generatePassword" class="btn btn-primary">
          🎲 Generate Password
        </button>
      </div>

      <div class="card">
        <div class="password-display">
          <input
            v-model="password"
            type="text"
            readonly
            class="form-input password-input"
            autocomplete="off"
            data-1p-ignore
            data-lpignore="true"
            data-form-type="other"
            data-keeper-autofill="off"
            placeholder="Generated password will appear here..."
          />
          <button @click="copyPassword" :class="['copy-btn', { copied }]" :title="copied ? 'Copied!' : 'Copy to clipboard'">
            <span :class="['mdi', copied ? 'mdi-check' : 'mdi-content-copy']"></span>
          </button>
        </div>
        <HistoryStrip :history="history" :current="password" @select="password = $event" />
        <div v-if="notification.show" :class="['notification', notification.type]">
          {{ notification.message }}
        </div>
      </div>
    </div>
  `
}

// Words Password Generator Component
const WordsPassword = {
  name: 'WordsPassword',
  components: { AffixPicker, HistoryStrip },
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
        const response = await fetch('./data/wordlist.txt')
        const text = await response.text()
        wordList.value = text.split(',').map(word => word.trim()).filter(word => word.length > 0)
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
      const words = rawWords.value.map((w, i) => applyCapitalization(w, capitalization.value, i))
      const assembled = cachedPre.value + words.join(cachedSep.value) + cachedSuf.value
      password.value = activeLeet.value.size > 0 ? applyLeet(assembled, activeLeet.value) : assembled
      pushHistory(password.value)
    }

    const generatePassword = () => {
      if (wordList.value.length === 0) {
        showNotification('Word list not loaded', 'error')
        return
      }
      rawWords.value = Array.from({ length: wordCount.value }, () =>
        wordList.value[Math.floor(Math.random() * wordList.value.length)]
      )
      buildPassword(true)
    }

    const regenWord = (idx) => {
      if (wordList.value.length === 0) return
      const next = [...rawWords.value]
      next[idx] = wordList.value[Math.floor(Math.random() * wordList.value.length)]
      rawWords.value = next
      buildPassword(false)
    }

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
      lockAffixes,
      password,
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
          <input
            v-model="wordCount"
            type="range"
            min="2"
            max="20"
            class="slider"
          />
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
            <span>rAnDoM letters</span>
          </label>
          <label class="sep-option" :class="{ active: capitalization === 'word-alt' }">
            <input v-model="capitalization" value="word-alt" type="radio" class="sr-only" />
            <span>WORD word WORD word</span>
          </label>
          <label class="sep-option" :class="{ active: capitalization === 'word-random' }">
            <input v-model="capitalization" value="word-random" type="radio" class="sr-only" />
            <span>WORD word IS random</span>
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
      </div>

      <div class="card">
        <button @click="generatePassword" class="btn btn-primary">
          Generate Password
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
              <span class="mdi mdi-refresh word-pill-icon"></span>
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
          <input
            v-model="password"
            type="text"
            readonly
            class="form-input password-input"
            autocomplete="off"
            data-1p-ignore
            data-lpignore="true"
            data-form-type="other"
            data-keeper-autofill="off"
            placeholder="Generated password will appear here..."
          />
          <button @click="copyPassword" :class="['copy-btn', { copied }]" :title="copied ? 'Copied!' : 'Copy to clipboard'">
            <span :class="['mdi', copied ? 'mdi-check' : 'mdi-content-copy']"></span>
          </button>
        </div>
        <HistoryStrip :history="history" :current="password" @select="password = $event" />
        <div v-if="notification.show" :class="['notification', notification.type]">
          {{ notification.message }}
        </div>
      </div>
    </div>
  `
}

// Numbers Password Generator Component
const NumbersPassword = {
  name: 'NumbersPassword',
  components: { HistoryStrip },
  setup() {
    const passwordLength = persistedRef('nums.passwordLength', 8)
    const maxRepeated = persistedRef('nums.maxRepeated', 3)
    const maxSequential = persistedRef('nums.maxSequential', 3)
    const password = ref('')
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
        
        const nextDigit = availableDigits.charAt(Math.floor(Math.random() * availableDigits.length))
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
      pushHistory(newPassword)
    }

    onMounted(() => {
      generatePassword()
    })

    return {
      passwordLength,
      maxRepeated,
      maxSequential,
      password,
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
          <input
            v-model="passwordLength"
            type="range"
            min="4"
            max="32"
            class="slider"
          />
          <div class="slider-value">{{ passwordLength }}</div>
        </div>
      </div>

      <div class="card">
        <div class="card-header">Maximum Repeated Digits</div>
        <div class="slider-container">
          <input
            v-model="maxRepeated"
            type="range"
            min="2"
            max="5"
            class="slider"
          />
          <div class="slider-value">{{ maxRepeated }}</div>
        </div>
      </div>

      <div class="card">
        <div class="card-header">Maximum Sequential Digits</div>
        <div class="slider-container">
          <input
            v-model="maxSequential"
            type="range"
            min="2"
            max="5"
            class="slider"
          />
          <div class="slider-value">{{ maxSequential }}</div>
        </div>
      </div>

      <div class="card">
        <button @click="generatePassword" class="btn btn-primary">
          🎲 Generate Password
        </button>
      </div>

      <div class="card">
        <div class="password-display">
          <input
            v-model="password"
            type="text"
            readonly
            class="form-input password-input"
            autocomplete="off"
            data-1p-ignore
            data-lpignore="true"
            data-form-type="other"
            data-keeper-autofill="off"
            placeholder="Generated password will appear here..."
          />
          <button @click="copyPassword" :class="['copy-btn', { copied }]" :title="copied ? 'Copied!' : 'Copy to clipboard'">
            <span :class="['mdi', copied ? 'mdi-check' : 'mdi-content-copy']"></span>
          </button>
        </div>
        <HistoryStrip :history="history" :current="password" @select="password = $event" />
        <div v-if="notification.show" :class="['notification', notification.type]">
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
      const pool = catId === 'random' ? Object.values(cats).flat() : (cats[catId] || Object.values(cats).flat())
      return pool[Math.floor(Math.random() * pool.length)]
    }

    const rollAffixes = () => {
      cachedPre.value = resolveToken(prefixMode.value, prefixCustom.value)
      cachedSuf.value = resolveSuffixToken(suffixMode.value, suffixCustom.value, cachedPre.value)
      cachedSep.value = resolveToken(separator.value, customSeparator.value)
    }

    const buildPassword = (rerollAffixes = false) => {
      if (rerollAffixes || !lockAffixes.value) rollAffixes()
      preview.value = rawWords.value.map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ')
      const words = rawWords.value.map((w, i) => applyCapitalization(w, capitalization.value, i))
      const assembled = cachedPre.value + words.join(cachedSep.value) + cachedSuf.value
      password.value = activeLeet.value.size > 0 ? applyLeet(assembled, activeLeet.value) : assembled
      pushHistory(password.value)
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
      lockAffixes,
      password, rawWords, history, copied, preview, notification,
      separatorOptions: SEPARATOR_OPTIONS,
      suffixOptions: SUFFIX_OPTIONS,
      generatePassword, regenWord, copyPassword
    }
  },
  components: { AffixPicker, HistoryStrip },
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
            <span>rAnDoM letters</span>
          </label>
          <label class="sep-option" :class="{ active: capitalization === 'word-alt' }">
            <input v-model="capitalization" value="word-alt" type="radio" class="sr-only" />
            <span>WORD word WORD word</span>
          </label>
          <label class="sep-option" :class="{ active: capitalization === 'word-random' }">
            <input v-model="capitalization" value="word-random" type="radio" class="sr-only" />
            <span>WORD word IS random</span>
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
      </div>

      <div class="card">
        <button @click="generatePassword" class="btn btn-primary">Generate Passphrase</button>
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
              <span class="mdi mdi-refresh word-pill-icon"></span>
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
          <input
            v-model="password"
            type="text"
            readonly
            class="form-input password-input"
            placeholder="Generated passphrase will appear here..."
          />
          <button @click="copyPassword" :class="['copy-btn', { copied }]" :title="copied ? 'Copied!' : 'Copy to clipboard'">
            <span :class="['mdi', copied ? 'mdi-check' : 'mdi-content-copy']"></span>
          </button>
        </div>
        <HistoryStrip :history="history" :current="password" @select="password = $event" />
        <div v-if="notification.show" :class="['notification', notification.type]">
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
    const toggleLeet = (char) => {
      const next = new Set(activeLeet.value)
      if (next.has(char)) next.delete(char)
      else next.add(char)
      activeLeet.value = next
    }
    const selectAllLeet = () => { activeLeet.value = new Set(LEET_MAP.map(m => m.char)) }
    const selectNoLeet = () => { activeLeet.value = new Set() }
    const password = ref('')
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
      const pool = catId === 'random' ? Object.values(typeCats).flat() : (typeCats[catId] || Object.values(typeCats).flat())
      return pool[Math.floor(Math.random() * pool.length)] || ''
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
      let wordIndex = 0
      const filledSegments = rawSegments.value.map(seg => {
        if (!seg.isToken) return seg.word
        return applyCapitalization(seg.word, capitalization.value, wordIndex++)
      })
      preview.value = filledSegments.join('')
      const words = preview.value.split(/\s+/).filter(Boolean)
      const assembled = cachedPre.value + words.join(cachedSep.value) + cachedSuf.value
      password.value = activeLeet.value.size > 0 ? applyLeet(assembled, activeLeet.value) : assembled
      pushHistory(password.value)
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
      lockAffixes,
      password, rawSegments, history, copied, preview, notification,
      separatorOptions: SEPARATOR_OPTIONS,
      suffixOptions: SUFFIX_OPTIONS,
      generatePassword, regenWord, copyPassword,
    }
  },
  components: { AffixPicker, HistoryStrip },
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
            <span>rAnDoM letters</span>
          </label>
          <label class="sep-option" :class="{ active: capitalization === 'word-alt' }">
            <input v-model="capitalization" value="word-alt" type="radio" class="sr-only" />
            <span>WORD word WORD word</span>
          </label>
          <label class="sep-option" :class="{ active: capitalization === 'word-random' }">
            <input v-model="capitalization" value="word-random" type="radio" class="sr-only" />
            <span>WORD word IS random</span>
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
      </div>

      <div class="card">
        <button @click="generatePassword" class="btn btn-primary">Generate Mad Lib</button>
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
                <span class="mdi mdi-refresh word-pill-icon"></span>
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
          <input
            v-model="password"
            type="text"
            readonly
            class="form-input password-input"
            autocomplete="off"
            data-1p-ignore
            data-lpignore="true"
            data-form-type="other"
            data-keeper-autofill="off"
            placeholder="Generated password will appear here..."
          />
          <button @click="copyPassword" :class="['copy-btn', { copied }]" :title="copied ? 'Copied!' : 'Copy to clipboard'">
            <span :class="['mdi', copied ? 'mdi-check' : 'mdi-content-copy']"></span>
          </button>
        </div>
        <HistoryStrip :history="history" :current="password" @select="password = $event" />
        <div v-if="notification.show" :class="['notification', notification.type]">
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
    const activeTab = ref(0)
    const tabs = [
      { id: 1, name: 'Simple',     component: SimplePassword },
      { id: 2, name: 'Advanced',   component: AdvancedPassword },
      { id: 3, name: 'Words',      component: WordsPassword },
      { id: 4, name: 'Passphrase', component: Passphrase },
      { id: 5, name: 'Mad Lib',    component: MadLib },
      { id: 6, name: 'Numbers',    component: NumbersPassword },
    ]

    return {
      activeTab,
      tabs,
      historyMax
    }
  },
  template: `
    <div id="app">
      <header class="header">
        <div class="container">
          <div class="header-title-block">
            <img src="/src/assets/password_generator_icon_v3 copy.svg" class="header-icon" alt="" aria-hidden="true" />
            <div>
              <h1 class="title">Random Password Generator</h1>
              <p class="subtitle">Generate secure passwords with multiple customization options</p>
            </div>
          </div>
          <div class="header-meta">
            <div class="privacy-notice">
              🔒 <strong>Privacy Notice:</strong> All passwords are generated locally in your browser and never transmitted. Your settings and generation history are stored only in your browser's local storage — history is session-local and cleared when you clear your browser data.
            </div>
            <div class="history-max-control">
              <label class="history-max-label">History</label>
              <div class="history-max-chips">
                <button
                  v-for="n in [0, 5, 10, 20, 50]"
                  :key="n"
                  class="history-max-chip"
                  :class="{ active: historyMax === n }"
                  @click="historyMax = n"
                >{{ n === 0 ? 'Off' : n }}</button>
              </div>
            </div>
          </div>
        </div>
      </header>
      
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
    </div>
  `
}

createApp(App).mount('#app')