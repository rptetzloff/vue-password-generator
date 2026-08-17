import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { isCurrentPage, PAGES } from '../ui/site-nav.js'

import { PAGE_FILES } from './helpers/pages.js'

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
      `${page} hand-rolls footer links; they belong in ui/site-footer.js`,
    )
  }
  const main = fs.readFileSync(new URL('../src/main.js', import.meta.url), 'utf8')
  assert.match(main, /data-site-footer/, 'the app template should mount the shared footer')
  assert.doesNotMatch(main, /class="footer-link/, 'the app template hand-rolls footer links')
})

test('the floating bar is the only navigation, and it carries everything', () => {
  // The footer became the site navigation in v2.22.0: every page link plus
  // GitHub, Anagrimoire and the settings gear, with the current page marked
  // via aria-current rather than omitted -- a nav that hides where you are
  // would be strange in a way a footer that did was not. The header holds no
  // links at all; one navigation, one place to maintain it.
  const footerSrc = fs.readFileSync(new URL('../ui/site-footer.js', import.meta.url), 'utf8')
  assert.match(footerSrc, /for \(const page of PAGES\)/, 'the bar must render every page, current included')
  assert.match(footerSrc, /aria-current/, 'the current page must be marked, not omitted')
  assert.match(footerSrc, /GITHUB_URL/, 'the GitHub link belongs in the bar')
  assert.match(footerSrc, /ANAGRIMOIRE_URL/, 'the Anagrimoire link belongs in the bar')
  assert.match(footerSrc, /mountSettingsPanel/, 'the settings gear rides in the bar')

  const headerSrc = fs.readFileSync(new URL('../ui/site-header.js', import.meta.url), 'utf8')
  assert.doesNotMatch(headerSrc, /mountSiteNav|mountSettingsPanel/,
    'the header must not mount a second navigation or gear')

  // One name for the one destination list, now that there is one list.
  assert.equal(PAGES.find((p) => p.href === '/').label, 'Generator')
})
