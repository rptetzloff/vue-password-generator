<template>
    <v-container grid-list-lg>
        <v-expansion-panel v-model="panel" expand>
            <v-expansion-panel-content readonly hide-actions>
                <template v-slot:header>
                    <div>Number of Words</div>
                </template>
                <v-card>
                    <v-card-text class="grey lighten-3">
                        <v-layout row wrap>
                            <v-flex xs10 md11 shrink>
                                <v-slider
                                        v-model="passwordLength"
                                        label=""
                                        min="2"
                                        max="20"
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
                    <div>Word Separator</div>
                </template>
                <v-card>
                    <v-card-text class="grey lighten-3">
                        <v-layout row wrap>
                            <v-flex xs12>
                                <v-radio-group v-model="separator" label="" row>
                                    <v-layout row wrap>

                                        <v-flex d-flex xs12 sm6 md3>
                                            <v-radio value="" label="None">
                                            </v-radio>
                                        </v-flex>

                                        <v-flex d-flex xs12 sm6 md3>
                                            <v-radio value="random" label="Random Symbol">
                                            </v-radio>
                                        </v-flex>

                                        <v-flex d-flex xs12 sm6 md3>
                                            <v-radio value="random-number" label="2 Random Numbers">
                                            </v-radio>
                                        </v-flex>

                                        <v-flex d-flex xs12 sm6 md3>
                                            <v-radio value=" " label="Space">
                                            </v-radio>
                                        </v-flex>

                                        <v-flex d-flex xs12 sm6 md3>
                                            <v-radio value="-" label="Hyphen">
                                            </v-radio>
                                        </v-flex>

                                        <v-flex d-flex xs12 sm6 md3>
                                            <v-radio value="+" label="Plus">
                                            </v-radio>
                                        </v-flex>

                                        <v-flex d-flex xs12 sm6 md3>
                                            <v-radio value="=" label="Equals">
                                            </v-radio>
                                        </v-flex>

                                        <v-flex d-flex xs12 sm6 md3>
                                            <v-radio value="|" label="Pipe">
                                            </v-radio>
                                        </v-flex>

                                        <v-flex d-flex xs12 sm6 md3>
                                            <v-radio value="," label="Comma">
                                            </v-radio>
                                        </v-flex>

                                        <v-flex d-flex xs12 sm6 md3>
                                            <v-radio value="." label="Period">
                                            </v-radio>
                                        </v-flex>

                                        <v-flex d-flex xs12 sm6 md3>
                                            <v-radio value=":" label="Colon">
                                            </v-radio>
                                        </v-flex>

                                        <v-flex d-flex xs12 sm6 md3>
                                            <v-radio value="*" label="Asterisk">
                                            </v-radio>
                                        </v-flex>

                                        <v-flex d-flex xs12 sm6 md3>
                                            <v-radio value="_" label="Underscore">
                                            </v-radio>
                                        </v-flex>

                                        <v-flex d-flex xs12 sm6 md3>
                                            <v-radio value="$" label="Dollar Sign">
                                            </v-radio>
                                        </v-flex>

                                        <v-flex d-flex xs12 md6 lg4>
                                            <v-radio value="other" label="Other">
                                            </v-radio>

                                            <v-text-field
                                                    v-model="separatorOther"
                                                    :disabled="separator !== 'other'"
                                                    hint="This can be any string. e.g.: !@# $%^ abc 123 . / @!#!@#)_(ASD()_ADS"
                                                    single-line
                                            ></v-text-field>
                                        </v-flex>
                                    </v-layout>
                                </v-radio-group>
                            </v-flex>
                        </v-layout>
                    </v-card-text>
                </v-card>
            </v-expansion-panel-content>

            <v-expansion-panel-content>
                <template v-slot:header>
                    <div>Capitalization</div>
                </template>
                <v-card>
                    <v-card-text class="grey lighten-3">
                        <v-layout row wrap>
                            <v-flex xs12>
                                <v-radio-group v-model="capitalization" label="" row>
                                    <v-layout row wrap>

                                        <v-flex d-flex xs12 sm6 md4>
                                            <v-radio value="title" label="Capitalize Words">
                                            </v-radio>
                                        </v-flex>

                                        <v-flex d-flex xs12 sm6 md4>
                                            <v-radio value="none" label="all lower case">
                                            </v-radio>
                                        </v-flex>

                                        <v-flex d-flex xs12 sm6 md4>
                                            <v-radio value="upper" label="ALL WORDS CAPITALIZED">
                                            </v-radio>
                                        </v-flex>

                                        <v-flex d-flex xs12 sm6 md4>
                                            <v-radio value="random" label="rAndOM LettErS">
                                            </v-radio>
                                        </v-flex>

                                        <v-flex d-flex xs12 sm6 md4>
                                            <v-radio value="alternating" label="alternating WORDS">
                                            </v-radio>
                                        </v-flex>

                                        <v-flex d-flex xs12 sm6 md4>
                                            <v-radio value="alternating-letters" label="aLtErNaTiNg lEtTeRs">
                                            </v-radio>
                                        </v-flex>
                                    </v-layout>

                                </v-radio-group>
                            </v-flex>
                        </v-layout>
                    </v-card-text>
                </v-card>
            </v-expansion-panel-content>

            <v-expansion-panel-content>
                <template v-slot:header>
                    <div>Prefix</div>
                </template>
                <v-card>
                    <v-card-text class="grey lighten-3">
                        <v-layout row wrap>
                            <v-flex xs12>
                                <v-radio-group v-model="prefix" label="" row>
                                    <v-layout row wrap>

                                        <v-flex d-flex xs12 sm6 md3>
                                            <v-radio value="" label="None">
                                            </v-radio>
                                        </v-flex>

                                        <v-flex d-flex xs12 sm6 md3>
                                            <v-radio value="random-symbol" label="2 Random Symbols">
                                            </v-radio>
                                        </v-flex>

                                        <v-flex d-flex xs12 sm6 md3>
                                            <v-radio value="random-number" label="2 Random Numbers">
                                            </v-radio>
                                        </v-flex>

                                        <v-flex d-flex xs12 sm6 md3>
                                            <v-radio value="symbol-number" label="Symbol and Number">
                                            </v-radio>
                                        </v-flex>

                                        <v-flex d-flex xs12 sm6 md3>
                                            <v-radio value="2symbols-2numbers" label="2 Symbols and 2 Numbers">
                                            </v-radio>
                                        </v-flex>

                                        <v-flex d-flex xs12 md6 lg4>
                                            <v-radio value="other" label="Other">
                                            </v-radio>

                                            <v-text-field
                                                    v-model="prefixOther"
                                                    :disabled="prefix !== 'other'"
                                                    hint="This can be any string. e.g.: !@# $%^ abc 123 . / @!#!@#)_(ASD()_ADS"
                                                    single-line
                                            ></v-text-field>
                                        </v-flex>
                                    </v-layout>
                                </v-radio-group>
                            </v-flex>
                        </v-layout>

                    </v-card-text>
                </v-card>
            </v-expansion-panel-content>

            <v-expansion-panel-content>
                <template v-slot:header>
                    <div>Suffix</div>
                </template>
                <v-card>
                    <v-card-text class="grey lighten-3">
                        <v-layout row wrap>
                            <v-flex xs12>
                                <v-radio-group v-model="suffix" label="" row>
                                    <v-layout row wrap>

                                        <v-flex d-flex xs12 sm6 md3>
                                            <v-radio value="" label="None">
                                            </v-radio>
                                        </v-flex>

                                        <v-flex d-flex xs12 sm6 md3>
                                            <v-radio value="prefix"
                                                     :disabled="prefix === ''"
                                                     label="Reversed Prefix">
                                            </v-radio>
                                        </v-flex>

                                        <v-flex d-flex xs12 sm6 md3>
                                            <v-radio value="random-symbol" label="2 Random Symbols">
                                            </v-radio>
                                        </v-flex>

                                        <v-flex d-flex xs12 sm6 md3>
                                            <v-radio value="random-number" label="2 Random Numbers">
                                            </v-radio>
                                        </v-flex>

                                        <v-flex d-flex xs12 sm6 md3>
                                            <v-radio value="symbol-number" label="Symbol and Number">
                                            </v-radio>
                                        </v-flex>

                                        <v-flex d-flex xs12 sm6 md3>
                                            <v-radio value="2symbols-2numbers" label="2 Symbols and 2 Numbers">
                                            </v-radio>
                                        </v-flex>

                                        <v-flex d-flex xs12 md6 lg4>
                                            <v-radio value="other" label="Other">
                                            </v-radio>

                                            <v-text-field
                                                    v-model="suffixOther"
                                                    :disabled="suffix !== 'other'"
                                                    hint="This can be any string. e.g.: !@# $%^ abc 123 . / @!#!@#)_(ASD()_ADS"
                                                    single-line
                                            ></v-text-field>
                                        </v-flex>

                                    </v-layout>

                                </v-radio-group>
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
    /*  Use raw-loader to load the word list as text from data folder.   */
    import txt from '../../data/wordlist.txt?raw';

    export default {
        name: 'WordsPassword.vue',
        data: function () {
            return {
                panel: [true, false, false, false, false],
                passwordLength: 4,                              // The number of words in the password. (Default = 4)
                separator: 'random',                            // How to separate the words in the password. (Default = random)
                separatorOther: '',                             // If separator is other, manually specify what to set. (Default is empty)
                prefix: '2symbols-2numbers',                    // A string to prepend to the generated password. E.g. <%%45>CorrectHorseBatteryStaple
                                                                // Default is to use 2 like symbols and 2 randomly generated numbers, i.e. %%45
                prefixOther: '',                                // If prefix is other, manually specify what to set. (Default is empty)
                suffix: 'prefix',                               // A string to append to the generated password. E.g. %%45CorrectHorseBatteryStaple<54%%>
                                                                // Default is to reverse the prefix. If prefix is %%45, then suffix is 54%%
                suffixOther: '',                                // If suffix is other, manually specify what to set. (Default is empty)
                password: '',                                   // The generated password
                capitalization: 'title',                        // Capitalization schema to use. (Default is Title Casing)
                sb_state: false,                                // Snackbar enabled for error messaging.
                sb_color: 'info',                               // The color to use for the snackbar.
                sb_timeout: 5000,                               // The timeout of the snackbar, in ms
                sb_text: '',                                    // A placeholder for the snackbar text.
                characterSetSpecialChars: '!#$%&*+-/:;=?@^_|~', // The character set for special characters in separator, prefix, and suffix options
                characterSetNumbers: '0123456789'               // The character set to use for numbers in separator, prefix, and suffix options
            };
        },
        watch: {
            prefix: function () {
                /*  We don't want suffix to reverse the prefix if there is no prefix selected.
                    Thus, we watch prefix, and we automatically unset suffix if this situation arises.  */
                if (this.prefix === '' && this.suffix === 'prefix') {
                    this.suffix = '';
                }
            }
        },
        methods: {
            generatePassword: function () {
                /*  The main function for generating the password that is displayed.    */

                //  First, we initialize the word list with the words from the word list.
                let wordList = this.loadWordList(txt);

                //  Initialize an array for the password, which will be joined together with separator.
                let generatedPassword = [];

                //  For the alternating words and alternating letters capitalization options,
                // generate a random integer to determine whether even or odd is capitalized.
                let evenOdd = Math.floor(Math.random() * 2);

                //  Initialize an empty string for the password prefix.
                let prefix = '';

                //  A switch/case combo to set prefix based on desired option.
                switch (this.prefix) {
                    case 'random-symbol':
                        //  Generate a double random symbol, e.g. $$ or &&
                        prefix += this.getRandomCharacter(this.characterSetSpecialChars).repeat(2);
                        break;
                    case 'random-number':
                        //  Generate two different random numbers, e.g. 46 or 99 or 03
                        for (let c = 0; c < 2; c++) {
                            prefix += this.getRandomCharacter(this.characterSetNumbers);
                        }
                        break;
                    case 'symbol-number':
                        //  Generate a single random symbol and a single random number, e.g. %5 or ^8
                        prefix += this.getRandomCharacter(this.characterSetSpecialChars);
                        prefix += this.getRandomCharacter(this.characterSetNumbers);
                        break;
                    case '2symbols-2numbers':
                        //  Generate a double random symbol, and two different random numbers
                        //  e.g. $$85 or @@24
                        prefix += this.getRandomCharacter(this.characterSetSpecialChars).repeat(2);
                        for (let c = 0; c < 2; c++) {
                            prefix += this.getRandomCharacter(this.characterSetNumbers);
                        }
                        break;
                    case 'other':
                        //  User specified prefix
                        prefix = this.prefixOther;
                        break;
                }

                //  Initialize an empty string for the password suffix.
                let suffix = '';

                //  Initialize an empty variable for reversing the prefix.
                let _ = [];

                //  A switch/case to set the suffix based on user options.
                switch (this.suffix) {
                    case 'prefix':
                        //  Use the reverse of the prefix, e.g. if prefix is $$46, then suffix is 64$$
                        _ = prefix.split("");
                        _ = _.reverse();
                        suffix = _.join("");
                        break;
                    case 'random-symbol':
                        //  Generate a double random symbol, e.g. $$ or &&
                        suffix += this.getRandomCharacter(this.characterSetSpecialChars).repeat(2);
                        break;
                    case 'random-number':
                        //  Generate two different random numbers, e.g. 46 or 99 or 03
                        for (let c = 0; c < 2; c++) {
                            suffix += this.getRandomCharacter(this.characterSetNumbers);
                        }
                        break;
                    case 'symbol-number':
                        //  Generate a single random symbol and a single random number, e.g. 5% or 8^
                        suffix += this.getRandomCharacter(this.characterSetNumbers);
                        suffix += this.getRandomCharacter(this.characterSetSpecialChars);
                        break;
                    case '2symbols-2numbers':
                        //  Generate a double random symbol, and two different random numbers
                        //  e.g. 85$$ or 24@@
                        for (let c = 0; c < 2; c++) {
                            suffix += this.getRandomCharacter(this.characterSetNumbers);
                        }
                        suffix += this.getRandomCharacter(this.characterSetSpecialChars).repeat(2);
                        break;
                    case 'other':
                        //  User specified suffix
                        suffix = this.suffixOther;
                        break;
                }

                //  Loop through generating main portion of password.
                for (let i = 0; i < this.passwordLength; i++) {
                    //  Get a random word from the word list.
                    let randomWord = wordList[Math.floor(Math.random() * wordList.length)];

                    //  For random capitalization pattern, randomly determine how many capitals to make
                    //  This is determined per word!
                    let numberOfCapitals = Math.floor(Math.random() * randomWord.length);

                    //  A switch/case to capitalize all or portion of the word.
                    switch (this.capitalization) {
                        case 'title':
                            //  Title Case For Every Words
                            randomWord = this.capitalizeWord(randomWord, 0);
                            break;
                        case 'alternating':
                            //  CAPITALIZE every OTHER word
                            //  Even/Odd is determined by randomly generated evenOdd variable
                            if (i % 2 !== evenOdd) {
                                randomWord = randomWord.toUpperCase();
                            }
                            break;
                        case 'upper':
                            //  EVERYTHING IS CAPITALIZED
                            randomWord = randomWord.toUpperCase();
                            break;
                        case 'random':
                            //  LetTeRS Are RanDOMly pickEd per WORD
                            //  Users numberOfCapitals to determine how many to capitalize
                            for (let c = 0; c < numberOfCapitals; c++) {
                                //  Get a random character in the word to capitalize
                                let capitalLetter = Math.floor(Math.random() * randomWord.length);

                                //  Capitalize the specified letter
                                randomWord = this.capitalizeWord(randomWord, capitalLetter);
                            }
                            break;
                        case 'alternating-letters':
                            //  AlTeRnAtE LeTtErS
                            //  evenOdd to determine whether to capitalize even or odd letters.
                            for (let c = 0; c < randomWord.length; c++) {
                                if (c % 2 !== evenOdd) {
                                    //  Capitalize the specified letter
                                    randomWord = this.capitalizeWord(randomWord, c);
                                }
                            }
                            break;
                    }

                    //  Add the generated and altered word to the password array
                    generatedPassword.push(randomWord);
                }

                //  Now, we deal with the separator
                let separator = '';

                //  There are a lot of options, but most use the desired character as the radio value.
                switch (this.separator) {
                    case 'other':
                        //  If user selects other, use their defined characters
                        separator = this.separatorOther;
                        break;
                    case 'random':
                        //  Randomly use a special character.
                        separator = this.getRandomCharacter(this.characterSetSpecialChars);
                        break;
                    case 'random-number':
                        //  Randomly use two different digits.
                        for (let c = 0; c < 2; c++) {
                            separator += this.getRandomCharacter(this.characterSetNumbers);
                        }
                        break;
                    default:
                        //  Use the specified separator.
                        separator = this.separator;
                        break;

                }

                //  Now, we simply put the pieces of the password together.
                this.password = prefix + generatedPassword.join(separator) + suffix;
            },
            getRandomCharacter: function (characterSet) {
                /*  Get a random character from the input character set     */
                return characterSet[Math.floor(Math.random() * characterSet.length)];
            },
            capitalizeWord: function (word, character = 0) {
                /*  Capitalize the specified character in word  */
                if (character === 0) {
                    //  If we're capitalizing the first character, we make it upper case and then append the rest, unaltered
                    return word.substring(character, character + 1).toUpperCase() + word.substring(character + 1, word.length);
                } else if (character === word.length - 1) {
                    //  Or else, if we're capitalizing a middle character, we first take the first part of the word unaltered,
                    //  then we add the capitalized letter, and then we add the rest, unaltered
                    return word.substring(0, character) + word.substring(character, word.length).toUpperCase();
                }
                //  Finally if it's the end of the word then we just take the first part unaltered and capitalize the last letter.
                return word.substring(0, character) + word.substring(character, character + 1).toUpperCase() + word.substring(character + 1, word.length);
            },
            loadWordList: function (wordlist) {
                /*  Return an array of words from the input wordList    */
                return wordlist.split(',');
            },
            doCopy: function () {
                /*  Copy the password to the system's clipboard, using vue-clipboard2   */
                //  In order to use the data variables in the success or error context, we need to copy it to vm.
                let vm = this;
                this.$copyText(this.password).then(function () {
                    //  If successful, then initialize snackbar and make it visible.
                    vm.sb_color = "info";
                    vm.sb_text = 'Password copied to clipboard.';
                    vm.sb_state = true;
                }, function () {
                    //  If unsuccessful, then initialize snackbar and make it visible.
                    vm.sb_color = "error";
                    vm.sb_text = 'Can not copy password to clipboard.';
                    vm.sb_state = true;
                });
            }
        }
    };
</script>

<style scoped>

</style>