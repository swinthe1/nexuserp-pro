import {
  flexRender, getCoreRowModel, getFacetedRowModel, getFacetedUniqueValues, getFilteredRowModel, getPaginationRowModel,
  getSortedRowModel, useReactTable,
  type ColumnDef, type ColumnFiltersState, type ColumnOrderState, type ColumnSizingState, type FilterFn, type PaginationState, type Row, type RowSelectionState,
  type SortingState, type Table as TanTable, type VisibilityState,
} from '@tanstack/react-table'
import { Download, Eye, FileSpreadsheet, FileText, FolderDown, History, MoreHorizontal, Printer, Search, X } from 'lucide-react'
import * as React from 'react'
import { fuzzyFind } from '@/lib/fuzzy'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { EmptyState } from '@/components/empty-state'
import { describeError } from '@/lib/errors'
import { exportCsv, exportPdf, exportXlsx, type ExportColumn } from '@/lib/export'
import { printTable } from '@/lib/print-table'
import { cn } from '@/lib/utils'
import { usePhone } from '@/hooks/use-phone'
import { FacetedFilter } from './faceted-filter'
import { Pagination } from './pagination'
import { SavedViews, useSavedViews } from './saved-views'
import { useActiveUnit } from '@/app/active-unit'
import type { BulkActionsRender, FacetedFilterDef, RowPreview, TableLayout, TableViewConfig } from './types'
import { PreviewSheet } from './preview-sheet'
import { ColumnTools, RuleChips } from './column-tools'
import { COLOURS, gettersOf, kindOf, ruleIsSet, test, type Colour, type ColumnStyle, type Getter, type Kind, type Rule } from './rules'
import { tableLayoutKey, useProfilePref } from '@/components/layout/nav-prefs'
import { downloadExport, useMyExports } from '@/lib/my-exports'
import { Link } from 'react-router-dom'
import { ViewOptions } from './view-options'
import { useCopyMenu, type CopyGrid } from './copy-menu'

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
  /** the quick look at a row (the eye at its end); a list that opens rows gets the row's fields without it */
  preview?: (row: T) => RowPreview | null
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

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
/** what a row says, for the search box: its words and its codes, not its internal ids */
function rowSearchText(row: object): { text: string; codes: string[] } {
  const parts: string[] = []
  const add = (k: string, v: unknown, depth: number) => {
    if (v == null || k === 'id' || k.endsWith('_id')) return
    if (typeof v === 'string') { if (!UUID.test(v)) parts.push(v) }
    else if (typeof v === 'number') parts.push(String(v))
    else if (depth < 1 && typeof v === 'object') for (const [k2, v2] of Object.entries(v as Record<string, unknown>)) add(k2, v2, depth + 1)
  }
  for (const [k, v] of Object.entries(row)) add(k, v, 0)
  return { text: parts.join(' '), codes: parts }
}

// the quick-look eye is the first cell of every row; a footer row puts LeadCell first to stay in line
const LeadCtx = React.createContext(false)
export function LeadCell() {
  return React.useContext(LeadCtx) ? <TableCell className="w-9 px-1" /> : null
}

export function DataTable<T>({
  columns, data, isLoading, error, getRowId, tableKey, searchPlaceholder, facets = [], initialSorting = [],
  initialHidden = [], initialFilters, bulkActions, toolbar, onRowClick, exportName, empty, server, footer, dense, preview,
}: DataTableProps<T>) {
  const storageKey = tableKey ? `drispro.table.${tableKey}.columns` : null
  const [sorting, setSorting] = React.useState<SortingState>(initialSorting)
  const [columnFilters, setColumnFilters] = React.useState<ColumnFiltersState>(initialFilters ?? [])
  const [globalFilter, setGlobalFilter] = React.useState('')
  // the unit chosen under the company narrows the table by its unit column; "all units" lifts it again
  const { unit: activeUnit, multi: multiUnit } = useActiveUnit()
  const unitFacet = facets.find((f) => f.unit)
  // one unit: its column and filter stay out of the way
  const shownFacets = multiUnit || !unitFacet ? facets : facets.filter((f) => f !== unitFacet)
  const unitValue = React.useMemo(() => {
    if (!unitFacet || !activeUnit) return null
    const names = [activeUnit.id, activeUnit.name, td(activeUnit.name)]
    return unitFacet.options.find((o) => names.includes(o.value) || names.includes(o.label))?.value ?? null
  }, [unitFacet, activeUnit])
  const unitSet = React.useRef<string | null>(null)
  React.useEffect(() => {
    if (!unitFacet || server) return
    const col = unitFacet.columnId
    if (unitValue && unitSet.current !== unitValue) {
      setColumnFilters((fs) => [...fs.filter((f) => f.id !== col), { id: col, value: [unitValue] }])
      unitSet.current = unitValue
    } else if (!activeUnit && unitSet.current) {
      const was = unitSet.current
      setColumnFilters((fs) => fs.filter((f) => !(f.id === col && Array.isArray(f.value) && f.value.length === 1 && f.value[0] === was)))
      unitSet.current = null
    }
  }, [unitValue, activeUnit, unitFacet, server])
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
  // the filters on any column, the order and width of the columns, their colours
  const [rules, setRules] = React.useState<Rule[]>([])
  const [columnOrder, setColumnOrder] = React.useState<ColumnOrderState>([])
  const [columnSizing, setColumnSizing] = React.useState<ColumnSizingState>({})
  const [styles, setStyles] = React.useState<Record<string, ColumnStyle>>({})
  // widening or narrowing a column: from the width it has on the screen now, by how far the mouse moves.
  // The header can also be dragged to move the column, so while the edge is held that is switched off.
  const resizing = React.useRef(false)
  const [resizingCol, setResizingCol] = React.useState<string | null>(null)
  const startResize = (e: React.PointerEvent<HTMLElement>, id: string) => {
    if (e.button !== 0) return
    e.preventDefault(); e.stopPropagation()
    const th = e.currentTarget.closest('th')
    if (!th) return
    resizing.current = true
    setResizingCol(id)
    const handle = e.currentTarget
    try { handle.setPointerCapture(e.pointerId) } catch { /* old browser */ }
    // the screen size (zoom) makes a mouse step bigger or smaller than a point of the page
    const scale = th.getBoundingClientRect().width / (th.offsetWidth || 1) || 1
    const start = th.offsetWidth, x0 = e.clientX
    const body = document.body.style, cursor = body.cursor, select = body.userSelect
    body.cursor = 'col-resize'; body.userSelect = 'none'
    const move = (ev: PointerEvent) => {
      const w = Math.max(48, Math.min(900, Math.round(start + (ev.clientX - x0) / scale)))
      setColumnSizing((all) => (all[id] === w ? all : { ...all, [id]: w }))
    }
    const up = () => {
      handle.removeEventListener('pointermove', move); handle.removeEventListener('pointerup', up); handle.removeEventListener('pointercancel', up)
      body.cursor = cursor; body.userSelect = select
      setResizingCol(null)
      window.setTimeout(() => { resizing.current = false }, 0)
    }
    handle.addEventListener('pointermove', move); handle.addEventListener('pointerup', up); handle.addEventListener('pointercancel', up)
  }
  // the layout is the person's own, on their profile: read once, written a moment after each change
  const layout = useProfilePref<TableLayout>(tableKey ? tableLayoutKey(tableKey) : null)
  const layoutRead = React.useRef(false)
  React.useEffect(() => {
    if (layoutRead.current || !layout.loaded) return
    layoutRead.current = true
    const l = layout.value
    if (!l) return
    if (l.order) setColumnOrder(l.order)
    if (l.sizing) setColumnSizing(l.sizing)
    if (l.visibility) setColumnVisibility((v) => ({ ...v, ...l.visibility }))
    if (l.styles) setStyles(l.styles)
  }, [layout.loaded, layout.value])
  React.useEffect(() => {
    if (!tableKey || !layoutRead.current) return
    const id = window.setTimeout(() => layout.set({ order: columnOrder.length ? columnOrder : undefined, sizing: Object.keys(columnSizing).length ? columnSizing : undefined,
      visibility: columnVisibility, styles: Object.keys(styles).length ? styles : undefined }), 700)
    return () => window.clearTimeout(id)
  }, [columnOrder, columnSizing, columnVisibility, styles]) // eslint-disable-line react-hooks/exhaustive-deps

  const getters = React.useMemo(() => gettersOf(columns as ColumnDef<never, unknown>[], () => ''), [columns])
  const getterById = React.useMemo(() => new Map(getters.map((g) => [g.id, g])), [getters])
  const kinds = React.useMemo(() => new Map<string, Kind>(getters.map((g) => [g.id, kindOf(g, data ?? [])])), [getters, data])
  const liveRules = React.useMemo(() => rules.filter((r) => getterById.has(r.col) && ruleIsSet(r)), [rules, getterById])
  const setRule = (col: string, r: Rule | null) => { setRules((rs) => [...rs.filter((x) => x.col !== col), ...(r ? [r] : [])]); setPagination((p) => ({ ...p, pageIndex: 0 })) }

  // the list's search box forgives (lib/fuzzy): typos, ë/ç, words in any order, across every column
  const deferredSearch = React.useDeferredValue(globalFilter)
  const shown = React.useMemo(() => {
    if (server || !data) return data
    const kept = liveRules.length ? data.filter((row) => liveRules.every((r) => test(r, getterById.get(r.col)!, kinds.get(r.col) ?? 'text', row))) : data
    return deferredSearch.trim() ? fuzzyFind(kept as (T & object)[], deferredSearch, rowSearchText) : kept
  }, [server, data, deferredSearch, liveRules, getterById, kinds])

  const table = useReactTable<T>({
    data: shown ?? [],
    globalFilterFn: () => true,
    columns,
    getRowId,
    state: {
      sorting: server ? server.sorting : sorting,
      columnFilters: server ? server.columnFilters : columnFilters,
      globalFilter: server ? server.globalFilter : globalFilter,
      pagination: server ? server.pagination : pagination,
      rowSelection,
      columnVisibility: !multiUnit && unitFacet ? { ...columnVisibility, [unitFacet.columnId]: false } : columnVisibility,
      columnOrder,
      columnSizing,
    },
    enableColumnResizing: true,
    columnResizeMode: 'onChange',
    onColumnOrderChange: setColumnOrder,
    onColumnSizingChange: setColumnSizing,
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
    setRules(c.rules ?? [])
    if (c.columnOrder) setColumnOrder(c.columnOrder)
    if (c.columnSizing) setColumnSizing(c.columnSizing)
    if (c.styles) setStyles(c.styles)
  }, [table])
  React.useEffect(() => {
    if (appliedDefault.current || !views.data) return
    appliedDefault.current = true
    const def = views.data.find((v) => v.is_default)
    if (def) applyView(def.config)
  }, [views.data, applyView])

  const state = table.getState()
  // "nothing matches these filters" only when there is something to filter; an empty list says how to start
  const filtered = (!!state.globalFilter || state.columnFilters.length > 0 || liveRules.length > 0) && (server ? true : (data?.length ?? 0) > 0)
  const clearAll = () => { table.resetColumnFilters(); table.setGlobalFilter(''); setRules([]) }
  // a column dragged onto another takes its place
  const [dragCol, setDragCol] = React.useState<string | null>(null)
  const dropCol = (to: string) => {
    const from = dragCol; setDragCol(null)
    if (!from || from === to) return
    const ids = table.getAllLeafColumns().map((c) => c.id)
    const cur = columnOrder.length ? [...columnOrder.filter((id) => ids.includes(id)), ...ids.filter((id) => !columnOrder.includes(id))] : ids
    const o = cur.filter((id) => id !== from)
    o.splice(o.indexOf(to) + (cur.indexOf(from) < cur.indexOf(to) ? 1 : 0), 0, from)
    setColumnOrder(o)
  }
  // the colours of a row: the column's own, or the first rule that fits (a "whole row" rule colours every cell)
  const paint = (row: T) => {
    let rowColour: Colour | undefined
    const cells: Record<string, { colour?: Colour; bold?: boolean }> = {}
    for (const [col, st] of Object.entries(styles)) {
      const g = getterById.get(col); if (!g) continue
      const hit = st.when?.find((w) => ruleIsSet(w) && test(w, g, kinds.get(col) ?? 'text', row))
      if (hit?.row) rowColour ??= hit.colour
      cells[col] = { colour: hit && !hit.row ? hit.colour : st.colour, bold: st.bold }
    }
    return { rowColour, cells }
  }
  const canPreview = !!preview || !!onRowClick
  const [peek, setPeek] = React.useState<number | null>(null)
  const peekRows = canPreview && peek != null ? table.getPrePaginationRowModel().rows.map((r) => r.original) : []
  const labelled = React.useMemo(() => new Map(getters.map((g) => [g.id, { ...g, label: columnLabel(table, g.id) || g.id }])), [getters, table])
  const selectedRows = table.getSelectedRowModel().rows
  const rowCount = server ? server.rowCount : table.getFilteredRowModel().rows.length
  const visibleCols = table.getVisibleLeafColumns().length
  const phone = usePhone()

  const gridOf = (rows: T[], only?: string): CopyGrid => {
    const cols = exportColumnsFor(table).filter((_, i) => !only || table.getVisibleLeafColumns().filter((c) => !c.columnDef.meta?.noExport)[i]?.id === only)
    return { header: cols.map((c) => c.header), rows: rows.map((r) => cols.map((c) => c.value(r))) }
  }
  const copy = useCopyMenu({
    headers: () => Object.fromEntries(table.getVisibleLeafColumns().map((c) => [c.id, c.columnDef.meta?.label ?? (typeof c.columnDef.header === 'string' ? c.columnDef.header : '')])),
    column: (id) => gridOf(table.getPrePaginationRowModel().rows.map((r) => r.original), id),
    table: () => gridOf(table.getPrePaginationRowModel().rows.map((r) => r.original)),
    selected: () => (selectedRows.length ? gridOf(selectedRows.map((r) => r.original)) : null),
  })

  const doExport = async (kind: 'csv' | 'xlsx' | 'pdf' | 'print') => {
    const rows: T[] = (selectedRows.length ? selectedRows : table.getPrePaginationRowModel().rows).map((r: Row<T>) => r.original)
    const cols = exportColumnsFor(table)
    // the page heading is already in the reader's language; use it for the file and the PDF title
    const heading = typeof document !== 'undefined' ? document.querySelector('main h1')?.textContent?.trim() : undefined
    const title = heading || (exportName ?? tableKey ?? t('Export'))
    const name = exportName ?? (heading ? heading.replace(/[\\/:*?"<>|]+/g, ' ').trim() : tableKey ?? 'export')
    if (kind === 'print') printTable({ title, columns: cols.map((c) => ({ header: c.header })), rows: rows.map((r) => cols.map((c) => c.value(r))) })
    else if (kind === 'csv') exportCsv(rows, cols, name)
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
              <DropdownMenuItem disabled={!rowCount} onSelect={() => void doExport('csv')}><FileSpreadsheet /> {t('Export')} CSV</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
        {shownFacets.map((f) => {
          const col = table.getColumn(f.columnId)
          return col ? <FacetedFilter key={f.columnId} column={col} title={f.title} options={f.options} /> : null
        })}
        {filtered && (
          <Button variant="ghost" size="sm" onClick={() => clearAll()}>
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
                rules: liveRules, columnOrder, columnSizing, styles,
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
              <DropdownMenuItem onSelect={() => void doExport('pdf')}><FileText /> PDF {selectedRows.length ? t('({n} selected)', { n: selectedRows.length }) : ''}</DropdownMenuItem>
              <DropdownMenuItem onSelect={() => void doExport('csv')}><FileSpreadsheet /> CSV {selectedRows.length ? t('({n} selected)', { n: selectedRows.length }) : ''}</DropdownMenuItem>
              <DropdownMenuItem onSelect={() => void doExport('print')}><Printer /> {t('Print')} {selectedRows.length ? t('({n} selected)', { n: selectedRows.length }) : ''}</DropdownMenuItem>
              <LastExports />
            </DropdownMenuContent>
          </DropdownMenu>}
        </div>
      </div>

      <RuleChips rules={liveRules} getters={labelled} onRemove={(col) => setRule(col, null)} onClear={() => setRules([])} />
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
              action={<Button variant="outline" size="sm" onClick={() => clearAll()}>{t('Clear filters')}</Button>} />
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
                {canPreview && <TableHead className="w-9 px-1"><span className="sr-only">{t('Preview')}</span></TableHead>}
                {hg.headers.map((h) => {
                  const g = labelled.get(h.column.id)
                  const right = h.column.columnDef.meta?.align === 'right'
                  const sized = columnSizing[h.column.id]
                  return (
                    <TableHead key={h.id} style={sized ? { width: sized, minWidth: sized, maxWidth: sized } : undefined}
                      className={cn('group/th relative', right && 'text-right', h.column.columnDef.meta?.className, dragCol && dragCol !== h.column.id && 'data-[over=true]:bg-accent')}
                      draggable={h.column.id !== '_select'} onDragStart={(e) => { if (resizing.current) { e.preventDefault(); return } setDragCol(h.column.id); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', h.column.id) }}
                      onDragOver={(e) => { if (dragCol) { e.preventDefault(); (e.currentTarget as HTMLElement).dataset.over = 'true' } }}
                      onDragLeave={(e) => { delete (e.currentTarget as HTMLElement).dataset.over }}
                      onDrop={(e) => { e.preventDefault(); delete (e.currentTarget as HTMLElement).dataset.over; dropCol(h.column.id) }} onDragEnd={() => setDragCol(null)}>
                      <div className={cn('flex items-center gap-1', right && 'justify-end')}>
                        {h.isPlaceholder ? null : flexRender(h.column.columnDef.header, h.getContext())}
                        {g && <ColumnTools getter={g} kind={kinds.get(g.id) ?? 'text'} filterable={!server}
                          rule={rules.find((r) => r.col === g.id) ?? null} onRule={(r) => setRule(g.id, r)}
                          style={styles[g.id]} onStyle={(st) => setStyles((all) => { const n = { ...all }; if (st && (st.colour || st.bold || st.when?.length)) n[g.id] = st; else delete n[g.id]; return n })}
                          values={() => distinctTexts(data ?? [], g)} />}
                      </div>
                      {h.column.getCanResize() && h.column.id !== '_select' && (
                        <div data-resize role="separator" aria-orientation="vertical" aria-label={t('Drag to change the width')}
                          onDoubleClick={(e) => { e.stopPropagation(); setColumnSizing((all) => { const n = { ...all }; delete n[h.column.id]; return n }) }}
                          onMouseDown={(e) => { resizing.current = true; e.stopPropagation() }} onPointerDown={(e) => startResize(e, h.column.id)}
                          onClick={(e) => e.stopPropagation()} draggable={false}
                          className="group/rs absolute -right-1.5 group-last/th:right-0 top-0 z-10 flex h-full w-3 cursor-col-resize touch-none select-none justify-center">
                          <span className={cn('my-1 w-[3px] rounded-full bg-border opacity-0 transition-opacity group-hover/th:opacity-100 group-hover/rs:bg-primary/60', resizingCol === h.column.id && 'bg-primary opacity-100')} />
                        </div>
                      )}
                    </TableHead>
                  )
                })}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody onContextMenu={copy.onContextMenu}>
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
                <TableCell colSpan={visibleCols + (canPreview ? 1 : 0)} className="h-40 text-center text-sm text-destructive">{describeError(error)}</TableCell>
              </TableRow>
            )}
            {!isLoading && !error && table.getRowModel().rows.map((row) => { const pt = paint(row.original); return (
              <TableRow
                key={row.id}
                data-state={row.getIsSelected() ? 'selected' : undefined}
                className={cn('group/row', onRowClick && 'cursor-pointer', pt.rowColour && COLOURS[pt.rowColour].cell)}
                tabIndex={onRowClick ? 0 : undefined}
                onClick={onRowClick ? () => onRowClick(row.original) : undefined}
                onKeyDown={onRowClick ? (e) => { if (e.key === 'Enter') onRowClick(row.original); else if (e.key === ' ' && canPreview) { e.preventDefault(); setPeek(table.getPrePaginationRowModel().rows.findIndex((r) => r.id === row.id)) } } : undefined}
              >
                {canPreview && (
                  <TableCell className={cn('w-9 px-1', dense && 'h-8 py-1')}>
                    <button type="button" aria-label={t('Quick look')} title={t('Quick look (without opening)')}
                      className="grid size-7 place-items-center rounded-md text-muted-foreground opacity-40 hover:bg-secondary hover:text-foreground hover:opacity-100 focus-visible:opacity-100 group-hover/row:opacity-100"
                      onClick={(e) => { e.stopPropagation(); setPeek(table.getPrePaginationRowModel().rows.findIndex((r) => r.id === row.id)) }}><Eye className="size-4" /></button>
                  </TableCell>
                )}
                {row.getVisibleCells().map((cell) => {
                  const c = pt.cells[cell.column.id]
                  const sized = columnSizing[cell.column.id]
                  return (
                    <TableCell
                      key={cell.id}
                      data-col={cell.column.id}
                      style={sized ? { maxWidth: sized } : undefined}
                      className={cn('whitespace-nowrap', sized && 'overflow-hidden text-ellipsis', dense && 'h-8 py-1', cell.column.columnDef.meta?.align === 'right' && 'text-right tabular',
                        cell.column.columnDef.meta?.className, c?.colour && !pt.rowColour && COLOURS[c.colour].cell, c?.bold && 'font-semibold')}
                    >
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </TableCell>
                  )
                })}
              </TableRow>
            ) })}
            {!isLoading && !error && table.getRowModel().rows.length === 0 && (
              <TableRow className="hover:bg-transparent">
                <TableCell colSpan={visibleCols + (canPreview ? 1 : 0)} className="p-0">
                  {filtered ? (
                    <EmptyState compact title={t('Nothing matches these filters')} description={t('Clear the search or filters to see everything.')}
                      action={<Button variant="outline" size="sm" onClick={() => clearAll()}>{t('Clear filters')}</Button>} />
                  ) : (
                    <EmptyState compact title={empty?.title ?? t('Nothing here yet')} description={empty?.description} action={empty?.action} />
                  )}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
          {footer && !isLoading && <LeadCtx.Provider value={canPreview}>{footer(table)}</LeadCtx.Provider>}
        </Table>
      </div>
      )}
      {!phone && copy.menu}
      <Pagination table={table} rowCount={rowCount} />
      {canPreview && peek != null && peek >= 0 && (
        <PreviewSheet rows={peekRows} index={peek} onIndex={setPeek} onClose={() => setPeek(null)} getters={[...labelled.values()]} preview={preview}
          fields={(i) => {
            const r = table.getPrePaginationRowModel().rows[i]
            return r ? r.getAllCells().filter((c) => c.column.id !== '_select' && labelled.has(c.column.id))
              .map((c) => ({ id: c.column.id, label: labelled.get(c.column.id)!.label, node: flexRender(c.column.columnDef.cell, c.getContext()) })) : []
          }}
          onOpen={onRowClick ? (r) => { setPeek(null); onRowClick(r) } : undefined} />
      )}
    </div>
  )
}

/** under Export: the last file exported from this page, to download again, and all of them */
function LastExports() {
  const list = useMyExports()
  const here = typeof window !== 'undefined' ? window.location.pathname : ''
  const last = list.data?.find((x) => (x.page ?? '').split('?')[0] === here)
  return (
    <>
      <DropdownMenuSeparator />
      {last && <>
        <DropdownMenuLabel className="text-[11px] font-normal text-muted-foreground">{t('Last from this page')}</DropdownMenuLabel>
        <DropdownMenuItem onSelect={() => void downloadExport(last)}><History /> <span className="max-w-[220px] truncate">{last.file_name}</span></DropdownMenuItem>
      </>}
      <DropdownMenuItem asChild><Link to="/exports"><FolderDown /> {t('My exports')}</Link></DropdownMenuItem>
    </>
  )
}

/** the values a column holds, for "is one of": the most frequent first */
function distinctTexts(rows: readonly unknown[], g: Getter): string[] {
  const n = new Map<string, number>()
  for (const r of rows) { const v = g.text(r); n.set(v, (n.get(v) ?? 0) + 1) }
  return [...n.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([v]) => v)
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

import { t, td, tn } from '@/i18n'
