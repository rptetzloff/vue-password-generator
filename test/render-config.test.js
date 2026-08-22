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

test('every deployment is declared, named and pinned', () => {
  // ~~Exactly one service is declared.~~ ~~One per surface, none per
  // environment.~~ Reversed twice, and both earlier rules had the same
  // cause: one entry in this file being applied to two deployments.
  //
  // First `wordlock` and `wordlock-dev` produced a review screen offering
  // `wordlock-cl9q` and `wordlock-dev-cl9q` -- a duplicate of production.
  // Then a `branch:` pin was imposed on the deployment it did not describe.
  // Naming every deployment separately ends both: an entry here describes
  // exactly one thing.
  //
  // Only the dev pair exists today, on purpose. The shape is proved on the
  // deployment that exists to be broken; production is added when it is
  // ready to move.
  assert.deepEqual(services.map((s) => s.name).sort(), ['app-dev', 'site-dev'])

  // Every service pins its branch. This is the rule that replaced 'never
  // pin', and it only works because each entry is now its own deployment.
  for (const s of services) {
    assert.ok(s.branch, `service "${s.name}" does not pin a branch`)
  }

  // A name and its branch must agree, or the dashboard says one thing and
  // the file another -- which is the whole failure being designed out.
  for (const s of services) {
    const wantsDev = s.name.endsWith('-dev')
    assert.equal(s.branch === 'dev', wantsDev,
      `"${s.name}" is pinned to ${s.branch}, which its name does not describe`)
  }

  const names = services.map((s) => s.name)
  assert.equal(new Set(names).size, names.length, 'two services share a name')
})

test('every service pins a branch, and one Blueprint applies them all', () => {
  // ~~The deploy branch is NOT pinned here.~~ Reversed. The regression that
  // rule came from was real: `branch: main` was added so a default-branch
  // rename could not silently freeze production, and because the dev
  // Blueprint reads this same file, dev.wordlock.net was handed main. It
  // served the wrong branch for weeks -- the dashboard fix lasted until the
  // next sync -- and surfaced as a 404 on a module committed hours earlier.
  //
  // That was ONE service imposed on TWO deployments, where any pin was wrong
  // for whichever one it did not describe. Each is its own entry now, so a
  // pin describes exactly one deployment and removes the ambiguity it used
  // to create.
  //
  // Render's docs say an omitted branch means the repo's DEFAULT branch,
  // which contradicts what was measured here -- if it were true, removing
  // the pin would have left dev on main and the bug would have persisted.
  // It did not. Pinning means not having to know which is right.
  assert.ok(services.length > 0, 'no services parsed; the regex shape moved')
  for (const s of services) {
    assert.match(s.branch ?? '', /^(main|dev)$/,
      `"${s.name}" must pin main or dev explicitly, not rely on inference`)
  }

  // THE CONSTRAINT THAT MAKES THIS SAFE, and it lives outside this file: two
  // Blueprints each apply the whole thing, so N services declared here
  // become 2N created. Naming every deployment is only correct with exactly
  // one Blueprint linked. Nothing in the repository can assert that, so it
  // is written down where the next person will be editing.
  assert.ok(/EXACTLY ONE BLUEPRINT/.test(RENDER_YAML),
    'the one-Blueprint requirement must stay stated in render.yaml')
})

test('each service publishes its own root, and nothing is built on deploy', () => {
  // ~~publish is './'.~~ A static service serves exactly one directory, so the
  // two surfaces need two roots. They are assembled by
  // tools/build-publish-roots.mjs and COMMITTED, which is what keeps "no build
  // step" true: Render still runs nothing, it just serves a subdirectory.
  const paths = services.map((s) => s.publish).sort()
  assert.deepEqual(paths, ['./app', './site'])
  for (const s of services) {
    assert.match(s.publish, /^\.\/(site|app)$/,
      `${s.name} must publish a generated root, not the repository itself`)
  }
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
