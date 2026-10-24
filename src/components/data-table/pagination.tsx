import type { Table } from '@tanstack/react-table'
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { t } from '@/i18n'

export function Pagination<TData>({ table, rowCount }: { table: Table<TData>; rowCount: number }) {
  const { pageIndex, pageSize } = table.getState().pagination
  const selected = table.getFilteredSelectedRowModel().rows.length
  const from = rowCount === 0 ? 0 : pageIndex * pageSize + 1
  const to = Math.min(rowCount, (pageIndex + 1) * pageSize)
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 px-1 text-[13px] text-muted-foreground">
      <div>{selected > 0 ? t('{selected} of {total} selected', { selected, total: rowCount }) : t('{from}–{to} of {total}', { from, to, total: rowCount })}</div>
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-2">
          <span className="hidden sm:inline">{t('Rows')}</span>
          <Select value={String(pageSize)} onValueChange={(v) => table.setPageSize(Number(v))}>
            <SelectTrigger className="h-8 w-[72px]" aria-label={t('Rows per page')}><SelectValue /></SelectTrigger>
            <SelectContent>
              {[25, 50, 100, 250].map((n) => <SelectItem key={n} value={String(n)}>{n}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="flex items-center gap-1">
          <Button variant="outline" size="icon-sm" onClick={() => table.setPageIndex(0)} disabled={!table.getCanPreviousPage()} aria-label={t('First page')}><ChevronsLeft /></Button>
          <Button variant="outline" size="icon-sm" onClick={() => table.previousPage()} disabled={!table.getCanPreviousPage()} aria-label={t('Previous page')}><ChevronLeft /></Button>
          <span className="px-2 tabular">{pageIndex + 1} / {Math.max(1, table.getPageCount())}</span>
          <Button variant="outline" size="icon-sm" onClick={() => table.nextPage()} disabled={!table.getCanNextPage()} aria-label={t('Next page')}><ChevronRight /></Button>
          <Button variant="outline" size="icon-sm" onClick={() => table.setPageIndex(table.getPageCount() - 1)} disabled={!table.getCanNextPage()} aria-label={t('Last page')}><ChevronsRight /></Button>
        </div>
      </div>
    </div>
  )
}
