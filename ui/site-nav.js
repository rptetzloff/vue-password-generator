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
//
// `host` says which of the two deployments a page belongs to once the split in
// ROADMAP 11 happens: the generator and the vault to app.wordlock.net, the
// prose pages to wordlock.net. It is recorded now and costs nothing yet --
// with no ORIGINS configured every link stays relative, exactly as today.
// Tagging early means the move is a config change rather than an edit to every
// consumer, and it means the grouping is reviewable before anything depends
// on it.
export const PAGES = [
  { href: '/', label: 'Generator', host: 'app', icon: 'mdi-key-variant', subtitle: 'Generate secure passwords with multiple customization options' },
  { href: '/vault.html', label: 'Vault', host: 'app', icon: 'mdi-shield-key-outline', subtitle: 'Keep what you generate, encrypted on this device' },
  { href: '/docs.html', label: 'Docs', host: 'site', icon: 'mdi-book-open-outline', subtitle: 'Documentation & Reference' },
  { href: '/changelog.html', label: 'Changelog', host: 'site', icon: 'mdi-history', subtitle: 'Release history' },
  { href: '/about.html', label: 'About', host: 'site', icon: 'mdi-information-outline', subtitle: 'What this is and who made it' },
  { href: '/legal.html', label: 'Legal', host: 'site', icon: 'mdi-scale-balance', subtitle: 'Privacy, license and attributions' },
  { href: '/roadmap.html', label: 'Roadmap', host: 'site', icon: 'mdi-map-marker-path', subtitle: 'What is planned, and what is only being considered' },
]

/**
 * Where each host is served from, once they are separate.
 *
 * Empty today, and that is the whole point: `hrefFor` falls back to the
 * relative href, so one origin behaves precisely as it does now and the split
 * is a matter of filling this in. The module does not name a domain, because
 * which host lives where is deployment configuration rather than navigation.
 */
export const ORIGINS = { site: '', app: '' }

/**
 * The href to use for a page, given where the reader currently is.
 *
 * Same host, or no origin configured for the other one: the relative href,
 * unchanged. Different host with an origin known: absolute, because a
 * root-relative link would resolve against the wrong deployment and 404.
 */
export const hrefFor = (page, currentHost = null, origins = ORIGINS) => {
  if (!page || typeof page.href !== 'string') return ''
  const host = page.host || 'site'
  if (currentHost === null || host === currentHost) return page.href
  const origin = origins && origins[host]
  return origin ? origin + page.href : page.href
}

/** The nav entry for the page being viewed, or null. */
export const pageFor = (pathname, currentHost = null) =>
  PAGES.find((p) => isCurrentEntry(p, pathname, currentHost)) || null

/**
 * Whether a nav entry is the page being viewed.
 *
 * Once the two deployments are live, path alone stops being enough: `/` is the
 * generator on one host and the home page on the other, so the same pathname
 * names two different pages. `currentHost` of null means "one origin", which
 * is today, and the host is ignored.
 */
export const isCurrentEntry = (page, pathname, currentHost = null) => {
  if (!page) return false
  if (currentHost !== null && (page.host || 'site') !== currentHost) return false
  return isCurrentPage(page.href, pathname)
}

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
