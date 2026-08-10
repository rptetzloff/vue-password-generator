// Color maths shared by the contrast and color-vision tests.
//
// Not part of the shipped app -- this is measurement tooling. It exists because
// "does this palette work for color-blind users?" was previously answered by
// eye, and eye was wrong: the old dark-theme change-group colors contained a
// pair that a protanope sees as literally the same color (CIEDE2000 of 1.1,
// where 2.3 is the threshold of noticing any difference at all).

/** '#rrggbb' -> [r, g, b] in 0..1, gamma-encoded. */
export const hex = (h) => {
  const m = /^#([0-9a-f]{6})$/i.exec(h.trim())
  if (!m) throw new Error(`expected a 6-digit hex color, got ${JSON.stringify(h)}`)
  return [0, 2, 4].map((i) => parseInt(m[1].substr(i, 2), 16) / 255)
}

const toLinear = (v) => (v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4))

/** '#rrggbb' -> linear-light sRGB. */
export const lin = (h) => hex(h).map(toLinear)

/** WCAG relative luminance, which wants gamma-encoded input. */
export const luminance = (h) => {
  const [r, g, b] = lin(h)
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

/** WCAG contrast ratio between two hex colors. */
export const contrast = (a, b) => {
  const l1 = luminance(a)
  const l2 = luminance(b)
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05)
}

// Machado, Oliveira & Fernandes (2009), severity 1.0. Applied to linear sRGB.
// These cover all three dichromacies in one form, which is why they are used
// here in preference to the Viénot matrices: protanopia and deuteranopia are
// the common cases, but tritanopia should not be silently skipped.
export const CVD = {
  protan: [[0.152286, 1.052583, -0.204868], [0.114503, 0.786281, 0.099216], [-0.003882, -0.048116, 1.051998]],
  deutan: [[0.367322, 0.860646, -0.227968], [0.280085, 0.672501, 0.047413], [-0.011820, 0.042940, 0.968881]],
  tritan: [[1.255528, -0.076749, -0.178779], [-0.078411, 0.930809, 0.147602], [0.004733, 0.691367, 0.303900]],
}

export const VISIONS = ['normal', 'protan', 'deutan', 'tritan']

const applyMatrix = (M, c) =>
  M.map((row) => Math.min(1, Math.max(0, row[0] * c[0] + row[1] * c[1] + row[2] * c[2])))

/** Linear sRGB -> CIE Lab (D65). */
export const lab = (c) => {
  const X = 0.4124564 * c[0] + 0.3575761 * c[1] + 0.1804375 * c[2]
  const Y = 0.2126729 * c[0] + 0.7151522 * c[1] + 0.0721750 * c[2]
  const Z = 0.0193339 * c[0] + 0.1191920 * c[1] + 0.9503041 * c[2]
  const f = (t) => (t > 216 / 24389 ? Math.cbrt(t) : ((24389 / 27) * t + 16) / 116)
  const fx = f(X / 0.95047)
  const fy = f(Y)
  const fz = f(Z / 1.08883)
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)]
}

/** A hex color as Lab, optionally as seen with a color-vision deficiency. */
export const seenAs = (h, vision) => {
  const c = lin(h)
  return lab(vision === 'normal' ? c : applyMatrix(CVD[vision], c))
}

/**
 * CIEDE2000 difference between two Lab colors.
 *
 * Plain Euclidean distance in Lab badly misjudges saturated blues, which is
 * most of this palette. Roughly: 1 is the smallest difference anyone can see,
 * 2.3 is the usual "just noticeable" threshold, and anything under about 10 is
 * easy to confuse when the two colors are not side by side.
 */
export const ciede2000 = ([L1, a1, b1], [L2, a2, b2]) => {
  const rad = (d) => (d * Math.PI) / 180
  const deg = (r) => (r * 180) / Math.PI
  const pow7 = (x) => Math.pow(x, 7)

  const C1 = Math.hypot(a1, b1)
  const C2 = Math.hypot(a2, b2)
  const Cbar = (C1 + C2) / 2
  const G = 0.5 * (1 - Math.sqrt(pow7(Cbar) / (pow7(Cbar) + pow7(25))))

  const ap1 = (1 + G) * a1
  const ap2 = (1 + G) * a2
  const Cp1 = Math.hypot(ap1, b1)
  const Cp2 = Math.hypot(ap2, b2)

  const hue = (b, ap) => {
    if (b === 0 && ap === 0) return 0
    const h = deg(Math.atan2(b, ap))
    return h < 0 ? h + 360 : h
  }
  const hp1 = hue(b1, ap1)
  const hp2 = hue(b2, ap2)

  const dLp = L2 - L1
  const dCp = Cp2 - Cp1
  let dhp = 0
  if (Cp1 * Cp2 !== 0) {
    dhp = hp2 - hp1
    if (dhp > 180) dhp -= 360
    else if (dhp < -180) dhp += 360
  }
  const dHp = 2 * Math.sqrt(Cp1 * Cp2) * Math.sin(rad(dhp) / 2)

  const Lbp = (L1 + L2) / 2
  const Cbp = (Cp1 + Cp2) / 2
  let hbp = hp1 + hp2
  if (Cp1 * Cp2 !== 0) {
    if (Math.abs(hp1 - hp2) > 180) hbp += hbp < 360 ? 360 : -360
    hbp /= 2
  }

  const T =
    1 -
    0.17 * Math.cos(rad(hbp - 30)) +
    0.24 * Math.cos(rad(2 * hbp)) +
    0.32 * Math.cos(rad(3 * hbp + 6)) -
    0.2 * Math.cos(rad(4 * hbp - 63))

  const dTheta = 30 * Math.exp(-Math.pow((hbp - 275) / 25, 2))
  const Rc = 2 * Math.sqrt(pow7(Cbp) / (pow7(Cbp) + pow7(25)))
  const Sl = 1 + (0.015 * Math.pow(Lbp - 50, 2)) / Math.sqrt(20 + Math.pow(Lbp - 50, 2))
  const Sc = 1 + 0.045 * Cbp
  const Sh = 1 + 0.015 * Cbp * T
  const Rt = -Math.sin(rad(2 * dTheta)) * Rc

  return Math.sqrt(
    Math.pow(dLp / Sl, 2) +
      Math.pow(dCp / Sc, 2) +
      Math.pow(dHp / Sh, 2) +
      Rt * (dCp / Sc) * (dHp / Sh),
  )
}

/**
 * The closest pair in a set of hex colors, as that vision type sees it.
 * Returns { delta, a, b } using the supplied labels.
 */
export const closestPair = (colors, labels, vision) => {
  const seen = colors.map((c) => seenAs(c, vision))
  let best = { delta: Infinity, a: null, b: null }
  for (let i = 0; i < colors.length; i++) {
    for (let j = i + 1; j < colors.length; j++) {
      const delta = ciede2000(seen[i], seen[j])
      if (delta < best.delta) best = { delta, a: labels[i], b: labels[j] }
    }
  }
  return best
}
