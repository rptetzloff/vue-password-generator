import test from 'node:test'
import assert from 'node:assert/strict'
import { isCurrentPage, PAGES } from '../src/site-nav.js'

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
