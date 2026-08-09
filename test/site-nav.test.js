import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { isCurrentPage, PAGES } from '../src/site-nav.js'
import { footerPages } from '../src/site-footer.js'

const PAGE_FILES = ['index.html', 'docs.html', 'changelog.html', 'about.html', 'legal.html', 'roadmap.html']

test('every page in the nav is reachable and unique', () => {
  const hrefs = PAGES.map(p => p.href)
  assert.equal(new Set(hrefs).size, hrefs.length, 'duplicate hrefs')
  for (const p of PAGES) {
    assert.ok(p.label, 'every entry needs a label')
    assert.ok(p.icon, 'every entry needs an icon')
    assert.ok(p.href.startsWith('/'), `${p.href} should be root-relative`)
  }
})

test('isCurrentPage matches a plain path', () => {
  assert.ok(isCurrentPage('/docs.html', '/docs.html'))
  assert.ok(isCurrentPage('/legal.html', '/legal.html'))
  assert.ok(!isCurrentPage('/docs.html', '/legal.html'))
})

// Hosts that serve clean URLs rewrite /docs.html to /docs. `serve` does this
// locally, and it is what made the current-page marker silently do nothing.
test('isCurrentPage matches when the host strips the .html extension', () => {
  assert.ok(isCurrentPage('/docs.html', '/docs'))
  assert.ok(isCurrentPage('/changelog.html', '/changelog'))
  assert.ok(isCurrentPage('/about.html', '/about'))
  assert.ok(!isCurrentPage('/about.html', '/legal'))
})

test('isCurrentPage handles every spelling of the root', () => {
  for (const p of ['/', '', '/index.html', '/index']) {
    assert.ok(isCurrentPage('/', p), `root should match ${JSON.stringify(p)}`)
  }
  assert.ok(!isCurrentPage('/', '/docs'))
})

test('isCurrentPage ignores a query string or hash', () => {
  assert.ok(isCurrentPage('/docs.html', '/docs.html?section=simple'))
  assert.ok(isCurrentPage('/docs.html', '/docs#advanced'))
  assert.ok(isCurrentPage('/', '/?ref=x'))
})

test('isCurrentPage ignores a trailing slash', () => {
  assert.ok(isCurrentPage('/docs.html', '/docs/'))
  assert.ok(isCurrentPage('/', '/'))
})

test('isCurrentPage rejects non-strings rather than throwing', () => {
  for (const bad of [null, undefined, 42, {}, []]) {
    assert.equal(isCurrentPage(bad, '/docs'), false)
    assert.equal(isCurrentPage('/docs.html', bad), false)
  }
})

// The footer was six hand-written copies -- five pages plus one inside the Vue
// template -- and they had drifted: each listed a different subset. Both
// navigations come from PAGES now, so this pins that they stay generated.
test('every page mounts the shared footer rather than hand-rolling one', () => {
  for (const page of PAGE_FILES) {
    const html = fs.readFileSync(new URL(`../${page}`, import.meta.url), 'utf8')
    // index.html is a bare shell -- its mount point is in the Vue template,
    // checked below. Every other page carries its own.
    if (page !== 'index.html') {
      assert.match(html, /data-site-footer/, `${page} should mount the shared footer`)
    }
    assert.doesNotMatch(
      html,
      /class="footer-link/,
      `${page} hand-rolls footer links; they belong in src/site-footer.js`,
    )
  }
  const main = fs.readFileSync(new URL('../src/main.js', import.meta.url), 'utf8')
  assert.match(main, /data-site-footer/, 'the app template should mount the shared footer')
  assert.doesNotMatch(main, /class="footer-link/, 'the app template hand-rolls footer links')
})

test('the footer links to every page except the one being viewed', () => {
  for (const p of PAGES) {
    const shown = footerPages(p.href).map((x) => x.href)
    assert.ok(!shown.includes(p.href), `${p.href} should not link to itself in its own footer`)
    assert.equal(shown.length, PAGES.length - 1, `${p.href} footer should list every other page`)
  }
})

test('the footer calls the root "App" and the header calls it "Generator"', () => {
  // Two different words for one destination, deliberately: the header lists
  // sections, the footer lists destinations. Pinned so a rename does not
  // silently unify them.
  assert.equal(PAGES.find((p) => p.href === '/').label, 'Generator')
  assert.equal(footerPages('/docs.html').find((p) => p.href === '/').label, 'App')
})
