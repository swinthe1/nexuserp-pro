import * as React from 'react'
import { cn } from '@/lib/utils'

/** a table that scrolls sideways when it is wider than the page; a soft edge shows that more columns are there */
const Table = React.forwardRef<HTMLTableElement, React.HTMLAttributes<HTMLTableElement>>(({ className, ...props }, ref) => {
  const box = React.useRef<HTMLDivElement>(null)
  const [edge, setEdge] = React.useState<{ left: boolean; right: boolean }>({ left: false, right: false })
  React.useEffect(() => {
    const el = box.current
    if (!el) return
    const measure = () => {
      const left = el.scrollLeft > 2, right = el.scrollLeft + el.clientWidth < el.scrollWidth - 2
      setEdge((e) => (e.left === left && e.right === right ? e : { left, right }))
    }
    measure()
    el.addEventListener('scroll', measure, { passive: true })
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null
    ro?.observe(el); if (el.firstElementChild) ro?.observe(el.firstElementChild)
    return () => { el.removeEventListener('scroll', measure); ro?.disconnect() }
  }, [])
  return (
    <div className="relative w-full">
      <div ref={box} className="w-full overflow-auto">
        <table ref={ref} className={cn('w-full caption-bottom text-[13.5px]', className)} {...props} />
      </div>
      {edge.left && <div aria-hidden className="pointer-events-none absolute inset-y-0 left-0 w-6 bg-gradient-to-r from-card to-transparent print:hidden" />}
      {edge.right && <div aria-hidden className="pointer-events-none absolute inset-y-0 right-0 w-10 bg-gradient-to-l from-card via-card/70 to-transparent print:hidden" />}
    </div>
  )
})
Table.displayName = 'Table'
const TableHeader = React.forwardRef<HTMLTableSectionElement, React.HTMLAttributes<HTMLTableSectionElement>>(({ className, ...props }, ref) => (
  <thead ref={ref} className={cn('bg-muted/70 [&_tr]:border-b', className)} {...props} />
))
TableHeader.displayName = 'TableHeader'
const TableBody = React.forwardRef<HTMLTableSectionElement, React.HTMLAttributes<HTMLTableSectionElement>>(({ className, ...props }, ref) => (
  <tbody ref={ref} className={cn('[&_tr:last-child]:border-0', className)} {...props} />
))
TableBody.displayName = 'TableBody'
const TableFooter = React.forwardRef<HTMLTableSectionElement, React.HTMLAttributes<HTMLTableSectionElement>>(({ className, ...props }, ref) => (
  <tfoot ref={ref} className={cn('border-t bg-muted/40 font-medium', className)} {...props} />
))
TableFooter.displayName = 'TableFooter'
const TableRow = React.forwardRef<HTMLTableRowElement, React.HTMLAttributes<HTMLTableRowElement>>(({ className, ...props }, ref) => (
  <tr ref={ref} className={cn('border-b transition-colors hover:bg-accent/45 data-[state=selected]:bg-accent/70', className)} {...props} />
))
TableRow.displayName = 'TableRow'
const TableHead = React.forwardRef<HTMLTableCellElement, React.ThHTMLAttributes<HTMLTableCellElement>>(({ className, ...props }, ref) => (
  <th ref={ref} className={cn('h-10 whitespace-nowrap px-3 text-left align-middle text-xs font-semibold text-muted-foreground [&:has([role=checkbox])]:w-8 [&:has([role=checkbox])]:pr-0', className)} {...props} />
))
TableHead.displayName = 'TableHead'
const TableCell = React.forwardRef<HTMLTableCellElement, React.TdHTMLAttributes<HTMLTableCellElement>>(({ className, ...props }, ref) => (
  <td ref={ref} className={cn('h-10 px-3 py-2 align-middle [&:has([role=checkbox])]:pr-0', className)} {...props} />
))
TableCell.displayName = 'TableCell'

export { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow }
