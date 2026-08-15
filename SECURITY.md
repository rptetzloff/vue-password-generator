# Security policy

WordLock is a password generator and an encrypted local vault. It has no
server, no accounts and no telemetry, which removes whole categories of risk
and concentrates what remains into the code you are reading. A flaw in that
code is the only way someone's vault gets opened, so reports are welcome.

## Reporting a vulnerability

**Use GitHub's private vulnerability reporting**, on the
[Security tab](https://github.com/rptetzloff/wordlock/security/advisories/new).
It opens a private thread with the maintainer and can become a published
advisory when the fix ships.

Please do not open a public issue for anything that could be used against
someone's vault before there is a fix. Anything already documented as a
limitation (see below) is fine to raise publicly.

There is no bug bounty and no payment. This is a personal project with one
maintainer, and the honest expectation is a first reply within a week rather
than within a day. Credit in the advisory and the changelog if you want it.

## Supported versions

The deployed site is the only supported version. There are no release branches
and no backports: the fix ships to `main`, the service worker's cache is
keyed to the version, and the next page load picks it up. If you are running
a copy, the fix is a `git pull`.

## In scope

- **The vault's cryptography** — `src/vault-crypto.js`. Key derivation, the
  sealed envelope, IV handling, anything that would let ciphertext be read or
  forged.
- **The vault's lifecycle** — `src/vault-store.js`, `src/vault-session.js`.
  Auto-lock, the between-pages session, key lifetime, the storage adapters.
- **Cross-site scripting anywhere on the site**, including the Markdown
  renderer (`src/markdown.js`) — it escapes before generating markup
  specifically so that pointing it at untrusted input stays safe.
- **The Content-Security-Policy** in `render.yaml`, and any way around it.
- **Randomness and the entropy figures.** A biased draw or an overstated bit
  count is a security bug here, not a cosmetic one — the number is the claim.
- **Import and export parsing** — `src/vault-transfer.js`. Malformed input
  from another manager's file should fail, not execute or corrupt.
- **Anything that sends data off the device.** The product's central claim is
  that nothing leaves it; a counterexample is the most serious report possible.

## Known and documented, not vulnerabilities

These are deliberate trade-offs, each written up in the app itself. Reports
about them are welcome as discussion, but they are not treated as findings.

- **There is no recovery.** Forget the passphrase and the vault is gone. That
  is what "nobody can open it, including us" costs. See
  [ROADMAP.md](ROADMAP.md) 9f for the recovery-key design and why it is not
  built yet.
- **The passphrase cannot be scrubbed from memory.** The vault key is a
  non-extractable `CryptoKey`, but the passphrase arrives as an ordinary
  JavaScript string, and strings are immutable — no page can overwrite one. It
  persists until the garbage collector reclaims it. Stated on the Legal page.
- **`'unsafe-eval'` is in the CSP.** Components are declared with Vue's
  `template:` option, so Vue compiles them at runtime through `new Function`.
  Removing it requires precompiled templates and therefore a build step;
  tracked in ROADMAP 9f and 8c. `connect-src 'self'` is the directive doing the
  real work.
- **A TOTP seed stored beside its password weakens two-factor auth**, because
  whoever opens the vault has both. Warned about above the field, in the docs
  and in the changelog.
- **"Stay unlocked between pages" writes a wrapped key to browser storage**
  for the length of the lock window — weaker than keeping it only in memory,
  which is why the setting exists and why `Never` turns it off.
- **Anything requiring an attacker to already have your unlocked device**, your
  browser profile on disk, or a debugger attached to the page.
- **Browser storage is not durable.** Eviction, clearing site data and losing
  the device all destroy an un-exported vault. The app says so, measures the
  quota, and asks for persistent storage.

## Dependencies

There are none at runtime. Vue is vendored as a pinned file under `vendor/`
and Material Design Icons alongside it; both are checked in rather than
fetched, and both are excluded from code scanning because they are not this
project's source. A vulnerability in vendored Vue is in scope — tell us and it
gets updated.
