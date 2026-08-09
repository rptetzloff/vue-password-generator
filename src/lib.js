// Pure generation helpers -- no Vue, no DOM, no localStorage.
//
// Split out of main.js so it can be imported by test/ under `node --test`.
// main.js itself cannot be imported: it ends in createApp(App).mount(), which
// needs a DOM. Browsers load this as a plain ES module, so there is still no
// build step.

export const SPECIAL_CHARS = '!#$%&*+-/:;=?@^_|~'
export const DIGITS = '0123456789'

// Uniform random integer in [0, max), drawn from the CSPRNG.
// Rejection sampling discards the ragged tail above the largest multiple of
// `max` that fits in a uint32, so every value is equally likely. Plain
// `getRandomValues(...) % max` would skew toward low values.
export const randInt = (max) => {
  if (max <= 1) return 0
  const buf = new Uint32Array(1)
  const limit = Math.floor(0x100000000 / max) * max
  let x
  do {
    crypto.getRandomValues(buf)
    x = buf[0]
  } while (x >= limit)
  return x % max
}

export const randPick = (arr) => arr[randInt(arr.length)]

export const randBool = () => randInt(2) === 1

export const randChar = (str) => str.charAt(randInt(str.length))

export const resolveToken = (value, custom) => {
  switch (value) {
    case 'r1sym':  return randChar(SPECIAL_CHARS)
    case 'r2sym':  return randChar(SPECIAL_CHARS) + randChar(SPECIAL_CHARS)
    case 'r1num':  return randChar(DIGITS)
    case 'r2num':  return randChar(DIGITS) + randChar(DIGITS)
    case 'r2s2n':  return randChar(SPECIAL_CHARS) + randChar(SPECIAL_CHARS) + randChar(DIGITS) + randChar(DIGITS)
    case 'r2n2s':  return randChar(DIGITS) + randChar(DIGITS) + randChar(SPECIAL_CHARS) + randChar(SPECIAL_CHARS)
    case 'r1s1n':  return randChar(SPECIAL_CHARS) + randChar(DIGITS)
    case 'r1n1s':  return randChar(DIGITS) + randChar(SPECIAL_CHARS)
    case 'custom': return custom
    default:       return value  // literal: '', ' ', '-', '_', '.', '$', etc.
  }
}

export const SEPARATOR_OPTIONS = [
  { value: '',       label: 'None' },
  { value: ' ',      label: 'Space' },
  { value: '-',      label: 'Hyphen  -' },
  { value: '_',      label: 'Underscore  _' },
  { value: '.',      label: 'Period  .' },
  { value: '$',      label: 'Dollar  $' },
  { value: 'r1sym',  label: '1 Random Symbol' },
  { value: 'r2sym',  label: '2 Random Symbols' },
  { value: 'r1num',  label: '1 Random Number' },
  { value: 'r2num',  label: '2 Random Numbers' },
  { value: 'r1s1n',  label: '1 Symbol + 1 Number' },
  { value: 'r1n1s',  label: '1 Number + 1 Symbol' },
  { value: 'r2s2n',  label: '2 Symbols + 2 Numbers' },
  { value: 'r2n2s',  label: '2 Numbers + 2 Symbols' },
  { value: 'custom', label: 'Custom...' },
]

export const AFFIX_OPTIONS = [
  { value: '',       label: 'None' },
  { value: 'r1sym',  label: '1 Random Symbol' },
  { value: 'r2sym',  label: '2 Random Symbols' },
  { value: 'r1num',  label: '1 Random Number' },
  { value: 'r2num',  label: '2 Random Numbers' },
  { value: 'r1s1n',  label: '1 Symbol + 1 Number' },
  { value: 'r1n1s',  label: '1 Number + 1 Symbol' },
  { value: 'r2s2n',  label: '2 Symbols + 2 Numbers' },
  { value: 'r2n2s',  label: '2 Numbers + 2 Symbols' },
  { value: 'custom', label: 'Custom...' },
]

export const SUFFIX_OPTIONS = [
  { value: '',              label: 'None' },
  { value: 'r1sym',         label: '1 Random Symbol' },
  { value: 'r2sym',         label: '2 Random Symbols' },
  { value: 'r1num',         label: '1 Random Number' },
  { value: 'r2num',         label: '2 Random Numbers' },
  { value: 'r1s1n',         label: '1 Symbol + 1 Number' },
  { value: 'r1n1s',         label: '1 Number + 1 Symbol' },
  { value: 'r2s2n',         label: '2 Symbols + 2 Numbers' },
  { value: 'r2n2s',         label: '2 Numbers + 2 Symbols' },
  { value: 'mirror',        label: 'Mirror Prefix' },
  { value: 'mirror-newdig', label: 'Mirror Prefix (new digits)' },
  { value: 'custom',        label: 'Custom...' },
]

// Resolves suffix token; 'mirror' and 'mirror-newdig' require the already-resolved prefix string.
export const resolveSuffixToken = (value, custom, resolvedPrefix) => {
  if (value === 'mirror') {
    return resolvedPrefix.split('').reverse().join('')
  }
  if (value === 'mirror-newdig') {
    // Keep same symbol characters but replace each digit with a fresh random digit
    return resolvedPrefix
      .split('')
      .reverse()
      .map(c => DIGITS.includes(c) ? randChar(DIGITS) : c)
      .join('')
  }
  return resolveToken(value, custom)
}

export const applyCapitalization = (word, mode, index = 0, total = 1) => {
  switch (mode) {
    case 'title':        return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()
    case 'none':         return word.toLowerCase()
    case 'upper':        return word.toUpperCase()
    case 'random':       return word.split('').map(c => randBool() ? c.toUpperCase() : c.toLowerCase()).join('')
    case 'char-alt':     return word.split('').map((c, i) => i % 2 === 0 ? c.toUpperCase() : c.toLowerCase()).join('')
    case 'last-upper':   return word.slice(0, -1).toLowerCase() + word.slice(-1).toUpperCase()
    case 'first-only':   return index === 0 ? word.toUpperCase() : word.toLowerCase()
    case 'last-only':    return index === total - 1 ? word.toUpperCase() : word.toLowerCase()
    case 'word-alt':     return index % 2 === 0 ? word.toUpperCase() : word.toLowerCase()
    case 'word-random':  return randBool() ? word.toUpperCase() : word.toLowerCase()
    default:             return word
  }
}

export const LEET_MAP = [
  { char: 'a', sub: '@',  label: 'a → @'  },
  { char: 'e', sub: '3',  label: 'e → 3'  },
  { char: 'i', sub: '1',  label: 'i → 1'  },
  { char: 'o', sub: '0',  label: 'o → 0'  },
  { char: 's', sub: '$',  label: 's → $'  },
  { char: 't', sub: '+',  label: 't → +'  },
  { char: 'l', sub: '!',  label: 'l → !'  },
  { char: 'b', sub: '8',  label: 'b → 8'  },
  { char: 'g', sub: '9',  label: 'g → 9'  },
  { char: 'z', sub: '2',  label: 'z → 2'  },
]

export const EMOJI_POOLS = {
  // noun categories
  Animals:   ['🐶','🐱','🦊','🐻','🐼','🦁','🐯','🦓','🐘','🦒','🐬','🦅','🦋','🐊','🦔','🦦','🐺','🦉','🐙','🦑','🦜','🐸','🦘','🦛','🐆','🐍','🦎','🦚','🐇','🦫'],
  Vehicles:  ['🚗','🏎️','🚕','🚙','🚌','🚑','🚒','🚓','🚚','🛻','🏍️','🛵','🚲','✈️','🚀','🚁','⛵','🛥️','🚢','🚂','🚜'],
  Food:      ['🍕','🍔','🌮','🍣','🍜','🍛','🍰','🧁','🍩','🍫','🍭','🍇','🍎','🍊','🍋','🍓','🫐','🥑','🥦','🥕','🍄','🧇','🥞','🍱'],
  Places:    ['🏔️','🏝️','🏜️','🌋','🏙️','🌆','🏕️','🏯','🗼','🗽','🏛️','⛩️','🌉','🌌','🏟️','🌃','🏖️','🌄'],
  Nature:    ['🌲','🌿','🍀','🌸','🌺','🌻','🌊','🌈','⛰️','🌙','⭐','☀️','❄️','🌪️','🍁','🌾','🪸','🌵','🌴','🍂','💧','🔥'],
  Tech:      ['💻','📱','🖥️','⌨️','🖱️','🔭','🔬','💡','🔋','📡','🤖','⚙️','🛠️','🔌','💾','📺','🎮','🕹️'],
  Jobs:      ['🧑‍⚕️','👩‍💻','👨‍🍳','👩‍🏫','👨‍🔧','👩‍🎨','👨‍🚀','👩‍⚖️','🧑‍🌾','👨‍🎤','🧑‍🚒','👩‍🔬','🧑‍✈️','👩‍🏭'],
  // adj categories
  Colors:    ['🔴','🟠','🟡','🟢','🔵','🟣','⚫','⚪','🟤','🌈'],
  Size:      ['🔬','📏','🏔️','🌌','🐘','🌱','🦠','🗿'],
  Texture:   ['🧊','🪨','🪵','🌊','💎','🧈','🫧','🕸️'],
  Mood:      ['😊','😢','😡','🤩','😌','😤','🥳','😔','😎','🤗','😴','😱'],
  Weather:   ['☀️','🌧️','❄️','⛈️','🌫️','🌪️','🌈','⛅','🌤️','🌊','🌬️','⚡'],
  Time:      ['⏰','🌅','🌙','🌃','🌄','🕛','⌛','📅','🌠','🌒'],
  // adv categories
  Manner:    ['💨','🏃','🐢','🎯','💫','✨','🌀','⚡','🦅','🐌'],
  Intensity: ['🔥','❄️','⚡','💥','🌊','🌪️','✨','💤','🔊','🤫'],
  Place:     ['🏠','🌍','🏔️','🌊','🏙️','🌌','🌿','⬆️','🌏','🗺️'],
  // verb categories
  Movement:  ['🏃','🚀','💨','🌀','⬆️','🔄','🏊','🦅','🛹','🏇'],
  Action:    ['⚒️','🎯','💪','✂️','🔨','🖊️','🎨','⚡','🧩','🎸'],
  Cognition: ['🧠','💡','🤔','📚','🔍','💭','🎓','👁️','🌀','✏️'],
  // Words mode (no category) + fallback
  default:   ['🌟','✨','💫','🔥','❄️','🌊','⚡','🎯','🎪','🎨','🎭','🎲','🌈','🦋','🌺','🍀','🎸','🎺','🌙','⭐'],
}

export const pickEmoji = (category) => {
  const pool = EMOJI_POOLS[category] || EMOJI_POOLS.default
  return randPick(pool)
}

export const applyLeet = (str, activeSubs) => {
  if (!activeSubs || activeSubs.size === 0) return str
  return str.split('').map(c => {
    const entry = LEET_MAP.find(m => m.char === c.toLowerCase())
    if (entry && activeSubs.has(entry.char)) {
      return c === c.toUpperCase() ? entry.sub.toUpperCase?.() ?? entry.sub : entry.sub
    }
    return c
  }).join('')
}
