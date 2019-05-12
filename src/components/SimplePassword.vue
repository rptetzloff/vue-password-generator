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
                                        min="6"
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
                    <div>Character Sets</div>
                </template>
                <v-card>
                    <v-card-text class="grey lighten-3">
                        <v-layout row wrap>
                            <v-flex xs12>
                                <v-switch
                                        v-model="lowerCase"
                                        label="Lower Case Letters"
                                ></v-switch>
                            </v-flex>
                        </v-layout>

                        <v-layout row wrap>
                            <v-flex xs12>
                                <v-switch
                                        v-model="upperCase"
                                        label="Upper Case Letters"
                                ></v-switch>
                            </v-flex>
                        </v-layout>

                        <v-layout row wrap>
                            <v-flex xs12>
                                <v-switch
                                        v-model="digits"
                                        label="Digits"
                                ></v-switch>
                            </v-flex>
                        </v-layout>

                        <v-layout row wrap>
                            <v-flex xs12>
                                <v-switch
                                        v-model="specialChars"
                                        label="Symbols"
                                ></v-switch>
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
        name: 'SimplePassword.vue',
        data: function () {
            return {
                panel: [true, false],
                passwordLength: 20,
                lowerCase: 1,
                upperCase: 1,
                digits: 1,
                specialChars: 1,
                password: '',
                sb_state: false,
                sb_color: 'info',
                sb_mode: '',
                sb_timeout: 5000,
                sb_text: 'Password copied to clipboard.',
                characterSetLower: 'abcdefghijklmnopqrstuvwxyz',
                characterSetUpper: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
                characterSetNumbers: '0123456789',
                characterSetSpecialChars: '!#$%&()*+,-./:;<=>?@[]^_`{|}~'
            };
        },
        methods: {
            generatePassword: function () {
                let passwordFormula = '';
                let usedSmallLetters = 0;
                let usedCapitalLetters = 0;
                let usedNumbers = 0;
                let usedSpecialChars = 0;
                for (let i = 0; i < this.passwordLength; i++) {
                    let characterClass = '';
                    if (this.lowerCase + this.upperCase + this.digits + this.specialChars === 0) {
                        this.sb_text = "You must select at least one character class.";
                        this.sb_color = 'error';
                        this.sb_state = true;
                    } else if (this.lowerCase + this.upperCase + this.digits + this.specialChars <= this.passwordLength) {
                        if (Number(this.lowerCase) > usedSmallLetters) {
                            characterClass += 'l';
                        } else if (Number(this.upperCase) > usedCapitalLetters) {
                            characterClass += 'u';
                        } else if (Number(this.digits) > usedNumbers) {
                            characterClass += 'd';
                        } else if (Number(this.specialChars) > usedSpecialChars) {
                            characterClass += 's';
                        } else {

                            if (Number(this.lowerCase) > 0) {
                                characterClass += 'l'.repeat(this.characterSetLower.length);
                            }
                            if (Number(this.upperCase) > 0) {
                                characterClass += 'u'.repeat(this.characterSetUpper.length);
                            }
                            if (Number(this.digits) > 0) {
                                characterClass += 'd'.repeat(this.characterSetNumbers.length);
                            }
                            if (Number(this.specialChars) > 0) {
                                characterClass += 's'.repeat(this.characterSetSpecialChars.length);
                            }
                        }
                        let characterType = characterClass.charAt(Math.floor(Math.random() * characterClass.length));
                        switch (characterType) {
                            case 'l':
                                passwordFormula += characterType;
                                usedSmallLetters += 1;
                                break;
                            case 'u':
                                passwordFormula += characterType;
                                usedCapitalLetters += 1;
                                break;
                            case 'd':
                                passwordFormula += characterType;
                                usedNumbers += 1;
                                break;
                            case 's':
                                passwordFormula += characterType;
                                usedSpecialChars += 1;
                                break;
                        }
                    } else {
                        this.sb_text = "Password requirements do not make sense.";
                        this.sb_color = 'error';
                        this.sb_state = true;
                    }
                }

                let generatedPassword = '';
                for (let i = 0; i < this.passwordLength; i++) {
                    let characterIndex = Math.floor(Math.random() * passwordFormula.length);
                    let characterClass = passwordFormula.charAt(characterIndex);
                    passwordFormula = passwordFormula.substring(0, characterIndex) + passwordFormula.substring(characterIndex + 1, passwordFormula.length);
                    switch (characterClass) {
                        case 'l':
                            generatedPassword += this.characterSetLower.charAt(Math.floor(Math.random() * this.characterSetLower.length));
                            break;
                        case 'u':
                            generatedPassword += this.characterSetUpper.charAt(Math.floor(Math.random() * this.characterSetUpper.length));
                            break;
                        case 'd':
                            generatedPassword += this.characterSetNumbers.charAt(Math.floor(Math.random() * this.characterSetNumbers.length));
                            break;
                        case 's':
                            generatedPassword += this.characterSetSpecialChars.charAt(Math.floor(Math.random() * this.characterSetSpecialChars.length));
                            break;
                    }
                }

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