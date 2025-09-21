<template>
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
          <input v-model="separator" value="random-number" type="radio" class="radio" />
          <span>2 Random Numbers</span>
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
      </div>
      <div v-if="separator === 'other'" class="form-group">
        <input
          v-model="customSeparator"
          type="text"
          class="form-input"
          placeholder="Custom separator"
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
</template>

<script>
import nounsText from '../../data/nouns.txt?raw'

export default {
  name: 'WordsPassword',
  data() {
    return {
      wordCount: 4,
      separator: 'random',
      customSeparator: '',
      capitalization: 'title',
      password: '',
      notification: {
        show: false,
        message: '',
        type: 'success'
      },
      wordList: [],
      specialChars: '!#$%&*+-/:;=?@^_|~',
      numbers: '0123456789'
    }
  },
  
  created() {
    this.loadWordList()
  },
  
  methods: {
    loadWordList() {
      try {
        this.wordList = nounsText.split(',').map(word => word.trim()).filter(word => word.length > 0)
        console.log('Loaded', this.wordList.length, 'words')
      } catch (err) {
        console.error('Failed to load word list:', err)
        // Fallback word list
        this.wordList = ['ability', 'account', 'action', 'active', 'address', 'advance', 'agency', 'agent', 'agree', 'allow', 'amount', 'animal', 'answer', 'appear', 'approach', 'area', 'argue', 'around', 'arrive', 'article', 'artist', 'assume', 'attack', 'attempt', 'attend', 'author', 'avoid', 'balance', 'become', 'before', 'begin', 'believe', 'benefit', 'better', 'between', 'beyond', 'budget', 'build', 'business']
      }
    },
    
    generatePassword() {
      if (this.wordList.length === 0) {
        this.showNotification('Word list not loaded', 'error')
        return
      }

      const words = []
      
      // Generate random words
      for (let i = 0; i < this.wordCount; i++) {
        let word = this.wordList[Math.floor(Math.random() * this.wordList.length)]
        
        // Apply capitalization
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

      // Determine separator
      let sep = ''
      switch (this.separator) {
        case 'random':
          sep = this.specialChars.charAt(Math.floor(Math.random() * this.specialChars.length))
          break
        case 'random-number':
          sep = this.numbers.charAt(Math.floor(Math.random() * this.numbers.length)) +
                this.numbers.charAt(Math.floor(Math.random() * this.numbers.length))
          break
        case 'other':
          sep = this.customSeparator
          break
        default:
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