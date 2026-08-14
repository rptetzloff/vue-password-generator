// App mode (ROADMAP 8b): the whole site, cache-first.
//
// A generator that never talks to a server has no reason to require a
// network -- offline is the claim made honest, not a feature bolted on.
// There is no build step and nothing external, so the entire site fits in a
// plain precache list; test/app-mode.test.js walks the filesystem and fails
// if anything servable is missing from it.
//
// The update path (the classic way PWAs strand users on an old build):
// VERSION is pinned to package.json by the tests, so every release renames
// the cache. The browser re-fetches sw.js on navigation, sees a new byte
// sequence, installs the new worker, and activate() below drops the old
// cache. Assets are cache-first *within* a version, never across versions.
const VERSION = '3.0.1'
const CACHE = 'pwgen-' + VERSION

const PRECACHE = [
  '/',
  '/index.html',
  '/docs.html',
  '/changelog.html',
  '/about.html',
  '/legal.html',
  '/roadmap.html',
  '/vault.html',
  '/ROADMAP.md',
  '/manifest.webmanifest',
  '/favicon.ico',
  '/src/main.js',
  '/src/logo.js',
  '/src/markdown.js',
  '/src/lib.js',
  '/src/entropy.js',
  '/src/generators.js',
  '/src/clipboard-clear.js',
  '/src/history-crypto.js',
  '/src/vault-crypto.js',
  '/src/recovery-key.js',
  '/src/passphrase-strength.js',
  '/src/common-passwords.js',
  '/src/totp.js',
  '/src/vault-store.js',
  '/src/vault-transfer.js',
  '/src/vault-session.js',
  '/src/vault-app.js',
  '/src/theme.js',
  '/src/palettes.js',
  '/src/site-header.js',
  '/src/site-nav.js',
  '/src/site-footer.js',
  '/src/settings-panel.js',
  '/src/style.css',
  '/src/vault.css',
  '/src/tokens.css',
  '/src/prose-page.css',
  '/src/settings-panel.css',
  '/src/site-footer.css',
  '/src/site-header.css',
  '/src/assets/password_generator_icon.svg',
  '/src/assets/logo.png',
  '/vendor/vue.esm-browser.prod.js',
  '/vendor/mdi/css/materialdesignicons.min.css',
  '/vendor/mdi/fonts/materialdesignicons-webfont.woff2',
  '/data/orchard-street-long.txt',
  '/data/words.json',
]

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(PRECACHE)).then(() => self.skipWaiting()),
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('pwgen-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  )
})

// Freshness, and why plain cache-first was wrong here.
//
// The original handler answered every request from the cache and never asked
// the network again, on the theory that a version bump renames the cache and
// forces the update. That holds only if every deploy bumps the version -- and
// four releases went out that did not. Anyone who had loaded the site was
// pinned to their build with no way back: not stale until next release, stale
// forever. Locally it shows up as edits that need a hard refresh, repeatedly.
//
// On a security product that is worse than an annoyance. A fix for a real bug
// would never reach the people already running the broken version, and they
// would have no way to know.
//
// So: HTML asks the network first and falls back to the cache, which makes a
// deploy visible on the next load and still works with no network at all.
// Everything else is stale-while-revalidate -- the cached copy answers
// immediately, the network copy replaces it in the background, and the page
// after this one is current. Offline is unaffected in both cases, because a
// failed fetch just uses what is already there.
const isNavigation = (request) =>
  request.mode === 'navigate' ||
  (request.headers.get('accept') || '').includes('text/html')

const putInCache = async (request, response) => {
  // Opaque and error responses are not worth keeping, and caching a 404 would
  // make it permanent.
  if (!response || !response.ok || response.type === 'opaque') return response
  const cache = await caches.open(CACHE)
  await cache.put(request, response.clone())
  return response
}

self.addEventListener('fetch', (event) => {
  const { request } = event
  if (request.method !== 'GET' || new URL(request.url).origin !== location.origin) return

  if (isNavigation(request)) {
    event.respondWith(
      fetch(request)
        .then((response) => putInCache(request, response))
        // ignoreSearch here only: /vault.html?foo is still the vault page.
        .catch(() => caches.match(request, { ignoreSearch: true })
          .then((hit) => hit || caches.match('/index.html'))),
    )
    return
  }

  event.respondWith(
    caches.match(request).then((hit) => {
      // Not awaited: the point is that the cached copy answers now and the
      // refresh lands for next time. A rejection is normal offline.
      const fresh = fetch(request)
        .then((response) => putInCache(request, response))
        .catch(() => null)
      if (hit) {
        event.waitUntil(fresh)
        return hit
      }
      return fresh.then((response) => response || Response.error())
    }),
  )
})
