import test from 'node:test'
import assert from 'node:assert/strict'
import {
  base32Decode, parseOtpauth, parseTotpInput, normalizeTotp,
  totpCode, secondsRemaining, formatCode, DEFAULTS,
} from '../src/totp.js'

// TOTP is worth shipping only if the codes are right, and "right" here has a
// published answer: RFC 6238 Appendix B lists test vectors. Anything else is
// checking the implementation against itself.

// The RFC's vectors use the ASCII seed "12345678901234567890" (repeated to
// length for SHA-256 and SHA-512). Base32 of those, since that is what the
// implementation takes.
const b32 = (ascii) => {
  const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
  let bits = ''
  for (const c of ascii) bits += c.charCodeAt(0).toString(2).padStart(8, '0')
  let out = ''
  for (let i = 0; i < bits.length; i += 5) out += A[parseInt(bits.slice(i, i + 5).padEnd(5, '0'), 2)]
  return out
}
const SEED_SHA1 = b32('12345678901234567890')
const SEED_SHA256 = b32('12345678901234567890123456789012')
const SEED_SHA512 = b32('1234567890123456789012345678901234567890123456789012345678901234')

test('RFC 6238 test vectors, SHA-1', async () => {
  const cases = [
    [59, '94287082'], [1111111109, '07081804'], [1111111111, '14050471'],
    [1234567890, '89005924'], [2000000000, '69279037'], [20000000000, '65353130'],
  ]
  for (const [seconds, expected] of cases) {
    const code = await totpCode({ secret: SEED_SHA1, digits: 8, period: 30 }, seconds * 1000)
    assert.equal(code, expected, `t=${seconds}`)
  }
})

test('RFC 6238 test vectors, SHA-256 and SHA-512', async () => {
  const sha256 = [
    [59, '46119246'], [1111111109, '68084774'], [1111111111, '67062674'],
    [1234567890, '91819424'], [2000000000, '90698825'], [20000000000, '77737706'],
  ]
  for (const [seconds, expected] of sha256) {
    const code = await totpCode(
      { secret: SEED_SHA256, digits: 8, period: 30, algorithm: 'SHA256' }, seconds * 1000)
    assert.equal(code, expected, `SHA-256 t=${seconds}`)
  }

  const sha512 = [
    [59, '90693936'], [1111111109, '25091201'], [1111111111, '99943326'],
    [1234567890, '93441116'], [2000000000, '38618901'], [20000000000, '47863826'],
  ]
  for (const [seconds, expected] of sha512) {
    const code = await totpCode(
      { secret: SEED_SHA512, digits: 8, period: 30, algorithm: 'SHA512' }, seconds * 1000)
    assert.equal(code, expected, `SHA-512 t=${seconds}`)
  }
})

test('the ordinary case: six digits, thirty seconds', async () => {
  const code = await totpCode({ secret: SEED_SHA1 }, 59_000)
  assert.equal(code, '287082', 'the six-digit code is the last six of the eight-digit one')
  assert.match(code, /^\d{6}$/)
})

test('the code holds for its whole period and then changes', async () => {
  const config = { secret: SEED_SHA1, period: 30 }
  const at = (s) => totpCode(config, s * 1000)
  assert.equal(await at(30), await at(59), 'same 30-second window, same code')
  assert.notEqual(await at(59), await at(60), 'the window rolled over')
})

test('the countdown reaches the end of the window, never zero-through', () => {
  assert.equal(secondsRemaining({ secret: SEED_SHA1 }, 0), 30)
  assert.equal(secondsRemaining({ secret: SEED_SHA1 }, 1_000), 29)
  assert.equal(secondsRemaining({ secret: SEED_SHA1 }, 29_000), 1)
  assert.equal(secondsRemaining({ secret: SEED_SHA1 }, 30_000), 30)
  for (let s = 0; s < 120; s++) {
    const left = secondsRemaining({ secret: SEED_SHA1, period: 30 }, s * 1000)
    assert.ok(left >= 1 && left <= 30, `t=${s} gave ${left}`)
  }
})

// --- base32 ------------------------------------------------------------------

test('base32 decodes the RFC 4648 vectors', () => {
  const text = (b) => new TextDecoder().decode(b)
  assert.equal(text(base32Decode('MY======')), 'f')
  assert.equal(text(base32Decode('MZXQ====')), 'fo')
  assert.equal(text(base32Decode('MZXW6===')), 'foo')
  assert.equal(text(base32Decode('MZXW6YTB')), 'fooba')
  assert.equal(text(base32Decode('MZXW6YTBOI======')), 'foobar')
})

test('base32 forgives how secrets are actually presented', () => {
  // Authenticators print them in lower case, in groups of four, unpadded.
  const canonical = [...base32Decode('MZXW6YTBOI')]
  assert.deepEqual([...base32Decode('mzxw 6ytb oi')], canonical)
  assert.deepEqual([...base32Decode('MZXW-6YTB-OI')], canonical)
  assert.deepEqual([...base32Decode('MZXW6YTBOI======')], canonical)
})

test('a bad character is rejected rather than dropped', () => {
  // Dropping it silently yields a valid-looking key that is simply wrong, and
  // six plausible digits that never work is a miserable thing to debug.
  assert.throws(() => base32Decode('MZXW6YTB01'), /"0" is not a base32 character/)
  assert.throws(() => base32Decode('hello!'), /not a base32 character/)
  assert.throws(() => base32Decode(''), /empty/)
})

// --- otpauth:// ---------------------------------------------------------------

test('an otpauth link gives up its secret, issuer and account', () => {
  const c = parseOtpauth(
    `otpauth://totp/Example:jane@example.com?secret=${SEED_SHA1}&issuer=Example&digits=8&period=60&algorithm=SHA256`)
  assert.equal(c.secret, SEED_SHA1)
  assert.equal(c.issuer, 'Example')
  assert.equal(c.account, 'jane@example.com')
  assert.equal(c.digits, 8)
  assert.equal(c.period, 60)
  assert.equal(c.algorithm, 'SHA256')
})

test('an otpauth link falls back to the label for the issuer', () => {
  const c = parseOtpauth(`otpauth://totp/GitHub:octocat?secret=${SEED_SHA1}`)
  assert.equal(c.issuer, 'GitHub')
  assert.equal(c.account, 'octocat')
  assert.equal(c.digits, DEFAULTS.digits, 'unspecified parameters take the defaults')
  assert.equal(c.period, DEFAULTS.period)
})

test('a label with no issuer is just an account', () => {
  const c = parseOtpauth(`otpauth://totp/jane@example.com?secret=${SEED_SHA1}`)
  assert.equal(c.issuer, '')
  assert.equal(c.account, 'jane@example.com')
})

test('bad links fail with a reason', () => {
  assert.throws(() => parseOtpauth('https://example.com'), /not an otpauth/)
  assert.throws(() => parseOtpauth(`otpauth://hotp/x?secret=${SEED_SHA1}`), /only time-based/)
  assert.throws(() => parseOtpauth('otpauth://totp/x'), /no secret/)
  assert.throws(() => parseOtpauth('otpauth://totp/x?secret=!!!!'), /not a base32 character/)
})

test('a bare secret is accepted as well as a link', () => {
  const fromSecret = parseTotpInput(`  ${SEED_SHA1}  `)
  assert.equal(fromSecret.secret, SEED_SHA1)
  assert.equal(fromSecret.digits, DEFAULTS.digits)
  const fromUri = parseTotpInput(`otpauth://totp/a?secret=${SEED_SHA1}`)
  assert.equal(fromUri.secret, SEED_SHA1)
})

// --- normalisation -------------------------------------------------------------

test('nonsense parameters fall back rather than producing wrong codes', () => {
  const c = normalizeTotp({ secret: SEED_SHA1, digits: 99, period: -5, algorithm: 'MD5' })
  assert.equal(c.digits, DEFAULTS.digits)
  assert.equal(c.period, DEFAULTS.period)
  assert.equal(c.algorithm, DEFAULTS.algorithm)
})

test('no secret means no TOTP at all', () => {
  assert.equal(normalizeTotp(null), null)
  assert.equal(normalizeTotp({}), null)
  assert.equal(normalizeTotp({ secret: '   ' }), null)
})

test('the period is capped, so a silly value cannot freeze the code forever', () => {
  assert.equal(normalizeTotp({ secret: SEED_SHA1, period: 10 ** 9 }).period, 300)
})

test('codes are grouped for reading aloud', () => {
  assert.equal(formatCode('123456'), '123 456')
  assert.equal(formatCode('12345678'), '12345678', 'only the six-digit case splits')
})
