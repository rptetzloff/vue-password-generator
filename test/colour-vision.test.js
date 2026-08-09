import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { ciede2000, closestPair, VISIONS } from './helpers/color.js'

// Whether the palette works for colour-blind users used to be answered by eye.
// Eye was wrong: the old dark-theme change-group set contained a pair a
// protanope sees as effectively one colour. These tests answer it by measuring.

// ---------------------------------------------------------------------------
// First, check the instrument.
//
// A wrong CIEDE2000 would hand out confident numbers that mean nothing, so it
// is pinned against the reference pairs published with the formula (Sharma,
// Wu & Dalal 2005), which exist precisely because the implementation has
// several easy-to-miss discontinuities around the hue wrap.
// ---------------------------------------------------------------------------
const SHARMA = [
  [[50.0000, 2.6772, -79.7751], [50.0000, 0.0000, -82.7485], 2.0425],
  [[50.0000, 3.1571, -77.2803], [50.0000, 0.0000, -82.7485], 2.8615],
  [[50.0000, 2.8361, -74.0200], [50.0000, 0.0000, -82.7485], 3.4412],
  [[50.0000, -1.3802, -84.2814], [50.0000, 0.0000, -82.7485], 1.0000],
  [[50.0000, -1.1848, -84.8006], [50.0000, 0.0000, -82.7485], 1.0000],
  [[50.0000, -0.9009, -85.5211], [50.0000, 0.0000, -82.7485], 1.0000],
  [[50.0000, 0.0000, 0.0000], [50.0000, -1.0000, 2.0000], 2.3669],
  [[50.0000, -1.0000, 2.0000], [50.0000, 0.0000, 0.0000], 2.3669],
  [[50.0000, 2.5000, 0.0000], [50.0000, 0.0000, -2.5000], 4.3065],
  [[50.0000, 2.5000, 0.0000], [73.0000, 25.0000, -18.0000], 27.1492],
  [[50.0000, 2.5000, 0.0000], [50.0000, 3.1736, 0.5854], 1.0000],
  [[50.0000, 2.5000, 0.0000], [50.0000, 3.2972, 0.0000], 1.0000],
  [[60.2574, -34.0099, 36.2677], [60.4626, -34.1751, 39.4387], 1.2644],
  [[63.0109, -31.0961, -5.8663], [62.8187, -29.7946, -4.0864], 1.2630],
  [[61.2901, 3.7196, -5.3901], [61.4292, 2.2480, -4.9620], 1.8731],
  [[35.0831, -44.1164, 3.7933], [35.0232, -40.0716, 1.5901], 1.8645],
  [[22.7233, 20.0904, -46.6940], [23.0331, 14.9730, -42.5619], 2.0373],
]

test('CIEDE2000 matches the published reference pairs', () => {
  for (const [a, b, expected] of SHARMA) {
    const got = ciede2000(a, b)
    assert.ok(
      Math.abs(got - expected) < 0.0001,
      `dE(${a}, ${b}) = ${got.toFixed(4)}, reference says ${expected}`,
    )
  }
})

test('CIEDE2000 is symmetric and zero for identical colours', () => {
  for (const [a, b] of SHARMA) {
    assert.equal(ciede2000(a, a), 0)
    assert.ok(Math.abs(ciede2000(a, b) - ciede2000(b, a)) < 1e-12)
  }
})

// ---------------------------------------------------------------------------
// Now the palette itself.
// ---------------------------------------------------------------------------
const CSS = fs.readFileSync(new URL('../src/tokens.css', import.meta.url), 'utf8')
const readBlock = (selector) => {
  const start = CSS.indexOf(selector)
  assert.notEqual(start, -1, `${selector} not found in tokens.css`)
  const open = CSS.indexOf('{', start)
  const body = CSS.slice(open, CSS.indexOf('\n}', open))
  const out = {}
  for (const m of body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) out[m[1]] = m[2].trim()
  return out
}
const light = readBlock(':root')
const dark = { ...light, ...readBlock("[data-theme='dark']") }

const GROUPS = ['added', 'improved', 'fixed', 'removed', 'security']

// Where the shipping palette actually sits, measured:
//
//   set                  normal  protan  deutan  tritan
//   old brand / light      16.2     8.6     5.8     8.2
//   shipping   / light     24.1     7.8     8.5    13.7
//   old brand / dark       28.0     1.1     6.4     8.5
//   shipping   / dark      22.4     7.3    11.1    10.8
//
// The dark protan column is the one that matters: 1.1 means indistinguishable.
// 7.0 is set just below the current worst (7.3) so this pins today's behaviour
// and fails loudly on a regression toward the old set. It is a floor, not a
// target -- raising it is the point of the palette work still to come.
const FLOOR = 7.0

for (const [themeName, tokens] of [['light', light], ['dark', dark]]) {
  for (const vision of VISIONS) {
    test(`change-group colours stay distinguishable in ${themeName} for ${vision} vision`, () => {
      const colours = GROUPS.map((g) => {
        const c = tokens[`--group-${g}`]
        assert.ok(c, `--group-${g} missing in ${themeName}`)
        return c
      })
      const { delta, a, b } = closestPair(colours, GROUPS, vision)
      assert.ok(
        delta >= FLOOR,
        `${themeName}/${vision}: ${a} and ${b} are only ${delta.toFixed(1)} apart ` +
          `(CIEDE2000), below the ${FLOOR} floor`,
      )
    })
  }
}

test('every change group is also labelled in text, not colour alone', () => {
  // WCAG 1.4.1. The measurements above are about making the colours *helpful*;
  // this is what makes them non-essential, and it is the reason a weak pair is
  // a quality problem rather than an accessibility failure.
  const html = fs.readFileSync(new URL('../changelog.html', import.meta.url), 'utf8')
  for (const g of GROUPS) {
    const label = g[0].toUpperCase() + g.slice(1)
    assert.match(
      html,
      new RegExp(`>\\s*${label}\\s*<`, 'i'),
      `the changelog should print "${label}" as text, not rely on --group-${g}`,
    )
  }
})
