// The site navigation, shared by every page.
//
// Previously each page hand-rolled its own subset of links and they had drifted
// badly: docs offered Changelog, changelog offered Docs, legal offered About,
// and the app offered only Docs. Generating them from one list means every page
// reaches every other page, and a new page is added in exactly one place.
//
// Nothing runs at import time.

// `subtitle` is the line under the site title in the shared header, so a page's
// nav entry and its header identity stay in one place.
export const PAGES = [
  { href: '/', label: 'Generator', icon: 'mdi-key-variant', subtitle: 'Generate secure passwords with multiple customization options' },
  { href: '/vault.html', label: 'Vault', icon: 'mdi-safe-square-outline', subtitle: 'Keep what you generate, encrypted on this device' },
  { href: '/docs.html', label: 'Docs', icon: 'mdi-book-open-outline', subtitle: 'Documentation & Reference' },
  { href: '/changelog.html', label: 'Changelog', icon: 'mdi-history', subtitle: 'Release history' },
  { href: '/about.html', label: 'About', icon: 'mdi-information-outline', subtitle: 'What this is and who made it' },
  { href: '/legal.html', label: 'Legal', icon: 'mdi-scale-balance', subtitle: 'Privacy, license and attributions' },
  { href: '/roadmap.html', label: 'Roadmap', icon: 'mdi-map-marker-path', subtitle: 'What is planned, and what is only being considered' },
]

/** The nav entry for the page being viewed, or null. */
export const pageFor = (pathname) =>
  PAGES.find((p) => isCurrentPage(p.href, pathname)) || null

/**
 * Whether `href` is the page currently being viewed.
 *
 * Pure, so it is unit-testable. Deliberately tolerant about form, because the
 * same page arrives under several spellings: hosts that serve clean URLs turn
 * /docs.html into /docs, the root shows up as '/', '' or '/index.html', and a
 * query or hash may be tacked on. Comparing raw strings marks nothing as
 * current the moment a host rewrites extensions.
 */
export const isCurrentPage = (href, pathname) => {
  if (typeof href !== 'string' || typeof pathname !== 'string') return false
  const normalize = (p) => {
    let out = p.split(/[?#]/)[0]
    out = out.replace(/\.html$/i, '')
    out = out.replace(/\/index$/i, '/')
    if (out.length > 1) out = out.replace(/\/+$/, '')
    return out === '' ? '/' : out
  }
  return normalize(pathname) === normalize(href)
}
