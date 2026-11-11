import { download, exportFileName } from '@/lib/export'
import { num } from '@/lib/utils'
import type { BookRow } from './api'

/**
 * The sales book and the purchase book as an Excel file in ATK's own layout ("Libri i Shitjes", "Libri i Blerjes":
 * the two heading rows, the row of the VAT return's boxes, one row per invoice from row 4, and the VAT worked out by
 * formula in [K1], [K2] and the total, exactly as in ATK's sample files). The headings are ATK's, in Albanian, in every language.
 */
type Col = { h: string; box?: string; key?: string; f?: (r: number) => string; w?: number }
type Group = { h: string; span: number }

const SALES: { groups: Group[]; cols: Col[] } = {
  groups: [{ h: 'Shitjet e liruara nga TVSH', span: 6 }, { h: 'Shitjet e tatueshme me normën 18%', span: 6 }, { h: 'Shitjet e tatueshme me normën 8%', span: 5 }],
  cols: [
    { h: 'Shitjet e liruara pa të drejtë kreditimi', box: '[9]', key: '9' },
    { h: 'Shitjet e shërbimeve jashtë vendit', box: '[10a]' },
    { h: 'Shitjet brenda vendit me ngarkesë të kundërt  të TVSH-së', box: '[10b]' },
    { h: 'Shitjet tjera të liruara me të drejtë kreditimi', box: '[10c]', key: '10' },
    { h: 'Totali i shitjeve të liruara me të drejtë kreditimi', box: '[10] = [10a]+[10b]+[10c]', f: (r) => `H${r}+I${r}+J${r}`, w: 16.6 },
    { h: 'Eksportet', box: '[11]', key: '11' },
    { h: 'Shitjet e tatueshme ', box: '[12]', key: '12' },
    { h: 'Nota debitore e lëshuar, nota kreditore e pranuar ', box: '[16]', key: '16' },
    { h: 'Fatura e borxhit të keq e pranuar', box: '[20]' },
    { h: 'Rregullimet për të rritur TVSH-në ', box: '[24]' },
    { h: 'Blerjet që i nënshtrohen ngarkesës së kundërt', box: '[28]', key: '28' },
    { h: 'Totali i TVSH-së së llogaritur me normën 18%', box: '[K1]', f: (r) => `(M${r}+N${r}+O${r}+P${r}+Q${r})*18%` },
    { h: 'Shitjet e tatueshme', box: '[14]', key: '14' },
    { h: 'Nota debitore e lëshuar, nota kreditore e pranuar ', box: '[18]', key: '18' },
    { h: 'Fatura e borxhit të keq e pranuar', box: '[22]' },
    { h: 'Rregullimet për të rritur TVSH-në ', box: '[26]' },
    { h: 'Totali i TVSH-së së llogaritur me normën 8%', box: '[K2]', f: (r) => `(S${r}+T${r}+U${r}+V${r})*8%` },
    { h: 'Totali i TVSH-së së llogaritur me   18% dhe 8%', box: '[30]', f: (r) => `R${r}+W${r}` },
  ],
}
const PURCHASE: { groups: Group[]; cols: Col[] } = {
  groups: [{ h: 'Blerjet dhe Importet e liruara dhe me TVSH jo të zbritshme', span: 4 }, { h: 'Blerjet dhe Importet e tatushme me 18%, si dhe rregullimet e zbritjeve', span: 9 },
    { h: 'Blerjet dhe Importet e tatushme me 8%, si dhe rregullimet e zbritjeve', span: 9 }],
  cols: [
    { h: 'Blerjet dhe importet pa TVSH', box: '[31]', key: '31' },
    { h: 'Blerjet dhe importet investive pa TVSH', box: '[32]', key: '32' },
    { h: 'Blerjet dhe importet me TVSH jo të zbritshme', box: '[33]', key: '33' },
    { h: 'Blerjet dhe importet investive me TVSH jo të zbritshme', box: '[34]', key: '34' },
    { h: 'Importet', box: '[35]', key: '35' },
    { h: 'Importet investive  ', box: '[39]', key: '39' },
    { h: 'Blerjet vendore', box: '[43]', key: '43' },
    { h: 'Blerjet investive vendore  ', box: '[47]', key: '47' },
    { h: 'Nota debitore e pranuar, nota kreditore e lëshuar ', box: '[53]', key: '53' },
    { h: 'Fatura e borxhit të keq e lëshuar ', box: '[57]', key: '57' },
    { h: 'Rregullimet për të ulur TVSH-në për pagesë', box: '[61]', key: '61' },
    { h: 'E drejta e kreditimit të TVSH-së në lidhje me Ngarkesën e Kundërt', box: '[65]', key: '65' },
    { h: 'Totali i TVSH-së së  zbritshme me 18%', box: '[K1]', f: (r) => `(K${r}+L${r}+M${r}+N${r}+O${r}+P${r}+Q${r}+R${r})*18%` },
    { h: 'Importet ', box: '[37]', key: '37' },
    { h: 'Importet investive ', box: '[41]', key: '41' },
    { h: 'Blerjet vendore', box: '[45]', key: '45' },
    { h: 'Blerjet investive vendore', box: '[49]', key: '49' },
    { h: 'Blerjet nga fermerët (aplikimi i normës së sheshtë)', box: '[51]', key: '51' },
    { h: 'Nota debitore e pranuar, nota kreditore e lëshuar ', box: '[55]', key: '55' },
    { h: 'Fatura e borxhit të keq e lëshuar', box: '[59]', key: '59' },
    { h: 'Rregullimet për të ulur TVSH-në për pagesë', box: '[63]', key: '63' },
    { h: 'Totali i TVSH-së së  zbritshme me 8%', box: '[K2]', f: (r) => `(T${r}+U${r}+V${r}+W${r}+X${r}+Y${r}+Z${r}+AA${r})*8%` },
    { h: 'Totali i TVSH-së së zbritshme me 18% dhe 8%', box: '[67] ', f: (r) => `S${r}+AB${r}` },
  ],
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const colName = (i: number) => { let s = ''; i += 1; while (i > 0) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26) } return s }
const r2 = (n: number) => Math.round(n * 100) / 100
/** the day as Excel counts it */
const serial = (iso: string) => Math.round(Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) / 86400000) + 25569

export async function exportAtkBook(book: 'sales' | 'purchase', rows: BookRow[], filename: string, number: (r: BookRow) => string, partner: (r: BookRow) => string) {
  const { zipSync, strToU8 } = await import('fflate')
  const L = book === 'sales' ? SALES : PURCHASE
  const who = book === 'sales' ? 'blerësit' : 'shitësit'
  const first = 6 // G: the first amount column
  const last = first + L.cols.length - 1
  // styles: 0 plain · 1 heading (wrapped, boxed) · 2 bold heading · 3 box row (grey) · 4 amount · 5 date · 6 text · 7 whole number
  const txt = (ref: string, v: string, s: number) => `<c r="${ref}" t="inlineStr" s="${s}"><is><t xml:space="preserve">${esc(v)}</t></is></c>`
  const blank = (ref: string, s: number) => `<c r="${ref}" s="${s}"/>`
  const out: string[] = []
  // row 1: the groups; the last column's own heading stands across rows 1 and 2
  const row1: string[] = [txt('A1', 'Nr.', 1), txt('B1', 'Fatura', 2), blank('C1', 2), txt('D1', book === 'sales' ? 'Blerësi' : 'Shitësi', 2), blank('E1', 2), blank('F1', 2)]
  const merges = ['A1:A2', 'B1:C1', 'D1:F1', 'A3:F3', `${colName(last)}1:${colName(last)}2`]
  let at = first
  for (const g of L.groups) {
    for (let i = 0; i < g.span; i++) row1.push(i === 0 ? txt(`${colName(at)}1`, g.h, 2) : blank(`${colName(at + i)}1`, 2))
    merges.push(`${colName(at)}1:${colName(at + g.span - 1)}1`)
    at += g.span
  }
  row1.push(txt(`${colName(last)}1`, L.cols[L.cols.length - 1]!.h, 1))
  out.push(`<row r="1" ht="16.5" customHeight="1">${row1.join('')}</row>`)
  const row2 = [blank('A2', 1), txt('B2', 'Data', 1), txt('C2', 'Numri i faturës', 1), txt('D2', `Emri i ${who}`, 1), txt('E2', `Numri Fiskal i ${who}`, 1), txt('F2', `Numri i TVSH-së së ${who}`, 1),
    ...L.cols.map((c, i) => (i === L.cols.length - 1 ? blank(`${colName(first + i)}2`, 1) : txt(`${colName(first + i)}2`, c.h, 1)))]
  out.push(`<row r="2" ht="76" customHeight="1">${row2.join('')}</row>`)
  out.push(`<row r="3">${[txt('A3', 'Numri i kutisë në Deklaratën e TVSH-së', 3), ...['B', 'C', 'D', 'E', 'F'].map((c) => blank(`${c}3`, 3)), ...L.cols.map((c, i) => txt(`${colName(first + i)}3`, c.box ?? '', 3))].join('')}</row>`)
  rows.forEach((row, n) => {
    const r = n + 4
    const cells = [`<c r="A${r}" s="7"><v>${n + 1}</v></c>`, `<c r="B${r}" s="5"><v>${serial(row.doc_date)}</v></c>`, txt(`C${r}`, number(row), 6), txt(`D${r}`, partner(row), 6),
      row.tax_number ? txt(`E${r}`, row.tax_number, 6) : blank(`E${r}`, 6), blank(`F${r}`, 6)]
    const val: number[] = []
    L.cols.forEach((c, i) => {
      const ref = `${colName(first + i)}${r}`
      if (c.f) {
        // the figure the formula gives, kept in the file too, for a program that reads it without working formulas out
        const letters = c.f(1).replace(/[()]/g, '').replace(/\*.*$/, '').split('+').map((x) => x.replace(/1$/, ''))
        const sum = letters.reduce((s, x) => s + (val[L.cols.findIndex((_, j) => colName(first + j) === x)] ?? 0), 0)
        const pct = /\*18%/.test(c.f(1)) ? 0.18 : /\*8%/.test(c.f(1)) ? 0.08 : 1
        val[i] = sum * pct
        cells.push(`<c r="${ref}" s="4"><f>${c.f(r)}</f><v>${r2(val[i]!)}</v></c>`)
      } else {
        const v = c.key ? num(row.cols?.[c.key]) : 0
        val[i] = v
        cells.push(v !== 0 ? `<c r="${ref}" s="4"><v>${r2(v)}</v></c>` : blank(ref, 4))
      }
    })
    out.push(`<row r="${r}">${cells.join('')}</row>`)
  })
  const widths = [5, 13, 18, 30, 13.5, 12, ...L.cols.map((c) => c.w ?? 12.5)].map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('')
  const sheet = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane xSplit="4" ySplit="3" topLeftCell="E4" activePane="bottomRight" state="frozen"/></sheetView></sheetViews><cols>${widths}</cols><sheetData>${out.join('')}</sheetData><mergeCells count="${merges.length}">${merges.map((m) => `<mergeCell ref="${m}"/>`).join('')}</mergeCells><pageSetup paperSize="9" orientation="landscape" fitToHeight="0"/></worksheet>`
  const box = '<border><left style="thin"/><right style="thin"/><top style="thin"/><bottom style="thin"/></border>'
  const styles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="2"><numFmt numFmtId="164" formatCode="#,##0.00"/><numFmt numFmtId="165" formatCode="dd.mm.yyyy"/></numFmts>
<fonts count="3"><font><sz val="10"/><name val="Arial Narrow"/></font><font><sz val="9"/><name val="Arial Narrow"/></font><font><b/><sz val="11"/><name val="Arial Narrow"/></font></fonts>
<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFD9D9D9"/></patternFill></fill></fills>
<borders count="2"><border/>${box}</borders><cellStyleXfs count="1"><xf/></cellStyleXfs>
<cellXfs count="8"><xf/>
<xf fontId="1" borderId="1" applyFont="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
<xf fontId="2" borderId="1" applyFont="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
<xf fontId="1" fillId="2" borderId="1" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
<xf numFmtId="164" borderId="1" applyNumberFormat="1" applyBorder="1"/><xf numFmtId="165" borderId="1" applyNumberFormat="1" applyBorder="1"/><xf borderId="1" applyBorder="1"/><xf numFmtId="1" borderId="1" applyNumberFormat="1" applyBorder="1"/></cellXfs></styleSheet>`
  const files: Record<string, Uint8Array> = {
    '[Content_Types].xml': strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`),
    '_rels/.rels': strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`),
    'xl/workbook.xml': strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Sheet1" sheetId="1" r:id="rId1"/></sheets><calcPr fullCalcOnLoad="1"/></workbook>`),
    'xl/_rels/workbook.xml.rels': strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`),
    'xl/styles.xml': strToU8(styles),
    'xl/worksheets/sheet1.xml': strToU8(sheet),
  }
  download(new Blob([zipSync(files)], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), `${exportFileName(filename, book === 'sales' ? 'Libri i Shitjes' : 'Libri i Blerjes')}.xlsx`)
}
