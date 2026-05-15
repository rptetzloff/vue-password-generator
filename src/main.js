import { createApp, ref, computed, watch, onMounted } from 'https://unpkg.com/vue@3.4.0/dist/vue.esm-browser.prod.js'

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

// Reusable affix chip-picker + optional literal text — rendered as a template string component
const AffixPicker = {
  name: 'AffixPicker',
  props: ['label', 'modelValue', 'customValue'],
  emits: ['update:modelValue', 'update:customValue'],
  setup(props, { emit }) {
    return {
      affixOptions: AFFIX_OPTIONS,
      onMode(v) { emit('update:modelValue', v) },
      onCustom(e) { emit('update:customValue', e.target.value) },
    }
  },
  template: `
    <div class="affix-block">
      <div class="affix-label">{{ label }}</div>
      <div class="separator-grid">
        <label
          v-for="opt in affixOptions"
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
  setup() {
    const passwordLength = ref(20)
    const lowerCase = ref(true)
    const upperCase = ref(true)
    const digits = ref(true)
    const specialChars = ref(true)
    const password = ref('')
    const notification = ref({
      show: false,
      message: '',
      type: 'success'
    })

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
    }

    const copyPassword = async () => {
      if (!password.value) {
        showNotification('No password to copy', 'error')
        return
      }

      try {
        await navigator.clipboard.writeText(password.value)
        showNotification('Password copied to clipboard!', 'success')
      } catch (err) {
        showNotification('Failed to copy password', 'error')
      }
    }

    const showNotification = (message, type = 'success') => {
      notification.value = { show: true, message, type }
      setTimeout(() => {
        notification.value.show = false
      }, 3000)
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

      <div class="password-display">
        <input
          v-model="password"
          type="text"
          readonly
          class="form-input password-input"
          placeholder="Generated password will appear here..."
        />
        <button @click="copyPassword" class="copy-btn" title="Copy to clipboard">
          📋
        </button>
      </div>

      <div v-if="notification.show" :class="['notification', notification.type]">
        {{ notification.message }}
      </div>
    </div>
  `
}

// Advanced Password Generator Component
const AdvancedPassword = {
  name: 'AdvancedPassword',
  setup() {
    const passwordLength = ref(20)
    const lowerCase = ref([1, 20])
    const upperCase = ref([1, 20])
    const digits = ref([1, 20])
    const specialChars = ref([1, 20])
    const ALL_SYMBOLS = '!#$%&()*+,-./:;<=>?@[]^_`{|}~'.split('')
    const activeSymbols = ref(new Set(ALL_SYMBOLS))
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
    const notification = ref({
      show: false,
      message: '',
      type: 'success'
    })

    const characterSets = {
      lower: 'abcdefghijklmnopqrstuvwxyz',
      upper: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
      digits: '0123456789'
    }

    const generatePassword = () => {
      const minTotal = lowerCase.value[0] + upperCase.value[0] + digits.value[0] + specialChars.value[0]
      const maxTotal = lowerCase.value[1] + upperCase.value[1] + digits.value[1] + specialChars.value[1]
      
      if (minTotal > passwordLength.value) {
        showNotification('Minimum character requirements exceed password length', 'error')
        return
      }
      
      if (maxTotal < passwordLength.value) {
        showNotification('Maximum character limits are less than password length', 'error')
        return
      }

      let newPassword = ''
      let charTypes = []

      // Add minimum required characters
      for (let i = 0; i < lowerCase.value[0]; i++) {
        charTypes.push('lower')
      }
      for (let i = 0; i < upperCase.value[0]; i++) {
        charTypes.push('upper')
      }
      for (let i = 0; i < digits.value[0]; i++) {
        charTypes.push('digits')
      }
      for (let i = 0; i < specialChars.value[0]; i++) {
        charTypes.push('special')
      }

      // Fill remaining slots randomly within limits
      while (charTypes.length < passwordLength.value) {
        const availableTypes = []
        
        const lowerCount = charTypes.filter(t => t === 'lower').length
        const upperCount = charTypes.filter(t => t === 'upper').length
        const digitCount = charTypes.filter(t => t === 'digits').length
        const specialCount = charTypes.filter(t => t === 'special').length
        
        if (lowerCount < lowerCase.value[1]) availableTypes.push('lower')
        if (upperCount < upperCase.value[1]) availableTypes.push('upper')
        if (digitCount < digits.value[1]) availableTypes.push('digits')
        if (specialCount < specialChars.value[1]) availableTypes.push('special')
        
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
    }

    const copyPassword = async () => {
      if (!password.value) {
        showNotification('No password to copy', 'error')
        return
      }

      try {
        await navigator.clipboard.writeText(password.value)
        showNotification('Password copied to clipboard!', 'success')
      } catch (err) {
        showNotification('Failed to copy password', 'error')
      }
    }

    const showNotification = (message, type = 'success') => {
      notification.value = { show: true, message, type }
      setTimeout(() => {
        notification.value.show = false
      }, 3000)
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

      <div class="password-display">
        <input
          v-model="password"
          type="text"
          readonly
          class="form-input password-input"
          placeholder="Generated password will appear here..."
        />
        <button @click="copyPassword" class="copy-btn" title="Copy to clipboard">
          📋
        </button>
      </div>

      <div v-if="notification.show" :class="['notification', notification.type]">
        {{ notification.message }}
      </div>
    </div>
  `
}

// Words Password Generator Component
const WordsPassword = {
  name: 'WordsPassword',
  setup() {
    const wordCount = ref(4)
    const separator = ref('$')
    const customSeparator = ref('')
    const capitalization = ref('title')
    const prefixMode = ref('')
    const prefixCustom = ref('')
    const suffixMode = ref('')
    const suffixCustom = ref('')
    const password = ref('')
    const notification = ref({
      show: false,
      message: '',
      type: 'success'
    })
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

    const generatePassword = () => {
      if (wordList.value.length === 0) {
        showNotification('Word list not loaded', 'error')
        return
      }

      const words = []

      for (let i = 0; i < wordCount.value; i++) {
        const raw = wordList.value[Math.floor(Math.random() * wordList.value.length)]
        words.push(applyCapitalization(raw, capitalization.value, i))
      }

      const pre = resolveToken(prefixMode.value, prefixCustom.value)
      const suf = resolveToken(suffixMode.value, suffixCustom.value)
      password.value = pre + words.join(resolveToken(separator.value, customSeparator.value)) + suf
    }

    const copyPassword = async () => {
      if (!password.value) {
        showNotification('No password to copy', 'error')
        return
      }

      try {
        await navigator.clipboard.writeText(password.value)
        showNotification('Password copied to clipboard!', 'success')
      } catch (err) {
        showNotification('Failed to copy password', 'error')
      }
    }

    const showNotification = (message, type = 'success') => {
      notification.value = { show: true, message, type }
      setTimeout(() => {
        notification.value.show = false
      }, 3000)
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
      password,
      notification,
      separatorOptions: SEPARATOR_OPTIONS,
      generatePassword,
      copyPassword
    }
  },
  components: { AffixPicker },
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
            @update:modelValue="suffixMode = $event"
            @update:customValue="suffixCustom = $event"
          />
        </div>
      </div>

      <div class="card">
        <button @click="generatePassword" class="btn btn-primary">
          Generate Password
        </button>
      </div>

      <div class="password-display">
        <input
          v-model="password"
          type="text"
          readonly
          class="form-input password-input"
          placeholder="Generated password will appear here..."
        />
        <button @click="copyPassword" class="copy-btn" title="Copy to clipboard">
          📋
        </button>
      </div>

      <div v-if="notification.show" :class="['notification', notification.type]">
        {{ notification.message }}
      </div>
    </div>
  `
}

// Numbers Password Generator Component
const NumbersPassword = {
  name: 'NumbersPassword',
  setup() {
    const passwordLength = ref(8)
    const maxRepeated = ref(3)
    const maxSequential = ref(3)
    const password = ref('')
    const notification = ref({
      show: false,
      message: '',
      type: 'success'
    })

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
    }

    const copyPassword = async () => {
      if (!password.value) {
        showNotification('No password to copy', 'error')
        return
      }

      try {
        await navigator.clipboard.writeText(password.value)
        showNotification('Password copied to clipboard!', 'success')
      } catch (err) {
        showNotification('Failed to copy password', 'error')
      }
    }

    const showNotification = (message, type = 'success') => {
      notification.value = { show: true, message, type }
      setTimeout(() => {
        notification.value.show = false
      }, 3000)
    }

    onMounted(() => {
      generatePassword()
    })

    return {
      passwordLength,
      maxRepeated,
      maxSequential,
      password,
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

      <div class="password-display">
        <input
          v-model="password"
          type="text"
          readonly
          class="form-input password-input"
          placeholder="Generated password will appear here..."
        />
        <button @click="copyPassword" class="copy-btn" title="Copy to clipboard">
          📋
        </button>
      </div>

      <div v-if="notification.show" :class="['notification', notification.type]">
        {{ notification.message }}
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
    let nextId = 0
    const makeSlot = (type) => ({ id: nextId++, type, cat: 'random' })

    const slots = ref([makeSlot('adj'), makeSlot('noun'), makeSlot('verb')])
    const separator = ref('$')
    const customSeparator = ref('')
    const capitalization = ref('upper')
    const prefixMode = ref('')
    const prefixCustom = ref('')
    const suffixMode = ref('')
    const suffixCustom = ref('')
    const password = ref('')
    const notification = ref({ show: false, message: '', type: 'success' })
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

    const generatePassword = () => {
      if (slots.value.length === 0) {
        showNotification('Add at least one word slot', 'error')
        return
      }
      const words = slots.value.map((s, i) =>
        applyCapitalization(pickFrom(s.type, s.cat), capitalization.value, i)
      )
      const sep = resolveToken(separator.value, customSeparator.value)
      const pre = resolveToken(prefixMode.value, prefixCustom.value)
      const suf = resolveToken(suffixMode.value, suffixCustom.value)
      password.value = pre + words.join(sep) + suf
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

    const copyPassword = async () => {
      if (!password.value) { showNotification('No passphrase to copy', 'error'); return }
      try {
        await navigator.clipboard.writeText(password.value)
        showNotification('Passphrase copied to clipboard!', 'success')
      } catch { showNotification('Failed to copy passphrase', 'error') }
    }

    const showNotification = (message, type = 'success') => {
      notification.value = { show: true, message, type }
      setTimeout(() => { notification.value.show = false }, 3000)
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
      password, notification,
      separatorOptions: SEPARATOR_OPTIONS,
      generatePassword, copyPassword
    }
  },
  components: { AffixPicker },
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
            @update:modelValue="suffixMode = $event"
            @update:customValue="suffixCustom = $event"
          />
        </div>
      </div>

      <div class="card">
        <button @click="generatePassword" class="btn btn-primary">Generate Passphrase</button>
      </div>

      <div class="password-display">
        <input
          v-model="password"
          type="text"
          readonly
          class="form-input password-input"
          placeholder="Generated passphrase will appear here..."
        />
        <button @click="copyPassword" class="copy-btn" title="Copy to clipboard">&#128203;</button>
      </div>

      <div v-if="notification.show" :class="['notification', notification.type]">
        {{ notification.message }}
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
    const templateId = ref('hero')
    // One entry per token occurrence: { type, cat }
    const slotCats = ref([])

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

    const separator = ref('-')
    const customSeparator = ref('')
    const capitalization = ref('title')
    const prefixMode = ref('')
    const prefixCustom = ref('')
    const suffixMode = ref('')
    const suffixCustom = ref('')
    const password = ref('')
    const preview = ref('')
    const notification = ref({ show: false, message: '', type: 'success' })
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

    const generatePassword = () => {
      const tmpl = MADLIB_TEMPLATES.find(t => t.id === templateId.value)
      if (!tmpl) return

      const typeOccurrence = {}
      let wordIndex = 0
      const filled = tmpl.template.replace(/\{(adj|adv|noun|verb)\}/g, (_, type) => {
        typeOccurrence[type] = (typeOccurrence[type] || 0) + 1
        const slotEntry = slotCats.value.find(s => s.type === type && s.occurrence === typeOccurrence[type])
        const raw = pickFrom(type, slotEntry?.cat ?? 'random')
        const capped = applyCapitalization(raw, capitalization.value, wordIndex++)
        return capped
      })

      preview.value = filled

      const sep = resolveToken(separator.value, customSeparator.value)
      const words = filled.split(/\s+/).filter(Boolean)
      const pre = resolveToken(prefixMode.value, prefixCustom.value)
      const suf = resolveToken(suffixMode.value, suffixCustom.value)
      password.value = pre + words.join(sep) + suf
    }

    const copyPassword = async () => {
      if (!password.value) { showNotification('No password to copy', 'error'); return }
      try {
        await navigator.clipboard.writeText(password.value)
        showNotification('Password copied to clipboard!', 'success')
      } catch { showNotification('Failed to copy password', 'error') }
    }

    const showNotification = (message, type = 'success') => {
      notification.value = { show: true, message, type }
      setTimeout(() => { notification.value.show = false }, 3000)
    }

    watch(templateId, (newId) => {
      slotCats.value = rebuildSlotCats(newId, slotCats.value)
      generatePassword()
    })

    onMounted(async () => {
      await loadWordData()
      slotCats.value = rebuildSlotCats(templateId.value, [])
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
      password, preview, notification,
      separatorOptions: SEPARATOR_OPTIONS,
      generatePassword, copyPassword,
    }
  },
  components: { AffixPicker },
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
            @update:modelValue="suffixMode = $event"
            @update:customValue="suffixCustom = $event"
          />
        </div>
      </div>

      <div class="card">
        <button @click="generatePassword" class="btn btn-primary">Generate Mad Lib</button>
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
          placeholder="Generated password will appear here..."
        />
        <button @click="copyPassword" class="copy-btn" title="Copy to clipboard">&#128203;</button>
      </div>

      <div v-if="notification.show" :class="['notification', notification.type]">
        {{ notification.message }}
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
      { id: 1, name: 'Simple', component: SimplePassword },
      { id: 2, name: 'Advanced', component: AdvancedPassword },
      { id: 3, name: 'Words', component: WordsPassword },
      { id: 4, name: 'Numbers', component: NumbersPassword },
      { id: 5, name: 'Passphrase', component: Passphrase },
      { id: 6, name: 'Mad Lib', component: MadLib }
    ]

    return {
      activeTab,
      tabs
    }
  },
  template: `
    <div id="app">
      <header class="header">
        <div class="container">
          <h1 class="title">🔐 Password Generator</h1>
          <p class="subtitle">Generate secure passwords with multiple customization options</p>
          <div style="background: rgba(255, 255, 255, 0.1); padding: 0.75rem 1rem; border-radius: 6px; margin-top: 1rem; font-size: 0.9rem; border: 1px solid rgba(255, 255, 255, 0.2);">
            🔒 <strong>Privacy Notice:</strong> All passwords are generated locally in your browser. No data is sent to servers or stored anywhere.
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