import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

// The committed render functions must be what the committed templates compile
// to. That is the whole bargain of precompiling here.
//
// Generated code is checked in on purpose: Render serves this repository
// as-is, so an artifact that is not committed would mean the deployed site is
// not the repo. The risk that buys is drift -- a template edited without
// regenerating, which is silent, because the old render function keeps working
// and keeps rendering the OLD markup. Nothing about editing an .html file
// reminds you to run a build.
//
// So the output is treated as derived data and recomputed here, exactly the
// way test/csp.test.js recomputes the CSP hashes from the HTML rather than
// trusting the header.
//
// This is the one test that needs `npm ci`. The compiler is a devDependency
// and cannot be vendored: the browser build of @vue/compiler-dom refuses
// module mode (compiler-48) because prefixing identifiers needs a JS parser it
// does not bundle, and the function mode it will do emits `with (_ctx)`, which
// is a SyntaxError in any ES module. Measured both ways before accepting the
// dependency.

const ROOT = new URL('../', import.meta.url)
const has = (p) => fs.existsSync(new URL(p, ROOT))

// Skip cleanly when the compiler is absent rather than erroring at import
// time, so `node --test` on a fresh clone still runs the other 730 tests.
// CI installs, so CI enforces it -- see .github/workflows/test.yml.
const installed = has('node_modules/@vue/compiler-dom')

test('the committed render functions match the committed templates', { skip: !installed && 'run npm ci first' }, async () => {
  const { BUNDLES, buildBundle } = await import('../tools/build-templates.mjs')
  for (const bundle of BUNDLES) {
    const expected = buildBundle(bundle)
    if (expected === null) continue
    const target = new URL(bundle.out, ROOT)
    assert.ok(fs.existsSync(target), `${bundle.out} is missing; run node tools/build-templates.mjs`)
    const actual = fs.readFileSync(target, 'utf8')
    assert.equal(
      actual.replace(/\r\n/g, '\n'),
      expected.replace(/\r\n/g, '\n'),
      `${bundle.out} is stale. Run: node tools/build-templates.mjs`,
    )
  }
})

// The rules below need no compiler, so they run everywhere.

test('every generated bundle is precached', () => {
  // A generated module that 404s offline is worse than a missing one: the page
  // loads, the import fails, and the app does not mount.
  const sw = fs.readFileSync(new URL('sw.js', ROOT), 'utf8')
  for (const out of ['src/main.render.js', 'src/vault.render.js']) {
    if (!has(out)) continue
    assert.ok(sw.includes(`'/${out}'`), `${out} exists but is not in the precache list`)
  }
})

test('a component never declares both a template and a render function', () => {
  // The migration hazard. `render` wins and `template` is ignored, so a
  // half-converted component keeps rendering from the render function while
  // the template sitting beside it -- the thing a person would edit -- quietly
  // does nothing.
  for (const file of ['src/main.js', 'src/vault-app.js']) {
    const text = fs.readFileSync(new URL(file, ROOT), 'utf8')
    // Component blocks are `const X = { ... }` at top level; a cheap proxy is
    // to check no `render:` and `template:` appear between one `setup(` and
    // the next.
    const chunks = text.split(/\n(?=const [A-Z][A-Za-z0-9_$]* = \{)/)
    for (const chunk of chunks) {
      const name = (chunk.match(/^const ([A-Za-z0-9_$]+)/) || [])[1]
      if (!name) continue
      const hasTemplate = /\n\s+template:\s*`/.test(chunk)
      const hasRender = /\n\s+render:\s*render[A-Z]/.test(chunk)
      assert.ok(!(hasTemplate && hasRender),
        `${file}: ${name} declares both template: and render: -- the template is dead code`)
    }
  }
})

test('no template file is orphaned, and no render export is unused', () => {
  // Both directions. A template with no import is markup nobody renders; an
  // import with no template is a build that will fail next time it runs.
  for (const [dir, out, consumer] of [
    ['src/templates/main', 'src/main.render.js', 'src/main.js'],
    ['src/templates/vault', 'src/vault.render.js', 'src/vault-app.js'],
  ]) {
    if (!has(dir)) continue
    const names = fs.readdirSync(new URL(dir + '/', ROOT))
      .filter((f) => f.endsWith('.html'))
      .map((f) => f.replace(/\.html$/, ''))
    if (!names.length) continue

    const generated = fs.readFileSync(new URL(out, ROOT), 'utf8')
    const used = fs.readFileSync(new URL(consumer, ROOT), 'utf8')
    for (const name of names) {
      assert.ok(generated.includes(`export function render${name}(`),
        `${dir}/${name}.html has no render${name} in ${out}`)
      assert.ok(used.includes(`render${name}`),
        `${dir}/${name}.html compiles to render${name}, which ${consumer} never uses`)
    }
  }
})
