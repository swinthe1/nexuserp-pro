import { msg } from '@/i18n'
/** Reads the first sheet of a CSV or .xlsx file into a header row and data rows (strings) */
export type ParsedFile = { headers: string[]; rows: string[][] }

export async function parseFile(file: File): Promise<ParsedFile> {
  if (/\.xlsx$/i.test(file.name)) return parseXlsx(new Uint8Array(await file.arrayBuffer()))
  if (/\.xls$/i.test(file.name)) throw new Error(msg('Old .xls files are not supported. Save the sheet as .xlsx or .csv.'))
  let text = await file.text()
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1)
  return parseCsv(text)
}

export function parseCsv(text: string): ParsedFile {
  const firstLine = text.split(/\r?\n/, 1)[0] ?? ''
  const count = (c: string) => firstLine.split(c).length - 1
  const delim = [';', '\t', ','].sort((a, b) => count(b) - count(a))[0]!
  const out: string[][] = []
  let row: string[] = [], cell = '', quoted = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!
    if (quoted) {
      if (ch === '"') { if (text[i + 1] === '"') { cell += '"'; i++ } else quoted = false }
      else cell += ch
    } else if (ch === '"' && cell === '') quoted = true
    else if (ch === delim) { row.push(cell); cell = '' }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++
      row.push(cell); cell = ''
      if (row.some((c) => c.trim() !== '')) out.push(row)
      row = []
    } else cell += ch
  }
  row.push(cell)
  if (row.some((c) => c.trim() !== '')) out.push(row)
  const [headers = [], ...rows] = out
  return { headers: headers.map((h) => h.trim()), rows }
}

async function parseXlsx(bytes: Uint8Array): Promise<ParsedFile> {
  const { unzipSync, strFromU8 } = await import('fflate')
  const files = unzipSync(bytes)
  const read = (p: string) => (files[p] ? strFromU8(files[p]!) : null)
  const dom = (xml: string) => new DOMParser().parseFromString(xml, 'application/xml')
  const shared: string[] = []
  const ss = read('xl/sharedStrings.xml')
  if (ss) for (const si of Array.from(dom(ss).getElementsByTagName('si'))) shared.push(Array.from(si.getElementsByTagName('t')).map((t) => t.textContent ?? '').join(''))
  // the first sheet in workbook order
  const wb = read('xl/workbook.xml'), rels = read('xl/_rels/workbook.xml.rels')
  let sheetPath = 'xl/worksheets/sheet1.xml'
  if (wb && rels) {
    const rid = dom(wb).getElementsByTagName('sheet')[0]?.getAttribute('r:id')
    const target = Array.from(dom(rels).getElementsByTagName('Relationship')).find((r) => r.getAttribute('Id') === rid)?.getAttribute('Target')
    if (target) sheetPath = target.startsWith('/') ? target.slice(1) : `xl/${target.replace(/^\.\//, '')}`
  }
  const sheet = read(sheetPath)
  if (!sheet) throw new Error(msg('The workbook has no readable sheet.'))
  const colIndex = (ref: string) => { let n = 0; for (const ch of ref.replace(/\d+/g, '')) n = n * 26 + (ch.charCodeAt(0) - 64); return n - 1 }
  const out: string[][] = []
  for (const r of Array.from(dom(sheet).getElementsByTagName('row'))) {
    const row: string[] = []
    for (const c of Array.from(r.getElementsByTagName('c'))) {
      const t = c.getAttribute('t'), v = c.getElementsByTagName('v')[0]?.textContent ?? ''
      const val = t === 's' ? shared[Number(v)] ?? '' : t === 'inlineStr' ? Array.from(c.getElementsByTagName('t')).map((x) => x.textContent ?? '').join('') : v
      row[colIndex(c.getAttribute('r') ?? 'A')] = val
    }
    const filled = Array.from(row, (x) => x ?? '')
    if (filled.some((x) => x.trim() !== '')) out.push(filled)
  }
  const [headers = [], ...rows] = out
  return { headers: headers.map((h) => h.trim()), rows }
}

/** Excel stores dates as days since 1899-12-30 */
export function excelDate(v: string): string {
  if (/^\d{5}(\.\d+)?$/.test(v)) {
    const d = new Date(Date.UTC(1899, 11, 30) + Math.floor(Number(v)) * 86400000)
    return d.toISOString().slice(0, 10)
  }
  const m = v.match(/^(\d{1,2})[./](\d{1,2})[./](\d{4})$/)   // 15.03.2026 → 2026-03-15
  if (m) return `${m[3]}-${m[2]!.padStart(2, '0')}-${m[1]!.padStart(2, '0')}`
  return v
}

export const normalize = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim()
