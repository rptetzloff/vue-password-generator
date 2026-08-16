// One-shot helper: lift `template:` strings out of a component file into
// src/templates/<bundle>/<Name>.html, and report what it found.
//
// Deliberately does NOT edit the source file. Moving 2,600 lines of markup by
// script and rewriting the JS around it in the same pass is how a subtle
// mangling ships; the extraction is mechanical and checkable, the rewiring is
// done deliberately per component.
//
// Usage: node tools/extract-templates.mjs <src file> <bundle dir> [Name ...]
//        with no names, lists what is available.

import fs from 'node:fs'

const BT = String.fromCharCode(96)
const BS = String.fromCharCode(92)
const ROOT = new URL('../', import.meta.url)

const [, , srcFile, bundleDir, ...wanted] = process.argv
if (!srcFile || !bundleDir) {
  console.error('usage: node tools/extract-templates.mjs <src file> <bundle dir> [Name ...]')
  process.exit(2)
}

const text = fs.readFileSync(new URL(srcFile, ROOT), 'utf8')

/** Every `template: <backtick>...<backtick>` with the component name before it. */
const found = []
let i = 0
for (;;) {
  const re = /template:\s*/g
  re.lastIndex = i
  const hit = re.exec(text)
  if (!hit) break
  const open = hit.index + hit[0].length
  if (text[open] !== BT) { i = open; continue }
  let j = open + 1
  while (j < text.length) {
    if (text[j] === BS) { j += 2; continue }
    if (text[j] === BT) break
    j += 1
  }
  // Nearest CAPITALISED `const X = {` above the template. Components are
  // Capitalised here and plain data is not, so matching any identifier picked
  // up the lookup tables sitting between components -- SimplePassword,
  // AdvancedPassword and MadLib all came back named after a `characterSets`
  // or `typeTotals` that happened to be declared closer.
  const head = text.slice(0, hit.index)
  const names = [...head.matchAll(/(?:^|\n)(?:const|let)\s+([A-Z][A-Za-z0-9_$]*)\s*=\s*\{/g)].map((m) => m[1])
  found.push({
    name: names[names.length - 1] || 'Unnamed',
    body: text.slice(open + 1, j),
    at: hit.index,
  })
  i = j + 1
}

if (!wanted.length) {
  console.log(`${srcFile}: ${found.length} templates`)
  for (const f of found) {
    console.log('  %s  %d lines  (offset %d)', f.name.padEnd(20), f.body.split('\n').length, f.at)
  }
  console.log('\nPass names to extract them.')
  process.exit(0)
}

fs.mkdirSync(new URL(bundleDir + '/', ROOT), { recursive: true })
for (const name of wanted) {
  const hits = found.filter((f) => f.name === name)
  if (hits.length !== 1) {
    console.error(`  ${name}: found ${hits.length} matches, expected exactly 1 -- extract by hand`)
    process.exit(1)
  }
  // Trim the leading newline and the common indent, so the .html file reads as
  // a document rather than as a fragment of a JS file.
  let body = hits[0].body.replace(/^\n/, '').replace(/\s+$/, '')
  const lines = body.split('\n').filter((l) => l.trim())
  const indent = Math.min(...lines.map((l) => l.match(/^ */)[0].length))
  if (indent > 0) body = body.split('\n').map((l) => l.slice(indent)).join('\n')

  const out = new URL(bundleDir + '/' + name + '.html', ROOT)
  fs.writeFileSync(out, body + '\n')
  console.log('  wrote  %s  (%d lines)', bundleDir + '/' + name + '.html', body.split('\n').length)
}
