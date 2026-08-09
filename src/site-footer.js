// The site footer, shared by every page.
//
// The header was unified into src/site-header.js some time ago; the footer was
// not, and it drifted exactly as the header had. Six hand-written copies -- the
// five standalone pages plus a sixth inside the Vue template in main.js -- each
// with its own list of links, each needing an edit to add a page.
//
// Both now come from the same PAGES list in src/site-nav.js, so a new page is
// added in one place and appears in both navigations.
//
// Nothing runs at import time -- call mountSiteFooter() explicitly.

import { PAGES, isCurrentPage } from './site-nav.js'

export const GITHUB_URL = 'https://github.com/rptetzloff/vue-password-generator'

// The companion site. Both are client-side tools that work without an account,
// which is the honest version of the shared pitch -- anagrimoire does have
// optional accounts for syncing stats, so "no accounts" would be wrong. See
// Epic 5 in ROADMAP.md.
export const ANAGRIMOIRE_URL = 'https://anagrimoire.com'

// The root is "Generator" in the header, where it sits beside the other
// sections, but "App" in the footer, which is a plainer list of destinations.
const FOOTER_LABELS = { '/': 'App' }

/**
 * The pages a footer on `pathname` should link to: every page except the one
 * being viewed. Pure, so it is unit-testable without a DOM.
 */
export const footerPages = (pathname) =>
  PAGES.filter((p) => !isCurrentPage(p.href, pathname)).map((p) => ({
    href: p.href,
    label: FOOTER_LABELS[p.href] || p.label,
  }))

const GITHUB_PATH =
  'M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z'

/**
 * Replace `container` with the site footer.
 *
 * `wrap` adds the .container width limiter the app page uses; the standalone
 * pages set their own width and do not want it.
 */
export const mountSiteFooter = (container, { pathname, wrap = false } = {}) => {
  if (!container) return null
  const here = pathname || (typeof location !== 'undefined' ? location.pathname : '/')

  const footer = document.createElement('footer')
  footer.className = 'site-footer'

  const inner = document.createElement('div')
  inner.className = 'footer-inner'

  const links = document.createElement('div')
  links.className = 'footer-links'

  const gh = document.createElement('a')
  gh.href = GITHUB_URL
  gh.className = 'footer-link footer-link-icon'
  gh.target = '_blank'
  gh.rel = 'noopener'
  gh.title = 'View on GitHub'
  gh.innerHTML =
    `<svg class="github-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="${GITHUB_PATH}"/></svg>`
  gh.appendChild(document.createTextNode('GitHub'))
  links.appendChild(gh)

  for (const page of footerPages(here)) {
    const a = document.createElement('a')
    a.href = page.href
    a.className = 'footer-link'
    a.textContent = page.label
    links.appendChild(a)
  }

  const ana = document.createElement('a')
  ana.href = ANAGRIMOIRE_URL
  ana.className = 'footer-link footer-link-icon'
  ana.target = '_blank'
  ana.rel = 'noopener'
  ana.title = 'Anagrimoire — word puzzle solver, also client-side'
  ana.innerHTML = '<span class="mdi mdi-book-alphabet" aria-hidden="true"></span>'
  ana.appendChild(document.createTextNode('Anagrimoire'))
  links.appendChild(ana)

  inner.appendChild(links)
  if (wrap) {
    const box = document.createElement('div')
    box.className = 'container'
    box.appendChild(inner)
    footer.appendChild(box)
  } else {
    footer.appendChild(inner)
  }

  container.replaceWith(footer)
  return footer
}
