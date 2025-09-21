<template>
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
          <input v-model="separator" value="_" type="radio" class="radio" />
          <span>Underscore</span>
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
      <button @click="generatePassword" class="btn btn-primary">
        🎲 Generate Passphrase
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
</template>

<script>
import nounsText from '../../data/nouns.txt?raw'
import verbsText from '../../data/verbs.txt?raw'
import adjectivesText from '../../data/adjectives.txt?raw'

export default {
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
      notification: {
        show: false,
        message: '',
        type: 'success'
      },
      wordLists: {
        nouns: [],
        verbs: [],
        adjectives: []
      },
      specialChars: '!#$%&*+-/:;=?@^_|~',
      numbers: '0123456789'
    }
  },
  
  created() {
    this.loadWordLists()
  },
  
  methods: {
    loadWordLists() {
      try {
        this.wordLists.nouns = nounsText.split(',').map(word => word.trim()).filter(word => word.length > 0)
        this.wordLists.verbs = verbsText.split(',').map(word => word.trim()).filter(word => word.length > 0)
        this.wordLists.adjectives = adjectivesText.split(',').map(word => word.trim()).filter(word => word.length > 0)
        console.log('Loaded word lists:', this.wordLists.nouns.length, 'nouns,', this.wordLists.verbs.length, 'verbs,', this.wordLists.adjectives.length, 'adjectives')
      } catch (err) {
        console.error('Failed to load word lists:', err)
        // Fallback word lists
        this.wordLists.nouns = ['house', 'car', 'tree', 'book', 'phone', 'computer', 'table', 'chair']
        this.wordLists.verbs = ['run', 'jump', 'walk', 'talk', 'think', 'write', 'read', 'play']
        this.wordLists.adjectives = ['big', 'small', 'fast', 'slow', 'happy', 'sad', 'bright', 'dark']
      }
    },
    
    generatePassword() {
      if (!this.includeAdjective && !this.includeNoun && !this.includeVerb) {
        this.showNotification('Please select at least one word type', 'error')
        return
      }

      const words = []
      
      // Add words based on selection
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

      // Determine separator
      let sep = this.separator
      if (this.separator === 'random') {
        sep = this.specialChars.charAt(Math.floor(Math.random() * this.specialChars.length))
      }

      let passphrase = words.join(sep)

      // Add prefix/suffix
      let prefix = ''
      let suffix = ''
      
      if (this.addNumbers) {
        prefix += this.numbers.charAt(Math.floor(Math.random() * this.numbers.length)) +
                  this.numbers.charAt(Math.floor(Math.random() * this.numbers.length))
      }
      
      if (this.addSymbols) {
        const symbol = this.specialChars.charAt(Math.floor(Math.random() * this.specialChars.length))
        prefix += symbol + symbol
        suffix = symbol + symbol + suffix
      }
      
      if (this.addNumbers) {
        suffix = this.numbers.charAt(Math.floor(Math.random() * this.numbers.length)) +
                 this.numbers.charAt(Math.floor(Math.random() * this.numbers.length)) + suffix
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
      setTimeout(() => {
        this.notification.show = false
      }, 3000)
    }
  },
  
  mounted() {
    this.generatePassword()
  }
}
</script>

<style scoped>
.password-generator {
  padding: 1.5rem;
}
</style>