import { createApp } from 'https://unpkg.com/vue@3/dist/vue.esm-browser.js'

// Define the App component inline since we can't import .vue files directly in browser
const App = {
  name: 'App',
  data() {
    return {
      activeTab: 0,
      tabs: [
        { id: 1, name: 'Simple' },
        { id: 2, name: 'Advanced' },
        { id: 3, name: 'Words' },
        { id: 4, name: 'Numbers' },
        { id: 5, name: 'Passphrase' }
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
            <div v-if="activeTab === 0">Simple Password Generator</div>
            <div v-else-if="activeTab === 1">Advanced Password Generator</div>
            <div v-else-if="activeTab === 2">Words Password Generator</div>
            <div v-else-if="activeTab === 3">Numbers Password Generator</div>
            <div v-else-if="activeTab === 4">Passphrase Generator</div>
          </div>
        </div>
      </main>
    </div>
  `
}

createApp(App).mount('#app')