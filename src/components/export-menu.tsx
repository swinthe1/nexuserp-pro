import { Download, FileSpreadsheet, FileText } from 'lucide-react'
import { t } from '@/i18n'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { exportCsv, exportPdf, exportXlsx, type XlsxColumn, type XlsxOptions } from '@/lib/export'

/** Excel / CSV / PDF for tables that are not a DataTable (official books, reports) */
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
        <DropdownMenuItem onSelect={() => exportCsv(rows, columns, filename)}><FileSpreadsheet /> CSV</DropdownMenuItem>
        <DropdownMenuItem onSelect={() => void exportPdf(rows, columns, filename, title, subtitle)}><FileText /> PDF</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
