import { ClipboardCopy, Columns3, Rows3, Table2 } from 'lucide-react'
import * as React from 'react'
import { toast } from 'sonner'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { t } from '@/i18n'

/** Puts text on the clipboard; tabs between cells, so it pastes into Excel as cells. */
export async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text)
  } catch {
    const ta = document.createElement('textarea')
    ta.value = text
    ta.style.position = 'fixed'
    ta.style.opacity = '0'
    document.body.appendChild(ta)
    ta.select()
    document.execCommand('copy')
    ta.remove()
  }
}

const cellText = (td: Element) => (td as HTMLElement).innerText.replace(/\s*\n\s*/g, ' ').trim()
const tsv = (rows: (string | number | null | undefined)[][]) =>
  rows.map((r) => r.map((v) => (v == null ? '' : String(v).replace(/[\t\r\n]+/g, ' '))).join('\t')).join('\r\n')

export type CopyGrid = { header: string[]; rows: (string | number | null | undefined)[][] }

type Spot = { x: number; y: number; cell: string; row: string[]; colId: string; colLabel: string }

/**
 * Right click on a cell of a list: copy the cell, its row, its whole column or the table.
 * The cell and the row are copied as they are shown; a column and the table as in the Excel export
 * (every row that passes the filters, not only this page). With text selected, the browser's own
 * menu stays, to copy just that.
 */
export function useCopyMenu({ headers, column, table, selected }: {
  /** the visible columns' headings, by column id */
  headers: () => Record<string, string>
  /** a column's values, every row that passes the filters */
  column: (colId: string) => CopyGrid | null
  /** the table, every row that passes the filters */
  table: () => CopyGrid
  /** the ticked rows, when there are some */
  selected: () => CopyGrid | null
}) {
  const [spot, setSpot] = React.useState<Spot | null>(null)

  const onContextMenu = (e: React.MouseEvent) => {
    const sel = window.getSelection()?.toString()
    if (sel) return
    const td = (e.target as HTMLElement).closest('td[data-col]')
    const tr = td?.closest('tr')
    if (!td || !tr) return
    if ((e.target as HTMLElement).closest('input, textarea, [contenteditable="true"]')) return
    e.preventDefault()
    const colId = td.getAttribute('data-col')!
    const row = [...tr.querySelectorAll('td[data-col]')].map(cellText)
    setSpot({ x: e.clientX, y: e.clientY, cell: cellText(td), row, colId, colLabel: headers()[colId] ?? '' })
  }

  const done = (text: string, what: string) => {
    void copyText(text).then(() => toast.success(what))
  }

  const menu = (
    <DropdownMenu open={!!spot} onOpenChange={(o) => { if (!o) setSpot(null) }} modal={false}>
      <DropdownMenuTrigger asChild>
        <span aria-hidden className="pointer-events-none fixed size-px" style={{ left: spot?.x ?? 0, top: spot?.y ?? 0 }} />
      </DropdownMenuTrigger>
      {spot && (
        <DropdownMenuContent align="start" side="bottom" sideOffset={2} className="min-w-[230px]" onCloseAutoFocus={(e) => e.preventDefault()}>
          {spot.cell && <DropdownMenuLabel className="max-w-[280px] truncate text-[11px] font-normal text-muted-foreground">{spot.cell}</DropdownMenuLabel>}
          <DropdownMenuItem disabled={!spot.cell} onSelect={() => done(spot.cell, t('Cell copied'))}><ClipboardCopy /> {t('Copy cell')}</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => done(tsv([spot.row]), t('Row copied'))}><Rows3 /> {t('Copy row')}</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => { const g = column(spot.colId); if (g) done(tsv([g.header, ...g.rows]), t('Column copied: {n} rows', { n: g.rows.length })) }}>
            <Columns3 /> <span className="truncate">{spot.colLabel ? t('Copy column “{name}”', { name: spot.colLabel }) : t('Copy column')}</span>
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          {(() => { const s = selected(); return s ? (
            <DropdownMenuItem onSelect={() => done(tsv([s.header, ...s.rows]), t('{n} rows copied', { n: s.rows.length }))}><Rows3 /> {t('Copy the ticked rows ({n})', { n: s.rows.length })}</DropdownMenuItem>
          ) : null })()}
          <DropdownMenuItem onSelect={() => { const g = table(); done(tsv([g.header, ...g.rows]), t('{n} rows copied', { n: g.rows.length })) }}><Table2 /> {t('Copy the table, with headings')}</DropdownMenuItem>
        </DropdownMenuContent>
      )}
    </DropdownMenu>
  )
  return { onContextMenu, menu }
}
