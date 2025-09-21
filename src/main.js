import { createApp } from 'https://unpkg.com/vue@3/dist/vue.esm-browser.js'

// Simple Password Generator Component
const SimplePassword = {
  name: 'SimplePassword',
  data() {
    return {
      passwordLength: 20,
      lowerCase: true,
      upperCase: true,
      digits: true,
      specialChars: true,
      password: '',
      notification: { show: false, message: '', type: 'success' }
    }
  },
  methods: {
    generatePassword() {
      if (!this.lowerCase && !this.upperCase && !this.digits && !this.specialChars) {
        this.showNotification('Please select at least one character type', 'error')
        return
      }

      let charset = ''
      if (this.lowerCase) charset += 'abcdefghijklmnopqrstuvwxyz'
      if (this.upperCase) charset += 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'
      if (this.digits) charset += '0123456789'
      if (this.specialChars) charset += '!#$%&()*+,-./:;<=>?@[]^_`{|}~'

      let password = ''
      for (let i = 0; i < this.passwordLength; i++) {
        password += charset.charAt(Math.floor(Math.random() * charset.length))
      }
      this.password = password
    },
    
    async copyPassword() {
      if (!this.password) {
        this.showNotification('No password to copy', 'error')
        return
      }
      try {
        await navigator.clipboard.writeText(this.password)
        this.showNotification('Password copied to clipboard!', 'success')
      } catch (err) {
        this.showNotification('Failed to copy password', 'error')
      }
    },

    showNotification(message, type = 'success') {
      this.notification = { show: true, message, type }
      setTimeout(() => { this.notification.show = false }, 3000)
    }
  },
  
  mounted() {
    this.generatePassword()
  },
  
  template: `
    <div class="password-generator">
      <div class="card">
        <div class="card-header">Password Length</div>
        <div class="slider-container">
          <input v-model="passwordLength" type="range" min="6" max="128" class="slider" />
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
        <button @click="generatePassword" class="btn btn-primary">🎲 Generate Password</button>
      </div>

      <div class="password-display">
        <input v-model="password" type="text" readonly class="form-input password-input" placeholder="Generated password will appear here..." />
        <button @click="copyPassword" class="copy-btn" title="Copy to clipboard">📋</button>
      </div>

      <div v-if="notification.show" :class="['notification', notification.type]">{{ notification.message }}</div>
    </div>
  `
}

// Words Password Generator Component
const WordsPassword = {
  name: 'WordsPassword',
  data() {
    return {
      wordCount: 4,
      separator: 'random',
      capitalization: 'title',
      password: '',
      notification: { show: false, message: '', type: 'success' },
      wordList: []
    }
  },
  
  async created() {
    try {
      const response = await fetch('./data/nouns.txt')
      const text = await response.text()
      this.wordList = text.split(',').map(word => word.trim()).filter(word => word.length > 0)
      console.log('Loaded', this.wordList.length, 'words')
    } catch (err) {
      console.error('Failed to load word list:', err)
      // Fallback word list
      this.wordList = ['ability', 'account', 'action', 'active', 'address', 'advance', 'agency', 'agent', 'agree', 'allow', 'amount', 'animal', 'answer', 'appear', 'approach', 'area', 'argue', 'around', 'arrive', 'article', 'artist', 'assume', 'attack', 'attempt', 'attend', 'author', 'avoid', 'balance', 'become', 'before', 'begin', 'believe', 'benefit', 'better', 'between', 'beyond', 'budget', 'build', 'business']
    }
  },
  
  methods: {
    generatePassword() {
      if (this.wordList.length === 0) {
        this.showNotification('Word list not loaded', 'error')
        return
      }

      const words = []
      for (let i = 0; i < this.wordCount; i++) {
        let word = this.wordList[Math.floor(Math.random() * this.wordList.length)]
        
        switch (this.capitalization) {
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

      let sep = ''
      if (this.separator === 'random') {
        const symbols = '!#$%&*+-/:;=?@^_|~'
        sep = symbols.charAt(Math.floor(Math.random() * symbols.length))
      } else {
        sep = this.separator
      }

      this.password = words.join(sep)
    },
    
    async copyPassword() {
      if (!this.password) {
        this.showNotification('No password to copy', 'error')
        return
      }
      try {
        await navigator.clipboard.writeText(this.password)
        this.showNotification('Password copied to clipboard!', 'success')
      } catch (err) {
        this.showNotification('Failed to copy password', 'error')
      }
    },

    showNotification(message, type = 'success') {
      this.notification = { show: true, message, type }
      setTimeout(() => { this.notification.show = false }, 3000)
    }
  },
  
  mounted() {
    this.generatePassword()
  },
  
  template: `
    <div class="password-generator">
      <div class="card">
        <div class="card-header">Number of Words</div>
        <div class="slider-container">
          <input v-model="wordCount" type="range" min="2" max="20" class="slider" />
          <div class="slider-value">{{ wordCount }}</div>
        </div>
      </div>

      <div class="card">
        <div class="card-header">Word Separator</div>
        <div class="radio-group">
          <label class="radio-item">
            <input v-model="separator" value="" type="radio" class="radio" />
            <span>None</span>
          </label>
          <label class="radio-item">
            <input v-model="separator" value="random" type="radio" class="radio" />
            <span>Random Symbol</span>
          </label>
          <label class="radio-item">
            <input v-model="separator" value=" " type="radio" class="radio" />
            <span>Space</span>
          </label>
          <label class="radio-item">
            <input v-model="separator" value="-" type="radio" class="radio" />
            <span>Hyphen</span>
          </label>
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
        <button @click="generatePassword" class="btn btn-primary">🎲 Generate Password</button>
      </div>

      <div class="password-display">
        <input v-model="password" type="text" readonly class="form-input password-input" placeholder="Generated password will appear here..." />
        <button @click="copyPassword" class="copy-btn" title="Copy to clipboard">📋</button>
      </div>

      <div v-if="notification.show" :class="['notification', notification.type]">{{ notification.message }}</div>
    </div>
  `
}

// Numbers Password Generator Component
const NumbersPassword = {
  name: 'NumbersPassword',
  data() {
    return {
      passwordLength: 8,
      maxRepeated: 3,
      maxSequential: 3,
      password: '',
      notification: { show: false, message: '', type: 'success' }
    }
  },
  
  methods: {
    generatePassword() {
      let password = ''
      let repeatedCount = 0
      let sequentialCount = 0
      let sequenceDirection = null
      
      for (let i = 0; i < this.passwordLength; i++) {
        let availableDigits = '0123456789'
        const lastDigit = password.slice(-1)
        
        if (lastDigit) {
          const lastNum = parseInt(lastDigit)
          
          if (repeatedCount >= this.maxRepeated) {
            availableDigits = availableDigits.replace(lastDigit, '')
          }
          
          if (sequentialCount >= this.maxSequential) {
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
        password += nextDigit
        
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
      
      this.password = password
    },
    
    async copyPassword() {
      if (!this.password) {
        this.showNotification('No password to copy', 'error')
        return
      }
      try {
        await navigator.clipboard.writeText(this.password)
        this.showNotification('Password copied to clipboard!', 'success')
      } catch (err) {
        this.showNotification('Failed to copy password', 'error')
      }
    },

    showNotification(message, type = 'success') {
      this.notification = { show: true, message, type }
      setTimeout(() => { this.notification.show = false }, 3000)
    }
  },
  
  mounted() {
    this.generatePassword()
  },
  
  template: `
    <div class="password-generator">
      <div class="card">
        <div class="card-header">Number of Digits</div>
        <div class="slider-container">
          <input v-model="passwordLength" type="range" min="4" max="32" class="slider" />
          <div class="slider-value">{{ passwordLength }}</div>
        </div>
      </div>

      <div class="card">
        <div class="card-header">Maximum Repeated Digits</div>
        <div class="slider-container">
          <input v-model="maxRepeated" type="range" min="2" max="5" class="slider" />
          <div class="slider-value">{{ maxRepeated }}</div>
        </div>
      </div>

      <div class="card">
        <div class="card-header">Maximum Sequential Digits</div>
        <div class="slider-container">
          <input v-model="maxSequential" type="range" min="2" max="5" class="slider" />
          <div class="slider-value">{{ maxSequential }}</div>
        </div>
      </div>

      <div class="card">
        <button @click="generatePassword" class="btn btn-primary">🎲 Generate Password</button>
      </div>

      <div class="password-display">
        <input v-model="password" type="text" readonly class="form-input password-input" placeholder="Generated password will appear here..." />
        <button @click="copyPassword" class="copy-btn" title="Copy to clipboard">📋</button>
      </div>

      <div v-if="notification.show" :class="['notification', notification.type]">{{ notification.message }}</div>
    </div>
  `
}

// Passphrase Generator Component
const Passphrase = {
  name: 'Passphrase',
  data() {
    return {
      includeAdjective: true,
      includeNoun: true,
      includeVerb: true,
      separator: ' ',
      capitalization: 'title',
      addNumbers: true,
      addSymbols: true,
      password: '',
      notification: { show: false, message: '', type: 'success' },
      wordLists: { nouns: [], verbs: [], adjectives: [] }
    }
  },
  
  async created() {
    try {
      const [nounsResponse, verbsResponse, adjectivesResponse] = await Promise.all([
        fetch('./data/nouns.txt'),
        fetch('./data/verbs.txt'),
        fetch('./data/adjectives.txt')
      ])
      
      const nounsText = await nounsResponse.text()
      const verbsText = await verbsResponse.text()
      const adjectivesText = await adjectivesResponse.text()
      
      this.wordLists.nouns = nounsText.split(',').map(word => word.trim()).filter(word => word.length > 0)
      this.wordLists.verbs = verbsText.split(',').map(word => word.trim()).filter(word => word.length > 0)
      this.wordLists.adjectives = adjectivesText.split(',').map(word => word.trim()).filter(word => word.length > 0)
      console.log('Loaded word lists:', this.wordLists.nouns.length, 'nouns,', this.wordLists.verbs.length, 'verbs,', this.wordLists.adjectives.length, 'adjectives')
    } catch (err) {
      console.error('Failed to load word lists:', err)
      // Fallback
      this.wordLists.nouns = ['house', 'car', 'tree', 'book', 'phone', 'computer', 'table', 'chair']
      this.wordLists.verbs = ['run', 'jump', 'walk', 'talk', 'think', 'write', 'read', 'play']
      this.wordLists.adjectives = ['big', 'small', 'fast', 'slow', 'happy', 'sad', 'bright', 'dark']
    }
  },
  
  methods: {
    generatePassword() {
      if (!this.includeAdjective && !this.includeNoun && !this.includeVerb) {
        this.showNotification('Please select at least one word type', 'error')
        return
      }

      const words = []
      
      if (this.includeAdjective && this.wordLists.adjectives.length > 0) {
        const word = this.wordLists.adjectives[Math.floor(Math.random() * this.wordLists.adjectives.length)]
        words.push(this.applyCapitalization(word))
      }
      
      if (this.includeNoun && this.wordLists.nouns.length > 0) {
        const word = this.wordLists.nouns[Math.floor(Math.random() * this.wordLists.nouns.length)]
        words.push(this.applyCapitalization(word))
      }
      
      if (this.includeVerb && this.wordLists.verbs.length > 0) {
        const word = this.wordLists.verbs[Math.floor(Math.random() * this.wordLists.verbs.length)]
        words.push(this.applyCapitalization(word))
      }

      let sep = this.separator
      if (this.separator === 'random') {
        const symbols = '!#$%&*+-/:;=?@^_|~'
        sep = symbols.charAt(Math.floor(Math.random() * symbols.length))
      }

      let passphrase = words.join(sep)

      let prefix = ''
      let suffix = ''
      
      if (this.addNumbers) {
        const nums = '0123456789'
        prefix += nums.charAt(Math.floor(Math.random() * nums.length)) +
                  nums.charAt(Math.floor(Math.random() * nums.length))
      }
      
      if (this.addSymbols) {
        const symbols = '!#$%&*+-/:;=?@^_|~'
        const symbol = symbols.charAt(Math.floor(Math.random() * symbols.length))
        prefix += symbol + symbol
        suffix = symbol + symbol + suffix
      }
      
      if (this.addNumbers) {
        const nums = '0123456789'
        suffix = nums.charAt(Math.floor(Math.random() * nums.length)) +
                 nums.charAt(Math.floor(Math.random() * nums.length)) + suffix
      }

      this.password = prefix + passphrase + suffix
    },
    
    applyCapitalization(word) {
      switch (this.capitalization) {
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
    },
    
    async copyPassword() {
      if (!this.password) {
        this.showNotification('No passphrase to copy', 'error')
        return
      }
      try {
        await navigator.clipboard.writeText(this.password)
        this.showNotification('Passphrase copied to clipboard!', 'success')
      } catch (err) {
        this.showNotification('Failed to copy passphrase', 'error')
      }
    },

    showNotification(message, type = 'success') {
      this.notification = { show: true, message, type }
      setTimeout(() => { this.notification.show = false }, 3000)
    }
  },
  
  mounted() {
    this.generatePassword()
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
        <div class="radio-group">
          <label class="radio-item">
            <input v-model="separator" value="" type="radio" class="radio" />
            <span>None</span>
          </label>
          <label class="radio-item">
            <input v-model="separator" value=" " type="radio" class="radio" />
            <span>Space</span>
          </label>
          <label class="radio-item">
            <input v-model="separator" value="-" type="radio" class="radio" />
            <span>Hyphen</span>
          </label>
          <label class="radio-item">
            <input v-model="separator" value="random" type="radio" class="radio" />
            <span>Random Symbol</span>
          </label>
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
        <div class="card-header">Prefix & Suffix</div>
        <div class="checkbox-group">
          <label class="checkbox-item">
            <input v-model="addNumbers" type="checkbox" class="checkbox" />
            <span>Add Numbers</span>
          </label>
          <label class="checkbox-item">
            <input v-model="addSymbols" type="checkbox" class="checkbox" />
            <span>Add Symbols</span>
          </label>
        </div>
      </div>

      <div class="card">
        <button @click="generatePassword" class="btn btn-primary">🎲 Generate Passphrase</button>
      </div>

      <div class="password-display">
        <input v-model="password" type="text" readonly class="form-input password-input" placeholder="Generated passphrase will appear here..." />
        <button @click="copyPassword" class="copy-btn" title="Copy to clipboard">📋</button>
      </div>

      <div v-if="notification.show" :class="['notification', notification.type]">{{ notification.message }}</div>
    </div>
  `
}

// Main App Component
const App = {
  name: 'App',
  components: {
    SimplePassword,
    WordsPassword,
    NumbersPassword,
    Passphrase
  },
  data() {
    return {
      activeTab: 0,
      tabs: [
        { id: 1, name: 'Simple', component: 'SimplePassword' },
        { id: 2, name: 'Words', component: 'WordsPassword' },
        { id: 3, name: 'Numbers', component: 'NumbersPassword' },
        { id: 4, name: 'Passphrase', component: 'Passphrase' }
      ]
    }
  },
  template: `
    <div id="app">
      <header class="header">
        <div class="container">
          <h1 class="title">🔐 Password Generator</h1>
          <p class="subtitle">Generate secure passwords with multiple customization options</p>
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