import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

// Source files must be text.
//
// vault-transfer.js shipped with three literal NUL bytes in it, used as the
// delimiter in a Map key. It worked -- NUL is legal inside a JS string, and
// every test passed -- but it made the file binary as far as tooling is
// concerned: grep skipped it with "Binary file matches", and git would have
// stopped producing readable diffs for it. On a project whose pitch is that
// you can read the deployed source, a file that tools refuse to read as text
// is a quiet failure of exactly that promise.
//
// The delimiter is a JSON pair now. This makes sure the next invisible
// character does not last as long.

const ROOT = new URL('../', import.meta.url)

const sourceFiles = () => {
  const out = []
  const walk = (dir) => {
    for (const name of fs.readdirSync(new URL(dir, ROOT), { withFileTypes: true })) {
      if (name.name === 'node_modules' || name.name.startsWith('.')) continue
      const rel = `${dir}${name.name}`
      if (name.isDirectory()) walk(`${rel}/`)
      else if (/\.(js|css|html|json|md|yaml|yml)$/.test(name.name)) out.push(rel)
    }
  }
  for (const dir of ['src/', 'test/', 'data/']) walk(dir)
  for (const name of fs.readdirSync(ROOT)) {
    if (/\.(html|json|md|yaml|yml)$/.test(name)) out.push(name)
  }
  return out
}

test('no source file contains a NUL or other stray control byte', () => {
  // Tab, newline and carriage return are the legitimate ones.
  const forbidden = /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/
  for (const rel of sourceFiles()) {
    const text = fs.readFileSync(new URL(rel, ROOT), 'utf8')
    const match = forbidden.exec(text)
    if (!match) continue
    const line = text.slice(0, match.index).split('\n').length
    assert.fail(
      `${rel}:${line} contains U+${match[0].codePointAt(0).toString(16).padStart(4, '0').toUpperCase()}. ` +
        'Control characters make the file binary to grep and to git diff; write them as an escape ' +
        'sequence, or use a construct that does not need one.',
    )
  }
})

test('the hygiene check is actually looking at the source', () => {
  // A walker that silently found nothing would pass the test above forever.
  const files = sourceFiles()
  assert.ok(files.length > 30, `only found ${files.length} source files to check`)
  assert.ok(files.some((f) => f === 'src/vault-transfer.js'), 'the file that prompted this is not covered')
  assert.ok(files.some((f) => f.endsWith('.css')), 'stylesheets are not covered')
})

// A backslash escape inside a template literal is consumed by the template,
// not passed through to the RegExp.
//
// A RegExp built from a template literal in controls.test.js was written to
// match optional whitespace and reached the RegExp as `s*` -- zero or more of
// the letter s. It passed because the CSS happens to have no space before its
// colons, and it was wrong in both directions: it rejected the legal
// `--pw-edge : 0.35rem`, and it accepted `--pw-edges:`, a different variable
// entirely. CodeQL found it; this makes sure the next one does not need CodeQL.
test('template-literal regexes escape their backslashes twice', () => {
  // A lone backslash -- one not preceded by another -- before a character that
  // only means something to a regex.
  const lone = /(^|[^\\])\\([sdwSDWbB.+*?()[\]{}|^$])/g
  const findings = []

  for (const rel of sourceFiles()) {
    if (!rel.endsWith('.js')) continue
    const text = fs.readFileSync(new URL(rel, ROOT), 'utf8')

    for (const m of text.matchAll(/new RegExp\(`([^`]*)`/g)) {
      // Interpolations can hold a real regex literal, whose backslashes belong
      // to that literal rather than to the template around it.
      const template = m[1].replace(/\$\{[^}]*\}/g, '')
      const bad = [...new Set([...template.matchAll(lone)].map((x) => '\\' + x[2]))]
      if (!bad.length) continue
      findings.push(`${rel}:${text.slice(0, m.index).split('\n').length} uses ${bad.join(', ')}`)
    }
  }

  assert.deepEqual(findings, [],
    'these collapse before the RegExp sees them; double the backslash:\n  ' + findings.join('\n  '))
})

test('the escape check can tell a collapsed escape from a correct one', () => {
  // The check above passes trivially if its pattern is wrong, and a regex about
  // regexes is exactly where that happens. String.raw throughout, so what is
  // written here is what is tested -- ordinary quoting would collapse the very
  // backslashes under examination.
  const lone = /(^|[^\\])\\([sdwSDWbB.+*?()[\]{}|^$])/

  assert.ok(lone.test(String.raw`${'${name}'}\s*:`), 'a single backslash must be caught')
  assert.ok(!lone.test(String.raw`${'${name}'}\\s*:`), 'a doubled backslash is correct and must not be flagged')
  assert.ok(!lone.test(String.raw`plain text with no escapes`), 'ordinary text must not be flagged')
})
