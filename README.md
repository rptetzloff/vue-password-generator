# WordLock

WordLock is a password generator and an encrypted vault, built with Vue 3.
Generate passwords across seven distinct modes and keep them in a vault only
you can open — all locally in your browser, with no data ever sent to a server.

There is no account, because there is nothing to sign in to. That is not a
feature that was deferred; it is the shape of the thing. No server means no
breach of ours to be in, and it also means no password reset, no support
channel that can let you back in, and backups that are yours to keep.

No runtime dependencies, no third-party CDNs, and nothing between the repository
and your browser: what a server sends is what is committed here, unbundled and
unminified.

There is one build step, and it runs in development rather than on deploy.
Component templates in `src/templates/` are compiled to render functions ahead of
time so the browser never compiles them — which is what lets the CSP refuse
`unsafe-eval` and the page ship a Vue build with no compiler in it. The output is
committed alongside the input, and a test recompiles the templates and fails if
the two have drifted.

## Live Demo

**[Try it now at wordlock.net](https://wordlock.net)**

---

## Generation Modes

### Simple
Quick password generation with toggles for lowercase, uppercase, numbers, and symbols. Set a length and go.

### Advanced
Fine-grained control over minimum and maximum character counts per type, plus a configurable custom symbol set. The symbol picker includes **All**, **Common** (`!@#$%&*-_+=?`), and **None** presets alongside individual symbol toggles.

### Words
Dictionary-based passwords built from the 17,576-word [Orchard Street Long list](https://github.com/sts10/orchard-street-wordlists) — 14.1 bits per word. Choose word count (2–8), separator, and capitalization scheme. Separator options include hyphens, underscores, dots, numbers, spaces, and custom characters. A **character count pill** next to the copy button shows the total length of the generated password at a glance.

### Numbers
Numeric passwords with configurable length, plus controls to limit repeated and sequential digits.

### Passphrase
Slot-based passphrase builder. Add adjective, adverb, noun, and verb slots in any order to construct a custom grammatical structure. Each slot has independent category selection — ten noun categories including Music and Sports, plus adjective, adverb and verb categories. A **character count pill** shows the total password length.

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
- **Strength readout** — every generator shows its result's entropy in bits, with a delta when settings change, a warning under 40 bits, and a "how?" breakdown pricing every random draw. Options that add nothing say so: the leet toggle is a fixed public mapping (0 bits), eight of the ten capitalization modes are deterministic (0 bits), and Wireless's alliteration toggle states its measured cost. The numbers reflect what the code actually does — Simple's figure is the entropy of its type-then-character draw, slightly below the naive pool math, and Numbers replays its own repeat/sequence state machine, proven exact by tests that sum the probability of every reachable output to 1.

---

## The Vault

A generator on its own is a moment-tool: you take a password and leave, and the
clipboard timer erases the only copy thirty seconds later. `vault.html` keeps
what you generate.

- **AES-256-GCM, with the key derived by PBKDF2-SHA256 at 1,000,000
  iterations.** Not 10,000,000: measured at 93 ms against 1,032 ms, for 4.1
  bits. The vault is a single sealed envelope — there is no index, no plaintext
  entry list and no searchable metadata outside it.
- **Envelope v2 wraps a random master key once per way in.** v1 encrypted
  entries directly under the passphrase-derived key, which leaves nowhere to
  put a second door. Changing the passphrase now re-wraps 32 bytes rather than
  re-encrypting everything. A v1 vault keeps opening as it did and converts
  only when you ask for something that needs it.
- **A recovery key** — sixteen words at 225 bits, drawn from the same Orchard
  Street list, generated and never chosen. A memorable phrase you picked would
  quietly become the real strength of the vault, since an attacker takes
  whichever key is cheaper to break.
- **Entries** carry a username, password, URL, notes, tags, groups, custom
  fields and an optional TOTP seed. Reuse is detected across the vault.
- **Auto-lock**, and an opt-in wrapped key in storage so the vault survives a
  page navigation. `Never` turns that off and keeps the key in memory only.
- **Import and export**, including from other managers. Malformed input from
  another manager's file should fail rather than execute or corrupt — that is
  a security boundary and it is tested as one.

### Sync without a server

The vault can live as a single encrypted file in a folder you choose. Point it
at a directory inside Dropbox, OneDrive or iCloud Drive and their client does
the moving, using an account you already have with a company you already chose.
We are not in the middle of that and could not be — there is still no server
here to put there.

A save re-reads the folder, merges, and then writes, so an edit made on another
machine is not silently overwritten and a genuine conflict is shown as a diff
rather than resolved by guessing. **The limit, in the same breath: that makes
two machines safe in sequence, not in the same instant.** Nothing here can see
across the sync client's own conflict handling, and writing while Dropbox is
behind produces a conflicted copy that only Dropbox knows about.

Folder storage needs the File System Access API, which is Chromium on desktop —
Chrome, Edge, Opera, Brave. Firefox and Safari cannot do it, and that is a
position rather than a gap: Mozilla's standards response calls the write half
harmful. It is **not offered on phones** either, even though Chrome and Edge on
Android have the API, because the folder permission does not survive a page
refresh — twice over, since the site asks and then Android asks. Everywhere it
is unavailable, the vault stays in browser storage and everything else works.

---

## Appearance

A settings gear in the header opens a small panel, available on every page.

- **Theme** — Light, Dark, or System. System follows your OS setting and updates live if you change it.
- **Text size** — Default, 112%, 125% or 150%. Scales the whole interface, not just the copy, and multiplies your browser's own font size rather than replacing it.
- **Colors** — ten accent themes: Sky, Blue, Indigo, Violet, Fuchsia, Rose, Emerald, Teal, Slate and Mono. Themes marked with an eye are verified to stay distinct from the success, warning and error colors for every kind of color blindness.
- **History** — the per-generator history limit, on the app page only.

A theme swaps the accent family — primary, hover, focus ring, focus tint and the
page gradient — and in dark mode it also tints the surfaces, so a violet theme
gives violet cards rather than the same gray card with a violet button. The
tints are all at or below the neutral slate they replace, so they can only raise
the contrast of everything sitting on them.

**Mono** is the exception: it is a true grayscale theme and overrides the status
and change-group colors too. That is the interesting constraint — with no hue,
those have to separate by lightness alone, while every one of them still clears
4.5:1 on white, which pins them into the dark half of the scale. Mono is also
the only theme that is provably identical for every kind of color vision.

The theme is applied by a blocking inline script before the page paints, so
switching to dark never shows a flash of the light theme first. Your choice is
remembered in `localStorage`.

---

## Accessibility

- Every color pair in both themes is verified against **WCAG AA** — 4.5:1 for text, 3:1 for control boundaries and focus rings. This is enforced by tests that read `src/tokens.css` directly, so a token change that breaks contrast fails the build rather than shipping.
- Sizes that should follow your text size use relative units, so browser zoom and larger default font sizes scale the interface rather than clipping it. Verified with no horizontal scroll at 320px — the WCAG 1.4.10 reflow width — at both default and 150% text.
- Every interactive control has an accessible name; icon-only buttons carry contextual labels such as "Decrease min lowercase letters".
- A single 2px focus ring is defined site-wide rather than relying on browser defaults, which measured as little as 0.67px on some controls. This claim was false for a while and is worth naming: `.slider` set `outline: none`, which ties the global rule on specificity and beats it on source order, so the range inputs had no focus indicator at all. Tests now reject any rule that suppresses an outline.
- Every interactive control is at least **24×24 CSS pixels**, the WCAG 2.2 SC 2.5.8 minimum, sized from a single `--control-min` token. The slider needed rebuilding rather than resizing: the input *was* the visible 6px bar, so the whole hit target was 6px tall. The footer links are 22px and stay that way — they clear the spacing exception with 55px between the closest centers.
- The settings panel is keyboard operable: arrow keys move between options, Escape closes and returns focus to the gear.
- Status messages such as "password copied" are announced to screen readers.
- The current page is marked with `aria-current` and distinguished by weight and border, not color alone.
- Animations respect `prefers-reduced-motion`.
- Color is never the only signal. The changelog's change groups, for example, each print their name as text.

### Color vision

The changelog's change-group colors are chosen by simulating protanopia,
deuteranopia and tritanopia and maximising the *weakest* pair, measured as
CIEDE2000 in CIE Lab. `test/color-vision.test.js` re-measures this on every
run, and pins the CIEDE2000 implementation itself against the reference pairs
published with the formula.

This started as an opt-in "Color-blind" palette and is now simply the default.
With normal vision the difference from the old brand set is small, which is
what made a toggle hard to justify; under simulation it is not. The old dark
set had two groups a protanope sees at CIEDE2000 1.1 — below the threshold of
noticing any difference at all — against 7.3 now.

The same tooling decides which accent themes get the eye marker in Settings. A
theme earns it when its accent stays at least 10 (CIEDE2000) from all three
status colors under normal, protan, deutan and tritan vision, in both themes.
That flag is recomputed from `tokens.css` on every test run and the suite fails
if the recorded value disagrees, so the marker cannot quietly become a lie.

A second, stricter floor applies to the accent against `--error` alone: **20**
at normal vision. This exists because the first floor asked the wrong question.
2.3 is the point at which two colors can be told apart *when compared*, but
the accent fills buttons and the error fills a toast — two large blocks of
solid color — and those read as the same thing long before they become hard
to distinguish side by side. Rose cleared 2.3 comfortably at 11.9 and still
made an error stop looking like an error.

That reshaped the red theme twice. An amber accent was dropped outright at
**0.0** from the warning color, because it *was* the warning color. Rose went
from rose-700 (11.9 from `--error`) to rose-900 at 22.3 in light, and from
rose-400 — 1.4 apart under tritanopia — to rose-200 at 22.5 in dark. It reads
as a deep burgundy now rather than a bright rose, which is the price of keeping
a red theme on a site that uses red to mean something.

**Mono is exempt**, and cannot help it. The three status grays already occupy
most of the lightness band that clears 4.5:1, and the accent has to fit in the
same band; it sits 7.1 from its error gray. In a theme where nothing is
color-coded that is the trade being made, not a defect — the toast is
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
- **A strict CSP** — `connect-src 'self'` is the directive that earns its keep: whatever runs on this origin, it has nowhere to send what it finds. Every inline script is allowed by hash rather than by `'unsafe-inline'`, and `'unsafe-eval'` is gone as of 3.4.0 — not merely withheld, but unusable, since the page ships a Vue build with no compiler in it
- **The vault is a sealed envelope** — no index, no plaintext entry list, no searchable metadata outside the ciphertext. Nobody can open it, including us
- **Open source** — inspect the code yourself

Reporting a vulnerability, what is in scope, and the trade-offs that are
documented rather than defects: [SECURITY.md](SECURITY.md).

> **Upgrading from v2.7.1 or earlier?** Those versions used `Math.random()` for all randomness, which is not cryptographically secure — its internal state is recoverable from observed outputs. Passwords generated before v2.7.2 should be considered predictable and are worth regenerating.

---

## Development

### Prerequisites

Any static file server. The `npm run dev` script below uses one via `npx`, which
needs Node.js 18+.

Nothing depends on Node to *run* the site. Two things do depend on it, and
neither is between the repository and a browser: the test suite, and the
template build — whose output is committed, so a clone serves correctly without
ever running it.

### Quick Start

```bash
git clone https://github.com/rptetzloff/wordlock.git
cd wordlock
npm run dev
```

Open [http://localhost:5173](http://localhost:5173).

Nothing needs installing to RUN the site — `npm run dev` just serves the
repository over HTTP, and any static server works equally well:

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

Runs on Node's built-in test runner — Node 20+ is the
floor, since the suite uses `globalThis.crypto`. Coverage is the pure logic that
can be tested without a browser: the CSPRNG (range, uniformity, and that
rejection sampling actually discards the biased tail), the word and character
transforms, the vault's crypto and its state machine with storage faked, theme
resolution, nav path matching, and both WCAG contrast and color-vision
separation read straight out of `src/tokens.css`.

A second group asserts things about the repository rather than about values,
because each of them is a bug that shipped once: `csp.test.js` recomputes the
script hashes from the HTML (a stale hash is a blank site, and it normalises
line endings first, because the working tree is CRLF and git stores LF);
`templates.test.js` recompiles `src/templates/` and fails if the committed
render functions have drifted, so the artefact cannot quietly become the source
of truth; and `csp.test.js` also fails if `'unsafe-eval'` returns to the header
or a component declares `template:` again.

`templates.test.js` is the one test that needs `npm ci` — the compiler is a
devDependency and cannot be vendored. It skips cleanly without it so a fresh
clone still runs everything else. CI installs, so CI enforces it.

Two of those are lints rather than assertions about values, and both exist
because the same bug shipped repeatedly: a color hardcoded in a stylesheet is
invisible to every contrast test, because those read the tokens. So `style.css`
is required to carry no literal colors at all, and no rule may put a literal
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

Still none, with a build step in the project, and that is deliberate: the
templates are compiled in development and the output is committed, so the host
has nothing to run. What a server sends is what is in the repository. A build
whose artefacts were not committed would break that claim; this one does not.

For any other static host, serve the repository root as-is.

---

## Project Structure

```
wordlock/
├── data/
│   ├── words.json        # Categorized word lists (nouns, verbs, adjectives, adverbs)
│   └── orchard-street-long.txt  # Words mode list (17,576 words, CC BY-SA 4.0)
├── src/
│   ├── main.js           # The generator app: the seven components and their state
│   ├── main.render.js    # GENERATED from templates/main/ — do not edit
│   ├── templates/        # The markup, as .html. This is the source of truth
│   │   ├── main/         # App, the seven generators, EntropyPanel, HistoryStrip…
│   │   └── vault/
│   ├── generators.js     # Pure generation, shared by the app and the vault
│   ├── lib.js            # Pure helpers (no Vue, no DOM) — unit tested
│   ├── entropy.js        # Bits accounting for every generator (6a/6b)
│   ├── common-passwords.js     # The deny-list behind the strength readout
│   ├── passphrase-strength.js  # Scoring for the vault's passphrase
│   ├── clipboard-clear.js      # The 30-second clipboard timer
│   ├── history-crypto.js       # Encrypts the per-generator history at rest
│   │
│   ├── vault-app.js      # The vault app
│   ├── vault.render.js   # GENERATED from templates/vault/ — do not edit
│   ├── vault-crypto.js   # AES-256-GCM, PBKDF2, the sealed envelope (v1 and v2)
│   ├── recovery-key.js   # Sixteen words: generate, normalise, validate
│   ├── vault-store.js    # State machine, read-merge-write, conflict guard
│   ├── vault-entry.js    # Entry rules: normalise, tombstone, sort, group, reuse
│   ├── vault-session.js  # Auto-lock and the between-pages wrapped key
│   ├── vault-idb.js      # Storage adapter: IndexedDB
│   ├── vault-fs.js       # Storage adapter: a folder you chose
│   ├── vault-location.js # Which adapter is in use, and moving between them
│   ├── vault-diff.js     # Conflict diff — compares raw, renders masked
│   ├── vault-transfer.js # Import and export, including from other managers
│   ├── totp.js           # One-time codes
│   │
│   ├── theme.js          # Light/dark/system + palette runtime
│   ├── palettes.js       # The accent palette manifest, incl. cvd-safe flags
│   ├── logo.js           # The site mark, inline so it can follow the theme
│   ├── site-header.js    # Shared header: icon, title, subtitle, nav
│   ├── site-nav.js       # One list of pages; every nav is generated from it
│   ├── site-footer.js    # Shared footer, generated from the same list
│   ├── markdown.js       # Small Markdown subset renderer, for roadmap.html
│   ├── settings-panel.js # The settings gear popover
│   ├── tokens.css        # Design tokens — the only place colors are defined
│   ├── style.css         # App-specific component styles
│   ├── vault.css
│   ├── prose-page.css    # Layout for the About and Legal pages
│   └── site-header.css, site-footer.css, settings-panel.css
├── tools/
│   └── build-templates.mjs  # templates/ → *.render.js; --check for CI
├── test/                 # node --test — 744 of them
│   ├── helpers/color.js  # CIEDE2000 + color-vision simulation (test tooling)
│   ├── random.test.js    # CSPRNG: range, uniformity, rejection sampling
│   ├── entropy.test.js   # Bits math: distribution proofs, canaries, 6b claims
│   ├── vault-crypto.test.js, vault-store.test.js, vault-fs.test.js,
│   │                     # vault-diff.test.js, vault-location.test.js,
│   │                     # vault-transfer.test.js, recovery-key.test.js
│   ├── contrast.test.js  # WCAG AA, checked against tokens.css itself
│   ├── color-vision.test.js  # Palette separation under protan/deutan/tritan
│   ├── controls.test.js  # Target size (2.5.8) and focus visibility (2.4.7)
│   ├── csp.test.js       # Recomputes the script hashes from the HTML
│   ├── templates.test.js # Recompiles templates/ and fails if output drifted
│   ├── render-config.test.js  # render.yaml's headers and routing
│   ├── source-hygiene.test.js # No literal colors; no suppressed outlines
│   ├── app-mode.test.js  # Service worker, precache list, manifest
│   └── …                 # wordlist, words, transforms, totp, markdown, theme,
│                         # generators, history-crypto, site-header, site-nav
├── vendor/
│   ├── vue.runtime.esm-browser.prod.js  # Vue 3.4.0, runtime only — no compiler
│   ├── vue.LICENSE
│   └── mdi/              # Material Design Icons 7.4.47 (css + woff2 + LICENSE)
├── .githooks/pre-commit  # Runs the test suite before each commit
├── index.html            # The generator
├── vault.html            # The vault
├── docs.html             # Documentation reference
├── changelog.html        # Release history
├── roadmap.html, about.html, legal.html
├── sw.js                 # Service worker: offline shell, versioned cache
├── ROADMAP.md
├── SECURITY.md
├── render.yaml
└── package.json
```

`src/main.js` and `src/vault-app.js` are both far past the point of being
comfortably readable and are being reduced by extraction rather than by a
rewrite — `vault-entry.js`, `vault-idb.js` and `vault-diff.js` all came out of
`vault-store.js` that way.

---

## Architecture

### Components

| Component | Description |
|---|---|
| `SimplePassword` | Basic character-type selection |
| `AdvancedPassword` | Per-type min/max character counts |
| `WordsPassword` | Orchard Street wordlist-based generation |
| `NumbersPassword` | Numeric passwords with sequence controls |
| `Passphrase` | Custom slot-order passphrase builder |
| `WifiWords` | WiFi-optimized passphrase with alliteration mode |
| `MadLib` | Template sentence passwords with per-slot category control |

Each is declared in `src/main.js` and gets its markup from
`src/templates/main/`, compiled ahead of time into `src/main.render.js`. Edit
the template, not the render function — a test fails if the two disagree. The
vault is one app of its own, `src/vault-app.js` with `src/templates/vault/`.

### Vue as a vendored ES module

Vue 3 is loaded as a native ES module from a checked-in copy, avoiding both a
bundler and a third-party CDN in the critical path:

```javascript
import { createApp, ref, computed, watch, onMounted } from
  '../vendor/vue.runtime.esm-browser.prod.js'
```

Everything the page needs is served from this repository, so the site has no
external runtime dependencies and keeps working if any CDN is unreachable.

It is the **runtime** build — 88 KB against the full build's 146 KB, and the
58 KB it leaves out is the template compiler. That is the point rather than a
saving: with no compiler on the page, `unsafe-eval` is not merely disallowed
by the CSP, there is nothing that could use it. Upgrading Vue means replacing
`vendor/vue.runtime.esm-browser.prod.js` with a newer `vue.runtime.esm-browser.prod.js`
— *runtime*, not the full build, or the compiler comes back and the CSP starts
blocking it.

### Word Data

`words.json` organizes ~2,400 curated words by part of speech and category:

- **noun** — Animals, Vehicles, Food, Places, Nature, Tech, Jobs
- **adj** — Colors, Size, Texture, Mood, Weather, Time
- **adv** — Manner, Intensity, Time, Place
- **verb** — Movement, Action, Nature, Cognition

`orchard-street-long.txt` is the [Orchard Street Long list](https://github.com/sts10/orchard-street-wordlists) (17,576 words, lengths 3–15), used exclusively by the Words mode. It gives **14.101 bits per word** against the EFF list's 12.925, and it is *uniquely decodable* — no sequence of its words can be read as a different sequence, which matters because the separator can be set to None.

It is **CC BY-SA 4.0** and deliberately kept as its own file. That license covers the list; the rest of the project stays MIT, and `words.json` is kept clear of it so the share-alike terms never reach the hand-curated data.

---

## Browser Support

- Chrome 88+
- Firefox 85+
- Safari 14+
- Edge 88+

Requires ES module support and `crypto.getRandomValues()`. Because `crypto.getRandomValues()` is only exposed in a secure context, the app must be served over HTTPS or from `localhost`.

The vault needs the same, plus `crypto.subtle` and IndexedDB, so those floors
carry it too. **One feature does not reach all four:** keeping the vault in a
folder you chose needs the File System Access API, which is Chromium on desktop
only. Where it is missing the vault stays in browser storage and nothing else
changes — see [The Vault](#the-vault) for why Firefox and Safari not having it
is a position rather than a delay, and why it is withheld on phones that do.

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

- [Orchard Street Wordlists](https://github.com/sts10/orchard-street-wordlists) — Sam Schlinkert, CC BY-SA 4.0, used for Words mode
- [EFF Large Wordlist](https://www.eff.org/deeplinks/2016/07/new-wordlists-random-passphrases) — used for Words mode until v2.14.0
- [XKCD #936](https://xkcd.com/936/) — "correct horse battery staple"
- [Vue.js](https://vuejs.org/)
- [Render](https://render.com/) — hosting
- [Bolt](https://bolt.new/) — AI-assisted development
- [Claude Code](https://claude.com/claude-code) — AI-assisted development

The color tooling in `test/helpers/color.js` implements two published methods.
Neither is vendored or shipped — it is test-only measurement code written from
the papers, which is why it is credited here rather than in the third-party
components on the [Legal page](legal.html):

- **CIEDE2000** — Sharma, Wu & Dalal (2005), *The CIEDE2000 Color-Difference Formula*. The reference pairs published with it are used to verify the implementation.
- **Color-vision-deficiency simulation** — Machado, Oliveira & Fernandes (2009), *A Physiologically-based Model for Simulation of Color Vision Deficiency*. The severity-1.0 matrices for protanopia, deuteranopia and tritanopia.

---

*Your passwords are generated locally in your browser — no server storage, no transmission.*

Made by [Raymond Tetzloff](https://github.com/rptetzloff) with assistance from [Bolt](https://bolt.new) and [Claude Code](https://claude.com/claude-code)
