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

  attachCondense(header)

  return { header, nav }
}

/**
 * Shrink the sticky header once the page is scrolled, and keep it shrunk on
 * small screens where the full version would dominate the viewport anyway.
 *
 * Two guards against feedback, both needed. Condensing removes ~180px of
 * header, which shortens the document; on a short page the browser then clamps
 * the scroll position back up, and a naive `scrollY > threshold` test flips
 * straight back. Measured on about.html: the state changed every single frame,
 * with scrollY bouncing between 70 and 14.
 *
 *   1. Hysteresis -- condense above CONDENSE_AT, but only expand again below
 *      the lower EXPAND_AT, so a small clamp cannot cross both.
 *   2. A room check -- do not condense at all unless the page has more
 *      scrollable distance than the header could give back. Without this, a
 *      page barely taller than the viewport can still be clamped past both
 *      thresholds at once.
 */
export const CONDENSE_AT = 64
export const EXPAND_AT = 24
const SMALL_SCREEN = '(max-width: 640px)'

/**
 * Whether the header should be condensed, given the current state.
 *
 * Just a scroll threshold with a little hysteresis so jitter around the
 * boundary does not flutter the class.
 *
 * An earlier version also carried a "room to condense" rule and a settle lock,
 * to survive the header shrinking the document and the browser clamping the
 * scroll position in response. That feedback was self-inflicted: the header was
 * position: sticky, so it sat in the flow and its height was part of the page.
 * It is now fixed with a spacer holding the space, so condensing changes no
 * layout at all and there is nothing to guard against.
 */
export const shouldCondense = ({ small, scrollY, condensed }) => {
  if (small) return true
  if (!condensed) return scrollY > CONDENSE_AT
  return scrollY >= EXPAND_AT
}

const attachCondense = (header) => {
  const small = typeof matchMedia === 'function' ? matchMedia(SMALL_SCREEN) : null
  let condensed = false

  // The header is fixed, so it no longer occupies space. This spacer holds the
  // expanded height open beneath it. Its height is only ever refreshed while
  // the header is expanded, so condensing leaves the page layout completely
  // untouched -- which is what makes the animation purely visual.
  const spacer = document.createElement('div')
  spacer.className = 'site-header-spacer'
  spacer.setAttribute('aria-hidden', 'true')
  header.after(spacer)

  /**
   * Size the spacer to the space the fixed header needs.
   *
   * Normally that is the expanded height, held constant so that condensing on
   * scroll cannot move the content. On small screens the header is condensed
   * permanently and never expands, so there the spacer must track its real
   * height -- otherwise it reserves room for an expansion that never comes,
   * which left a large empty gap above the content on narrow viewports.
   */
  const syncSpacer = () => {
    const permanentlyCondensed = !!(small && small.matches)
    if (condensed && !permanentlyCondensed) return
    spacer.style.height = `${header.offsetHeight}px`
  }

  const update = () => {
    frame = 0
    const next = shouldCondense({
      small: !!(small && small.matches),
      scrollY: window.scrollY,
      condensed,
    })
    if (next === condensed) return
    condensed = next
    header.classList.toggle('is-condensed', condensed)
    // Crossing the small-screen boundary changes which height the spacer
    // should hold, so re-measure after the state settles.
    syncSpacer()
  }

  // Coalesce to one update per frame; scroll fires far more often than that.
  let frame = 0
  const schedule = () => { if (!frame) frame = requestAnimationFrame(update) }

  window.addEventListener('scroll', schedule, { passive: true })
  window.addEventListener('resize', () => { syncSpacer(); schedule() }, { passive: true })
  if (small) small.addEventListener('change', update)

  // The expanded height changes with the text-size setting and with wrapping,
  // so re-measure rather than measuring once -- but syncSpacer ignores anything
  // sampled mid-transition.
  if (typeof ResizeObserver === 'function') {
    new ResizeObserver(syncSpacer).observe(header)
  }

  // Order matters: settle the condensed state first, then measure. Measuring
  // first sized the spacer from an expanded header that was about to condense.
  update()
  syncSpacer()

  // The header grows once the icon font arrives -- it is 403 KB, so that can be
  // well after mount, and a spacer measured beforehand would be too short.
  // ResizeObserver above normally catches this; these are cheap insurance for
  // the case where it does not fire before paint.
  window.addEventListener('load', syncSpacer, { once: true })
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(syncSpacer)
}
