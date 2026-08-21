// What the live deployments actually send, against what render.yaml says.
//
// render-config.test.js checks the FILE. Nothing checked the SERVICE, and the
// gap between them is where every render.yaml bug this project has had actually
// lived:
//
//   - a deleted /vendor/* rule that stayed live, because Blueprint header sync
//     is additive: removing a rule from the file does not remove it from the
//     service. It kept competing with the font rule for an afternoon after it
//     was gone from the repository.
//   - two rules matching one request, so the same file came back `immutable`
//     three times and `max-age=86400` twice, on the same deploy.
//   - `branch: main` imposed on the dev Blueprint, so dev.wordlock.net served
//     main for weeks while the file looked right.
//
// None of those are visible in the repository. All of them are visible in a
// response header.
//
// Deliberately NOT part of `npm test`: the suite is offline and stays offline,
// so it can run in CI, on a plane, and without production being up. This is a
// thing you run when you have changed render.yaml or moved a domain.
//
// No credentials. Everything checked here is in a public response, which is
// also why it works against any host without being trusted with an API token.
//
// Usage:
//   node tools/check-deploy.mjs                     # the known hosts
//   node tools/check-deploy.mjs https://app.wordlock.net
//
// CACHE-BUSTING IS NOT OPTIONAL. Cloudflare sits in front of Render, so a
// plain request can be answered by the edge and you end up measuring
// Cloudflare's copy of a header rather than the origin's current one. Every
// request here carries a unique query string for that reason -- the first
// reading of the /vendor/* overlap was wrong in exactly this way.

import fs from 'node:fs'

const ROOT = new URL('../', import.meta.url)
const YAML = fs.readFileSync(new URL('render.yaml', ROOT), 'utf8')

/** Lines outside comments, so a rule discussed in prose does not read as set. */
const CODE = YAML.split(/\r?\n/).filter((l) => !/^\s*#/.test(l)).join('\n')

const declaredHeaders = [...CODE.matchAll(
  /^ {6}- path:\s*(\S+)\s*\n\s+name:\s*(\S+)\s*\n\s+value:\s*(.+)$/gm,
)].map((m) => ({ path: m[1], name: m[2].toLowerCase(), value: m[3].trim().replace(/^"|"$/g, '') }))

/**
 * Which branch feeds which host, because the comparison is only meaningful
 * against the branch that deployed.
 *
 * render.yaml is read from the WORKING TREE. Checking wordlock.net from `dev`
 * compares main's live deployment against dev's not-yet-released file, and
 * every difference it reports is a change waiting in the release rather than
 * drift. The first run said exactly that about the CSP hashes and it read as
 * alarming until the branch was accounted for.
 */
const FED_BY = { 'https://wordlock.net': 'main', 'https://dev.wordlock.net': 'dev' }

const branch = (() => {
  try {
    const head = fs.readFileSync(new URL('.git/HEAD', ROOT), 'utf8').trim()
    return head.startsWith('ref:') ? head.split('/').pop() : head.slice(0, 7)
  } catch { return null }
})()

const hosts = process.argv.slice(2).filter((a) => a.startsWith('http'))
const TARGETS = hosts.length
  ? hosts
  : Object.keys(FED_BY).filter((h) => branch === null || FED_BY[h] === branch)

if (!TARGETS.length) {
  console.log(`no host is fed by "${branch}" — nothing to check from here.`)
  console.log('Pass a URL explicitly to check one anyway.')
  process.exit(0)
}

/**
 * A REAL file each rule's path matches, taken from the repository.
 *
 * The first version invented `/vendor/mdi/fonts/PROBE`, which 404s -- and
 * Render does not apply header rules to a 404, so every rule came back
 * "declared but not sent". Forty-odd findings, all of them the tool's fault.
 * A checker whose failure mode is a wall of false positives is worse than no
 * checker, because the real one in the middle of it goes unread.
 */
const sampleFor = (path) => {
  if (!path.endsWith('/*')) return path
  const dir = path.slice(1, -2)
  // `/*` has no directory to sample. Left unguarded it made an empty path,
  // which resolved against the filesystem ROOT rather than the repository and
  // produced `//DumpStack.log` -- a Windows file at C:\, checked against a
  // web server. Every URL a checker requests should be one it can explain.
  if (!dir) return '/index.html'
  try {
    const entries = fs.readdirSync(new URL(dir + '/', ROOT), { withFileTypes: true })
    const file = entries.find((e) => e.isFile())
    if (file) return `/${dir}/${file.name}`
  } catch { /* fall through */ }
  return '/index.html'
}

/**
 * Which declared rule wins for a given request path.
 *
 * The file keeps its paths non-overlapping on purpose -- Render does not
 * document precedence when two rules of the same name match, and measuring it
 * gave a different answer per request. So more than one match here is itself
 * the finding.
 */
const matching = (path, name) => declaredHeaders.filter((h) =>
  h.name === name && (h.path.endsWith('/*') ? path.startsWith(h.path.slice(0, -1)) : h.path === path))

const bust = (url) => url + (url.includes('?') ? '&' : '?') + 'cachebust=' + process.pid + Date.now()

const fetchHeaders = async (url) => {
  const res = await fetch(bust(url), { redirect: 'follow' })
  const out = new Map()
  for (const [k, v] of res.headers) out.set(k.toLowerCase(), v)
  return { status: res.status, headers: out, url: res.url }
}

const findings = []
const note = (host, msg) => findings.push(`  ${host}\n    ${msg}`)

for (const host of TARGETS) {
  let root
  try {
    root = await fetchHeaders(host + '/')
  } catch (e) {
    note(host, `unreachable: ${e.message}`)
    continue
  }
  if (root.status !== 200) note(host, `GET / returned ${root.status}`)

  // 1. Every declared header must actually arrive, with the declared value.
  const paths = [...new Set(declaredHeaders.map((h) => sampleFor(h.path)))]
  for (const path of paths) {
    let res
    try {
      res = await fetchHeaders(host + path)
    } catch (e) {
      note(host, `${path} unreachable: ${e.message}`)
      continue
    }
    // A probe path under /* may legitimately 404; the headers still apply.
    for (const name of new Set(declaredHeaders.map((h) => h.name))) {
      const rules = matching(path, name)
      if (rules.length > 1) {
        note(host, `${path}: ${rules.length} declared rules set ${name} — precedence is undefined`)
      }
      if (!rules.length) continue
      const actual = res.headers.get(name)
      if (actual === undefined) {
        note(host, `${path}: ${name} is declared but not sent`)
      } else if (actual.trim() !== rules[0].value.trim()) {
        note(host, `${path}: ${name} drifted\n      declared ${rules[0].value}\n      served   ${actual}`)
      }
    }
  }

  // 2. The orphan check, which is the one that cost an afternoon: a
  //    Cache-Control on a path the file no longer claims. Blueprint sync is
  //    additive, so this can only be found by asking the service.
  for (const probe of ['/', '/index.html', '/README.md', '/manifest.webmanifest']) {
    let res
    try { res = await fetchHeaders(host + probe) } catch { continue }
    const cc = res.headers.get('cache-control')
    if (cc && !matching(probe, 'cache-control').length && !/max-age=0/.test(cc)) {
      note(host, `${probe}: served Cache-Control "${cc}" which render.yaml does not declare — `
        + 'a rule deleted from the file stays live on the service')
    }
  }

  // 3. HTTPS is not optional, and neither is the redirect to it.
  try {
    const plain = await fetchHeaders(host.replace('https://', 'http://') + '/')
    if (!plain.url.startsWith('https://')) note(host, 'http:// did not end up on https://')
  } catch { /* refusing plain HTTP outright is also fine */ }
}

const label = TARGETS.join(', ')
if (findings.length) {
  console.error(`\ndeployment drift (${label}):\n\n${findings.join('\n\n')}\n`)
  process.exit(1)
}
console.log(`no drift: ${declaredHeaders.length} declared header rules match what ${label} serves`)
