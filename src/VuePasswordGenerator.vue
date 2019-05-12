<template>
  <v-app>
    <v-content>
      <PasswordTabs/>
    </v-content>
  </v-app>
</template>

<script>
import PasswordTabs from './components/PasswordTabs'

export default {
  name: 'VuePasswordGenerator',
  components: {
    PasswordTabs
  },
  data () {
    return {
      //
    }
  }
}
</script>
