import { PAGES } from '../../ui/site-nav.js'

/**
 * Every page file, derived from the nav manifest rather than listed by hand.
 *
 * Three test files each kept their own copy of this list, and adding
 * vault.html meant remembering all three -- exactly the drift the PALETTES
 * manifest was introduced to stop. A page that exists but is not in PAGES is
 * unreachable from the site's only navigation, which site-nav.test.js already
 * treats as a bug, so the manifest is the right source of truth.
 */
// `file` wins where a page's authored name differs from its served path --
// two pages are served at '/' now, one per host, so deriving the filename
// from the href alone would name index.html twice and never mention
// home.html.
export const PAGE_FILES = PAGES.map((p) =>
  p.file ?? (p.href === '/' ? 'index.html' : p.href.replace(/^\//, '')))
