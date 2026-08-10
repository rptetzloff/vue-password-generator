// The site navigation, shared by every page.
//
// Previously each page hand-rolled its own subset of links and they had drifted
// badly: docs offered Changelog, changelog offered Docs, legal offered About,
// and the app offered only Docs. Generating them from one list means every page
// reaches every other page, and a new page is added in exactly one place.
//
// Nothing runs at import time -- call mountSiteNav() explicitly.

// `subtitle` is the line under the site title in the shared header, so a page's
// nav entry and its header identity stay in one place.
export const PAGES = [
  { href: '/', label: 'Generator', icon: 'mdi-key-variant', subtitle: 'Generate secure passwords with multiple customization options' },
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

/** Render the nav links into `container`, marking the current page. */
export const mountSiteNav = (container, pathname = location.pathname) => {
  if (!container) return null
  const links = PAGES.map((p) => {
    const a = document.createElement('a')
    a.className = 'header-link'
    a.href = p.href
    const current = isCurrentPage(p.href, pathname)
    if (current) {
      // aria-current is what tells a screen reader which page you are on;
      // the class is only the visual counterpart.
      a.setAttribute('aria-current', 'page')
      a.classList.add('is-current')
    }
    const icon = document.createElement('span')
    icon.className = `mdi ${p.icon}`
    icon.setAttribute('aria-hidden', 'true')

    // The label is wrapped so the condensed header can hide it and leave the
    // icon. Two fallbacks are needed once it is hidden, for different people:
    // aria-label, because display:none takes the text out of the accessibility
    // tree along with the link's only name; and title, so a sighted mouse user
    // gets a tooltip rather than an unlabelled icon they have to guess at.
    const text = document.createElement('span')
    text.className = 'header-link-text'
    text.textContent = p.label
    a.setAttribute('aria-label', p.label)
    a.title = p.label

    a.append(icon, text)
    container.appendChild(a)
    return a
  })
  return { links }
}
