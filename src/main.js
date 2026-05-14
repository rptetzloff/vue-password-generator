import { createApp, ref, onMounted } from 'https://unpkg.com/vue@3.4.0/dist/vue.esm-browser.prod.js'

const SPECIAL_CHARS = '!#$%&*+-/:;=?@^_|~'
const DIGITS = '0123456789'

const randChar = (str) => str.charAt(Math.floor(Math.random() * str.length))

const resolveSeparator = (value, custom) => {
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
  { value: '',      label: 'None' },
  { value: ' ',     label: 'Space' },
  { value: '-',     label: 'Hyphen  -' },
  { value: '_',     label: 'Underscore  _' },
  { value: '.',     label: 'Period  .' },
  { value: '$',     label: 'Dollar  $' },
  { value: 'r1sym', label: '1 Random Symbol' },
  { value: 'r2sym', label: '2 Random Symbols' },
  { value: 'r1num', label: '1 Random Number' },
  { value: 'r2num', label: '2 Random Numbers' },
  { value: 'r1s1n', label: '1 Symbol + 1 Number' },
  { value: 'r1n1s', label: '1 Number + 1 Symbol' },
  { value: 'r2s2n', label: '2 Symbols + 2 Numbers' },
  { value: 'r2n2s', label: '2 Numbers + 2 Symbols' },
  { value: 'custom', label: 'Custom...' },
]

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
    const customSymbols = ref('!#$%&()*+,-./:;<=>?@[]^_`{|}~')
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
      customSymbols,
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
          <label class="form-label">Custom Symbol Set</label>
          <input
            v-model="customSymbols"
            type="text"
            class="form-input"
            placeholder="!@#$%^&*()"
          />
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
    const prefix = ref('')
    const suffix = ref('')
    const password = ref('')
    const notification = ref({
      show: false,
      message: '',
      type: 'success'
    })
    const wordList = ref([])

    const loadWordList = async () => {
      try {
        const response = await fetch('./data/nouns.txt')
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
        let word = wordList.value[Math.floor(Math.random() * wordList.value.length)]

        switch (capitalization.value) {
          case 'title':
            word = word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()
            break
          case 'upper':
            word = word.toUpperCase()
            break
          case 'none':
            word = word.toLowerCase()
            break
          case 'random':
            word = word.split('').map(char =>
              Math.random() > 0.5 ? char.toUpperCase() : char.toLowerCase()
            ).join('')
            break
        }

        words.push(word)
      }

      password.value = prefix.value + words.join(resolveSeparator(separator.value, customSeparator.value)) + suffix.value
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
      prefix,
      suffix,
      password,
      notification,
      separatorOptions: SEPARATOR_OPTIONS,
      generatePassword,
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
        <div class="radio-group">
          <label class="radio-item">
            <input v-model="capitalization" value="title" type="radio" class="radio" />
            <span>Title Case</span>
          </label>
          <label class="radio-item">
            <input v-model="capitalization" value="none" type="radio" class="radio" />
            <span>lowercase</span>
          </label>
          <label class="radio-item">
            <input v-model="capitalization" value="upper" type="radio" class="radio" />
            <span>UPPERCASE</span>
          </label>
          <label class="radio-item">
            <input v-model="capitalization" value="random" type="radio" class="radio" />
            <span>rAnDoM</span>
          </label>
        </div>
      </div>

      <div class="card">
        <div class="card-header">Prefix &amp; Suffix</div>
        <div class="prefix-suffix-row">
          <div class="prefix-suffix-field">
            <label class="form-label">Prefix</label>
            <input
              v-model="prefix"
              type="text"
              class="form-input"
              placeholder="e.g. ^^12"
            />
          </div>
          <div class="prefix-suffix-separator">
            <span class="prefix-suffix-arrow">&#8594;</span>
            <span class="prefix-suffix-preview">words</span>
            <span class="prefix-suffix-arrow">&#8594;</span>
          </div>
          <div class="prefix-suffix-field">
            <label class="form-label">Suffix</label>
            <input
              v-model="suffix"
              type="text"
              class="form-input"
              placeholder="e.g. 34^^"
            />
          </div>
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
const Passphrase = {
  name: 'Passphrase',
  setup() {
    const includeAdjective = ref(true)
    const includeNoun = ref(true)
    const includeVerb = ref(true)
    const separator = ref('$')
    const customSeparator = ref('')
    const capitalization = ref('upper')
    const prefix = ref('')
    const suffix = ref('')
    const password = ref('')
    const notification = ref({
      show: false,
      message: '',
      type: 'success'
    })
    const wordLists = ref({
      nouns: [],
      verbs: [],
      adjectives: []
    })

    const loadWordLists = async () => {
      try {
        const [nounsResponse, verbsResponse, adjectivesResponse] = await Promise.all([
          fetch('./data/nouns.txt'),
          fetch('./data/verbs.txt'),
          fetch('./data/adjectives.txt')
        ])

        const nounsText = await nounsResponse.text()
        const verbsText = await verbsResponse.text()
        const adjectivesText = await adjectivesResponse.text()

        wordLists.value.nouns = nounsText.split(',').map(word => word.trim()).filter(word => word.length > 0)
        wordLists.value.verbs = verbsText.split(',').map(word => word.trim()).filter(word => word.length > 0)
        wordLists.value.adjectives = adjectivesText.split(',').map(word => word.trim()).filter(word => word.length > 0)
      } catch (err) {
        console.error('Failed to load word lists:', err)
        wordLists.value.nouns = ['house', 'car', 'tree', 'book', 'phone', 'computer', 'table', 'chair']
        wordLists.value.verbs = ['run', 'jump', 'walk', 'talk', 'think', 'write', 'read', 'play']
        wordLists.value.adjectives = ['big', 'small', 'fast', 'slow', 'happy', 'sad', 'bright', 'dark']
      }
    }

    const applyCapitalization = (word) => {
      switch (capitalization.value) {
        case 'title':
          return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()
        case 'upper':
          return word.toUpperCase()
        case 'none':
          return word.toLowerCase()
        case 'random':
          return word.split('').map(char =>
            Math.random() > 0.5 ? char.toUpperCase() : char.toLowerCase()
          ).join('')
        default:
          return word
      }
    }

    const generatePassword = () => {
      if (!includeAdjective.value && !includeNoun.value && !includeVerb.value) {
        showNotification('Please select at least one word type', 'error')
        return
      }

      const words = []

      if (includeAdjective.value && wordLists.value.adjectives.length > 0) {
        const word = wordLists.value.adjectives[Math.floor(Math.random() * wordLists.value.adjectives.length)]
        words.push(applyCapitalization(word))
      }

      if (includeNoun.value && wordLists.value.nouns.length > 0) {
        const word = wordLists.value.nouns[Math.floor(Math.random() * wordLists.value.nouns.length)]
        words.push(applyCapitalization(word))
      }

      if (includeVerb.value && wordLists.value.verbs.length > 0) {
        const word = wordLists.value.verbs[Math.floor(Math.random() * wordLists.value.verbs.length)]
        words.push(applyCapitalization(word))
      }

      password.value = prefix.value + words.join(resolveSeparator(separator.value, customSeparator.value)) + suffix.value
    }

    const copyPassword = async () => {
      if (!password.value) {
        showNotification('No passphrase to copy', 'error')
        return
      }

      try {
        await navigator.clipboard.writeText(password.value)
        showNotification('Passphrase copied to clipboard!', 'success')
      } catch (err) {
        showNotification('Failed to copy passphrase', 'error')
      }
    }

    const showNotification = (message, type = 'success') => {
      notification.value = { show: true, message, type }
      setTimeout(() => {
        notification.value.show = false
      }, 3000)
    }

    onMounted(async () => {
      await loadWordLists()
      generatePassword()
    })

    return {
      includeAdjective,
      includeNoun,
      includeVerb,
      separator,
      customSeparator,
      capitalization,
      prefix,
      suffix,
      password,
      notification,
      separatorOptions: SEPARATOR_OPTIONS,
      generatePassword,
      copyPassword
    }
  },
  template: `
    <div class="password-generator">
      <div class="card">
        <div class="card-header">Sentence Structure</div>
        <div class="checkbox-group">
          <label class="checkbox-item">
            <input v-model="includeAdjective" type="checkbox" class="checkbox" />
            <span>Include Adjective</span>
          </label>
          <label class="checkbox-item">
            <input v-model="includeNoun" type="checkbox" class="checkbox" />
            <span>Include Noun</span>
          </label>
          <label class="checkbox-item">
            <input v-model="includeVerb" type="checkbox" class="checkbox" />
            <span>Include Verb</span>
          </label>
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
        <div class="radio-group">
          <label class="radio-item">
            <input v-model="capitalization" value="title" type="radio" class="radio" />
            <span>Title Case</span>
          </label>
          <label class="radio-item">
            <input v-model="capitalization" value="none" type="radio" class="radio" />
            <span>lowercase</span>
          </label>
          <label class="radio-item">
            <input v-model="capitalization" value="upper" type="radio" class="radio" />
            <span>UPPERCASE</span>
          </label>
          <label class="radio-item">
            <input v-model="capitalization" value="random" type="radio" class="radio" />
            <span>rAnDoM</span>
          </label>
        </div>
      </div>

      <div class="card">
        <div class="card-header">Prefix &amp; Suffix</div>
        <div class="prefix-suffix-row">
          <div class="prefix-suffix-field">
            <label class="form-label">Prefix</label>
            <input
              v-model="prefix"
              type="text"
              class="form-input"
              placeholder="e.g. ^^12"
            />
          </div>
          <div class="prefix-suffix-separator">
            <span class="prefix-suffix-arrow">&#8594;</span>
            <span class="prefix-suffix-preview">words</span>
            <span class="prefix-suffix-arrow">&#8594;</span>
          </div>
          <div class="prefix-suffix-field">
            <label class="form-label">Suffix</label>
            <input
              v-model="suffix"
              type="text"
              class="form-input"
              placeholder="e.g. 34^^"
            />
          </div>
        </div>
      </div>

      <div class="card">
        <button @click="generatePassword" class="btn btn-primary">
          Generate Passphrase
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
      { id: 5, name: 'Passphrase', component: Passphrase }
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