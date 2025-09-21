export default {
  name: 'SimplePassword',
  data() {
    return {
      passwordLength: 20,
      lowerCase: true,
      upperCase: true,
      digits: true,
      specialChars: true,
      password: '',
      notification: {
        show: false,
        message: '',
        type: 'success'
      },
      characterSets: {
        lower: 'abcdefghijklmnopqrstuvwxyz',
        upper: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
        digits: '0123456789',
        special: '!#$%&()*+,-./:;<=>?@[]^_`{|}~'
      }
    }
  },
  methods: {
    generatePassword() {
      if (!this.lowerCase && !this.upperCase && !this.digits && !this.specialChars) {
        this.showNotification('Please select at least one character type', 'error')
        return
      }

      let charset = ''
      if (this.lowerCase) charset += this.characterSets.lower
      if (this.upperCase) charset += this.characterSets.upper
      if (this.digits) charset += this.characterSets.digits
      if (this.specialChars) charset += this.characterSets.special

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
      setTimeout(() => {
        this.notification.show = false
      }, 3000)
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
  `,
  
  style: `
    .password-generator {
      padding: 1.5rem;
    }
  `
}