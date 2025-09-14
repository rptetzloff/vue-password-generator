<template>
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
</template>

<script>
export default {
  name: 'NumbersPassword',
  data() {
    return {
      passwordLength: 8,
      maxRepeated: 3,
      maxSequential: 3,
      password: '',
      notification: {
        show: false,
        message: '',
        type: 'success'
      }
    }
  },
  
  methods: {
    generatePassword() {
      let password = ''
      let repeatedCount = 0
      let sequentialCount = 0
      let sequenceDirection = null // 'up', 'down', or null
      
      for (let i = 0; i < this.passwordLength; i++) {
        let availableDigits = '0123456789'
        const lastDigit = password.slice(-1)
        
        if (lastDigit) {
          const lastNum = parseInt(lastDigit)
          
          // Remove digits that would exceed repeat limit
          if (repeatedCount >= this.maxRepeated) {
            availableDigits = availableDigits.replace(lastDigit, '')
          }
          
          // Remove digits that would exceed sequential limit
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