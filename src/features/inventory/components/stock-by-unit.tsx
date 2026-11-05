import { useQuery } from '@tanstack/react-query'
import { ExternalLink } from 'lucide-react'
import * as React from 'react'
import { Link } from 'react-router-dom'
import { useCompany } from '@/app/company-provider'
import { GridExportMenu } from '@/components/export-menu'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Skeleton } from '@/components/ui/skeleton'
import { t, td } from '@/i18n'
import { unwrap } from '@/lib/errors'
import { supabase } from '@/lib/supabase'
import { cn, formatQty, num } from '@/lib/utils'

type Level = { variant_id: string; product_id: string; sku: string; variant_name: string; uom_code: string | null; warehouse_id: string; warehouse_code: string; warehouse_name: string; on_hand: number; available: number }

/**
 * The chosen items in every unit at once: a row per item, a column per store or warehouse, the
 * total at the end. A click on an item opens its card; the table goes out as Excel, PDF or CSV.
 */
export function StockByUnitDialog({ variantIds, onClose }: { variantIds: string[]; onClose: () => void }) {
  const { companyId } = useCompany()
  const q = useQuery({
    queryKey: ['inv', companyId, 'by-unit', variantIds.join(',')], enabled: !!companyId && variantIds.length > 0,
    queryFn: async () => {
      const [levels, whs] = await Promise.all([
        supabase.from('v_stock_levels').select('variant_id, product_id, sku, variant_name, uom_code, warehouse_id, warehouse_code, warehouse_name, on_hand, available').eq('company_id', companyId!).in('variant_id', variantIds).limit(20000),
        supabase.from('warehouses').select('id, code, name').eq('company_id', companyId!).is('deleted_at', null).eq('is_active', true).order('code'),
      ])
      return { levels: unwrap(levels) as unknown as Level[], whs: unwrap(whs) as { id: string; code: string; name: string }[] }
    },
  })
  const data = React.useMemo(() => {
    if (!q.data) return null
    const items = new Map<string, { id: string; product_id: string; sku: string; name: string; uom: string | null; by: Map<string, number>; total: number }>()
    for (const l of q.data.levels) {
      const it = items.get(l.variant_id) ?? { id: l.variant_id, product_id: l.product_id, sku: l.sku, name: l.variant_name, uom: l.uom_code, by: new Map(), total: 0 }
      it.by.set(l.warehouse_id, (it.by.get(l.warehouse_id) ?? 0) + num(l.on_hand))
      it.total += num(l.on_hand)
      items.set(l.variant_id, it)
    }
    // the units that have any of these items, then the rest (so a unit with none shows as 0)
    return { items: [...items.values()].sort((a, b) => a.name.localeCompare(b.name)), whs: q.data.whs }
  }, [q.data])
  const missing = variantIds.length - (data?.items.length ?? 0)

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="block max-h-[90dvh] w-[calc(100%-2rem)] max-w-[1100px] overflow-y-auto">
        <DialogHeader className="mb-3 flex-row items-start justify-between gap-3 pr-8">
          <div><DialogTitle>{t('Stock in every unit')}</DialogTitle>
            <DialogDescription>{t('{n} items, on hand in each store and warehouse. Click an item to open its card.', { n: variantIds.length })}</DialogDescription></div>
          {data && <GridExportMenu name={t('stock-by-unit')} title={t('Stock in every unit')}
            grid={() => [[t('Code'), t('Item'), ...data.whs.map((w) => w.code), t('Total')],
              ...data.items.map((it) => [it.sku, it.name, ...data.whs.map((w) => it.by.get(w.id) ?? 0), it.total])]} />}
        </DialogHeader>
        {q.isLoading || !data ? <Skeleton className="h-48" /> : (
          <div className="overflow-x-auto rounded-md border">
            <table className="w-full border-collapse text-[12.5px]">
              <thead><tr className="bg-muted/70 text-[11.5px] text-muted-foreground">
                <th className="border-b border-r px-2 py-1.5 text-left font-semibold">{t('Item')}</th>
                {data.whs.map((w) => <th key={w.id} className="border-b border-r px-2 py-1.5 text-right font-semibold" title={td(w.name)}>{w.code}</th>)}
                <th className="border-b px-2 py-1.5 text-right font-semibold">{t('Total')}</th>
              </tr></thead>
              <tbody>
                {data.items.map((it) => (
                  <tr key={it.id} className="hover:bg-accent/40">
                    <td className="border-b border-r px-2 py-1">
                      <Link to={`/inventory/products?item=${it.product_id}`} onClick={onClose} className="group inline-flex items-center gap-1 font-medium hover:text-primary">
                        {it.name}<span className="text-[11px] font-normal text-muted-foreground">{it.sku}</span><ExternalLink className="size-3 opacity-0 group-hover:opacity-60" /></Link></td>
                    {data.whs.map((w) => { const v = it.by.get(w.id) ?? 0; return (
                      <td key={w.id} className={cn('border-b border-r px-2 py-1 text-right tabular', v === 0 && 'text-muted-foreground/60', v < 0 && 'font-medium text-destructive')}>{v === 0 ? '0' : formatQty(v)}</td>
                    ) })}
                    <td className="border-b px-2 py-1 text-right font-semibold tabular">{formatQty(it.total)}{it.uom && <span className="ml-1 text-[11px] font-normal text-muted-foreground">{td(it.uom)}</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {missing > 0 && data && <p className="mt-2 text-[12px] text-muted-foreground">{t('{n} of the chosen items have no stock anywhere.', { n: missing })}</p>}
      </DialogContent>
    </Dialog>
  )
}
