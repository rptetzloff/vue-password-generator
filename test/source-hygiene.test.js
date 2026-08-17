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
  for (const dir of ['src/', 'core/', 'ui/', 'test/', 'data/']) walk(dir)
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
  assert.ok(files.some((f) => f === 'core/vault/transfer.js'), 'the file that prompted this is not covered')
  assert.ok(files.some((f) => f.startsWith('src/')), 'src/ must still be walked')
  assert.ok(files.some((f) => f.startsWith('core/')), 'core/ must be walked too -- it did not exist when this walker was written')
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

// -- the vendored library, and the only thing that can watch it ---------------

test('the declared Vue version is the Vue version actually vendored', () => {
  // Vue is not installed, it is COPIED IN: vendor/vue.runtime.esm-browser.prod.js is
  // what the browser runs, and there is no node_modules at runtime. That is
  // deliberate -- no build step, the deployed source is the source you can
  // read -- but it had a cost nobody had priced. Dependabot and npm audit read
  // package.json, so the one third-party library in the product was the one
  // thing no scanner was watching. A security pass before a release found it
  // by asking what was NOT being checked.
  //
  // So it is declared in devDependencies, exactly pinned. devDependencies and
  // not dependencies because it is honest: nothing installs Vue to run this,
  // the entry names the upstream source of a file we vendor, and
  // `dependencies: {}` stays literally true.
  //
  // The failure that buys is drift -- bumping the pin without re-vendoring, or
  // re-vendoring without bumping the pin, either of which points the alerting
  // at a version that is not what ships. That is what this test is for. Vue's
  // minified build keeps its version as a string literal (`Ti="3.4.0"`), which
  // is what makes the shipped bytes self-identifying.
  const pkg = JSON.parse(fs.readFileSync(new URL('package.json', ROOT), 'utf8'))
  const declared = pkg.devDependencies && pkg.devDependencies.vue
  assert.ok(declared, 'Vue must be declared so a scanner can see it')
  assert.match(declared, /^\d+\.\d+\.\d+$/,
    'pinned exactly -- a range would mean the declared version is not the shipped one')

  const bundle = fs.readFileSync(new URL('vendor/vue.runtime.esm-browser.prod.js', ROOT), 'utf8')
  const found = [...bundle.matchAll(/"(\d+\.\d+\.\d+)"/g)].map((m) => m[1])
  assert.ok(found.includes(declared),
    `package.json declares vue@${declared}, which does not appear in the vendored bundle`)
})

test('nothing is declared as a runtime dependency', () => {
  // The claim on the tin. devDependencies may hold the vendored library's
  // upstream name; dependencies stays empty, because nothing is fetched to
  // run this.
  const pkg = JSON.parse(fs.readFileSync(new URL('package.json', ROOT), 'utf8'))
  assert.deepEqual(pkg.dependencies ?? {}, {})
})

test('nothing shadows a browser global that gets used bare', () => {
  // `const location = ref(...)` in vault-app.js shadowed window.location for
  // the whole of setup(), so `location.href = '/#words'` in the Change
  // settings handler set a property on a Vue ref and navigated nowhere.
  //
  // Silent in every direction: no error, no warning, the assignment is legal,
  // and the tests could not see it because they do not run a browser. It
  // shipped with folder storage and was found by someone clicking the button.
  //
  // The rule is the shadowing, not the assignment. Renaming one call site to
  // window.location fixes today's bug and leaves the trap for whoever next
  // writes location.reload() or location.search in that file.
  // Narrowed to the globals this codebase actually uses bare: window.location
  // for navigation and window.navigator for storage and the user agent. A
  // broader list caught a block-scoped `const length` inside an entropy
  // calculation, which shadows nothing anyone would reach for -- a rule that
  // cries wolf gets deleted, and then it protects nothing.
  const GLOBALS = ['location', 'navigator']
  const root = new URL('../', import.meta.url)
  // src/ and core/ both, since core/ was carved out of src/ and the same
  // declarations moved with it. A walker pointed at the old directory would
  // have gone on passing while covering less.
  const files = []
  const walk = (dir) => {
    for (const e of fs.readdirSync(new URL(dir, root), { withFileTypes: true })) {
      if (e.isDirectory()) walk(`${dir}${e.name}/`)
      else if (e.name.endsWith('.js')) files.push(dir + e.name)
    }
  }
  walk('src/')
  walk('core/')
  walk('ui/')
  assert.ok(files.some((f) => f.startsWith('core/')), 'core/ must be covered')
  assert.ok(files.some((f) => f.startsWith('ui/')), 'ui/ must be covered')

  for (const f of files) {
    const text = fs.readFileSync(new URL(f, root), 'utf8')
    for (const g of GLOBALS) {
      // Declarations only -- a property called `name` or a destructured
      // parameter is fine; it is `const name = ...` at statement level that
      // captures every later bare use in the file.
      const re = new RegExp(String.raw`(?:^|[;{]\s*|\n\s*)(?:const|let|var)\s+${g}\s*=`, 'm')
      assert.ok(!re.test(text),
        `${f} declares a variable named "${g}", which shadows window.${g} ` +
        'for the rest of the scope. Rename it.')
    }
  }
})

test('the CC BY-SA wordlist stays outside the MIT tree', () => {
  // data/orchard-street-long.txt is CC BY-SA 4.0. The rest of this project is
  // MIT, and the list is its own file specifically so the share-alike terms
  // never reach words.json or the source. Until now that boundary was held by
  // the directory layout and a paragraph in the readme -- which is thin
  // protection in a project whose next epic rearranges the directory layout.
  //
  // Folding the list into core/generate/ beside MIT source is exactly how a
  // licence boundary gets erased by a `git mv`, so the layout is asserted
  // rather than trusted.
  const root = new URL('../', import.meta.url)
  const MIT_TREES = ['core/', 'src/', 'tools/']
  const SHARE_ALIKE = ['orchard-street-long.txt']

  for (const dir of MIT_TREES) {
    const walk = (d) => {
      for (const e of fs.readdirSync(new URL(d, root), { withFileTypes: true })) {
        if (e.isDirectory()) { walk(`${d}${e.name}/`); continue }
        assert.ok(!SHARE_ALIKE.includes(e.name),
          `${d}${e.name} is CC BY-SA 4.0 and must not live inside the MIT tree. `
          + 'Keep it under data/, a sibling of core/ rather than a child.')
      }
    }
    walk(dir)
  }

  // And it must still be where the readme says it is.
  assert.ok(fs.existsSync(new URL('data/orchard-street-long.txt', root)),
    'the wordlist moved; the licence note in README.md points at data/')
})

test('core/ names no browser API', () => {
  // The property that makes core/ portable, and the one that erodes silently.
  // Nothing fails when a module reaches for localStorage -- it works in the
  // browser, the tests inject fakes and never notice, and the iOS credential
  // provider finds out much later.
  //
  // This is what kept generators.js and vault-store.js in src/ through the
  // first half of phase 1: not Vue, which nothing imported, but a
  // localStorage read in readSettings() and two adapter imports used only to
  // default a parameter. Both were invisible to the suite for exactly this
  // reason -- a test that injects a fake proves the code works with the fake,
  // not that the dependency is optional.
  //
  // Comments may mention these freely; several explain why the thing is NOT
  // used here. It is code that may not.
  const BROWSER = ['localStorage', 'sessionStorage', 'indexedDB', 'navigator', 'document', 'fetch']
  const root = new URL('../', import.meta.url)
  const offenders = []

  const walk = (dir) => {
    for (const e of fs.readdirSync(new URL(dir, root), { withFileTypes: true })) {
      if (e.isDirectory()) { walk(`${dir}${e.name}/`); continue }
      if (!e.name.endsWith('.js')) continue
      const rel = dir + e.name
      const text = fs.readFileSync(new URL(rel, root), 'utf8')
      text.split(/\r?\n/).forEach((line, i) => {
        const code = line.replace(/^\s*(\/\/|\*|\/\*).*$/, '')
        for (const api of BROWSER) {
          // String.raw, so the word boundaries survive being written down.
          // They did not the first time: a heredoc collapsed `\\b` to `\b`,
          // which a template literal reads as a BACKSPACE character, and the
          // guard would have matched nothing and passed forever. The escape
          // check two tests up caught it, which is the only reason this is
          // not still sitting here looking green.
          if (new RegExp(String.raw`\b${api}\b`).test(code)) {
            offenders.push(`  ${rel}:${i + 1} uses ${api} — ${line.trim().slice(0, 60)}`)
          }
        }
      })
    }
  }
  walk('core/')

  assert.deepEqual(offenders, [],
    'core/ must stay portable; move the side effect to src/ and inject the '
    + `result:\n${offenders.join('\n')}`)
})

test('ui/ does not import from src/', () => {
  // The layering that makes the split possible. ui/ is the chrome both halves
  // will need -- the header, the footer, the nav, the theme and the tokens --
  // so it may reach down into core/ and sideways within itself, and never up
  // into an app.
  //
  // Nothing enforces this on its own. A stray `import { something } from
  // '../src/vault-store.js'` in site-footer.js would work perfectly in the
  // browser today and quietly make the marketing site depend on the vault,
  // which is discovered when site/ is assembled and the import 404s.
  const root = new URL('../', import.meta.url)
  const offenders = []
  for (const e of fs.readdirSync(new URL('ui/', root), { withFileTypes: true })) {
    if (!e.isFile() || !e.name.endsWith('.js')) continue
    const text = fs.readFileSync(new URL(`ui/${e.name}`, root), 'utf8')
    for (const m of text.matchAll(/from\s+'([^']+)'/g)) {
      if (/(^|\/)\.\.\/src\//.test(m[1]) || m[1].startsWith('/src/')) {
        offenders.push(`  ui/${e.name} imports ${m[1]}`)
      }
    }
  }
  assert.deepEqual(offenders, [],
    `ui/ is shared chrome and must not depend on an app:\n${offenders.join('\n')}`)
})
