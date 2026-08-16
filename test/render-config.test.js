import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

// render.yaml, and the reason to test a file nobody runs locally.
//
// It is applied by a hosted service against a repo, so every mistake it has
// ever produced was invisible in review and only observable in production: a
// /vendor/* rule overlapping the font rule and turning a cache header into a
// coin flip; a deleted rule that stayed live because sync is additive; and a
// branch pin that silently held dev.wordlock.net on main for weeks.
//
// THE FACT THAT EXPLAINS THE LAST ONE, and the reason this file exists:
// ONE service definition here is applied by TWO Blueprints -- one linked to
// main which serves wordlock.net, one linked to dev which serves
// dev.wordlock.net. Each applies the whole file, and each appends its own
// suffix to what it creates. So anything branch-specific written here is
// imposed on both deployments, and any second service declared here is
// created twice.
//
// Parsed with regexes rather than a YAML library: this project has no runtime
// dependencies and adding one to read four fields would be a poor trade.

const RENDER_YAML = fs.readFileSync(new URL('../render.yaml', import.meta.url), 'utf8')

/** Lines outside comments, so a rule discussed in prose does not read as set. */
const CODE = RENDER_YAML.split(/\r?\n/).filter((l) => !/^\s*#/.test(l)).join('\n')

const services = (() => {
  const parts = CODE.split(/^ {2}- type:\s*web\s*$/m).slice(1)
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

test('exactly one service is declared', () => {
  // Two Blueprints each apply this whole file, so a second service here is
  // created twice -- including a second copy of production. Measured: adding
  // the dev service produced a review screen offering to create BOTH
  // `wordlock-cl9q` and `wordlock-dev-cl9q`, from a file naming one of each.
  assert.equal(services.length, 1,
    'a second service here is created once per Blueprint, not once')
  assert.equal(services[0].name, 'wordlock')
})

test('the deploy branch is NOT pinned here', () => {
  // The regression this test exists for, and it was self-inflicted. `branch:
  // main` was added so that renaming the default branch could not silently
  // freeze production. But the dev Blueprint reads this same file and applies
  // it too, so dev.wordlock.net was handed main -- it served the wrong branch
  // for weeks, switching it in the dashboard worked only until the next sync,
  // and it surfaced as a 404 on a module committed hours earlier.
  //
  // With no branch declared, each Blueprint deploys the branch it is linked
  // to. The protection originally wanted is real and cannot be bought here.
  assert.equal(services[0].branch, null,
    'pinning a branch here imposes it on every Blueprint that reads this file')
  assert.ok(!/^\s*branch:/m.test(CODE),
    'no service in this file may declare a branch')
})

test('the site is served as-is, with no build step', () => {
  assert.equal(services[0].publish, './')
})

test('no request matches two header rules of the same name', () => {
  // Measured, not theorised: /vendor/* also matched /vendor/mdi/fonts/..., so
  // the font had two Cache-Control rules and came back immutable three times
  // out of five and max-age=86400 twice -- same file, same deploy, a different
  // answer per request. Reordering changed nothing. There is no precedence to
  // rely on, so the paths must not overlap.
  const matches = (pattern, path) => (pattern.endsWith('/*')
    ? path.startsWith(pattern.slice(0, -1))
    : pattern === path)

  for (const s of services) {
    const byHeader = {}
    for (const h of s.headers) (byHeader[h.name] ??= []).push(h.path)
    for (const [name, paths] of Object.entries(byHeader)) {
      for (const a of paths) {
        for (const b of paths) {
          if (a === b) continue
          assert.ok(!matches(a, b.replace('/*', '/x')),
            `"${a}" and "${b}" both claim ${name} for the same request`)
        }
      }
    }
  }
})

test('every security header is set, and therefore set on both deployments', () => {
  // The upside of one shared definition: dev cannot drift to a weaker policy,
  // because there is only one policy. A dev site with a weaker CSP cannot tell
  // you whether the CSP works, and dev.wordlock.net is a real password manager
  // on a public domain.
  const required = [
    'X-Frame-Options', 'X-Content-Type-Options', 'Referrer-Policy',
    'Permissions-Policy', 'Strict-Transport-Security', 'Content-Security-Policy',
  ]
  const names = new Set(services[0].headers.filter((h) => h.path === '/*').map((h) => h.name))
  for (const r of required) assert.ok(names.has(r), `missing ${r}`)
})

test('HSTS is long, covers subdomains, and does not claim preload', () => {
  // preload is close to irreversible on browser timescales and would commit
  // every future subdomain of wordlock.net to HTTPS forever. Worth doing one
  // day, deliberately -- so if it appears here it should be because someone
  // decided to, not because a security pass added it in passing.
  const hsts = services[0].headers.find((h) => h.name === 'Strict-Transport-Security')
  assert.ok(Number(/max-age=(\d+)/.exec(hsts.value)[1]) >= 31536000)
  assert.match(hsts.value, /includeSubDomains/)
  assert.ok(!/preload/.test(hsts.value), 'preload is a separate, near-irreversible decision')
})
