// The accent palettes offered in Settings.
//
// A palette changes the accent family only -- the primary, its hover and focus
// forms, the tint behind focused inputs, and the page gradient. It deliberately
// does *not* touch:
//
//   - the status colours (success / warning / error), which carry meaning
//   - the change-group colours, which are tuned for separation under colour
//     vision deficiency (see tokens.css)
//   - the badge families used by the docs and the word slots
//
// Keeping those fixed is what makes `cvdSafe` below a claim about one colour
// rather than about the whole interface, and therefore a claim that can be
// checked.
//
// `cvdSafe` records whether the accent stays clearly distinct from all three
// status colours under normal, protan, deutan and tritan vision, in both
// themes. The threshold is CIEDE2000 >= 10, below which two colours are easy
// to confuse when they are not side by side.
//
// These flags are not decoration and are not taken on trust:
// test/colour-vision.test.js recomputes each one from tokens.css and fails if
// the recorded value disagrees. Change a palette's colours and the test tells
// you the flag is now wrong rather than letting the UI quietly lie.
//
// Amber was evaluated and dropped rather than shipped with a warning: the
// accent came out at CIEDE2000 0.0 from --warning, because it *is* the warning
// colour. A theme indistinguishable from an alert state is not a theme.

export const PALETTE_KEY = 'global.palette'

export const PALETTES = [
  { value: 'sky', label: 'Sky', cvdSafe: false },
  { value: 'blue', label: 'Blue', cvdSafe: true },
  { value: 'indigo', label: 'Indigo', cvdSafe: true },
  { value: 'violet', label: 'Violet', cvdSafe: true },
  { value: 'fuchsia', label: 'Fuchsia', cvdSafe: false },
  { value: 'rose', label: 'Rose', cvdSafe: false },
  { value: 'emerald', label: 'Emerald', cvdSafe: false },
  { value: 'teal', label: 'Teal', cvdSafe: false },
  { value: 'slate', label: 'Slate', cvdSafe: true },
  { value: 'mono', label: 'Mono', cvdSafe: true, monochrome: true },
]

/** 'sky' is the bare :root, so it is the fallback for anything unrecognised. */
export const DEFAULT_PALETTE = 'sky'

export const PALETTE_VALUES = PALETTES.map((p) => p.value)

export const resolvePalette = (value) =>
  PALETTE_VALUES.includes(value) ? value : DEFAULT_PALETTE

export const paletteInfo = (value) =>
  PALETTES.find((p) => p.value === resolvePalette(value))
