import { Download, FileSpreadsheet, FileText, Printer } from 'lucide-react'
import { t } from '@/i18n'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { exportCsv, exportPdf, exportXlsx, type XlsxColumn, type XlsxOptions } from '@/lib/export'
import { printTable } from '@/lib/print-table'

/** Excel / PDF / CSV for tables that are not a DataTable (official books, reports) */
export function ExportMenu<T>({ rows, columns, filename, title, subtitle, xlsx, disabled }: {
  rows: T[]
  columns: XlsxColumn<T>[]
  filename: string
  /** PDF heading */
  title: string
  subtitle?: string
  xlsx?: XlsxOptions
  disabled?: boolean
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" disabled={disabled || !rows.length}><Download /> {t('Export')}</Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onSelect={() => void exportXlsx(rows, columns, filename, { sheet: title, title: [title, ...(subtitle ? [subtitle] : [])], ...xlsx })}>
          <FileSpreadsheet /> Excel
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => void exportPdf(rows, columns, filename, title, subtitle)}><FileText /> PDF</DropdownMenuItem>
        <DropdownMenuItem onSelect={() => exportCsv(rows, columns, filename)}><FileSpreadsheet /> CSV</DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => printTable({ title, subtitle, columns: columns.map((c) => ({ header: c.header, format: c.format === 'int' || c.format === 'text' || c.format === 'money' ? c.format : undefined })),
          rows: rows.map((r) => columns.map((c) => c.value(r))), totals: xlsx?.totals ? columns.map((c) => xlsx.totals![c.header] ?? null) : null })}><Printer /> {t('Print')}</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

type Cell = string | number | null | undefined

/**
 * Excel / PDF / CSV for a table built as rows of cells (the first row the headings): reports, the
 * debts, the forecast. A column whose every value is a number is a number column in Excel.
 */
export function GridExportMenu({ name, title, subtitle, grid, disabled, label }: {
  name: string
  title: string
  subtitle?: string
  /** built when the person picks a format */
  grid: () => Cell[][] | null | undefined
  disabled?: boolean
  label?: string
}) {
  const run = (kind: 'xlsx' | 'pdf' | 'csv' | 'print') => {
    const g = grid()
    if (!g?.length) return
    const [head, ...body] = g
    const columns: XlsxColumn<Cell[]>[] = head!.map((h, i) => {
      const vals = body.map((r) => r[i]).filter((v) => v !== null && v !== undefined && v !== '')
      const numeric = vals.length > 0 && vals.every((v) => typeof v === 'number')
      return { header: String(h ?? ''), value: (r: Cell[]) => r[i], format: numeric ? (vals.every((v) => Number.isInteger(v)) ? 'int' : 'money') : undefined }
    })
    if (kind === 'print') printTable({ title, subtitle, columns: columns.map((c) => ({ header: c.header, format: c.format === 'int' ? 'int' : c.format === 'money' ? 'money' : undefined })), rows: body })
    else if (kind === 'xlsx') void exportXlsx(body, columns, name, { sheet: title, title: [title, ...(subtitle ? [subtitle] : [])] })
    else if (kind === 'pdf') void exportPdf(body, columns, name, title, subtitle)
    else exportCsv(body, columns, name)
  }
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" disabled={disabled}><Download /> {label ?? t('Export')}</Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onSelect={() => run('xlsx')}><FileSpreadsheet /> Excel</DropdownMenuItem>
        <DropdownMenuItem onSelect={() => run('pdf')}><FileText /> PDF</DropdownMenuItem>
        <DropdownMenuItem onSelect={() => run('csv')}><FileSpreadsheet /> CSV</DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => run('print')}><Printer /> {t('Print')}</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
