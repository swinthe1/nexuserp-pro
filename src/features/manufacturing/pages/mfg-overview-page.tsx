import { Factory, Layers, Plus } from 'lucide-react'
import * as React from 'react'
import { Link } from 'react-router-dom'
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { toast } from 'sonner'
import { z } from 'zod'
import { Can, useCompany } from '@/app/company-provider'
import { EmptyState } from '@/components/empty-state'
import { PageHeader } from '@/components/page-header'
import { SimpleFormDialog } from '@/components/simple-form-dialog'
import { StatCard } from '@/components/stat-card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { ErrorState } from '@/components/error-state'
import { formatDateWith, msg, t, td, tn } from '@/i18n'
import { cn, formatCompact, formatMoney, formatQty, num, todayISO } from '@/lib/utils'
import { useWarehouses } from '@/features/inventory/api'
import { useMfgOverview, usePlan, useSaveWorkCenter, useWorkCenterLoad, useWorkCenters, type LoadRow, type WorkCenter } from '../api'
import { NewWorkOrderDialog } from './work-orders-page'

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const RANGES = {
  week: { label: msg('Last 7 days'), from: () => new Date(Date.now() - 6 * 864e5) },
  month: { label: msg('This month'), from: () => { const n = new Date(); return new Date(n.getFullYear(), n.getMonth(), 1) } },
  ytd: { label: msg('Year to date'), from: () => new Date(new Date().getFullYear(), 0, 1) },
} as const
const tooltipStyle = { background: 'hsl(var(--popover))', border: '1px solid hsl(var(--border))', borderRadius: 8, fontSize: 12 }
const axisTick = { fontSize: 11, fill: 'hsl(var(--muted-foreground))' }

export function MfgOverviewPage() {
  const { company } = useCompany()
  const [range, setRange] = React.useState<keyof typeof RANGES>('month')
  const from = iso(RANGES[range].from()); const to = todayISO()
  const ov = useMfgOverview(from, to)
  const plan = usePlan()
  const [make, setMake] = React.useState<{ variant: string; qty: number } | null>(null)
  const [newOpen, setNewOpen] = React.useState(false)
  const d = ov.data
  const toMake = (plan.data ?? []).filter((p) => num(p.suggested) > 0)
  const days = (d?.by_day ?? []).map((x) => ({ day: formatDateWith(new Date(`${x.day}T00:00:00`), { day: 'numeric', month: 'short' }), value: num(x.value) }))
  return (
    <>
      <PageHeader title={t('Production')} description={t('What is being made now, what to make next and what it costs, in {currency} without VAT.', { currency: company?.base_currency ?? 'ALL' })}
        actions={<>
          <Select value={range} onValueChange={(v) => setRange(v as keyof typeof RANGES)}><SelectTrigger className="w-[150px]" aria-label={t('Period')}><SelectValue /></SelectTrigger>
            <SelectContent>{Object.entries(RANGES).map(([k, r]) => <SelectItem key={k} value={k}>{t(r.label)}</SelectItem>)}</SelectContent></Select>
          <Can perm="manufacturing.write"><Button variant="outline" asChild><Link to="/manufacturing/boms/new"><Layers /> {t('New recipe')}</Link></Button>
            <Button onClick={() => setNewOpen(true)}><Plus /> {t('New work order')}</Button></Can>
        </>} />
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label={t('In production')} value={(d?.released ?? 0) + (d?.in_progress ?? 0)} loading={ov.isLoading} href="/manufacturing/orders?view=board"
          hint={t('{a} in progress · {b} released · {c} planned', { a: d?.in_progress ?? 0, b: d?.released ?? 0, c: d?.draft ?? 0 })} />
        <StatCard label={t('Late')} value={d?.late ?? 0} loading={ov.isLoading} tone={d?.late ? 'destructive' : 'default'} href="/manufacturing/orders" hint={t('Past their due time and not finished')} />
        <StatCard label={t('Work in progress (without VAT)')} value={formatMoney(d?.wip)} loading={ov.isLoading} hint={t('{n} finished, waiting to be closed', { n: d?.completed ?? 0 })} />
        <StatCard label={t('Produced (without VAT)')} value={formatMoney(d?.produced_value)} loading={ov.isLoading} hint={tn(d?.produced_orders ?? 0, '{n} work order · at actual cost', '{n} work orders · at actual cost')} />
      </div>
      <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label={t('To make')} value={toMake.length} loading={plan.isLoading} tone={toMake.length ? 'warning' : 'default'} hint={t('Products below their minimum or short for orders')} />
        <StatCard label={t('Closed: planned vs actual')} value={d && num(d.planned_cost) ? `${formatQty(Math.round(((num(d.actual_cost) - num(d.planned_cost)) / num(d.planned_cost)) * 1000) / 10)}%` : '—'}
          loading={ov.isLoading} tone={d && num(d.actual_cost) > num(d.planned_cost) * 1.02 ? 'warning' : 'default'}
          hint={d ? t('{actual} actual against {planned} planned', { actual: formatMoney(d.actual_cost), planned: formatMoney(d.planned_cost) }) : undefined} />
        <StatCard label={t('Cost difference (without VAT)')} value={formatMoney(d?.variance)} loading={ov.isLoading} tone={num(d?.variance) > 0 ? 'warning' : 'default'} hint={t('Booked when orders are closed, account 6012')} />
        <StatCard label={t('Recipes')} value={<Link className="hover:underline" to="/manufacturing/boms">{t('Open')}</Link>} hint={t('Ingredients, steps, cost and where each item is used')} />
      </div>

      <Card className="mt-4">
        <CardHeader className="flex-row flex-wrap items-center justify-between gap-2 space-y-0 py-3">
          <div><CardTitle>{t('Production plan')}</CardTitle><CardDescription>{t('Free stock, minus customer orders and what other work orders need, plus what is already being made. Below the minimum, the plan fills up to the maximum.')}</CardDescription></div>
        </CardHeader>
        <CardContent className="overflow-x-auto p-0">
          {plan.isLoading ? <Skeleton className="m-4 h-40" /> : plan.isError ? <ErrorState compact error={plan.error} onRetry={() => void plan.refetch()} /> : !plan.data?.length ? <EmptyState icon={Factory} title={t('Nothing is produced yet')} description={t('Create a recipe to plan production.')}
            action={<Can perm="manufacturing.write"><Button variant="outline" asChild><Link to="/manufacturing/boms/new"><Layers /> {t('New recipe')}</Link></Button></Can>} /> : (
            <Table>
              <TableHeader><TableRow className="hover:bg-transparent"><TableHead>{t('Product')}</TableHead><TableHead className="text-right">{t('Free stock')}</TableHead><TableHead className="text-right">{t('Customer orders')}</TableHead>
                <TableHead className="text-right">{t('For other orders')}</TableHead><TableHead className="text-right">{t('Being made')}</TableHead><TableHead className="text-right">{t('Min / max')}</TableHead>
                <TableHead className="text-right">{t('Expected|qty')}</TableHead><TableHead className="text-right">{t('Make')}</TableHead><TableHead className="w-[1%]" /></TableRow></TableHeader>
              <TableBody>{plan.data.map((p) => (
                <TableRow key={p.variant_id} className="hover:bg-transparent">
                  <TableCell><span className="font-medium">{p.name}</span> <span className="text-xs text-muted-foreground">{p.sku}</span>
                    <div className="text-xs text-muted-foreground"><Link to={`/manufacturing/boms/${p.bom_id}`} className="hover:underline">{p.bom_code}</Link> · {t('{cost} each without VAT · {min} min per batch of {qty}', { cost: formatMoney(p.unit_cost), min: formatQty(p.lead_minutes), qty: formatQty(p.bom_quantity) })}</div></TableCell>
                  <TableCell className="text-right tabular">{formatQty(num(p.on_hand) - num(p.reserved))}</TableCell>
                  <TableCell className="text-right tabular">{num(p.sales_demand) ? formatQty(p.sales_demand) : '—'}</TableCell>
                  <TableCell className="text-right tabular">{num(p.component_demand) ? formatQty(p.component_demand) : '—'}</TableCell>
                  <TableCell className="text-right tabular">{num(p.in_production) ? formatQty(p.in_production) : '—'}</TableCell>
                  <TableCell className="text-right tabular text-muted-foreground">{num(p.min_qty) || num(p.max_qty) ? `${formatQty(p.min_qty)} / ${formatQty(p.max_qty)}` : '—'}</TableCell>
                  <TableCell className={cn('text-right tabular', num(p.projected) < num(p.min_qty) && 'text-destructive')}>{formatQty(p.projected)}</TableCell>
                  <TableCell className="text-right tabular font-semibold">{num(p.suggested) ? formatQty(p.suggested) : '—'}</TableCell>
                  <TableCell><Can perm="manufacturing.write">{num(p.suggested) > 0
                    ? <Button size="sm" onClick={() => setMake({ variant: p.variant_id, qty: num(p.suggested) })}>{t('Plan {qty}', { qty: formatQty(p.suggested) })}</Button>
                    : <Button size="sm" variant="ghost" onClick={() => setMake({ variant: p.variant_id, qty: num(p.bom_quantity) })}>{t('Make')}</Button>}</Can></TableCell>
                </TableRow>
              ))}</TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <div className="mt-4 grid gap-4 grid-cols-[minmax(0,1fr)] xl:grid-cols-[minmax(0,1fr)_380px]">
        <LoadCard />
        <Card>
          <CardHeader className="pb-2"><CardTitle>{t('Produced')}</CardTitle><CardDescription>{t('Value of finished goods at cost, without VAT, by day, {period}', { period: t(RANGES[range].label).toLowerCase() })}</CardDescription></CardHeader>
          <CardContent>
            {ov.isLoading ? <Skeleton className="h-48" /> : ov.isError ? <ErrorState compact error={ov.error} onRetry={() => void ov.refetch()} /> : !days.length ? <p className="py-12 text-center text-[13px] text-muted-foreground">{t('Nothing produced in this period.')}</p> : (
              <div className="h-48"><ResponsiveContainer><BarChart data={days} margin={{ left: -8, right: 4 }}>
                <CartesianGrid vertical={false} stroke="hsl(var(--border))" />
                <XAxis dataKey="day" tick={axisTick} tickLine={false} axisLine={false} />
                <YAxis tick={axisTick} tickLine={false} axisLine={false} tickFormatter={(v: number) => formatCompact(v)} width={48} />
                <Tooltip contentStyle={tooltipStyle} cursor={{ fill: 'hsl(var(--muted))' }} formatter={(v: number) => [formatMoney(v), t('Produced (without VAT)')]} />
                <Bar dataKey="value" fill="hsl(var(--primary))" radius={[3, 3, 0, 0]} isAnimationActive={false} />
              </BarChart></ResponsiveContainer></div>
            )}
            <div className="mt-3 grid gap-1.5 text-[13px]">{(d?.top ?? []).map((x) => (
              <div key={x.sku} className="flex justify-between gap-2"><span className="truncate">{x.name}</span><span className="shrink-0 tabular text-muted-foreground">{formatQty(x.quantity)} · {formatMoney(x.value)}</span></div>
            ))}</div>
          </CardContent>
        </Card>
      </div>
      {make && <NewWorkOrderDialog onClose={() => setMake(null)} initialVariant={make.variant} initialQty={String(make.qty)} />}
      {newOpen && <NewWorkOrderDialog onClose={() => setNewOpen(false)} />}
    </>
  )
}

function LoadCard() {
  const from = todayISO()
  const to = iso(new Date(Date.now() + 13 * 864e5))
  const load = useWorkCenterLoad(from, to)
  const centers = [...new Map((load.data ?? []).map((r) => [r.work_center_id, r])).values()]
  const days = [...new Set((load.data ?? []).map((r) => r.day))].sort()
  const cell = (wc: string, day: string) => (load.data ?? []).find((r) => r.work_center_id === wc && r.day === day) as LoadRow | undefined
  return (
    <Card>
      <CardHeader className="pb-2"><CardTitle>{t('Work center load')}</CardTitle><CardDescription>{t('Planned work against each work center\'s daily hours for the next two weeks. Sundays are days off.')}</CardDescription></CardHeader>
      <CardContent className="overflow-x-auto">
        {load.isLoading ? <Skeleton className="h-32" /> : load.isError ? <ErrorState compact error={load.error} onRetry={() => void load.refetch()} /> : !centers.length ? <p className="py-8 text-center text-[13px] text-muted-foreground">{t('No work centers yet.')} <Link className="text-primary hover:underline" to="/manufacturing/work-centers">{t('Add one')}</Link></p> : (
          <table className="w-full min-w-[640px] table-fixed border-separate border-spacing-1 text-[11px]">
            <thead><tr><th className="w-28" />{days.map((d) => { const dt = new Date(`${d}T00:00:00`); return <th key={d} className="font-normal text-muted-foreground">{formatDateWith(dt, { weekday: 'narrow' })}<br />{dt.getDate()}</th> })}</tr></thead>
            <tbody>{centers.map((c) => (
              <tr key={c.work_center_id}>
                <td className="pr-2 text-[13px] font-medium">{c.code}<div className="text-[11px] font-normal text-muted-foreground">{td(c.name)}</div></td>
                {days.map((d) => {
                  const x = cell(c.work_center_id, d)
                  const pct = x && num(x.capacity_minutes) ? (num(x.planned_minutes) / num(x.capacity_minutes)) * 100 : x && num(x.planned_minutes) ? 999 : 0
                  return (
                    <td key={d} title={x ? `${t('{a} of {b} min', { a: formatQty(x.planned_minutes), b: formatQty(x.capacity_minutes) })} · ${tn(x.work_orders, '{n} work order', '{n} work orders')}` : ''}
                      className={cn('h-9 rounded text-center tabular', !x || !num(x.capacity_minutes) ? 'bg-muted/40 text-muted-foreground/50' : '',
                        pct > 100 ? 'bg-destructive/80 text-destructive-foreground' : pct > 75 ? 'bg-warning/70' : pct > 0 ? 'bg-primary/25' : x && num(x.capacity_minutes) ? 'bg-muted' : '')}>
                      {pct > 0 ? (pct > 998 ? '!' : `${Math.round(pct)}%`) : ''}
                    </td>
                  )
                })}
              </tr>
            ))}</tbody>
          </table>
        )}
      </CardContent>
    </Card>
  )
}

/* ================================================================== work centers */
const wcSchema = z.object({
  code: z.string().trim().min(1, 'Enter a code').max(12),
  name: z.string().trim().min(1, 'Enter a name'),
  warehouse_id: z.string().nullable(),
  cost_per_hour: z.coerce.number().min(0),
  overhead_per_hour: z.coerce.number().min(0),
  capacity_hours_per_day: z.coerce.number().positive('More than zero'),
  efficiency_pct: z.coerce.number().positive('More than zero'),
  is_active: z.boolean(),
})
type WcValues = z.infer<typeof wcSchema>

export function WorkCentersPage() {
  const centers = useWorkCenters()
  const warehouses = useWarehouses()
  const save = useSaveWorkCenter()
  const [edit, setEdit] = React.useState<WorkCenter | 'new' | null>(null)
  const cur = edit === 'new' ? null : edit
  return (
    <>
      <PageHeader title={t('Work centers')} description={t('Machines, lines and teams where the work is done. Their hourly rates turn the time worked into labour and overhead cost.')}
        actions={<Can perm="manufacturing.write"><Button onClick={() => setEdit('new')}><Plus /> {t('New work center')}</Button></Can>} />
      <Card><CardContent className="overflow-x-auto p-0">
        {centers.isLoading ? <Skeleton className="m-4 h-32" /> : centers.isError ? <ErrorState compact error={centers.error} onRetry={() => void centers.refetch()} /> : !centers.data?.length ? <EmptyState icon={Factory} title={t('No work centers yet')} description={t('Add the roaster, the packing line, the assembly bench…')}
            action={<Can perm="manufacturing.write"><Button variant="outline" onClick={() => setEdit('new')}><Plus /> {t('New work center')}</Button></Can>} /> : (
          <Table>
            <TableHeader><TableRow className="hover:bg-transparent"><TableHead>{t('Work center')}</TableHead><TableHead className="text-right">{t('Labour / h')}</TableHead><TableHead className="text-right">{t('Overhead / h')}</TableHead>
              <TableHead className="text-right">{t('Hours / day')}</TableHead><TableHead className="text-right">{t('Efficiency')}</TableHead><TableHead /><TableHead className="w-[1%]" /></TableRow></TableHeader>
            <TableBody>{centers.data.map((c) => (
              <TableRow key={c.id} className="hover:bg-transparent">
                <TableCell><span className="font-mono text-xs text-muted-foreground">{c.code}</span> <span className="font-medium">{td(c.name)}</span></TableCell>
                <TableCell className="text-right tabular">{formatMoney(c.cost_per_hour)}</TableCell><TableCell className="text-right tabular">{formatMoney(c.overhead_per_hour)}</TableCell>
                <TableCell className="text-right tabular">{t('{n} h', { n: formatQty(c.capacity_hours_per_day) })}</TableCell><TableCell className="text-right tabular">{formatQty(c.efficiency_pct)}%</TableCell>
                <TableCell>{!c.is_active && <Badge variant="secondary">{t('Inactive')}</Badge>}</TableCell>
                <TableCell><Can perm="manufacturing.write"><Button size="sm" variant="ghost" onClick={() => setEdit(c)}>{t('Edit')}</Button></Can></TableCell>
              </TableRow>
            ))}</TableBody>
          </Table>
        )}
      </CardContent></Card>
      <div className="mt-4"><LoadCard /></div>
      <SimpleFormDialog<WcValues> open={!!edit} onOpenChange={(o) => !o && setEdit(null)} title={cur ? t('Edit {name}', { name: td(cur.name) }) : t('New work center')} schema={wcSchema}
        defaultValues={cur ? { code: cur.code, name: cur.name, warehouse_id: cur.warehouse_id, cost_per_hour: num(cur.cost_per_hour), overhead_per_hour: num(cur.overhead_per_hour),
                               capacity_hours_per_day: num(cur.capacity_hours_per_day), efficiency_pct: num(cur.efficiency_pct), is_active: cur.is_active }
                           : { code: '', name: '', warehouse_id: null, cost_per_hour: 0, overhead_per_hour: 0, capacity_hours_per_day: 8, efficiency_pct: 100, is_active: true }}
        fields={[
          { name: 'code', label: t('Code'), half: true, uppercase: true, placeholder: 'ROAST' },
          { name: 'name', label: t('Name'), half: true, placeholder: t('Roaster') },
          { name: 'warehouse_id', label: t('Warehouse'), type: 'select', optional: true, options: (warehouses.data ?? []).map((w) => ({ value: w.id, label: `${w.code} · ${td(w.name)}` })) },
          { name: 'cost_per_hour', label: t('Labour per hour'), type: 'number', half: true },
          { name: 'overhead_per_hour', label: t('Overhead per hour'), type: 'number', half: true, description: t('Energy, depreciation, share of rent') },
          { name: 'capacity_hours_per_day', label: t('Hours per day'), type: 'number', half: true },
          { name: 'efficiency_pct', label: t('Efficiency %'), type: 'number', half: true, description: t('At 80% every step takes 25% longer') },
          { name: 'is_active', label: t('Active'), type: 'switch' },
        ]}
        submitLabel={t('Save')} onSubmit={async (v) => { await save.mutateAsync({ id: cur?.id, ...v }); toast.success(t('Work center saved')) }} />
    </>
  )
}
