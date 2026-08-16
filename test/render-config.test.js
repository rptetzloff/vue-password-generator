import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

// render.yaml declares two services, and the reason to test it is that nothing
// else can.
//
// A Blueprint is applied by a hosted service against a file nobody runs
// locally, so a mistake here is invisible until it is in production -- and the
// history of this file is that its mistakes have all been invisible: a
// /vendor/* rule overlapping the font rule and turning a cache header into a
// coin flip, a deleted rule that stayed live because sync is additive, and a
// dev service that sat on the wrong branch for a fortnight because its branch
// was a dashboard fact rather than a reviewable one.
//
// Parsed with regexes rather than a YAML library on purpose: this project has
// no runtime dependencies and adding one to read four fields would be a poor
// trade. The parsing is deliberately strict, so a shape it does not understand
// fails loudly instead of quietly matching nothing.

const RENDER_YAML = fs.readFileSync(new URL('../render.yaml', import.meta.url), 'utf8')

/** Split the file into one blob per `- type: web` entry. */
const services = (() => {
  const parts = RENDER_YAML.split(/^ {2}- type:\s*web\s*$/m).slice(1)
  return parts.map((body) => {
    const field = (name) => {
      const m = new RegExp(`^ {4}${name}:\\s*(.+)$`, 'm').exec(body)
      return m ? m[1].trim() : null
    }
    const headers = [...body.matchAll(
      /^ {6}- path:\s*(\S+)\s*\n\s+name:\s*(\S+)\s*\n\s+value:\s*(.+)$/gm,
    )].map((m) => ({ path: m[1], name: m[2], value: m[3].trim().replace(/^"|"$/g, '') }))
    return { name: field('name'), branch: field('branch'), publish: field('staticPublishPath'), headers }
  })
})()

test('the file describes both deployments, not just production', () => {
  // The gap that caused the problem: dev existed only in the dashboard, so
  // "which branch does dev follow" was not a question the repo could answer.
  assert.equal(services.length, 2, 'expected a production and a dev service')
  const byName = Object.fromEntries(services.map((s) => [s.name, s]))

  assert.ok(byName.wordlock, 'the production service must be declared')
  assert.equal(byName.wordlock.branch, 'main')

  assert.ok(byName['wordlock-cl9q'], 'the dev service must be declared')
  assert.equal(byName['wordlock-cl9q'].branch, 'dev',
    'dev.wordlock.net follows dev -- this being in the file is the whole point')
})

test('every service is served as-is, with no build step', () => {
  // The product claim: the deployed source is the source you can read.
  for (const s of services) {
    assert.equal(s.publish, './', `${s.name} should publish the repo root`)
  }
})

test('the two services carry identical headers', () => {
  // The cost of declaring them separately, and the guard against paying it.
  // The reasoning for each rule lives once, on production; duplicating a
  // hundred lines of comment would guarantee the copies disagree. This is what
  // makes the duplication safe, and it fails the moment one is edited alone.
  const [prod, dev] = services
  const shape = (s) => s.headers
    .map((h) => `${h.path}\t${h.name}\t${h.value}`)
    .sort()

  assert.deepEqual(shape(dev), shape(prod),
    'a header added to one service must be added to the other')
})

test('no request matches two header rules of the same name', () => {
  // Measured, not theorised: /vendor/* also matched /vendor/mdi/fonts/..., so
  // the font had two Cache-Control rules and came back immutable three times
  // out of five and max-age=86400 twice -- same file, same deploy, a different
  // answer per request. Reordering changed nothing. There is no precedence to
  // rely on, so the paths must not overlap.
  const matches = (pattern, path) => (pattern.endsWith('/*')
    ? path.startsWith(pattern.slice(0, -1))
    : pattern === '/*' ? true : pattern === path)

  for (const s of services) {
    const byHeader = {}
    for (const h of s.headers) (byHeader[h.name] ??= []).push(h.path)
    for (const [name, paths] of Object.entries(byHeader)) {
      for (const a of paths) {
        for (const b of paths) {
          if (a === b) continue
          assert.ok(!matches(a, b.replace('/*', '/x')),
            `${s.name}: "${a}" and "${b}" both claim ${name} for the same request`)
        }
      }
    }
  }
})

test('the security headers are on every service, not just production', () => {
  // A dev site with a weaker policy cannot tell you whether the policy works,
  // and dev.wordlock.net is a real password manager on a public domain.
  const required = [
    'X-Frame-Options', 'X-Content-Type-Options', 'Referrer-Policy',
    'Permissions-Policy', 'Strict-Transport-Security', 'Content-Security-Policy',
  ]
  for (const s of services) {
    const names = new Set(s.headers.filter((h) => h.path === '/*').map((h) => h.name))
    for (const r of required) {
      assert.ok(names.has(r), `${s.name} is missing ${r}`)
    }
  }
})

test('HSTS is long, covers subdomains, and does not claim preload', () => {
  // preload is close to irreversible on browser timescales and would commit
  // every future subdomain of wordlock.net to HTTPS forever. Worth doing one
  // day, and worth doing deliberately rather than as a line in a security
  // pass -- so if it appears here, it should be because someone decided to.
  for (const s of services) {
    const hsts = s.headers.find((h) => h.name === 'Strict-Transport-Security')
    const maxAge = Number(/max-age=(\d+)/.exec(hsts.value)[1])
    assert.ok(maxAge >= 31536000, `${s.name}: HSTS max-age should be a year or more`)
    assert.match(hsts.value, /includeSubDomains/)
    assert.ok(!/preload/.test(hsts.value),
      `${s.name}: preload is a separate, near-irreversible decision`)
  }
})
