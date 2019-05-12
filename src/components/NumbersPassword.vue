<template>
    <v-container grid-list-lg>
        <v-expansion-panel v-model="panel" expand>
            <v-expansion-panel-content readonly hide-actions>
                <template v-slot:header>
                    <div>Number of Characters</div>
                </template>
                <v-card>
                    <v-card-text class="grey lighten-3">
                        <v-layout row wrap>
                            <v-flex xs10 md11 shrink>
                                <v-slider
                                        v-model="passwordLength"
                                        label=""
                                        min="4"
                                        max="128"
                                        thumb-label
                                ></v-slider>
                            </v-flex>

                            <v-flex
                                    xs2 md1
                            >
                                <v-text-field
                                        v-model="passwordLength"
                                        class="mt-0"
                                        hide-details
                                        single-line
                                        type="number"
                                ></v-text-field>
                            </v-flex>
                        </v-layout>
                    </v-card-text>
                </v-card>
            </v-expansion-panel-content>

            <v-expansion-panel-content>
                <template v-slot:header>
                    <div>Maximum Repeated Digits</div>
                </template>
                <v-card>
                    <v-card-text class="grey lighten-3">
                        <v-layout row wrap>
                            <v-flex xs10 md11 shrink>
                                <v-slider
                                        v-model="maxRepeatedDigits"
                                        label=""
                                        min="2"
                                        max="5"
                                        thumb-label
                                ></v-slider>
                            </v-flex>

                            <v-flex
                                    xs2 md1
                            >
                                <v-text-field
                                        v-model="maxRepeatedDigits"
                                        class="mt-0"
                                        single-line
                                        type="number"
                                ></v-text-field>
                            </v-flex>
                        </v-layout>
                    </v-card-text>
                </v-card>
            </v-expansion-panel-content>

            <v-expansion-panel-content>
                <template v-slot:header>
                    <div>Maximum Sequential Digits</div>
                </template>
                <v-card>
                    <v-card-text class="grey lighten-3">
                        <v-layout row wrap>
                            <v-flex xs10 md11 shrink>
                                <v-slider
                                        v-model="maxSequentialDigits"
                                        label=""
                                        min="2"
                                        max="5"
                                        thumb-label
                                ></v-slider>
                            </v-flex>

                            <v-flex
                                    xs2 md1
                            >
                                <v-text-field
                                        v-model="maxSequentialDigits"
                                        class="mt-0"
                                        single-line
                                        type="number"
                                ></v-text-field>
                            </v-flex>
                        </v-layout>
                    </v-card-text>
                </v-card>
            </v-expansion-panel-content>
        </v-expansion-panel>


        <v-layout row wrap>
            <v-flex xs12>
                <v-btn color="info" @click="generatePassword">Generate Password</v-btn>
            </v-flex>
        </v-layout>

        <v-layout row wrap>
            <v-flex xs12>
                <v-text-field
                        label="Password"
                        v-model="password"
                        outline
                        readonly
                        full-width
                        append-outer-icon="mdi-content-copy"
                        @click:append-outer="doCopy"
                ></v-text-field>
            </v-flex>
        </v-layout>

        <v-snackbar
                v-model="sb_state"
                :color="sb_color"
                :timeout="sb_timeout"
        >
            {{ sb_text }}
            <v-btn
                    dark
                    flat
                    @click="sb_state = false"
            >
                Close
            </v-btn>
        </v-snackbar>
    </v-container>
</template>

<script>
    export default {
        name: 'NumbersPassword.vue',
        data: function () {
            return {
                panel: [true, false, false],
                maxRepeatedDigits: 3,
                maxSequentialDigits: 3,
                passwordLength: 8,
                password: '',
                sb_state: false,
                sb_color: 'info',
                sb_mode: '',
                sb_timeout: 5000,
                sb_text: 'Password copied to clipboard.'
            };
        },
        methods: {
            generatePassword: function () {
                let generatedPassword = '';
                let defaultCharacterSet = '0123456789';

                let repeatedDigits = 0;
                let sequentialDigits = 0;
                let sequencing = 'none';

                //  We need to assign a temporary character set to allow repeated and sequential checks to work properly.
                let characterSet = defaultCharacterSet;

                for (let i = 0; i < this.passwordLength; i++) {
                    //  Let's define lastNumber to make this easier to deal with.
                    let lastNumber = generatedPassword.slice(-1);

                    //  If repeated digit limit is reached, remove the previously selected digit from character set.
                    if (repeatedDigits >= this.maxRepeatedDigits) {
                        characterSet = characterSet.replace(lastNumber, '');
                    }

                    //  If sequential digit limit is reached, remove the next in sequence digit from character set.
                    if (sequentialDigits >= this.maxSequentialDigits) {
                        //  If sequence is ascending, remove the next higher digit.
                        //  If sequence is descending, remove the next lower digit.
                        let nextInSequence = sequencing === "ascending" ? Number(lastNumber) + 1 : Number(lastNumber) - 1;
                        //  In order to maths, nextInSequence is an integer. Let's convert to string to remove from character set.
                        nextInSequence = nextInSequence.toString();
                        characterSet = characterSet.replace(nextInSequence, '');
                    }

                    let randomNumber = characterSet[Math.floor(Math.random() * characterSet.length)];

                    if (randomNumber === lastNumber) {
                        repeatedDigits += 1;
                        sequentialDigits = 1;
                        sequencing = 'none';
                    } else if (Number(randomNumber) === lastNumber + 1) {
                        //  Is the newly selected number is one higher than the last selected number,
                        //  we need to determine if there was already an ascending sequence.
                        if (sequencing !== "ascending") {
                            //  If not, reset sequential digit count to 1
                            sequentialDigits = 1;
                        }
                        //  Let's keep track of an ascending sequence, and increment sequential digit count.
                        sequencing = "ascending";
                        repeatedDigits = 1;
                        sequentialDigits += 1;
                    } else if (Number(randomNumber) === lastNumber - 1) {
                        //  Is the newly selected number is one lower than the last selected number,
                        //  we need to determine if there was already a descending sequence.
                        if (sequencing !== "descending") {
                            //  If not, reset sequential digit count to 1
                            sequentialDigits = 1;
                        }
                        //  Is the newly selected number is one lower than the last selected number,
                        //  we need to determine if there was already a descending sequence.
                        sequencing = "descending";
                        repeatedDigits = 1;
                        sequentialDigits += 1;
                    } else {
                        //  If not sequential or repeated, let's reset the variables.
                        repeatedDigits = 1;
                        sequentialDigits = 1;
                        sequencing = 'none';
                    }

                    //  Let's add the number to the password!
                    generatedPassword += randomNumber;

                    //  Restore character set to the default.
                    characterSet = defaultCharacterSet;
                }

                //  Set the password to display in the password box.
                this.password = generatedPassword;
            },
            doCopy: function () {
                let vm = this;
                this.$copyText(this.password).then(function () {
                    vm.sb_color = "info";
                    vm.sb_text = 'Password copied to clipboard.';
                    vm.sb_state = true;
                }, function () {
                    vm.sb_color = "error";
                    vm.sb_text = 'Can not copy password to clipboard.';
                    vm.sb_state = true;
                });
            }
        }
    };
</script>

<style lang="scss" scoped>

</style>