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
    ...listDir('ui', ['.js', '.css']),
    ...listDir('src/assets', ['.svg', '.png']),
    ...listDir('data', ['.txt', '.json']),
    '/vendor/vue.runtime.esm-browser.prod.js',
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
  const themeJs = read('ui/theme.js')
  assert.ok(themeJs.includes('syncThemeColor'), 'theme.js no longer syncs the theme-color meta')
})

// Freshness. The worker shipped as pure cache-first: a hit was returned and
// the network was never consulted again, on the theory that a version bump
// renames the cache. Four releases went out without one, so anyone who had
// loaded the site was pinned to their build permanently -- and on a security
// product, that means a fix never reaching the people who need it.
test('the worker revalidates rather than trusting the cache forever', () => {
  const sw = fs.readFileSync(new URL('../sw.js', import.meta.url), 'utf8')
  const handler = sw.slice(sw.indexOf("addEventListener('fetch'"))
  assert.ok(handler, 'sw.js should have a fetch handler')

  // A hit must not be the end of the story: something has to reach the
  // network on the same request.
  assert.match(handler, /fetch\(request\)/, 'the network must be consulted')
  assert.ok(/caches\.open\(CACHE\)/.test(sw), 'a revalidated response must be written back')

  // And the old shape must not come back: `hit || fetch(...)` is exactly the
  // bug, since it only fetches when the cache misses.
  assert.ok(!/hit\s*\|\|\s*fetch\(/.test(handler),
    'cache-first with no revalidation strands users on the build they first loaded')
})

test('a page load prefers the network, so a deploy is visible next load', () => {
  const sw = fs.readFileSync(new URL('../sw.js', import.meta.url), 'utf8')
  assert.match(sw, /isNavigation/, 'navigations need their own path')
  // Offline still has to work: the fallback is the cache, not a failure.
  const nav = sw.slice(sw.indexOf('if (isNavigation(request))'))
  assert.match(nav.slice(0, 400), /\.catch\(\(\) => caches\.match/,
    'a failed navigation fetch must fall back to the cache')
})

test('only navigations ignore the query string', () => {
  // ignoreSearch on every request defeats ?v= cache-busting, which is the one
  // tool left for forcing a single asset to refresh.
  const sw = fs.readFileSync(new URL('../sw.js', import.meta.url), 'utf8')
  const uses = (sw.match(/\{\s*ignoreSearch:\s*true\s*\}/g) || []).length
  assert.equal(uses, 1, 'ignoreSearch belongs on the navigation fallback only')
})

test('only generators.js fetches the word data', () => {
  // The loaders in generators.js memoize; component-local copies did not, and
  // four of them lived in main.js after the extraction that was supposed to
  // remove them. Each word-based generator refetched words.json on every
  // mount, so cycling the tabs twice cost nine requests and 264 KB instead of
  // two and 73 KB. Invisible in review and invisible in the tests -- it took
  // looking at a network tab.
  //
  // Fetching a wordlist from anywhere else is the regression, so that is what
  // this forbids. The lists stay lazy on purpose: Simple, Advanced and Numbers
  // need neither file, and bundling them would push 60 KB compressed onto
  // every visitor to save nothing.
  // The one allowed fetcher moved from src/generators.js to src/generator-io.js
  // when core/ was carved out: the generation is arithmetic and went to
  // core/generate/, the two loaders touch the network and stayed. The rule is
  // unchanged -- exactly one memoizing place fetches -- but core/ is walked too
  // now, since a loader added there would be just as invisible.
  const root = new URL('../', import.meta.url)
  const ALLOWED = 'src/generator-io.js'
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
  assert.ok(files.includes(ALLOWED), `${ALLOWED} is the allowed fetcher and is missing`)

  for (const f of files) {
    if (f === ALLOWED) continue
    const text = fs.readFileSync(new URL(f, root), 'utf8')
    const hits = [...text.matchAll(/fetch\(\s*['"`][^'"`]*\/?data\//g)]
    assert.equal(hits.length, 0,
      `${f} fetches the word data directly; import loadWordList/loadWordData ` +
      `from ${ALLOWED} instead, which caches`)
  }
})
