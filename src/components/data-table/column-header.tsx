import type { Column } from '@tanstack/react-table'
import { ArrowDown, ArrowUp, ChevronsUpDown, EyeOff } from 'lucide-react'
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'
import { t } from '@/i18n'

export function ColumnHeader<TData, TValue>({ column, title, className }: { column: Column<TData, TValue>; title: string; className?: string }) {
  const right = column.columnDef.meta?.align === 'right'
  if (!column.getCanSort() && !column.getCanHide()) {
    return <div className={cn(right && 'text-right', className)}>{title}</div>
  }
  const sorted = column.getIsSorted()
  return (
    <div className={cn('flex', right && 'justify-end', className)}>
      <DropdownMenu>
        <DropdownMenuTrigger
          className={cn('-mx-1.5 flex h-7 items-center gap-1 rounded px-1.5 hover:bg-secondary hover:text-foreground data-[state=open]:bg-secondary', sorted && 'text-foreground')}
          aria-label={t('{title}: sort or hide', { title: typeof title === 'string' ? title : '' })}
        >
          {title}
          {sorted === 'desc' ? <ArrowDown className="size-3.5" /> : sorted === 'asc' ? <ArrowUp className="size-3.5" /> : <ChevronsUpDown className="size-3.5 opacity-50" />}
        </DropdownMenuTrigger>
        <DropdownMenuContent align={right ? 'end' : 'start'}>
          {column.getCanSort() && (
            <>
              <DropdownMenuItem onSelect={() => column.toggleSorting(false)}><ArrowUp /> {t('Ascending')}</DropdownMenuItem>
              <DropdownMenuItem onSelect={() => column.toggleSorting(true)}><ArrowDown /> {t('Descending')}</DropdownMenuItem>
            </>
          )}
          {column.getCanHide() && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => column.toggleVisibility(false)}><EyeOff /> {t('Hide column')}</DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}
