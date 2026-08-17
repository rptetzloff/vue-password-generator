// Time-based one-time codes (RFC 6238), for vault entries that have them.
//
// Buildable without a dependency: TOTP is HMAC over a counter, and Web Crypto
// does HMAC-SHA1/256/512. The only pieces missing from the platform are base32
// decoding and the otpauth:// URI format, both of which are small enough to
// write and read here.
//
// THE WARNING THIS FEATURE SHIPS WITH, stated once in the code as well as in
// the UI, because it is the whole reason to hesitate:
//
//   A one-time code is a *second factor* only while it is separate from the
//   first. Putting the TOTP seed in the same vault as the password collapses
//   two factors into one -- whoever opens the vault has both, and an attacker
//   who gets in needs nothing else. It is still a real gain against a password
//   leaked from the site's end, which is the common case, and it is what every
//   password manager that offers this is quietly trading. But it is a trade,
//   and someone should get to make it deliberately rather than discover it.
//
// So: offered, warned about, and never on by default.

/** RFC 4648 base32, which is how every authenticator hands out a secret. */
const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'

/**
 * Decode a base32 secret to bytes.
 *
 * Tolerant of what people actually paste: lower case, the spaces Google and
 * others insert every four characters, and missing '=' padding. Intolerant of
 * characters outside the alphabet, because silently dropping one produces a
 * key that is wrong rather than a key that is rejected -- and a wrong key
 * yields six plausible digits that never work.
 */
export const base32Decode = (input) => {
  const clean = String(input).toUpperCase().replace(/[\s-]/g, '').replace(/=+$/, '')
  if (!clean) throw new Error('the secret is empty')
  const bad = [...clean].find((c) => !BASE32.includes(c))
  if (bad) throw new Error(`"${bad}" is not a base32 character`)

  let bits = 0
  let value = 0
  const out = []
  for (const char of clean) {
    value = (value << 5) | BASE32.indexOf(char)
    bits += 5
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff)
      bits -= 8
    }
  }
  if (!out.length) throw new Error('the secret is too short')
  return new Uint8Array(out)
}

export const DEFAULTS = { digits: 6, period: 30, algorithm: 'SHA1' }
const HASHES = { SHA1: 'SHA-1', SHA256: 'SHA-256', SHA512: 'SHA-512' }

/** Normalise whatever was stored or parsed into a usable configuration. */
export const normalizeTotp = (raw) => {
  if (!raw || typeof raw !== 'object') return null
  const secret = typeof raw.secret === 'string' ? raw.secret.trim() : ''
  if (!secret) return null
  const digits = [6, 7, 8].includes(Number(raw.digits)) ? Number(raw.digits) : DEFAULTS.digits
  const period = Number(raw.period) > 0 ? Math.min(Number(raw.period), 300) : DEFAULTS.period
  const algorithm = Object.hasOwn(HASHES, String(raw.algorithm || '').toUpperCase())
    ? String(raw.algorithm).toUpperCase()
    : DEFAULTS.algorithm
  return {
    secret,
    digits,
    period,
    algorithm,
    issuer: typeof raw.issuer === 'string' ? raw.issuer.slice(0, 100) : '',
    account: typeof raw.account === 'string' ? raw.account.slice(0, 200) : '',
  }
}

/**
 * Parse an otpauth:// URI, which is what a QR code contains.
 *
 * Pasting the URI is offered because the alternative is transcribing a base32
 * secret by hand, and a single wrong character there produces codes that are
 * confidently wrong.
 */
export const parseOtpauth = (uri) => {
  const text = String(uri).trim()
  if (!/^otpauth:\/\//i.test(text)) throw new Error('not an otpauth:// link')
  let url
  try { url = new URL(text) } catch { throw new Error('that otpauth link is malformed') }

  const kind = url.host.toLowerCase()
  if (kind && kind !== 'totp') {
    throw new Error(`${kind} codes are not supported — only time-based (totp) ones`)
  }
  const params = url.searchParams
  const secret = params.get('secret')
  if (!secret) throw new Error('that link carries no secret')
  base32Decode(secret)   // reject a bad secret here, not at first display

  // The label is "Issuer:account" or just "account"; the issuer parameter
  // wins when both are present, which is what the spec recommends.
  const label = decodeURIComponent(url.pathname.replace(/^\//, ''))
  const [labelIssuer, labelAccount] = label.includes(':')
    ? [label.slice(0, label.indexOf(':')), label.slice(label.indexOf(':') + 1)]
    : ['', label]

  return normalizeTotp({
    secret,
    digits: params.get('digits'),
    period: params.get('period'),
    algorithm: params.get('algorithm'),
    issuer: params.get('issuer') || labelIssuer,
    account: labelAccount.trim(),
  })
}

/** Accepts either an otpauth:// URI or a bare base32 secret. */
export const parseTotpInput = (input) => {
  const text = String(input).trim()
  if (/^otpauth:/i.test(text)) return parseOtpauth(text)
  base32Decode(text)
  return normalizeTotp({ secret: text })
}

/** The 8-byte big-endian counter RFC 4226 signs: seconds since epoch / period. */
const counterBytes = (counter) => {
  const buf = new ArrayBuffer(8)
  const view = new DataView(buf)
  view.setUint32(0, Math.floor(counter / 2 ** 32))
  view.setUint32(4, counter >>> 0)
  return buf
}

/**
 * The code for a given moment.
 *
 * @param config from normalizeTotp/parseTotpInput
 * @param atMs   the time to compute for, injectable so the tests can use the
 *               RFC's published vectors rather than whatever now happens to be
 */
export const totpCode = async (config, atMs = Date.now()) => {
  const { secret, digits, period, algorithm } = normalizeTotp(config) || {}
  if (!secret) throw new Error('no TOTP secret')

  const key = await crypto.subtle.importKey(
    'raw',
    base32Decode(secret),
    { name: 'HMAC', hash: HASHES[algorithm] },
    false,
    ['sign'],
  )
  const counter = Math.floor(atMs / 1000 / period)
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, counterBytes(counter)))

  // Dynamic truncation, RFC 4226 section 5.3: the low nibble of the last byte
  // picks where in the digest to read the code from.
  const offset = mac[mac.length - 1] & 0x0f
  const binary = ((mac[offset] & 0x7f) << 24)
    | ((mac[offset + 1] & 0xff) << 16)
    | ((mac[offset + 2] & 0xff) << 8)
    | (mac[offset + 3] & 0xff)

  return String(binary % 10 ** digits).padStart(digits, '0')
}

/** Seconds until the current code expires, for the countdown. */
export const secondsRemaining = (config, atMs = Date.now()) => {
  const { period } = normalizeTotp(config) || DEFAULTS
  return period - Math.floor(atMs / 1000) % period
}

/** Codes are read aloud and typed in pairs, so they are shown in pairs. */
export const formatCode = (code) =>
  (code.length === 6 ? `${code.slice(0, 3)} ${code.slice(3)}` : code)
