// The settings gear and its popover.
//
// One implementation for all five pages. Only index.html runs Vue, so this is
// plain DOM code; the app mounts the same component and contributes its own
// rows through the `extraSections` option rather than reimplementing the panel.
//
// Nothing runs at import time -- call mountSettingsPanel() explicitly.

import {
  THEMES, getThemeChoice, setThemeChoice,
  FONT_SCALES, getFontScale, setFontScale,
  getPalette, setPalette,
} from './theme.js'
import { PALETTES } from './palettes.js'

const CVD_NOTE = 'Stays distinct from the success, warning and error colours for all types of colour blindness'

const THEME_LABELS = { light: 'Light', dark: 'Dark', system: 'System' }
const THEME_ICONS = {
  light: 'mdi-white-balance-sunny',
  dark: 'mdi-weather-night',
  system: 'mdi-monitor',
}

/** Build a labelled row of chip buttons. Returns { row, sync }. */
const buildChipRow = (label, options, getValue, onSelect, { note } = {}) => {
  const row = document.createElement('div')
  row.className = 'settings-row'

  const heading = document.createElement('span')
  heading.className = 'settings-row-label'
  heading.id = `settings-label-${label.toLowerCase().replace(/\s+/g, '-')}`
  heading.textContent = label
  row.appendChild(heading)

  const group = document.createElement('div')
  group.className = 'settings-chips'
  // A set of mutually exclusive options is a radiogroup, not a set of buttons.
  group.setAttribute('role', 'radiogroup')
  group.setAttribute('aria-labelledby', heading.id)

  const chips = options.map(({ value, label: text, icon, swatch, badge, description }) => {
    const b = document.createElement('button')
    b.type = 'button'
    b.className = 'settings-chip'
    b.setAttribute('role', 'radio')
    b.dataset.value = String(value)
    if (icon) {
      const i = document.createElement('span')
      i.className = `mdi ${icon}`
      i.setAttribute('aria-hidden', 'true')
      b.appendChild(i)
    }
    if (swatch) {
      // Decorative: the name beside it is what actually identifies the option,
      // so this never becomes the only cue (WCAG 1.4.1).
      const s = document.createElement('span')
      s.className = 'settings-swatch'
      s.style.background = swatch
      s.setAttribute('aria-hidden', 'true')
      b.appendChild(s)
    }
    b.appendChild(document.createTextNode(text))
    if (badge) {
      const g = document.createElement('span')
      g.className = `mdi ${badge}`
      g.setAttribute('aria-hidden', 'true')
      b.appendChild(g)
    }
    // The badge is an icon, so the meaning has to reach assistive tech some
    // other way. title also gives sighted users a hover explanation.
    if (description) {
      b.setAttribute('aria-label', `${text}. ${description}`)
      b.title = description
    }
    b.addEventListener('click', () => { onSelect(value); sync() })
    group.appendChild(b)
    return b
  })

  function sync () {
    const current = String(getValue())
    for (const b of chips) {
      const on = b.dataset.value === current
      b.classList.toggle('active', on)
      b.setAttribute('aria-checked', on ? 'true' : 'false')
      // Roving tabindex: only the checked radio is in the tab order.
      b.tabIndex = on ? 0 : -1
    }
    if (!chips.some(b => b.tabIndex === 0) && chips[0]) chips[0].tabIndex = 0
  }

  // Arrow keys move between radios, as expected of a radiogroup.
  group.addEventListener('keydown', (e) => {
    const i = chips.indexOf(document.activeElement)
    if (i === -1) return
    let next = null
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = (i + 1) % chips.length
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') next = (i - 1 + chips.length) % chips.length
    else if (e.key === 'Home') next = 0
    else if (e.key === 'End') next = chips.length - 1
    if (next === null) return
    e.preventDefault()
    chips[next].focus()
    chips[next].click()
  })

  row.appendChild(group)
  if (note) {
    const n = document.createElement('p')
    n.className = 'settings-note'
    n.textContent = note
    row.appendChild(n)
  }
  sync()
  return { row, sync }
}

/**
 * Every palette's accent colour, read from tokens.css rather than duplicated
 * here -- a second copy of eight hex values is exactly the kind of drift these
 * tokens exist to prevent.
 *
 * A detached element would not match the `[data-palette='x']` rules, so the
 * probe has to be in the document, and data-theme is mirrored onto it because
 * the dark overrides are `[data-theme='dark'][data-palette='x']` -- both
 * attributes must be on the same element for that selector to match.
 *
 * The root's own data-palette is lifted for the duration. Custom properties
 * inherit, and the default palette is the bare :root with no rule of its own,
 * so while the root said `violet` the probe for the default inherited violet
 * and the Sky chip showed a violet dot. Nothing paints between removing and
 * restoring the attribute -- getComputedStyle forces a style recalc, not a
 * frame -- so this is invisible.
 */
const readSwatches = (values) => {
  const root = document.documentElement
  const saved = root.getAttribute('data-palette')
  if (saved !== null) root.removeAttribute('data-palette')

  const probe = document.createElement('div')
  probe.style.cssText = 'position:absolute;width:0;height:0;visibility:hidden'
  const theme = root.getAttribute('data-theme')
  if (theme) probe.setAttribute('data-theme', theme)
  document.body.appendChild(probe)

  const out = {}
  for (const v of values) {
    probe.setAttribute('data-palette', v)
    out[v] = getComputedStyle(probe).getPropertyValue('--primary').trim()
  }

  probe.remove()
  if (saved !== null) root.setAttribute('data-palette', saved)
  return out
}

/**
 * Mount the gear into `container`.
 *
 * extraSections: [{ label, options:[{value,label}], get(), set(v) }]
 *   Lets the app add History without this module knowing anything about it.
 */
export const mountSettingsPanel = (container, { extraSections = [] } = {}) => {
  if (!container) return null

  const wrap = document.createElement('div')
  wrap.className = 'settings-wrap'

  const button = document.createElement('button')
  button.type = 'button'
  button.className = 'settings-gear'
  button.setAttribute('aria-label', 'Settings')
  button.title = 'Settings'
  button.setAttribute('aria-expanded', 'false')
  button.setAttribute('aria-haspopup', 'dialog')
  button.innerHTML = '<span class="mdi mdi-cog-outline" aria-hidden="true"></span>'

  const panel = document.createElement('div')
  panel.className = 'settings-panel'
  panel.setAttribute('role', 'dialog')
  panel.setAttribute('aria-label', 'Settings')
  panel.hidden = true

  const syncers = []

  const theme = buildChipRow(
    'Theme',
    THEMES.map(t => ({ value: t, label: THEME_LABELS[t], icon: THEME_ICONS[t] })),
    getThemeChoice,
    // The accent differs between light and dark, so the swatches below are
    // stale the moment the theme changes. refreshColours is hoisted.
    (v) => { setThemeChoice(v); refreshColours() },
  )
  panel.appendChild(theme.row)
  syncers.push(theme.sync)

  const textSize = buildChipRow(
    'Text size',
    FONT_SCALES.map(n => ({ value: n, label: n === 100 ? 'Default' : `${n}%` })),
    getFontScale,
    (v) => setFontScale(v),
  )
  panel.appendChild(textSize.row)
  syncers.push(textSize.sync)

  // Swatches are read at mount time, and the accent colours differ between
  // light and dark, so the row is rebuilt whenever the theme changes.
  let colours = null
  const buildColours = () => {
    const swatches = readSwatches(PALETTES.map(p => p.value))
    return buildChipRow(
    'Colours',
    PALETTES.map(p => ({
      value: p.value,
      label: p.label,
      swatch: swatches[p.value],
      badge: p.cvdSafe ? 'mdi-eye-check-outline' : undefined,
      description: p.cvdSafe ? CVD_NOTE : undefined,
    })),
    getPalette,
    (v) => { setPalette(v); refreshColours() },
    { note: 'Themes marked with an eye stay distinct from the status colours for all types of colour blindness.' },
    )
  }
  function refreshColours () {
    const next = buildColours()
    panel.replaceChild(next.row, colours.row)
    const i = syncers.indexOf(colours.sync)
    if (i !== -1) syncers[i] = next.sync
    colours = next
  }
  colours = buildColours()
  panel.appendChild(colours.row)
  syncers.push(colours.sync)

  for (const s of extraSections) {
    const built = buildChipRow(s.label, s.options, s.get, s.set)
    panel.appendChild(built.row)
    syncers.push(built.sync)
  }

  const setOpen = (open) => {
    panel.hidden = !open
    button.setAttribute('aria-expanded', open ? 'true' : 'false')
    if (open) {
      syncers.forEach(fn => fn())
      const first = panel.querySelector('[tabindex="0"], button')
      if (first) first.focus()
    }
  }

  button.addEventListener('click', () => setOpen(panel.hidden))

  // Escape closes and returns focus to the gear, which is what a dialog owes
  // a keyboard user.
  wrap.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !panel.hidden) {
      e.stopPropagation()
      setOpen(false)
      button.focus()
    }
  })

  document.addEventListener('click', (e) => {
    if (!panel.hidden && !wrap.contains(e.target)) setOpen(false)
  })

  // Tabbing out of the panel should dismiss it rather than leave it hanging
  // open behind the rest of the page.
  wrap.addEventListener('focusout', () => {
    setTimeout(() => {
      if (!panel.hidden && !wrap.contains(document.activeElement)) setOpen(false)
    }, 0)
  })

  wrap.append(button, panel)
  container.appendChild(wrap)

  return { element: wrap, sync: () => syncers.forEach(fn => fn()), close: () => setOpen(false) }
}
