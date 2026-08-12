// The site footer, shared by every page -- and since v2.22.0 it IS the site
// navigation: a floating bar docked at the bottom of the viewport.
//
// Five things ride in it: Generator, Docs, an About menu (About, Changelog,
// Legal, Roadmap), a Links menu (GitHub, Anagrimoire), and the settings gear.
// Nine flat items measured 401px wide on a 375px phone; two submenus buy the
// room back without dropping anything. Everything still renders from the one
// PAGES list in src/site-nav.js.
//
// Nothing runs at import time -- call mountSiteFooter() explicitly.

import { PAGES, isCurrentPage } from './site-nav.js'
import { mountSettingsPanel } from './settings-panel.js'

export const GITHUB_URL = 'https://github.com/rptetzloff/wordlock'

// The companion site. Both are client-side tools that work without an account,
// which is the honest version of the shared pitch -- anagrimoire does have
// optional accounts for syncing stats, so "no accounts" would be wrong. See
// Epic 5 in ROADMAP.md.
export const ANAGRIMOIRE_URL = 'https://anagrimoire.com'

// The reference pages fold into one menu; the two working pages stay at the
// top level. Exported so the tests can prove the grouping covers PAGES
// exactly -- a new page must be placed, not silently dropped.
export const ABOUT_GROUP = ['/about.html', '/changelog.html', '/legal.html', '/roadmap.html']

const GITHUB_PATH =
  'M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z'

const GITHUB_ICON =
  `<svg class="github-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="${GITHUB_PATH}"/></svg>`

/** One bar item or menu item: icon + label. The bar hides labels on narrow
 *  screens, so every link carries an accessible name and a tooltip. */
const barLink = (href, label, iconHTML, { current = false, external = false, item = false } = {}) => {
  const a = document.createElement('a')
  a.href = href
  a.className = item ? 'footer-link footer-menu-item' : 'footer-link'
  if (external) {
    a.target = '_blank'
    a.rel = 'noopener'
  }
  if (current) {
    a.setAttribute('aria-current', 'page')
    a.classList.add('is-current')
  }
  a.setAttribute('aria-label', label)
  a.title = label
  const text = document.createElement('span')
  text.className = 'footer-link-text'
  text.textContent = label
  a.innerHTML = iconHTML
  a.appendChild(text)
  return a
}

/** A submenu: a bar button that opens a small panel of links upward. */
const barMenu = (label, icon, items, { current = false } = {}) => {
  const wrap = document.createElement('div')
  wrap.className = 'footer-menu'

  const btn = document.createElement('button')
  btn.type = 'button'
  btn.className = 'footer-link footer-menu-btn'
  if (current) btn.classList.add('is-current')
  btn.setAttribute('aria-haspopup', 'true')
  btn.setAttribute('aria-expanded', 'false')
  btn.setAttribute('aria-label', label)
  btn.title = label
  btn.innerHTML =
    `<span class="mdi ${icon}" aria-hidden="true"></span>` +
    `<span class="footer-link-text">${label}</span>` +
    '<span class="mdi mdi-chevron-up footer-menu-chevron" aria-hidden="true"></span>'

  const panel = document.createElement('div')
  panel.className = 'footer-menu-panel'
  panel.hidden = true
  for (const item of items) panel.appendChild(item)

  const setOpen = (open) => {
    panel.hidden = !open
    btn.setAttribute('aria-expanded', String(open))
  }
  btn.addEventListener('click', () => {
    const opening = panel.hidden
    // One menu at a time; opening this one closes any sibling.
    document.querySelectorAll('.footer-menu-panel').forEach((p) => {
      if (p !== panel && !p.hidden) {
        p.hidden = true
        p.closest('.footer-menu').querySelector('.footer-menu-btn').setAttribute('aria-expanded', 'false')
      }
    })
    setOpen(opening)
  })
  document.addEventListener('click', (e) => {
    if (!panel.hidden && !wrap.contains(e.target)) setOpen(false)
  })
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !panel.hidden) setOpen(false)
  })

  wrap.append(panel, btn)
  return wrap
}

/**
 * Replace `container` with the floating footer bar.
 *
 * settings.extraSections is handed straight to the settings panel, which is
 * how the app contributes its History, Bit hints and Clear clipboard rows
 * without this module knowing about them.
 */
export const mountSiteFooter = (container, { pathname, settings = {} } = {}) => {
  if (!container) return null
  const here = pathname || (typeof location !== 'undefined' ? location.pathname : '/')

  const footer = document.createElement('footer')
  footer.className = 'site-footer'
  footer.setAttribute('aria-label', 'Site')

  const aboutItems = []
  for (const page of PAGES) {
    const link = barLink(page.href, page.label,
      `<span class="mdi ${page.icon}" aria-hidden="true"></span>`,
      { current: isCurrentPage(page.href, here), item: ABOUT_GROUP.includes(page.href) })
    if (ABOUT_GROUP.includes(page.href)) aboutItems.push(link)
    else footer.appendChild(link)
  }

  footer.appendChild(barMenu('About', 'mdi-information-outline', aboutItems, {
    current: ABOUT_GROUP.some((href) => isCurrentPage(href, here)),
  }))

  footer.appendChild(barMenu('Links', 'mdi-open-in-new', [
    barLink(GITHUB_URL, 'GitHub', GITHUB_ICON, { external: true, item: true }),
    barLink(ANAGRIMOIRE_URL, 'Anagrimoire',
      '<span class="mdi mdi-book-alphabet" aria-hidden="true"></span>',
      { external: true, item: true }),
  ]))

  mountSettingsPanel(footer, settings)

  container.replaceWith(footer)
  // Room for the bar, so the last of the content can scroll clear of it.
  document.body.classList.add('has-bottom-nav')
  return footer
}
