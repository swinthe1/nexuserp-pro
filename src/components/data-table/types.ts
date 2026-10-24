import type { Row, RowData } from '@tanstack/react-table'

declare module '@tanstack/react-table' {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  interface ColumnMeta<TData extends RowData, TValue> {
    /** Header text used in the column menu and exports when header is not a string */
    label?: string
    /** Value written to CSV/PDF (defaults to the accessor value) */
    exportValue?: (row: TData) => string | number | null | undefined
    /** Right-align numeric columns */
    align?: 'left' | 'right'
    /** Exclude from export (e.g. action columns) */
    noExport?: boolean
    className?: string
  }
}

export interface FacetOption { label: string; value: string; icon?: React.ComponentType<{ className?: string }> }
export interface FacetedFilterDef { columnId: string; title: string; options: FacetOption[] }

export interface TableViewConfig {
  columnVisibility?: Record<string, boolean>
  sorting?: { id: string; desc: boolean }[]
  columnFilters?: { id: string; value: unknown }[]
  globalFilter?: string
  pageSize?: number
}

export type BulkActionsRender<T> = (rows: Row<T>[], clear: () => void) => React.ReactNode
