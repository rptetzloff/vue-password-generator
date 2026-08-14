// Getting the vault out, and back in again (ROADMAP 9b).
//
// Three formats, and the differences between them are the whole design:
//
//   backup    .json, the sealed envelope verbatim. Encrypted, restores
//             exactly, and is the file to keep. Opening it needs the
//             passphrase it was sealed with, which may not be the one the
//             vault on this device uses.
//   plain     .json, decrypted. For moving to a different tool, or for
//             reading with your own eyes. Secrets in the clear.
//   csv       the format every other password manager imports. Also in the
//             clear, and lossy: security questions do not survive it.
//
// A note on the reversal: the roadmap's 9b said plainly that "plain-text
// export is not offered", on the grounds that a CSV of passwords is the
// format every manager regrets supporting. That was written when the vault
// was a notebook. Now that it stores logins people depend on, refusing any
// exit but "another copy of WordLock" is lock-in, and lock-in is the worse
// failure -- an escape hatch you cannot use is not an escape hatch. So the
// clear formats exist, behind an explicit confirmation rather than a button
// you can hit by accident, and they say what they are.

export const TRANSFER_VERSION = 1

/** Fields a CSV can carry, in the order the common managers expect them. */
const CSV_COLUMNS = ['folder', 'name', 'url', 'username', 'password', 'note']

const csvEscape = (value) => {
  const s = value == null ? '' : String(value)
  // Quote when the value could otherwise break the row -- and always escape
  // a leading =, +, - or @, which spreadsheets treat as a formula.
  const risky = /^[=+\-@\t\r]/.test(s)
  const body = risky ? `'${s}` : s
  return /[",\n\r]/.test(body) ? `"${body.replace(/"/g, '""')}"` : body
}

/** RFC 4180-ish parser: handles quotes, embedded commas and newlines. */
export const parseCsv = (input) => {
  const rows = []
  let row = []
  let field = ''
  let quoted = false
  const text = String(input).replace(/\r\n?/g, '\n')
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++ } else quoted = false
      } else field += c
    } else if (c === '"') quoted = true
    else if (c === ',') { row.push(field); field = '' }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = '' }
    else field += c
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row) }
  return rows.filter((r) => r.some((cell) => cell !== ''))
}

// --- exporting ---------------------------------------------------------------

/** The sealed envelope, as a file. Encrypted; safe to keep anywhere. */
export const exportBackup = (envelope) => JSON.stringify({
  format: 'wordlock-vault-backup',
  version: TRANSFER_VERSION,
  exportedAt: new Date().toISOString().slice(0, 10),
  note: 'Encrypted. Restoring this needs the passphrase it was created with.',
  vault: envelope,
}, null, 2)

/** Everything, decrypted, as JSON. Secrets in the clear -- say so in the file. */
export const exportPlainJson = (entries) => JSON.stringify({
  format: 'wordlock-vault-plain',
  version: TRANSFER_VERSION,
  exportedAt: new Date().toISOString().slice(0, 10),
  warning: 'These passwords are NOT encrypted. Delete this file once you have finished with it.',
  entries,
}, null, 2)

/**
 * CSV for other managers. Lossy on purpose rather than by accident: a row is
 * flat, so only the first URL survives and security questions are folded into
 * the note, where a human will at least find them.
 */
export const exportCsv = (entries) => {
  const lines = [CSV_COLUMNS.join(',')]
  for (const e of entries) {
    // A row is flat, so anything that is a list has to fold into the note.
    // Losing it silently would be worse than putting it somewhere a human
    // can find it, which is the whole reason CSV is labelled lossy.
    const extras = [
      ...(e.fields || []).map((f) => `${f.name || 'Field'}: ${f.value}`),
      ...(e.questions || []).map((qa) => `${qa.q}: ${qa.a}`),
    ]
    const note = [e.note, ...extras].filter(Boolean).join(' | ')
    lines.push([
      csvEscape(e.group),
      csvEscape(e.label),
      csvEscape(((e.urls || [])[0] || {}).url || ''),
      csvEscape(e.username),
      csvEscape(e.pw),
      csvEscape(note),
    ].join(','))
  }
  return lines.join('\n') + '\n'
}

// --- importing ---------------------------------------------------------------

const HEADER_ALIASES = {
  name: ['name', 'title', 'account', 'item', 'label', 'site'],
  url: ['url', 'urls', 'website', 'web site', 'login_uri', 'uri', 'link'],
  username: ['username', 'user', 'login', 'login_username', 'email', 'user name'],
  password: ['password', 'pass', 'login_password', 'pwd'],
  note: ['note', 'notes', 'comment', 'comments', 'extra'],
  // Every manager calls this something different, and all of them have one.
  folder: ['folder', 'group', 'grouping', 'category', 'collection', 'type'],
}

/** Map a foreign CSV header row onto our fields, or null where it has none. */
export const mapCsvHeaders = (header) => {
  const norm = header.map((h) => String(h).trim().toLowerCase().replace(/^"|"$/g, ''))
  const index = {}
  for (const [field, aliases] of Object.entries(HEADER_ALIASES)) {
    index[field] = norm.findIndex((h) => aliases.includes(h))
  }
  return index
}

/**
 * Work out what a file is and pull entries out of it.
 *
 * Returns { kind, entries } for anything readable without a passphrase, or
 * { kind: 'backup', envelope } for a sealed one, which the caller must open
 * separately -- this module never sees a passphrase.
 */
export const parseTransfer = (text) => {
  const trimmed = String(text).trim()
  if (!trimmed) throw new Error('the file is empty')

  if (trimmed.startsWith('{')) {
    let data
    try { data = JSON.parse(trimmed) } catch { throw new Error('that file is not valid JSON') }

    if (data.format === 'wordlock-vault-backup' && data.vault) {
      return { kind: 'backup', envelope: data.vault }
    }
    if (Array.isArray(data.entries)) {
      return { kind: 'plain', entries: data.entries }
    }
    // A bare sealed envelope, in case someone saved just that.
    if (data.v && data.kdf && data.ct) return { kind: 'backup', envelope: data }
    throw new Error('that JSON file is not a WordLock export')
  }

  const rows = parseCsv(trimmed)
  if (rows.length < 2) throw new Error('that CSV has no rows to import')
  const index = mapCsvHeaders(rows[0])
  if (index.password === -1) {
    throw new Error('that CSV has no password column, so there is nothing to import')
  }
  const at = (row, field) => (index[field] >= 0 ? (row[index[field]] || '').trim() : '')
  const entries = rows.slice(1).map((row) => ({
    group: at(row, 'folder'),
    label: at(row, 'name'),
    username: at(row, 'username'),
    pw: at(row, 'password'),
    urls: at(row, 'url') ? [at(row, 'url')] : [],
    note: at(row, 'note'),
  })).filter((e) => e.pw)
  if (!entries.length) throw new Error('no rows in that CSV had a password')
  return { kind: 'csv', entries }
}

/**
 * A collision-free key for the (password, label) pair.
 *
 * Joining with a plain separator would make ("a b", "c") and ("a", "b c")
 * the same key, which merges two unrelated entries into one and loses the
 * second. JSON of the pair cannot collide, and unlike the delimiter this
 * originally used -- a literal NUL byte typed into the source -- it leaves
 * the file readable as text. See transfer.test.js.
 */
const pairKey = (pw, label) => JSON.stringify([pw, label])

/**
 * Merge imported entries into what is already there.
 *
 * Merging rather than replacing, because importing an old backup must never
 * silently delete newer work. Identity is the entry id where both sides have
 * one, and otherwise the password paired with its label -- two different
 * accounts can share a password, and one account's password can change, so
 * neither alone is enough.
 *
 * Existing entries win on conflict: what is in front of you is more likely to
 * be current than what is in a file you are restoring.
 */
export const mergeEntries = (existing, incoming) => {
  const byId = new Map(existing.map((e) => [e.id, e]))
  const byPair = new Map(existing.map((e) => [pairKey(e.pw, e.label), e]))
  const added = []
  let skipped = 0

  for (const entry of incoming) {
    const idHit = entry.id && byId.has(entry.id)
    const pairHit = byPair.has(pairKey(entry.pw, entry.label || ''))
    if (idHit || pairHit) { skipped++; continue }
    added.push(entry)
    if (entry.id) byId.set(entry.id, entry)
    byPair.set(pairKey(entry.pw, entry.label || ''), entry)
  }

  return { merged: [...added, ...existing], added: added.length, skipped }
}

/** Suggested filename, dated so successive backups do not overwrite. */
export const transferFilename = (kind, date = new Date().toISOString().slice(0, 10)) => ({
  backup: `wordlock-vault-${date}.json`,
  plain: `wordlock-vault-PLAINTEXT-${date}.json`,
  csv: `wordlock-vault-PLAINTEXT-${date}.csv`,
}[kind])
