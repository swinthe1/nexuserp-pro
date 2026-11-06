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
    /** on a phone the list shows cards: 'title' leads the card, 'amount' sits top right, 'hide' leaves it out */
    mobile?: 'title' | 'amount' | 'hide'
  }
}

export interface FacetOption { label: string; value: string; icon?: React.ComponentType<{ className?: string }> }
export interface FacetedFilterDef { columnId: string; title: string; options: FacetOption[]; /** the unit (shop, warehouse): follows the unit chosen under the company */ unit?: boolean }

export interface TableViewConfig {
  columnVisibility?: Record<string, boolean>
  sorting?: { id: string; desc: boolean }[]
  columnFilters?: { id: string; value: unknown }[]
  globalFilter?: string
  pageSize?: number
  /** the filters on any column (column tools) */
  rules?: import('./rules').Rule[]
  columnOrder?: string[]
  columnSizing?: Record<string, number>
  styles?: Record<string, import('./rules').ColumnStyle>
}

/** how a person laid a list out: kept on their profile */
export interface TableLayout { order?: string[]; sizing?: Record<string, number>; visibility?: Record<string, boolean>; styles?: Record<string, import('./rules').ColumnStyle> }

export type BulkActionsRender<T> = (rows: Row<T>[], clear: () => void) => React.ReactNode

/** what the quick look at a row shows: the document as it prints, or the row's fields and its lines */
export interface RowPreview {
  print?: { kind: import('@/lib/documents/model').DocKind; id: string }
  lines?: () => Promise<{ name: string; qty: number; price?: number | null; total?: number | null }[]>
  title?: string
  /** the document's table, for "Duplicate" in the quick look */
  duplicate?: import('@/components/duplicate-button').DuplicableTable
  id?: string
}
