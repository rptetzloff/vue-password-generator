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
  for (const page of PAGE_FILES) {
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

test("'unsafe-eval' is present, and its reason is written down", () => {
  // Not an oversight. Vue compiles `template:` strings at runtime through
  // `new Function`, so without this every page renders blank -- measured, not
  // assumed. Asserting it stays documented rather than asserting it away.
  const scriptSrc = directive('script-src')
  assert.ok(
    scriptSrc.includes("'unsafe-eval'"),
    "script-src needs 'unsafe-eval': Vue's runtime template compiler uses new Function, " +
      'and without it the app does not render at all',
  )
  assert.match(
    RENDER_YAML,
    /new Function/,
    "render.yaml must explain why 'unsafe-eval' is there, or a future reader will " +
      'remove it and ship a blank site',
  )
  // If the templates are ever precompiled, this is the reminder to drop it.
  const usesRuntimeTemplates = ['src/main.js', 'src/vault-app.js'].some((f) =>
    /^\s*template:\s*`/m.test(fs.readFileSync(new URL(f, ROOT), 'utf8')))
  assert.ok(
    usesRuntimeTemplates,
    "nothing uses a runtime `template:` string any more — drop 'unsafe-eval' from render.yaml",
  )
})
