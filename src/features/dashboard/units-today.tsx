import { useQuery } from '@tanstack/react-query'
import { ArrowRight, TriangleAlert } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { useActiveUnit } from '@/app/active-unit'
import { useCompany } from '@/app/company-provider'
import { unitIcon } from '@/components/layout/unit-picker'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { t, td, tn } from '@/i18n'
import { unwrap } from '@/lib/errors'
import { supabase } from '@/lib/supabase'
import { cn, formatMoney, num } from '@/lib/utils'

type UnitDay = { id: string; code: string; name: string; kind: string; city: string | null; sales_today: number; receipts_today: number
  sales_month: number; tills: number; tills_open: number; stock_value: number; low: number }

/** each unit at a glance: today's till sales, the month, tills open, stock and what runs low; a click works in that unit */
export function UnitsToday() {
  const { companyId, company, can } = useCompany()
  const { multi, set } = useActiveUnit()
  const navigate = useNavigate()
  const q = useQuery({
    queryKey: ['sales', companyId, 'units-today'], enabled: !!companyId && multi && can('pos.read'), refetchInterval: 60_000,
    queryFn: async () => unwrap(await supabase.rpc('units_today', { p_company: companyId! })) as unknown as UnitDay[],
  })
  if (!multi || !can('pos.read')) return null
  const cur = company?.base_currency
  const total = (q.data ?? []).reduce((s, u) => s + num(u.sales_today), 0)
  return (
    <Card className="mt-4">
      <CardHeader className="flex-row items-end justify-between gap-3 space-y-0">
        <div><CardTitle>{t('The units today')}</CardTitle>
          <CardDescription>{t('Till sales with VAT, {currency}. Click a unit to work in it.', { currency: cur ?? '' })}</CardDescription></div>
        {q.data && <div className="text-right"><div className="text-xs text-muted-foreground">{t('All units today')}</div><div className="text-lg font-semibold tabular">{formatMoney(total)}</div></div>}
      </CardHeader>
      <CardContent className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
        {q.isLoading && Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-28" />)}
        {(q.data ?? []).map((u) => {
          const Icon = unitIcon(u.kind)
          const sells = u.tills > 0
          return (
            <button key={u.id} type="button" onClick={() => { set(u.id); navigate('/inventory/stock') }}
              className="group grid gap-1.5 rounded-lg border p-3 text-left transition-colors hover:border-primary/50 hover:bg-primary/5">
              <span className="flex items-center gap-2">
                <Icon className="size-4 shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1 truncate text-[13px] font-medium">{td(u.name)}</span>
                <ArrowRight className="size-3.5 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
              </span>
              {sells ? <>
                <span className="text-xl font-semibold tabular">{formatMoney(u.sales_today)}</span>
                <span className="text-[12px] text-muted-foreground">{tn(u.receipts_today, '{n} receipt today', '{n} receipts today')} · {t('this month {amount}', { amount: formatMoney(u.sales_month) })}</span>
                <span className={cn('text-[12px]', u.tills_open ? 'text-success' : 'text-muted-foreground')}>{t('{open} of {all} tills open', { open: u.tills_open, all: u.tills })}</span>
              </> : <>
                <span className="text-xl font-semibold tabular">{formatMoney(u.stock_value)}</span>
                <span className="text-[12px] text-muted-foreground">{t('Stock at purchase price, without VAT')}</span>
              </>}
              {u.low > 0 && <span className="flex items-center gap-1 text-[12px] text-warning"><TriangleAlert className="size-3.5" />{tn(u.low, '{n} item running low', '{n} items running low')}</span>}
            </button>
          )
        })}
      </CardContent>
    </Card>
  )
}
