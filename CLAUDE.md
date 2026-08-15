# House rules

Nine rules, so they get applied rather than rediscovered. Short on purpose.

## Measure, don't assert

The most productive rule here. If a claim can be checked against the running
thing, check it before writing it down. Every serious bug in this project
looked fine in the source: a button rendered the same colour as the page
behind it while every token test passed, a dialog opened under a fixed header,
a CSP change blanked the site. Reading the code would not have found any of
them.

Corollary: a test that reads the source proves the source, not the behaviour.
Keep both.

## Comments explain why, never what

When a value was chosen by measurement, record the number **and** the rejected
alternative. "1,000,000 rounds, not 10,000,000: measured at 93ms vs 1032ms for
4.1 bits" is worth more than the constant.

## Reversals stay visible

When a decision is overturned, mark the old one and say what changed. Do not
quietly edit it away. The trail is why the conclusion is trustworthy — a
document that only ever agreed with itself is not evidence of anything.

## State the limit of the claim

Say what a thing does *not* do, in the same breath. "At most N bits", not "N
bits". If a guarantee has an exception, the exception ships next to it. When a
claim stops being true, rewrite it deliberately rather than deleting it.

## Tests assert rules, and fail on the old code

Where a rule can be read out of the source, assert it against the source.
Where it cannot, measure the running page. Either way: verify a new test fails
before the fix, by reverting. A test that never failed has proved nothing.

Pure functions stay pure so they stay importable, and side effects
(storage, clocks, network) get injected so they can be faked.

## Colour and theme

All colour through tokens. Never a literal in a component. `data-theme` is
stamped by a blocking inline script before first paint. Every intended pair is
verified by test — 4.5:1 for text, 3.0:1 for control boundaries — across every
palette and both themes, because a pair that passes in one can fail in another.

## Dependencies default to none

A new runtime dependency needs a reason in the PR. There is no build step: the
deployed source is the source you can read, which is a claim the product makes
and not merely a preference.

## Commits and branches

A subject line stating what the change makes true — no conventional-commit
prefixes, no ticket refs. The body is as long as the reasoning needs, including
what was measured and what was rejected.

Everything lands on `dev`, which is what the dev site deploys. Committing
straight to it is normal; branches are fine but they PR into `dev`, never
`master`. Releases are `dev` → `master`.

## Files

Extract when a file stops being readable, not at a line count. Known
exceptions: `main.js` and `vault-app.js` are both far past that and are being
reduced by extraction, not by a rewrite.

---

*Repo-specific facts — the vault's crypto, the roadmap's epics, what shipped —
live in `ROADMAP.md` and in the module headers, not here. This file is the same
in every repo; if a rule needs a project detail to make sense, it belongs
somewhere else.*
