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
const VERSION = '2.24.0'
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
  '/src/history-crypto.js',
  '/src/vault-crypto.js',
  '/src/vault-store.js',
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

self.addEventListener('fetch', (event) => {
  const { request } = event
  if (request.method !== 'GET' || new URL(request.url).origin !== location.origin) return
  event.respondWith(
    caches.match(request, { ignoreSearch: true }).then((hit) => hit || fetch(request)),
  )
})
