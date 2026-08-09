# Roadmap

Planned work for the password generator, grouped so related items ship together.

This is planning, not a set of promises. Items get added, reordered and
abandoned, and a ticked box means the work shipped — not that it is perfect.
Epics 1 and 3 sat here fully implemented but unticked for several releases,
which nobody noticed until this file was put on the site with a progress count
beside each epic.

Numbers in here were measured against the codebase rather than estimated, but
they were true when written. Where a measurement has since changed, the entry
usually says so rather than being quietly updated — the trail is the point.

---

## Epic 1 — Design system foundation

**Why first:** everything visual is blocked on this. The palette is currently
declared three separate times, so "add a dark theme" today means editing three
files and keeping them in sync by hand.

| File | Declares its own `:root` palette |
|---|---|
| `src/style.css` | ✅ |
| `docs.html` | ✅ (inline `<style>`) |
| `changelog.html` | ✅ (inline `<style>`) |

- [x] **Extract one shared stylesheet** for design tokens — colors, spacing, radius, shadows, font stack. `docs.html` and `changelog.html` link it instead of redeclaring.
- [x] **Unify the site header.** `docs.html` and `changelog.html` each hand-roll the same `.site-header` / `.header-nav` markup and styles. The app itself has neither — `index.html` is a 15-line shell and the Vue templates never render a site header, so the generator page has no nav back to Docs or Changelog in the same style. Worth reconciling into one header used everywhere.
- [x] **Normalize units.** `src/style.css` currently mixes `121` px values against `169` rem values. Anything that should scale with user font size needs to be rem — this is a prerequisite for the zoom/font-size work in Epic 3, not just tidiness.

> Doing this first turns Epics 2 and 3 into single-file changes.

---

## Epic 2 — Theming: aesthetics, light/dark, palettes

Depends on Epic 1.

**Adopt the contract anagrimoire.com already uses**, so the two sites behave the
same way and you only have to reason about one model:

```html
<html data-theme="dark" data-palette="default" style="color-scheme: dark; font-size: 100%">
```

- [x] **`data-theme`** — `light` / `dark` / `system`, persisted to `localStorage`, applied by a blocking inline script before first paint so there is no flash of the wrong theme.
- [x] **`color-scheme` on the root** so native form controls, scrollbars, and the range sliders follow the theme. Easy to miss; looks broken without it.
- [x] **Theme switcher UI** — a settings gear in the shared header, opening a small panel available on every page.
- [ ] **General aesthetic pass** — the "fix some aesthetics" item. Worth doing *after* the token extraction so changes land in one place. Candidates: the tab row, output field, and slider styling.

### 2a. Colour themes — the fun part

A `data-palette` axis briefly existed with exactly one option, `cvd`, and was
removed: with normal vision it barely differed from the default, so it was a
setting that asked a question most people could not see the answer to. Those
colours are now simply the default (see Epic 3).

The version worth building is the one that was actually wanted — pick a colour
you like:

- [x] **Ship a set of accent themes** — ten: Sky, Blue, Indigo, Violet, Fuchsia, Rose, Emerald, Teal, Slate, Mono. A `data-palette` axis independent of light/dark, so every theme works in both.
- [x] **Include pre-built colour-blind-friendly themes** in the same list rather than a separate mechanism. Blue, Indigo, Violet, Slate and Mono qualify; they sit in the same picker as the rest.
- [x] **Label which themes suit which kind of colour vision, by measuring it.** A theme is marked when its accent stays ≥10 (CIEDE2000) from all three status colours under normal/protan/deutan/tritan in both themes. `src/palettes.js` records the flag and `test/colour-vision.test.js` recomputes it from `tokens.css`, failing if the two disagree — so the marker in the UI cannot become a lie.
- [x] **Gate new themes on the floors.** Every palette clears AA on the accent pairs, on all six badge pairs, on every token pair, and on the change groups, in both themes. Two candidates were rejected by measurement rather than taste: amber at 0.0 from `--warning`, and the first rose at 1.4 from `--error` in dark.
- [x] **Iterate a manifest rather than hand-writing cases.** The suite went from 63 tests to 244 without hand-writing any of the new ones; `PALETTES` drives all of it. A palette present in `tokens.css` but missing from the manifest now fails a test, so it cannot skip coverage.

Still open in 2a:

- [ ] **Raise the separation floor.** Coloured palettes hold the change groups ≥7.0 apart and monochrome ≥6.0, neither of which is a comfortable margin. Both are near the ceiling of what the current fixed group colours allow, so raising the floor means re-deriving that set, not nudging a constant.
- [ ] **Light mode does not tint.** Only dark surfaces follow the palette; in light mode every theme is a white card on a coloured gradient. Tinting light surfaces is harder — they have far less headroom before text drops below 4.5:1.
- [ ] **The accent-vs-status metric is narrow.** It compares one colour against three. It says nothing about the accent against the badge families or the change groups, which is a weaker claim than the eye marker might suggest.

---

## Epic 3 — WCAG compliance

Overlaps heavily with Epic 2 — **build the palettes so they pass, rather than
fixing contrast afterward.** Measured ratios against `--surface` (`#ffffff`):

| Pair | Ratio | AA normal (4.5) | AA large (3.0) |
|---|---|---|---|
| `--text` on surface | 14.63 | ✅ | ✅ |
| `--text-secondary` on surface | 4.76 | ✅ | ✅ |
| **white on `--primary`** | **2.77** | ❌ | ❌ |
| **white on `--primary-dark`** (hover) | **4.10** | ❌ | ✅ |
| `--success` on surface | 2.43 | ❌ | ❌ |
| `--warning` on surface | 2.15 | ❌ | ❌ |
| `--error` on surface | 3.76 | ❌ | ✅ |

- [x] **Fix the primary button contrast — this is a live bug, not a nice-to-have.** `src/style.css:118` and `:308` set `background: var(--primary); color: white`, which is 2.77:1. That's every primary button including **Generate Password**. The hover state at 4.10:1 still fails. Body text is fine; it's the accents that fail.
- [x] **Status colors** — `--success`, `--warning`, `--error` all fail AA on white. They carry meaning (the notification toast), so they need both a passing contrast and a non-color cue (icon or text prefix) to satisfy *Use of Color* (1.4.1).
- [x] **Announce the notification toast.** `showNotification` (`src/main.js:221`) flips a reactive flag and auto-dismisses after 3s with no `role="status"` / `aria-live`. Screen reader users get no feedback that a password was copied or that validation failed.
- [x] **Audit ARIA coverage.** Current state: **63** `<label>` elements (genuinely good), but only **2** `aria-hidden`, **1** `alt`, and **zero** `role=` or `aria-label`. The icon-only buttons (copy, regenerate-word, history) need accessible names.
- [x] **Font size / zoom** — anagrimoire sets `font-size` as a percentage on the root; the same control here gives text scaling for free *once units are rem* (Epic 1). Also verify 200% browser zoom and 320px reflow (1.4.10).
- [x] **Colour-deficiency work** — done, though not as originally written. WCAG does not require colour-blind palettes; it requires (1.4.1) that colour never be the *only* way information is conveyed, which is satisfied because every change group is labelled in text. Making the colours useful rather than merely non-essential is a quality goal, and it is met by measurement: `test/colour-vision.test.js` simulates protanopia, deuteranopia and tritanopia and holds the closest pair above a CIEDE2000 floor. The separation-tuned colours are the default rather than an opt-in palette. Selectable themes moved to Epic 2a, where they belong — that is a preference feature.
- [ ] **Focus visibility** — verify every control has a visible focus ring meeting 3:1 against its background (2.4.11). Mostly done, and deliberately still open: **Epic 7b** found that `.slider` sets `outline: none` and so has no focus ring at all. Not ticked until that is fixed.
- [x] **`prefers-reduced-motion`** — check the toast and any transitions.
- [x] **Keyboard traversal** — tab through all seven generators; confirm the tab row exposes arrow-key navigation or is at least fully reachable.

---

## Epic 4 — Word lists

- [ ] **Adopt the newer wordlist from anagrimoire.com.** A better list has since been built there; this is now the leading candidate rather than a possibility. Before porting it, settle three things:
  - **What it is licensed under and where it came from.** The Legal page lists sources per component, and a new list needs the same treatment as the EFF one.
  - **Whether it replaces one source or both.** This project has two disconnected sources — `data/words.json` (2,440 curated, categorised by part of speech) and `data/wordlist.txt` (the EFF list, flat). Passphrase and Mad Lib need part-of-speech tagging; Words does not. A list without tagging can replace the second but not the first.
  - **What it does to the entropy claim.** See the EFF item below: the "5 dice rolls per word" figure is only true at exactly 7,776 entries. A different list means different maths, and Epic 6a will be displaying that number.
- [ ] **Keep the tiering vocabulary shared.** Anagrimoire tiers its words Common / Standard / Full. Matching that here would let the two sites describe difficulty the same way, and would give Words a "common words only" option that trades entropy for memorability — an honest trade if 6b is showing the cost.
- [ ] **Fix hyphenated entries colliding with the hyphen separator.** The EFF list contains `drop-down`, `felt-tip`, `t-shirt`, `yo-yo`. With the default hyphen separator these produce ambiguous output like `Drop-down-Cat-42` — unclear where the word boundaries are when reading it aloud or retyping it. Either filter them or escape them when the separator is `-`.
- [ ] **Rebalance `words.json` categories.** Current distribution is lopsided, which skews Passphrase/Mad Lib output:

  | Type | Categories | Words |
  |---|---|---|
  | noun | 7 | 1,054 |
  | adj | 6 | 667 |
  | verb | 4 | 381 |
  | adv | 4 | 338 |

- [ ] **Verify the EFF list stays intact.** It's currently exactly 7,776 entries, 3–9 chars, zero duplicates — that's what makes the "5 dice rolls per word" entropy claim true. Any curation must preserve the count or the entropy math changes.

---

## Epic 5 — Cross-link with anagrimoire.com

Small, and pairs naturally with Epic 4 since you'll be in that data anyway.

Mostly done. What remains is one change on the other site and one claim that
should not be made here until it is verified there.

- [x] **Link to anagrimoire.com** from the header or footer. In the footer, on every page, from `src/site-footer.js`.
- [x] **Lead with the shared privacy stance.** The About page's *Elsewhere* section does this rather than offering a bare link: "it works without an account, and nothing you type into a solver leaves your device."
- [x] **Describe the account model accurately — the two sites differ here.** Anagrimoire has optional accounts, used for syncing (stats, streaks, boards) across devices; everything works without signing in. This project has no accounts and, per the owner, **should stay that way**. About uses "works without an account", which is the true shared claim; "no accounts" would have been false of anagrimoire. The distinction matters again in Epic 8e.
- [ ] **Reciprocal link** from anagrimoire, if you want the pair to read as one family of tools. Not in this repository — it is a change on the other site.
- [ ] **State that both are dependency-free**, if it is true of anagrimoire. About currently claims only the client-side and no-account parts, which are the two that were known to hold. Worth adding, but not worth asserting on this site until confirmed of the other.

**Decided against: accounts / cross-device sync for this project.** Recorded so it
doesn't get re-proposed. It also settles adjacent questions — no server-side
settings sync, so `localStorage` stays the only persistence layer, which keeps the
"nothing is transmitted" promise absolute and keeps the history question in the
Suggestions list a purely local one.

---

## Epic 6 — Make strength visible

**The theme:** the app computes strength precisely and shows the user none of it.
Worse, several toggles *look* like they harden a password while adding nothing —
or actively weakening it. Every number below is exact and computable client-side;
none of it needs a network call or a new dependency.

### 6a. Entropy readout

- [ ] **Show bits next to the existing character-count pill.** The pill already exists in the word modes, so this is a natural extension rather than new UI. Character modes are `log2(pool^length)`; word modes are `log2(poolsize) × slots`.
- [ ] **Live delta as settings change.** Show `+6.2 bits` / `−4.0 bits` as sliders move and toggles flip, so the controls teach what they cost.
- [ ] **Entropy floor warning** at a configurable threshold — a quiet nudge, not a blocker.

### 6b. Truth in advertising — which options actually add entropy

This is the highest-value item in the epic. Measured against the current code:

| Option | Entropy effect | Reality |
|---|---|---|
| **Leet substitution** (`a→@`, `e→3`, …) | **0 bits** | `applyLeet` is a **fixed deterministic mapping** — every `a` always becomes `@`. `Th3 c@t` is exactly as strong as `The cat`, against a public, well-known substitution table. |
| **Capitalization** | **0 bits** for 8 of 10 modes | Only `random` (1 bit/char) and `word-random` (1 bit/word) add anything. Title Case, UPPER, lower, alternating, first-only, last-only, last-letter, word-alternating are all deterministic. |
| **Alliteration** (Wireless) | **−4.0 bits** | Measured on the default adj+noun with random categories: 703,018 free combinations (19.4 bits) collapse to 43,659 (15.4 bits). 16× weaker. |
| **Picking a category** vs "random" | **negative** | Narrows the pool — see 6c. |
| **Advanced min/max** constraints | **negative** | Constraining composition always shrinks the space versus free choice. |
| **Numbers** repeat/sequence limits | **negative** | Same — each restriction removes candidates. |

- [ ] **Mark each control with its entropy effect** — adds / neutral / costs. Users are entitled to know that the leet toggle is cosmetic.
- [ ] **Don't remove these options.** Memorability and typeability are legitimate reasons to spend bits. The goal is an informed trade, not a forced one.

### 6c. Cross-mode comparison — the "longer looks stronger" illusion

The app's own modes differ by orders of magnitude in ways length completely hides:

| Password | Looks like | Actual |
|---|---|---|
| Words, 3 EFF words | three words | **38.8 bits** |
| Passphrase, 3 narrow slots (`adv/place` ×3) | three words | **17.7 bits** |
| Numbers, 8 digits | 8 chars | **26.6 bits** |
| Mad Lib, 6 slots | ~45 chars | varies wildly by category |

Two passwords that both read as "three words" differ by **21 bits** — roughly two
million times harder to guess. Nothing in the interface hints at this.

- [ ] **Comparison bar** showing the current password against the other modes at equivalent settings.
- [ ] **Per-slot entropy** in Passphrase and Mad Lib, so a weak slot is visible where it happens.

### 6d. Word pool transparency

Category sizes drive passphrase strength and are invisible today:

| Pool | Words | Bits/slot |
|---|---|---|
| EFF list (Words mode) | 7,776 | **12.93** |
| `noun/animals` (largest) | 227 | 7.83 |
| `adv/place` (smallest) | 60 | **5.91** |

- [ ] **Show pool size and bits/slot** in each category picker. Choosing `adv/place` over the EFF list costs 7 bits *per word*.
- [ ] Ties directly into the Epic 4 rebalancing work.

### 6e. Crack-time estimates — carefully

- [ ] **Only against named attack scenarios**, never a bare "3 million years." Offline fast hash (GPU, ~10¹¹/s), offline slow hash (bcrypt), online throttled. A single unqualified number is misleading, since the same password is trivial in one scenario and infeasible in another.

### 6f. Related transparency items

- [ ] **Bits per character** as an efficiency readout — makes explicit that word modes buy memorability with length.
- [ ] **"Show the math"** expander with the actual calculation. Fits the open-source, inspect-it-yourself posture and costs nothing to maintain.

### 6g. Exclude ambiguous characters

The one item in this epic that is a **feature rather than a readout** — but it
belongs here, because its whole point is making an invisible trade-off explicit.

There is currently no way to avoid `l/1/I` and `O/0`. That matters most for
**Wireless**, whose entire purpose is producing router keys that get read off a
screen and typed on a phone, a games console, or a smart TV remote — the contexts
where a misread `l` is most likely and most annoying.

Measured against the app's actual character sets (91 characters with all types on):

| Exclusion set | Pool | Bits/char | Cost over 20 chars |
|---|---|---|---|
| None (today) | 91 | 6.508 | — |
| **Tight** — `l I 1 \| O 0` | 85 | 6.409 | **2.0 bits** |
| **Wide** — adds `o S 5 Z 2 B 8 G 6` | 76 | 6.248 | 5.2 bits |

**The tight set is nearly free.** Two bits over a twenty-character password is
less than the ~6.5 bits a single extra character buys — so lengthening by one
more than pays for it. That's the framing to put in the UI: not "this weakens
your password," but "costs 2 bits, and +1 character returns 6.5."

- [ ] **Add the toggle**, defaulting to the tight set. Suggest **on by default for Wireless**, off elsewhere.
- [ ] **Show the cost live** using the 6a readout, with the "+1 character covers it" hint.
- [ ] **Handle Numbers mode separately — the wide set would gut it.** Excluding `0 1` leaves 8 digits (3.00 bits each, tolerable); the wide set leaves only `3 4 7 9`, collapsing a digit from 3.32 bits to 2.00 — a 40% loss per character. Either restrict Numbers to the tight set or exclude it from the option entirely.
- [ ] **Decide the scope for word modes.** Ambiguity there comes from the separators, digit suffixes, and any leet substitutions rather than the words, so the option should apply to those inserted characters, not filter the vocabulary.
- [ ] **Apply to the custom symbol set too** — Advanced lets users supply their own symbols, where `|` is the usual offender.

> Explicitly *not* proposed: any breach-corpus check (e.g. Have I Been Pwned).
> Even with k-anonymity it means a network request, which would break the
> "nothing is transmitted" promise — and it's near-useless for random output.

---

## Suggestions

Not requested — take or leave.

### A zero-dependency test suite

Two of the last handful of releases were regression fixes (#51 Wireless crash,
v2.4.1 retry bug), and the v2.7.2 RNG change was verified entirely by driving a
browser by hand. `package.json` currently has **zero dependencies, zero
devDependencies, one script, and no tests**.

The constraint is that you *deliberately* removed the toolchain in v2.7.1, so
this shouldn't reintroduce one. Node's built-in runner (`node --test`) needs no
dependencies. Highest-value first tests: each generator returns non-empty output
for default settings, `randInt` stays uniform and in range, and Advanced honors
its min/max constraints.

### Auto-clear the clipboard

Copy is the primary action, and a copied password sits in the clipboard
indefinitely. An optional "clear after 30s" would match the local-only posture.

### Revisit plaintext history in `localStorage`

Each tab keeps its last 10 passwords in `localStorage` unencrypted, surviving
browser restarts. It's documented, and it's a real convenience — but it's the
weakest remaining link in a client-side-only threat model. At minimum an easy
"clear history" control; possibly session-only as an option.

### Offline / PWA

Moved to **Epic 8b**, which states it properly as app mode: manifest, service
worker and the update path, not just "add a service worker".

---

## Epic 7 — Usability: the site is clunky to operate

The visual layer is in good shape; operating it is not. Everything below was
measured in a browser rather than guessed at, so each item names what is wrong
rather than asking for it to be nicer.

### 7a. Controls too small to hit — WCAG 2.2 SC 2.5.8, Level AA

Target Size (Minimum) requires 24×24 CSS pixels. Measured today:

| control | size | where |
|---|---|---|
| `.slider` thumb | **20×20** | every generator with a length or count |
| `.slider` track | 617×**6** | the drag target is 6px tall until you find the thumb |
| `.checkbox` | **20×20** | five of them on Simple |
| `.slot-arrow` | **22×22** | six on Passphrase, four on Wireless |
| `.slot-remove` | **22×22** | three on Passphrase, two on Wireless |

- [ ] Bring all of these to 24×24 minimum. The slot arrows are the worst of it: 22px targets, sitting side by side inside a pill, on a control people use repeatedly to reorder words.
- [ ] The visually hidden separator radio measures 1×1. That is correct for `sr-only` and exempt, but worth a comment so nobody "fixes" it.

### 7b. The sliders specifically

- [ ] **No focus ring.** `.slider` sets `outline: none`. That selector is (0,1,0), the same specificity as the global `:where(...):focus-visible` ring, and `style.css` loads after `tokens.css` — so it wins on source order and the slider gets no visible focus at all. This is a WCAG 2.4.7 failure that the Epic 3 focus audit missed, and the README's claim of "a single 2px focus ring defined site-wide" is wrong until it is fixed.
- [ ] **Three controls for one number.** Password Length has a slider, a `−`/`+` stepper, and a value readout. Decide which is authoritative and let the others be secondary, or drop one.
- [ ] **No sense of range.** Min and max (6 and 128) are never shown, so the slider gives no feel for where 20 sits. Consider end labels or tick marks at meaningful points.
- [ ] **A 122-step range on a 617px track** is roughly 5px per step, so dragging cannot reliably land on a specific value; the stepper is currently the only precise route. Coarse dragging with fine stepping is the usual answer.

### 7c. Option density

Buttons visible on a single tab, counted:

| tab | buttons |
|---|---|
| **Advanced** | **66** |
| Passphrase | 42 |
| Wireless | 36 |
| Words | 32 |
| Mad Lib | 32 |
| Simple | 14 |
| Numbers | 12 |

- [ ] Advanced presents sixty-six controls at once with no grouping or progressive disclosure. Prefix & Suffix alone is two columns of eleven chips. This is the main source of the clunk.
- [ ] Collapse the rarely-changed groups behind a disclosure, remembering state per generator. Leet Speak, Emoji and Prefix/Suffix are all candidates: they are off by default and most people never touch them.
- [ ] Consider whether Simple and Advanced should be one tab with a "more options" reveal, rather than two tabs that differ mainly in density.

### 7d. Layout and flow

- [ ] **The tab strip wraps to two rows** at desktop width — seven tabs need ~920px but the vertical stack only starts at 768px, so "Numbers" sits alone on a second row. It is honest wrapping rather than a hidden scroll, but it looks accidental.
- [ ] **Generate sits below the options**, so on Advanced you scroll past sixty-six controls to reach the button, then scroll back for the result. A sticky action bar, or the result adjacent to the button, would cut that.
- [ ] **No keyboard shortcut to regenerate.** For a tool people hit repeatedly, something like Enter or `R` would save a lot of pointer travel.

### 7e. Feedback

- [ ] Copy is the only action that confirms itself. Regenerating a single word, clearing history, and changing a setting all happen silently.
- [ ] History entries are clickable but do not look it until hover.

---

## Epic 8 — Beyond the page

> The footer was templated as part of 8a. It had been six hand-written copies
> — five pages plus one inside the Vue template — which had already drifted to
> five different link lists. Both navigations now come from `PAGES` in
> `src/site-nav.js`, so adding a page updates the header and the footer at once.

Everything so far assumes the product is one web page. These do not. They are
listed roughly in order of how far each moves away from that, and the last one
moves furthest.

### 8a. Publish the roadmap on the site — done

- [x] `roadmap.html` alongside About and Legal, using the shared header, footer and `prose-page.css`.
- [x] **It renders this file rather than copying it.** `src/markdown.js` is a small Markdown subset renderer — headings, task lists, tables, code, links — written rather than installed, because a build step and a dependency are both things this project does not have. The page fetches `/ROADMAP.md` at load, so it cannot drift.
- [x] Shipped unedited, including the measured failure ratios and the reasoning. The candour is not a liability; the whole pitch is that you can check the claims.
- [ ] The renderer handles the subset this file uses. If the roadmap grows a construct it does not know, either add it or stop using it -- do not reach for a library.

### 8b. App mode — implement

Supersedes the earlier *Offline / PWA* suggestion; same idea, stated properly.

- [ ] **Web app manifest.** There is none today. Name, icons, `display: standalone`, theme colour. The theme colour should follow the chosen palette, which is a nice touch and a small amount of work now that `--header-bg` is a real opaque token.
- [ ] **Service worker.** No build step, no CDN, and Vue and the icon font are already vendored, so the entire site is cacheable with a plain precache list. It should work fully offline on second load.
- [ ] **This is the strongest fit for the product's pitch.** A generator that never talks to a server has no reason to require a network. Offline is not a feature bolted on, it is the claim made honest.
- [ ] Watch the update path: a cached service worker that never updates is the classic way to strand users on an old build. Cache-first for assets, but check for a new version on load.

### 8c. Browser extension — explore

- [ ] **This is the mechanism for "add straight to my password manager", not a separate item.** See 8d: the web platform cannot do that from a page, and an extension can. If the handoff matters, this is the work.
- [ ] A content script can generate into the focused field of whatever site you are on. The site's own form then submits normally, and the manager's existing save prompt fires by itself — no integration with any specific manager required.
- [ ] Cost is real and ongoing: two stores with two review processes, Manifest V3, and a permissions prompt (`activeTab` at minimum) on a product whose selling point is that it asks for nothing. That last part deserves thought before starting — the extension's permissions are a harder sell than the site's.
- [ ] The generator logic is already dependency-free and DOM-free in `src/lib.js`, so the core would port unchanged.

### 8d. Hand a password directly to a password manager — explore, and probably blocked

- [ ] **Check this before planning around it.** The obvious API does not do what it sounds like. `navigator.credentials.store(new PasswordCredential(...))` saves a credential **for the current origin only** — this site could save a password for `getrandompassword.net` and nothing else. There is no web API for "save this password for `example.com`", by design: it would be a credential-injection primitive.
- [ ] Support is also narrow. `PasswordCredential` is Chromium-only; Firefox and Safari never shipped it. So even the same-origin version reaches a fraction of users.
- [ ] What is actually available from a page is what already exists: copy to clipboard, and letting the manager's own heuristics catch the paste. Everything beyond that needs 8c.
- [ ] Verify the above against current specs before writing it off — this was checked in a Chromium browser and against the API's design intent, not against a fresh reading of every vendor's docs.

### 8e. Password manager mode — explore, and read the tension first

The biggest lift here, and the one that argues with the product.

- [ ] **State the conflict plainly.** The Legal and About pages both say there are no accounts and nothing leaves your device. A manager that syncs needs identity, and identity means accounts. Shipping that quietly would make existing published claims false, which is worse than not shipping it.
- [ ] **Separate storage from sync — they are not the same problem.** A local-only vault in IndexedDB, encrypted with a key derived from a passphrase, needs no account and breaks no promise. It is only *sync across devices* that needs identity. If the valuable part is "keep the passwords I generate here", that may be reachable without ever adding a login.
- [ ] **If sync is genuinely wanted**, the honest form is end-to-end encryption where the server holds ciphertext it cannot read and the account is an opaque sync identifier, not a profile. Note that anagrimoire already has optional accounts for syncing stats — so the shape exists in the family, and the sibling-site framing in Epic 5 already has to explain that difference rather than flatten it.
- [ ] **Do not start this until 8b and 8c are done.** A manager without offline support is unusable, and one without a browser integration is a vault you have to copy out of by hand. Both are prerequisites, and both are useful on their own even if this is never built.
- [ ] **Be honest about the competition.** Bitwarden, KeePass and 1Password exist and are audited. The reason to build this would be a specific thing they do not do, and that reason should be written down here before any code is.

---

## Suggested order

1. **Epic 1** — unblocks 2 and 3, and is mostly mechanical.
2. **Epics 2 + 3 together** — designing palettes once, against contrast targets, is far less work than retrofitting.
3. **Epic 6** — independent of the visual work, so it can run in parallel or slot in anywhere. 6a and 6b are the highest value per unit of effort in the whole roadmap: pure computation over data already in hand, no new dependencies, and 6b corrects a claim the UI currently implies but doesn't deliver.
4. **Epics 4 + 5 together** — both touch anagrimoire, and 6d feeds the rebalancing.
5. Remaining suggestions as appetite allows.

**Epic 7 does not wait its turn.** 7b's missing focus ring is a live WCAG 2.4.7
failure and 7a is a live 2.5.8 failure, both a few lines of CSS. Do those two
next, ahead of everything else here. The rest of Epic 7 — density, flow,
feedback — is design work rather than defect work and can slot in wherever.
