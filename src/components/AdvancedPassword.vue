<template>
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
</template>

<script>
export default {
  name: 'AdvancedPassword',
  data() {
    return {
      passwordLength: 20,
      lowerCase: [1, 20],
      upperCase: [1, 20],
      digits: [1, 20],
      specialChars: [1, 20],
      customSymbols: '!#$%&()*+,-./:;<=>?@[]^_`{|}~',
      password: '',
      notification: {
        show: false,
        message: '',
        type: 'success'
      },
      characterSets: {
        lower: 'abcdefghijklmnopqrstuvwxyz',
        upper: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
        digits: '0123456789'
      }
    }
  },
  methods: {
    generatePassword() {
      // Validation
      const minTotal = this.lowerCase[0] + this.upperCase[0] + this.digits[0] + this.specialChars[0]
      const maxTotal = this.lowerCase[1] + this.upperCase[1] + this.digits[1] + this.specialChars[1]
      
      if (minTotal > this.passwordLength) {
        this.showNotification('Minimum character requirements exceed password length', 'error')
        return
      }
      
      if (maxTotal < this.passwordLength) {
        this.showNotification('Maximum character limits are less than password length', 'error')
        return
      }

      // Generate password with constraints
      let password = ''
      let remaining = this.passwordLength
      let charTypes = []

      // Add minimum required characters
      for (let i = 0; i < this.lowerCase[0]; i++) {
        charTypes.push('lower')
      }
      for (let i = 0; i < this.upperCase[0]; i++) {
        charTypes.push('upper')
      }
      for (let i = 0; i < this.digits[0]; i++) {
        charTypes.push('digits')
      }
      for (let i = 0; i < this.specialChars[0]; i++) {
        charTypes.push('special')
      }

      // Fill remaining slots randomly within limits
      while (charTypes.length < this.passwordLength) {
        const availableTypes = []
        
        const lowerCount = charTypes.filter(t => t === 'lower').length
        const upperCount = charTypes.filter(t => t === 'upper').length
        const digitCount = charTypes.filter(t => t === 'digits').length
        const specialCount = charTypes.filter(t => t === 'special').length
        
        if (lowerCount < this.lowerCase[1]) availableTypes.push('lower')
        if (upperCount < this.upperCase[1]) availableTypes.push('upper')
        if (digitCount < this.digits[1]) availableTypes.push('digits')
        if (specialCount < this.specialChars[1]) availableTypes.push('special')
        
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
            charset = this.characterSets.lower
            break
          case 'upper':
            charset = this.characterSets.upper
            break
          case 'digits':
            charset = this.characterSets.digits
            break
          case 'special':
            charset = this.customSymbols
            break
        }
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