/**
 * The count that never closes the shop: every day each person of a store counts a few items, chosen
 * where the stock is most likely wrong; and how right the stock of each unit is, from those counts.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ChevronDown, ClipboardCheck, Settings2, ShieldAlert } from 'lucide-react'
import * as React from 'react'
import { Link } from 'react-router-dom'
import { toast } from 'sonner'
import { useCompany } from '@/app/company-provider'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { msg, t, td, tn } from '@/i18n'
import { describeError, unwrap } from '@/lib/errors'
import { supabase } from '@/lib/supabase'
import { cn, formatMoney, formatQty, num } from '@/lib/utils'
import { useTaskSettings } from '@/features/tasks/api'

export type Accuracy = { warehouse_id: string; name: string; lines: number; exact: number; pct: number | null; lost: number; found: number }
export type RiskItem = { variant_id: string; sku: string; name: string; on_hand: number; score: number; reasons: string[] }

/** why an item was picked for counting */
export const RISK_REASON: Record<string, string> = {
  negative: msg('Stock below zero'),
  last_diff: msg('Difference at the last count'),
  voids: msg('Often taken off at the till'),
  refunds: msg('Refunded without a receipt'),
  no_sales: msg('Stopped selling, yet in stock'),
  class_a: msg('Valuable item (class A)'),
  never: msg('Never counted'),
  long_ago: msg('Not counted for over 3 months'),
}
const STRONG = new Set(['negative', 'last_diff', 'voids', 'refunds', 'no_sales'])

export function RiskBadges({ reasons, className }: { reasons: string[] | null | undefined; className?: string }) {
  if (!reasons?.length) return null
  return (
    <span className={cn('flex flex-wrap gap-1', className)}>
      {reasons.map((r) => (
        <span key={r} className={cn('rounded px-1.5 py-0.5 text-[11px] font-medium', STRONG.has(r) ? 'bg-warning/15 text-warning' : 'bg-muted text-muted-foreground')}>
          {RISK_REASON[r] ? t(RISK_REASON[r]) : r}</span>
      ))}
    </span>
  )
}

export function useCountAccuracy(days = 30) {
  const { companyId } = useCompany()
  return useQuery({
    queryKey: ['wms', companyId, 'count-accuracy', days],
    enabled: !!companyId,
    queryFn: async () => (unwrap(await supabase.rpc('count_accuracy', { p_company: companyId!, p_days: days })) ?? []) as unknown as Accuracy[],
  })
}
export function useCountRisk(warehouse: string | null) {
  const { companyId } = useCompany()
  return useQuery({
    queryKey: ['wms', companyId, 'count-risk', warehouse],
    enabled: !!companyId && !!warehouse,
    queryFn: async () => (unwrap(await supabase.rpc('count_risk_list', { p_warehouse: warehouse!, p_limit: 20 })) ?? []) as unknown as RiskItem[],
  })
}
export function useDailyCountsNow() {
  const { companyId } = useCompany()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async () => num(unwrap(await supabase.rpc('daily_counts_now', { p_company: companyId! }))),
    onSuccess: (n) => {
      void qc.invalidateQueries({ queryKey: ['wms', companyId] })
      void qc.invalidateQueries({ queryKey: ['tasks'] })
      if (n > 0) toast.success(tn(n, '{n} count made: each person has it among their tasks', '{n} counts made: each person has theirs among their tasks'))
      else toast.info(t('Nothing new: everyone already has today\'s count, or nothing risky is left to count'))
    },
    onError: (e) => toast.error(describeError(e)),
  })
}

const tone = (pct: number | null) => pct == null ? 'text-muted-foreground' : pct >= 95 ? 'text-success' : pct >= 85 ? 'text-warning' : 'text-destructive'

/** at the top of the counts page: how right the stock is, the day's counts, and where the risk is */
export function DailyCountCard() {
  const { can } = useCompany()
  const acc = useCountAccuracy()
  const settings = useTaskSettings()
  const now = useDailyCountsNow()
  const [open, setOpen] = React.useState<string | null>(null)
  const on = !!(settings.data?.task_automations as Record<string, { on?: boolean; days?: number }> | undefined)?.daily_count?.on
  const per = (settings.data?.task_automations as Record<string, { on?: boolean; days?: number }> | undefined)?.daily_count?.days ?? 8
  const rows = acc.data ?? []
  return (
    <section className="grid gap-3 rounded-xl border bg-card p-4" aria-labelledby="daily-count">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 max-w-2xl">
          <h2 id="daily-count" className="font-semibold">{t('Daily count')}</h2>
          <p className="mt-0.5 text-[13px] text-muted-foreground">{t('Every day each person of a store counts a few items on the phone, with the shop open: the program picks those where the stock is most likely wrong. The counter does not see the expected quantity.')}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {can('admin.write') && <Button variant="ghost" size="sm" asChild><Link to="/tasks/setup?tab=auto"><Settings2 /> {t('Settings')}</Link></Button>}
          {can('wms.write') && <Button size="sm" loading={now.isPending} onClick={() => now.mutate()}><ClipboardCheck /> {t('Make today\'s counts')}</Button>}
        </div>
      </div>
      {settings.isSuccess && (on
        ? <p className="text-[12.5px] text-muted-foreground">{t('On: every morning each person gets {n} items among their tasks.', { n: per })}</p>
        : <p className="rounded-md bg-warning/10 px-3 py-2 text-[12.5px] text-warning">{t('The daily count is off: the program does not make it every morning. Switch it on in the automatic tasks, or press "Make today\'s counts".')}</p>)}

      {acc.isLoading ? <Skeleton className="h-16" /> : rows.length > 0 && (
        <div className="grid gap-1.5">
          <div className="text-[12px] font-medium text-muted-foreground">{t('How right the stock is (last 30 days)')}</div>
          {rows.map((r) => (
            <div key={r.warehouse_id} className="rounded-lg border">
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-3 py-2">
                <span className="min-w-[9rem] flex-1 text-[14px] font-medium">{td(r.name)}</span>
                {r.lines > 0 ? <>
                  <span className={cn('text-xl font-semibold tabular', tone(r.pct))}>{formatQty(num(r.pct))}%</span>
                  <span className="text-[12.5px] text-muted-foreground">{t('{a} of {b} counted lines without a difference', { a: r.exact, b: r.lines })}</span>
                  {(num(r.lost) > 0 || num(r.found) > 0) && <span className="text-[12.5px] tabular">
                    {num(r.lost) > 0 && <span className="text-destructive">{t('missing {amount}', { amount: formatMoney(num(r.lost)) })}</span>}
                    {num(r.lost) > 0 && num(r.found) > 0 && ' · '}
                    {num(r.found) > 0 && <span className="text-success">{t('found {amount}', { amount: formatMoney(num(r.found)) })}</span>}</span>}
                </> : <span className="text-[12.5px] text-muted-foreground">{t('No count posted in these days')}</span>}
                <Button variant="ghost" size="sm" className="ml-auto" aria-expanded={open === r.warehouse_id} onClick={() => setOpen((o) => (o === r.warehouse_id ? null : r.warehouse_id))}>
                  <ShieldAlert /> {t('Where the risk is')} <ChevronDown className={cn('transition-transform', open === r.warehouse_id && 'rotate-180')} /></Button>
              </div>
              {open === r.warehouse_id && <RiskList warehouse={r.warehouse_id} />}
            </div>
          ))}
        </div>
      )}
    </section>
  )
}

function RiskList({ warehouse }: { warehouse: string }) {
  const q = useCountRisk(warehouse)
  if (q.isLoading) return <div className="border-t p-3"><Skeleton className="h-24" /></div>
  const rows = q.data ?? []
  if (!rows.length) return <p className="border-t px-3 py-3 text-[13px] text-muted-foreground">{t('Nothing stands out: the stock of this unit looks right.')}</p>
  return (
    <ul className="max-h-80 divide-y overflow-y-auto border-t">
      {rows.map((r) => (
        <li key={r.variant_id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2">
          <span className="min-w-0 flex-1"><span className="block truncate text-[13.5px] font-medium">{r.name}</span>
            <span className="text-[11.5px] text-muted-foreground tabular">{r.sku}</span></span>
          <RiskBadges reasons={r.reasons} className="justify-end" />
        </li>
      ))}
    </ul>
  )
}
