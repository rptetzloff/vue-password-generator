# House rules

Eleven rules, so they get applied rather than rediscovered. Short on purpose.

## Measure, don't assert

The most productive rule here. If a claim can be checked against the running
thing, check it before writing it down. Every serious bug in this project
looked fine in the source: a button rendered the same colour as the page
behind it while every token test passed, a dialog opened under a fixed header,
a CSP change blanked the site. Reading the code would not have found any of
them.

Corollary: a test that reads the source proves the source, not the behaviour.
Keep both.

## Don't jump to conclusions

The sibling of the rule above, and the one that actually gets broken. The
failure mode is not being wrong about hard things. It is taking a plausible
reading and stating it as established when the check was one command away.

Examples, all from one day. A CodeQL alert was reported as a stale finding on a
line the pull request did not touch — the alerts API had been asked without a
ref, so it answered for `main`, and the PR's own output naming the real file was
already on screen and lost to the tidier story. The roadmap page's claim to
render its source "as you see it there" was called true the moment the source
was fixed, while the renderer half of the same bug was still wrong.
Precompiling was announced as saving 58 KB a visitor, counting the compiler
that left and not the render functions that arrived; the corrected estimate was
wrong too, and only measuring both pages settled it. `$?` was read after a pipe,
where it belongs to the last command rather than the one whose answer mattered.

So: **if a claim is checkable in one command, run the command before saying the
thing.** When it is not checkable, say which kind of claim it is. "The API
returned one alert" and "there is one alert" are different sentences, and
collapsing them is how a wrong answer arrives sounding confident.

Two habits follow. Never pipe a command whose exit code matters. And a tool's
report of its own work is a claim rather than evidence — including a query whose
scope you chose, which will faithfully answer what you asked instead of what you
meant.

The tell is a story that resolves neatly on the first try. Evidence that arrives
already tidy has usually been tidied.

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

A new runtime dependency needs a reason in the PR. Runtime dependencies are
still zero, and that is the half that matters: nothing is fetched to run the
thing.

~~There is no build step.~~ **There is now one, and the claim it protected was
kept rather than dropped.** The deployed source is still the source you can
read, because the build runs in development and its output is committed —
what a server sends is what is in the repository, with no pipeline between
them. A build whose artefacts are not committed would break that; this one
does not.

Two obligations follow, and they are the price of the exception. Generated
files carry a header saying what generates them, and a test recompiles the
inputs and fails when the committed output no longer matches — otherwise the
source of truth quietly becomes the artefact, and editing the input stops
doing anything. Keep the input committed and readable too: generated code can
be legible and still not be the thing anyone should read.

## Docs are part of the change, not a follow-up

Every PR checks the documents that make claims about the thing, and updates
the ones the change made wrong: the readme, the security policy, the docs
page, the about and legal pages, the changelog and the roadmap. Most changes
touch two or three. Checking all of them is cheap; finding out months later
which one went stale is not, and by then the wrong version has been read.

This is a rule because nothing else catches it. A claim written when it was
true does not announce that it stopped being true — no test fails, no build
breaks, no page renders wrong. One pass found the security policy still
listing `'unsafe-eval'` as present and recovery as unbuilt, both fixed
releases earlier; the readme telling you to upgrade Vue by replacing a file
that no longer exists, which would have put the compiler back and blanked the
site; and `package.json` still advertising no build step.

**The security policy is the one that must not drift.** Its "known, not a
vulnerability" list exists to tell a researcher not to report something. An
entry left there after the fix ships does not just mislead, it suppresses the
report.

Where a claim can be checked mechanically, prefer that to diligence — the CSP
hashes, the template output and the service-worker version are all asserted by
tests for this reason. Prose mostly cannot be, which is what the pass is for.

Not every document says the same thing, and forcing them to match makes both
worse. The readme is for someone deciding whether to run or fork it; the about
page is for someone deciding whether to trust it. Same facts, different
question. What they may not do is *disagree*.

## Commits and branches

A subject line stating what the change makes true — no conventional-commit
prefixes, no ticket refs. The body is as long as the reasoning needs, including
what was measured and what was rejected.

### Development happens on `dev`. Releases are a PR from `dev` into `main`.

`dev` is what the dev site deploys, so anything that skips it reaches
production without ever having been looked at somewhere real. Committing
straight to `dev` is normal and expected — a topic branch is fine when it earns
one, but it PRs into `dev`, never into `main`. `main` is only ever written by a
release PR, and the changelog is dated by the day that PR merges, in the
maintainer's timezone rather than UTC.

### A release is tagged by what kind it is, not how big it was.

Size resists a one-word answer and the attempt degrades: a tag derived from the
version number collapses to whichever value is least wrong, and once most
releases wear the same word it has stopped saying anything. Magnitude is what
the title and summary are for.

So the release tag names its character — a feature, a fix, a security release,
maintenance — and a release can be a security one and tiny, which is the pairing
the version number cannot express. Detail belongs to the entries underneath,
grouped as added, improved, fixed, removed, security, and the limits.

**Every release states what it does not do, in its own group rather than buried
in the additions.** A changelog that only lists gains is advertising. When a
claim ships with a boundary — this makes two machines safe in sequence but not
at the same instant — the boundary is part of the release.

When the vocabulary changes, old entries keep the tag that was accurate when
they shipped. Retagging history to match a newer scheme reads as though the
scheme was always there.

## Files

Extract when a file stops being readable, not at a line count. Known
exceptions: `main.js` and `vault-app.js` are both far past that and are being
reduced by extraction, not by a rewrite.

---

*Repo-specific facts — the vault's crypto, the roadmap's epics, what shipped —
live in `ROADMAP.md` and in the module headers, not here. This file is the same
in every repo; if a rule needs a project detail to make sense, it belongs
somewhere else.*
