import type { Column } from '@tanstack/react-table'
import { ArrowDown, ArrowUp, ChevronsUpDown } from 'lucide-react'
import { cn } from '@/lib/utils'
import { t } from '@/i18n'

/**
 * A column's heading: a click sorts by it (up, down, then as it was), with the arrow showing which.
 * No menu on the heading: hiding and ordering columns is under "Columns".
 */
export function ColumnHeader<TData, TValue>({ column, title, className }: { column: Column<TData, TValue>; title: string; className?: string }) {
  const right = column.columnDef.meta?.align === 'right'
  if (!column.getCanSort()) {
    return <div className={cn(right && 'text-right', className)}>{title}</div>
  }
  const sorted = column.getIsSorted()
  return (
    <div className={cn('flex', right && 'justify-end', className)}>
      <button type="button" onClick={column.getToggleSortingHandler()}
        className={cn('-mx-1.5 flex min-h-7 items-center gap-1 rounded px-1.5 text-left hover:bg-secondary hover:text-foreground', sorted && 'text-foreground')}
        aria-label={t('Sort by {title}', { title: typeof title === 'string' ? title : '' })}
        aria-sort={sorted === 'asc' ? 'ascending' : sorted === 'desc' ? 'descending' : undefined}>
        {title}
        {sorted === 'desc' ? <ArrowDown className="size-3.5 shrink-0" /> : sorted === 'asc' ? <ArrowUp className="size-3.5 shrink-0" /> : <ChevronsUpDown className="size-3.5 shrink-0 opacity-40" />}
      </button>
    </div>
  )
}
