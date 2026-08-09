// The shared site header: icon, title, subtitle, and the nav bar.
//
// Every page renders the same header from this one function, including the
// app. Previously the app had a large bespoke header while the four static
// pages hand-rolled a compact one, so "the header" meant two different things
// and neither could be changed without touching the other.
//
// The subtitle comes from the page's own entry in PAGES, so a page's nav label
// and its header identity live together.
//
// Nothing runs at import time -- call mountSiteHeader() explicitly.

import { pageFor, mountSiteNav } from './site-nav.js'
import { mountSettingsPanel } from './settings-panel.js'
import { createLogo } from './logo.js'

export const SITE_TITLE = 'Random Password Generator'

/**
 * Replace `container` with the shared header.
 *
 * `description` is an optional block below the title row, spanning the full
 * width -- the app uses it for the privacy notice. Pass a string, or an
 * element if it needs markup. Pages that omit it simply do not get the row.
 *
 * settings.extraSections is handed straight to the settings panel, which is how
 * the app contributes its History control without this module knowing about it.
 */
export const mountSiteHeader = (container, { pathname = location.pathname, settings = {}, description = null } = {}) => {
  if (!container) return null

  const page = pageFor(pathname)

  const header = document.createElement('header')
  header.className = 'site-header'

  const inner = document.createElement('div')
  inner.className = 'header-inner'

  // Inline rather than <img>, so the mark can read the theme -- see logo.js.
  const icon = createLogo('header-icon')

  const text = document.createElement('div')
  text.className = 'header-text'
  const h1 = document.createElement('h1')
  h1.textContent = SITE_TITLE
  text.appendChild(h1)
  if (page && page.subtitle) {
    const p = document.createElement('p')
    p.textContent = page.subtitle
    text.appendChild(p)
  }

  const nav = document.createElement('nav')
  nav.className = 'header-nav'
  nav.setAttribute('aria-label', 'Site')

  inner.append(icon, text, nav)

  if (description) {
    const desc = document.createElement('div')
    desc.className = 'header-description'
    if (typeof description === 'string') desc.innerHTML = description
    else desc.appendChild(description)
    inner.appendChild(desc)
  }

  header.appendChild(inner)
  container.replaceWith(header)

  mountSiteNav(nav, pathname)
  mountSettingsPanel(nav, settings)

  return { header, nav }
}
