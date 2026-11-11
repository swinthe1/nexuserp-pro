import { download, exportFileName } from '@/lib/export'
import { supabase } from '@/lib/supabase'
import { num } from '@/lib/utils'
import type { RegisterRow } from './api'

/**
 * The payroll list as ATK's own Excel template for the monthly declaration of wages (ATKTemplate-AL): the headings in
 * row 1, the letters a…k in row 2 with PO / JO beside them, one employee per row from row 3. ATK's headings stay in Albanian.
 */
const HEAD = ['Emri', 'Mbiemri', 'Numri \nIndividual i punëtorit', 'Bruto paga \npër muaj', 'Kontributi pensional i të punësuarit', 'Kontributi pensional i punëdhënësit',
  'Kontributi suplementar i të punësuarit', 'Kontributi suplementar i punëdhënësit', 'Punë \nPrimare', 'Përfshihen Kontributet', 'Aplikohet \nTatimi në Paga']
const LETTERS = ['a', 'b', 'c', 'd', 'e=(d*5%)', 'f=(d*5%)', 'g', 'h', 'i', 'j', 'k']
const WIDTHS = [14, 16, 14, 12, 14, 14, 17, 15, 9, 12, 15, 8]
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const col = (i: number) => String.fromCharCode(65 + i)

export async function exportAtkPayroll(rows: RegisterRow[], filename: string) {
  const { zipSync, strToU8 } = await import('fflate')
  // the main job, a second job or an intern: as the employee's page says now
  const ids = rows.map((r) => r.employee_id)
  const primary = new Map<string, boolean>()
  if (ids.length) {
    const { data } = await supabase.from('employees').select('id, job_status').in('id', ids)
    for (const e of data ?? []) primary.set(e.id, e.job_status !== 'secondary')
  }
  const txt = (ref: string, v: string, s: number) => `<c r="${ref}" t="inlineStr" s="${s}"><is><t xml:space="preserve">${esc(v)}</t></is></c>`
  const n = (ref: string, v: number) => `<c r="${ref}" s="2"><v>${Math.round(v * 100) / 100}</v></c>`
  const yes = (b: boolean) => (b ? 'PO' : 'JO')
  const out = [
    `<row r="1" ht="52" customHeight="1">${HEAD.map((h, i) => txt(`${col(i)}1`, h, 1)).join('')}</row>`,
    `<row r="2">${LETTERS.map((h, i) => txt(`${col(i)}2`, h, 1)).join('')}${txt('L2', 'PO', 0)}</row>`,
    ...rows.map((r, i) => {
      const k = i + 3
      return `<row r="${k}">${[txt(`A${k}`, r.first_name ?? '', 0), txt(`B${k}`, r.last_name ?? '', 0), txt(`C${k}`, r.personal_number ?? '', 0), n(`D${k}`, num(r.gross)),
        n(`E${k}`, num(r.ss_employee)), n(`F${k}`, num(r.ss_employer)), n(`G${k}`, 0), n(`H${k}`, 0),
        txt(`I${k}`, yes(primary.get(r.employee_id) ?? true), 0), txt(`J${k}`, yes(num(r.ss_employee) + num(r.ss_employer) > 0), 0), txt(`K${k}`, 'PO', 0), ...(k === 3 ? [txt('L3', 'JO', 0)] : [])].join('')}</row>`
    }),
    ...(rows.length ? [] : [`<row r="3">${txt('L3', 'JO', 0)}</row>`]),
  ]
  const sheet = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><cols>${WIDTHS.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('')}</cols><sheetData>${out.join('')}</sheetData>${rows.length ? `<dataValidations count="1"><dataValidation type="list" allowBlank="1" sqref="I3:K${rows.length + 2}"><formula1>"PO,JO"</formula1></dataValidation></dataValidations>` : ''}</worksheet>`
  const styles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="1"><numFmt numFmtId="164" formatCode="0.00"/></numFmts>
<fonts count="2"><font><sz val="10"/><name val="Arial"/></font><font><b/><sz val="10"/><name val="Arial"/></font></fonts>
<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf/></cellStyleXfs>
<cellXfs count="3"><xf/><xf fontId="1" applyFont="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf><xf numFmtId="164" applyNumberFormat="1"/></cellXfs></styleSheet>`
  const files: Record<string, Uint8Array> = {
    '[Content_Types].xml': strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`),
    '_rels/.rels': strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`),
    'xl/workbook.xml': strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Sheet1" sheetId="1" r:id="rId1"/></sheets></workbook>`),
    'xl/_rels/workbook.xml.rels': strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`),
    'xl/styles.xml': strToU8(styles),
    'xl/worksheets/sheet1.xml': strToU8(sheet),
  }
  download(new Blob([zipSync(files)], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), `${exportFileName(filename, 'Lista e pagave ATK')}.xlsx`)
}
