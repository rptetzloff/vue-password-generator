import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { ROOTS, buildRoot } from '../tools/build-publish-roots.mjs'

// site/ and app/ are GENERATED and committed, the same bargain src/main.render.js
// makes: input and output both in the repository, and a test that rebuilds the
// output and fails when the committed copy no longer matches. Without this the
// source of truth quietly becomes the artefact, and editing about.html at the
// root stops doing anything.

const ROOT = new URL('../', import.meta.url)

const onDisk = (name) => {
  const out = new Map()
  const walk = (rel) => {
    for (const e of fs.readdirSync(new URL(rel + '/', ROOT), { withFileTypes: true })) {
      if (e.isDirectory()) walk(`${rel}/${e.name}`)
      else out.set(`${rel}/${e.name}`.slice(name.length + 1), fs.readFileSync(new URL(`${rel}/${e.name}`, ROOT)))
    }
  }
  walk(name)
  return out
}

for (const name of Object.keys(ROOTS)) {
  test(`${name}/ matches what the source assembles to`, () => {
    const want = buildRoot(name)
    const have = onDisk(name)

    const missing = [...want.keys()].filter((k) => !have.has(k))
    const extra = [...have.keys()].filter((k) => !want.has(k))
    assert.deepEqual(missing, [], `${name}/ is missing files; run node tools/build-publish-roots.mjs`)
    assert.deepEqual(extra, [], `${name}/ has files the source does not produce; run the builder`)

    const changed = [...want.keys()].filter((k) => !have.get(k).equals(want.get(k)))
    assert.deepEqual(changed, [],
      `${name}/ has drifted from source. Edit the file at the ROOT, not the copy, then run `
      + 'node tools/build-publish-roots.mjs')
  })
}

test('each root is self-contained: nothing it serves is missing from it', () => {
  // The constraint that forced generated roots in the first place. A static
  // service publishes one directory and serves nothing outside it, so a page
  // referencing /ui/tokens.css needs that file INSIDE its own root.
  for (const name of Object.keys(ROOTS)) {
    const files = buildRoot(name)
    const has = (p) => files.has(p.replace(/^\//, ''))
    for (const [rel, buf] of files) {
      if (!rel.endsWith('.html')) continue
      const html = buf.toString('utf8')
      // A [data-host] link deliberately leaves for the other deployment and is
      // rewritten to an absolute URL at runtime, so it is exempt. This test
      // found both of them: the home page's "Generate a password" and its link
      // to the vault, which without the marker resolved to the site's own home
      // page instead of the app.
      const anchors = [...html.matchAll(/<a\b[^>]*>/g)].map((m) => m[0])
      const crossHost = new Set(anchors
        .filter((a) => /\bdata-host=/.test(a))
        .map((a) => (/href="([^"]+)"/.exec(a) || [])[1])
        .filter(Boolean))

      const refs = [...html.matchAll(/(?:src|href)="(\/[^"#?]+)"/g)].map((m) => m[1])
      for (const ref of refs) {
        if (ref === '/' || crossHost.has(ref)) continue
        assert.ok(has(ref), `${name}/${rel} references ${ref}, which is not inside ${name}/`)
      }
    }
  }
})

test('the two roots hold what they should and nothing of the other', () => {
  const site = buildRoot('site')
  const app = buildRoot('app')

  // Decided 2026-08-17: generator and vault to the app, prose to the site.
  assert.ok(app.has('index.html') && app.has('vault.html'))
  assert.ok(!app.has('about.html'), 'the prose pages do not belong on the app host')
  for (const p of ['about.html', 'changelog.html', 'docs.html', 'legal.html', 'roadmap.html']) {
    assert.ok(site.has(p), `${p} belongs on the site host`)
  }
  assert.ok(!site.has('vault.html'), 'the vault does not belong on the marketing host')

  // The home page is authored as home.html because index.html is the
  // generator; it becomes index.html only inside site/.
  assert.ok(site.has('index.html'), 'site/ needs a home page')
  assert.ok(!site.has('home.html'), 'home.html is renamed on the way in, not copied twice')

  // Vue and the word lists are needed by the app alone, so they are not
  // duplicated. The icon font is the one asset both genuinely need.
  assert.ok(app.has('vendor/vue.runtime.esm-browser.prod.js'))
  assert.ok(!site.has('vendor/vue.runtime.esm-browser.prod.js'), 'the site loads no Vue')
  // site/ does carry the wordlist, but only because legal.html cites it as a
  // CC BY-SA attribution. It carries no other data file.
  assert.ok(site.has('data/orchard-street-long.txt'), 'legal.html links the wordlist it attributes')
  assert.ok(!site.has('data/words.json'), 'the site needs no slot vocabulary')
  assert.ok(app.has('vendor/mdi/fonts/materialdesignicons-webfont.woff2'))
  assert.ok(site.has('vendor/mdi/fonts/materialdesignicons-webfont.woff2'))

  // Build inputs are not served, and never were.
  assert.ok(![...app.keys()].some((k) => k.startsWith('src/templates/')),
    'src/templates/ is compiler input, not something to publish')
})

test("each root's service worker precaches its own contents, and only those", () => {
  for (const name of Object.keys(ROOTS)) {
    const files = buildRoot(name)
    const sw = files.get('sw.js').toString('utf8')
    const listed = [...sw.matchAll(/'(\/[^']*)'/g)].map((m) => m[1])
    for (const entry of listed) {
      if (entry === '/') continue
      assert.ok(files.has(entry.slice(1)),
        `${name}/sw.js precaches ${entry}, which is not in ${name}/ — it would 404 offline`)
    }
    // And the reverse: everything servable is listed. Generated rather than
    // hand-maintained precisely so this cannot drift.
    for (const rel of files.keys()) {
      if (rel === 'sw.js') continue
      assert.ok(listed.includes('/' + rel), `${name}/${rel} is servable but not precached`)
    }
  }
})
