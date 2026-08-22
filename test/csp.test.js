import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import crypto from 'node:crypto'
import { PAGE_FILES } from './helpers/pages.js'

// The Content-Security-Policy in render.yaml, checked against the pages it has
// to allow.
//
// A CSP with hashes is a config file that must agree with seven HTML files, and
// nothing about editing an inline <script> reminds you to update it. When they
// disagree the failure is total and silent in review: the browser refuses the
// script, the theme never primes, the app never mounts, and the site is blank.
// So the hashes are treated as derived data -- recomputed here from the HTML,
// with the header asserted to match.

const ROOT = new URL('../', import.meta.url)
const PAGES_ON_DISK = fs.readdirSync(ROOT).filter((f) => f.endsWith('.html'))
const RENDER_YAML = fs.readFileSync(new URL('render.yaml', ROOT), 'utf8')

/** The CSP header value as deployed. */
const policy = (() => {
  const m = /name:\s*Content-Security-Policy\s*\n\s*value:\s*"([^"]+)"/.exec(RENDER_YAML)
  assert.ok(m, 'render.yaml should set a Content-Security-Policy header')
  return m[1]
})()

const directive = (name) => {
  const m = new RegExp(`(?:^|;)\\s*${name}\\s+([^;]+)`).exec(policy)
  return m ? m[1].trim().split(/\s+/) : null
}

/**
 * Inline script bodies, hashed the way the browser will hash them.
 *
 * Normalized to LF first. Git stores these files with LF and Render clones on
 * Linux, so LF is what is actually served -- but the working tree on Windows
 * is CRLF, and hashing that produces values which pass nothing. This exact
 * mistake would have shipped a blank site while testing clean locally.
 */
const inlineScriptHashes = () => {
  const found = new Map()
  // EVERY html file at the root, not just the nav manifest. vault-moved.html
  // is not a nav destination -- it is where an old bookmark lands -- so it was
  // invisible to a loop over PAGE_FILES, and its inline module script shipped
  // without a hash. The page loaded, the script was blocked, and the suite was
  // green. A CSP check that only looks at pages someone remembered to list is
  // not checking the CSP.
  for (const page of PAGES_ON_DISK) {
    const src = fs.readFileSync(new URL(page, ROOT), 'utf8').replace(/\r\n/g, '\n')
    const re = /<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g
    for (let m = re.exec(src); m; m = re.exec(src)) {
      const hash = 'sha256-' + crypto.createHash('sha256').update(m[1], 'utf8').digest('base64')
      if (!found.has(hash)) found.set(hash, [])
      found.get(hash).push(page)
    }
  }
  return found
}

test('every inline script is allowed by a hash in the policy', () => {
  const allowed = new Set(directive('script-src').map((s) => s.replace(/^'|'$/g, '')))
  for (const [hash, pages] of inlineScriptHashes()) {
    assert.ok(
      allowed.has(hash),
      `${pages.join(', ')} contains an inline <script> that the CSP would block.\n` +
        `  Add '${hash}' to script-src in render.yaml.\n` +
        '  (Hashes are computed over LF-normalized content — the working tree is CRLF.)',
    )
  }
})

test('the policy carries no hash that nothing uses', () => {
  // A leftover hash is not a security hole, but it is a lie about what the
  // site contains, and it hides the fact that a script was removed.
  const used = new Set(inlineScriptHashes().keys())
  const listed = directive('script-src')
    .map((s) => s.replace(/^'|'$/g, ''))
    .filter((s) => s.startsWith('sha256-'))
  for (const hash of listed) {
    assert.ok(used.has(hash), `script-src lists '${hash}', which no page uses any more`)
  }
})

test('no page carries its own CSP meta tag', () => {
  // Two policies are intersected, not merged, so a stray meta tag can only
  // ever break the header without appearing to change anything about it.
  // One was left behind during development of this very policy.
  for (const page of PAGE_FILES) {
    const src = fs.readFileSync(new URL(page, ROOT), 'utf8')
    assert.ok(
      !/http-equiv=["']Content-Security-Policy/i.test(src),
      `${page} declares a CSP in a meta tag; the policy lives in render.yaml`,
    )
  }
})

test('the exfiltration channels are closed', () => {
  // The point of a CSP on a vault that has no server: whatever happens, the
  // secrets have nowhere to go. Each of these is a separate way out.
  const expectations = [
    ['connect-src', "'self'", 'fetch/XHR/WebSocket to another origin'],
    ['form-action', "'none'", 'POSTing a form to another origin'],
    ['img-src', "'self'", 'a remote image URL carrying data in its path'],
    ['base-uri', "'none'", 'retargeting every relative URL on the page'],
    ['object-src', "'none'", 'plugin content'],
    ['frame-ancestors', "'none'", 'being framed for clickjacking'],
  ]
  for (const [name, required, why] of expectations) {
    const values = directive(name)
    assert.ok(values, `CSP is missing ${name}, which blocks ${why}`)
    assert.ok(
      values.includes(required),
      `${name} is "${values.join(' ')}" but must include ${required} — otherwise ${why} is open`,
    )
  }
  // 'self' is only a closed channel if nothing wildcards it back open.
  assert.ok(!/\*/.test(policy), `the policy contains a wildcard: ${policy}`)
  assert.ok(!/'unsafe-inline'[^;]*;?\s*$|script-src[^;]*'unsafe-inline'/.test(policy),
    "script-src must not allow 'unsafe-inline'; the hashes exist precisely so it does not")
})

test("'unsafe-eval' is gone, and cannot come back unnoticed", () => {
  // REVERSED. This asserted the OPPOSITE -- that 'unsafe-eval' was present
  // and its reason documented -- because Vue compiled `template:` strings in
  // the browser through `new Function`, and without the allowance every page
  // rendered blank. That was measured, and true, for as long as it lasted.
  //
  // Templates are compiled ahead of time now (tools/build-templates.mjs) and
  // the page ships vue.runtime.esm-browser.prod.js, which has no compiler in
  // it. Nothing on this origin builds a function from a string, so the policy
  // must not say it may.
  const scriptSrc = directive('script-src')
  assert.ok(
    !scriptSrc.includes("'unsafe-eval'"),
    "script-src still allows 'unsafe-eval', which nothing needs now that "
      + 'templates are precompiled',
  )

  // The half that would actually break the site. A runtime `template:` needs
  // both the compiler and the allowance, and its failure mode is a blank page
  // rather than an error -- so fail here, where the cause is legible.
  for (const f of ['src/main.js', 'src/vault-app.js']) {
    const text = fs.readFileSync(new URL(f, ROOT), 'utf8')
    assert.ok(
      !/^\s*template:\s*`/m.test(text),
      `${f} declares a runtime template: string, which cannot render without `
        + "'unsafe-eval' and the full Vue build. Put the markup in "
        + 'src/templates/ and run node tools/build-templates.mjs',
    )
    // And the runtime-only build has to be the one shipped, or templates
    // would quietly start compiling in the browser again.
    assert.match(text, /vue\.runtime\.esm-browser\.prod\.js/,
      `${f} must import the runtime-only Vue build`)
  }
})
