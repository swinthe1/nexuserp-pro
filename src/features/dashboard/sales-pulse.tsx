/**
 * The day in a few plain sentences, at the top of the home page: today's sales so far against the same
 * weekday a week ago at the same hour, the month against the same days of last month, and today's best
 * seller. Counted on the server from the documents (sales_pulse), so it costs nothing and needs no AI.
 */
import { useQuery } from '@tanstack/react-query'
import { ArrowDownRight, ArrowUpRight, Minus, Sparkles } from 'lucide-react'
import { useCompany } from '@/app/company-provider'
import { Skeleton } from '@/components/ui/skeleton'
import { msg, t } from '@/i18n'
import { unwrap } from '@/lib/errors'
import { supabase } from '@/lib/supabase'
import { cn, formatMoney, formatQty, num } from '@/lib/utils'
import { openAssistant } from '@/features/simple/simple-home'

type Pulse = { currency: string; weekday: number; today: number; receipts: number; week_ago: number; month: number; prev_month: number
  top: { name: string; amount: number; quantity: number } | null }

/** "last Saturday" as the sentence needs it, Monday = 1 */
const LAST_DAY = ['', msg('last Monday'), msg('last Tuesday'), msg('last Wednesday'), msg('last Thursday'), msg('last Friday'), msg('last Saturday'), msg('last Sunday')]

/** the change in whole percent; null when there is nothing to compare with */
function change(now: number, before: number) {
  if (before <= 0) return null
  return Math.round(((now - before) / before) * 100)
}

function Change({ pct, more, less, same, day = '' }: { pct: number; more: string; less: string; same: string; day?: string }) {
  const up = pct >= 1, down = pct <= -1
  const Icon = up ? ArrowUpRight : down ? ArrowDownRight : Minus
  return (
    <span className={cn('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[12.5px] font-medium',
      up ? 'bg-emerald-500/12 text-emerald-700 dark:text-emerald-300' : down ? 'bg-amber-500/15 text-amber-800 dark:text-amber-300' : 'bg-muted text-muted-foreground')}>
      <Icon className="size-3.5" />
      {t(up ? more : down ? less : same, { pct: Math.abs(pct), day })}
    </span>
  )
}

export function SalesPulse() {
  const { companyId, company, can, hasFeature } = useCompany()
  const q = useQuery({
    // under 'sales': a new till receipt or invoice refreshes it with the other numbers
    queryKey: ['sales', companyId, 'pulse'], enabled: !!companyId && can('sales.read'), refetchInterval: 120_000,
    queryFn: async () => unwrap(await supabase.rpc('sales_pulse', { p_company: companyId! })) as unknown as Pulse,
  })
  if (!can('sales.read')) return null
  if (q.isLoading) return <Skeleton className="mb-4 h-[84px] rounded-xl" />
  const p = q.data
  // a company that does not sell (yet): nothing to say
  if (!p || (!num(p.today) && !num(p.week_ago) && !num(p.month) && !num(p.prev_month))) return null
  const cur = p.currency ?? company?.base_currency
  const day = t(LAST_DAY[p.weekday] ?? '')
  const week = change(num(p.today), num(p.week_ago))
  const month = change(num(p.month), num(p.prev_month))
  const money = (v: number) => <b className="font-semibold tabular text-foreground">{formatMoney(v, cur)}</b>

  return (
    <section aria-label={t('The day so far')} className="mb-4 flex gap-3 rounded-xl border bg-gradient-to-r from-primary/[0.07] to-transparent p-4">
      <span className="grid size-9 shrink-0 place-items-center rounded-full bg-primary/15 text-primary"><Sparkles className="size-[18px]" /></span>
      <div className="min-w-0 flex-1 space-y-1.5 text-[14.5px] leading-relaxed text-muted-foreground">
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
          {num(p.today) ? <span>{t('Today so far you have sold')} {money(num(p.today))}</span> : <span>{t('No sales yet today.')}</span>}
          {week != null && num(p.today) > 0 && <Change pct={week} day={day} more={msg('{pct}% more than {day} at this hour')}
            less={msg('{pct}% less than {day} at this hour')} same={msg('about the same as {day} at this hour')} />}
        </p>
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span>{t('This month')} {money(num(p.month))}</span>
          {month != null && <Change pct={month} more={msg('{pct}% more than the same days last month')} less={msg('{pct}% less than the same days last month')}
            same={msg('about the same as the same days last month')} />}
        </p>
        {p.top && <p>{t('Best seller today:')} <b className="font-semibold text-foreground">{p.top.name}</b> · {formatQty(num(p.top.quantity))} · {formatMoney(num(p.top.amount), cur)}</p>}
        <p className="flex flex-wrap items-center gap-x-3 text-[12px]">
          <span>{t('With VAT: the tills, the invoices and every unit.')}</span>
          {hasFeature('ai_assistant') && <button type="button" onClick={openAssistant} className="font-medium text-primary hover:underline">{t('Ask the assistant more')}</button>}
        </p>
      </div>
    </section>
  )
}
