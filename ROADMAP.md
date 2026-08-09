# Roadmap

Planned work for the password generator, grouped so related items ship together.
Current release: **v2.7.2**.

Findings below were measured against the codebase at `4a9e1c7` — the numbers are
real, not estimates.

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

- [ ] **Extract one shared stylesheet** for design tokens — colors, spacing, radius, shadows, font stack. `docs.html` and `changelog.html` link it instead of redeclaring.
- [ ] **Unify the site header.** `docs.html` and `changelog.html` each hand-roll the same `.site-header` / `.header-nav` markup and styles. The app itself has neither — `index.html` is a 15-line shell and the Vue templates never render a site header, so the generator page has no nav back to Docs or Changelog in the same style. Worth reconciling into one header used everywhere.
- [ ] **Normalize units.** `src/style.css` currently mixes `121` px values against `169` rem values. Anything that should scale with user font size needs to be rem — this is a prerequisite for the zoom/font-size work in Epic 3, not just tidiness.

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

- [ ] **Fix the primary button contrast — this is a live bug, not a nice-to-have.** `src/style.css:118` and `:308` set `background: var(--primary); color: white`, which is 2.77:1. That's every primary button including **Generate Password**. The hover state at 4.10:1 still fails. Body text is fine; it's the accents that fail.
- [ ] **Status colors** — `--success`, `--warning`, `--error` all fail AA on white. They carry meaning (the notification toast), so they need both a passing contrast and a non-color cue (icon or text prefix) to satisfy *Use of Color* (1.4.1).
- [ ] **Announce the notification toast.** `showNotification` (`src/main.js:221`) flips a reactive flag and auto-dismisses after 3s with no `role="status"` / `aria-live`. Screen reader users get no feedback that a password was copied or that validation failed.
- [ ] **Audit ARIA coverage.** Current state: **63** `<label>` elements (genuinely good), but only **2** `aria-hidden`, **1** `alt`, and **zero** `role=` or `aria-label`. The icon-only buttons (copy, regenerate-word, history) need accessible names.
- [ ] **Font size / zoom** — anagrimoire sets `font-size` as a percentage on the root; the same control here gives text scaling for free *once units are rem* (Epic 1). Also verify 200% browser zoom and 320px reflow (1.4.10).
- [x] **Colour-deficiency work** — done, though not as originally written. WCAG does not require colour-blind palettes; it requires (1.4.1) that colour never be the *only* way information is conveyed, which is satisfied because every change group is labelled in text. Making the colours useful rather than merely non-essential is a quality goal, and it is met by measurement: `test/colour-vision.test.js` simulates protanopia, deuteranopia and tritanopia and holds the closest pair above a CIEDE2000 floor. The separation-tuned colours are the default rather than an opt-in palette. Selectable themes moved to Epic 2a, where they belong — that is a preference feature.
- [ ] **Focus visibility** — verify every control has a visible focus ring meeting 3:1 against its background (2.4.11).
- [ ] **`prefers-reduced-motion`** — check the toast and any transitions.
- [ ] **Keyboard traversal** — tab through all seven generators; confirm the tab row exposes arrow-key navigation or is at least fully reachable.

---

## Epic 4 — Word lists

- [ ] **Consider anagrimoire's dictionary as a source.** It searches **39,098** words and already tiers them **Common / Standard / Full**. This project has two disconnected sources: `data/words.json` (2,440 curated words) and `data/wordlist.txt` (the EFF list). A shared tiering vocabulary across both sites would be coherent.
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

- [ ] **Link to anagrimoire.com** from the header or footer.
- [ ] **Lead with the shared privacy stance.** Anagrimoire's framing is "nothing you type into a solver leaves your device"; this project's is "all generation happens in your browser." That's the same promise, and it's a more compelling cross-link than a bare link.
- [ ] **Reciprocal link** from anagrimoire, if you want the pair to read as one family of tools.
- [ ] **Describe the account model accurately — the two sites differ here.** Anagrimoire has optional accounts, used for syncing (stats, streaks, boards) across devices; everything works without signing in. This project has no accounts and, per the owner, **should stay that way**. So the shared line is "works without an account," not "has no accounts." Don't flatten the difference.
- [ ] Both sites are client-side and dependency-free — worth stating once, consistently.

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

Now that there's no build step and Vue plus the icon font are self-hosted, the
site is a service worker away from working fully offline — a natural fit for a
tool whose pitch is that it never talks to a server.

---

## Suggested order

1. **Epic 1** — unblocks 2 and 3, and is mostly mechanical.
2. **Epics 2 + 3 together** — designing palettes once, against contrast targets, is far less work than retrofitting.
3. **Epic 6** — independent of the visual work, so it can run in parallel or slot in anywhere. 6a and 6b are the highest value per unit of effort in the whole roadmap: pure computation over data already in hand, no new dependencies, and 6b corrects a claim the UI currently implies but doesn't deliver.
4. **Epics 4 + 5 together** — both touch anagrimoire, and 6d feeds the rebalancing.
5. Remaining suggestions as appetite allows.
