/**
 * Bank statement files as e-banking gives them, read in the browser:
 *   CAMT.053 / CAMT.052 (ISO 20022 XML), MT940 (SWIFT text), Excel (.xlsx) and CSV with headers
 *   in Albanian or English. The amount is positive for money in, negative for money out.
 */
import { parseCsv, parseFile, excelDate } from '@/features/settings/lib/parse-file'

export type BankLine = { transaction_date: string; description: string; amount: number; reference: string | null; counterparty_name: string | null; counterparty_iban: string | null }
export type BankFile = { format: 'camt' | 'mt940' | 'table'; lines: BankLine[]; opening: number | null; closing: number | null; date: string | null; reference: string | null; iban: string | null; errors: number[] }

const clean = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim()
const round2 = (n: number) => Math.round(n * 100) / 100

export function parseAmount(s: string) {
  let v = String(s ?? '').replace(/[\s ']/g, '').replace(/[^\d,.\-+()]/g, '')
  const neg = /^\(.*\)$/.test(v) || /-$/.test(v); v = v.replace(/[()]/g, '').replace(/-$/, '')
  if (v.includes(',') && v.includes('.')) v = v.lastIndexOf(',') > v.lastIndexOf('.') ? v.replace(/\./g, '').replace(',', '.') : v.replace(/,/g, '')
  else if (v.includes(',')) v = /,\d{1,2}$/.test(v) ? v.replace(',', '.') : v.replace(/,/g, '')
  const n = Number(v)
  return Number.isFinite(n) ? (neg ? -Math.abs(n) : n) : NaN
}
export function parseDate(s: string) {
  const v = String(s ?? '').trim()
  if (/^\d{5}(\.\d+)?$/.test(v)) return excelDate(v)
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(v)
  if (m) return `${m[1]}-${m[2]!.padStart(2, '0')}-${m[3]!.padStart(2, '0')}`
  m = /^(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})/.exec(v)
  if (m) { const y = m[3]!.length === 2 ? `20${m[3]}` : m[3]; return `${y}-${m[2]!.padStart(2, '0')}-${m[1]!.padStart(2, '0')}` }
  m = /^(\d{4})(\d{2})(\d{2})$/.exec(v)
  if (m) return `${m[1]}-${m[2]}-${m[3]}`
  return null
}

/* ------------------------------------------------------------------ CAMT.053 / 052 */
export function parseCamt(xml: string): BankFile {
  const doc = new DOMParser().parseFromString(xml, 'application/xml')
  const all = (el: Element | Document, name: string) => Array.from(el.getElementsByTagNameNS('*', name))
  const one = (el: Element | Document | undefined | null, path: string): Element | undefined => {
    let cur: Element | Document | undefined = el ?? undefined
    for (const p of path.split('/')) { if (!cur) return undefined; cur = all(cur, p)[0] }
    return cur as Element | undefined
  }
  const txt = (el: Element | Document | undefined | null, path: string) => clean(one(el, path)?.textContent)
  const stmt = all(doc, 'Stmt')[0] ?? all(doc, 'Rpt')[0]
  if (!stmt) throw new Error('No statement in this XML file')
  const bal = (code: string) => {
    const b = all(stmt, 'Bal').find((x) => txt(x, 'Tp/CdOrPrtry/Cd') === code)
    if (!b) return null
    const a = parseAmount(txt(b, 'Amt'))
    return round2(txt(b, 'CdtDbtInd') === 'DBIT' ? -a : a)
  }
  const lines: BankLine[] = []
  for (const n of all(stmt, 'Ntry')) {
    if (txt(n, 'Sts') && !/BOOK/i.test(txt(n, 'Sts'))) continue
    const credit = txt(n, 'CdtDbtInd') === 'CRDT'
    const amount = round2(parseAmount(txt(n, 'Amt')) * (credit ? 1 : -1))
    const tx = one(n, 'TxDtls')
    const party = credit ? (one(tx, 'RltdPties/Dbtr') ?? one(tx, 'RltdPties/UltmtDbtr')) : (one(tx, 'RltdPties/Cdtr') ?? one(tx, 'RltdPties/UltmtCdtr'))
    const acct = credit ? one(tx, 'RltdPties/DbtrAcct') : one(tx, 'RltdPties/CdtrAcct')
    const ustrd = all(tx ?? n, 'Ustrd').map((u) => clean(u.textContent)).join(' ')
    const ref = txt(tx, 'RmtInf/Strd/CdtrRefInf/Ref') || txt(tx, 'Refs/EndToEndId').replace(/^NOTPROVIDED$/i, '') || txt(n, 'AcctSvcrRef')
    lines.push({
      transaction_date: parseDate(txt(n, 'BookgDt/Dt') || txt(n, 'BookgDt/DtTm') || txt(n, 'ValDt/Dt')) ?? '',
      description: clean([ustrd, txt(n, 'AddtlNtryInf')].filter(Boolean).join(' · ')) || (credit ? 'Hyrje' : 'Dalje'),
      amount, reference: ref || null,
      counterparty_name: txt(party, 'Nm') || null,
      counterparty_iban: txt(acct, 'Id/IBAN') || null,
    })
  }
  return { format: 'camt', lines: lines.filter((l) => l.transaction_date && l.amount), opening: bal('OPBD') ?? bal('PRCD'), closing: bal('CLBD'),
           date: parseDate(txt(stmt, 'CreDtTm')) ?? lines.at(-1)?.transaction_date ?? null, reference: txt(stmt, 'ElctrncSeqNb') || txt(stmt, 'Id') || null,
           iban: txt(stmt, 'Acct/Id/IBAN') || null, errors: [] }
}

/* ------------------------------------------------------------------ MT940 */
export function parseMt940(text: string): BankFile {
  // fields start with :NN: or :NNa: at the beginning of a line; their text may go on over several lines
  const fields: [string, string][] = []
  for (const raw of text.replace(/\r/g, '').split('\n')) {
    const m = /^:(\d{2}[A-Z]?):(.*)$/.exec(raw)
    if (m) fields.push([m[1]!, m[2]!])
    else if (fields.length && !/^-}?$/.test(raw.trim())) fields[fields.length - 1]![1] += '\n' + raw
  }
  const bal = (v: string) => { const m = /^([CD])(\d{6})([A-Z]{3})([\d,]+)/.exec(v.trim()); if (!m) return null; const a = parseAmount(m[4]!); return { amount: round2(m[1] === 'D' ? -a : a), date: parseDate('20' + m[2]) } }
  const lines: BankLine[] = []
  let opening: number | null = null, closing: number | null = null, date: string | null = null, reference: string | null = null, iban: string | null = null
  for (let i = 0; i < fields.length; i++) {
    const [tag, v] = fields[i]!
    if (tag === '20') reference = clean(v) || reference
    else if (tag === '25') iban = clean(v).replace(/^.*\//, '') || iban
    else if (tag === '60F' && opening == null) opening = bal(v)?.amount ?? null
    else if (tag === '62F') { const b = bal(v); closing = b?.amount ?? closing; date = b?.date ?? date }
    else if (tag === '61') {
      // YYMMDD[MMDD](C|D|RC|RD)[funds code]amount N<type><ref>[//bank ref]
      const m = /^(\d{6})(\d{4})?(R?[CD])([A-Z])?([\d,]+)N?[A-Z0-9]{3}([^\n/]*)(?:\/\/([^\n]*))?/.exec(v.trim())
      if (!m) continue
      const a = parseAmount(m[5]!)
      const credit = m[3] === 'C' || m[3] === 'RD'
      let info = ''
      if (fields[i + 1]?.[0] === '86') { info = fields[i + 1]![1]; i++ }
      // structured ?20…?29 text, ?32/?33 name, ?31 account (German-style banks); otherwise free text
      const sub = (codes: string[]) => (info.replace(/\n/g, '').match(/\?\d{2}[^?]*/g) ?? []).filter((s) => codes.includes(s.slice(1, 3))).map((s) => s.slice(3)).join(' ')
      const structured = /\?\d{2}/.test(info)
      const desc = structured ? sub(['20', '21', '22', '23', '24', '25', '26', '27', '28', '29']) : info.replace(/\n/g, ' ')
      const ibanIn = (structured ? sub(['31']) : '') || (/\b([A-Z]{2}\d{2}[A-Z0-9]{10,30})\b/.exec(info.replace(/\s/g, ' '))?.[1] ?? '')
      lines.push({
        transaction_date: parseDate('20' + m[1]) ?? '', amount: round2(credit ? a : -a),
        description: clean(desc) || (credit ? 'Hyrje' : 'Dalje'),
        reference: clean(m[6]).replace(/^NONREF$/i, '') || clean(m[7]) || null,
        counterparty_name: structured ? clean(sub(['32', '33'])) || null : null,
        counterparty_iban: ibanIn || null,
      })
    }
  }
  return { format: 'mt940', lines: lines.filter((l) => l.transaction_date && l.amount), opening, closing, date: date ?? lines.at(-1)?.transaction_date ?? null, reference, iban, errors: [] }
}

/* ------------------------------------------------------------------ Excel / CSV with headers */
const COLS: Record<keyof Omit<BankLine, 'amount'> | 'amount' | 'debit' | 'credit', RegExp> = {
  transaction_date: /^(data|date|dat[eë]|data e (transaksionit|regjistrimit|kontabilizimit|valut[eë]s)|booking date|value date|transaction date|posting date)$/i,
  description: /(p[eë]rshkrim|description|detaj|details|q[eë]llim|purpose|narrative|informacion|shpjegim|komente|p[eë]rmbajtja)/i,
  amount: /^(shuma|amount|vlera|shuma e transaksionit|transaction amount)$/i,
  debit: /(debi|debit|dalje|t[eë]rheqje|withdrawal|pagesa|paid out|money out)/i,
  credit: /(kredi|credit|hyrje|depozit|deposit|ar[eë]tim|paid in|money in)/i,
  reference: /(referenc|reference|^ref\b|nr\.? ?(i )?dokument|document no)/i,
  counterparty_name: /(pala|p[eë]rfitues|d[eë]rgues|urdh[eë]rd?h[eë]n[eë]s|emri|counterparty|beneficiary|payer|payee|name)/i,
  counterparty_iban: /(iban|llogaria e pal[eë]s|counterparty account|account of)/i,
}
export function parseTable(headers: string[], rows: string[][]): BankFile {
  // the header row is not always the first: look in the first rows for the one with most known names
  const all = [headers, ...rows]
  let hi = 0, best = 0
  all.slice(0, 15).forEach((r, i) => {
    const score = Object.values(COLS).filter((re) => r.some((c) => re.test(clean(c)))).length
    if (score > best) { best = score; hi = i }
  })
  const head = all[hi]!.map(clean)
  const find = (k: keyof typeof COLS, not: number[] = []) => head.findIndex((h, i) => !not.includes(i) && h !== '' && COLS[k].test(h))
  const c = { date: find('transaction_date'), desc: find('description'), amount: find('amount') }
  const debit = find('debit', [c.date, c.desc, c.amount]), credit = find('credit', [c.date, c.desc, c.amount, debit])
  const ref = find('reference', [c.date, c.desc, c.amount, debit, credit])
  const name = find('counterparty_name', [c.date, c.desc, c.amount, debit, credit, ref])
  const iban = find('counterparty_iban', [c.date, c.desc, c.amount, debit, credit, ref, name])
  const lines: BankLine[] = [], errors: number[] = []
  if (best < 2 || c.date < 0 || (c.amount < 0 && debit < 0 && credit < 0)) return { format: 'table', lines, opening: null, closing: null, date: null, reference: null, iban: null, errors: [-1] }
  all.slice(hi + 1).forEach((r, i) => {
    const date = parseDate(r[c.date] ?? '')
    if (!date) { if (r.some((x) => clean(x))) errors.push(hi + i + 2); return }
    let amount = c.amount >= 0 ? parseAmount(r[c.amount] ?? '') : NaN
    if (!Number.isFinite(amount) || (debit >= 0 && credit >= 0 && c.amount < 0)) {
      const out = debit >= 0 ? parseAmount(r[debit] ?? '') : NaN, inn = credit >= 0 ? parseAmount(r[credit] ?? '') : NaN
      amount = (Number.isFinite(inn) ? Math.abs(inn) : 0) - (Number.isFinite(out) ? Math.abs(out) : 0)
    }
    if (!Number.isFinite(amount) || amount === 0) { errors.push(hi + i + 2); return }
    lines.push({ transaction_date: date, amount: round2(amount), description: clean(r[c.desc]) || clean(r[name]) || (amount > 0 ? 'Hyrje' : 'Dalje'),
                 reference: clean(r[ref]) || null, counterparty_name: clean(r[name]) || null, counterparty_iban: clean(r[iban]).replace(/\s/g, '') || null })
  })
  return { format: 'table', lines, opening: null, closing: null, date: lines.reduce<string | null>((m, l) => (!m || l.transaction_date > m ? l.transaction_date : m), null), reference: null, iban: null, errors }
}

/** any of the formats above, by its content */
export async function readBankFile(file: File): Promise<BankFile> {
  if (/\.xlsx$/i.test(file.name)) { const p = await parseFile(file); return parseTable(p.headers, p.rows) }
  let text = await file.text()
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1)
  return readBankText(text)
}
export function readBankText(text: string): BankFile {
  if (/^\s*</.test(text) && /BkToCstmr(Stmt|AcctRpt)/.test(text)) return parseCamt(text)
  if (/(^|\n):20:/.test(text) && /(^|\n):61:/.test(text)) return parseMt940(text)
  const p = parseCsv(text)
  return parseTable(p.headers, p.rows)
}
