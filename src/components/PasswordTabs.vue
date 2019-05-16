<template>
    <div>
        <v-tabs
                v-model="tabs"
                color="blue"
                dark
                slider-color="yellow"
                centered
                fixed-tabs
        >
            <v-tab ripple
                   v-for="c in componentsList"
                   :key="c.id">
                {{ c.name }}
            </v-tab>
        </v-tabs>

        <v-tabs-items v-model="tabs" touchless>
            <v-tab-item
                    v-for="c in componentsList"
                    :key="c.id">
                <component v-bind:is="c.component"></component>
            </v-tab-item>
        </v-tabs-items>
    </div>
</template>

<script>
    import SimplePassword from './SimplePassword';
    import AdvancedPassword from './AdvancedPassword';
    import WordsPassword from './WordsPassword';
    import NumbersPassword from './NumbersPassword';
    import Passphrase from './Passphrase';

    export default {
        name: "PasswordTabs",
        components: {
            SimplePassword,
            AdvancedPassword,
            WordsPassword,
            NumbersPassword,
            Passphrase
        },
        data: function () {
            return {
                componentsList: [
                    {'name': 'Simple', 'component': SimplePassword, 'id': 1},
                    {'name': 'Advanced', 'component': AdvancedPassword, 'id': 2},
                    {'name': 'Words', 'component': WordsPassword, 'id': 3},
                    {'name': 'Numbers', 'component': NumbersPassword, 'id': 4},
                    {'name': 'Passphrase', 'component': Passphrase, 'id': 5}
                ],
                tabs: null
            };
        }
    };
</script>

<style scoped>

</style>