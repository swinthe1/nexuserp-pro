import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import * as React from 'react'
import { toast } from 'sonner'
import { useCompany } from '@/app/company-provider'
import { ErrorState } from '@/components/error-state'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { t } from '@/i18n'
import { describeError, unwrap } from '@/lib/errors'
import { supabase } from '@/lib/supabase'
import { formatMoney, num } from '@/lib/utils'

type Limits = { business: number | null; individual: number | null; block: boolean; country: string; currency: string; defaults: { business: number | null; individual: number | null } }

/** The law's limits for cash payments: checked on every cash payment, split payments of a day add up. */
export function CashLimits() {
  const { companyId, can } = useCompany()
  const qc = useQueryClient()
  const q = useQuery({ queryKey: ['cash-limits', companyId], enabled: !!companyId,
    queryFn: async () => unwrap(await supabase.rpc('cash_limits', { p_company: companyId! })) as unknown as Limits })
  const [biz, setBiz] = React.useState('')
  const [ind, setInd] = React.useState('')
  const [block, setBlock] = React.useState(false)
  React.useEffect(() => {
    if (q.data) { setBiz(q.data.business != null ? String(q.data.business) : ''); setInd(q.data.individual != null ? String(q.data.individual) : ''); setBlock(q.data.block) }
  }, [q.data])
  const save = useMutation({
    mutationFn: async () => unwrap(await supabase.rpc('cash_limits_save', { p_company: companyId!, p_business: num(biz), p_individual: num(ind), p_block: block })),
    onSuccess: () => { toast.success(t('Saved')); void qc.invalidateQueries({ queryKey: ['cash-limits'] }) },
    onError: (e) => toast.error(describeError(e)),
  })
  if (q.isLoading) return <Skeleton className="h-64" />
  if (q.isError) return <Card><ErrorState error={q.error} onRetry={() => void q.refetch()} /></Card>
  const d = q.data!
  const write = can('finance.write')
  return (
    <Card className="max-w-2xl">
      <CardHeader>
        <CardTitle>{t('Legal limits for cash')}</CardTitle>
        <CardDescription>{t('Every cash payment is checked against these limits. Payments with the same customer or vendor on the same day add up, so a split payment is caught too.')}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="grid content-start gap-1.5"><Label htmlFor="cl-biz">{t('With a business, per day')}</Label>
            <Input id="cl-biz" inputMode="decimal" value={biz} disabled={!write} onChange={(e) => setBiz(e.target.value)} placeholder={t('no limit')} />
            {d.defaults.business != null && <p className="text-xs text-muted-foreground">{t('The law: {amount}', { amount: formatMoney(d.defaults.business, d.currency) })}</p>}</div>
          <div className="grid content-start gap-1.5"><Label htmlFor="cl-ind">{t('With an individual, per day')}</Label>
            <Input id="cl-ind" inputMode="decimal" value={ind} disabled={!write} onChange={(e) => setInd(e.target.value)} placeholder={t('no limit')} />
            {d.defaults.individual != null && <p className="text-xs text-muted-foreground">{t('The law: {amount}', { amount: formatMoney(d.defaults.individual, d.currency) })}</p>}</div>
        </div>
        {d.country === 'XK' && <p className="rounded-md bg-muted/60 px-3 py-2 text-[13px] text-muted-foreground">
          {t('Kosovo: 2,000 € with individuals since 1 June 2026. The government has announced lowering the limit between businesses from 500 € to 300 €; change it here when it is in force.')}</p>}
        <div className="flex items-start gap-3">
          <Switch id="cl-block" checked={block} disabled={!write} onCheckedChange={setBlock} />
          <div><Label htmlFor="cl-block">{t('Refuse cash above the limit')}</Label>
            <p className="text-xs text-muted-foreground">{t('Off: the payment goes through and whoever approves in finance is told. On: the payment is refused and must go through the bank.')}</p></div>
        </div>
        {write && <div><Button loading={save.isPending} onClick={() => save.mutate()}>{t('Save')}</Button></div>}
      </CardContent>
    </Card>
  )
}

/** Shown on the payment screen while the amount is typed. */
export function CashLimitWarning({ partnerId, amount, date, bankId, method, exclude }: { partnerId: string | null; amount: number; date: string; bankId: string | null; method: string; exclude?: string }) {
  const { companyId } = useCompany()
  const [debounced, setDebounced] = React.useState(amount)
  React.useEffect(() => { const h = setTimeout(() => setDebounced(amount), 400); return () => clearTimeout(h) }, [amount])
  const q = useQuery({
    queryKey: ['cash-limit-preview', companyId, partnerId, debounced, date, bankId, method, exclude], enabled: !!companyId && !!partnerId && !!bankId && debounced > 0,
    queryFn: async () => unwrap(await supabase.rpc('cash_limit_preview', { p_company: companyId!, p_partner: partnerId!, p_amount: debounced, p_date: date,
      p_bank: bankId!, p_method: method, p_exclude: (exclude ?? null) as unknown as string })) as unknown as { kind: string; limit: number; total: number; over: boolean; block: boolean } | null,
  })
  const r = q.data
  if (!r?.over) return null
  return (
    <p className={r.block ? 'rounded-md bg-destructive/10 px-3 py-2 text-[13px] text-destructive' : 'rounded-md bg-warning/10 px-3 py-2 text-[13px] text-warning'}>
      {r.kind === 'individual'
        ? t('Cash with an individual is limited by law to {limit} a day; with this payment it is {total}.', { limit: formatMoney(r.limit), total: formatMoney(r.total) })
        : t('Cash with a business is limited by law to {limit} a day; with this payment it is {total}.', { limit: formatMoney(r.limit), total: formatMoney(r.total) })}{' '}
      {r.block ? t('It will be refused: pay through the bank.') : t('Better through the bank.')}
    </p>
  )
}
