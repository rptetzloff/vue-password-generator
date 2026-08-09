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

export const THEME_KEY = 'global.theme'
export const THEMES = ['light', 'dark', 'system']

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

/**
 * Apply the stored choice and keep it in step with the OS while the choice is
 * 'system'. Returns the resolved theme.
 */
export const initTheme = () => {
  const choice = getThemeChoice()
  const resolved = applyTheme(choice)
  if (typeof matchMedia === 'function') {
    matchMedia(DARK_QUERY).addEventListener('change', () => {
      // Only follow the OS while the user has actually asked us to.
      if (getThemeChoice() === 'system') applyTheme('system')
    })
  }
  return resolved
}
