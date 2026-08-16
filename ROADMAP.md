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

**Also shipped — 9f's recovery key**, which closes the failure the vault had no
answer to: forgetting the passphrase. Envelope v2 wraps a random master key
once per way in, so either key opens the vault and neither reveals the other.
Everything in 9f's entry was measured against the build rather than planned in
advance; the AAD gap it now records was found by being asked what actually
deserves scrutiny once both keys run the same mechanism.

---

### Superseded, one message later, and worth reading in order

The section below argued that filling comes before importing, and that the
desktop extension is the way to get filling. The first half holds. The second
half does not, and the objection that killed it is short: *all that work, and
what does it get us? It pushes sync back a little. As soon as there is a second
thing — desktop app, mobile app, CLI script — it needs to sync, and a desktop
browser extension does not make sense as the canonical copy.*

That is right, and it invalidates the design work that came with it. **"Which
copy is canonical" is only a question you are forced to answer if you have
decided not to build sync.** Accept that a second client is coming — and it is,
because filling on a desktop does nothing for a phone — and the answer stops
being a choice: no client is canonical, every client is a replica. Building the
extension as the source of truth means building an architecture whose only
purpose is to postpone that, then discarding it. The bridge and its security
analysis were scaffolding for a shape that should not exist.

Read on for what it got wrong, then see "Sync-shaped, before anything is
synced" below for what replaces it. Neither is deleted, because the reasoning
in the first is still what makes the second convincing.

### The next decision, stated plainly: a vault you cannot fill from

**The vault is valuable and it is not yet very usable, and no amount of work
inside the vault changes that.** Everything in it must be copy-pasted into
every login, on every site, forever. That is tolerable on a desktop for a
dozen entries and it is not a password manager.

This reorders what follows, and the correction is worth recording because the
list below was written believing otherwise. **Importing from another manager
(10b) looks like the obvious next win and is not.** Bulk-importing two hundred
passwords into something that cannot fill them produces a very well organised
museum: it raises the cost of the tedium rather than removing it, and the
people who would benefit most from the import are exactly the people who would
notice fastest that every login is now a copy and a paste. Imports are worth
building *after* filling exists, at which point they load a tool that gets
used.

**Filling needs the extension, and the extension does not need sync.** Those
are separate axes and bundling them has been the quiet assumption throughout
this file. Sync (9d) drags in a server, per-device key wrapping and the whole
conditions list. The extension does not: 8c's option (b) — the site stays
canonical, the extension holds a copy refreshed by importing a backup — needs
no server at all and covers filling completely on one machine. Unglamorous,
and the version that could actually get built.

So the order is **8c's canonical-vault decision, then the build step, then an
extension that fills, then imports.** The build step is the real gate and a
genuine loss rather than a formality: Manifest V3 forbids `'unsafe-eval'`,
Vue's runtime compiler needs it, so precompiled templates stop being optional —
and *the deployed site is the source you can read* stops being literally true.
That is the claim this project leads with. Decide it deliberately, not halfway
through writing a content script.

**That question is answered, and it was never really open.** An earlier draft
here said nobody had lived with this vault for a week, so whether copy-paste
was merely annoying or actually disqualifying was untested. Proposed three
times, and each time to someone who has used password managers for years: in
every one of them autofill *is* the product and copy-paste is the fallback for
the cases fill cannot reach. A vault offering only the fallback is a place to
look things up. Take it as settled rather than as an experiment to run.

**But that does not make the extension mandatory, and the distinction matters.**
It is the price of admission for *filling*, not for the vault. Someone who
wants a local-only vault in one browser, or only in the app, has chosen a
supported destination — see invariant 2, extended for exactly this.

---

---

### Sync-shaped, before anything is synced

The useful question is not *extension or app*. It is **what makes any second
client possible at all**, and the answer is cheaper than a server and smaller
than either.

**The vault's data model cannot currently survive sync.** Deletions are plain
removals, and `mergeEntries` merges non-destructively and never deletes —
exactly right for imports and exactly wrong for replicas. Delete an entry on
the laptop, sync from the phone, and the merge resurrects it. Silently, and
specifically for the entries someone most wanted gone.

- [x] **`updatedAt` on every entry** (3.2.0), so a merge can tell newer from
  older rather than preferring whichever side it happened to read first.
  ISO-8601 UTC, which sorts lexicographically and so needs no parsing.
- [x] **Tombstones** (3.2.0). A deleted entry becomes `{ id, deletedAt }`
  instead of vanishing, so "deleted here" is distinguishable from "not seen
  yet". Reaped after 90 days, since a tombstone that lives forever is a
  slow leak of what used to exist.
- [x] **A vault id and a device id**, so two replicas can establish they are
  the same vault before attempting to reconcile. This needed somewhere to
  *put* them: the payload inside the envelope was a bare array of entries,
  with no room for a fact about the vault as opposed to its contents. It is
  now `{ v, vaultId, entries, meta }`, versioned separately from the
  envelope — one is what the ciphertext holds, the other is how it is
  wrapped, and a change to either should not force a migration of both. A
  bare array still loads and gains a `vaultId` on first open, so no vault
  written before this is stranded.

  The device id is a label, not a credential, and it is deliberately
  local-only: `meta.lastWriter` records which replica wrote last so a merge
  can say where a change came from.

  The first thing it paid for was not sync. The backup-reminder record was
  in `localStorage`, so Edge called a vault un-backed-up an hour after
  Chrome had exported it; it is `meta.exports` now and travels with the
  vault — the last five, each with a full timestamp, the entry count at the
  time, and which browser made it, shown as a list rather than a single
  date because the real question is whether backing up is a habit. Both
  fields are dropped on lock along with the entries: an entry count is a
  fact about the contents, and a locked vault that can still recite it has
  not really locked.
- [x] **Per-entry merge rather than per-file** (3.2.0). `mergeReplicas` is
  last-writer-wins over `updatedAt`/`deletedAt`, kept separate from
  `mergeEntries`, which never deletes and is still what import wants.

None of that needs a network. All of it is testable in node today. It was
roughly a day of work while there is exactly one client and the migration is
free, and it is the whole difference between *sync later* and *rewrite later*.

**Reversed — and by the test that was planted to reverse it.** This said the
folder adapter writes whole files, so two devices lose writes, and pointed at
`'two devices sharing a folder still lose writes, which is the next piece'` as
a failing-by-design record of the gap. That test started failing, which is what
it was for. It now reads `'two devices sharing a folder keep each other's
work'`.

`persist()` is read-merge-write. Before writing it loads what is actually in
storage, and if the ciphertext is not the one this store last read or wrote —
a peer has been here — it opens that copy with the master key already in
memory, merges, and writes the result. Comparing the ciphertext means no
version counter has to be maintained: every seal makes a fresh IV, so no two
writes collide.

- It costs one read per save and nothing else. An unchanged ciphertext
  short-circuits before any decrypt, which is the normal case, and reading the
  peer's copy skips the KDF entirely — `openVault` takes the key it already
  has, so this is one AES pass and not a million PBKDF2 rounds.
- **It also fixes two tabs**, which is the same lost update over one IndexedDB
  and much more common, since nothing tells you the vault is open twice.
- **A peer it cannot read stops the save.** Re-keyed elsewhere, or a different
  vault dropped in that place: both fail identically, because every vault has
  its own random master key and there is nothing in an unreadable envelope to
  tell the two apart. So the message names both rather than guessing. What was
  typed stays in memory, so nothing has to be retyped.
- The backup list merges as a union rather than a pick — a backup made on the
  laptop and one made on the desktop are two facts, not a disagreement — and
  is deduplicated on the timestamp so the same merge run twice gives the same
  list.

**Same entry on both devices: it asks.** ~~Last-write-wins settles this.~~
**Corrected within the hour, by the obvious test being run:** open the edit box
in Chrome, save a new password in Edge, save a new password in Chrome. Chrome
won and Edge's password vanished without a word.

That is last-write-wins behaving exactly as specified, and the specification
was wrong. "Last" means *saved* last, not *knew* most: an edit box holds a copy
from before the other device saved, so its patch lands on stale data and still
wins on a fresh timestamp. The claim above — safe *in sequence*, with a
millisecond window — was also wrong, and this is the correction. That sequence
IS sequential. The real window is however long the dialog stays open.

It is detectable, because the caller passes the entry as it loaded it and so
its `updatedAt` is the base version. A remote copy standing on anything else
means the entry moved on, and the answer to that is a question rather than a
guess: the save stops, nothing is written, and the editor stays open behind a
dialog showing the fields that differ, with **keep mine**, **keep theirs**, and
**keep both**. Keep both files yours under a new id — two entries sharing one
id is not a state the merge can represent, and the next save would pick a
winner all over again.

A save that is refused now rolls the entry list back. Without that, memory
holds a saved-looking row that is on no disk anywhere and that some later save
would write after all. Nothing is lost by undoing it: the throw stops the
caller before it closes the editor, so what was typed is still on screen.

Deleting on one device while the other has the entry open is the same shape
with a different loss, and gets the same question.

**The limits that remain.** Two devices editing different entries never
interrupt each other, which is the common case and is silent by design. Two
saving in the *same instant* can still lose a write — the read-to-write window
is milliseconds now, but it is not zero. And none of this sees across the
folder's own sync: two machines writing while Dropbox is behind produces a
*conflicted copy* file, which is Dropbox's arbitration and invisible to this
page. Importing that file merges its entries back in, and the UI says so.

**Then the transport is a separate and deferrable choice**, which is the part
that protects the claims. A server (9d) means accounts, hosting, liability, and
"no accounts, nothing leaves your device" stops being true. But sync does not
require *our* server: the user's own cloud folder does it. Dropbox, iCloud
Drive, OneDrive, any synced directory. The encrypted file lands there, every
client reads and writes it, and we see nothing — the zero-knowledge claim stays
trivially true because there is nothing to be knowledgeable about.

- [ ] **Bring-your-own-storage first, if sync happens at all.** On desktop
  Chromium the File System Access API can hold a persistent handle to that
  file, so the *website* could sync with no server and no extension. Not
  Firefox, not iOS, so it is not the answer — but it is the cheapest
  possible proof that the replica model works, and it needs no content
  script to try.
- [ ] **This is also the CLI answer.** A documented encrypted file in a folder
  the user controls is the one interface a shell script can use. A vault
  living inside a browser extension is not.
- [x] **Firefox cannot do mode 2, and it is not a matter of waiting.** Asked
  directly — *are we sure?* — and the first answer checked only the picker
  API, which is not the same as checking the question. The whole surface:

  | API | Firefox | what it gives us |
  | --- | --- | --- |
  | File API — `File`, `Blob`, `FileReader` | yes, since 28 | read a file the user picks, **every time**. No write. |
  | File System Access — `showDirectoryPicker` etc. | **no** | the only write-back-to-a-chosen-path route there is |
  | File System API — OPFS, `navigator.storage.getDirectory()` | yes | a sandboxed private directory. Not the user's Dropbox. |
  | `FileSystemSyncAccessHandle.write()` | yes, 111+ | a real write — into the OPFS only. See below. |
  | `<a download>` | yes | writes to the downloads folder, cannot overwrite |
  | WebExtension `downloads` | n/a | also downloads-folder-only; Firefox has no `onDeterminingFilename` |

  The read column is not the problem — Import already uses the File API and
  works in Firefox today. **There is no write column.** A replica that
  cannot save is a viewer, and mode 2 is defined by both machines writing.

  `FileSystemSyncAccessHandle` is the candidate that looks like it settles
  this, and it is worth writing down why it does not, because it will be
  suggested again. It writes, it is fast, and Firefox has had it since 111
  (Safari since 15.2). But `createSyncAccessHandle()` is defined only for
  files in the origin private file system and throws `InvalidStateError`
  for anything else — and in Firefox the question never arises, since there
  is no picker to get a non-OPFS handle from in the first place.

  Which is the whole rule in one line: **Firefox will let you write inside
  the sandbox and read outside it. Mode 2 needs writing outside it.** OPFS
  is IndexedDB with a file-shaped API — same origin-private storage, same
  invisibility to Dropbox and to the OS file manager. Writing a vault there
  is what we already do; it is not a folder anyone else can see.

  Nor is this a gap waiting to close: Mozilla's published standards
  position on the pickers is *harmful*, and Safari has not implemented them
  either. Notably Mozilla's position on OPFS is *positive* — the objection
  is specifically to reaching outside the sandbox, which is exactly the
  part mode 2 needs.

  **Android has the API and still cannot do this**, which is worth writing
  down because the capability test says otherwise. Chromium on Android exposes
  `showDirectoryPicker`, so `canUseFolder()` returns true and the buttons
  appear — and then the permission does not survive a page refresh. Not
  each time the app is opened: each time the page loads, and twice over,
  because the site asks to reconnect and then Android asks as well. The
  picker is also the system file manager, which lists local storage rather
  than the cloud locations a provider's own app shows, so even when it
  works there is nothing there worth syncing to.

  Two lessons. Feature detection answers "is the function present", not "does
  the feature work", and this is the gap between them — a capability test
  cannot see that a grant will not persist. And the reference is wrong
  rather than merely quiet: caniuse does not track Edge for Android at all,
  and the one Android Chromium it does track — Chrome — it reports as
  unsupported, which a phone disproves in about ten seconds. Neither the
  docs nor the detection would have caught this. It took opening the app on
  a phone, which is the second time this week that was the only thing that
  would have worked.

  **Decided: gated off.** `folderSupport()` refuses when
  `navigator.userAgentData.mobile` is true, with a user-agent fallback for
  the narrow case of a browser that has the picker and not the hints. That
  is platform detection in a place that was an honest capability check, and
  the cost is worth naming: feature detection answers "is the function
  present", not "does the feature work", and nothing observable at call
  time reveals that a grant will not persist.

  What settled it was the frequency. The reconnect is not once per app
  launch, it is once per PAGE REFRESH, and twice over -- the site asks, and
  then Android asks. A button that relocates the only copy of a vault
  should not lead there.

  The escape hatch is deliberately outside the gate. Anyone who already
  moved a vault to a folder on a phone still gets the blocked screen with
  Reconnect and Stop using it here, on exactly the platform where the
  feature is no longer offered. There is a test for that, because gating a
  feature off is the obvious way to strand the people already using it.

  So the honest support line is Chromium desktop, and the answer for
  everyone else is not a cleverer file API. It is 9d proper (a server), or
  a cloud provider's own HTTP API, both of which are network problems that
  every browser can do. A **read-only Firefox viewer** — pick the vault
  file, open it, save nothing — is buildable on the File API alone and is a
  real thing someone might want, but it is a different feature and should
  not be described as sync.
- [x] **Leaving is a third operation, not a kind of deleting.** Delete removes
  the file for every device sharing the folder; moving it back takes it
  away from them; neither is "I am done with this vault *on this
  computer*", which is the ordinary thing to want on a work machine or a
  browser you were only trying. Clearing site data did it, and took the
  settings and every other stored thing with it. **Stop using it here**
  forgets the pointer and the local draft, locks what is open, and touches
  the folder not at all — no passphrase, because nothing is destroyed and
  asking for one would imply otherwise. It is also the only exit from the
  `blocked` screen: a folder that is gone for good previously left the page
  offering to reconnect to something that was never coming back.

**Revised order: make it sync-shaped, prove the replica model on one transport,
then build clients.** The extension still comes, and it still brings the
usability unlock — but as a replica, where the bridge question shrinks from an
architectural commitment to a local design detail.

---

**After that — 9c, the packaged app.** It only became worth its cost once 9a and
9b were good, and it brings the one thing the web genuinely cannot do: autofill
into other apps. 9b's export file is the bridge between a packaged app's storage
sandbox and the site's, which is why it was built first. It is the mobile half
of the same problem the extension solves on desktop, and it is more expensive in
every dimension — two stores, two review processes, $124/year — so it waits on
the extension proving the idea.

**Epic 10 is the gap against a mainstream manager**, and it is listed after 9
rather than inside it because most of it is not about the vault so much as
about what people expect around one: attachments, importing from the tool they
are leaving, more than one vault, folder templates, sharing, group accounts.
It was raised on the assumption that most of it waits for sync. Four of the
six do not — they need no server at all and could ship on what exists today.
The two that do need one are also the two where the zero-knowledge claim is
easiest to lose by accident, and 10f spells out exactly how.

That four-of-six finding is still true and it is no longer the same argument
for doing them next. *Could ship* is not *worth shipping first*: see the
section above, which puts filling ahead of all of it. 10b in particular reads
like a near-term win throughout this file and is not one until there is
something to fill with.

**Reading, not work — Epic 8d/8e.** 8d is a documented dead end (the web
platform cannot hand a password to a manager for another origin, by design) and
8e is superseded by Epic 9.

**8c is no longer reading.** It was the desktop half of the autofill idea 9c
covers on mobile, written when there was no vault to fill from. Rewritten in
place: the extension has to hold a vault rather than talk to the site's, which
turns it into a decision about which copy is canonical, and Manifest V3's ban
on `'unsafe-eval'` makes it the deadline for the build step 9f already wants.
Nothing is scheduled — the decision comes first.

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

## The next release — scope for finishing 9, 10 and 11

Calendar-versioned, `26.8.0` or `26.9.0`, and feature-complete rather than
incremental. This section is the arithmetic of that claim: what is actually
left, in what order it can be built, and — the part a scope is for — what is
being left out on purpose.

**Sixty-nine open items across the three epics** after the 2026-08-16 audit,
which closed six in 9d that had shipped in 3.3.0 and never been ticked.

| Epic | Open | Of which are decisions already made |
|---|---|---|
| 9 — the vault and the app around it | 30 | ~12 in 9d are constraints and rejected options, not work |
| 10 — what a manager is expected to have | 27 | few; 10 is mostly unstarted build |
| 11 — one repository, many surfaces | 12 | none; all new |

A checkbox here is not a task. 9d in particular records *decisions* as items —
"splitting the vault across two providers: considered, and no" is a conclusion,
not a thing to build — so the true build count is nearer forty. That is still
not one release, which is why the cut below exists.

### The spine

Four phases, ordered by what genuinely blocks what rather than by epic number.

**Phase 1 — `core/`, and nothing else.** 11a. Every other surface waits on it
and it waits on nothing. Mostly `git mv`: nothing in the logic layer imports
Vue. Ships alone, and is worth shipping even if the rest of this is abandoned.

**Phase 2 — the two web sites.** 11b and 11d. Render's two services, the
publish-root problem and its committed-assembly answer, per-service CSP, the
DNS move, and the claims rewritten per surface. Independent of all crypto work,
so it can run alongside phase 3.

**Phase 3 — the crypto that sync forces, in this order.** The ASVS 5.0 V11
read-through comes *first*, because it may change what follows and is worthless
after the format is fixed. Then the format change, once: Argon2id, the AEAD
metadata binding, and sealing secrets inside the vault all require touching the
envelope, and 9f already says the AAD work should ride along with whatever next
touches it rather than being its own migration. Then derive-once-split-twice,
ciphertext padding, and moving the crypto into a Web Worker.

Doing these as one format change is the whole point. Three migrations of an
encrypted store is three chances to strand a vault.

**Phase 4 — sync, then the surfaces that want it.** 11c's route list and its
test, the blob-store server, `HttpOnly` sessions, the opt-in invariant actually
verified against a built thing rather than asserted, and Legal and About
rewritten in the same release as 9d requires. Then 9c's packaged app, which
needs `core/` from phase 1 and gains from sync existing.

### In

Everything in 11. From 9: 9c, 9f, and 9d's mode 3. From 10: **10a**
attachments, **10b tier one only** (browser CSVs — Chrome, Edge, Firefox and
Safari all export a similar shape and it is nearly free), **10d** folder
templates, and **10g** the recycle bin, whose machinery already exists in
tombstones, `deletedAt` and the reaper.

### Out, and why — this is the half that makes it a scope

- **10c, more than one vault.** The prerequisite is unresolved: 10c's own first
  item says a group is a label and a vault is an encryption boundary, and until
  someone decides which of those people actually want, the UI question cannot be
  answered. Shipping the wrong answer here is expensive to reverse.

- **10e, one-time shares.** Needs the server, so it is not blocked by anything
  except sequence — but it introduces a second thing the server does, one
  release after establishing that the server does exactly one thing. Worth
  letting 11c's route list prove itself first.

- **10f, group accounts and SSO.** This is a product, not a feature. It is also
  where 8e's tension is at maximum: SSO authenticates a person and must never
  custody a key, and admin recovery is a back door with better manners. Not
  something to decide inside a release that is already this large.

- **10b tiers two and three.** 1PUX, Keeper and KDBX. Tier one is nearly free
  and covers the common case; KDBX is a project of its own.

- **The browser extension (8c).** The tree in 11a makes room for it and `core/`
  unblocks it, but it is Epic 8 and not part of finishing 9, 10 and 11. Worth
  saying so rather than letting the folder imply a commitment.

### Decisions needed before code, not during

- [ ] **Is mobile Capacitor-plus-native, or fully native?** 11a assumes a shared
  web layer with native autofill either side. If it is fully native, `core/`
  needs a second life as a Swift and Kotlin port, and the estimate for the whole
  epic changes shape rather than size.

- [ ] **Does `26.8.0` mean the release ships in August 2026?** Calendar
  versioning invites that reading. If the number is a date, a slipped release
  either renumbers or lies, and it is worth deciding which before the first
  changelog entry is written under the new scheme.

- [ ] **What is a vault?** Not in scope to build (10c is out), but the answer
  constrains the sync format, and getting it wrong costs a migration later.
  Worth writing down even while 10c stays closed.

- [ ] **Does the paid tier exist in this release?** 11a notes a monorepo mixes
  MIT core with non-MIT product code and that per-directory licences solve it.
  Cheap to arrange up front, awkward to retrofit once the tree is settled.

---

## Epic 11 — One repository, many surfaces

**The theme:** the next release is feature-complete rather than incremental —
sync, a packaged app, an extension — and every one of those is a new *surface*
over the same vault. This epic is the shape that has to exist before any of them
can be built, and the claims that have to be rewritten because they will stop
being true in their current form.

**Versioning changes here.** `26.8.0` or `26.9.0`, calendar rather than semantic,
which settles the question left open at 3.3.0. Nothing mechanical resists it —
the service worker takes its version from `package.json` via a test either way.
What it does is make the tagging rule *more* load-bearing, not less: once the
number is a date it carries no magnitude at all, so the release tag and the
summary become the only thing telling a reader this one is the big one.

### 11a. The shape

The starting condition is better than it looks. **Nothing in the logic layer
imports Vue** — not one module. Measured across `src/`: roughly 2,000 lines are
fully pure, and another 1,700 touch nothing but `crypto.subtle`. So `core/` is a
move, not a rewrite. That happened by accident, as the by-product of extracting
`generators.js`, `vault-entry.js`, `vault-idb.js` and `vault-diff.js` for
readability, and it is the single thing that makes this epic affordable.

```
wordlock/
  core/         pure logic: no DOM, no framework, no platform
    generate/     lib, generators, entropy, wordlists
    vault/        crypto, envelope, entries, transfer, diff, recovery
    totp.js
  ui/           shared browser UI: tokens, theme, header, footer, nav, settings
  site/         wordlock.net -- product, docs, changelog, roadmap, legal
  app/          app.wordlock.net -- generator + vault
  api/          the sync service; routes.js declares the whole surface
  desktop/      one codebase, three targets
    platform/     keychain: win / mac / linux
  mobile/
    shared/       the web layer both wrap
    ios/          Swift -- credential provider
    android/      Kotlin -- autofill service
  extension/    one source
    manifest.chrome.json, manifest.firefox.json, safari/
  tools/
```

- [ ] **`ui/` exists because site and app are a deploy boundary, not a code
  boundary.** Both need the same header, footer, nav, tokens and settings
  panel. Without a shared home they get copied, and copies drift -- which is
  the exact failure the site-wide header extraction fixed once already, when
  six hand-written footers had become five different link lists.

- [ ] **One repository, and the reason is version skew rather than taste.**
  Every surface depends on `core`, and a mismatch between `core` and one client
  is the bug that cannot be debugged: a vault sealed by one envelope version and
  opened by another. One repository means one commit moves everything, and the
  format can never be half-migrated across surfaces. Separate repositories would
  force publishing `@wordlock/core` to a registry, which punctures "no
  dependencies, read the source" in the most literal way available.

  Two costs, named now rather than discovered. Render needs four services
  instead of two (11b). And if the product ever grows a paid tier, one
  repository mixes MIT core with non-MIT product code -- solvable with
  per-directory licences, much easier to plan than to retrofit.

- [ ] **Where one codebase actually works, measured against what each platform
  requires rather than assumed.** The instinct that the operating systems differ
  a lot is right for exactly one of the three.

  | Surface | One codebase? | What is genuinely per-platform |
  |---|---|---|
  | Desktop | Yes | Signing, notarization, installers, keychain. Plugin-level. |
  | Extension | Mostly | Manifest and `chrome.*`/`browser.*`; Safari needs an Xcode wrapper. |
  | Mobile | **No** | Autofill is native both sides, and autofill is the whole reason for the app. |

  So `desktop/win` and `desktop/mac` as siblings would be two empty folders
  around one program, but `mobile/ios` and `mobile/android` are real:
  `ASCredentialProviderExtension` in Swift and `AutofillService` in Kotlin,
  neither expressible in JavaScript. Let the tree follow the code boundary and
  not the distribution target.

  That autofill is what justifies a wrapper at all is 9c's argument, not a new
  one, and 8c says the same for the extension. What is new is only the
  consequence for the tree: the same fact that makes the app worth building is
  the fact that stops mobile being one codebase.

- [ ] **`core/` extraction ships first and alone.** It is valuable even if no
  other surface is ever built, it is mostly `git mv`, and it is the prerequisite
  for all of them. Everything else in this epic is blocked on it; nothing in it
  is blocked on anything.

### 11b. What Render does when there are two sites

- [ ] **The "never declare a second service" rule in `render.yaml` is right, and
  it is about the wrong axis to apply here.** It was written after declaring
  `wordlock` and `wordlock-dev` in one file, which offered a review screen with
  `wordlock-cl9q` and `wordlock-dev-cl9q` side by side -- a duplicate of
  *production*, created by the dev Blueprint. The fault was encoding the
  **environment** in a file that both Blueprints apply whole.

  Site and app split a different axis. Both Blueprints legitimately want both
  entries, and the result is four services that are all wanted:

  | Blueprint | creates | serves |
  |---|---|---|
  | main | `site-<a>`, `app-<a>` | wordlock.net, app.wordlock.net |
  | dev | `site-<b>`, `app-<b>` | dev.wordlock.net, dev.app.wordlock.net |

  `dev.` prefixes the production hostname rather than the other way round, so
  the dev name of `app.wordlock.net` is `dev.app.wordlock.net`. Both dev hosts
  are then two labels deep, which a `*.wordlock.net` wildcard certificate would
  not cover -- Render issues per-hostname certificates, so this costs nothing
  here, but it is the sort of thing that only surfaces once a wildcard is
  introduced for some other reason.

  HSTS needs no change: `includeSubDomains` on `wordlock.net` already reaches
  every one of these, which is the reason it is set.

  The header in `render.yaml` has to be rewritten to say that, or the next
  reader takes it as a flat prohibition and stops. `test/render-config.test.js`
  should assert the distinction rather than the count.

- [ ] **A static service publishes exactly one directory, and this is the
  constraint that costs something.** With `staticPublishPath: ./site`, nothing
  outside `site/` is served -- and the site needs `vendor/`, because the header
  uses the icon font on every page. Shared assets have to physically exist
  inside both publish roots.

  That collides with the claim this project protects hardest: what a server
  sends is what is committed, with nothing in between. Four ways out, and only
  one is in keeping.

  Symlinks are stored by git but Render's builder is unlikely to follow them --
  fragile, and untested. Duplicating `ui/` and `vendor/` into both roots invites
  drift on precisely the files whose purpose is to prevent it. Assembling at
  deploy time is a real build step on the server and breaks the claim outright.

  Assembling in development and committing the output is the deal already struck
  for `main.render.js`: generated, committed, and a test that rebuilds the
  inputs and fails when the committed copy no longer matches. That is the
  answer, and it is not a new concession -- but the exception grows from
  "templates" to "templates and publish roots", and that belongs in `CLAUDE.md`
  in the same commit rather than widening quietly.

- [ ] **The CSP becomes per-service.** One header covers every page today, with
  five hashes that are the union of all inline scripts. Split, and each service
  should carry only its own pages' hashes -- otherwise each one allows the
  other's inline scripts for no reason. `test/csp.test.js` recomputes from all
  HTML and will need to know which files belong to which service.

- [ ] **Moving `wordlock.net` is the one step that touches live DNS.**
  Blueprints do not adopt an existing service by name; that was established this
  afternoon at the cost of a duplicate service. A service named `site` is a new
  service, so the production domain is detached from the old one and attached to
  the new, with a verification window in between. Plan it; do not discover it.

  Header sync being additive -- the trap that cost an afternoon on 2026-08-15 --
  helps for once: these are new services and start clean.

### 11c. The API, and what it is allowed to be

**9d already decided what the server may be** -- an opaque sync identifier,
ciphertext it cannot read, session tokens in `HttpOnly` cookies, a write race
detected rather than resolved. None of that is restated here; 9d is the
authority and this section is only the part that is about the repository.

- [ ] **Make the constraint a test rather than a folder name.** The objection to
  calling the directory `api` was to the name as an open invitation, not to
  having one -- sync needs a network service, and a blob store with sessions is
  an API by any reasonable definition. But a folder name enforces nothing.
  `api/routes.js` declares the entire surface and a test asserts the running
  service exposes exactly those routes and no others, so adding an endpoint is a
  deliberate reviewed act rather than a Tuesday. Same move as `tokens.css` being
  the only place a colour may exist: the rule is worth something once a thing
  fails on it.

### 11d. The claims, per surface

**8e stated the conflict and it has not moved:** the Legal and About pages say
there are no accounts and nothing leaves your device, and shipping sync quietly
would make published claims false. That is the argument; what follows is only
the bookkeeping it implies once there are six surfaces instead of one.

- [ ] **"Zero runtime dependencies" becomes scoped, and every copy changes in
  the same release.** It appears in `README.md`, `SECURITY.md`, About, Legal and
  `package.json`. Mobile, desktop and the extension bring toolchains. The
  honest version is that the *web app* fetches nothing to run, which is still
  the half that matters, and it has to be said that way in all five places at
  once.

- [ ] **"What a server sends is what is in the repository" survives per surface,
  and only per surface.** Site and app stay literally the committed source.
  Desktop, mobile and the extension are builds, and the strongest true claim
  there is "reproducible from committed source" -- weaker, and it should be
  written as weaker. The API's guarantee is a different one entirely: not that
  you can read it, but that it cannot read you.

- [ ] **This is the tenth house rule at a scale it has not been tested at.** One
  pass over five documents caught four false claims on 2026-08-16, in a
  repository with one surface. This epic multiplies the surfaces by six. Deciding
  the wording before the move is cheaper than finding the stale copies after it.

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

   **Extended 2026-08-14 to cover every client, not just sync.** This was
   written when sync was the only thing that could break it; an extension and
   a packaged app can break it the same way. Someone who wants a local vault
   in one browser, or only in the app, has chosen a supported destination
   rather than stalled halfway to the real product. So: no prompt to install
   an extension, no "filling available with…" banner over a copy button, no
   feature withheld from the website that could have run there. If the
   extension is ever *required* to make the vault worth using, the vault was
   built wrong — filling is the reason to want one, not the reason the other
   parts work.

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
  reminder, not a modal. The date and count behind it were in
  `localStorage` at first, on the reasoning that the record has to survive
  being locked; both halves of that were wrong, and it now lives in the
  payload — see 9d.
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

> **Epic 11 takes the repository half of this, and only that half.** 9c still
> owns *why* a wrapper is worth building — autofill, platform key storage,
> biometrics, and the $99-plus-review arithmetic. What moved to 11a is where
> the code sits, and the one finding that changes the plan: mobile is the only
> surface of the three that genuinely cannot be a single codebase, for exactly
> the reason 9c gives for wanting it.

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
  that currently ships by pushing to main. 8c's warning about two stores
  applies here too.
- [ ] **Order: 9a and 9b on the web first.** They work in the browser and the
  PWA immediately, and they are the substance. Wrapping comes after, so
  the packaged version launches with autofill and biometrics rather than
  being the website in a trench coat.

### 9d. Sync, if it ever happens — the conditions

> **Still the authority on what a server may be.** Epic 11c does not restate
> any of it — the opaque identifier, the ciphertext the server cannot read, the
> `HttpOnly` sessions, the write race. 11c adds one thing only: that the
> restriction should be a test over a declared route list rather than a
> convention, because a folder called `api` enforces nothing.

> **Mode 2 shipped in 3.3.0, and six items here went unticked for two
> releases.** Folder storage, the write race, the persisted handle and its
> re-grant path, the folder-not-file unit, the Chromium-desktop limit stated
> out loud — all built, all still showing as open until this file was audited
> against the code on 2026-08-16. That is the failure this document's own
> introduction warns about, repeated: Epics 1 and 3 sat fully implemented and
> unticked for several releases too.
>
> Two items that *look* closed are deliberately still open. "Opt-in, and the
> local mode stays whole" and "9b's export/import ships first and stays" are
> conditions **on sync**, and sync does not exist — there is nothing yet for
> them to have been verified against. A condition met by absence has not been
> met.
>
> What remains open here is therefore mode 3, the server, and the crypto that
> mode 3 forces. The cheap path is done.

**Three modes, after Obsidian's shape.** That model is worth copying because it
solves the funding problem without compromising the free product: local is
whole forever, self-managed sync costs nothing and is fully supported, and the
hosted option pays for the work. Nobody is ever nagged toward a paid tier.

1. **Local only — what exists today.** One device, no network, nothing leaves
   it. Not a starter tier and not a trial: a supported destination, per
   invariant 2. Nothing about the other two modes may make this one worse.
2. **Bring your own cloud.** The encrypted vault lives in a folder the user
   already syncs — Dropbox, OneDrive, iCloud Drive, a network share. Point the
   app at a file and their existing sync client does the rest. No account with
   us, no server of ours, and we never learn which provider it is or that they
   are using one.
3. **WordLock Cloud — paid, because it has to be.** Hosting is cheap and
   obligation is not: uptime, abuse, deletion requests, support. Charging is
   what makes it sustainable rather than a liability. Supabase to begin with,
   as a proof of concept — Postgres, row-level security and auth from people
   who do database security for a living, which beats reinventing it. Possibly
   our own infrastructure later, if there is ever a reason beyond pride.

- [ ] **Argon2id moves from "nice" to "load-bearing" here.** Today the
  ciphertext sits on one device the attacker must already have. In modes 2
  and 3 it sits in a provider's storage, so the realistic attack becomes an
  offline guess against whatever the passphrase is worth, at whatever rate
  the KDF permits. PBKDF2 is merely slow and parallelises beautifully on a
  GPU; Argon2id is memory-hard and does not. Shipping mode 2 or 3 without
  it means the sync feature is what makes the weak-passphrase case
  materially worse. See 9f — it should land first, or in the same release.
- [ ] **The account credential must be unrelated to the vault passphrase.**
  Never derived from it, never sent, never recoverable from anything the
  server holds. The test is blunt: hand an attacker the entire production
  database and they should learn nothing but blob sizes and timestamps.
  Design for that and a misconfigured RLS policy — the classic Supabase
  failure, and the reason to pick a backend *after* deciding the model —
  leaks ciphertext rather than passwords.
- [ ] **Pad the ciphertext to size buckets.** What a provider still learns is
  metadata: a blob's size roughly reveals how many entries are in it, and
  its modification times reveal when passwords are added or changed, which
  is a behavioural trace. Padding to buckets makes a twelve-entry vault and
  a forty-entry one indistinguishable, and costs a few lines. Timing is
  harder and probably not worth chasing.
- [ ] **Splitting the vault across two providers: considered, and no.**
  The appeal is that no single provider holds everything. But no provider
  holds anything readable now — that is what the encryption is for — so
  splitting defends a flank already covered, while adding two integrations,
  two failure modes, torn state when one write lands and the other does
  not, and *reduced* availability, since both must be up to open the vault.
  The one real benefit is defence in depth against a weak passphrase, and
  Argon2id buys far more of that per unit of effort, because it addresses
  the weak point rather than routing around it.

**Where the code already is, as of 2026-08-14.** Mode 2 is closer than it
looks, because the hard part is done and the remaining part is specific.

Ready: the entry model reconciles (`updatedAt`, tombstones, `mergeReplicas`);
storage is already injected into `createVaultStore`, so a file-backed adapter
drops in without touching the state machine; the vault is a single
self-contained encrypted envelope, which is exactly one file; and the browser
API exists — verified in Chrome 148, `showSaveFilePicker`, `createWritable`
and `queryPermission` all present.

- [ ] **The blocker is that `save()` overwrites.** Every write assumes it is
  the only writer, which is true for one device and false the moment a
  second one shares a file. Persisting has to become read-merge-write:
  load the remote copy, decrypt it, merge, re-seal, write back. That is a
  change to what saving *means*, not a new adapter.
- [x] **Which means syncing requires an unlocked vault**, since merging needs
  the plaintext. A locked vault cannot reconcile, so sync happens on unlock
  and on save rather than on a background timer. Worth stating early: it
  shapes the UI.
- [x] **Detect the write race.** Two devices writing the same file need the
  remote's modification time or hash compared before overwriting, or the
  slower one silently discards the faster one's work.
- [x] **Persist the file handle**, which is structured-cloneable and can live
  in IndexedDB, plus a permission re-grant path for later visits. Without
  that, mode 2 means picking the file again every single time.
- [x] **Chromium desktop only, and say so.** Firefox has no File System Access
  API and mobile browsers have no persistent handles, so mode 2 on the web
  is a desktop feature. Phones reach the same file through the packaged app
  and the platform pickers, which is 9c — and is the reason to keep the
  format a plain encrypted file rather than anything clever.

**Written assuming a server, which now looks like the most expensive option
and the only one that breaks an invariant.** The gates below still stand and
still apply, but they were drafted before the entry model existed and before
anyone costed the alternatives. Sync is a *transport* problem now: the merge is
built and tested, so what remains is moving one encrypted file between places.
That can be done four ways, and hosting is the smallest part of the price.

| Transport | Money | Ongoing burden | Breaks "no accounts" |
|---|---|---|---|
| Manual export / import (today) | none | none | no |
| Local file handle + the user's own cloud client | ~none | ~none | no |
| Provider APIs (Dropbox, Drive, OneDrive) | small | 3–4 review processes, API drift | no |
| Our own server | small | uptime, abuse, deletion requests | **yes** |

- [x] **The cheap path is the default, and it uses no provider API at all.**
  The File System Access API can hold a persistent handle to a file inside
  the Dropbox or OneDrive folder the user's desktop client *already*
  syncs. No OAuth, no app registration, no server, no account — their sync
  client does the work and we never learn which provider it is. Chromium
  desktop only, so not the whole answer, but it is the cheapest possible
  proof the replica model works and it needs nothing from anyone.
- [ ] **Provider APIs cost more in friction than in money.** Each is a separate
  integration with its own OAuth registration and review. Dropbox is
  straightforward, Microsoft Graph is manageable, Google Drive is the heavy
  one — scoping to `drive.file`, where the app only sees files it created,
  stays out of the restricted-scope tier that triggers a paid third-party
  security assessment. And **iCloud Drive has no web API**, so it is
  native-only regardless. Three or four integrations, each with review and
  permanent drift, for something the row above does for free.
- [ ] **A server's cost is obligation, not hosting.** Ciphertext blobs are tens
  of kilobytes and nearly free to store anywhere. What is expensive is
  being the party that must stay up, handle abuse, answer deletion
  requests, and explain an outage — plus it needs an identity of some kind
  even when opaque, which is the line Legal currently draws. Worth it only
  if the free paths have been tried and genuinely do not cover enough.
- [x] **The sync unit is a folder, not a file.** A vault plus N attachment
  blobs cannot be one file, so mode 2 points at a *directory* —
  `showDirectoryPicker`, which is present alongside the rest of the File
  System Access API. Cheap to decide now and awkward to change after mode 2
  ships pointing at a single file. Mode 3 gets the same treatment: separate
  storage objects rather than one row.
- [ ] **Mobile is 9c's problem, not this section's.** No mobile browser offers
  persistent file handles, so a phone syncs through the packaged app and
  the platform file pickers. That is a reason to keep the format a plain
  encrypted file rather than anything clever.

Every one of these is a gate, not a preference:

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

- [x] **Recovery codes — shipped, and the case survived.** Asked for, with
  the suspicion that the security model forbids it. It does not -- but the
  version most people picture is the unsafe one, so the constraints matter
  more than the feature. Everything below was the plan; all of it was
  built, with the word count at 16 and the format decisions unchanged.

  **What the build added to the plan.** The envelope had to grow a version:
  v1 encrypts the data directly under the passphrase key, which leaves
  nowhere to put a second wrap, so v2 encrypts under a random master key
  and wraps *that* once per way in. Either wrap opens the vault. Two
  dividends that were not the reason for it: changing the passphrase now
  re-wraps 32 bytes instead of re-encrypting the whole vault, and revoking
  recovery is deleting one field. Old vaults keep opening as v1 and convert
  only when recovery is added or the passphrase changes -- both moments
  where the passphrase is already in hand.

  **Three rules that emerged while building it.** Adding or removing a key
  requires the passphrase even with the vault open, because an unlocked tab
  proves a tab is open rather than who is asking -- the same rule that
  already guarded deleting a vault. Recovering takes the key and the new
  passphrase in one operation, so the vault is never open with no
  passphrase anyone knows, and re-seals under a fresh master key so the
  forgotten passphrase dies with it. And using a recovery key retires it,
  since by then it has been typed onto a screen and possibly read aloud.

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

  **What it is actually for**, corrected: a first draft of this entry said
  the encrypted backup already provides recovery and a recovery key merely
  duplicates it. That is wrong, and worth recording as wrong. A backup
  protects against *losing the data*. A recovery key protects against
  *forgetting the passphrase* -- and those are different failures, because
  a backup you cannot decrypt is as lost as no backup at all. Nothing in
  the product currently addresses the second one. Forget the passphrase
  today and every copy you own, including every backup, is ciphertext
  forever.

  Nor does a recovery key help with the first failure. If the vault is
  gone and was never exported, no key recovers it; that is what backups
  and, one day, sync are for. The two mechanisms are complements, not
  alternatives, and the earlier framing collapsed them.

  **Format.** Words, not a base32 blob, because this gets written on
  paper and typed back by hand under stress. Sixteen words from the
  17,576-word list is 225.6 bits, which is preposterous overkill and
  free; ten words is 141 bits and still far beyond reach. Somewhere in
  10-20 is right, trading transcription effort against a margin that is
  already enormous at the bottom of the range. Lower case, space
  separated, generated -- the same list the Words generator draws from.

  Shipped exactly as scoped here: generated only, shown exactly once,
  behind the same write-it-down gate the adopt flow uses, stated plainly as
  a second key to everything in the vault, and revocable.

- [ ] **Seal the secrets inside the vault as well as around it.** Today
  unlocking means every password in the vault becomes a plaintext
  JavaScript string for the whole session, sitting beside the passphrase
  that already cannot be scrubbed. Sealing each secret individually under a
  subkey means only what is actually revealed, copied or filled gets
  decrypted, and the rest stay ciphertext in memory.

  **The split is the user's own choice, which is the neat part.** The
  `secret` flag on a custom field already means masked, clipboard-timed and
  generatable; it now also means inner-sealed. Password, TOTP seed,
  security answers and secret fields are inside. Label, username, URLs,
  note, group, tags and dates are metadata — searchable is the test, and it
  lines up almost exactly with masked-in-the-UI. Put something sensitive in
  a plain text field and it is plain text: that is the user's call, made
  with a checkbox they already understand, and everything is still
  encrypted at the outer layer regardless.

  **Reuse detection survives via a keyed hash.** Comparing passwords needs
  plaintext, which defeats the point, so each entry carries an HMAC of its
  password under a subkey. Reuse still works, the hashes are useless
  without the key, and nothing gets decrypted to compute it. Two caveats:
  those hashes must stay *inside* the outer envelope, or a storage provider
  learns which of your accounts share a password; and reuse becomes
  per-vault, since separate vaults (10c) have separate keys and there is no
  fix that does not defeat the point of separating them.

  **What it does not buy: merging without the key.** The metadata is inside
  the outer envelope, so reading it still needs the vault open, and sync
  stays an on-unlock operation. What it does buy is that the merge never
  touches a secret — it shuffles opaque blobs — so a bug there can misplace
  an entry but cannot leak or corrupt a password. And a corrupt inner blob
  costs one entry rather than the whole vault.

  **Three things to be honest about.** Export still decrypts everything, so
  "never decrypt the whole vault" has an exception from day one. The threat
  it addresses is a passive memory snapshot — crash dump, swap, forensic
  capture — and it buys much less against an attacker with code execution,
  who can hook the decrypt path or simply wait. And there is one
  implementation trap that would erase the benefit entirely: the moment the
  UI caches decrypted values in the reactive store, which is the natural
  way to write it and how `entries` works today, every password is back in
  memory. The decrypted value has to live for one operation and then go.

  **Do it soon rather than carefully later.** This is another envelope
  version, and format migrations are only expensive once vaults exist in
  the wild. The vault shipped yesterday and almost certainly nobody is
  storing real passwords in it yet, so the migration is close to free right
  now and will not be in six months.

- [ ] **Bind the envelope's metadata into the AEAD.** Raised while explaining
  v2 to someone who then asked the right question: if both ways in are the
  same mechanism with different inputs, what actually deserves scrutiny is
  the encryption itself. This is what that scrutiny found.

  The salts, the iteration counts and the slot structure are plaintext
  JSON sitting *outside* the authenticated ciphertext. AES-GCM
  authenticates what it encrypts, and it is not encrypting any of that.
  Nothing stops someone with write access to the IndexedDB store editing
  it.

  **What that does and does not get them.** It does not get them
  plaintext, which is the part worth being clear about. A spliced-in
  recovery slot wraps a *different* master key, so the entries still will
  not decrypt; an edited iteration count derives a different key, so the
  unwrap simply fails. Every path ends in a failed authentication rather
  than a successful lie. What it does get them is destruction: deleting
  the recovery slot is a one-field edit, and the owner finds out at the
  worst possible moment, which is the moment they needed it.

  So this is tamper-evidence and denial of service, not confidentiality.
  It is also not reachable by the threat the vault is mainly built
  against -- a stolen copy of the profile, read offline -- since that
  attacker never writes anything back.

  **The fix is one parameter.** `additionalData` on the AES-GCM calls,
  covering the envelope's own metadata, so any edit to a salt, a count or
  a slot list fails loudly instead of quietly. The cost is a format
  change: envelopes sealed without AAD cannot be opened by code that
  requires it, so it needs the same lazy upgrade v2 already uses -- open
  the old shape, re-seal on the next passphrase change or recovery-key
  operation. Cheap to do, and cheaper still if it rides along with
  whatever next touches the format rather than being its own migration.

- [x] **Drop `'unsafe-eval'` from the CSP** (3.4.0). The policy shipped with hashes
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
  the hash list is what prevents. ~~Revisit if a build step arrives for
  another reason; do not add one for this alone.~~

  **Reversed. Scheduled, not deferred.** The maintainer's call, and the
  reasoning above was too narrow rather than wrong. It weighed the CSP
  alone; `'unsafe-eval'` is not one item, it is the same blocker turning up
  in three places — the MV3 extension path (8e), the build step 9f wants
  for sealing, and now a pre-release security pass where it is the single
  weakest line in an otherwise tight policy. Three bounded gains that share
  one cause are not three small things, and "do not add a build step for
  this alone" stopped applying the moment it was not alone.

  The property to protect while doing it is the one the original argument
  was right about: the deployed site should stay readable. That means a
  build whose output is legible and diffable, and a test that the built
  render functions correspond to the templates in the repo — not a
  minifier.

  **Done, and the property held.** Markup moved to `src/templates/*.html`,
  `tools/build-templates.mjs` compiles it to `*.render.js`, and both the
  input and the output are committed. `test/templates.test.js` recompiles
  and fails on drift, so the artefact cannot quietly become the source of
  truth. The header is gone from `render.yaml` and `test/csp.test.js`
  fails if it returns, or if a component declares `template:` again.

  It is not merely disallowed but unusable: the page ships
  `vue.runtime.esm-browser.prod.js`, which has no compiler in it.

  The cost estimate was wrong in the good direction, and the correction is
  the interesting part. Precompiled markup is *larger* than the markup it
  replaces — the generator's code went from 17.2 KB to 23.8 KB brotli, the
  vault's from 28.8 KB to 32.5 KB — but dropping the compiler takes Vue
  from 47.2 KB to 30.1 KB, and that lands once on every page. Net **−10.5
  KB for the generator and −13.4 KB for the vault**, per visitor, brotli.
  An earlier version of this note claimed roughly −7 KB by counting the
  uncompressed sizes; compression flatters generated code far more than it
  flatters a compiler, which is why the measured figure is better than the
  estimate rather than worse.

  Two things had to be learned by building it. `@vue/compiler-dom` cannot
  be vendored: its browser build refuses module mode (compiler-48) because
  prefixing identifiers needs a JS parser it does not bundle, and the
  function mode it will do emits `with (_ctx)`, a SyntaxError in any ES
  module — so it is a devDependency, measured both ways before that was
  accepted. And `NODE_ENV` must be `production` when the compiler runs, or
  it annotates every `v-if` and the site ships literal `<!--v-if-->`
  markers; importing the `.prod.js` path is not sufficient on its own.

- [ ] **Read the envelope design against OWASP ASVS 5.0, chapter V11.**
  Scanners answer "does this code have a known bad pattern"; they cannot
  answer "is this cryptographic design right for what it claims". The
  Cryptography chapter is a structured checklist for exactly that — key
  lifecycle, algorithm choice, random sources, key storage, and what happens
  at rotation — and it is a read-through rather than a tool run. Chapter V6,
  Authentication, is worth the same pass for the passphrase and recovery
  slots.

  ~~Written as "ASVS V6 (Cryptography)" and "V2 (Authentication)".~~ Those are
  4.0.3 chapter numbers, and ASVS 5.0.0 renumbered everything in May 2025:
  Cryptography moved to V11 and **V6 is now Authentication**, so the old note
  pointed at the wrong chapter while naming the right subject. It also read as
  a version rather than a chapter, which is a version of ASVS that does not
  exist. Both readings landed somewhere wrong, so the standard's version is
  stated alongside the chapter now.

  Queued rather than done: it is a deliberate exercise against the threat
  model, not a pre-release gate, and doing it badly in a hurry would be
  worse than the honest gap.

- [ ] **Split the large files.** `main.js` and `vault-app.js` are both far
  past readable and are named as known exceptions in CLAUDE.md, to be
  reduced by extraction rather than rewritten. Extraction has started:
  `vault-diff.js` came out of `vault-app.js` during the security pass,
  and pulling it out is what made its rule testable rather than something
  you check by opening a dialog and looking. That is the pattern to
  follow — extract where it buys a test, not to hit a line count.

---

## Epic 10 — What a password manager is expected to have

Six things a person moving from 1Password or Bitwarden would look for and not
find. None is started. They are gathered here because they were raised
together, with the assumption that most would have to wait for sync.

**That assumption is worth correcting, because it changes the order.** Four of
the six need no server at all:

| | Needs a server? | Real obstacle |
|---|---|---|
| 10a Attachments | No | Storage shape, not storage space |
| 10b Import from other managers | No | One format at a time; KDBX is its own project |
| 10c More than one vault | No | Deciding what a vault *is* |
| 10d Folder templates | No | Nothing. This one is small |
| 10e Sharing | Yes, but only to hold ciphertext | Key never reaches it |
| 10f Group accounts and SSO | Yes | SSO must not become key custody |

So the sequencing is not "wait for 9d". Attachments, imports, vaults and
templates could all ship on what exists today, and between them they close
most of the gap against a mainstream manager. Sharing and group accounts are
the two that genuinely need 9d first, and they are also the two where the
zero-knowledge claim is easiest to lose by accident.

### 10a. File attachments — small ones, and the format is the hard part

Recovery codes as a PDF, a scan of a passport, a licence key file. The obvious
scope is "small files only", and that instinct is right, but not for the
reason it looks like.

- [x] **The obstacle is the storage shape, not the quota — and the shape is
  settled.** The vault is one sealed blob: every save re-encrypts and
  rewrites the whole thing. Fine for a few kilobytes of text, untenable the
  moment a 2 MB scan is in there, because editing an unrelated entry's
  label would rewrite the scan too.

  **Decided (2026-08-14): attachments do not live in the vault.** Each is
  its own blob, encrypted under the same vault key, referenced from the
  entry by id. That is not a change to the envelope format at all — the
  entry gains a reference field and the storage layer gains a second
  location. An earlier draft here claimed attachments "force per-item
  sealing", implying the vault's own format had to change and that this
  should therefore be paired with the entry-sealing work in 9f. Both halves
  were wrong: the two are independent, and each stands on its own merits.
- [ ] **Attachments need tombstones too.** Deleting an entry has to delete its
  blobs, on every replica — and a replica that has not synced yet still
  holds them. Orphaned encrypted blobs quietly accumulating in someone's
  Dropbox is the failure mode, and it is exactly the shape the reaper
  already handles for entries.
- [ ] **A cap, stated in the UI.** Browsers grant a large quota but a vault
  that outgrows it gets evicted rather than truncated, and the persistence
  warning already explains how little we control that. Something like a
  few MB per attachment and a visible total, refusing rather than silently
  degrading.
- [ ] **Export becomes a zip with a manifest**, since the current backup is a
  single JSON envelope and cannot carry bytes without base64 inflating them
  by a third inside an already-encrypted blob. 1PUX is the right *shape* —
  manifest plus files — but not worth copying field for field: nothing else
  reads our export either way, so matching someone else's schema buys
  nothing and costs a reverse-engineering exercise. A documented
  `vault.json` plus `attachments/<id>` is easier to write, to read, and to
  consume from a script.

  Whether it is named `.zip` or `.wrlck` does not matter and is explicitly
  not worth further discussion; if a custom extension is used it is
  `.wrlck`. Recorded only so it is not re-litigated.
- [ ] **A zip writer without a dependency is feasible**, which is the part
  worth checking before committing: `CompressionStream('deflate-raw')` is
  in every current browser, so a real deflated zip needs a local header,
  a central directory and a CRC-32 — roughly a hundred lines and no
  third-party code. Store-only (uncompressed) is simpler still and legal
  zip; ciphertext does not compress anyway.
- [ ] **Keep the encrypted backup encrypted.** The zip is a container, not a
  security boundary: zip's own password support is not to be used for
  anything. Each file goes in sealed under the vault key, exactly as the
  entries are.

### 10b. Import from other managers — worth less than it looks, until filling exists

**Read the "next decision" section at the top before scheduling any of this.**
Importing is the obvious next feature and the wrong one: a bulk import into a
vault that cannot fill anything raises the cost of the tedium instead of
removing it. The work below is right; the timing is after the extension, not
before it.

Already reads a generic CSV with aliased headers, which covers more than it
sounds: Bitwarden, LastPass, Chrome, Edge, Firefox and Safari all export CSV,
and the header mapping already recognises most of their column names. What is
missing is the rest.

- [ ] **Tier one, nearly free: browser CSVs.** Chrome, Edge, Firefox and
  Safari differ only in column naming. Mostly a matter of adding aliases
  and testing against a real export of each.
- [ ] **Tier two, moderate: 1PUX and Keeper.** 1Password's 1PUX is a zip with
  JSON inside — reading it needs the unzip half of whatever 10a writes,
  which is an argument for doing 10a first. Keeper exports JSON directly.
  Both carry fields WordLock now has homes for: custom fields, TOTP seeds,
  named URLs.
- [ ] **Tier three, a project of its own: KeePass KDBX.** Not a format to
  read casually — KDBX4 is an encrypted binary container with its own KDF
  (Argon2 or AES-KDF), its own cipher (ChaCha20 or AES), an inner stream
  cipher for protected values, and a compressed XML payload. Doing it
  properly means implementing another manager's crypto stack correctly,
  and doing it improperly means telling someone their import worked when
  it silently dropped their protected fields. Either build it as its own
  piece of work with its own tests, or say plainly that KeePass users
  should export CSV.
- [ ] **Import must stay non-destructive**, which it already is: merge, never
  replace, existing entries win. Every format added inherits that.
- [ ] **Report what did not come across.** Each of these formats carries
  things WordLock has no field for. Silently dropping them is the failure
  mode that loses someone's data without telling them; a summary of what
  was skipped is the minimum.

### 10c. More than one vault — decide what a vault *is* first

Raised as "group/folder membership of some variety... maybe vaults?", and the
two halves of that are different features.

- [ ] **A group is a label; a vault is an encryption boundary.** Groups exist
  and are cheap to extend — nesting, or letting an entry belong to
  several. A second *vault* means a second envelope with its own key,
  which is the only version that actually separates anything: locking the
  work vault while the personal one stays open, or a shared vault whose
  key is wrapped to several people (which is what 10f needs).
- [ ] **Multiple envelopes are not hard; the UI is the question.** The
  storage layer already keys by id and could hold several. What needs
  deciding is whether they unlock independently, whether one passphrase
  opens all of them, and what the lock button means when two are open.
- [ ] **If the answer is only "I want folders inside folders", say so and do
  that instead** — it is a tenth of the work and probably what most of the
  demand actually is.
- [x] **Tags shipped, and they are not the same feature.** Raised as an
  afterthought to this item and it is the more useful half: a folder is
  one dimension, a tag is *n*. The company card is genuinely both Work and
  Finance, and a filing system that makes you pick has thrown away one of
  the two answers. Neither replaces the other — the group still says where
  an entry *lives*, which is what makes the list scannable; tags say what
  it *is*. Done in v3.0.0, including the export columns and the
  and-not-or filter semantics.
- [ ] **What remains here is the vault-as-boundary question**, unchanged.
  Tags cover the "I want to slice my vault differently" demand; they do
  not lock anything separately, and that is the only thing a second
  envelope buys.

### 10d. Folder templates — the small one

Everything filed under *Banking* gets a PIN field and a security question;
everything under *Government* gets an SSN field. Applied at creation, not
enforced afterwards.

- [ ] **Purely local, no dependency, no architecture change.** A template is
  a list of field names and secret flags stored against a group name, and
  `startAdd` already lands a new entry in the filtered group. This is the
  cheapest item in the epic by a wide margin.
- [ ] **A starting point, not a schema.** Templates must not stop someone
  deleting a field they do not want, and changing a template must not
  rewrite existing entries. The moment it validates rather than suggests,
  it becomes a thing that argues with people about their own data.

### 10e. One-time and individual shares — a server that holds only ciphertext

Send someone a password without emailing it. Needs somewhere to put the
ciphertext, so it depends on 9d — but only for storage, and the design keeps
the server ignorant.

- [ ] **The key travels in the URL fragment, which is never sent.** Encrypt
  client-side with a fresh random key, upload only the ciphertext, and put
  the key after the `#`. Browsers do not transmit the fragment to the
  server, so the host holds a blob it cannot read even in principle. This
  is the established design and it preserves the claim on the Legal page.
- [ ] **Expiry and burn-after-reading enforced server-side**, because a
  client cannot be trusted to delete anything. One fetch, or a deadline,
  whichever comes first.
- [ ] **Say what a link is.** Anyone holding the URL holds the secret —
  including whatever logged it, sat in the chat history, or synced the
  recipient's clipboard. A share link is a password in transit, and the
  UI should say so rather than implying the encryption makes it safe to
  paste anywhere.

### 10f. Group accounts and SSO — where the model is easiest to lose

Family and company vaults, with the members' identity provider. The security
design matters more here than anywhere else in this file, because the natural
implementation quietly destroys the property everything else protects.

- [ ] **Wrap the key to each member; never hold it centrally.** Each member
  gets a keypair. A shared vault's key is encrypted once per member's
  public key. Adding someone is wrapping the key to them; removing them
  is rotating it. At no point does the server hold anything it can open.
- [ ] **SSO authenticates a person. It must never custody a key.** This is
  the trap. "Log in with Okta and see the shared vault" is only possible
  if something server-side can decrypt on the strength of an SSO
  assertion — at which point the provider, and anyone who can forge or
  replay an assertion, can read the vault. SSO can gate *access to the
  ciphertext* and prove *who you are*; the decryption key still has to
  come from something the user holds. Any design where an admin can
  recover a member's data without that member's key is a design where the
  operator can read everything, and it should be called that.
- [ ] **Admin recovery is the honest version of the same question.** Every
  company deployment eventually asks for it. It is buildable — wrap the
  vault key to an escrow key the organisation holds — but it is precisely
  the back door described above, and it must be visible to every member
  rather than a checkbox in an admin console.
- [ ] **This is the point where "no accounts, nothing leaves your device"
  stops being true**, in a way that even 9d's optional sync does not
  reach. Legal and About need rewriting in the same release, and the
  local-only mode has to keep working exactly as it does now — Epic 9's
  second invariant, which was agreed before any of this was on the list.

### 10g. A recycle bin — the same feature as undo, with the window opened

Raised as the obvious consequence of shipping undo, and that reading is
correct: **the fifteen-second undo already is a recycle bin.** It holds the
whole entry, secret included, and puts it back on request. The only things a
bin changes are how long the copy lives and where it lives, and the second of
those is what makes it a different decision rather than a bigger number.

Today the copy sits in a JavaScript variable. It dies when the countdown ends,
when the vault locks, when the tab closes, and when the machine loses power. It
is never written anywhere. A bin moves it into the vault itself, and that has
consequences the toast does not:

| | Undo (shipped) | Recycle bin |
|---|---|---|
| Lives in | memory | the encrypted vault |
| Survives a lock | no | yes |
| Survives a reboot | no | yes |
| In your exported backup | no | yes |
| Synced to every device | no | yes |

The last two are the ones to think about. A bin means a password you deleted
travels in every backup you make and lands on every replica you own, for the
length of the retention window. Someone who deletes an entry because they are
about to hand the laptop over, or because it was pasted in by mistake, has not
agreed to that.

- [ ] **Opt-in, off by default, with undo as the default behaviour.** Stated
  where the deleting happens rather than only in settings, and the
  retention window visible in the same place.
- [ ] **Decide what an export does with it.** Excluding binned items from the
  plain and CSV exports is clearly right -- another manager has no concept
  of them and would import blank rows. The encrypted backup is the
  interesting one: exclude them and restoring a backup silently empties
  the bin; include them and the backup carries deleted passwords. Probably
  include, and say so on the export screen.
- [ ] **The machinery already exists.** Tombstones, `deletedAt`, the reaper and
  its TTL, and `store.restore` were all built for sync and undo. A bin is
  those parts with the secret retained instead of discarded, which is a
  one-line change in `remove()` and a view -- and that is exactly why it
  deserves the deliberation above rather than being waved through as easy.
- [ ] **Reaping becomes user-visible.** Right now a tombstone quietly expires
  at ninety days and nothing is lost. A bin entry expiring is a password
  being destroyed on a timer, which needs to be visible before it happens
  rather than discovered after.

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

- [ ] **The two cache strategies skew by one load, and a CSP change turns that
  into a blank page.** Observed on the 3.4.0 deploy, not predicted: the first
  load of the live site rendered nothing, with `vue.esm-browser.prod.js`
  blocked by a policy that no longer allows `unsafe-eval`.

  Neither half is wrong on its own. Navigations are network-first, so the new
  HTML — and the new CSP header travelling with it — arrives immediately.
  Subresources are stale-while-revalidate, so the cached `main.js` answers now
  and the refresh lands next time. The gap is exactly one page view, and it is
  harmless right up until the header forbids what the cache is still serving.

  So every returning visitor with a warm cache got one blank page and a working
  site on reload. New visitors never saw it. Small here, and it self-healed,
  which is why this is a note rather than an incident — but it recurs on any
  future tightening of the policy, and the next one may not be as survivable.

  The awkward part: no change to the *new* worker can fix the load in question,
  because the *old* worker serves it and is already in the field by then. Only
  the next occurrence is fixable. The shape that would do it is the navigation
  response carrying its version and the worker bypassing its subresource cache
  when the two disagree — which is the same "cache-first within a version,
  never across versions" rule as the item above, applied to the moment the
  version actually changes rather than to steady state.

### 8c. Browser extension — explore

**Rewritten after Epic 9.** This item was written when WordLock was only a
generator, and it described the extension as a way to type a fresh password
into whatever field you were looking at so that *someone else's* password
manager would catch it with its own save prompt. That was the right feature for
a product with nowhere to put a password. It is the wrong one now: WordLock has
a vault, and the interesting extension fills from it. The old framing is
recorded here rather than deleted because it explains why the item sat under
Epic 8 instead of Epic 9.

- [x] **The decision that comes before any code has been made, and it is none
  of the three below.** Every client is a replica; no copy is canonical.
  The three options were a way of avoiding sync, and avoiding sync only
  works until the second client — a phone, a CLI script — at which point
  the chosen answer has to be unbuilt. See "Sync-shaped, before anything is
  synced" near the top. The extension is still worth building and it is
  still where filling comes from; it is just not the source of truth, and
  it should not be started before the entry model can reconcile.

  **Two corrections to what is written below, since it was reasoned out
  before that.** The build step is *not* forced by an extension existing:
  MV3 bans `'unsafe-eval'` and Vue's runtime compiler needs it, but the
  popup — unlock, a list of matches, a fill button — is small enough for
  plain DOM or render functions, and the portable core uses no Vue at all.
  A build step is only forced if the *full* vault UI is rendered under
  extension CSP, which is the strongest-isolation variant rather than the
  baseline.

  And `connect-src 'self'` does not mean "nowhere to send it", a phrase
  used loosely here and in the v3.0.0 changelog. It covers fetch, XHR,
  WebSocket and beacon; it does not cover top-level navigation, and the
  directive that would have (`navigate-to`) was dropped from the spec.
  Silent background exfiltration is blocked. `location.href` is not.

- [ ] **The three options, kept for the reasoning rather than the conclusion.**
  An extension cannot be a thin client of the site. The vault key exists
  only in one tab's memory on one origin, and autofill has to work when no
  WordLock tab is open — that is the entire point of it. So the extension
  has to *hold* a vault rather than ask the page for one, which makes it a
  second home for the data and forces a choice between three coherent
  answers:
  **(a) extension canonical**, and the site becomes the generator, the docs
  and a viewer for an imported file;
  **(b) site canonical**, and the extension holds a copy you refresh by
  importing a backup — unglamorous, needs no server, and enough for the
  fill-only case;
  **(c) both canonical**, which needs 9d, because "the file is the sync"
  stops working the moment there are two writers.
  Picking one is the work that makes the rest estimable; starting the code
  without picking is how a product ends up with two vaults and no story
  about which is right.
- [ ] **Manifest V3 forces the build step.** It is the same blocker already on
  the board. Extension pages get `script-src 'self'` with no
  `'unsafe-eval'`. Components here are declared with Vue's `template:`
  option, so Vue compiles them at runtime through `new Function` — the
  exact reason `render.yaml` still carries `'unsafe-eval'`, measured when
  the site rendered blank without it. Precompiling templates is the fix in
  both places at once. See 9f's `'unsafe-eval'` bullet: this is that item
  arriving with a deadline attached.
- [ ] **Roughly 2,700 lines port with little or no change.** That is more than
  it looks. `vault-crypto.js` is portable as it stands — its storage is
  already injected. `vault-store.js` needs a storage adapter and somewhere
  other than `localStorage` for the lock window. `totp.js`, `entropy.js`,
  `vault-transfer.js`, `passphrase-strength.js` and `common-passwords.js`
  move untouched. ~~What does not move is `main.js` and `vault-app.js` —
  about 4,600 lines of Vue —~~ which is precisely where the CSP problem
  lands.

  **Both halves of that have moved, in opposite directions, and neither was
  moved on purpose.** The named set measures 2,446 lines today, so "roughly
  2,700" still holds — but the *portable* set is larger than the list, because
  `vault-entry.js`, `vault-diff.js`, `recovery-key.js`, `lib.js` and
  `generators.js` were extracted for readability and are pure too. And the Vue
  half is 2,979 lines, not 4,600: it was 5,633 before the markup moved out to
  `src/templates/` in 3.4.0. The CSP problem this sentence pointed at is also
  gone — `unsafe-eval` left the policy in the same release.

  Epic 11a carries the current measurement and the folder shape it implies.
  This item stays because the file-by-file breakdown is still the useful part
  and 11a does not repeat it.
- [ ] **The hard part of autofill is not the crypto, it is origin matching.**
  An entry saved for `example.com` must fill on `example.com` and must not
  fill on `example.com.evil.co`: matched on the registrable domain rather
  than by substring, and bound to the origin rather than to "the user
  picked it from a list". Field detection, iframes and SPA re-renders are
  fiddly; this one is a security boundary, and getting it wrong turns a
  password manager into a phishing amplifier. Any version of this ships
  with tests against a list of lookalike hosts or it does not ship.
- [ ] **It does nothing for mobile.** Android autofill needs a native app
  implementing the Autofill Framework and iOS needs a Credential Provider
  Extension, which is 9c. Desktop extension plus two native shells is why
  every established manager has apps, and it should be counted as three
  codebases sharing a core rather than one feature.
- [ ] **What it costs the pitch, stated rather than glossed.** "You can read
  the deployed source" becomes "you can read the source and trust a
  store-signed bundle you did not build yourself." That is a real erosion
  of the one claim this project leads with, and it belongs on Legal in the
  same release rather than being noticed later. It also adds a new way to
  lose a vault: uninstalling an extension drops its storage silently, with
  none of the warning the persistence notice gives on the web.
- [ ] Cost is real and ongoing, and this part of the original item still
  stands: two stores with two review processes, and a permissions prompt on
  a product whose selling point is that it asks for nothing. Host
  permissions for autofill are a far harder sell than `activeTab` was for
  generating into a field — the extension has to ask to read every page you
  visit, which is exactly the request this site has never had to make.

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
