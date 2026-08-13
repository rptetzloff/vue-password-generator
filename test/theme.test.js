import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { resolveTheme, THEMES, THEME_KEY, resolveFontScale, FONT_SCALES, FONT_SCALE_KEY } from '../src/theme.js'
import { PALETTE_KEY, PALETTE_VALUES, DEFAULT_PALETTE, resolvePalette } from '../src/palettes.js'
import { PAGE_FILES } from './helpers/pages.js'

// theme.js is importable here only because nothing runs at module scope -- the
// DOM-touching functions are all called explicitly. If someone adds an
// auto-init, this file stops loading and that is the intended warning.

test('resolveTheme honours an explicit choice regardless of the OS', () => {
  assert.equal(resolveTheme('dark', false), 'dark')
  assert.equal(resolveTheme('dark', true), 'dark')
  assert.equal(resolveTheme('light', true), 'light')
  assert.equal(resolveTheme('light', false), 'light')
})

test('resolveTheme follows the OS only when the choice is system', () => {
  assert.equal(resolveTheme('system', true), 'dark')
  assert.equal(resolveTheme('system', false), 'light')
})

test('resolveTheme falls back to light for anything unrecognized', () => {
  for (const bad of ['', 'Dark', 'blue', null, undefined, 0, {}]) {
    assert.equal(resolveTheme(bad, false), 'light', `${JSON.stringify(bad)} with light OS`)
  }
  // An unrecognized value must not accidentally inherit the OS preference --
  // only 'system' is allowed to do that.
  for (const bad of ['', 'Dark', 'blue', null, undefined, 0, {}]) {
    assert.equal(resolveTheme(bad, true), 'light', `${JSON.stringify(bad)} with dark OS`)
  }
})

test('the theme contract is the one the inline head snippet assumes', () => {
  // Each page carries a blocking inline copy of this logic to avoid a flash of
  // the wrong theme. It hardcodes the key and the three choices, so if these
  // change the snippets must change with them.
  assert.equal(THEME_KEY, 'global.theme')
  assert.deepEqual(THEMES, ['light', 'dark', 'system'])
})

// Text size. Everything that should scale is in rem, so this resizes the whole
// interface rather than only the copy.
test('resolveFontScale accepts only the offered scales', () => {
  for (const n of FONT_SCALES) assert.equal(resolveFontScale(n), n)
  assert.equal(resolveFontScale('125'), 125, 'a numeric string should be accepted')
})

test('resolveFontScale falls back to 100 for anything else', () => {
  for (const bad of [null, undefined, 0, -50, 999, 'huge', {}, [], NaN]) {
    assert.equal(resolveFontScale(bad), 100, `${JSON.stringify(bad)} should fall back`)
  }
})

test('the font-scale contract matches the inline head snippet', () => {
  // Each page hardcodes the non-default scales in its pre-paint script, so that
  // raising the text size does not flash at the default first.
  assert.equal(FONT_SCALE_KEY, 'global.fontScale')
  assert.deepEqual(FONT_SCALES.filter(n => n !== 100), [112, 125, 150])
})

test('every page pre-paints the same palette list as the manifest', () => {
  // The pre-paint script cannot import anything -- it is inline, blocking and
  // non-module -- so it repeats the palette names. That duplication is the
  // whole risk: add a palette to src/palettes.js and, without this, the new
  // theme would apply only after first paint, flashing the default first on
  // every page load. Five pages, so five chances to update four of them.
  assert.equal(PALETTE_KEY, 'global.palette')
  const expected = PALETTE_VALUES.filter((v) => v !== DEFAULT_PALETTE)

  for (const page of PAGE_FILES) {
    const html = fs.readFileSync(new URL(`../${page}`, import.meta.url), 'utf8')
    const m = /\[([^\]]*)\]\s*\.indexOf\(pal\)/.exec(html)
    assert.ok(m, `${page} has no palette list in its pre-paint script`)
    const listed = [...m[1].matchAll(/'([\w-]+)'/g)].map((x) => x[1])
    assert.deepEqual(
      listed,
      expected,
      `${page} pre-paints [${listed.join(', ')}] but the manifest says [${expected.join(', ')}]`,
    )
  }
})

test('resolvePalette accepts only the offered palettes', () => {
  for (const v of PALETTE_VALUES) assert.equal(resolvePalette(v), v)
})

test('resolvePalette falls back to the default for anything else', () => {
  // Including the value the removed opt-in palette used to store, which is
  // still sitting in localStorage for anyone who selected it.
  for (const bad of ['cvd', 'amber', '', null, undefined, 0, {}, 'SKY']) {
    assert.equal(resolvePalette(bad), DEFAULT_PALETTE)
  }
})
