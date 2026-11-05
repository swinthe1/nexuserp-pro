import { useQuery } from '@tanstack/react-query'
import { ChevronDown, ChevronRight } from 'lucide-react'
import * as React from 'react'
import { Link } from 'react-router-dom'
import { useCompany } from '@/app/company-provider'
import { EmptyState } from '@/components/empty-state'
import { ErrorState } from '@/components/error-state'
import { GridExportMenu } from '@/components/export-menu'
import { MultiPick } from '@/components/multi-pick'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { t, td, tServer } from '@/i18n'
import { unwrap } from '@/lib/errors'
import { supabase } from '@/lib/supabase'
import { cn, formatDate, formatMoney, num, todayISO } from '@/lib/utils'

export type CashAccount = { id: string; name: string; kind: 'cash' | 'bank'; currency: string; account: string; units: { id: string; name: string }[] }
type Line = { account: string; entry: string; description: string | null; partner: string | null; source_type: string | null; source_id: string | null; in: number; out: number }
type Day = { date: string; opening: number; in: number; out: number; closing: number; lines: Line[] }
type Book = { opening: number; in: number; out: number; closing: number; days: Day[]; currency: string; accounts: { id: string; name: string }[] }

/** the bank and cash accounts with the units they belong to (a till's drawer, a unit's safe) */
export function useCashAccounts() {
  const { companyId } = useCompany()
  return useQuery({
    queryKey: ['fin', companyId, 'cash-accounts'], enabled: !!companyId, staleTime: 60_000,
    queryFn: async () => {
      const r = await supabase.rpc('cash_accounts', { p_company: companyId! })
      if (r.error?.code === 'PGRST202') return [] as CashAccount[]   // a server not updated yet
      return unwrap(r) as unknown as CashAccount[]
    },
  })
}

// where a line of the book came from
const sourceHref = (l: Line) => {
  if (!l.source_id) return null
  if (l.source_type === 'customer_payment' || l.source_type === 'vendor_payment' || l.source_type === 'payment') return `/finance/payments/${l.source_id}`
  if (l.source_type === 'pos_session') return `/pos/sessions/${l.source_id}`
  return null
}

/**
 * The cash book: each day the cash at the start, what came in, what went out and the cash at the
 * end, for the cash accounts chosen (or those of the units chosen). A day opens to its lines.
 */
export function CashBook() {
  const { companyId } = useCompany()
  const accounts = useCashAccounts()
  const [from, setFrom] = React.useState(`${todayISO().slice(0, 8)}01`)
  const [to, setTo] = React.useState(todayISO())
  const [acc, setAcc] = React.useState<string[]>([])
  const [units, setUnits] = React.useState<string[]>([])
  const [open, setOpen] = React.useState<string | null>(null)
  const q = useQuery({
    queryKey: ['fin', companyId, 'cash-book', from, to, acc, units], enabled: !!companyId,
    queryFn: async () => unwrap(await supabase.rpc('cash_book', { p_company: companyId!, p: { from, to, accounts: acc, units } as never })) as unknown as Book,
  })
  const unitOptions = React.useMemo(() => {
    const m = new Map<string, string>()
    for (const a of accounts.data ?? []) for (const u of a.units) m.set(u.id, u.name)
    return [...m].map(([value, label]) => ({ value, label: td(label) }))
  }, [accounts.data])
  const d = q.data
  const days = d?.days ?? []

  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-end gap-2">
        <div className="grid gap-1"><Label className="text-xs">{t('From|date')}</Label><Input type="date" className="h-9 w-40" value={from} max={to} onChange={(e) => setFrom(e.target.value)} /></div>
        <div className="grid gap-1"><Label className="text-xs">{t('To|date')}</Label><Input type="date" className="h-9 w-40" value={to} min={from} onChange={(e) => setTo(e.target.value)} /></div>
        <MultiPick label={t('Cash accounts')} value={acc} onChange={setAcc}
          options={(accounts.data ?? []).map((a) => ({ value: a.id, label: td(a.name), hint: a.kind === 'bank' ? t('Bank') : a.account }))} />
        {unitOptions.length > 0 && <MultiPick label={t('Units|stores')} value={units} onChange={setUnits} options={unitOptions} />}
        <div className="ml-auto">
          {d && <GridExportMenu name={t('cash-book')} title={t('Cash book|by day')} subtitle={`${formatDate(from)} – ${formatDate(to)}${d.accounts.length ? ` · ${d.accounts.map((a) => td(a.name)).join(', ')}` : ''}`}
            grid={() => [[t('Date'), t('Entry'), t('Description'), t('Partner'), t('In'), t('Out'), t('Balance')],
              [null, null, t('Opening balance'), null, null, null, num(d.opening)],
              ...days.flatMap((x) => { let bal = num(x.opening); return x.lines.map((l) => { bal += num(l.in) - num(l.out); return [formatDate(x.date), l.entry, tServer(l.description ?? ''), l.partner, num(l.in) || null, num(l.out) || null, Math.round(bal * 100) / 100] }) }),
              [null, null, t('Closing balance'), null, num(d.in), num(d.out), num(d.closing)]]} />}
        </div>
      </div>
      <p className="-mt-1 text-[12px] text-muted-foreground">{acc.length ? null : t('Without an account chosen: every cash account (not the banks), of the units chosen.')}</p>
      {q.isLoading ? <Skeleton className="h-72" /> : q.isError ? <ErrorState error={q.error} onRetry={() => void q.refetch()} /> : d && (
        <Card className="overflow-hidden">
          <div className="grid grid-cols-4 gap-px border-b bg-border text-[13px]">
            {[[t('Opening balance'), d.opening], [t('In'), d.in], [t('Out'), d.out], [t('Closing balance'), d.closing]].map(([k, v]) => (
              <div key={k as string} className="bg-card px-4 py-3"><div className="text-[12px] text-muted-foreground">{k}</div><div className="text-lg font-semibold tabular">{formatMoney(num(v))}</div></div>
            ))}
          </div>
          {!days.length ? <EmptyState compact title={t('No cash movement in these days')} description={t('Change the dates or the filters.')} /> : (
            <table className="w-full text-[13px]">
              <thead><tr className="border-b bg-muted/40 text-[12px] text-muted-foreground">
                <th className="px-3 py-2 text-left font-medium">{t('Date')}</th><th className="px-3 py-2 text-right font-medium">{t('Opening balance')}</th>
                <th className="px-3 py-2 text-right font-medium">{t('In')}</th><th className="px-3 py-2 text-right font-medium">{t('Out')}</th>
                <th className="px-3 py-2 text-right font-medium">{t('Closing balance')}</th></tr></thead>
              <tbody>
                {days.map((x) => (
                  <React.Fragment key={x.date}>
                    <tr className="cursor-pointer border-b hover:bg-muted/40" onClick={() => setOpen(open === x.date ? null : x.date)}>
                      <td className="px-3 py-2 font-medium"><span className="inline-flex items-center gap-1">{open === x.date ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}{formatDate(x.date)}
                        <span className="text-[12px] font-normal text-muted-foreground">· {x.lines.length}</span></span></td>
                      <td className="px-3 py-2 text-right tabular">{formatMoney(num(x.opening))}</td>
                      <td className="px-3 py-2 text-right tabular text-success">{num(x.in) ? formatMoney(num(x.in)) : '—'}</td>
                      <td className="px-3 py-2 text-right tabular">{num(x.out) ? `−${formatMoney(num(x.out))}` : '—'}</td>
                      <td className={cn('px-3 py-2 text-right font-semibold tabular', num(x.closing) < 0 && 'text-destructive')}>{formatMoney(num(x.closing))}</td>
                    </tr>
                    {open === x.date && x.lines.map((l, i) => {
                      const href = sourceHref(l)
                      return (
                        <tr key={i} className="border-b bg-muted/20 text-[12.5px]">
                          <td className="py-1.5 pl-8 pr-3 text-muted-foreground tabular">{l.entry}</td>
                          <td className="px-3 py-1.5" colSpan={1}>{href ? <Link to={href} className="hover:text-primary hover:underline">{tServer(l.description ?? '')}</Link> : tServer(l.description ?? '')}
                            {l.partner && <span className="block text-muted-foreground">{l.partner}</span>}</td>
                          <td className="px-3 py-1.5 text-right tabular">{num(l.in) ? formatMoney(num(l.in)) : ''}</td>
                          <td className="px-3 py-1.5 text-right tabular">{num(l.out) ? `−${formatMoney(num(l.out))}` : ''}</td>
                          <td className="px-3 py-1.5 text-right text-muted-foreground">{l.account}</td>
                        </tr>
                      )
                    })}
                  </React.Fragment>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      )}
    </div>
  )
}
