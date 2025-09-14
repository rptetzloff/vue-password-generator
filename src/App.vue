<template>
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
</template>

<script>
import SimplePassword from './components/SimplePassword.vue'
import AdvancedPassword from './components/AdvancedPassword.vue'
import WordsPassword from './components/WordsPassword.vue'
import NumbersPassword from './components/NumbersPassword.vue'
import Passphrase from './components/Passphrase.vue'

export default {
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
        { id: 1, name: 'Simple', component: SimplePassword },
        { id: 2, name: 'Advanced', component: AdvancedPassword },
        { id: 3, name: 'Words', component: WordsPassword },
        { id: 4, name: 'Numbers', component: NumbersPassword },
        { id: 5, name: 'Passphrase', component: Passphrase }
      ]
    }
  }
}
</script>