/**
 * The PLU file of the Rongta scales (RTPLU, "File → Save/Open", .TXP): one PLU on each line, the fields
 * separated by tabs, CRLF at the end of each line, plain ASCII. The fields, as RTPLU names them:
 *   0 hotkey · 1 PLU name · 2 LF code (the PLU in the barcode) · 3 code · 4 barcode type · 5 unit price × 100
 *   6 weight unit (4 = kg, 9 = pcs) · 7 department · 8 tare · 9 shelf time · 10 package type · 11 package weight
 *   12 tolerance % · 13 message 1 · 14 message 2 · 15 label · 16 discount · … (25 fields in RTPLU 2024)
 * DrisPRO changes only the price (and, if asked, the name) of the lines it knows, and adds the PLUs the file
 * does not have; every other field is written back as it was read.
 */

export type TxpLine = { fields: string[]; hotkey: number; name: string; lf: string; price: number; unit: string }

/** a fresh line, as RTPLU writes one for a new item sold by weight */
const BLANK = ['0', '', '0', '0', '7', '0', '4', '25', ' 0.000', '0', '0', ' 0.000', '5', '0', '0', '0', '0', '0', '0', '', '0', '0', '0', '0.0', '0.00']

export function parseTxp(text: string): TxpLine[] {
  return text.split(/\r?\n/).filter((l) => l.trim() !== '').map((l) => {
    const f = l.split('\t')
    return { fields: f, hotkey: Number(f[0]) || 0, name: (f[1] ?? '').trim(), lf: String(Number(f[2]) || 0), price: (Number(f[5]) || 0) / 100, unit: f[6] ?? '' }
  })
}

/** a file RTPLU wrote: tab-separated lines, with a name, an LF code and a whole-number price where they belong */
export function looksLikeTxp(lines: TxpLine[]) {
  const used = lines.filter((l) => l.name && l.lf !== '0')
  return used.length > 0 && lines.every((l) => l.fields.length >= 8) && used.every((l) => /^\d+$/.test((l.fields[5] ?? '').trim()))
}

/** what the scale can show: capitals without ë and ç, at most 36 characters */
export function scaleName(name: string) {
  return name.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\x20-\x7e]/g, '').replace(/\s+/g, ' ').trim().toUpperCase().slice(0, 36)
}

/** the same name on the scale and in DrisPRO, whatever the case, the ë or the spaces */
export const nameKey = (s: string) => scaleName(s).replace(/[^A-Z0-9]/g, '')

const cents = (price: number) => String(Math.round(price * 100))

export function withPrice(line: TxpLine, price: number, name?: string): TxpLine {
  const fields = [...line.fields]
  fields[5] = cents(price)
  if (name !== undefined) fields[1] = scaleName(name)
  return { ...line, fields, price: Math.round(price * 100) / 100, name: name !== undefined ? scaleName(name) : line.name }
}

/** a line for a PLU the file does not have yet: like the first line of the file, without its hotkey */
export function newLine(template: TxpLine | undefined, plu: string, name: string, price: number, byPiece: boolean): TxpLine {
  const fields = [...(template?.fields ?? BLANK)]
  while (fields.length < BLANK.length) fields.push(BLANK[fields.length]!)
  fields[0] = '0'
  fields[1] = scaleName(name)
  fields[2] = plu
  fields[3] = plu
  fields[5] = cents(price)
  if (byPiece) fields[6] = '9'
  else if (template?.fields[6] === '9' || !template) fields[6] = '4'
  return { fields, hotkey: 0, name: fields[1], lf: plu, price: Math.round(price * 100) / 100, unit: fields[6]! }
}

export function writeTxp(lines: TxpLine[]) {
  return lines.map((l) => l.fields.join('\t')).join('\r\n') + '\r\n'
}
