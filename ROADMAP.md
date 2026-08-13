# Roadmap

Planned work for WordLock, grouped so related items ship together.

This is planning, not a set of promises. Items get added, reordered and
abandoned, and a ticked box means the work shipped — not that it is perfect.
Epics 1 and 3 sat here fully implemented but unticked for several releases,
which nobody noticed until this file was put on the site with a progress count
beside each epic.

Numbers in here were measured against the codebase rather than estimated, but
they were true when written. Where a measurement has since changed, the entry
usually says so rather than being quietly updated — the trail is the point.

**How this file is arranged.** Live work is at the top; everything shipped is
archived at the bottom, in the order it was built. The archive is not filler —
it is where the reasoning lives, including the measurements that justified each
decision and the things that were tried and rejected. Nothing was deleted to
make room.

---

## Where this stands

**Done:** Epics 1, 2, 3, 5, 6 and 7 in full, plus 8a, 8b, and now 9a and 9b.
Epic 4's remaining boxes are standing notes rather than work. All of it is in
the archive at the bottom of this file, with the measurements intact.

**Shipped — Epic 9's web half.** The answer to "a standalone generator is a
little lackluster": everything shipped before it perfected the moment of
generation and nothing survived it — the clipboard timer erased the only copy
thirty seconds later. 9a gave that moment somewhere to go (a passphrase-encrypted
local vault, auto-locking, with Keep beside every password) and 9b gave it a way
out (encrypted backup, plus plain JSON and CSV behind a warning, importing from
other managers, and a quiet reminder when the vault has drifted from its last
backup). Both sit on what already existed: the entropy figure, the clipboard
timer, the encryption patterns and the offline shell. 9b's one reversal — that
plain-text export would not be offered — is recorded in place rather than
quietly edited away.

**Next — 9c, the packaged app.** It only became worth its cost once 9a and 9b
were good, and it brings the one thing the web genuinely cannot do: autofill
into other apps. 9b's export file is the bridge between a packaged app's storage
sandbox and the site's, which is why it was built first.

**Reading, not work — Epic 8c/8d/8e.** 8d is a documented dead end (the web
platform cannot hand a password to a manager for another origin, by design),
8c is the desktop half of the same autofill idea 9c covers on mobile, and 8e is
superseded by Epic 9.

**A note on scope, since Epic 9 changes what this product is.** The decision to
let WordLock grow into a password manager was made deliberately and is recorded
in Epic 9's opening, along with the two invariants that constrain it — the
generator stays first-class and stays the front door, and standalone-offline
stays a complete mode rather than a trial. Those are not aspirations to revisit
when a feature gets awkward; they are the conditions under which the rest of
the epic was agreed to. A future reader deciding "just this once" against
either of them should treat that as a scope change requiring the same
deliberation, not an implementation detail.

---

## Epic 9 — The vault, and the app around it

**The theme:** a generator is a moment-tool. You arrive, take a password, and
leave; the moment ends at the clipboard, and thirty seconds later the clipboard
timer erases the only copy. Everything shipped so far makes that moment
excellent. Nothing makes it *stick*. This epic is about what happens after the
password is generated.

### The reason to build it, written down first

8e's last bullet demands a reason before any code. The reason is not "the world
needs a fourth password manager" — Bitwarden, KeePass and 1Password are audited
and synced and better at that than this will be for a long time. It is that
none of them are *present at the moment a password is created*, and none of
them will hold a password without an account somewhere in the story.

**Becoming a password manager is an accepted destination** (decided 2026-08-12),
not something to steer away from. What is not negotiable is how it gets there.
Two invariants bind every item in this epic, and any feature that cannot be
built without breaking one does not get built:

1. **The generator stays first-class and stays the front door.** It is the
   product's name and its reason for existing. It never becomes a modal inside
   a vault, never loses a mode or an option to make room for storage UI, and
   never requires an unlocked vault — or an account — to generate a password.
   Someone who wants nothing but a strong password must be able to arrive,
   generate, copy and leave, exactly as today, forever.
2. **Standalone and offline is always a complete mode, never a trial.** Local
   vault, no account, no network, full function, permanently. If sync is ever
   built it is strictly additive and strictly optional: not a nag, not a
   degraded local experience, not a feature gate. "Works with nothing" is the
   claim the whole site is built on, and a manager that quietly turns it into
   "works, but…" would be a worse product than no manager at all.

Everything else — vault, autofill, biometrics, eventually sync — is fair game
if it can be built inside those two lines.

### 9a. The local vault — storage without identity

8e's key insight, adopted: storage and sync are different problems, and only
sync needs an account. A local vault breaks no published claim.

- [x] **Encrypted with a passphrase you choose**, not with the ambient key
      pattern history uses. History's AES-GCM key sits unextractable in
      IndexedDB, which stops disk-scraping but not someone driving your browser
      profile; a vault must beat that bar. PBKDF2 (or Argon2 if it can be done
      without a dependency) over a user passphrase, iteration count stated in
      the UI, key held in memory only while unlocked.
- [x] **Auto-lock on idle**, with the timeout in the same settings gear as the
      clipboard timer. Locked means the key is gone from memory, not hidden.
- [x] **Save from the generator** — a "keep" action beside copy, storing the
      password, a label, the entropy figure it was generated at, and the date.
      The entropy is already computed and already stored in history; this is
      the same data with a name attached.
- [x] **Never a silent upgrade of history.** History stays what it is: a
      short, ambient-encrypted list of recent output. The vault is a separate,
      deliberate act. Conflating them would quietly change what "History: Off"
      means, and that setting is documented.
- [x] **Ask for persistent storage** via `navigator.storage.persist()` and
      *show the answer*. An installed app usually gets it; a tab may not. A
      vault the browser may evict without warning must say so.
- [x] **Generate from inside the vault**, rather than sending people to the
      generator and back. Any of the seven modes, run with that mode's own
      saved settings, into the password field or any security answer. This is
      what forced the generators out of `main.js` and into `generators.js`:
      the alternative was a second copy of the generation logic, and two
      copies is how the entropy figure starts differing depending on which
      page you generated from. Because it is the same code, an entry made this
      way carries the same exact bits as one filed with Keep.
- [x] **Groups and sorting**, once a vault holds enough to need them. Group is
      free text with suggestions, not a folder tree -- a taxonomy makes every
      new entry a filing decision, which is a real cost for a few dozen
      entries. Sorting is newest, oldest, by name, and weakest-first for
      auditing; entries with no recorded entropy sort to the bottom of that
      last one rather than the top, since an unknown figure is not evidence of
      a weak password and the unknowns would otherwise bury the actionable
      ones. The group picker takes checkboxes rather than a single choice, and
      a "Group them" toggle turns bucketing off entirely -- grouping and
      auditing pull in opposite directions, because weakest-first inside
      groups can leave the vault's worst password halfway down the page.
- [x] **Reused-password detection**, which 9e already permits: local health
      analysis is fine, the remote kind is not. Exact matches only, flagged on
      the entry, summarised above the list, filterable, and warned about while
      editing rather than after saving. It is the one health finding a local
      vault can make with certainty -- everything else about a stored password
      is either a guess or needs a network.
- [x] **Custom fields and one-time codes.** Fields are name/value pairs with a
      secret flag rather than a fixed second username and password, because
      the fixed answer runs out at the first account that wants a PIN. TOTP is
      RFC 6238 over Web Crypto's HMAC -- no dependency -- verified against the
      RFC's own published vectors for SHA-1, SHA-256 and SHA-512.

      TOTP ships with a warning that is not decoration: a one-time code is a
      second factor only while it is kept apart from the first, and storing
      the seed beside the password means one compromise yields both. It is
      still a real gain against the common case, a password leaked at the
      site's end, and it is the trade every password manager offering this
      makes quietly. The difference here is that it is stated above the input,
      before the secret is pasted.

### 9b. Export and import — the portability layer, and the honest sync

- [x] **Encrypted export file.** The vault, sealed with the same passphrase
      scheme, as a single file the user carries. This is the backup story and
      the migration story at once.
- [x] **This is also the sync story, and deliberately so.** The user moves the
      file; no server holds ciphertext, no identity exists to hold. Slower than
      real sync, and the honest trade for the claims on the Legal page.
- [x] **Import merges rather than replaces**, keyed on the password itself, so
      importing an old backup cannot silently delete newer entries.
- [x] **Nag gently about exporting.** A vault living in one browser profile is
      one "clear site data" away from gone. Unexported changes deserve a quiet
      reminder, not a modal.
- [x] ~~**Plain-text export is not offered.**~~ **Reversed, deliberately.**
      The original reasoning still holds about the format: a CSV of passwords
      is what every other manager regrets supporting. What it got wrong was the
      alternative. Refusing any exit but "another copy of WordLock" is lock-in,
      and an escape hatch you cannot use is not an escape hatch -- which is the
      worse failure for a vault with no account behind it, since nobody can
      recover your data for you if you get stuck in it. Plain JSON and CSV both
      ship, behind a confirmation that says exactly what the file is, with
      PLAINTEXT in the filename, and a warning inside the JSON itself. The
      encrypted backup remains the default and the only one the export reminder
      counts. See the header of `src/vault-transfer.js`.

**Richer entries, added along the way.** An entry started as a label, a
password and a note. Storing logins rather than just generated strings needs
username, one or more web addresses, and security questions -- whose answers
are secrets in their own right, get the same reveal/copy/clipboard-wipe
treatment as the password, and come with the reminder that they need not be
true. CSV cannot carry all of that, which is stated where the CSV button is
rather than discovered afterwards.

### 9c. The packaged app — where separation is real

The PWA (8b) is not a second product: installed or in a tab, it is the same
origin and the same storage. A **packaged** app is different — a Capacitor or
Tauri shell has its own WebView storage sandbox, so the app's vault and the
site's vault are genuinely separate installations. That makes 9b's export file
the bridge between them, which is a reason to build 9b first and well.

- [ ] **Porting cost is low.** No build step, no CDN, and `lib.js` is already
      DOM-free; a shell wraps the existing files essentially unchanged. The
      service worker becomes redundant inside the shell.
- [ ] **The feature that justifies the wrapper: autofill.** iOS and Android
      both let a native app register as a credential/autofill provider —
      generate, keep, and fill into *another app's* login form. The web cannot
      do this at all. This is the mobile analog of 8c, and it is the difference
      between a packaged website and something worth installing.
- [ ] **Platform key storage and biometrics.** The vault key can live in the
      Keychain or Keystore, unlocked by Face ID or a fingerprint instead of
      retyping the passphrase — a real improvement over what any web page can
      offer, and the second reason to package.
- [ ] **Count the cost honestly.** $99/year plus review for Apple, $25 plus
      review for Google, code signing, and a release cadence, against a site
      that currently ships by pushing to master. 8c's warning about two stores
      applies here too.
- [ ] **Order: 9a and 9b on the web first.** They work in the browser and the
      PWA immediately, and they are the substance. Wrapping comes after, so
      the packaged version launches with autofill and biometrics rather than
      being the website in a trench coat.

### 9d. Sync, if it ever happens — the conditions

Not parked forever, but conditional. Every one of these is a gate, not a
preference:

- [ ] **Opt-in, and the local mode stays whole.** No account prompt on first
      run, no feature that exists only for synced users, no reminder that
      syncing is available. Invariant 2 is the test: if a local-only user's
      experience is measurably worse after sync ships, sync shipped wrong.
- [ ] **End-to-end encrypted in 8e's shape** — the server holds ciphertext it
      cannot read, and the account is an opaque sync identifier, not a profile.
      No email required, no recovery flow that implies the server can decrypt.
- [ ] **Rewrite Legal and About in the same release**, not afterward. Both
      currently say there are no accounts and nothing leaves your device.
      Shipping optional sync makes the unqualified version of that false even
      for people who never enable it, because the sentence describes the
      software, not the session. The honest replacement distinguishes what the
      software does by default from what it can be asked to do.
- [ ] **9b's export/import ships first and stays.** It is the sync story until
      there is a sync story, and the escape hatch afterward.

**The shape it would take, noted now so it is not designed under pressure.**
None of this is built and none of it should be built yet; it is written down
because the standard zero-knowledge blueprint is well understood and the time
to disagree with parts of it is before there is a server to change. If sync
ever happens, this is the starting point:

- [ ] **Derive once, split twice.** The passphrase stretches to a master key;
      that key is *never* used directly and never leaves the device. Split or
      re-derive it into (a) a symmetric vault key that encrypts entries, and
      (b) a separate authentication hash that is the only derived value the
      server ever sees. The server verifying a login must be unable to derive
      the decryption key from what it was sent — that separation is the whole
      trick, and getting it backwards is the classic way to build a "zero
      knowledge" system that is not one.
- [ ] **The server is a dumb blob store.** Opaque sync identifier, KDF
      parameters, the authentication hash, and the ciphertext. No email
      required, no profile, no password-reset flow — a reset flow that works
      is proof the server can decrypt.
- [ ] **Keep the random per-vault salt; do not switch to email-as-salt.** The
      common design salts with the user's email so a new device can re-derive
      without fetching anything first. That is a convenience workaround with a
      real cost: emails are low-entropy, reused across services, and shared
      between users of the same provider, which makes cross-account rainbow
      tables worth building. A random salt fetched alongside the blob is
      strictly stronger and costs one round trip.
- [ ] **Authenticated encryption stays.** AES-GCM as today, or
      XChaCha20-Poly1305. Never a mode without integrity: a server that can
      flip ciphertext bits undetected is a server that can attack you.
- [ ] **Session tokens in `HttpOnly` cookies**, never in `localStorage`, so
      script cannot read them. Note this is only meaningful once there *is* a
      session; today there are no cookies at all, which is stronger.
- [ ] **Move the crypto into a Web Worker.** Today the vault key is a
      non-extractable `CryptoKey`, which already means script cannot read its
      bytes. With a server in the picture the passphrase-handling path becomes
      worth isolating too — see the memory-sanitisation limits documented in
      Legal, which a worker narrows but does not remove.
- [ ] **The dependency threat gets worse, not better.** A build step and an
      npm tree are the usual companions of a backend, and one compromised
      transitive package in the crypto path ends the product. The current
      answer — zero dependencies, everything vendored and readable — is a
      security property, not just an aesthetic, and giving it up needs a
      better reason than convenience.

### 9e. What stays out regardless

- [ ] **No breach-corpus checks, no password health scoring against remote
      services, no telemetry, no analytics.** All four are normal in a password
      manager and all four need the network for something the user did not ask
      for. Health scoring that runs locally — reused passwords, weak entries,
      age — is fine and needs no server; it is the *remote* version that is out.

### 9f. Hardening the primitives

Neither of these is a defect. Both are places where the honest answer today is
"this is the best available without a trade the project has not agreed to",
and both should be revisited deliberately rather than drifted into.

- [ ] **Argon2id instead of PBKDF2.** PBKDF2 is merely slow; Argon2id is
      memory-hard, which is the property that actually blunts a GPU or ASIC
      attack. No number of PBKDF2 iterations substitutes, because iterations
      change the attacker's constant and not their parallelism.

      Why not yet: Web Crypto does not implement it — `deriveBits` offers
      PBKDF2, HKDF and ECDH only — so it arrives as a WebAssembly blob in the
      single most security-critical path in the product, for a project whose
      pitch is that you can read the source. Doable, but the work *is* the
      provenance: a pinned reproducible build, a recorded hash, and a note in
      Legal about what is being trusted. A hand-written JS implementation is
      not the answer; it would be slow enough to need parameters that give the
      memory-hardness back.

      The migration is already built: the KDF parameters travel inside each
      envelope, so adding `name: 'Argon2id'` with `m`/`t`/`p` leaves every old
      vault opening on PBKDF2, and `needsRekey()` upgrades them on the next
      passphrase change.

- [x] **Iterations raised to 1,000,000** (from OWASP's 2023 floor of 600,000),
      and deliberately not to 10,000,000. Measured on a 2026 desktop, PBKDF2
      costs ~0.1ms per thousand iterations: 600k is 54ms, 1M is 93ms, 10M is
      1032ms. Attacker cost is linear, so 600k → 10M is 16.7×, or **4.1 bits**
      — less than one extra random lowercase letter — bought with a full
      second of unlock latency on a fast machine and several on a phone. One
      more word in the passphrase beats the entire trade for free. The bump to
      1M is about staying clear of the floor as hardware improves, not about
      the bits, and the code comment says so.

- [ ] **Recovery codes, if the case for them survives this.** Asked for, with
      the suspicion that the security model forbids it. It does not -- but the
      version most people picture is the unsafe one, so the constraints matter
      more than the feature.

      How it would work: generate a high-entropy recovery key, wrap the vault
      key under it, and store that second wrapped copy in the envelope
      alongside the passphrase-derived one. Either key opens the vault.

      The constraint that makes it safe: **the recovery key must be generated,
      never chosen.** An attacker takes whichever path is cheaper, so the
      vault's strength becomes the *weaker* of the two. A user-chosen recovery
      phrase would therefore lower the security of every vault that has one,
      silently, no matter how good the passphrase is. At 128 bits of generated
      randomness the recovery path is not attackable at all and the passphrase
      remains the binding constraint -- so it costs nothing. Between those two
      is a trap: anything memorable is anything guessable.

      The argument against building it: **the encrypted backup already is
      this.** Export the vault, keep the file, keep the passphrase safe --
      that is recovery, with no second key path and no extra surface. A
      recovery code adds a permanent second door to protect against forgetting
      the first, and a written-down 128-bit key you must not lose is the same
      storage problem as a backup file you must not lose.

      The argument for: the backup only restores what it contained. A recovery
      key opens the vault *in front of you*, including everything added since
      the last export -- which is exactly the gap the backup reminder keeps
      pointing at. That is a real difference, not a cosmetic one.

      Not started. If it happens: generated only, shown once, with the same
      write-it-down gate the adopt flow uses, a clear statement that it is a
      second key to everything, and a way to revoke it by re-keying.

- [ ] **Drop `'unsafe-eval'` from the CSP.** The policy shipped with hashes
      for every inline script and `connect-src 'self'`, which is the directive
      that matters here: whatever runs, it has nowhere to send anything. But
      `'unsafe-eval'` had to stay, because components are declared with Vue's
      `template:` option and Vue compiles those at runtime through
      `new Function` — measured, not assumed: without it every page renders
      blank.

      Removing it means precompiling templates to render functions, which
      means a build step. That is a bigger decision than the CSP, and it
      trades a real property (the deployed site is the readable source) for a
      bounded gain — reaching `eval` requires already executing script, which
      the hash list is what prevents. Revisit if a build step arrives for
      another reason; do not add one for this alone.

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

- [x] **Web app manifest.** Shipped: name, both icons (SVG any-size plus the 200px mark), `display: standalone`, and the theme color follows the chosen palette — theme.js syncs the theme-color meta from the computed `--header-bg` on every theme or palette change.
- [x] **Service worker.** Shipped: a plain precache list covering every page, script, stylesheet, wordlist and vendored asset. Fully offline on second load. A test walks the filesystem both ways — everything listed exists, everything servable is listed — and caught three files that would have 404d offline before the first commit.
- [x] **This is the strongest fit for the product's pitch.** A generator that never talks to a server has no reason to require a network. Offline is not a feature bolted on, it is the claim made honest.
- [x] Watch the update path: the cache is named after the version, the version is pinned to package.json by a test (so bumping it is part of the release, not a thing to remember), the browser refetches sw.js on navigation, and activate() drops old caches. Cache-first within a version, never across versions.

### 8c. Browser extension — explore

- [ ] **This is the mechanism for "add straight to my password manager", not a separate item.** See 8d: the web platform cannot do that from a page, and an extension can. If the handoff matters, this is the work.
- [ ] A content script can generate into the focused field of whatever site you are on. The site's own form then submits normally, and the manager's existing save prompt fires by itself — no integration with any specific manager required.
- [ ] Cost is real and ongoing: two stores with two review processes, Manifest V3, and a permissions prompt (`activeTab` at minimum) on a product whose selling point is that it asks for nothing. That last part deserves thought before starting — the extension's permissions are a harder sell than the site's.
- [ ] The generator logic is already dependency-free and DOM-free in `src/lib.js`, so the core would port unchanged.

### 8d. Hand a password directly to a password manager — explore, and probably blocked

- [ ] **Check this before planning around it.** The obvious API does not do what it sounds like. `navigator.credentials.store(new PasswordCredential(...))` saves a credential **for the current origin only** — this site could save a password for `wordlock.net` and nothing else. There is no web API for "save this password for `example.com`", by design: it would be a credential-injection primitive.
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

> **Superseded by Epic 9.** 8e asked whether this should exist and set the
> conditions. Epic 9 answers yes -- becoming a password manager is an accepted
> destination -- and replaces "do not build it" with two invariants that bind
> how: the generator stays first-class and stays the front door, and
> standalone-offline stays a complete mode rather than a trial. Sync remains
> conditional rather than parked; see 9d for the gates. Read 8e for the
> tension, Epic 9 for the plan.

---

## Shipped — the archive

Everything below is done, in build order. Epics 1, 2, 3, 5, 6, 7 and Epic 8's
first two sections are complete; Epic 4's remaining boxes are standing notes
rather than work — sources worth watching, a recall ceiling, and a length
observation that only matters if a cap is ever introduced.

Kept in full rather than summarised, because the measurements and the rejected
alternatives are the useful part: the contrast ratios that failed, the
CIEDE2000 figures behind the color-blind marker, why WordNet lexname tagging
was abandoned, why Orchard Street Medium was declined.

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
- [x] **General aesthetic pass** — largely superseded by later work: the tab row became the tile switcher (v2.21.1), the sliders got end labels, hover halos and a real focus ring (7b), and the output field got its final touches in v2.23.0 — letter-spacing so rn never reads as m, and user-select: all so one click grabs the whole password.

### 2a. Color themes — the fun part

A `data-palette` axis briefly existed with exactly one option, `cvd`, and was
removed: with normal vision it barely differed from the default, so it was a
setting that asked a question most people could not see the answer to. Those
colors are now simply the default (see Epic 3).

The version worth building is the one that was actually wanted — pick a color
you like:

- [x] **Ship a set of accent themes** — ten: Sky, Blue, Indigo, Violet, Fuchsia, Rose, Emerald, Teal, Slate, Mono. A `data-palette` axis independent of light/dark, so every theme works in both.
- [x] **Include pre-built color-blind-friendly themes** in the same list rather than a separate mechanism. Blue, Indigo, Violet, Slate and Mono qualify; they sit in the same picker as the rest.
- [x] **Label which themes suit which kind of color vision, by measuring it.** A theme is marked when its accent stays ≥10 (CIEDE2000) from all three status colors under normal/protan/deutan/tritan in both themes. `src/palettes.js` records the flag and `test/color-vision.test.js` recomputes it from `tokens.css`, failing if the two disagree — so the marker in the UI cannot become a lie.
- [x] **Gate new themes on the floors.** Every palette clears AA on the accent pairs, on all six badge pairs, on every token pair, and on the change groups, in both themes. Two candidates were rejected by measurement rather than taste: amber at 0.0 from `--warning`, and the first rose at 1.4 from `--error` in dark.
- [x] **Iterate a manifest rather than hand-writing cases.** The suite went from 63 tests to 244 without hand-writing any of the new ones; `PALETTES` drives all of it. A palette present in `tokens.css` but missing from the manifest now fails a test, so it cannot skip coverage.

Still open in 2a:

- [x] **Raise the separation floor.** Re-derived both group sets with a wider search: semantic hue windows (added reads green, removed reads red), AA against every palette surface, and a reads-as-a-color constraint (Lab chroma ≥ 28, ΔE ≥ 15 from body text). The weakest pair for any vision went from 7.3 to ~16 — past the ~10 at which side-by-side colors stop being confusable — and the test floor now pins 15.5. Monochrome stays at 6.0: that is the ceiling of five AA-legal grays, not slack.
- [x] **Light mode does not tint.** It does now: every colored palette carries a measured tint of its accent in --surface and --background, budgeted by the tightest AA pair (--error on --surface had 0.33 of headroom, so surfaces stay above ~0.93 relative luminance). All twenty palette/theme contexts still clear every AA pair in the suite. Mono keeps true neutrals.
- [x] **The accent-vs-status metric is narrow.** Measured the wider families and resolved it as scope, not a wider floor. Several accents sit near or exactly on a badge or group color by design — the sky accent IS the sky badge foreground (ΔE 0.0) — which is reuse, not confusion: categories and badges always carry text labels, so hue never bears their meaning alone, while status colors are signals and keep the floor. A test now pins the eye marker tooltip to naming exactly the status colors, so the claim can never outrun the measurement, and docs state what the marker deliberately does not cover.

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
- [x] **Color-deficiency work** — done, though not as originally written. WCAG does not require color-blind palettes; it requires (1.4.1) that color never be the *only* way information is conveyed, which is satisfied because every change group is labelled in text. Making the colors useful rather than merely non-essential is a quality goal, and it is met by measurement: `test/color-vision.test.js` simulates protanopia, deuteranopia and tritanopia and holds the closest pair above a CIEDE2000 floor. The separation-tuned colors are the default rather than an opt-in palette. Selectable themes moved to Epic 2a, where they belong — that is a preference feature.
- [x] **Focus visibility** — verify every control has a visible focus ring meeting 3:1 against its background (2.4.11). Mostly done, and deliberately still open: **Epic 7b** found that `.slider` sets `outline: none` and so has no focus ring at all. Not ticked until that is fixed.
- [x] **`prefers-reduced-motion`** — check the toast and any transitions.
- [x] **Keyboard traversal** — tab through all seven generators; confirm the tab row exposes arrow-key navigation or is at least fully reachable.

---

## Epic 4 — Word lists

**Decided: two files, two sources, kept apart on purpose.**

| file | feeds | source | license |
|---|---|---|---|
| the flat list | Words mode | [Orchard Street Long](https://github.com/sts10/orchard-street-wordlists) | CC BY-SA 4.0 |
| `data/words.json` | Passphrase, Wireless, Mad Lib | curated here, grown from [imsky/wordlists](https://github.com/imsky/wordlists) (MIT) and [verachell's part-of-speech lists](https://github.com/verachell/English-word-lists-parts-of-speech-approximate) (Unlicense) | MIT |

They never mix. Orchard Street is ShareAlike, so anything it touches inherits
that; `words.json` is the one genuinely original asset in this project and stays
MIT. Blending them would relicense hand-written work to gain words that measured
badly anyway — see the rejected approach below.

### 4a. Words mode → Orchard Street Long — done

- [x] Replace `data/wordlist.txt` (EFF Long, 7,776 words) with Orchard Street Long (17,576).
- [x] **Entropy goes 12.925 → 14.101 bits per word.** The "5 dice rolls per word" line in the docs and README dies with the EFF list: 7,776 is 6⁵ and 17,576 is 26³. The new framing is three letters per word, or just the bit count. Epic 6a will display this, so 4a lands first.
- [x] **It is uniquely decodable, and that fixes a real hole.** The separator menu offers **None**. With the EFF list, concatenated words could parse more than one way; Orchard Street cannot. Said plainly on About and in the README rather than left as a silent property — and **verified rather than quoted**: `test/wordlist.test.js` runs Sardinas–Patterson over the list on every build, so the claim is checked rather than inherited from the upstream README. The naive form of that check took 9.5s, longer than the entire rest of the suite; indexing by prefix brought it to 32ms.
- [x] Retires the hyphenated-entries item below: Orchard Street has no `drop-down`, `t-shirt` or `yo-yo`.
- [x] Legal needs a new entry: CC BY-SA 4.0, sts10, derived from Wikipedia and Google Books frequency data. Note explicitly that ShareAlike binds that file and not the MIT code.
- [x] Consider offering **Orchard Street Medium** — rejected. Trading 1.1 bits per word for rounder arithmetic optimizes the wrong thing: the user never does the arithmetic (the entropy panel does), and Long's unique decodability claim is what the tests actually pin. One list, the stronger one.

### 4b. Grow `words.json` from curated lists — done

Shipped. **2,440 → 4,627 words**, and two new categories. Final counts:

| slot | was | now | | slot | was | now |
|---|---|---|---|---|---|---|
| noun.tech | 131 | **506** | | adj.mood | 129 | **228** |
| noun.food | 189 | **399** | | adj.texture | 117 | **169** |
| noun.animals | 227 | **359** | | adj.colors | 130 | **149** |
| noun.places | 126 | **327** | | adj.time | 87 | **120** |
| noun.nature | 134 | **274** | | adj.weather | 104 | **113** |
| noun.music | — | **194** *(new)* | | adj.size | 100 | **106** |
| noun.vehicles | 112 | **166** | | verb.action | 119 | **216** |
| noun.jobs | 135 | **158** | | verb.movement | 96 | **145** |
| noun.sports | — | **128** *(new)* | | verb.cognition | 82 | **138** |
| adv.manner | 129 | **339** | | verb.nature | 84 | **120** |

- [x] Merge with review, not wholesale.
- [x] Music and Sports added as noun categories, in `CATEGORY_META` and in the data.
- [x] Words may belong to several categories — *golden* is a color and a weather word — so there is no cross-category dedupe. 193 nouns, 96 adverbs and 51 adjectives are in more than one.
- [ ] Keep hunting for other permissively licensed topical lists. This is now the only route for slot vocabulary, so the sources matter.

**Reviewing the merge was the part that mattered.** Four of the source mappings
were wrong, found by reading the files rather than trusting their names:

| imsky file | mapped to | actually contains | fix |
|---|---|---|---|
| `nouns/driving` | vehicles | roads — *alley, boulevard, freeway* | → places |
| `adjectives/quantity` | size | determiners — *all, each, every, few* | dropped |
| `military_*`, `filmmaking`, `writing` | jobs | equipment and craft jargon — *artillery, bilge, bogey, backstory* | dropped |
| `nouns/astronomy` | nature | particle physics — *hadron, lepton, flux* | dropped |

Left uncorrected, `jobs` would have been 500 words of which most were not jobs.
It is 158 now, and they are all occupations.

**Five misspellings came in from upstream** and are corrected on import:
*liason* → liaison, *corgie* → corgi, *emrasure* → embrasure, *banylus* →
banyuls, *gallerie* → gallery. Found by checking every added word against
WordNet, Orchard Street and verachell's noun list, then reading the 105 that
appeared in none of them — the rest were legitimate specialist vocabulary
(*barolo*, *provolone*, *voxel*, *vocoder*, *knurled*).

**42 generic additions were kept deliberately** rather than filtered: `tech`
gains *app, bug, build, code, data, commit*; `verb.action` gains *build, file,
merge, save*. That is 1.8% of what was added, listed here so it can be pruned
later if it grates.

Two defects in the existing data, fixed while it was open:

- [x] **`jalapeño`** was the only non-ASCII entry. Awkward to type, and rejected outright by some sites. Now *jalapeno*, and a test rejects anything outside `a-z`.
- [x] **The `random` option was not uniform.** It flattened the categories without deduping, so a word in two categories was drawn twice as often. `allOf()` in `main.js` dedupes at selection time, which keeps the memberships in the data while making the draw even.

### 4c. Adverbs — sourceable after all, with one filter — done

This section previously said adverbs had no source, on the evidence of imsky
(no adverbs directory) and WordNet (4,482 adverb lemmas but exactly **one**
adverb lexicographer category, so it can say a word is an adverb and nothing
about what kind). [verachell's lists](https://github.com/verachell/English-word-lists-parts-of-speech-approximate)
are released under the **Unlicense** — public domain, the most permissive of
anything considered here — and change that.

- [x] **Use `ly-adverbs.txt`, not `mostly-adverbs.txt`.** The repository warns its tags are approximate, and that shows: the general adverb file leaks adjectives — *developmental*, *almighty*, *powerful*, *prenatal*, *ninth* all appear. The `-ly` file is 2,033 entries, verified 100% `-ly`-suffixed, and the sample reads clean: *unanimously, abruptly, hastily, intentionally, furiously, generously*.
- [x] **`adv.manner` goes 129 -> 339** after the full review below; still 7.01 -> 8.41 bits on the slot.
- [x] **The other three buckets: partly solved.** WordNet has no adverb categories, but its
  glosses are formulaic -- a manner adverb is defined as "in a X manner", a degree adverb as
  "to a X degree" -- so the definitions classify what the lexnames cannot. Two things were
  needed to make it usable: strip WordNet's example sentences first (they matched on ordinary
  words like "there" and put *quietly* in place), and treat the result as a shortlist rather
  than a verdict. At 76% precision it was worth reading all 34 candidates by hand: *brilliantly*
  and *furiously* are manner definitions that merely contain a degree word, and *newly* ("very
  recently") is time. 33 words moved -- 30 to intensity, 2 to time, 1 to place.
- [x] **Then the whole adverb set was reviewed, word by word.** Every entry judged against
  a functional test (manner = works after an action verb; intensity = modifies an
  adjective; time = answers when; place = answers where) rather than against WordNet
  glosses alone. About 130 words re-filed, 16 removed as not adverbs at all -- including
  *supply*, which is "supple"+ly in a dictionary and the noun everywhere else, and the
  prepositions *toward* and *beside* that sat in place. Final: manner 339, intensity 123,
  time 86, place 64. The ~100 stance, focus, link and viewpoint adverbs (*admittedly*,
  *mostly*, *consequently*, *academically*) were then dropped outright rather than given
  buckets of their own -- none of them work where a passphrase puts an adverb, and
  "Crimson-Consequently42" is nobody's password. Twelve genuine duals stay in manner
  (*clearly*, *honestly*, *oddly*, *strictly*, *similarly*...).
- [ ] **Recall is still the limit.** 338 of 698 adverbs match no pattern at all, and time and
  place gained almost nothing. Those two buckets remain essentially hand-written.
- [x] Confidence check that the list is sane: **289 of the current 321 curated adverbs already appear in it**, a 90% overlap with a list built independently.
- [x] The same repository has 13,426 nouns, 9,001 adjectives and 6,065 infinitive verbs, all public domain. Mined in v2.24.0, with the list used as the voucher rather than the shovel: broad hand-written topic vocabularies were intersected against it (own POS list, then the union, then a short explicit override list for real words the 2019-era source lacks), yielding +371 across nine categories — jobs 158 → 215, music 194 → 257, movement 145 → 207. Total slot vocabulary: 5,183.

### Rejected: tagging a flat list with WordNet lexnames

Built and measured before being dropped. The pipeline worked — Orchard Street
tagged by Open English WordNet 2024 gave 8,289 slot words against 2,440 — but
the output was unusable, because a WordNet lexname reflects *any* sense of a
word however rare:

```text
verb.action     shapes, burden, character, beak, sculpture, segment
verb.cognition  occult, remembers, import, bulletin, correspond
noun.jobs       sortie, ball, creole, oracle
```

`beak` and `sculpture` are verbs only in senses nobody uses; `remembers` is an
inflected form; `sortie` is not a job. Passphrase and Mad Lib exist to produce
something that reads like language, and this would have read like a thesaurus
accident. Restricting to each word's *primary* sense (WordNet orders senses by
frequency, and `cntlist` ships the counts) would cut most of the noise — worth
revisiting only if 4b's curated sources run dry.

Two side findings from that work, both still true:

- [x] **32 adjectives and 17 adverbs appear in two categories at once** — `golden` is in colors and weather, `acutely` in manner and intensity. The `random` category does `Object.values(cats).flat()` with no dedupe, so those words are drawn twice as often as the rest. It overstates the adjective pool by about 0.1 bits. Small, but it is exactly the kind of thing **6b** is meant to be honest about.
- [ ] Ten curated adverbs are longer than 12 characters (*diplomatically*, *unflinchingly*). Only matters if a length cap is ever applied to slot words; noted so it is not discovered by truncation.

### Still open from before

- [x] **Rebalance `words.json` categories.** Done in v2.23.0: +185 hand-curated words across the eight thinnest categories, validated by the 4c semantic tests and deduped type-wide. The floor rose most where it mattered — adv/place 64 → 115 (5.9 → 6.8 bits/slot), verb/nature 120 → 155, adv/intensity 123 → 154. imsky was measured first and found exhausted (its leftovers were determiners and geometry jargon).
- [x] **Verify whatever ships as the flat list stays intact.** Already true: test/wordlist.test.js pins the count (exactly 17,576), the 14.101 bits/word the site claims, the a–z/3–15/no-duplicates properties, separator safety, and unique decodability via Sardinas–Patterson. Ticked on inspection rather than new work.

---

## Epic 5 — Cross-link with anagrimoire.com

Small, and pairs naturally with Epic 4 since you'll be in that data anyway.

Mostly done. What remains is one change on the other site and one claim that
should not be made here until it is verified there.

- [x] **Link to anagrimoire.com** from the header or footer. In the footer, on every page, from `src/site-footer.js`.
- [x] **Lead with the shared privacy stance.** The About page's *Elsewhere* section does this rather than offering a bare link: "it works without an account, and nothing you type into a solver leaves your device."
- [x] **Describe the account model accurately — the two sites differ here.** Anagrimoire has optional accounts, used for syncing (stats, streaks, boards) across devices; everything works without signing in. This project has no accounts and, per the owner, **should stay that way**. About uses "works without an account", which is the true shared claim; "no accounts" would have been false of anagrimoire. The distinction matters again in Epic 8e.
- [x] **Reciprocal link** from anagrimoire — done on the other site (confirmed 2026-08-12). The pair now reads as one family: each links the other, and both say the same true thing about staying client-side.
- [x] **State that both are dependency-free** — resolved by not stating it. Confirmed 2026-08-12: anagrimoire leans on CDNs, as its kind of site reasonably does, so the shared claim would be false. About already asserts only what holds for both — client-side solving and no account required — and that is exactly where it stays. Asserting only what is verified was the point of leaving this open.

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

- [x] **Show bits next to the existing character-count pill.** The pill already exists in the word modes, so this is a natural extension rather than new UI. Character modes are `log2(pool^length)`; word modes are `log2(poolsize) × slots`.
- [x] **Live delta as settings change.** Show `+6.2 bits` / `−4.0 bits` as sliders move and toggles flip, so the controls teach what they cost.
- [x] **Entropy floor warning** — shipped as a quiet nudge at a fixed 40 bits. Deliberately not configurable yet; a setting nobody has asked for is clutter, and the threshold lives in one exported constant when someone does.

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

- [x] **Mark each control with its entropy effect** — done in the breakdown panel rather than as per-control badges: every option appears as a line with its bits, zero-bit options carry a plain-words note ("fixed mapping — adds nothing"), and alliteration states its measured cost. One place to look instead of ten scattered markers.
- [x] **Don't remove these options.** Memorability and typeability are legitimate reasons to spend bits. The goal is an informed trade, not a forced one.

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

- [x] **Comparison bar** showing the current password against the other modes at equivalent settings. Delivered as comparison lines at the foot of the breakdown: the same-length random-characters ceiling for every non-character mode, and for slot modes the flat-list figure at the same word count.
- [x] **Per-slot entropy** in Passphrase and Mad Lib, so a weak slot is visible where it happens. The breakdown itemizes every slot with its pool size and bits.

### 6d. Word pool transparency

Category sizes drive passphrase strength and are invisible today:

| Pool | Words | Bits/slot |
|---|---|---|
| EFF list (Words mode) | 7,776 | **12.93** |
| `noun/animals` (largest) | 227 | 7.83 |
| `adv/place` (smallest) | 60 | **5.91** |

- [x] **Show pool size and bits/slot** in each category picker. Done — every picker option reads like *Colors — 149 · 7.2 bits*. Choosing `adv/place` over the EFF list costs 7 bits *per word*.
- [x] Ties directly into the Epic 4 rebalancing work — which happened: v2.23.0 and v2.24.0 rebalanced and grew the pools the pickers price.

### 6e. Crack-time estimates — carefully

- [x] **Only against named attack scenarios**, never a bare "3 million years." Shipped with three scenarios and stated rates; times are average-case and each row names its attack on hover. Offline fast hash (GPU, ~10¹¹/s), offline slow hash (bcrypt), online throttled. A single unqualified number is misleading, since the same password is trivial in one scenario and infeasible in another.

### 6f. Related transparency items

- [x] **Bits per character** as an efficiency readout — makes explicit that word modes buy memorability with length. Shown against the same-length random-characters ceiling.
- [x] **"Show the math"** expander — the "how?" breakdown under each password is exactly this: every random draw priced, per generator.

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

- [x] **Add the toggle**, defaulting to the tight set. Done — on by default for Wireless, off elsewhere.
- [x] **Show the cost live** using the 6a readout, with the "+1 character covers it" hint. Done — the breakdown line reads *costs 2.6 bits — one more character returns 6.3*.
- [x] **Handle Numbers mode separately — the wide set would gut it.** Resolved by excluding Numbers entirely: an all-digit code has no letters for 0/1 to be confused with, so the exclusion would cost bits and buy nothing. Docs say so. Excluding `0 1` leaves 8 digits (3.00 bits each, tolerable); the wide set leaves only `3 4 7 9`, collapsing a digit from 3.32 bits to 2.00 — a 40% loss per character. Either restrict Numbers to the tight set or exclude it from the option entirely.
- [x] **Decide the scope for word modes.** Decided: the option filters the random separator/prefix/suffix draws only. The vocabulary passes through (it is the words' job to be words), as do literals and custom text (typed on purpose). Leet also passes through — its substitutions are per-character opt-in already. Ambiguity there comes from the separators, digit suffixes, and any leet substitutions rather than the words, so the option should apply to those inserted characters, not filter the vocabulary.
- [x] **Apply to the custom symbol set too** — Advanced lets users supply their own symbols, where `|` is the usual offender.

> Explicitly *not* proposed: any breach-corpus check (e.g. Have I Been Pwned).
> Even with k-anonymity it means a network request, which would break the
> "nothing is transmitted" promise — and it's near-useless for random output.

---

## Epic 7 — Usability: the site is clunky to operate

The visual layer is in good shape; operating it is not. Everything below was
measured in a browser rather than guessed at, so each item names what is wrong
rather than asking for it to be nicer.

### 7a. Controls too small to hit — WCAG 2.2 SC 2.5.8, Level AA — fixed

Target Size (Minimum) requires 24×24 CSS pixels. All of these now size from
`--control-min`, so raising that token raises every one of them at once. The
table is kept as the record of what was measured before the fix:

| control | size | where |
|---|---|---|
| `.slider` thumb | **20×20** | every generator with a length or count |
| `.slider` track | 617×**6** | the drag target is 6px tall until you find the thumb |
| `.checkbox` | **20×20** | five of them on Simple |
| `.slot-arrow` | **22×22** | six on Passphrase, four on Wireless |
| `.slot-remove` | **22×22** | three on Passphrase, two on Wireless |

- [x] Bring all of these to 24×24 minimum. The slot arrows are the worst of it: 22px targets, sitting side by side inside a pill, on a control people use repeatedly to reorder words.
- [x] The visually hidden separator radio measures 1×1. That is correct for `sr-only` and exempt, but worth a comment so nobody "fixes" it. Commented in `src/style.css`.
- [x] **The slider needed rebuilding, not resizing.** The input *was* the visible bar — 6px tall — so the whole element was the undersized target. It is now `--control-min` tall and transparent, with the thin bar drawn by the track pseudo-element inside it. Same appearance, four times the target.
Not a task: **footer links are 22px tall**, and were checked rather than
assumed. They pass under SC 2.5.8's spacing exception — 55px between the
closest centers, against the 24px the exception requires — so they are left
alone.

### 7b. The sliders specifically

- [x] **No focus ring — fixed.** `.slider` set `outline: none`. That selector is (0,1,0), the same specificity as the global `:where(...):focus-visible` ring, and `style.css` loads after `tokens.css`, so it won on source order and the sliders had no visible focus at all — a WCAG 2.4.7 failure the Epic 3 audit missed. `.slider:focus-visible` now sets the ring explicitly rather than deleting the offending line and trusting the global rule, so the next person reaching for `outline: none` on a range input sees why it is not there. Verified with a real keyboard focus, not a programmatic one: `.focus()` does not trigger `:focus-visible`, which is part of why this went unnoticed. This also closes the last open item in **Epic 3**.
- [x] **Three controls for one number.** Decided: all three stay, each with one job — the slider is the coarse control, the stepper is the fine one, the readout displays. Dropping any of them removes a real path (touch drags, keyboard steps, glance).
- [x] **No sense of range.** End labels now flank every standalone slider — 6…128, 2…20, 4…32, 2…5 — so the thumb position reads as a value, not a vibe.
- [x] **A 122-step range on a 617px track** — resolved as the design rather than despite it: coarse dragging with fine stepping is the answer, the split above makes it deliberate, and the end labels make the coarseness legible.

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

- [x] Advanced presents sixty-six controls at once — addressed by the disclosure work below plus the sticky Generate bar; the min/max grid itself stays visible because per-type control IS what the Advanced tab is for.
- [x] Collapse the rarely-changed groups behind a disclosure, remembering state per generator. Prefix & Suffix and Leet Speak & Emoji collapse in all four word modes, Emoji in Advanced; open state persists per generator, and a collapsed group that is doing something says **in use** on its header.
- [x] Considered and rejected: merging Simple into Advanced buries the one tab whose whole value is having nothing to learn. The density complaint is answered by disclosure and the sticky bar instead.

### 7d. Layout and flow

- [x] **The tab strip wraps to two rows** — fixed: between 769px and 960px the tabs shrink (padding and font) instead of wrapping, so all seven stay on one row at every width above the mobile stack.
- [x] **Generate sits below the options** — the Generate card is now position: sticky at the viewport bottom, so it stays under your thumb while the options scroll past -- and since v2.20.0 the password box, copy button and strength readout ride in the same bar, so the result is visible where the button is. A pin on the bar puts it back into normal flow for anyone who prefers it fixed.
- [x] **No keyboard shortcut to regenerate.** `R` regenerates on whichever tab is active, suppressed while any form control has focus so typing a custom separator never fires it. Enter was rejected: it already means "activate the focused control".

### 7e. Feedback

- [x] Copy is the only action that confirms itself — every regeneration (full or single-word swap) now flashes a brief tint on the fresh value, disabled under prefers-reduced-motion. Toasts for ordinary setting changes were considered and rejected as noise: the password rebuilding is the confirmation.
- [x] History entries are clickable but do not look it until hover — they now rest with a visible border and background like the buttons they are, and the border answers in the accent color on hover.

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

### Auto-clear the clipboard — done

Shipped in v2.20.0 as a gear setting (Keep / 30s / 60s / 2 min, off by
default). The wipe is blunt by design: it overwrites whatever is in the
clipboard at the deadline rather than asking permission to read it first, and
it waits for focus if the page is backgrounded, since an unfocused page
cannot touch the clipboard.

### Revisit plaintext history in `localStorage` — done

Encrypted at rest in v2.20.0: AES-GCM ciphertext in localStorage under a
non-extractable key kept in IndexedDB, with a startup sweep that migrates all
seven generators' plaintext stores at once (the clearStoredHistories lesson).
Threat model stated honestly in docs and legal: shields against casual
inspection and disk scraping, not against full control of the browser
profile. If WebCrypto is unavailable, history is memory-only — plaintext
never goes back to disk. The "clear history" control already existed
(History → Off).

### Offline / PWA

Moved to **Epic 8b**, which states it properly as app mode: manifest, service
worker and the update path, not just "add a service worker".

---

## Suggested order — as it was planned

Kept as a record rather than a plan: this is the sequence the work was actually
scheduled in, written when roughly sixty items were still open, and every item
it names has since shipped. It is here because the *reasoning* about ordering
outlived the ordering — why defects jump features, why the wordlist had to
precede the entropy display, why app mode was worth doing before anything that
depended on it. For what is next, see **Where this stands** at the top.

Epics 1 and 2 are done, and 3 and 5 are down to one real item each, so the old
ordering no longer says anything useful. Roughly sixty items remain, and they
divide by kind: defects, then the things that change the data, then the things
that change how it feels, then the things that leave the page.

**1. The two live accessibility defects.** Both are CSS, both are AA failures
shipping right now, and neither should queue behind a feature.

- **7a** — five control types under the 24×24 that WCAG 2.2 SC 2.5.8 requires.
- **7b's first item** — `.slider` sets `outline: none`, so the sliders have no
  focus ring at all (2.4.7). **This is the same bug as the one open item in
  Epic 3.** Fixing it closes both, and Epic 3 is deliberately not ticked until
  it is. Do not schedule them as two pieces of work.

**2. Epic 4 — the wordlist.** Ahead of Epic 6, and the ordering matters. Epic 6
displays entropy computed from the word pool; Epic 4 replaces the word pool.
Doing 6 first means shipping a number, changing the data underneath it, and
then shipping a different number for the same settings. Epic 4 also feeds 6d
directly.

**3. Epic 6 — entropy, starting with 6a and 6b.** Still the best value per unit
of effort here: pure computation over data already in hand, no new dependencies
and no new UI. 6b is the one with a duty attached — it corrects a claim the
interface currently implies but does not deliver. 6g (ambiguous characters) is
independent of the rest and can go any time.

**4. The rest of Epic 7 — the clunkiness.** Density, flow and feedback. This is
the widest gap between how the site measures and how it feels to use: Advanced
puts sixty-six controls on one screen. Not a defect, so it sits below the two
that are, but it is what a returning user actually notices.

**5. Epic 8b — app mode.** Self-contained, and the closest fit to the product's
own pitch: a generator that never talks to a server has no reason to need a
network. It is also a prerequisite for 8c and 8e, so it buys optionality.

**6. Epic 2's leftovers.** The aesthetic pass, light-mode tinting, and raising
the separation floors. Real work, but polish on something that already passes.

**7. Epic 8c, then 8d and 8e as exploration.** 8c is the mechanism for 8d — the
web platform cannot do 8d from a page at all — so they are one decision rather
than two. 8e is the biggest lift in the roadmap and argues with a claim the site
already publishes; read its first bullet before starting anything else in it.

**Not scheduled, because they are not blocked on effort here:** Epic 5's two
remaining items. One is a change on anagrimoire rather than in this repository;
the other needs a fact about that site confirmed before this one asserts it.
