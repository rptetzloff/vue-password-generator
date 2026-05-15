# Vue Password Generator

A modern, secure password generator built with Vue 3 and Vite. Generate highly customizable passwords across six distinct modes — all locally in your browser, with no data ever sent to a server.

## Live Demo

**[Try it now at getrandompassword.net](https://getrandompassword.net)**

---

## Generation Modes

### Simple
Quick password generation with toggles for lowercase, uppercase, numbers, and symbols. Set a length and go.

### Advanced
Fine-grained control over minimum and maximum character counts per type, plus a configurable custom symbol set. The symbol picker includes **All**, **Common** (`!@#$%&*-_+=?`), and **None** presets alongside individual symbol toggles.

### Words
Dictionary-based passwords built from a curated word list. Choose word count, separator, and capitalization scheme. Separator options include hyphens, underscores, dots, numbers, spaces, and custom characters.

### Numbers
Numeric passwords with configurable length, plus controls to limit repeated and sequential digits.

### Passphrase
Slot-based passphrase builder. Add adjective, adverb, noun, and verb slots in any order to construct a custom grammatical structure. Each slot has independent category selection (e.g. Animals, Colors, Mood, Manner).

### Mad Lib
Template-based sentence passwords. Choose from 12 narrative templates (Hero, Villain, Quest, Sci-Fi, etc.). Each word slot in the template — adjective, adverb, noun, verb — gets its own category picker. Templates with multiple occurrences of the same part of speech (e.g. two nouns) show numbered rows so each can be controlled independently. The readable phrase is shown alongside the final joined password.

---

## Shared Controls

All modes support:

- **Word Separator** — hyphen, underscore, dot, space, number, none, or custom
- **Capitalization** — Title Case, lowercase, UPPERCASE, rAnDoM, WORD word alternating, or random per-word
- **Prefix / Suffix** — add a number, symbol, or custom string before or after the password
- **Copy to Clipboard** — one-click copy with confirmation

---

## Settings Persistence

All configuration preferences are automatically saved to `localStorage` and restored on your next visit. This includes password length, character type selections, separators, capitalization, prefix/suffix options, and custom symbol sets across all six modes.

The **last active tab** is also persisted — returning to the app opens whichever generator you had open last.

Each tab keeps a **generation history** of your last 10 passwords (shown below the output field). History is stored in `localStorage` and persists across page refreshes — but it is local to your browser only and is never transmitted anywhere. Clearing your browser's site data will erase it.

---

## Security & Privacy

- **Client-side only** — all generation happens in your browser; nothing is transmitted
- **Cryptographically secure** — uses `crypto.getRandomValues()` for all randomness
- **Passwords stay local** — generated passwords are never transmitted; recent history is cached in `localStorage` only, on your device
- **Settings saved locally** — preferences are stored in your browser's `localStorage` only
- **Open source** — inspect the code yourself

---

## Development

### Prerequisites

- Node.js 18+
- npm

### Quick Start

```bash
git clone https://github.com/rptetzloff/vue-password-generator.git
cd vue-password-generator
npm install
npm run dev
```

Open [http://localhost:5173](http://localhost:5173).

### Scripts

```bash
npm run dev       # Development server with hot reload
npm run build     # Production build
npm run preview   # Preview production build locally
```

---

## Deployment

The project includes a `render.yaml` for one-click deployment on [Render.com](https://render.com):

1. Connect your repository to Render
2. Create a new Static Site
3. Render detects the config automatically and deploys

Build command: `npm ci && npm run build`  
Publish directory: `dist`

For any other static host, build with `npm run build` and serve the `dist/` folder.

---

## Project Structure

```
vue-password-generator/
├── data/
│   ├── words.json        # Categorized word lists (nouns, verbs, adjectives, adverbs)
│   └── wordlist.txt      # General wordlist for Words mode
├── src/
│   ├── main.js           # All Vue components (Composition API, CDN)
│   └── style.css         # Design system and component styles
├── changelog.html        # Release history
├── docs.html             # In-app documentation reference
├── render.yaml
├── package.json
├── vite.config.js
└── index.html
```

---

## Architecture

### Components

| Component | Description |
|---|---|
| `SimplePassword` | Basic character-type selection |
| `AdvancedPassword` | Per-type min/max character counts |
| `WordsPassword` | Dictionary word-based generation |
| `NumbersPassword` | Numeric passwords with sequence controls |
| `WordsPassword` (Passphrase) | Custom slot-order passphrase builder |
| `MadLib` | Template sentence passwords with per-slot category control |

### Vue via CDN

Vue 3 is loaded from unpkg as an ES module, keeping the build output minimal and avoiding framework bundling complexity:

```javascript
import { createApp, ref, computed, watch, onMounted } from
  'https://unpkg.com/vue@3.4.0/dist/vue.esm-browser.prod.js'
```

### Word Data

`words.json` organizes words by part of speech and category:

- **adj** — Animals, Colors, Nature, Mood, Size, Texture
- **adv** — Manner, Intensity, Time, Place
- **noun** — Animals, Vehicles, Nature, Objects, Food, Places
- **verb** — Motion, Creation, Communication, Perception, Existence, Change

---

## Browser Support

- Chrome 88+
- Firefox 85+
- Safari 14+
- Edge 88+

Requires ES module support and `crypto.getRandomValues()`.

---

## Contributing

1. Fork the repository
2. Create a feature branch
3. Test across browsers
4. Open a Pull Request

Please keep passwords family-friendly and maintain the security-first approach.

---

## License

MIT — see [LICENSE](LICENSE) for details.

---

## Acknowledgments

- [EFF Large Wordlist](https://www.eff.org/deeplinks/2016/07/new-wordlists-random-passphrases) — passphrase inspiration
- [XKCD #936](https://xkcd.com/936/) — "correct horse battery staple"
- [Vue.js](https://vuejs.org/), [Vite](https://vitejs.dev/), [Render.com](https://render.com/)
- [Bolt](https://bolt.new/) — AI-assisted development

---

*Your passwords are generated locally in your browser — no server storage, no transmission.*

Made by [Raymond Tetzloff](https://github.com/rptetzloff) with [Bolt](https://bolt.new)
