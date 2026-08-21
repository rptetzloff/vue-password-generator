// Generator input and output: the two places generation touches a browser.
//
// Split out of generators.js when core/ was carved from src/. The generation
// itself is arithmetic over its arguments and moved; these did not, because
// one reads localStorage and the others fetch over HTTP.
//
// Injecting them into core/ instead was considered and rejected: a default
// parameter of `localStorage` inside core/ is the same coupling with a longer
// name, and it would defeat the test that asserts core/ names no browser
// global.

import { MODES, DEFAULTS, ALL_SYMBOLS } from '../core/generate/generators.js'

// --- settings ----------------------------------------------------------------

const readStored = (key, fallback) => {
  try {
    const raw = localStorage.getItem(key)
    if (raw === null) return fallback
    const parsed = JSON.parse(raw)
    if (Array.isArray(fallback) && Array.isArray(parsed)) return parsed
    return parsed
  } catch {
    return fallback
  }
}

/**
 * A mode's settings as the user last left them on the generator page.
 *
 * Reads the same localStorage keys main.js writes, so the vault's Generate
 * button produces what that mode's tab would produce right now -- which is
 * the whole point of picking a mode rather than offering a second, separate
 * set of options nobody would keep in sync.
 *
 * Set-valued settings are stored as arrays by main.js's saveSetting and come
 * back as Sets here, because that is what the generation code expects.
 */
export const readSettings = (modeId) => {
  const mode = MODES.find((m) => m.id === modeId)
  if (!mode) throw new Error(`unknown generator mode: ${modeId}`)
  const defaults = DEFAULTS[modeId]
  const out = {}
  for (const [name, fallback] of Object.entries(defaults)) {
    out[name] = readStored(`${mode.prefix}.${name}`, fallback)
  }
  // The two Set-valued settings, whose defaults are "everything".
  if (modeId === 'advanced') {
    const stored = readStored('adv.activeSymbols', null)
    out.activeSymbols = new Set(Array.isArray(stored) ? stored : ALL_SYMBOLS)
  }
  if (Object.hasOwn(defaults, 'activeLeet')) {
    const stored = readStored(`${mode.prefix}.activeLeet`, null)
    out.activeLeet = new Set(Array.isArray(stored) ? stored : [])
  }
  return out
}

// --- word data ---------------------------------------------------------------

let wordListCache = null
let wordDataCache = null

/** The 17,576-word Orchard Street Long list used by Words. */
export const loadWordList = async () => {
  if (wordListCache) return wordListCache
  const response = await fetch('/data/orchard-street-long.txt')
  const text = await response.text()
  wordListCache = text.split(/\r?\n/).map((w) => w.trim()).filter(Boolean)
  return wordListCache
}

/** The categorised slot vocabulary used by Passphrase, Wireless and Mad Lib. */
export const loadWordData = async () => {
  if (wordDataCache) return wordDataCache
  const res = await fetch('/data/words.json')
  wordDataCache = await res.json()
  return wordDataCache
}

/** Everything a mode needs, fetched once. */
export const loadData = async (modeId) => {
  if (modeId === 'words') return { wordList: await loadWordList(), wordData: null }
  if (['passphrase', 'wireless', 'madlib'].includes(modeId)) {
    return { wordList: null, wordData: await loadWordData() }
  }
  return { wordList: null, wordData: null }
}
