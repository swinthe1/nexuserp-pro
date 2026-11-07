import { BellRing } from 'lucide-react'
import { useSendReminder } from '../components/reminders'
import * as React from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Can, useCompany } from '@/app/company-provider'
import { EmptyState } from '@/components/empty-state'
import { PageHeader } from '@/components/page-header'
import { StatCard } from '@/components/stat-card'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { ErrorState } from '@/components/error-state'
import { msg, t, tn } from '@/i18n'
import { cn, formatDate, formatMoney, num, todayISO } from '@/lib/utils'
import { GridExportMenu } from '@/components/export-menu'
import { useAging, type AgingRow } from '../api'
import { useQuery } from '@tanstack/react-query'
import { MultiPick } from '@/components/multi-pick'
import { td } from '@/i18n'
import { unwrap } from '@/lib/errors'
import { supabase } from '@/lib/supabase'
import { useWarehouses } from '@/features/inventory/api'
import { VENDOR_KINDS } from '@/features/sales/vendor-kinds'

const BUCKETS = [
  { key: 'not_due', label: msg('Not due') },
  { key: 'd1_30', label: msg('1–30 days') },
  { key: 'd31_60', label: msg('31–60 days') },
  { key: 'd61_90', label: msg('61–90 days') },
  { key: 'd90_plus', label: msg('Over 90 days') },
] as const

type Due = { id: string; number: string; ref: string | null; partner_id: string; partner: string; date: string; due_date: string; days: number; total: number; due: number
  unit: string | null; unit_id?: string | null; kinds?: string[]; href: string }

/**
 * Every open invoice or bill by its due date (from the meeting with the staff): late ones first,
 * then week by week, with what falls due each week; bills also by unit and by kind of supplier.
 */
function DueList({ kind, asOf }: { kind: 'ar' | 'ap'; asOf: string }) {
  const { companyId } = useCompany()
  const whs = useWarehouses()
  const [units, setUnits] = React.useState<string[]>([])
  const [kinds, setKinds] = React.useState<string[]>([])
  const q = useQuery({
    queryKey: ['fin', companyId, 'debts-by-due', kind, units, kinds, asOf], enabled: !!companyId,
    queryFn: async () => unwrap(await supabase.rpc('debts_by_due', { p_company: companyId!, p_kind: kind, p: { units, kinds, as_of: asOf } as never })) as unknown as { rows: Due[]; as_of: string },
  })
  const rows = q.data?.rows ?? []
  // the week a due date falls in: late, this week, next week, then the Monday it starts
  const groups = React.useMemo(() => {
    const today = new Date(`${q.data?.as_of ?? todayISO()}T00:00:00`)
    const monday = new Date(today); monday.setDate(today.getDate() - ((today.getDay() + 6) % 7))
    const m = new Map<string, { label: string; tone?: 'late'; rows: Due[]; sum: number }>()
    for (const r of rows) {
      let k: string, label: string, tone: 'late' | undefined
      if (r.days < 0) { k = '0'; label = t('Late'); tone = 'late' } else {
        const d = new Date(`${r.due_date}T00:00:00`)
        const w = Math.floor((d.getTime() - monday.getTime()) / (7 * 864e5))
        const start = new Date(monday); start.setDate(monday.getDate() + w * 7)
        const end = new Date(start); end.setDate(start.getDate() + 6)
        k = `1${String(w).padStart(4, '0')}`
        label = w === 0 ? t('This week') : w === 1 ? t('Next week') : `${formatDate(start.toISOString().slice(0, 10))} – ${formatDate(end.toISOString().slice(0, 10))}`
      }
      const g = m.get(k) ?? { label, tone, rows: [], sum: 0 }
      g.rows.push(r); g.sum += num(r.due); m.set(k, g)
    }
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([, g]) => g)
  }, [rows, q.data?.as_of])
  const isAR = kind === 'ar'
  return (
    <div className="mt-4 grid gap-3">
      {!isAR && (
        <div className="flex flex-wrap items-center gap-2">
          <MultiPick label={t('Units|stores')} value={units} onChange={setUnits} options={(whs.data ?? []).map((w) => ({ value: w.id, label: td(w.name), hint: w.code }))} />
          <MultiPick label={t('Kind of supplier')} value={kinds} onChange={setKinds} options={VENDOR_KINDS.map(([value, label]) => ({ value, label: t(label) }))} />
        </div>
      )}
      {q.isLoading ? <Skeleton className="h-60" /> : q.isError ? <ErrorState error={q.error} onRetry={() => void q.refetch()} /> : !rows.length ? (
        <Card><EmptyState title={isAR ? t('No customer owes you anything') : t('Nothing to pay')} description={t('Change the dates or the filters.')} /></Card>
      ) : groups.map((g) => (
        <Card key={g.label} className="overflow-hidden">
          <div className={cn('flex items-center justify-between border-b px-4 py-2.5', g.tone === 'late' ? 'bg-destructive/5' : 'bg-muted/40')}>
            <span className={cn('font-semibold', g.tone === 'late' && 'text-destructive')}>{g.label} <span className="font-normal text-muted-foreground">· {g.rows.length}</span></span>
            <span className="font-semibold tabular">{formatMoney(g.sum)}</span>
          </div>
          <Table>
            <TableBody>
              {g.rows.map((r) => (
                <TableRow key={r.id} className="hover:bg-muted/30">
                  <TableCell className="w-28 whitespace-nowrap tabular">{formatDate(r.due_date)}</TableCell>
                  <TableCell className={cn('w-36 whitespace-nowrap text-[12.5px]', r.days < 0 ? 'text-destructive' : 'text-muted-foreground')}>
                    {r.days < 0 ? tn(-r.days, '{n} day late', '{n} days late') : r.days === 0 ? t('Due today') : tn(r.days, 'in {n} day', 'in {n} days')}</TableCell>
                  <TableCell><Link to={`/partners/${r.partner_id}`} className="font-medium hover:underline">{r.partner}</Link></TableCell>
                  <TableCell className="whitespace-nowrap text-[13px]"><Link to={r.href} className="hover:text-primary hover:underline">{r.number}</Link>{r.ref && <span className="ml-1.5 text-muted-foreground">{r.ref}</span>}</TableCell>
                  {!isAR && <TableCell className="text-[13px] text-muted-foreground">{r.unit ? td(r.unit) : ''}</TableCell>}
                  <TableCell className="text-right text-[12.5px] text-muted-foreground tabular">{formatMoney(num(r.total))}</TableCell>
                  <TableCell className="text-right font-medium tabular">{formatMoney(num(r.due))}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      ))}
    </div>
  )
}

export function AgingPage({ kind }: { kind: 'ar' | 'ap' }) {
  const [view, setView] = React.useState<'partner' | 'due'>('partner')
  const navigate = useNavigate()
  const { company } = useCompany()
  const [asOf, setAsOf] = React.useState(todayISO())
  const aging = useAging(kind, asOf)
  const rows = React.useMemo(() => [...(aging.data ?? [])].sort((a, b) => num(b.total) - num(a.total)), [aging.data])
  const sum = (k: keyof AgingRow) => rows.reduce((s, r) => s + num(r[k]), 0)
  const total = sum('total')
  const overdue = sum('d1_30') + sum('d31_60') + sum('d61_90') + sum('d90_plus')
  const isAR = kind === 'ar'
  const payType = isAR ? 'customer_payment' : 'vendor_payment'
  const partnerHref = (id: string) => `/partners/${id}`
  const remind = useSendReminder()
  const overdueOf = (r: AgingRow) => num(r.d1_30) + num(r.d31_60) + num(r.d61_90) + num(r.d90_plus)

  const exportGrid = () => ([
    [isAR ? t('Customer') : t('Vendor'), ...BUCKETS.map((b) => t(b.label)), t('Not matched'), t('Total with VAT'), t('Oldest due date'), t('Documents')],
    ...rows.map((r) => [r.partner_name, ...BUCKETS.map((b) => num(r[b.key])), num(r.unapplied), num(r.total), r.oldest_due ? formatDate(r.oldest_due) : '', num(r.documents)]),
  ])

  return (
    <>
      <PageHeader title={t('Debts|menu')}
        description={isAR ? t('Open customer balances, by how long they are overdue. Receipts not yet matched to an invoice reduce the balance.') : t('Open vendor balances, by how long they are overdue. Payments not yet matched to a bill reduce the balance.')}
        actions={<>
          <div className="flex items-center gap-2"><Label htmlFor="asof" className="text-[13px] text-muted-foreground">{t('On date')}</Label>
            <Input id="asof" type="date" className="w-[150px]" value={asOf} onChange={(e) => setAsOf(e.target.value || todayISO())} /></div>
          <GridExportMenu name={`${isAR ? t('receivables') : t('payables')}-${asOf}`} title={t('Debts|menu')} subtitle={`${isAR ? t('Customers') : t('Vendors')} · ${formatDate(asOf)}`} grid={exportGrid} disabled={!rows.length} />
          {!isAR && <Button variant="outline" asChild><Link to="/finance/payment-proposal">{t('Pay several at once')}</Link></Button>}
          <Can perm="invoicing.write"><Button asChild><Link to={`/finance/payments/new?type=${payType}`}>{isAR ? t('Receive a payment') : t('Pay a vendor')}</Link></Button></Can>
        </>} />
      {/* both sides of the debts on one page: what customers owe me, what I owe suppliers */}
      <Tabs value={kind} onValueChange={(v) => navigate(v === 'ar' ? '/finance/receivables' : '/finance/payables', { replace: true })} className="mb-4">
        <TabsList>
          <TabsTrigger value="ar">{t('Receivables|menu')}</TabsTrigger>
          <TabsTrigger value="ap">{t('Payables|menu')}</TabsTrigger>
        </TabsList>
      </Tabs>
      <div className="mb-3 inline-flex w-fit rounded-lg bg-muted p-1 text-sm">
        {(['partner', 'due'] as const).map((v) => (
          <button key={v} type="button" aria-pressed={view === v} onClick={() => setView(v)}
            className={cn('rounded-md px-3 py-1.5 font-medium', view === v ? 'bg-background shadow-sm' : 'text-muted-foreground')}>{v === 'partner' ? t('By partner') : t('By due date')}</button>
        ))}
      </div>
      {view === 'due' ? <DueList kind={kind} asOf={asOf} /> : <>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label={isAR ? t('Total to collect (with VAT)') : t('Total to pay (with VAT)')} value={formatMoney(total)} loading={aging.isLoading} hint={[isAR ? tn(rows.length, '{n} customer', '{n} customers') : tn(rows.length, '{n} vendor', '{n} vendors'), company?.base_currency].filter(Boolean).join(' · ')} />
        <StatCard label={t('Overdue (with VAT)')} value={formatMoney(overdue)} loading={aging.isLoading} tone={overdue ? (isAR ? 'warning' : 'destructive') : 'default'} hint={total ? t('{pct}% of the balance', { pct: ((overdue / total) * 100).toFixed(0) }) : undefined} />
        <StatCard label={t('Over 90 days (with VAT)')} value={formatMoney(sum('d90_plus'))} loading={aging.isLoading} tone={sum('d90_plus') ? 'destructive' : 'default'} hint={isAR ? t('Send a reminder, or consider a provision') : t('Vendors may stop supplying')} />
        <StatCard label={t('Not matched')} value={formatMoney(-sum('unapplied'))} loading={aging.isLoading} hint={isAR ? t('Receipts not matched to an invoice') : t('Payments not matched to a bill')} />
      </div>
      {/* the distribution bar makes the shape of the balance readable at a glance */}
      {total > 0 && (
        <div className="mt-4 flex h-2.5 overflow-hidden rounded-full bg-muted" aria-hidden>
          {BUCKETS.map((b, i) => { const v = Math.max(sum(b.key), 0); return v ? <div key={b.key} style={{ width: `${(v / Math.max(total, 1)) * 100}%`, opacity: 0.35 + i * 0.16 }} className={i === 0 ? 'bg-success' : 'bg-destructive'} title={`${t(b.label)}: ${formatMoney(v)}`} /> : null })}
        </div>
      )}
      <Card className="mt-4">
        <CardContent className="overflow-x-auto p-0">
          {aging.isLoading ? <Skeleton className="m-4 h-48" /> : aging.isError ? <ErrorState error={aging.error} onRetry={() => void aging.refetch()} /> : !rows.length ? (
            <EmptyState title={isAR ? t('No customer owes you anything') : t('Nothing to pay')} description={isAR ? t('On {date} every invoice is paid.', { date: formatDate(asOf) }) : t('On {date} every vendor bill is paid.', { date: formatDate(asOf) })} />
          ) : (
            <Table>
              <TableHeader><TableRow className="hover:bg-transparent">
                <TableHead>{isAR ? t('Customer') : t('Vendor')}</TableHead>
                {BUCKETS.map((b) => <TableHead key={b.key} className="text-right">{t(b.label)}</TableHead>)}
                <TableHead className="text-right">{t('Not matched')}</TableHead><TableHead className="text-right">{t('Total with VAT')}</TableHead><TableHead>{t('Oldest due date')}</TableHead><TableHead className="w-24" />
              </TableRow></TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.partner_id} className="cursor-pointer" onClick={() => navigate(partnerHref(r.partner_id))}>
                    <TableCell><span className="font-medium">{r.partner_name}</span><span className="ml-2 text-xs text-muted-foreground">{tn(r.documents, '{n} open', '{n} open|plural')}</span></TableCell>
                    {BUCKETS.map((b, i) => <TableCell key={b.key} className={cn('text-right tabular', !num(r[b.key]) && 'text-muted-foreground/50', i >= 3 && num(r[b.key]) > 0 && 'text-destructive')}>{num(r[b.key]) ? formatMoney(r[b.key]) : '—'}</TableCell>)}
                    <TableCell className="text-right tabular text-muted-foreground">{num(r.unapplied) ? formatMoney(r.unapplied) : '—'}</TableCell>
                    <TableCell className="text-right tabular font-medium">{formatMoney(r.total)}</TableCell>
                    <TableCell className={cn('text-[13px]', r.oldest_due && r.oldest_due < asOf && 'text-destructive')}>{formatDate(r.oldest_due)}</TableCell>
                    <TableCell onClick={(e) => e.stopPropagation()}>
                      <Can perm="invoicing.write"><span className="flex justify-end gap-1">
                        {isAR && overdueOf(r) > 0 && <Button size="sm" variant="ghost" title={t('Send a reminder now')} aria-label={t('Send a reminder now')} loading={remind.isPending && remind.variables === r.partner_id} onClick={() => remind.mutate(r.partner_id)}><BellRing /></Button>}
                        <Button size="sm" variant="ghost" asChild><Link to={`/finance/payments/new?type=${payType}&partner=${r.partner_id}`}>{isAR ? t('Collect') : t('Pay')}</Link></Button>
                      </span></Can>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
              <TableFooter><TableRow className="hover:bg-transparent">
                <TableCell className="font-medium">{t('Total')}</TableCell>
                {BUCKETS.map((b) => <TableCell key={b.key} className="text-right tabular font-semibold">{formatMoney(sum(b.key))}</TableCell>)}
                <TableCell className="text-right tabular">{formatMoney(sum('unapplied'))}</TableCell>
                <TableCell className="text-right tabular font-semibold">{formatMoney(total)}</TableCell><TableCell colSpan={2} />
              </TableRow></TableFooter>
            </Table>
          )}
        </CardContent>
      </Card>
      </>}
    </>
  )
}
