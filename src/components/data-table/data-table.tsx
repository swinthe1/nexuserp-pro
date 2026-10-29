import {
  flexRender, getCoreRowModel, getFacetedRowModel, getFacetedUniqueValues, getFilteredRowModel, getPaginationRowModel,
  getSortedRowModel, useReactTable,
  type ColumnDef, type ColumnFiltersState, type FilterFn, type PaginationState, type Row, type RowSelectionState,
  type SortingState, type Table as TanTable, type VisibilityState,
} from '@tanstack/react-table'
import { Download, FileSpreadsheet, FileText, MoreHorizontal, Search, X } from 'lucide-react'
import * as React from 'react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { EmptyState } from '@/components/empty-state'
import { describeError } from '@/lib/errors'
import { exportCsv, exportPdf, exportXlsx, type ExportColumn } from '@/lib/export'
import { cn } from '@/lib/utils'
import { usePhone } from '@/hooks/use-phone'
import { FacetedFilter } from './faceted-filter'
import { Pagination } from './pagination'
import { SavedViews, useSavedViews } from './saved-views'
import type { BulkActionsRender, FacetedFilterDef, TableViewConfig } from './types'
import { ViewOptions } from './view-options'

/** Filter fn for faceted (multi-value) filters */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const inFilter: FilterFn<any> = (row, id, value: string[]) => !value?.length || value.includes(String(row.getValue(id)))

/** Leading checkbox column for bulk actions */
export function selectColumn<T>(): ColumnDef<T> {
  return {
    id: '_select',
    enableSorting: false,
    enableHiding: false,
    meta: { noExport: true },
    header: ({ table }) => (
      <Checkbox
        checked={table.getIsAllPageRowsSelected() ? true : table.getIsSomePageRowsSelected() ? 'indeterminate' : false}
        onCheckedChange={(v) => table.toggleAllPageRowsSelected(!!v)}
        aria-label={t('Select all rows on this page')}
      />
    ),
    cell: ({ row }) => (
      <Checkbox
        checked={row.getIsSelected()}
        onCheckedChange={(v) => row.toggleSelected(!!v)}
        onClick={(e) => e.stopPropagation()}
        aria-label={t('Select row')}
      />
    ),
  }
}

export interface ServerSideOptions {
  rowCount: number
  pagination: PaginationState
  onPaginationChange: (p: PaginationState) => void
  sorting: SortingState
  onSortingChange: (s: SortingState) => void
  globalFilter: string
  onGlobalFilterChange: (v: string) => void
  columnFilters: ColumnFiltersState
  onColumnFiltersChange: (f: ColumnFiltersState) => void
}

export interface DataTableProps<T> {
  columns: ColumnDef<T, any>[]
  data: T[] | undefined
  isLoading?: boolean
  error?: unknown
  getRowId?: (row: T) => string
  /** enables saved views + remembers column visibility */
  tableKey?: string
  searchPlaceholder?: string
  facets?: FacetedFilterDef[]
  initialSorting?: SortingState
  initialHidden?: string[]
  /** filters applied on first render, e.g. from a URL parameter */
  initialFilters?: ColumnFiltersState
  bulkActions?: BulkActionsRender<T>
  toolbar?: React.ReactNode
  onRowClick?: (row: T) => void
  exportName?: string
  empty?: { title: string; description?: string; action?: React.ReactNode }
  server?: ServerSideOptions
  footer?: (table: TanTable<T>) => React.ReactNode
  dense?: boolean
}

function exportColumnsFor<T>(table: TanTable<T>): ExportColumn<T>[] {
  return table.getVisibleLeafColumns()
    .filter((c) => !c.columnDef.meta?.noExport)
    .map((c) => ({
      header: c.columnDef.meta?.label ?? (typeof c.columnDef.header === 'string' ? c.columnDef.header : c.id),
      value: (row: T) => {
        const m = c.columnDef.meta?.exportValue
        if (m) return m(row)
        const fn = (c.columnDef as { accessorFn?: (r: T, i: number) => unknown }).accessorFn
        const v = fn ? fn(row, 0) : (row as Record<string, unknown>)[c.id]
        return v === null || v === undefined ? '' : (typeof v === 'object' ? JSON.stringify(v) : (v as string | number))
      },
    }))
}

export function DataTable<T>({
  columns, data, isLoading, error, getRowId, tableKey, searchPlaceholder, facets = [], initialSorting = [],
  initialHidden = [], initialFilters, bulkActions, toolbar, onRowClick, exportName, empty, server, footer, dense,
}: DataTableProps<T>) {
  const storageKey = tableKey ? `drispro.table.${tableKey}.columns` : null
  const [sorting, setSorting] = React.useState<SortingState>(initialSorting)
  const [columnFilters, setColumnFilters] = React.useState<ColumnFiltersState>(initialFilters ?? [])
  const [globalFilter, setGlobalFilter] = React.useState('')
  const [rowSelection, setRowSelection] = React.useState<RowSelectionState>({})
  const [pagination, setPagination] = React.useState<PaginationState>({ pageIndex: 0, pageSize: 25 })
  const [columnVisibility, setColumnVisibility] = React.useState<VisibilityState>(() => {
    const base = Object.fromEntries(initialHidden.map((id) => [id, false]))
    if (!storageKey) return base
    try { return { ...base, ...JSON.parse(localStorage.getItem(storageKey) ?? '{}') } } catch { return base }
  })

  React.useEffect(() => {
    if (storageKey) try { localStorage.setItem(storageKey, JSON.stringify(columnVisibility)) } catch { /* ignore */ }
  }, [storageKey, columnVisibility])

  const table = useReactTable<T>({
    data: data ?? [],
    columns,
    getRowId,
    state: {
      sorting: server ? server.sorting : sorting,
      columnFilters: server ? server.columnFilters : columnFilters,
      globalFilter: server ? server.globalFilter : globalFilter,
      pagination: server ? server.pagination : pagination,
      rowSelection,
      columnVisibility,
    },
    manualPagination: !!server,
    manualSorting: !!server,
    manualFiltering: !!server,
    rowCount: server?.rowCount,
    enableRowSelection: !!bulkActions,
    onSortingChange: (u) => (server ? server.onSortingChange(typeof u === 'function' ? u(server.sorting) : u) : setSorting(u)),
    onColumnFiltersChange: (u) => {
      if (server) server.onColumnFiltersChange(typeof u === 'function' ? u(server.columnFilters) : u)
      else { setColumnFilters(u); setPagination((p) => ({ ...p, pageIndex: 0 })) }
    },
    onGlobalFilterChange: (v: string) => {
      if (server) server.onGlobalFilterChange(v)
      else { setGlobalFilter(v); setPagination((p) => ({ ...p, pageIndex: 0 })) }
    },
    onPaginationChange: (u) => (server ? server.onPaginationChange(typeof u === 'function' ? u(server.pagination) : u) : setPagination(u)),
    onRowSelectionChange: setRowSelection,
    onColumnVisibilityChange: setColumnVisibility,
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: server ? undefined : getFilteredRowModel(),
    getSortedRowModel: server ? undefined : getSortedRowModel(),
    getPaginationRowModel: server ? undefined : getPaginationRowModel(),
    getFacetedRowModel: getFacetedRowModel(),
    getFacetedUniqueValues: getFacetedUniqueValues(),
    // reset manually on filter change; the auto-reset schedules a state update before mount
    autoResetPageIndex: false,
  })

  // apply the user's default saved view once
  const views = useSavedViews(tableKey)
  const appliedDefault = React.useRef(false)
  const applyView = React.useCallback((c: TableViewConfig) => {
    if (c.columnVisibility) table.setColumnVisibility(c.columnVisibility)
    table.setSorting(c.sorting ?? [])
    table.setColumnFilters(c.columnFilters ?? [])
    table.setGlobalFilter(c.globalFilter ?? '')
    if (c.pageSize) table.setPageSize(c.pageSize)
  }, [table])
  React.useEffect(() => {
    if (appliedDefault.current || !views.data) return
    appliedDefault.current = true
    const def = views.data.find((v) => v.is_default)
    if (def) applyView(def.config)
  }, [views.data, applyView])

  const state = table.getState()
  // "nothing matches these filters" only when there is something to filter; an empty list says how to start
  const filtered = (!!state.globalFilter || state.columnFilters.length > 0) && (server ? true : (data?.length ?? 0) > 0)
  const selectedRows = table.getSelectedRowModel().rows
  const rowCount = server ? server.rowCount : table.getFilteredRowModel().rows.length
  const visibleCols = table.getVisibleLeafColumns().length
  const phone = usePhone()

  const doExport = async (kind: 'csv' | 'xlsx' | 'pdf') => {
    const rows: T[] = (selectedRows.length ? selectedRows : table.getPrePaginationRowModel().rows).map((r: Row<T>) => r.original)
    const cols = exportColumnsFor(table)
    // the page heading is already in the reader's language; use it for the file and the PDF title
    const heading = typeof document !== 'undefined' ? document.querySelector('main h1')?.textContent?.trim() : undefined
    const title = heading || (exportName ?? tableKey ?? t('Export'))
    const name = exportName ?? (heading ? heading.replace(/[\\/:*?"<>|]+/g, ' ').trim() : tableKey ?? 'export')
    if (kind === 'csv') exportCsv(rows, cols, name)
    else if (kind === 'xlsx') await exportXlsx(rows, cols.map((c) => ({ ...c, format: 'qty' as const })), name, { sheet: title, title: [title] })
    else await exportPdf(rows, cols, name, title)
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-full max-sm:w-[calc(100%-3rem)] sm:w-64">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={state.globalFilter ?? ''}
            onChange={(e) => table.setGlobalFilter(e.target.value)}
            placeholder={searchPlaceholder ?? t('Search…')}
            className="h-8 pl-8 text-[13px] max-sm:h-10 max-sm:text-base"
            aria-label={t('Search the list')}
          />
        </div>
        {/* on a phone the list comes first: saving views and choosing columns mean nothing for cards, export sits behind one button */}
        {phone && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="icon" className="size-10 shrink-0" aria-label={t('More')}><MoreHorizontal /></Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem disabled={!rowCount} onSelect={() => void doExport('xlsx')}><FileSpreadsheet /> {t('Export')} Excel</DropdownMenuItem>
              <DropdownMenuItem disabled={!rowCount} onSelect={() => void doExport('pdf')}><FileText /> {t('Export')} PDF</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
        {facets.map((f) => {
          const col = table.getColumn(f.columnId)
          return col ? <FacetedFilter key={f.columnId} column={col} title={f.title} options={f.options} /> : null
        })}
        {filtered && (
          <Button variant="ghost" size="sm" onClick={() => { table.resetColumnFilters(); table.setGlobalFilter('') }}>
            {t('Reset')} <X />
          </Button>
        )}
        <div className="ml-auto flex max-w-full flex-wrap items-center justify-end gap-2">
          {toolbar}
          {tableKey && !phone && (
            <SavedViews
              tableKey={tableKey}
              onApply={applyView}
              current={() => ({
                columnVisibility: state.columnVisibility, sorting: state.sorting, columnFilters: state.columnFilters,
                globalFilter: state.globalFilter, pageSize: state.pagination.pageSize,
              })}
            />
          )}
          {!phone && <ViewOptions table={table} />}
          {!phone && <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" disabled={!rowCount}><Download /> {t('Export')}</Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={() => void doExport('xlsx')}><FileSpreadsheet /> Excel {selectedRows.length ? t('({n} selected)', { n: selectedRows.length }) : ''}</DropdownMenuItem>
              <DropdownMenuItem onSelect={() => void doExport('csv')}><FileSpreadsheet /> CSV {selectedRows.length ? t('({n} selected)', { n: selectedRows.length }) : ''}</DropdownMenuItem>
              <DropdownMenuItem onSelect={() => void doExport('pdf')}><FileText /> PDF {selectedRows.length ? t('({n} selected)', { n: selectedRows.length }) : ''}</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>}
        </div>
      </div>

      {/* a list that opens filtered says so, so nobody thinks records are missing */}
      {state.columnFilters.length > 0 && !isLoading && (
        <div className="-mt-1 flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
          <span>{tn(state.columnFilters.length, 'A filter is on: not everything is shown.', '{n} filters are on: not everything is shown.')}</span>
          <button type="button" className="font-medium text-primary hover:underline" onClick={() => table.resetColumnFilters()}>{t('Show all')}</button>
        </div>
      )}

      {bulkActions && selectedRows.length > 0 && (
        <div className="flex items-center gap-2 rounded-md border border-primary/30 bg-accent/60 px-3 py-1.5 text-[13px]">
          <span className="font-medium">{t('{n} selected', { n: selectedRows.length })}</span>
          <div className="flex items-center gap-1.5">{bulkActions(selectedRows, () => table.resetRowSelection())}</div>
          <Button variant="ghost" size="xs" className="ml-auto" onClick={() => table.resetRowSelection()}>{t('Clear')}</Button>
        </div>
      )}

      {phone ? (
        <PhoneCards table={table} isLoading={isLoading} error={error} onRowClick={onRowClick} selectable={!!bulkActions}
          emptyNode={filtered ? (
            <EmptyState compact title={t('Nothing matches these filters')} description={t('Clear the search or filters to see everything.')}
              action={<Button variant="outline" size="sm" onClick={() => { table.resetColumnFilters(); table.setGlobalFilter('') }}>{t('Clear filters')}</Button>} />
          ) : (
            <EmptyState compact title={empty?.title ?? t('Nothing here yet')} description={empty?.description} action={empty?.action} />
          )}
          footer={footer && !isLoading ? footer(table) : null} />
      ) : (
      <div className="overflow-hidden rounded-lg border bg-card">
        <Table>
          <TableHeader>
            {table.getHeaderGroups().map((hg) => (
              <TableRow key={hg.id} className="hover:bg-transparent">
                {hg.headers.map((h) => (
                  <TableHead key={h.id} className={cn(h.column.columnDef.meta?.align === 'right' && 'text-right', h.column.columnDef.meta?.className)}>
                    {h.isPlaceholder ? null : flexRender(h.column.columnDef.header, h.getContext())}
                  </TableHead>
                ))}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {isLoading &&
              Array.from({ length: 8 }).map((_, i) => (
                <TableRow key={`sk-${i}`} className="hover:bg-transparent">
                  {Array.from({ length: visibleCols }).map((__, j) => (
                    <TableCell key={j}><Skeleton className={cn('h-4', j === 0 ? 'w-4' : 'w-full max-w-[160px]')} /></TableCell>
                  ))}
                </TableRow>
              ))}
            {!isLoading && !!error && (
              <TableRow className="hover:bg-transparent">
                <TableCell colSpan={visibleCols} className="h-40 text-center text-sm text-destructive">{describeError(error)}</TableCell>
              </TableRow>
            )}
            {!isLoading && !error && table.getRowModel().rows.map((row) => (
              <TableRow
                key={row.id}
                data-state={row.getIsSelected() ? 'selected' : undefined}
                className={cn(onRowClick && 'cursor-pointer')}
                tabIndex={onRowClick ? 0 : undefined}
                onClick={onRowClick ? () => onRowClick(row.original) : undefined}
                onKeyDown={onRowClick ? (e) => { if (e.key === 'Enter') onRowClick(row.original) } : undefined}
              >
                {row.getVisibleCells().map((cell) => (
                  <TableCell
                    key={cell.id}
                    className={cn('whitespace-nowrap', dense && 'h-8 py-1', cell.column.columnDef.meta?.align === 'right' && 'text-right tabular', cell.column.columnDef.meta?.className)}
                  >
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </TableCell>
                ))}
              </TableRow>
            ))}
            {!isLoading && !error && table.getRowModel().rows.length === 0 && (
              <TableRow className="hover:bg-transparent">
                <TableCell colSpan={visibleCols} className="p-0">
                  {filtered ? (
                    <EmptyState compact title={t('Nothing matches these filters')} description={t('Clear the search or filters to see everything.')}
                      action={<Button variant="outline" size="sm" onClick={() => { table.resetColumnFilters(); table.setGlobalFilter('') }}>{t('Clear filters')}</Button>} />
                  ) : (
                    <EmptyState compact title={empty?.title ?? t('Nothing here yet')} description={empty?.description} action={empty?.action} />
                  )}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
          {footer && !isLoading && footer(table)}
        </Table>
      </div>
      )}
      <Pagination table={table} rowCount={rowCount} />
    </div>
  )
}

/* ------------------------------------------------------------------ phone: one card per row */

// the column's name: meta.label, a string header, or the title given to ColumnHeader
function columnLabel<T>(table: TanTable<T>, colId: string): string {
  const col = table.getColumn(colId)
  if (!col) return ''
  const d = col.columnDef
  if (d.meta?.label) return d.meta.label
  if (typeof d.header === 'string') return d.header
  if (typeof d.header === 'function') {
    const h = table.getFlatHeaders().find((x) => x.column.id === colId)
    try {
      const el = h ? (d.header as (c: unknown) => unknown)(h.getContext()) : null
      const title = React.isValidElement(el) ? (el.props as { title?: unknown }).title : null
      if (typeof title === 'string') return title
    } catch { /* a header that needs more than its context */ }
  }
  return ''
}

function PhoneCards<T>({ table, isLoading, error, onRowClick, selectable, emptyNode, footer }: {
  table: TanTable<T>; isLoading?: boolean; error?: unknown; onRowClick?: (row: T) => void; selectable: boolean
  emptyNode: React.ReactNode; footer: React.ReactNode
}) {
  const cols = table.getVisibleLeafColumns().filter((c) => c.id !== '_select' && c.columnDef.meta?.mobile !== 'hide')
  const labels = Object.fromEntries(cols.map((c) => [c.id, columnLabel(table, c.id)]))
  // the column a list never hides is its main one (the name, the number)
  const title = cols.find((c) => c.columnDef.meta?.mobile === 'title') ?? cols.find((c) => c.columnDef.enableHiding === false && labels[c.id]) ?? cols.find((c) => labels[c.id]) ?? cols[0]
  const rights = cols.filter((c) => c.columnDef.meta?.align === 'right')
  // the money a card leads with: the one the list names, else its total, else the last number; its name goes under it
  const amount = cols.find((c) => c.columnDef.meta?.mobile === 'amount') ?? rights.find((c) => /(^|_)total/i.test(c.id)) ?? rights[rights.length - 1]
  const status = cols.find((c) => c !== title && /(^|_)(status|state)$/i.test(c.id))
  const actions = cols.filter((c) => !labels[c.id] && c !== title)
  const rest = cols.filter((c) => c !== title && c !== amount && c !== status && !actions.includes(c)).slice(0, 4)
  const rows = table.getRowModel().rows
  const cell = (row: Row<T>, colId?: string) => {
    const c = colId ? row.getVisibleCells().find((x) => x.column.id === colId) : undefined
    return c ? flexRender(c.column.columnDef.cell, c.getContext()) : null
  }

  if (isLoading) return <div className="grid gap-2">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-24 w-full rounded-lg" />)}</div>
  if (error) return <div className="rounded-lg border bg-card p-6 text-center text-sm text-destructive">{describeError(error)}</div>
  if (!rows.length) return <div className="rounded-lg border bg-card">{emptyNode}</div>
  return (
    <div className="grid gap-2">
      <ul className="grid gap-2" aria-label={t('List')}>
        {rows.map((row) => (
          <li
            key={row.id}
            data-state={row.getIsSelected() ? 'selected' : undefined}
            className={cn('rounded-lg border bg-card p-3 data-[state=selected]:border-primary/50 data-[state=selected]:bg-accent/40', onRowClick && 'cursor-pointer active:bg-secondary')}
            tabIndex={onRowClick ? 0 : undefined}
            onClick={onRowClick ? () => onRowClick(row.original) : undefined}
            onKeyDown={onRowClick ? (e) => { if (e.key === 'Enter') onRowClick(row.original) } : undefined}
          >
            <div className="flex items-start gap-3">
              {selectable && (
                <span className="-m-2 p-2" onClick={(e) => e.stopPropagation()}>
                  <Checkbox checked={row.getIsSelected()} onCheckedChange={(v) => row.toggleSelected(!!v)} aria-label={t('Select row')} className="size-5" />
                </span>
              )}
              <div className="min-w-0 flex-1 text-[15px] font-medium [&_*]:whitespace-normal">{cell(row, title?.id)}</div>
              {amount && <div className="shrink-0 text-right text-[15px] font-semibold tabular">{cell(row, amount.id)}{labels[amount.id] && <div className="max-w-[9rem] truncate text-[11px] font-normal text-muted-foreground">{labels[amount.id]}</div>}</div>}
            </div>
            {(status || rest.length > 0 || actions.length > 0) && (
              <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1.5 text-[13px]">
                {status && <div className="col-span-2">{cell(row, status.id)}</div>}
                {rest.map((c) => (
                  <div key={c.id} className="min-w-0 max-w-full">
                    <div className="text-[11px] text-muted-foreground">{labels[c.id]}</div>
                    <div className="truncate [&_*]:whitespace-normal">{cell(row, c.id)}</div>
                  </div>
                ))}
                {actions.length > 0 && <div className="col-span-2 flex items-center justify-end gap-1" onClick={(e) => e.stopPropagation()}>{actions.map((c) => <React.Fragment key={c.id}>{cell(row, c.id)}</React.Fragment>)}</div>}
              </div>
            )}
          </li>
        ))}
      </ul>
      {footer && <div className="overflow-x-auto rounded-lg border bg-card"><Table>{footer}</Table></div>}
    </div>
  )
}

export { ColumnHeader } from './column-header'

import { t, tn } from '@/i18n'
