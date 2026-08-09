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

## Appearance

A settings gear in the header opens a small panel, available on every page.

- **Theme** — Light, Dark, or System. System follows your OS setting and updates live if you change it.
- **Text size** — Default, 112%, 125% or 150%. Scales the whole interface, not just the copy, and multiplies your browser's own font size rather than replacing it.
- **Colours** — ten accent themes: Sky, Blue, Indigo, Violet, Fuchsia, Rose, Emerald, Teal, Slate and Mono. Themes marked with an eye are verified to stay distinct from the success, warning and error colours for every kind of colour blindness.
- **History** — the per-generator history limit, on the app page only.

A theme swaps the accent family — primary, hover, focus ring, focus tint and the
page gradient — and in dark mode it also tints the surfaces, so a violet theme
gives violet cards rather than the same grey card with a violet button. The
tints are all at or below the neutral slate they replace, so they can only raise
the contrast of everything sitting on them.

**Mono** is the exception: it is a true grayscale theme and overrides the status
and change-group colours too. That is the interesting constraint — with no hue,
those have to separate by lightness alone, while every one of them still clears
4.5:1 on white, which pins them into the dark half of the scale. Mono is also
the only theme that is provably identical for every kind of colour vision.

The theme is applied by a blocking inline script before the page paints, so
switching to dark never shows a flash of the light theme first. Your choice is
remembered in `localStorage`.

---

## Accessibility

- Every colour pair in both themes is verified against **WCAG AA** — 4.5:1 for text, 3:1 for control boundaries and focus rings. This is enforced by tests that read `src/tokens.css` directly, so a token change that breaks contrast fails the build rather than shipping.
- Sizes that should follow your text size use relative units, so browser zoom and larger default font sizes scale the interface rather than clipping it. Verified with no horizontal scroll at 320px — the WCAG 1.4.10 reflow width — at both default and 150% text.
- Every interactive control has an accessible name; icon-only buttons carry contextual labels such as "Decrease min lowercase letters".
- A single 2px focus ring is defined site-wide rather than relying on browser defaults, which measured as little as 0.67px on some controls.
- The settings panel is keyboard operable: arrow keys move between options, Escape closes and returns focus to the gear.
- Status messages such as "password copied" are announced to screen readers.
- The current page is marked with `aria-current` and distinguished by weight and border, not colour alone.
- Animations respect `prefers-reduced-motion`.
- Colour is never the only signal. The changelog's change groups, for example, each print their name as text.

### Colour vision

The changelog's change-group colours are chosen by simulating protanopia,
deuteranopia and tritanopia and maximising the *weakest* pair, measured as
CIEDE2000 in CIE Lab. `test/colour-vision.test.js` re-measures this on every
run, and pins the CIEDE2000 implementation itself against the reference pairs
published with the formula.

This started as an opt-in "Colour-blind" palette and is now simply the default.
With normal vision the difference from the old brand set is small, which is
what made a toggle hard to justify; under simulation it is not. The old dark
set had two groups a protanope sees at CIEDE2000 1.1 — below the threshold of
noticing any difference at all — against 7.3 now.

The same tooling decides which accent themes get the eye marker in Settings. A
theme earns it when its accent stays at least 10 (CIEDE2000) from all three
status colours under normal, protan, deutan and tritan vision, in both themes.
That flag is recomputed from `tokens.css` on every test run and the suite fails
if the recorded value disagrees, so the marker cannot quietly become a lie.

A second, stricter floor applies to the accent against `--error` alone: **20**
at normal vision. This exists because the first floor asked the wrong question.
2.3 is the point at which two colours can be told apart *when compared*, but
the accent fills buttons and the error fills a toast — two large blocks of
solid colour — and those read as the same thing long before they become hard
to distinguish side by side. Rose cleared 2.3 comfortably at 11.9 and still
made an error stop looking like an error.

That reshaped the red theme twice. An amber accent was dropped outright at
**0.0** from the warning colour, because it *was* the warning colour. Rose went
from rose-700 (11.9 from `--error`) to rose-900 at 22.3 in light, and from
rose-400 — 1.4 apart under tritanopia — to rose-200 at 22.5 in dark. It reads
as a deep burgundy now rather than a bright rose, which is the price of keeping
a red theme on a site that uses red to mean something.

**Mono is exempt**, and cannot help it. The three status greys already occupy
most of the lightness band that clears 4.5:1, and the accent has to fit in the
same band; it sits 7.1 from its error grey. In a theme where nothing is
colour-coded that is the trade being made, not a defect — the toast is
identified by its words, as it is everywhere else.

Neither the 7.0 group floor nor mono's 6.0 is a comfortable margin. Raising
them is open work; see [ROADMAP.md](ROADMAP.md).

---

## Settings Persistence

All configuration preferences are automatically saved to `localStorage` and restored on your next visit. This includes password length, character type selections, separators, capitalization, prefix/suffix options, and custom symbol sets across all seven modes.

The **last active tab** is also persisted — returning to the app opens whichever generator you had open last.

Each tab keeps a **generation history** of your last 10 passwords (shown below the output field). History is stored in `localStorage` and persists across page refreshes — but it is local to your browser only and is never transmitted anywhere. Clearing your browser's site data will erase it.

---

## Security & Privacy

- **Client-side only** — all generation happens in your browser; nothing is transmitted
- **Cryptographically secure** — uses `crypto.getRandomValues()` for all randomness
- **Unbiased** — random values are drawn with rejection sampling, so every character and word in a pool is equally likely. Taking `crypto.getRandomValues(...) % n` directly would skew results toward low values; the `randInt()` helper in `src/lib.js` discards the ragged tail instead
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

### Tests

```bash
npm test
```

Runs on Node's built-in test runner with **no dependencies** — Node 20+ is the
floor, since the suite uses `globalThis.crypto`. Coverage is the pure logic that
can be tested without a browser: the CSPRNG (range, uniformity, and that
rejection sampling actually discards the biased tail), the word and character
transforms, theme resolution, nav path matching, and both WCAG contrast and
colour-vision separation read straight out of `src/tokens.css`.

Two of those are lints rather than assertions about values, and both exist
because the same bug shipped repeatedly: a colour hardcoded in a stylesheet is
invisible to every contrast test, because those read the tokens. So `style.css`
is required to carry no literal colours at all, and no rule may put a literal
`color` on a themed fill. `site-header.css` and `site-footer.css` are exempt —
they sit on the page gradient, which is dark in both themes.

To run the suite automatically before each commit, once per clone:

```bash
git config core.hooksPath .githooks
```

CI runs the same suite on Node 20 and 24 for every push and pull request.

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
│   ├── main.js           # Vue components for the seven generators
│   ├── lib.js            # Pure generation helpers (no Vue, no DOM) — unit tested
│   ├── theme.js          # Light/dark/system + palette runtime
│   ├── palettes.js       # The accent palette manifest, incl. cvd-safe flags
│   ├── logo.js           # The site mark, inline so it can follow the theme
│   ├── site-header.js    # Shared header: icon, title, subtitle, nav
│   ├── site-nav.js       # One list of pages; every nav is generated from it
│   ├── settings-panel.js # The settings gear popover
│   ├── tokens.css        # Design tokens — the only place colours are defined
│   ├── site-header.css   # Shared header styles
│   ├── site-footer.css   # Shared footer styles
│   ├── settings-panel.css
│   ├── prose-page.css    # Layout for the About and Legal pages
│   └── style.css         # App-specific component styles
├── test/                 # node --test, zero dependencies
│   ├── helpers/
│   │   └── color.js      # CIEDE2000 + colour-vision simulation (test tooling)
│   ├── random.test.js    # CSPRNG: range, uniformity, rejection sampling
│   ├── transforms.test.js
│   ├── contrast.test.js  # WCAG AA, checked against tokens.css itself
│   ├── colour-vision.test.js  # Palette separation under protan/deutan/tritan
│   ├── theme.test.js
│   ├── site-header.test.js
│   └── site-nav.test.js
├── vendor/
│   ├── vue.esm-browser.prod.js   # Vue 3.4.0 runtime
│   ├── vue.LICENSE
│   └── mdi/                      # Material Design Icons 7.4.47 (css + woff2 + LICENSE)
├── .githooks/pre-commit  # Runs the test suite before each commit
├── index.html            # The generator
├── docs.html             # Documentation reference
├── changelog.html        # Release history
├── about.html
├── legal.html
├── ROADMAP.md
├── render.yaml
└── package.json
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
- [Claude Code](https://claude.com/claude-code) — AI-assisted development

The colour tooling in `test/helpers/color.js` implements two published methods.
Neither is vendored or shipped — it is test-only measurement code written from
the papers, which is why it is credited here rather than in the third-party
components on the [Legal page](legal.html):

- **CIEDE2000** — Sharma, Wu & Dalal (2005), *The CIEDE2000 Color-Difference Formula*. The reference pairs published with it are used to verify the implementation.
- **Colour-vision-deficiency simulation** — Machado, Oliveira & Fernandes (2009), *A Physiologically-based Model for Simulation of Color Vision Deficiency*. The severity-1.0 matrices for protanopia, deuteranopia and tritanopia.

---

*Your passwords are generated locally in your browser — no server storage, no transmission.*

Made by [Raymond Tetzloff](https://github.com/rptetzloff) with assistance from [Bolt](https://bolt.new) and [Claude Code](https://claude.com/claude-code)
