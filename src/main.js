import { createApp } from 'https://unpkg.com/vue@3/dist/vue.esm-browser.prod.js'

// Import components as plain JavaScript
import SimplePassword from './components/SimplePassword.js'
import AdvancedPassword from './components/AdvancedPassword.js'
import WordsPassword from './components/WordsPassword.js'
import NumbersPassword from './components/NumbersPassword.js'
import Passphrase from './components/Passphrase.js'

const App = {
  name: 'App',
  components: {
    SimplePassword,
    AdvancedPassword,
    WordsPassword,
    NumbersPassword,
    Passphrase
  },
  data() {
    return {
      activeTab: 0,
      tabs: [
        { id: 1, name: 'Simple', component: 'SimplePassword' },
        { id: 2, name: 'Advanced', component: 'AdvancedPassword' },
        { id: 3, name: 'Words', component: 'WordsPassword' },
        { id: 4, name: 'Numbers', component: 'NumbersPassword' },
        { id: 5, name: 'Passphrase', component: 'Passphrase' }
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