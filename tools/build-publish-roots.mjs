// Assemble the two publish roots (ROADMAP 11b).
//
// A Render static service publishes exactly ONE directory and serves nothing
// outside it. The site needs the icon font, the app needs Vue and the word
// lists, and both need ui/ -- so shared assets have to physically exist inside
// both roots. The CSP forces this rather than merely permitting it: font-src
// and style-src are 'self', so a shared third origin is not available even in
// principle.
//
// ~~Move the pages into site/ and app/.~~ The roadmap sketched that. This does
// something simpler: the source tree stays exactly as it is, flat and
// readable, and both roots are GENERATED from it and committed. Same bargain
// as src/main.render.js -- input and output both in the repository, and a test
// that rebuilds and fails on drift. It moves no files, needs no path
// rewriting, and leaves one obvious place to edit anything.
//
// The duplication is close to free in git: content-addressed objects mean an
// identical copy is a second tree entry pointing at the same blob, not a
// second blob. Verified before choosing this shape -- the 396 KB icon font
// hashes to 8c69b85f in both places.
//
// Nothing here rewrites a URL. Every page already references '/ui/tokens.css'
// and friends absolutely, so mirroring the tree inside each root makes those
// resolve correctly with no edits at all.
//
//   node tools/build-publish-roots.mjs           write them
//   node tools/build-publish-roots.mjs --check   fail if committed output drifted

import fs from 'node:fs'
import path from 'node:path'

const ROOT = new URL('../', import.meta.url)
const abs = (p) => new URL(p, ROOT)

/**
 * What belongs in each root.
 *
 * `pages` may rename: the marketing home page is authored as home.html because
 * index.html is the generator, and it becomes index.html only inside site/.
 */
export const ROOTS = {
  site: {
    host: 'wordlock.net',
    pages: [['home.html', 'index.html'], ['about.html'], ['changelog.html'],
      ['docs.html'], ['legal.html'], ['roadmap.html']],
    trees: ['ui', 'vendor/mdi', 'src/assets'],
    // roadmap.html fetches ROADMAP.md and renders it with markdown.js.
    //
    // The last two are legal.html's attribution links: the vendored Vue
    // licence, and the CC BY-SA wordlist itself. Both are cited, so both have
    // to resolve from this host rather than the other one -- a licence
    // attribution that depends on a second deployment being up is not much of
    // an attribution. The self-containment test found them.
    files: ['favicon.ico', 'manifest.webmanifest', 'ROADMAP.md', 'src/markdown.js',
      'vendor/vue.LICENSE', 'data/orchard-street-long.txt'],
  },
  app: {
    host: 'app.wordlock.net',
    pages: [['index.html'], ['vault.html']],
    trees: ['ui', 'core', 'vendor', 'data', 'src/assets'],
    files: ['favicon.ico', 'manifest.webmanifest'],
    // src/*.js and *.css, but NOT src/templates/ -- those are build input and
    // have never been served.
    flat: [{ dir: 'src', exts: ['.js', '.css'] }],
  },
}

const walk = (rel, out = []) => {
  for (const e of fs.readdirSync(abs(rel + '/'), { withFileTypes: true })) {
    const child = `${rel}/${e.name}`
    if (e.isDirectory()) walk(child, out)
    else out.push(child)
  }
  return out
}

/**
 * The precache list for one root, derived from what the root actually holds.
 *
 * The hand-maintained list in sw.js needed a test walking the filesystem both
 * ways to stay honest. Generating it per root removes the hand-maintenance and
 * the whole class of "servable but not precached".
 */
const precacheFor = (files) => {
  const paths = ['/', ...[...files.keys()].map((p) => '/' + p).sort()]
  return [...new Set(paths)]
}

/** The contents of one root, as relative path -> Buffer. Nothing is written. */
export const buildRoot = (name) => {
  const spec = ROOTS[name]
  if (!spec) throw new Error(`unknown publish root: ${name}`)
  const files = new Map()
  const take = (from, to = from) => files.set(to, fs.readFileSync(abs(from)))

  for (const [from, to] of spec.pages) take(from, to ?? from)
  for (const tree of spec.trees) for (const f of walk(tree)) take(f)
  for (const f of spec.files ?? []) take(f)
  for (const { dir, exts } of spec.flat ?? []) {
    for (const e of fs.readdirSync(abs(dir + '/'), { withFileTypes: true })) {
      if (e.isFile() && exts.some((x) => e.name.endsWith(x))) take(`${dir}/${e.name}`)
    }
  }

  // sw.js last, so its precache list describes the finished root. The logic and
  // comments are the shared file's; only the list is replaced.
  const sw = fs.readFileSync(abs('sw.js'), 'utf8')
  const list = precacheFor(files).map((p) => `  '${p}',`).join('\n')
  const rebuilt = sw.replace(/const PRECACHE = \[[\s\S]*?\n\]/,
    `const PRECACHE = [\n${list}\n]`)
  if (rebuilt === sw) throw new Error('sw.js: PRECACHE block not found')
  files.set('sw.js', Buffer.from(rebuilt, 'utf8'))

  return files
}

const writeRoot = (name, files) => {
  fs.rmSync(abs(name + '/'), { recursive: true, force: true })
  for (const [rel, buf] of files) {
    const target = abs(`${name}/${rel}`)
    fs.mkdirSync(path.dirname(target.pathname.replace(/^\/([A-Za-z]:)/, '$1')), { recursive: true })
    fs.writeFileSync(target, buf)
  }
}

const check = process.argv.includes('--check')
let drift = 0

for (const name of Object.keys(ROOTS)) {
  const want = buildRoot(name)
  if (check) {
    const have = new Map()
    try {
      for (const f of walk(name)) have.set(f.slice(name.length + 1), fs.readFileSync(abs(f)))
    } catch { /* missing entirely */ }
    const missing = [...want.keys()].filter((k) => !have.has(k))
    const extra = [...have.keys()].filter((k) => !want.has(k))
    const changed = [...want.keys()].filter((k) => have.has(k) && !have.get(k).equals(want.get(k)))
    if (missing.length || extra.length || changed.length) {
      drift++
      console.error(`  DRIFT  ${name}/  missing ${missing.length}, extra ${extra.length}, changed ${changed.length}`)
      for (const k of [...missing.slice(0, 3)]) console.error(`           missing ${k}`)
      for (const k of [...extra.slice(0, 3)]) console.error(`           extra   ${k}`)
      for (const k of [...changed.slice(0, 3)]) console.error(`           changed ${k}`)
    } else {
      console.log(`  ok     ${name}/  ${want.size} files`)
    }
    continue
  }
  writeRoot(name, want)
  const bytes = [...want.values()].reduce((n, b) => n + b.length, 0)
  console.log(`  wrote  ${name}/  ${want.size} files, ${(bytes / 1024).toFixed(0)} KB`)
}

if (check && drift) {
  console.error('\n  Run: node tools/build-publish-roots.mjs')
  process.exit(1)
}
