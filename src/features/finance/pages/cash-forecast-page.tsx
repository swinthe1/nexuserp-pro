import { AlertTriangle, ChevronDown, ChevronRight, CircleCheck, Download, HandCoins, Pencil, Plus, Trash2, Wallet } from 'lucide-react'
import * as React from 'react'
import { Link } from 'react-router-dom'
import { Bar, CartesianGrid, ComposedChart, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { Can } from '@/app/company-provider'
import { ErrorState } from '@/components/error-state'
import { PageHeader } from '@/components/page-header'
import { StatCard } from '@/components/stat-card'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { msg, t } from '@/i18n'
import { downloadCsv } from '@/lib/export'
import { cn, formatDate, formatMoney, num, todayISO } from '@/lib/utils'
import { useCashForecast, useCashPlanItems, useDeleteCashPlanItem, useSaveCashPlanItem, type CashForecast, type CashPlanItem, type ForecastWeek } from '../api'

/** the lines of a week, in the order the owner reads them */
const IN_PARTS = [
  { key: 'receipts', label: msg('Customers paying their invoices') },
  { key: 'sales_in', label: msg('Till and cash sales (weekly average)') },
  { key: 'recurring_in', label: msg('Repeating invoices') },
  { key: 'future_sales', label: msg('Invoices not made yet (estimate)') },
  { key: 'plan_in', label: msg('Your own items in') },
] as const
const OUT_PARTS = [
  { key: 'bills', label: msg('Supplier bills') },
  { key: 'future_bills', label: msg('Purchases not billed yet (estimate)') },
  { key: 'payroll', label: msg('Salaries') },
  { key: 'vat', label: msg('VAT') },
  { key: 'other_out', label: msg('Expenses paid on the spot (weekly average)') },
  { key: 'plan_out', label: msg('Your own items out') },
] as const
const KIND: Record<string, string> = {
  receipt: msg('Invoice'), recurring_in: msg('Repeating invoice'), bill: msg('Supplier bill'), payroll: msg('Salaries'), vat: msg('VAT'),
  plan_in: msg('Your item'), plan_out: msg('Your item'),
}
/** 30.10 */
const shortDate = (d: string) => `${d.slice(8, 10)}.${d.slice(5, 7)}`

export function CashForecastPage() {
  const [weeks, setWeeks] = React.useState(13)
  const [estimates, setEstimates] = React.useState(true)
  const q = useCashForecast(weeks, estimates)
  const d = q.data
  const [open, setOpen] = React.useState<number | null>(null)
  const [edit, setEdit] = React.useState<Partial<CashPlanItem> | null>(null)

  const totals = React.useMemo(() => ({
    inflow: (d?.weeks ?? []).reduce((s, w) => s + num(w.inflow), 0),
    outflow: (d?.weeks ?? []).reduce((s, w) => s + num(w.outflow), 0),
  }), [d])
  const last = d?.weeks.at(-1)

  const exportCsv = () => d && downloadCsv(`${t('cash-forecast')}-${d.as_of}`, [
    [t('Week'), t('From'), t('To'), ...IN_PARTS.map((p) => t(p.label)), ...OUT_PARTS.map((p) => t(p.label)), t('Coming in'), t('Going out'), t('Net'), t('Cash at the end')],
    ...d.weeks.map((w) => [w.week, w.start, w.end, ...IN_PARTS.map((p) => w[p.key]), ...OUT_PARTS.map((p) => w[p.key]), w.inflow, w.outflow, w.net, w.closing]),
  ])

  return (
    <>
      <PageHeader title={t('Cash forecast')}
        description={t('Cash and bank today, then week by week what is expected to come in and go out. Customers are expected as late as they usually pay.')}
        actions={<>
          <div className="flex items-center gap-2">
            <Switch id="est" checked={estimates} onCheckedChange={setEstimates} />
            <Label htmlFor="est" className="text-[13px] text-muted-foreground">{t('With estimates')}</Label>
          </div>
          <Select value={String(weeks)} onValueChange={(v) => setWeeks(Number(v))}>
            <SelectTrigger className="w-[130px]"><SelectValue /></SelectTrigger>
            <SelectContent>{[8, 13, 26].map((n) => <SelectItem key={n} value={String(n)}>{t('{n} weeks', { n })}</SelectItem>)}</SelectContent>
          </Select>
          <Button variant="outline" onClick={exportCsv} disabled={!d}><Download /> {t('Export')}</Button>
          <Can perm="finance.write"><Button onClick={() => setEdit({ direction: 'out', every_months: 1, first_date: todayISO() })}><Plus /> {t('Add a cash item')}</Button></Can>
        </>} />

      {q.isError ? <ErrorState error={q.error} onRetry={() => void q.refetch()} /> : !d ? <Skeleton className="h-[480px]" /> : (
        <>
          <Verdict d={d} />

          <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatCard label={t('Cash and bank today')} icon={Wallet} value={formatMoney(d.opening)}
              hint={d.accounts.map((a) => `${a.name}: ${formatMoney(a.balance)}`).join(' · ') || t('No bank or cash accounts yet')} />
            <StatCard label={t('Coming in')} value={<span className="text-success">{formatMoney(totals.inflow)}</span>} hint={t('In the next {n} weeks', { n: d.weeks_count })} />
            <StatCard label={t('Going out')} value={<span className="text-destructive">{formatMoney(-totals.outflow)}</span>} hint={t('In the next {n} weeks', { n: d.weeks_count })} />
            <StatCard label={t('Cash at the end')} tone={num(last?.closing) < 0 ? 'destructive' : 'default'} value={formatMoney(last?.closing)}
              hint={last ? t('On {date}', { date: formatDate(last.end) }) : undefined} />
          </div>

          <Card className="mb-4">
            <CardHeader><CardTitle>{t('Week by week')}</CardTitle>
              <CardDescription>{t('Green: coming in. Red: going out. The line is the cash at the end of each week.')}</CardDescription></CardHeader>
            <CardContent><ForecastChart weeks={d.weeks} /></CardContent>
          </Card>

          <div className="grid grid-cols-[minmax(0,1fr)] gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
            <Card>
              <CardContent className="p-0">
                <Table>
                  <TableHeader><TableRow>
                    <TableHead className="w-8" /><TableHead>{t('Week')}</TableHead>
                    <TableHead className="hidden text-right sm:table-cell">{t('Coming in')}</TableHead><TableHead className="hidden text-right sm:table-cell">{t('Going out')}</TableHead>
                    <TableHead className="text-right">{t('Net')}</TableHead><TableHead className="text-right">{t('Cash at the end')}</TableHead>
                  </TableRow></TableHeader>
                  <TableBody>
                    {d.weeks.map((w) => (
                      <React.Fragment key={w.week}>
                        <TableRow className="cursor-pointer" onClick={() => setOpen(open === w.week ? null : w.week)}>
                          <TableCell className="pr-0 text-muted-foreground">{open === w.week ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}</TableCell>
                          <TableCell><div className="whitespace-nowrap font-medium">{t('Week {n}', { n: w.week })}</div>
                            <div className="whitespace-nowrap text-xs text-muted-foreground tabular">{shortDate(w.start)} – {shortDate(w.end)}</div></TableCell>
                          <TableCell className="hidden text-right tabular text-success sm:table-cell">{num(w.inflow) ? formatMoney(w.inflow) : '—'}</TableCell>
                          <TableCell className="hidden text-right tabular text-destructive sm:table-cell">{num(w.outflow) ? formatMoney(-w.outflow) : '—'}</TableCell>
                          <TableCell className="text-right tabular">{formatMoney(w.net)}</TableCell>
                          <TableCell className={cn('text-right font-medium tabular', num(w.closing) < 0 && 'text-destructive')}>{formatMoney(w.closing)}</TableCell>
                        </TableRow>
                        {open === w.week && <TableRow className="hover:bg-transparent"><TableCell colSpan={6} className="bg-muted/30"><WeekDetail w={w} d={d} /></TableCell></TableRow>}
                      </React.Fragment>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>

            <div className="space-y-4">
              <Card>
                <CardHeader><CardTitle>{t('Customers we expect money from')}</CardTitle>
                  <CardDescription>{t('On average customers pay {n} days after the due date', { n: Math.round(num(d.avg_late_days)) })}</CardDescription></CardHeader>
                <CardContent>
                  {!d.customers.length ? <p className="text-[13px] text-muted-foreground">{t('No open customer invoices.')}</p> : (
                    <ul className="divide-y text-[13px]">
                      {d.customers.map((c) => (
                        <li key={c.id} className="flex items-center justify-between gap-3 py-2">
                          <div className="min-w-0"><Link to={`/partners/${c.id}`} className="block truncate font-medium hover:underline">{c.name}</Link>
                            <span className="text-xs text-muted-foreground">{num(c.late_days) > 0 ? t('Usually {n} days late', { n: Math.round(num(c.late_days)) }) : t('Usually on time')}
                              {c.overdue && <span className="text-warning"> · {t('Overdue')}</span>}</span></div>
                          <span className="shrink-0 tabular">{formatMoney(c.amount)}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                  <div className="mt-3 grid grid-cols-2 gap-2 border-t pt-3 text-xs">
                    <Kpi label={t('Days to get paid (DSO)')} value={d.dso != null ? t('{n} days', { n: d.dso }) : '—'} />
                    <Kpi label={t('Days we take to pay (DPO)')} value={d.dpo != null ? t('{n} days', { n: d.dpo }) : '—'} />
                    {num(d.doubtful) > 0 && <div className="col-span-2 text-muted-foreground">{t('{amount} over 6 months overdue is left out as doubtful.', { amount: formatMoney(d.doubtful) })}</div>}
                  </div>
                </CardContent>
              </Card>
              <PlanItems onEdit={setEdit} />
            </div>
          </div>
        </>
      )}
      {edit && <PlanItemDialog item={edit} onClose={() => setEdit(null)} />}
    </>
  )
}

function Kpi({ label, value }: { label: string; value: string }) {
  return <div><div className="text-muted-foreground">{label}</div><div className="text-sm font-medium tabular">{value}</div></div>
}

/** one sentence on top: will the money last? */
function Verdict({ d }: { d: CashForecast }) {
  const neg = d.first_negative_week ? d.weeks.find((w) => w.week === d.first_negative_week) : null
  if (neg) return (
    <div className="mb-4 flex flex-col gap-3 rounded-xl border border-destructive/30 bg-destructive/5 p-4 sm:flex-row sm:items-center">
      <AlertTriangle className="size-5 shrink-0 text-destructive" />
      <div className="min-w-0 flex-1 text-[13px]">
        <div className="font-medium text-destructive">{t('In week {n} ({from} – {to}) the cash goes below zero: {amount}', { n: neg.week, from: shortDate(neg.start), to: shortDate(neg.end), amount: formatMoney(neg.closing) })}</div>
        <div className="text-muted-foreground">
          {t('Lowest point: week {n}, {amount}.', { n: d.lowest?.week ?? neg.week, amount: formatMoney(d.lowest?.closing) })}{' '}
          {num(d.overdue_in) > 0 && t('Customers are late with {amount}.', { amount: formatMoney(d.overdue_in) })}{' '}
          {t('Collect what is overdue, or agree later dates for some supplier bills.')}
        </div>
      </div>
      <div className="flex shrink-0 gap-2">
        <Button size="sm" variant="outline" asChild><Link to="/finance/receivables"><HandCoins /> {t('Who owes me')}</Link></Button>
        <Button size="sm" variant="outline" asChild><Link to="/finance/payment-proposal">{t('Payment proposal')}</Link></Button>
      </div>
    </div>
  )
  return (
    <div className="mb-4 flex items-center gap-3 rounded-xl border border-success/30 bg-success/5 p-4 text-[13px]">
      <CircleCheck className="size-5 shrink-0 text-success" />
      <div><span className="font-medium">{t('The cash stays above zero for all {n} weeks.', { n: d.weeks_count })}</span>{' '}
        <span className="text-muted-foreground">{d.lowest && t('Lowest point: week {n}, {amount}.', { n: d.lowest.week, amount: formatMoney(d.lowest.closing) })}</span></div>
    </div>
  )
}

function ForecastChart({ weeks }: { weeks: ForecastWeek[] }) {
  const data = React.useMemo(() => weeks.map((w) => ({ name: t('W{n}', { n: w.week }), inflow: num(w.inflow), outflow: num(w.outflow), closing: num(w.closing), range: `${shortDate(w.start)} – ${shortDate(w.end)}` })), [weeks])
  const label: Record<string, string> = { inflow: t('Coming in'), outflow: t('Going out'), closing: t('Cash at the end') }
  return (
    <div className="h-64">
      <ResponsiveContainer>
        <ComposedChart data={data} margin={{ left: 0, right: 4 }} stackOffset="sign">
          <CartesianGrid vertical={false} stroke="hsl(var(--border))" />
          <XAxis dataKey="name" tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }} />
          <YAxis width={56} tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }}
            tickFormatter={(v: number) => Math.abs(v) >= 1000 ? `${Math.round(v / 1000)}k` : String(v)} />
          <Tooltip cursor={{ fill: 'hsl(var(--muted))' }} contentStyle={{ background: 'hsl(var(--popover))', border: '1px solid hsl(var(--border))', borderRadius: 8, fontSize: 12 }}
            labelFormatter={(_l, p) => (p?.[0]?.payload as { range?: string } | undefined)?.range ?? ''}
            formatter={(v: number, k: string) => [formatMoney(k === 'outflow' ? -v : v), label[k] ?? k]} />
          <ReferenceLine y={0} stroke="hsl(var(--foreground))" strokeOpacity={0.35} />
          <Bar dataKey="inflow" stackId="a" fill="hsl(var(--success))" fillOpacity={0.75} radius={[3, 3, 0, 0]} />
          <Bar dataKey="outflow" stackId="a" fill="hsl(var(--destructive))" fillOpacity={0.65} radius={[0, 0, 3, 3]} />
          <Line dataKey="closing" type="monotone" stroke="hsl(var(--primary))" strokeWidth={2.5} dot={{ r: 2.5 }} />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  )
}

/** a week opened: the parts, then each document */
function WeekDetail({ w, d }: { w: ForecastWeek; d: CashForecast }) {
  const flows = d.flows.filter((f) => f.week === w.week)
  const part = (p: { key: keyof ForecastWeek; label: string }, sign: 1 | -1) => num(w[p.key]) !== 0 && (
    <div key={p.key} className="flex justify-between gap-3"><span className="text-muted-foreground">{t(p.label)}</span>
      <span className={cn('tabular', sign > 0 ? 'text-success' : 'text-destructive')}>{formatMoney(sign * num(w[p.key]))}</span></div>
  )
  const href = (f: CashForecast['flows'][number]) => f.kind === 'receipt' ? `/sales/invoices/${f.ref}` : f.kind === 'bill' ? `/procurement/bills/${f.ref}` : undefined
  return (
    <div className="grid gap-4 py-1 text-[13px] lg:grid-cols-[260px_minmax(0,1fr)]">
      <div className="space-y-1">
        {IN_PARTS.map((p) => part(p, 1))}
        {OUT_PARTS.map((p) => part(p, -1))}
        {!num(w.inflow) && !num(w.outflow) && <span className="text-muted-foreground">{t('Nothing expected this week.')}</span>}
      </div>
      {!!flows.length && (
        <ul className="max-h-72 divide-y overflow-y-auto rounded-md border bg-background">
          {flows.map((f, i) => {
            const to = href(f)
            return (
              <li key={i} className="flex items-center gap-3 px-3 py-1.5">
                <span className="w-12 shrink-0 text-xs text-muted-foreground tabular">{shortDate(f.date)}</span>
                <div className="min-w-0 flex-1 truncate">
                  <span className="text-muted-foreground">{t(KIND[f.kind] ?? f.kind)}</span>{' '}
                  {to ? <Link to={to} className="font-medium hover:underline">{f.label}</Link> : <span className="font-medium">{f.label}</span>}
                  {f.partner && <span className="text-muted-foreground"> · {f.partner}</span>}
                  {f.overdue && <span className="text-warning"> · {t('Overdue')}</span>}
                </div>
                <span className={cn('shrink-0 tabular', num(f.amount) >= 0 ? 'text-success' : 'text-destructive')}>{formatMoney(f.amount)}</span>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

const EVERY: { v: number; label: string }[] = [
  { v: 0, label: msg('Once') }, { v: 1, label: msg('Every month') }, { v: 2, label: msg('Every 2 months') },
  { v: 3, label: msg('Every 3 months') }, { v: 6, label: msg('Every 6 months') }, { v: 12, label: msg('Every year') },
]

/** the owner's own known items: rent, a loan, the owner's draw, a grant coming in */
function PlanItems({ onEdit }: { onEdit: (i: CashPlanItem) => void }) {
  const items = useCashPlanItems()
  const del = useDeleteCashPlanItem()
  return (
    <Card>
      <CardHeader><CardTitle>{t('Your own items')}</CardTitle>
        <CardDescription>{t('Rent, a loan instalment, the owner\'s draw… anything the books do not know yet.')}</CardDescription></CardHeader>
      <CardContent>
        {items.isLoading ? <Skeleton className="h-16" /> : !items.data?.length ? <p className="text-[13px] text-muted-foreground">{t('None yet.')}</p> : (
          <ul className="divide-y text-[13px]">
            {items.data.map((i) => (
              <li key={i.id} className={cn('flex items-center gap-2 py-2', !i.is_active && 'opacity-50')}>
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium">{i.name}</div>
                  <div className="text-xs text-muted-foreground">{t(EVERY.find((e) => e.v === i.every_months)?.label ?? '')} · {t('from {date}', { date: formatDate(i.first_date) })}{i.end_date && ` · ${t('until {date}', { date: formatDate(i.end_date) })}`}</div>
                </div>
                <span className={cn('shrink-0 tabular', i.direction === 'in' ? 'text-success' : 'text-destructive')}>{formatMoney(i.direction === 'in' ? i.amount : -i.amount)}</span>
                <Can perm="finance.write">
                  <Button size="icon" variant="ghost" className="size-7" aria-label={t('Change|edit')} onClick={() => onEdit(i)}><Pencil className="size-3.5" /></Button>
                  <Button size="icon" variant="ghost" className="size-7" aria-label={t('Delete')} onClick={() => del.mutate(i.id)}><Trash2 className="size-3.5" /></Button>
                </Can>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}

function PlanItemDialog({ item, onClose }: { item: Partial<CashPlanItem>; onClose: () => void }) {
  const save = useSaveCashPlanItem()
  const [v, setV] = React.useState({
    name: item.name ?? '', direction: item.direction ?? 'out', amount: item.amount != null ? String(item.amount) : '',
    first_date: item.first_date ?? todayISO(), every_months: item.every_months ?? 1, end_date: item.end_date ?? '', is_active: item.is_active ?? true,
  })
  const ok = v.name.trim() && num(v.amount) > 0 && v.first_date
  const submit = async () => {
    await save.mutateAsync({ id: item.id, name: v.name.trim(), direction: v.direction, amount: num(v.amount), first_date: v.first_date,
      every_months: v.every_months, end_date: v.end_date || null, is_active: v.is_active })
    onClose()
  }
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>{item.id ? t('Change the item') : t('Add a cash item')}</DialogTitle></DialogHeader>
        <div className="grid gap-3">
          <div className="grid gap-1.5"><Label htmlFor="pi-name">{t('Name')}</Label>
            <Input id="pi-name" autoFocus value={v.name} placeholder={t('e.g. Shop rent')} onChange={(e) => setV({ ...v, name: e.target.value })} /></div>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5"><Label>{t('Direction')}</Label>
              <Select value={v.direction} onValueChange={(x) => setV({ ...v, direction: x })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="out">{t('Going out')}</SelectItem><SelectItem value="in">{t('Coming in')}</SelectItem></SelectContent>
              </Select></div>
            <div className="grid gap-1.5"><Label htmlFor="pi-amt">{t('Amount')}</Label>
              <Input id="pi-amt" inputMode="decimal" value={v.amount} onChange={(e) => setV({ ...v, amount: e.target.value })} /></div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5"><Label htmlFor="pi-from">{t('First date')}</Label>
              <Input id="pi-from" type="date" value={v.first_date} onChange={(e) => setV({ ...v, first_date: e.target.value })} /></div>
            <div className="grid gap-1.5"><Label>{t('Repeats')}</Label>
              <Select value={String(v.every_months)} onValueChange={(x) => setV({ ...v, every_months: Number(x) })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{EVERY.map((e) => <SelectItem key={e.v} value={String(e.v)}>{t(e.label)}</SelectItem>)}</SelectContent>
              </Select></div>
          </div>
          {v.every_months > 0 && <div className="grid gap-1.5"><Label htmlFor="pi-end">{t('Last date (optional)')}</Label>
            <Input id="pi-end" type="date" value={v.end_date} onChange={(e) => setV({ ...v, end_date: e.target.value })} /></div>}
          {item.id && <div className="flex items-center gap-2"><Switch id="pi-on" checked={v.is_active} onCheckedChange={(x) => setV({ ...v, is_active: x })} />
            <Label htmlFor="pi-on">{t('Count it in the forecast')}</Label></div>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{t('Cancel')}</Button>
          <Button disabled={!ok} loading={save.isPending} onClick={submit}>{t('Save')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
