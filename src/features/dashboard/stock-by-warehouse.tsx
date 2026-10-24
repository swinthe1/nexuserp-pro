import { ArrowRight } from 'lucide-react'
import { Link } from 'react-router-dom'
import { useCompany } from '@/app/company-provider'
import { ErrorState } from '@/components/error-state'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { useRealtimeInvalidate } from '@/hooks/use-realtime'
import { t, td, tEnum, tn } from '@/i18n'
import { cn, formatMoney, num } from '@/lib/utils'
import { useStockByWarehouse } from '@/features/inventory/api'

/** Dashboard card: stock value per store / warehouse, each one opening its own stock list. */
export function StockByWarehouse() {
  const { company, companyId } = useCompany()
  const q = useStockByWarehouse()
  useRealtimeInvalidate('stock_levels', companyId, [['inv', companyId, 'by-warehouse']])

  const rows = q.data ?? []
  // a single warehouse says nothing the stock value card does not already say
  if (!q.isLoading && !q.isError && rows.length < 2) return null
  const total = rows.reduce((s, r) => s + num(r.value), 0)
  const max = Math.max(...rows.map((r) => num(r.value)), 1)

  return (
    <Card className="mt-4">
      <CardHeader className="flex-row items-start justify-between gap-4 space-y-0">
        <div>
          <CardTitle>{t('Stock by store')}</CardTitle>
          <CardDescription>
            {q.data ? t('{amount} in {n} stores and warehouses, at average cost. Open one to see its items.', { amount: formatMoney(total, company?.base_currency), n: rows.length })
              : t('At average cost. Open one to see its items.')}
          </CardDescription>
        </div>
        <Button variant="ghost" size="sm" asChild className="shrink-0"><Link to="/inventory/warehouses">{t('Warehouses')} <ArrowRight /></Link></Button>
      </CardHeader>
      <CardContent>
        {q.isLoading && <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-28" />)}</div>}
        {q.isError && <ErrorState compact error={q.error} onRetry={() => void q.refetch()} />}
        {q.data && (
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {rows.map((w) => {
              const empty = num(w.items) === 0 && num(w.items_negative) === 0
              const share = total > 0 ? (num(w.value) / total) * 100 : 0
              return (
                <li key={w.id}>
                  <Link to={`/inventory/stock?warehouse=${encodeURIComponent(w.name)}`}
                    className={cn('flex h-full flex-col gap-2 rounded-lg border p-3.5 transition-colors hover:border-ring/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                      empty && 'bg-muted/40')}>
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="truncate text-sm font-medium" title={td(w.name)}>{td(w.name)}</span>
                      <span className="shrink-0 text-xs text-muted-foreground">{tEnum(`wh_${w.type}`)}</span>
                    </div>
                    <div className="flex items-baseline justify-between gap-2">
                      <span className={cn('tabular text-xl font-semibold tracking-[-0.02em]', empty && 'text-muted-foreground')}>{formatMoney(w.value, company?.base_currency)}</span>
                      {total > 0 && !empty && <span className="tabular text-xs text-muted-foreground">{share < 1 ? '<1' : Math.round(share)}%</span>}
                    </div>
                    <div className="h-1 rounded-full bg-muted"><div className="h-full rounded-full bg-primary" style={{ width: `${(num(w.value) / max) * 100}%` }} /></div>
                    <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs">
                      <span className="text-muted-foreground">{empty ? t('No stock') : tn(num(w.items), '{n} item in stock', '{n} items in stock')}</span>
                      {num(w.low_stock) > 0 && <span className="text-warning">{tn(num(w.low_stock), '{n} running low', '{n} running low')}</span>}
                      {num(w.items_without_cost) > 0 && <span className="text-warning">{tn(num(w.items_without_cost), '{n} without a cost', '{n} without a cost')}</span>}
                      {num(w.items_negative) > 0 && <span className="text-destructive">{tn(num(w.items_negative), '{n} below zero', '{n} below zero')}</span>}
                    </div>
                  </Link>
                </li>
              )
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}
