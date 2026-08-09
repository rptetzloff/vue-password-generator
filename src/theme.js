// Theme runtime, shared by all five pages.
//
// Only index.html runs Vue, so this is plain ES module code with no framework
// dependency. Nothing runs at import time -- callers invoke initTheme()
// explicitly -- which also keeps resolveTheme() importable by the test suite.
//
// Note this module does NOT prevent the flash of the wrong theme on its own.
// Module scripts are deferred, so they execute after first paint. Each page
// carries a small blocking inline script in <head> that sets data-theme before
// anything renders; this module then takes over for changes made at runtime.

import { PALETTE_KEY, DEFAULT_PALETTE, resolvePalette } from './palettes.js'

export const THEME_KEY = 'global.theme'
export const THEMES = ['light', 'dark', 'system']

export { PALETTE_KEY, resolvePalette }

// Text size, as a percentage applied to the root font size. Everything that
// should scale is in rem, so this resizes the interface rather than just the
// copy. 100 means "whatever the browser is already set to" -- it multiplies the
// user's own default rather than replacing it, so someone who has raised their
// browser font size keeps that as the baseline.
export const FONT_SCALE_KEY = 'global.fontScale'
export const FONT_SCALES = [100, 112, 125, 150]

const DARK_QUERY = '(prefers-color-scheme: dark)'

/** Which concrete theme a stored choice resolves to. Pure, so it is testable. */
export const resolveTheme = (choice, prefersDark) =>
  choice === 'dark' || (choice === 'system' && prefersDark) ? 'dark' : 'light'

/** The stored choice, falling back to 'system' for anything unrecognised. */
export const getThemeChoice = () => {
  try {
    const v = JSON.parse(localStorage.getItem(THEME_KEY))
    return THEMES.includes(v) ? v : 'system'
  } catch {
    return 'system'
  }
}

const prefersDark = () =>
  typeof matchMedia === 'function' && matchMedia(DARK_QUERY).matches

/** Write the resolved theme onto <html>. */
export const applyTheme = (choice) => {
  const resolved = resolveTheme(choice, prefersDark())
  document.documentElement.setAttribute('data-theme', resolved)
  return resolved
}

/**
 * Persist a choice and apply it.
 * Stored as JSON so it matches how every other setting is written -- the app's
 * persistedRef() uses JSON.stringify, and a bare string would not parse back.
 */
export const setThemeChoice = (choice) => {
  const next = THEMES.includes(choice) ? choice : 'system'
  try {
    localStorage.setItem(THEME_KEY, JSON.stringify(next))
  } catch {}
  return applyTheme(next)
}

/** Clamp an arbitrary stored value to a scale we actually offer. */
export const resolveFontScale = (value) => {
  const n = Number(value)
  return FONT_SCALES.includes(n) ? n : 100
}

export const getFontScale = () => {
  try {
    return resolveFontScale(JSON.parse(localStorage.getItem(FONT_SCALE_KEY)))
  } catch {
    return 100
  }
}

/**
 * Set the root font size as a percentage.
 * A percentage rather than a px value on purpose: px would discard whatever the
 * user has configured as their browser default, which is the one setting an
 * accessibility-minded reader is most likely to have already changed.
 */
export const applyFontScale = (value) => {
  const scale = resolveFontScale(value)
  document.documentElement.style.fontSize = scale === 100 ? '' : `${scale}%`
  return scale
}

export const setFontScale = (value) => {
  const scale = resolveFontScale(value)
  try {
    localStorage.setItem(FONT_SCALE_KEY, JSON.stringify(scale))
  } catch {}
  return applyFontScale(scale)
}

// Palette is a second axis, independent of light/dark. Every palette is
// defined for both themes, so the two compose freely. See src/palettes.js for
// what a palette is allowed to change and why.

export const getPalette = () => {
  try {
    return resolvePalette(JSON.parse(localStorage.getItem(PALETTE_KEY)))
  } catch {
    return DEFAULT_PALETTE
  }
}

export const applyPalette = (value) => {
  const palette = resolvePalette(value)
  // The default is the bare :root, so the attribute is only set when something
  // actually overrides it.
  if (palette === DEFAULT_PALETTE) document.documentElement.removeAttribute('data-palette')
  else document.documentElement.setAttribute('data-palette', palette)
  return palette
}

export const setPalette = (value) => {
  const palette = resolvePalette(value)
  try {
    localStorage.setItem(PALETTE_KEY, JSON.stringify(palette))
  } catch {}
  return applyPalette(palette)
}

/**
 * Apply the stored choice and keep it in step with the OS while the choice is
 * 'system'. Returns the resolved theme.
 */
export const initTheme = () => {
  const choice = getThemeChoice()
  const resolved = applyTheme(choice)
  applyFontScale(getFontScale())
  applyPalette(getPalette())
  if (typeof matchMedia === 'function') {
    matchMedia(DARK_QUERY).addEventListener('change', () => {
      // Only follow the OS while the user has actually asked us to.
      if (getThemeChoice() === 'system') applyTheme('system')
    })
  }
  return resolved
}
