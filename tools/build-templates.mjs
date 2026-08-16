// Compile the templates in src/templates/ to render functions (ROADMAP 9f).
//
// WHY THIS EXISTS AND WHY IT IS THE ONLY BUILD STEP
//
// Components used to declare templates as `template:` strings, which Vue
// compiles in the browser through `new Function` -- so the CSP had to allow
// 'unsafe-eval', measured as required rather than assumed: without it every
// page rendered blank. That one allowance was also the reason a Manifest V3
// extension was impossible and the reason the sealing work in 9f had nowhere
// to go. Three blockers, one cause.
//
// Compiling ahead of time removes it. The cost is a build, and the shape of
// this one is chosen so the project's claim survives it:
//
//   - The OUTPUT IS COMMITTED. Render still serves the repository as-is, so
//     the deployed site is still the files in this repo. There is no build at
//     deploy time and nothing to trust in a pipeline.
//   - The INPUT IS COMMITTED TOO, as ordinary .html files. The generated code
//     is legible but nobody would choose to read `_hoisted_47`; the template
//     beside it is the artifact a person actually reads.
//   - DRIFT IS A TEST, not a habit. test/templates.test.js recompiles every
//     template and fails if the committed output differs, the same way the CSP
//     hashes are treated as derived data rather than maintained by hand.
//
// Measured before committing to it, because the first estimate was wrong in a
// way that would have oversold it. Precompiling ADDS 198 KB of generated code
// raw and removes 58 KB of compiler; over the wire, where it matters, brotli
// makes that +9.7 KB against -17.1 KB, so about 7 KB saved. Effectively a
// wash. The reasons are the CSP, the extension path, and not compiling
// templates on every page load -- not the byte count.
//
// Usage:  node tools/build-templates.mjs [--check]
//   --check  compile and compare without writing; exits 1 on drift.

import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'

/**
 * The PRODUCTION compiler, by explicit path.
 *
 * `import { compile } from '@vue/compiler-dom'` resolves to the dev build
 * unless NODE_ENV=production, and the dev build annotates v-if placeholders:
 * it emits `createCommentVNode("v-if", true)` where the browser's own runtime
 * compiler emits `createCommentVNode("", true)`. Shipping the dev build's
 * output would have put `<!--v-if-->` markers into the live HTML -- harmless,
 * but a difference from what the site renders today, in the direction of
 * leaking debug annotations into production.
 *
 * Caught by comparing the rendered DOM against the template version before and
 * after, which is the only reason it was noticed at all: both versions render
 * correctly and look identical on screen.
 *
 * Set here rather than left to the caller, because an environment variable is
 * a thing someone runs the build without -- and the failure is silent, since
 * both builds produce output that renders correctly and looks identical.
 *
 * It has to be NODE_ENV and not the .prod.js path: requiring
 * compiler-dom.cjs.prod.js directly STILL emits the annotation, because the
 * flag is a runtime `process.env.NODE_ENV` check inside the bundle rather than
 * something baked into the file. Measured both ways; the filename is not the
 * switch it looks like.
 *
 * The require is deliberately after the assignment. A static `import` is
 * hoisted and would run before it.
 */
process.env.NODE_ENV = 'production'
const require = createRequire(import.meta.url)
const { compile } = require('@vue/compiler-dom')

const ROOT = new URL('../', import.meta.url)

/**
 * One bundle per entry point, NOT one file for everything.
 *
 * index.html loads main.js and vault.html loads vault-app.js; a single
 * generated module would make the generator page download the vault's
 * templates and the vault page download the generator's. The vault's are
 * 162 KB on their own.
 */
export const BUNDLES = [
  { dir: 'src/templates/main', out: 'src/main.render.js', page: 'index.html' },
  { dir: 'src/templates/vault', out: 'src/vault.render.js', page: 'vault.html' },
]

/**
 * Where the runtime lives, relative to the generated file in src/.
 *
 * STILL THE FULL BUILD, deliberately, until every template is converted.
 * A page that loads two Vue builds gets two module instances and therefore two
 * reactivity systems -- a component rendered by one would not react to refs
 * created by the other, and the failure looks like "some things just stop
 * updating" rather than an error. So while some components still declare
 * `template:` and need the compiler, everything points at the same full build.
 *
 * The flip to vue.runtime.esm-browser.prod.js happens once, in the commit that
 * removes the last template string -- together with dropping 'unsafe-eval'
 * from the CSP, because those two are the same fact about the page.
 */
const VUE_IMPORT = '../vendor/vue.esm-browser.prod.js'

const COMPILE_OPTIONS = {
  mode: 'module',
  prefixIdentifiers: true,
  hoistStatic: true,
  // Deliberately no scopeId and no whitespace: 'condense' override -- the
  // defaults are what the runtime compiler used, and changing them here would
  // make the precompiled output behave differently from what shipped before.
}

const header = (dir) => [
  '// GENERATED by tools/build-templates.mjs -- do not edit.',
  '//',
  '// Source templates: ' + dir + '/*.html',
  '// Regenerate:       node tools/build-templates.mjs',
  '// Verified by:      test/templates.test.js, which fails if this drifts.',
  '//',
  '// Committed on purpose: Render serves this repository as-is, so a build',
  '// that is not committed would mean the deployed site is not the repo.',
  '',
].join('\n')

/**
 * Compile one template file to a render function declaration.
 *
 * The compiler emits `import { ... } from "vue"`, a bare specifier no browser
 * can resolve without an import map. Rewriting it to the vendored path keeps
 * the page working with plain native modules and no map to get wrong.
 */
export const exportName = (name) => 'render' + name

export const renderFor = (name, template) => {
  const out = compile(template, COMPILE_OPTIONS)
  if (out.errors && out.errors.length) {
    const first = out.errors[0]
    throw new Error(`${name}: ${first.message}`)
  }
  return out.code
    .replace(/from "vue"/g, `from '${VUE_IMPORT}'`)
    // `render` + the component name, NOT the component name alone. The
    // component and its render function live in the same module scope, so
    // `import { EntropyPanel }` beside `const EntropyPanel = {...}` is a
    // duplicate declaration -- a SyntaxError that takes the whole page down.
    // Measured, because it is the obvious naming and it is wrong.
    .replace(/export function render\(/, `export function ${exportName(name)}(`)
    .trimEnd()
}

const templatesIn = (dir) => {
  const abs = new URL(dir + '/', ROOT)
  if (!fs.existsSync(abs)) return []
  return fs.readdirSync(abs)
    .filter((f) => f.endsWith('.html'))
    .sort()
    .map((f) => ({
      name: path.basename(f, '.html'),
      file: dir + '/' + f,
      template: fs.readFileSync(new URL(f, abs), 'utf8'),
    }))
}

/**
 * The generated text for one bundle.
 *
 * Each template becomes its own module-scoped block, so the hoisted constants
 * of one cannot collide with another's. The compiler numbers them from _1 per
 * compile, so concatenating raw output would produce duplicate declarations --
 * found the moment two templates were built into one file.
 */
export const buildBundle = (bundle) => {
  const files = templatesIn(bundle.dir)
  if (!files.length) return null

  const helpers = new Set()
  const bodies = []

  for (const { name, template } of files) {
    let code = renderFor(name, template)

    // Every compiled template emits its OWN import line, and several import
    // the same helper under the same alias -- twelve templates gave twelve
    // `_toDisplayString` declarations and a SyntaxError that took the page
    // down. Collect the aliases and emit one import for the bundle.
    code = code.replace(/^import \{([^}]*)\} from '[^']*'\n?/m, (_, names) => {
      for (const pair of names.split(',')) {
        const t = pair.trim()
        if (t) helpers.add(t)
      }
      return ''
    })

    // Same problem one level down: the hoisted constants restart at _1 for
    // every compile, so `_hoisted_1` is declared once per template. Prefix
    // them per component. Matches any compiler-generated top-level const, not
    // just _hoisted_, so a future one cannot reintroduce this quietly.
    const locals = [...code.matchAll(/^const (_[A-Za-z0-9_$]+) =/gm)].map((m) => m[1])
    for (const local of new Set(locals)) {
      code = code.replace(
        new RegExp('\\b' + local + '\\b', 'g'),
        '_' + name + local,
      )
    }

    bodies.push(`// --- ${name} ${'-'.repeat(Math.max(0, 64 - name.length))}`)
    bodies.push(code.trim())
    bodies.push('')
  }

  const importLine = `import { ${[...helpers].sort().join(', ')} } from '${VUE_IMPORT}'`
  return [header(bundle.dir), importLine, '', ...bodies].join('\n') + '\n'
}

const normalise = (s) => s.replace(/\r\n/g, '\n')

const main = () => {
  const check = process.argv.includes('--check')
  let drift = 0
  let built = 0

  for (const bundle of BUNDLES) {
    const text = buildBundle(bundle)
    if (text === null) {
      console.log(`  ${bundle.dir}: no templates yet, skipping`)
      continue
    }
    const target = new URL(bundle.out, ROOT)
    const existing = fs.existsSync(target) ? fs.readFileSync(target, 'utf8') : null
    const same = existing !== null && normalise(existing) === normalise(text)
    built += 1

    if (check) {
      if (!same) {
        drift += 1
        console.error(`  DRIFT  ${bundle.out} does not match its templates`)
      } else {
        console.log(`  ok     ${bundle.out}`)
      }
      continue
    }

    if (same) {
      console.log(`  unchanged  ${bundle.out}`)
    } else {
      fs.writeFileSync(target, text)
      const n = templatesIn(bundle.dir).length
      console.log(`  wrote      ${bundle.out}  (${n} templates, ${(Buffer.byteLength(text) / 1024).toFixed(1)} KB)`)
    }
  }

  if (!built) {
    console.log('  nothing to do')
  }
  if (drift) {
    console.error('\n  Run: node tools/build-templates.mjs')
    process.exit(1)
  }
}

// Only run when invoked directly, so the test can import the helpers.
if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('build-templates.mjs')) {
  main()
}
