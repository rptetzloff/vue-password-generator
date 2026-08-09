import test from 'node:test'
import assert from 'node:assert/strict'
import { resolveTheme, THEMES, THEME_KEY } from '../src/theme.js'

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

test('resolveTheme falls back to light for anything unrecognised', () => {
  for (const bad of ['', 'Dark', 'blue', null, undefined, 0, {}]) {
    assert.equal(resolveTheme(bad, false), 'light', `${JSON.stringify(bad)} with light OS`)
  }
  // An unrecognised value must not accidentally inherit the OS preference --
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
