import 'vuetify/dist/vuetify.min.css';
import '@mdi/font/css/materialdesignicons.css';
import Vue from 'vue';
import Vuetify from 'vuetify';
import VueClipboard from 'vue-clipboard2';
import VuePasswordGenerator from './VuePasswordGenerator.vue';

Vue.config.productionTip = false;
VueClipboard.config.autoSetContainer = true;
Vue.use(VueClipboard);
Vue.use(Vuetify, {
    iconfont: 'mdi'
});

new Vue({
    render: h => h(VuePasswordGenerator)
}).$mount('#app');
