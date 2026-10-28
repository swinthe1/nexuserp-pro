import { ArrowRight } from 'lucide-react'
import { Link } from 'react-router-dom'
import { useCompany } from '@/app/company-provider'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { t, td, tn } from '@/i18n'
import { cn, formatMoney, num } from '@/lib/utils'
import type { HistoryLive } from '@/features/history/api'

/** Dashboard card: today's sales per store, as they ring up in the old program. */
export function LegacySales({ data }: { data: HistoryLive }) {
  const { company } = useCompany()
  const cur = company?.base_currency
  const rows = data.by_store ?? []
  const max = Math.max(...rows.map((r) => num(r.today)), 1)

  return (
    <Card className="mt-4">
      <CardHeader className="flex-row items-start justify-between gap-4 space-y-0">
        <div>
          <CardTitle>{t('Sales today by store')}</CardTitle>
          <CardDescription>
            {t('{amount} with VAT from {n} receipts today, from the old program. Updates by itself.', { amount: formatMoney(data.today, cur), n: num(data.today_receipts) })}
          </CardDescription>
        </div>
        <Button variant="ghost" size="sm" asChild className="shrink-0"><Link to="/history">{t('History')} <ArrowRight /></Link></Button>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('No sales this month yet.')}</p>
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {rows.map((s) => {
              const quiet = !num(s.today)
              return (
                <li key={s.store} className={cn('flex flex-col gap-2 rounded-lg border p-3.5', quiet && 'bg-muted/40')}>
                  <span className="truncate text-sm font-medium" title={td(s.store)}>{td(s.store)}</span>
                  <span className={cn('tabular text-xl font-semibold tracking-[-0.02em]', quiet && 'text-muted-foreground')}>{formatMoney(s.today ?? 0, cur)}</span>
                  <div className="h-1 rounded-full bg-muted"><div className="h-full rounded-full bg-primary" style={{ width: `${(num(s.today) / max) * 100}%` }} /></div>
                  <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
                    <span>{tn(num(s.today_receipts), '{n} receipt today', '{n} receipts today')}</span>
                    <span>{t('{amount} this month, with VAT', { amount: formatMoney(s.month ?? 0, cur) })}</span>
                    {s.from_exits && <span title={t('This till records sales only as stock exits; they are valued at the sales price.')}>{t('from stock exits')}</span>}
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}
