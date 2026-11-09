import { ChevronDown, ChevronUp, Columns3, GripVertical } from 'lucide-react'
import * as React from 'react'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { useTableColumns } from '@/components/layout/nav-prefs'
import { msg, t } from '@/i18n'
import { cn, formatMoney, formatQty } from '@/lib/utils'

/** one line of a document as the sheet shows it */
export type SheetLine = {
  key: string; no: number; code: string | null; name: string; barcode: string | null; uom: string | null
  qty: number; price: number; discount: number; vatRate: number; vatName: string
  /** the item's selling price without VAT now, for the margin */
  sell: number | null
  /** what the line says under the amount (matched to the order, received…) */
  extra?: React.ReactNode
}

type Col = { key: string; label: () => string; fixed?: boolean; right?: boolean; total?: (ls: SheetLine[]) => number; cell: (l: SheetLine) => React.ReactNode }

const net = (l: SheetLine) => Math.round(l.qty * l.price * (1 - l.discount / 100) * 100) / 100
const gross = (l: SheetLine) => Math.round(net(l) * (1 + l.vatRate / 100) * 100) / 100
const unitNet = (l: SheetLine) => l.price * (1 - l.discount / 100)
const sellGross = (l: SheetLine) => (l.sell != null ? l.sell * (1 + l.vatRate / 100) : null)
const margin = (l: SheetLine) => (l.sell && l.sell > 0 ? ((l.sell - unitNet(l)) / l.sell) * 100 : null)
const sum = (ls: SheetLine[], f: (l: SheetLine) => number) => ls.reduce((s, l) => s + f(l), 0)

const COLS: Col[] = [
  { key: 'no', label: () => '#', fixed: true, cell: (l) => <span className="text-muted-foreground">{l.no}</span> },
  { key: 'item', label: () => t(msg('Item name')), fixed: true, cell: (l) => <><span className="font-medium">{l.name}</span>{l.code && <span className="ml-1.5 text-[11px] text-muted-foreground">{l.code}</span>}</> },
  { key: 'barcode', label: () => t(msg('Barcode')), cell: (l) => <span className="tabular">{l.barcode ?? ''}</span> },
  { key: 'qty', label: () => t(msg('Quantity')), right: true, cell: (l) => <>{formatQty(l.qty, l.uom)}</> },
  { key: 'price', label: () => t(msg('Price without VAT')), right: true, cell: (l) => formatMoney(l.price) },
  { key: 'disc', label: () => t(msg('Discount')), right: true, cell: (l) => (l.discount ? `${formatQty(l.discount)}%` : '—') },
  { key: 'price_vat', label: () => t(msg('Price with VAT')), right: true, cell: (l) => formatMoney(unitNet(l) * (1 + l.vatRate / 100)) },
  { key: 'vat', label: () => t(msg('VAT')), right: true, total: (ls) => sum(ls, (l) => gross(l) - net(l)), cell: (l) => `${formatQty(l.vatRate)}%` },
  { key: 'margin', label: () => t(msg('Margin')), right: true, cell: (l) => { const m = margin(l); return m == null ? '—' : <span className={cn(m < 0 && 'font-medium text-destructive', m >= 0 && m < 5 && 'text-warning')}>{formatQty(Math.round(m * 10) / 10)}%</span> } },
  { key: 'sell', label: () => t(msg('Selling price')), right: true, cell: (l) => { const s = sellGross(l); return s == null ? '—' : formatMoney(s) } },
  { key: 'net', label: () => t(msg('Value without VAT')), right: true, total: (ls) => sum(ls, net), cell: (l) => formatMoney(net(l)) },
  { key: 'gross', label: () => t(msg('Total with VAT')), right: true, total: (ls) => sum(ls, gross), cell: (l) => <span className="font-medium">{formatMoney(gross(l))}</span> },
]
const DEFAULT = COLS.map((c) => c.key)
const full = (o?: string[] | null) => { const known = (o ?? []).filter((k) => DEFAULT.includes(k)); return [...known, ...DEFAULT.filter((k) => !known.includes(k))] }

/**
 * The lines of a finished document as a sheet: tight rows, a line between the columns, the totals at
 * the foot. Each person chooses which columns, and in which order (drag a heading, or the Columns
 * menu); it is kept on their profile.
 */
export function LinesSheet({ lines, tableKey, title, extraLabel }: { lines: SheetLine[]; tableKey: string; title?: string; extraLabel?: string }) {
  const saved = useTableColumns(tableKey)
  const order = React.useMemo(() => full(saved.cols?.order), [saved.cols])
  const hidden = React.useMemo(() => new Set((saved.cols?.hidden ?? []).filter((k) => !COLS.find((c) => c.key === k)?.fixed)), [saved.cols])
  const setOrder = (o: string[]) => saved.set({ order: o, hidden: [...hidden] })
  const setHidden = (h: Set<string>) => saved.set({ order, hidden: [...h] })
  const [drag, setDrag] = React.useState<string | null>(null)
  const drop = (to: string) => {
    if (!drag || drag === to) return
    const o = order.filter((k) => k !== drag); o.splice(o.indexOf(to) + (order.indexOf(drag) < order.indexOf(to) ? 1 : 0), 0, drag); setOrder(o)
  }
  const shown = order.map((k) => COLS.find((c) => c.key === k)!).filter((c) => !hidden.has(c.key))
  const hasExtra = lines.some((l) => l.extra)
  const firstTotal = shown.findIndex((c) => c.total)
  const move = (i: number, d: number) => { const o = order.slice(); const [x] = o.splice(i, 1); o.splice(i + d, 0, x!); setOrder(o) }

  return (
    <div className="rounded-lg border bg-card">
      <div className="flex items-center justify-between gap-2 px-3 py-2">
        <h3 className="text-sm font-semibold">{title ?? t('Lines')}</h3>
        <DropdownMenu>
          <DropdownMenuTrigger asChild><Button variant="ghost" size="sm" className="h-7"><Columns3 /> {t('Columns')}</Button></DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-64">
            <DropdownMenuLabel className="text-[12px] font-normal text-muted-foreground">{t('What you see on the lines, and in which order. You can also drag a column by its name.')}</DropdownMenuLabel>
            {order.map((k, i) => { const c = COLS.find((x) => x.key === k)!; return (
              <div key={k} className="flex items-center gap-1 rounded-sm pr-1 hover:bg-accent">
                <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 px-2 py-1 text-[13px]">
                  <input type="checkbox" className="size-4" checked={!hidden.has(k)} disabled={c.fixed}
                    onChange={(e) => { const h = new Set(hidden); if (e.target.checked) h.delete(k); else h.add(k); setHidden(h) }} />
                  <span className="truncate">{c.label()}</span>
                </label>
                <Button size="icon" variant="ghost" className="size-6" disabled={i === 0} aria-label={t('Move up')} onClick={() => move(i, -1)}><ChevronUp /></Button>
                <Button size="icon" variant="ghost" className="size-6" disabled={i === order.length - 1} aria-label={t('Move down')} onClick={() => move(i, 1)}><ChevronDown /></Button>
              </div>
            ) })}
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => saved.set(null)}>{t('Show all, in the usual order')}</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <div className="overflow-x-auto border-t">
        <table className="w-full border-collapse text-[12.5px]">
          <thead>
            <tr className="bg-muted/70 text-[11.5px] text-muted-foreground">
              {shown.map((c) => (
                <th key={c.key} draggable onDragStart={(e) => { setDrag(c.key); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', c.key) }}
                  onDragOver={(e) => { if (drag) e.preventDefault() }} onDrop={(e) => { e.preventDefault(); drop(c.key); setDrag(null) }} onDragEnd={() => setDrag(null)}
                  className={cn('group/h cursor-grab border-b border-r px-2 py-1.5 font-semibold last:border-r-0', c.right ? 'text-right' : 'text-left', c.key === 'no' && 'w-8', drag === c.key && 'opacity-50')}>
                  <span className="inline-flex items-center gap-0.5"><GripVertical className="size-3 opacity-0 group-hover/h:opacity-40" />{c.label()}</span>
                </th>
              ))}
              {hasExtra && <th className="border-b px-2 py-1.5 text-left font-semibold">{extraLabel ?? ''}</th>}
            </tr>
          </thead>
          <tbody>
            {lines.map((l) => (
              <tr key={l.key} className="hover:bg-accent/40">
                {shown.map((c) => <td key={c.key} className={cn('border-b border-r px-2 py-1 align-middle last:border-r-0', c.right && 'text-right tabular')}>{c.cell(l)}</td>)}
                {hasExtra && <td className="border-b px-2 py-1 align-middle">{l.extra}</td>}
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="bg-primary/5 font-semibold">
              {shown.map((c, i) => i < Math.max(firstTotal, 1)
                ? (i === 0 ? <td key={c.key} colSpan={Math.max(firstTotal, 1)} className="border-r px-2 py-1.5">{t('Total')}:</td> : null)
                : <td key={c.key} className={cn('border-r px-2 py-1.5 last:border-r-0', c.right && 'text-right tabular', c.key === 'gross' && 'text-[13.5px]')}>{c.total ? formatMoney(c.total(lines)) : ''}</td>)}
              {hasExtra && <td />}
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  )
}
