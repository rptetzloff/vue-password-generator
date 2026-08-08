# Vue Password Generator

A modern, secure password generator built with Vue 3. Generate highly customizable passwords across seven distinct modes — all locally in your browser, with no data ever sent to a server.

No build step, no dependencies, and no third-party CDNs: the site runs exactly as
it appears in this repository.

## Live Demo

**[Try it now at getrandompassword.net](https://getrandompassword.net)**

---

## Generation Modes

### Simple
Quick password generation with toggles for lowercase, uppercase, numbers, and symbols. Set a length and go.

### Advanced
Fine-grained control over minimum and maximum character counts per type, plus a configurable custom symbol set. The symbol picker includes **All**, **Common** (`!@#$%&*-_+=?`), and **None** presets alongside individual symbol toggles.

### Words
Dictionary-based passwords built from a 7,776-word EFF wordlist. Choose word count (2–8), separator, and capitalization scheme. Separator options include hyphens, underscores, dots, numbers, spaces, and custom characters. A **character count pill** next to the copy button shows the total length of the generated password at a glance.

### Numbers
Numeric passwords with configurable length, plus controls to limit repeated and sequential digits.

### Passphrase
Slot-based passphrase builder. Add adjective, adverb, noun, and verb slots in any order to construct a custom grammatical structure. Each slot has independent category selection (e.g. Animals, Colors, Mood, Manner). A **character count pill** shows the total password length.

### Wireless
WiFi-optimized passphrase generator. Uses the same slot-based word engine as Passphrase but defaults to Adj + Noun, Title Case, hyphen separator, and a 2-digit numeric suffix — producing memorable, router-friendly passwords like `Crimson-River42`. Includes an **Alliteration** toggle that constrains all word slots to begin with the same letter, picking a shared letter that exists across all active slot categories. All generated passwords are guaranteed to be at least **8 characters**; the generator retries automatically if a result falls short. A **character count pill** shows the total password length.

### Mad Lib
Template-based sentence passwords. Choose from 12 narrative templates (Hero, Villain, Quest, Sci-Fi, etc.). Each word slot in the template — adjective, adverb, noun, verb — gets its own category picker. Templates with multiple occurrences of the same part of speech (e.g. two nouns) show numbered rows so each can be controlled independently. The readable phrase is shown alongside the final joined password. A **character count pill** shows the total password length.

---

## Shared Controls

All modes support:

- **Word Separator** — hyphen, underscore, dot, space, number, none, or custom
- **Capitalization** — Title Case, lowercase, UPPERCASE, rAndOm LetTerS, AlTeRnAtInG, lasT letteR, FIRST word only, last word ONLY, WORD word alternating, or random per-word
- **Prefix / Suffix** — add a number, symbol, or custom string before or after the password
- **Copy to Clipboard** — one-click copy with confirmation

---

## Settings Persistence

All configuration preferences are automatically saved to `localStorage` and restored on your next visit. This includes password length, character type selections, separators, capitalization, prefix/suffix options, and custom symbol sets across all seven modes.

The **last active tab** is also persisted — returning to the app opens whichever generator you had open last.

Each tab keeps a **generation history** of your last 10 passwords (shown below the output field). History is stored in `localStorage` and persists across page refreshes — but it is local to your browser only and is never transmitted anywhere. Clearing your browser's site data will erase it.

---

## Security & Privacy

- **Client-side only** — all generation happens in your browser; nothing is transmitted
- **Cryptographically secure** — uses `crypto.getRandomValues()` for all randomness
- **Unbiased** — random values are drawn with rejection sampling, so every character and word in a pool is equally likely. Taking `crypto.getRandomValues(...) % n` directly would skew results toward low values; the `randInt()` helper in `src/main.js` discards the ragged tail instead
- **Fails loudly** — `crypto.getRandomValues()` needs a secure context (HTTPS or `localhost`). Over plain HTTP on a non-localhost host, generation errors out rather than falling back to a weaker source
- **Passwords stay local** — generated passwords are never transmitted; recent history is cached in `localStorage` only, on your device
- **Settings saved locally** — preferences are stored in your browser's `localStorage` only
- **No third-party requests** — Vue and the icon font are served from this site, so no CDN observes your visit
- **Open source** — inspect the code yourself

> **Upgrading from v2.7.1 or earlier?** Those versions used `Math.random()` for all randomness, which is not cryptographically secure — its internal state is recoverable from observed outputs. Passwords generated before v2.7.2 should be considered predictable and are worth regenerating.

---

## Development

### Prerequisites

Any static file server. The `npm run dev` script below uses one via `npx`, which
needs Node.js 18+, but nothing in the project itself depends on Node.

### Quick Start

```bash
git clone https://github.com/rptetzloff/vue-password-generator.git
cd vue-password-generator
npm run dev
```

Open [http://localhost:5173](http://localhost:5173).

There is no build step and no dependencies to install — `npm run dev` just serves
the repository over HTTP. Any static server works equally well:

```bash
python3 -m http.server 5173
```

Opening `index.html` directly from the filesystem will not work: `src/main.js` is
an ES module and the wordlists are loaded with `fetch`, both of which require
`http://` rather than `file://`.

---

## Deployment

The project includes a `render.yaml` for one-click deployment on [Render.com](https://render.com):

1. Connect your repository to Render
2. Create a new Static Site
3. Render detects the config automatically and deploys

Build command: none  
Publish directory: `./` (the repository root)

For any other static host, serve the repository root as-is.

---

## Project Structure

```
vue-password-generator/
├── data/
│   ├── words.json        # Categorized word lists (nouns, verbs, adjectives, adverbs)
│   └── wordlist.txt      # EFF large wordlist for Words mode (7,776 words)
├── src/
│   ├── main.js           # All Vue components (Composition API)
│   └── style.css         # Design system and component styles
├── vendor/
│   ├── vue.esm-browser.prod.js   # Vue 3.4.0 runtime
│   └── mdi/                      # Material Design Icons 7.4.47 (css + woff2)
├── changelog.html        # Release history
├── docs.html             # In-app documentation reference
├── render.yaml
├── package.json
└── index.html
```

---

## Architecture

### Components

| Component | Description |
|---|---|
| `SimplePassword` | Basic character-type selection |
| `AdvancedPassword` | Per-type min/max character counts |
| `WordsPassword` | EFF wordlist-based generation |
| `NumbersPassword` | Numeric passwords with sequence controls |
| `Passphrase` | Custom slot-order passphrase builder |
| `WifiWords` | WiFi-optimized passphrase with alliteration mode |
| `MadLib` | Template sentence passwords with per-slot category control |

### Vue as a vendored ES module

Vue 3 is loaded as a native ES module from a checked-in copy, avoiding both a
bundler and a third-party CDN in the critical path:

```javascript
import { createApp, ref, computed, watch, onMounted } from
  '../vendor/vue.esm-browser.prod.js'
```

Everything the page needs is served from this repository, so the site has no
external runtime dependencies and keeps working if any CDN is unreachable.
Upgrading Vue means replacing `vendor/vue.esm-browser.prod.js` with a newer
`vue.esm-browser.prod.js` build.

### Word Data

`words.json` organizes ~2,400 curated words by part of speech and category:

- **noun** — Animals, Vehicles, Food, Places, Nature, Tech, Jobs
- **adj** — Colors, Size, Texture, Mood, Weather, Time
- **adv** — Manner, Intensity, Time, Place
- **verb** — Movement, Action, Nature, Cognition

`wordlist.txt` is the EFF large wordlist (7,776 words, lengths 3–9), used exclusively by the Words mode for high-entropy dictionary passwords.

---

## Browser Support

- Chrome 88+
- Firefox 85+
- Safari 14+
- Edge 88+

Requires ES module support and `crypto.getRandomValues()`. Because `crypto.getRandomValues()` is only exposed in a secure context, the app must be served over HTTPS or from `localhost`.

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

- [EFF Large Wordlist](https://www.eff.org/deeplinks/2016/07/new-wordlists-random-passphrases) — used for Words mode
- [XKCD #936](https://xkcd.com/936/) — "correct horse battery staple"
- [Vue.js](https://vuejs.org/)
- [Render](https://render.com/) — hosting
- [Bolt](https://bolt.new/) — AI-assisted development

---

*Your passwords are generated locally in your browser — no server storage, no transmission.*

Made by [Raymond Tetzloff](https://github.com/rptetzloff) with assistance from [Bolt](https://bolt.new)
