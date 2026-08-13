import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { PAGE_FILES } from './helpers/pages.js'

// App mode (ROADMAP 8b). The service worker has no build step behind it, so
// its precache list is maintained by hand -- which is exactly the kind of
// list that rots. These tests walk the filesystem both ways: everything
// listed must exist, and everything servable must be listed.

const root = new URL('..', import.meta.url)
const read = (p) => fs.readFileSync(new URL(p, root), 'utf8')

const sw = read('sw.js')
const pkg = JSON.parse(read('package.json'))
const manifest = JSON.parse(read('manifest.webmanifest'))

const PRECACHE = [...sw.matchAll(/'(\/[^']*)'/g)].map((m) => m[1])
const PAGES = PAGE_FILES

test('the service worker version is the package version', () => {
  // The cache is named after VERSION; a release that forgets to bump it would
  // serve the old assets forever. Pinning it to package.json makes the bump
  // part of the release, not a separate thing to remember.
  const m = /const VERSION = '([^']+)'/.exec(sw)
  assert.ok(m, 'sw.js has no VERSION constant')
  assert.equal(m[1], pkg.version)
})

test('everything in the precache list exists on disk', () => {
  for (const entry of PRECACHE) {
    const rel = entry === '/' ? 'index.html' : entry.slice(1)
    assert.ok(fs.existsSync(new URL(rel, root)), `${entry} is precached but does not exist`)
  }
})

test('everything the site serves is in the precache list', () => {
  // Forward direction: a new page, script, stylesheet or data file that is
  // not precached would 404 offline -- quietly, and only for installed users.
  const listDir = (dir, exts) =>
    fs.readdirSync(new URL(dir, root))
      .filter((f) => exts.some((e) => f.endsWith(e)))
      .map((f) => `/${dir}/${f}`)
  const expected = [
    ...PAGES.map((p) => `/${p}`),
    '/ROADMAP.md',
    '/manifest.webmanifest',
    '/favicon.ico',
    ...listDir('src', ['.js', '.css']),
    ...listDir('src/assets', ['.svg', '.png']),
    ...listDir('data', ['.txt', '.json']),
    '/vendor/vue.esm-browser.prod.js',
    ...listDir('vendor/mdi/css', ['.css']),
    ...listDir('vendor/mdi/fonts', ['.woff2']),
  ]
  for (const entry of expected) {
    assert.ok(PRECACHE.includes(entry), `${entry} is servable but not precached — it would 404 offline`)
  }
})

test('every page installs the app: manifest link, theme color, worker', () => {
  for (const page of PAGES) {
    const html = read(page)
    assert.ok(html.includes('rel="manifest"'), `${page} does not link the manifest`)
    assert.ok(html.includes('name="theme-color"'), `${page} has no theme-color meta`)
    assert.ok(html.includes("serviceWorker.register('/sw.js')"), `${page} does not register the worker`)
    assert.ok(html.includes("location.hostname !== 'localhost'"),
      `${page} would register the worker in dev, where it fights the dev server`)
  }
})

test('the manifest is complete and its icons exist', () => {
  assert.equal(manifest.display, 'standalone')
  assert.equal(manifest.start_url, '/')
  assert.ok(manifest.icons.length >= 2)
  for (const icon of manifest.icons) {
    assert.ok(fs.existsSync(new URL(icon.src.slice(1), root)), `${icon.src} missing`)
  }
  // The static theme_color is the default palette's header band; the runtime
  // meta follows the chosen palette via theme.js syncThemeColor.
  assert.match(manifest.theme_color, /^#[0-9a-f]{6}$/i)
  const themeJs = read('src/theme.js')
  assert.ok(themeJs.includes('syncThemeColor'), 'theme.js no longer syncs the theme-color meta')
})
