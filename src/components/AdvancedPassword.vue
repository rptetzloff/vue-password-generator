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
                    <div>Lower Case Letters</div>
                </template>
                <v-card>
                    <v-card-text class="grey lighten-3">
                        <v-layout row wrap>
                            <v-flex
                                    xs2 md1
                            >
                                <v-text-field
                                        v-model="lowerCase[0]"
                                        class="mt-0"
                                        single-line
                                        type="number"
                                        hint="min"
                                        persistent-hint
                                ></v-text-field>
                            </v-flex>

                            <v-flex xs8 md10 shrink>
                                <v-range-slider
                                        v-model="lowerCase"
                                        label=""
                                        min="0"
                                        max="128"
                                        thumb-label
                                ></v-range-slider>
                            </v-flex>

                            <v-flex
                                    xs2 md1
                            >
                                <v-text-field
                                        v-model="lowerCase[1]"
                                        class="mt-0"
                                        single-line
                                        type="number"
                                        hint="max"
                                        persistent-hint
                                ></v-text-field>
                            </v-flex>
                        </v-layout>
                    </v-card-text>
                </v-card>
            </v-expansion-panel-content>

            <v-expansion-panel-content>
                <template v-slot:header>
                    <div>Upper Case Letters</div>
                </template>
                <v-card>
                    <v-card-text class="grey lighten-3">
                        <v-layout row wrap>
                            <v-flex
                                    shrink
                                    xs2 sm1
                            >
                                <v-text-field
                                        v-model="upperCase[0]"
                                        class="mt-0"
                                        hint="min"
                                        persistent-hint
                                        single-line
                                        type="number"
                                ></v-text-field>
                            </v-flex>

                            <v-flex xs8 md10 shrink>
                                <v-range-slider
                                        v-model="upperCase"
                                        label=""
                                        min="0"
                                        max="128"
                                        thumb-label
                                        always-dirty
                                ></v-range-slider>
                            </v-flex>

                            <v-flex
                                    xs2 md1
                            >
                                <v-text-field
                                        v-model="upperCase[1]"
                                        class="mt-0"
                                        hint="max"
                                        persistent-hint
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
                    <div>Numbers</div>
                </template>
                <v-card>
                    <v-card-text class="grey lighten-3">
                        <v-layout row wrap>
                            <v-flex
                                    xs2 md1
                            >
                                <v-text-field
                                        v-model="digits[0]"
                                        class="mt-0"
                                        hint="min"
                                        persistent-hint
                                        single-line
                                        type="number"
                                ></v-text-field>
                            </v-flex>

                            <v-flex xs8 md10 shrink>
                                <v-range-slider
                                        v-model="digits"
                                        label=""
                                        min="0"
                                        max="128"
                                        thumb-label
                                ></v-range-slider>
                            </v-flex>

                            <v-flex
                                    xs2 md1
                            >
                                <v-text-field
                                        v-model="digits[1]"
                                        class="mt-0"
                                        hint="max"
                                        persistent-hint
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
                    <div>Symbols</div>
                </template>
                <v-card>
                    <v-card-text class="grey lighten-3">
                        <v-layout row wrap>
                            <v-flex
                                    xs2 md1
                            >
                                <v-text-field
                                        v-model="specialChars[0]"
                                        class="mt-0"
                                        hint="min"
                                        persistent-hint
                                        single-line
                                        type="number"
                                ></v-text-field>
                            </v-flex>

                            <v-flex xs8 md10 shrink>
                                <v-range-slider
                                        v-model="specialChars"
                                        label=""
                                        min="0"
                                        max="128"
                                        thumb-label
                                ></v-range-slider>
                            </v-flex>

                            <v-flex
                                    xs2 md1
                            >
                                <v-text-field
                                        v-model="specialChars[1]"
                                        class="mt-0"
                                        hint="max"
                                        persistent-hint
                                        single-line
                                        type="number"
                                ></v-text-field>
                            </v-flex>

                            <v-flex xs12>
                                <v-text-field
                                        v-model="characterSetSpecialChars"
                                        label="Valid Special Characters"
                                        placeholder="Placeholder"
                                        hint="A list of valid characters to use as the Special Character set. Any spaces used will be considered a possible character in the password. e.g.: !@#$%^&*()"
                                        append-outer-icon="mdi-restore"
                                        @click:append-outer="resetSpecialCharacterSet"
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
        name: 'AdvancedPassword.vue',
        data: function () {
            return {
                panel: [true, false, false, false, false],
                passwordLength: 20,
                lowerCase: [1, 128],
                upperCase: [1, 128],
                digits: [1, 128],
                specialChars: [1, 128],
                password: '',
                sb_state: false,
                sb_color: 'info',
                sb_mode: '',
                sb_timeout: 5000,
                sb_text: 'Password copied to clipboard.',
                characterSetLower: 'abcdefghijklmnopqrstuvwxyz',
                characterSetUpper: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
                characterSetNumbers: '0123456789',
                defaultCharacterSetSpecialChars: '!#$%&()*+,-./:;<=>?@[]^_`{|}~',
                characterSetSpecialChars: '!#$%&()*+,-./:;<=>?@[]^_`{|}~'
            };
        },
        methods: {
            resetSpecialCharacterSet: function () {
                this.characterSetSpecialChars = this.defaultCharacterSetSpecialChars;
            },
            generatePassword: function () {
                let passwordFormula = '';
                let usedSmallLetters = 0;
                let usedCapitalLetters = 0;
                let usedNumbers = 0;
                let usedSpecialChars = 0;
                for (let i = 0; i < this.passwordLength; i++) {
                    let characterClass = '';
                    if (this.specialChars[0] > 0 && this.characterSetSpecialChars === '') {
                        this.sb_text = "Special characters are required, but none are permitted.";
                        this.sb_color = 'error';
                        this.sb_state = true;
                    } else if (this.lowerCase[1] + this.upperCase[1] + this.digits[1] + this.specialChars[1] < this.passwordLength) {
                        this.sb_text = "You must allow at least " + this.passwordLength + " characters in the password.";
                        this.sb_color = 'error';
                        this.sb_state = true;
                    } else if (this.lowerCase[0] + this.upperCase[0] + this.digits[0] + this.specialChars[0] <= this.passwordLength) {
                        if (this.lowerCase[0] > usedSmallLetters) {
                            characterClass += 'l';
                        } else if (this.upperCase[0] > usedCapitalLetters) {
                            characterClass += 'u';
                        } else if (this.digits[0] > usedNumbers) {
                            characterClass += 'd';
                        } else if (this.specialChars[0] > usedSpecialChars) {
                            characterClass += 's';
                        } else {

                            if (usedSmallLetters < this.lowerCase[1]) {
                                characterClass += 'l'.repeat(this.characterSetLower.length);
                            }
                            if (usedCapitalLetters < this.upperCase[1]) {
                                characterClass += 'u'.repeat(this.characterSetUpper.length);
                            }
                            if (usedNumbers < this.digits[1]) {
                                characterClass += 'd'.repeat(this.characterSetNumbers.length);
                            }
                            if (usedSpecialChars < this.specialChars[1]) {
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
                    } else if (this.lowerCase[0] + this.upperCase[0] + this.digits[0] + this.specialChars[0] > this.passwordLength) {
                        this.sb_text = "Minimum total character count must be less than or equal to password length of " + this.passwordLength + ".";
                        this.sb_color = 'error';
                        this.sb_state = true;
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