// Wiping a copied password from the clipboard after a delay (ROADMAP 9a
// suggestion, shipped v2.20.0).
//
// Lifted out of main.js when the vault page turned out to need it too: that
// page copies passwords from vault entries, so the timer is just as relevant
// there, and two copies of this would have drifted the way six copies of the
// footer once did. Deliberately free of Vue, so both apps can use it.

export const CLIPBOARD_CLEAR_KEY = 'global.clipboardClear'

/** Seconds until a copied password is wiped; 0 keeps it. */
export const clipboardClearSeconds = () => {
  try {
    const v = JSON.parse(localStorage.getItem(CLIPBOARD_CLEAR_KEY))
    return Number.isFinite(v) && v >= 0 ? v : 0
  } catch { return 0 }
}

let timer = null

// A schedule that reached its deadline while the page was unfocused leaves a
// gesture listener armed. Without this, copying again would arm a second one
// and leave the first in place -- and the first would fire on the next click,
// wiping the NEW password well before its own deadline. Found by copying
// twice in one session and counting the wipes.
let disarmGesture = null

/**
 * Schedule the wipe. Call it right after a successful copy.
 *
 * The wipe is blunt on purpose: it writes '' over whatever is in the clipboard
 * at the deadline, even if that is no longer the password -- checking first
 * would mean asking to READ the clipboard, a permission this site has no
 * business requesting.
 *
 * It must also never cause a permission prompt of its own. Edge treats a
 * clipboard write with no user gesture as prompt-worthy, so the wipe fires
 * silently only where clipboard-write is already granted; everywhere else it
 * waits for the next real click or keypress, since a write under transient
 * user activation needs no permission in any engine.
 *
 * @param notify optional (message, kind) callback for the confirmation
 */
export const scheduleClipboardClear = (notify = () => {}) => {
  clearTimeout(timer)
  if (disarmGesture) disarmGesture()
  const seconds = clipboardClearSeconds()
  if (!seconds) return
  timer = setTimeout(async () => {
    const wipe = () => navigator.clipboard.writeText('')
      .then(() => notify('Clipboard cleared', 'success'))
      .catch(() => {})
    let granted = false
    try {
      const p = await navigator.permissions.query({ name: 'clipboard-write' })
      granted = p.state === 'granted'
    } catch { /* engines without a queryable clipboard-write permission */ }
    if (granted && document.hasFocus()) { wipe(); return }
    const onGesture = () => {
      disarm()
      wipe()
    }
    const disarm = () => {
      window.removeEventListener('pointerdown', onGesture, true)
      window.removeEventListener('keydown', onGesture, true)
      if (disarmGesture === disarm) disarmGesture = null
    }
    disarmGesture = disarm
    window.addEventListener('pointerdown', onGesture, true)
    window.addEventListener('keydown', onGesture, true)
  }, seconds * 1000)
}

/** The settings-panel row, so both pages offer the identical control. */
export const clipboardClearSection = () => ({
  label: 'Clear clipboard',
  options: [
    { value: 0, label: 'Keep' },
    { value: 30, label: '30s' },
    { value: 60, label: '60s' },
    { value: 120, label: '2 min' },
  ],
  get: () => clipboardClearSeconds(),
  set: (v) => {
    try { localStorage.setItem(CLIPBOARD_CLEAR_KEY, JSON.stringify(Number(v))) } catch {}
  },
})
