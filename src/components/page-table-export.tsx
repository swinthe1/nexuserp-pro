import { GridExportMenu } from '@/components/export-menu'
import { activePage } from '@/components/layout/work-tabs'
import { getLocale, t } from '@/i18n'

type Cell = string | number | null

/**
 * Excel, PDF, CSV and print for a page whose table is drawn by hand (cards, reports, documents): the table
 * the person sees is read as it stands — the open tab, the filters applied, the totals — so what is
 * exported is what is on the screen. Numbers stay numbers in Excel.
 */
export function PageTableExport({ name, title, subtitle, within, label, disabled }: {
  /** the file name (without extension); the page title when left out */
  name?: string
  title?: string
  subtitle?: string
  /** where to look for the table (a part of the page); the whole page when left out */
  within?: React.RefObject<HTMLElement | null>
  label?: string
  disabled?: boolean
}) {
  const heading = () => (typeof document !== 'undefined' ? activePage()?.querySelector('h1')?.textContent?.trim() : undefined) ?? t('Export')
  return (
    <GridExportMenu name={name ?? fileName(title ?? heading())} title={title ?? heading()} subtitle={subtitle} label={label} disabled={disabled}
      grid={() => tableGrid(within?.current ?? activePage())} />
  )
}

const fileName = (s: string) => s.replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim()

/** a number as the page shows it (2 200,00 · 1.234,56 · 1,234.56 · −15) back to a number; anything else stays text */
function asNumber(text: string): number | string {
  const s = text.replace(/[\s  ]/g, '').replace(/[€$]|ALL|EUR|Lekë?/g, '').replace(/^[−–]/, '-')
  if (!/^-?[\d.,]+$/.test(s) || !/\d/.test(s)) return text
  const dec = getLocale() === 'en' ? '.' : ','
  const group = dec === ',' ? '.' : ','
  // two separators of the decimal kind, or a group separator after the decimal one: not a number we read
  if ((s.split(dec).length > 2) || (s.includes(dec) && s.lastIndexOf(group) > s.indexOf(dec))) return text
  const n = Number(s.split(group).join('').replace(dec, '.'))
  return Number.isFinite(n) ? n : text
}

/** the largest table that can be seen in the scope, as rows of cells (the header row first) */
export function tableGrid(scope: Element | null): Cell[][] | null {
  if (!scope) return null
  const tables = [...scope.querySelectorAll('table')].filter((tb) => (tb as HTMLElement).offsetParent !== null && !tb.closest('[role="dialog"]') && !tb.closest('[data-noexport]'))
  if (!tables.length) return null
  const tb = tables.sort((a, b) => b.rows.length - a.rows.length)[0]!
  const rows: Cell[][] = []
  for (const tr of [...tb.rows]) {
    if ((tr as HTMLElement).offsetParent === null && tr.closest('tbody')) continue
    const cells: Cell[] = []
    for (const c of [...tr.cells]) {
      if (c.hasAttribute('data-noexport')) continue
      // the words of the cell, not its buttons (Ndrysho, Fshi…)
      let raw = (c as HTMLElement).innerText
      for (const b of c.querySelectorAll('button, [role="button"]')) raw = raw.replace((b as HTMLElement).innerText, '')
      const text = raw.replace(/\s*\n\s*/g, ' · ').replace(/^ · | · $/g, '').trim()
      cells.push(tr.parentElement?.tagName === 'THEAD' ? text : text === '' || text === '—' ? null : asNumber(text))
      for (let i = 1; i < c.colSpan; i++) cells.push(null)
    }
    rows.push(cells)
  }
  // the header row: the last row of the head (above it are group titles), or the first row
  const headIdx = tb.tHead ? tb.tHead.rows.length - 1 : 0
  const header = rows[headIdx] ?? []
  const body = rows.filter((_, i) => (tb.tHead ? i > headIdx : i > 0))
  const width = Math.max(header.length, ...body.map((r) => r.length))
  // columns with nothing in them (icons, buttons) are left out
  const keep = Array.from({ length: width }, (_, i) => (header[i] !== null && header[i] !== undefined && header[i] !== '') || body.some((r) => r[i] !== null && r[i] !== undefined && r[i] !== ''))
  const pick = (r: Cell[]) => keep.flatMap((k, i) => (k ? [r[i] ?? null] : []))
  return [pick(header).map((h) => (h === null ? '' : String(h))), ...body.map(pick)]
}
