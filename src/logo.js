// The site mark, as inline SVG so it can follow the theme.
//
// It used to be loaded with <img src="...svg">. An SVG referenced that way is
// an isolated document: it cannot see data-theme on the page, and CSS variables
// and currentColor do not reach it. Inlining is what makes a theme-aware mark
// possible at all.
//
// The artwork only ever used two colours -- a tile blue and white -- so they map
// onto --primary and --on-primary. Those are already verified to contrast in
// both themes (5.93 light, 6.48 dark), which means the key stays legible against
// its tile for free.
//
// Colours are applied by class in site-header.css rather than by attribute:
// var() inside a presentation attribute is not reliably supported.

const PATHS = `
  <path class="logo-tile" d="M540,100L540,380C540,413.115 513.115,440 480,440L200,440C166.885,440 140,413.115 140,380L140,100C140,66.885 166.885,40 200,40L480,40C513.115,40 540,66.885 540,100Z"/>
  <circle class="logo-ink" cx="270" cy="222" r="54"/>
  <path class="logo-ink" d="M270,209L452,209C459.132,209 465,214.868 465,222C465,229.132 459.132,235 452,235L270,235L270,209Z"/>
  <path class="logo-ink" d="M346,239L346,263C346,265.208 344.208,267 342,267L332,267C329.792,267 328,265.208 328,263L328,239C328,236.792 329.792,235 332,235L342,235C344.208,235 346,236.792 346,239Z"/>
  <path class="logo-ink" d="M380,239L380,254C380,256.208 378.208,258 376,258L366,258C363.792,258 362,256.208 362,254L362,239C362,236.792 363.792,235 366,235L376,235C378.208,235 380,236.792 380,239Z"/>
  <path class="logo-ink" d="M414,239L414,267C414,269.208 412.208,271 410,271L400,271C397.792,271 396,269.208 396,267L396,239C396,236.792 397.792,235 400,235L410,235C412.208,235 414,236.792 414,239Z"/>
  <circle class="logo-tile" cx="270" cy="222" r="30"/>
  <path class="logo-outline" d="M420,365C420,375.486 411.486,384 401,384L239,384C228.514,384 220,375.486 220,365C220,354.514 228.514,346 239,346L401,346C411.486,346 420,354.514 420,365Z"/>
  ${[259, 284, 309, 334, 359, 384, 409]
    .map((cx) => `<circle class="logo-ink-soft" cx="${cx}" cy="365" r="6.5"/>`)
    .join('\n  ')}
`

/**
 * The mark as an <svg> element.
 * Decorative: the site title sits next to it, so it is hidden from assistive
 * technology rather than given a redundant label.
 */
export const createLogo = (className = 'site-logo') => {
  const wrap = document.createElement('div')
  // The asterisk sits in the key head. In the original it carried its own
  // transform rather than the -140,-40 offset the shapes share, so it stays
  // outside that group at the equivalent absolute position (130 - 6.616, 182).
  wrap.innerHTML = `
    <svg class="${className}" viewBox="0 0 400 400" xmlns="http://www.w3.org/2000/svg"
         aria-hidden="true" focusable="false">
      <g transform="translate(-140,-40)">${PATHS}</g>
      <text class="logo-ink" x="123.384" y="182"
            font-family="Arial-BoldMT, Arial, sans-serif" font-weight="700" font-size="34">*</text>
    </svg>`.trim()
  return wrap.firstElementChild
}
