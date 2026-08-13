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
