import type { ColumnDef } from '@tanstack/react-table'
import { ChefHat, CloudOff, MonitorSmartphone, Plus, Printer, RefreshCw, Store, UtensilsCrossed } from 'lucide-react'
import * as React from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { toast } from 'sonner'
import { Can, useCompany } from '@/app/company-provider'
import { ColumnHeader, DataTable, inFilter } from '@/components/data-table/data-table'
import { EmptyState } from '@/components/empty-state'
import { PageHeader } from '@/components/page-header'
import { SearchSelect } from '@/components/search-select'
import { StatCard } from '@/components/stat-card'
import { StatusBadge } from '@/components/status-badge'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { describeError, unwrap } from '@/lib/errors'
import { supabase } from '@/lib/supabase'
import { ErrorState } from '@/components/error-state'
import { useRealtimeInvalidate } from '@/hooks/use-realtime'
import { t, td, tEnum, tn } from '@/i18n'
import { cn, formatDate, formatMoney, humanize, num } from '@/lib/utils'
import { useBankAccounts, useJournals } from '@/features/finance/api'
import { AccountingTab } from '@/features/finance/components/t-accounts'
import { useLocations, useWarehouses } from '@/features/inventory/api'
import { usePartners, usePriceLists } from '@/features/sales/api'
import { posKeys, useRegisters, useSaveRegister, useSessionControls, useSessionDetail, useSessions, type Register, type SessionRow } from '../api'
import { discard, retry, syncNow, useSyncState } from '../offline'
import { printReceipt, printZReport } from '../receipt'

const since = (iso: string) => {
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000)
  return m < 60 ? t('{m} min', { m }) : m < 1440 ? t('{h} h {m} min', { h: Math.floor(m / 60), m: m % 60 }) : tn(Math.floor(m / 1440), '{n} day', '{n} days')
}

export function PosHomePage() {
  const navigate = useNavigate()
  const { company, companyId } = useCompany()
  const registers = useRegisters()
  const sessions = useSessions()
  useRealtimeInvalidate('pos_sessions', companyId, [posKeys.all(companyId)])
  useRealtimeInvalidate('pos_orders', companyId, [posKeys.all(companyId)])
  const sync = useSyncState()
  const [edit, setEdit] = React.useState<Register | 'new' | null>(null)
  const today = new Date().toISOString().slice(0, 10)
  const todays = (sessions.data ?? []).filter((s) => s.opened_at.slice(0, 10) === today || s.status !== 'closed')
  const zToday = (sessions.data ?? []).flatMap((s) => (s.closed_at?.slice(0, 10) === today ? s.z : []))
  const closedSales = zToday.reduce((t, z) => t + num(z.gross_sales) - num(z.refunds_total), 0)

  const cols = React.useMemo<ColumnDef<SessionRow>[]>(() => [
    { accessorKey: 'number', enableHiding: false, header: ({ column }) => <ColumnHeader column={column} title={t('Shift')} />, meta: { label: t('Shift') }, cell: ({ getValue }) => <span className="font-medium">{getValue() as string}</span> },
    { id: 'register', accessorFn: (r) => r.register?.name ?? '', filterFn: inFilter, header: t('Till'), meta: { label: t('Till') } },
    { id: 'opener', accessorFn: (r) => r.opener?.full_name ?? '', header: t('Opened by'), meta: { label: t('Opened by') } },
    { accessorKey: 'opened_at', header: ({ column }) => <ColumnHeader column={column} title={t('Opened')} />, meta: { label: t('Opened') }, cell: ({ getValue }) => formatDate(getValue() as string, true) },
    { accessorKey: 'closed_at', header: t('Closed|time'), meta: { label: t('Closed|time') }, cell: ({ getValue }) => (getValue() ? formatDate(getValue() as string, true) : '—') },
    { accessorKey: 'status', filterFn: inFilter, header: t('Status'), meta: { label: t('Status') }, cell: ({ getValue }) => <StatusBadge status={getValue() as string} /> },
    { id: 'receipts', accessorFn: (r) => r.z[0]?.order_count ?? null, header: t('Receipts'), meta: { label: t('Receipts'), align: 'right' }, cell: ({ getValue }) => getValue() ?? '—' },
    { id: 'sales', accessorFn: (r) => (r.z[0] ? num(r.z[0].gross_sales) - num(r.z[0].refunds_total) : null), header: t('Sales (with VAT)'), meta: { label: t('Sales (with VAT)'), align: 'right' },
      cell: ({ getValue }) => (getValue() == null ? '—' : <span className="tabular">{formatMoney(getValue() as number)}</span>) },
    { id: 'diff', accessorFn: (r) => r.z[0]?.cash_difference ?? null, header: t('Cash difference'), meta: { label: t('Cash difference'), align: 'right' },
      cell: ({ getValue }) => { const v = getValue() as number | null; return v == null ? '—' : <span className={cn('tabular', v < 0 && 'text-destructive', v > 0 && 'text-warning')}>{formatMoney(v)}</span> } },
  ], [])

  return (
    <>
      <PageHeader title={t('Point of sale')} description={t('Tills, open shifts and closed shifts with their Z-reports. Sales leave stock at once and reach accounting when the shift is closed.')}
        actions={<Can perm="pos.approve"><Button variant="outline" onClick={() => setEdit('new')}><Plus /> {t('Add till')}</Button></Can>} />

      {(sync.items.length > 0 || !sync.online) && <SyncPanel />}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {registers.isLoading && <Skeleton className="h-40" />}
        {registers.isError && <Card className="sm:col-span-2 xl:col-span-3"><ErrorState compact error={registers.error} onRetry={() => void registers.refetch()} /></Card>}
        {(registers.data ?? []).map((r) => {
          const s = r.sessions[0]
          return (
            <Card key={r.id} className={cn(!r.is_active && 'opacity-60')}>
              <CardContent className="grid gap-3 p-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2.5">
                    <div className="grid size-9 place-items-center rounded-md bg-primary/10 text-primary">{r.mode === 'restaurant' ? <UtensilsCrossed className="size-4" /> : <Store className="size-4" />}</div>
                    <div><div className="font-medium">{r.name}</div><div className="text-xs text-muted-foreground">{r.code} · {td(r.warehouse?.name)} · {r.mode === 'restaurant' ? t('tables') : r.location?.code}</div></div>
                  </div>
                  {s ? <Badge variant="success">{t('Open|status')}</Badge> : <Badge variant="secondary">{tEnum('closed')}</Badge>}
                </div>
                {/* a shift left open since an earlier day: the day's Z report was never made */}
                {s && s.opened_at.slice(0, 10) < today && (
                  <div className="rounded-md border border-destructive/40 bg-destructive/5 px-2.5 py-1.5 text-[13px] text-destructive">
                    {t('This shift was not closed since {date}. Close it and make the Z report, so each day\u2019s sales and cash are counted apart.', { date: formatDate(s.opened_at) })}
                  </div>
                )}
                <div className="text-[13px] text-muted-foreground">
                  {s ? t('Shift {number} · open for {time} · opening cash {amount} {currency}', { number: s.number, time: since(s.opened_at), amount: formatMoney(s.opening_cash), currency: company?.base_currency ?? '' }) : t('No open shift. Opening the till asks how much cash is in the drawer.')}
                </div>
                <div className="flex flex-wrap gap-2">
                  {r.mode === 'restaurant' ? <>
                    <Can perm="pos.write"><Button disabled={!r.is_active} onClick={() => navigate(`/pos/floor/${r.id}`)}><UtensilsCrossed /> {s ? t('Go to the tables') : t('Open the tables')}</Button></Can>
                    <Button variant="outline" asChild><Link to={`/pos/kitchen/${r.warehouse_id}`}><ChefHat /> {t('Kitchen screen')}</Link></Button>
                  </> : <Can perm="pos.write"><Button disabled={!r.is_active} onClick={() => navigate(`/pos/till/${r.id}`)}><MonitorSmartphone /> {s ? t('Go to till') : t('Open till')}</Button></Can>}
                  {s && <Button variant="outline" asChild><Link to={`/pos/sessions/${s.id}`}>{t('Shift')}</Link></Button>}
                  <Can perm="pos.approve"><Button variant="ghost" onClick={() => setEdit(r)}>{t('Settings')}</Button></Can>
                </div>
              </CardContent>
            </Card>
          )
        })}
        {!registers.isLoading && !registers.isError && !registers.data?.length && (
          <Card className="sm:col-span-2 xl:col-span-3"><CardContent className="p-0">
            <EmptyState icon={Store} title={t('No tills yet')} description={t('Add one for each cash register: it sells from one stock location and keeps its cash in one drawer.')}
              action={<Can perm="pos.approve"><Button onClick={() => setEdit('new')}><Plus /> {t('Add till')}</Button></Can>} />
          </CardContent></Card>
        )}
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        <StatCard label={t('Tills open now')} value={(registers.data ?? []).filter((r) => r.sessions.length).length} loading={registers.isLoading} />
        <StatCard label={t('Shifts today')} value={todays.length} loading={sessions.isLoading} />
        <StatCard label={t('Closed sales today, with VAT')} value={formatMoney(closedSales)} loading={sessions.isLoading} hint={tn(zToday.length, '{n} Z-report', '{n} Z-reports')} />
      </div>

      <h2 className="mb-2 mt-6 text-sm font-semibold">{t('Shifts')}</h2>
      <DataTable tableKey="pos.sessions" columns={cols} data={sessions.data} isLoading={sessions.isLoading} error={sessions.error} getRowId={(r) => r.id}
        exportName="pos-sessions" searchPlaceholder={t('Shift, till, cashier…')} onRowClick={(r) => navigate(`/pos/sessions/${r.id}`)}
        facets={[
          { columnId: 'status', title: t('Status'), options: ['open', 'closing', 'closed'].map((s) => ({ value: s, label: humanize(s) })) },
          { columnId: 'register', title: t('Till'), options: (registers.data ?? []).map((r) => ({ value: r.name, label: r.name })) },
        ]}
        empty={{ title: t('No shifts yet'), description: t('Open a till to start selling.') }} />
      {edit && <RegisterDialog register={edit === 'new' ? null : edit} onClose={() => setEdit(null)} />}
    </>
  )
}

/** Sales recorded on this device that the server has not accepted yet */
export function SyncPanel({ compact }: { compact?: boolean }) {
  const sync = useSyncState()
  const failed = sync.items.filter((i) => i.status === 'failed')
  return (
    <Card className={cn('mb-4 border-warning/50', compact && 'mb-0')}>
      <CardHeader className="flex-row flex-wrap items-center justify-between gap-2 space-y-0 py-3">
        <CardTitle className="flex items-center gap-2">
          {!sync.online && <CloudOff className="size-4 text-warning" />}
          {sync.online ? tn(sync.items.length, '{n} sale on this device is waiting to be sent', '{n} sales on this device are waiting to be sent') : t('This device is offline')}
        </CardTitle>
        <Button size="sm" variant="outline" loading={sync.syncing} onClick={() => void syncNow()}><RefreshCw /> {t('Send now')}</Button>
      </CardHeader>
      {sync.items.length > 0 && (
        <CardContent className="p-0">
          <Table>
            <TableBody>
              {sync.items.map((i) => (
                <TableRow key={i.client_uuid} className="hover:bg-transparent">
                  <TableCell className="font-medium">{i.device_ref}</TableCell>
                  <TableCell className="text-[13px] text-muted-foreground">{formatDate(i.created_at, true)}</TableCell>
                  <TableCell className="text-right tabular" title={t('Total (with VAT)')}>{formatMoney(i.total)}</TableCell>
                  <TableCell className="text-[13px]">{i.status === 'failed' ? <span className="text-destructive">{i.error}</span> : <span className="text-muted-foreground">{t('Waiting')}</span>}</TableCell>
                  <TableCell className="w-[1%] whitespace-nowrap text-right">
                    {i.status === 'failed' && <>
                      <Button size="sm" variant="ghost" onClick={() => void retry(i.client_uuid)}>{t('Try again')}</Button>
                      <Button size="sm" variant="ghost" className="text-destructive" onClick={() => { if (confirm(t('Discard {ref}? The sale will not reach the books.', { ref: i.device_ref }))) void discard(i.client_uuid) }}>{t('Discard')}</Button>
                    </>}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {failed.length > 0 && <p className="px-4 py-2 text-xs text-muted-foreground">{t('A sale that failed stays on this device until you try again or discard it. Fix the cause first (for example open the till again), then try again.')}</p>}
        </CardContent>
      )}
    </Card>
  )
}

function RegisterDialog({ register, onClose }: { register: Register | null; onClose: () => void }) {
  const { company, hasFeature } = useCompany()
  const warehouses = useWarehouses()
  const locations = useLocations()
  const banks = useBankAccounts()
  const journals = useJournals()
  const priceLists = usePriceLists()
  const partners = usePartners()
  const save = useSaveRegister()
  const restaurantOk = hasFeature('restaurant')
  const [v, setV] = React.useState(() => ({
    code: register?.code ?? '', name: register?.name ?? '', warehouse_id: register?.warehouse_id ?? null as string | null, location_id: register?.location_id ?? null as string | null,
    cash_account_id: register?.cash_account_id ?? null as string | null, journal_id: register?.journal_id ?? null as string | null, price_list_id: register?.price_list_id ?? null as string | null,
    default_customer_id: register?.default_customer_id ?? null as string | null, receipt_header: register?.receipt_header ?? '', receipt_footer: register?.receipt_footer ?? 'Faleminderit! Thank you!',
    is_active: register?.is_active ?? true, mode: (register?.mode ?? (restaurantOk && (company?.business_type === 'cafe' || company?.business_type === 'restaurant') ? 'restaurant' : 'retail')) as string,
  }))
  const set = <K extends keyof typeof v>(k: K) => (x: (typeof v)[K]) => setV((s) => ({ ...s, [k]: x }))
  React.useEffect(() => {
    if (!v.journal_id && journals.data) set('journal_id')(journals.data.find((j) => j.code === 'POS')?.id ?? null)
    if (!v.cash_account_id && banks.data) set('cash_account_id')(banks.data.find((b) => b.account_kind === 'cash' && /drawer|pos|till/i.test(b.name))?.id ?? banks.data.find((b) => b.account_kind === 'cash')?.id ?? null)
  }, [journals.data, banks.data]) // eslint-disable-line react-hooks/exhaustive-deps
  const locs = (locations.data ?? []).filter((l) => l.warehouse_id === v.warehouse_id && l.location_type !== 'view' && l.is_active)
  const valid = v.code.trim() && v.name.trim() && v.warehouse_id && v.location_id && v.cash_account_id
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-xl">
        <DialogHeader><DialogTitle>{register ? t('Settings · {name}', { name: register.name }) : t('Add a till')}</DialogTitle>
          <DialogDescription>{t('The till sells from one stock location and counts its cash in one drawer. Card payments go to the card clearing account.')}</DialogDescription></DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          <div className="grid gap-1.5"><Label htmlFor="rg-code">{t('Code')}</Label><Input id="rg-code" value={v.code} maxLength={8} onChange={(e) => set('code')(e.target.value.toUpperCase().replace(/\s/g, ''))} placeholder="T1" /></div>
          <div className="grid gap-1.5"><Label htmlFor="rg-name">{t('Name')}</Label><Input id="rg-name" value={v.name} onChange={(e) => set('name')(e.target.value)} placeholder={t('Blloku till 1')} /></div>
          <div className="grid gap-1.5"><Label>{t('Warehouse')}</Label>
            <Select value={v.warehouse_id ?? ''} onValueChange={(x) => setV((s) => ({ ...s, warehouse_id: x, location_id: null }))}><SelectTrigger><SelectValue placeholder={t('Choose')} /></SelectTrigger>
              <SelectContent>{(warehouses.data ?? []).map((w) => <SelectItem key={w.id} value={w.id}>{w.code} · {td(w.name)}</SelectItem>)}</SelectContent></Select></div>
          <div className="grid gap-1.5"><Label>{t('Sells from')}</Label>
            <SearchSelect value={v.location_id} onChange={set('location_id')} disabled={!v.warehouse_id} placeholder={t('Location')} options={locs.map((l) => ({ value: l.id, label: l.code, hint: td(l.name) }))} /></div>
          <div className="grid gap-1.5"><Label>{t('Cash drawer')}</Label>
            <Select value={v.cash_account_id ?? ''} onValueChange={set('cash_account_id')}><SelectTrigger><SelectValue placeholder={t('Choose')} /></SelectTrigger>
              <SelectContent>{(banks.data ?? []).filter((b) => b.account_kind === 'cash').map((b) => <SelectItem key={b.id} value={b.id}>{td(b.name)} · {b.account?.code}</SelectItem>)}</SelectContent></Select></div>
          <div className="grid gap-1.5"><Label>{t('Journal')}</Label>
            <Select value={v.journal_id ?? ''} onValueChange={set('journal_id')}><SelectTrigger><SelectValue placeholder="POS" /></SelectTrigger>
              <SelectContent>{(journals.data ?? []).map((j) => <SelectItem key={j.id} value={j.id}>{j.code} · {td(j.name)}</SelectItem>)}</SelectContent></Select></div>
          <div className="grid gap-1.5"><Label>{t('Price list')}</Label>
            <Select value={v.price_list_id ?? '__none'} onValueChange={(x) => set('price_list_id')(x === '__none' ? null : x)}><SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="__none">{t('Product prices')}</SelectItem>{(priceLists.data ?? []).map((p) => <SelectItem key={p.id} value={p.id}>{td(p.name)}</SelectItem>)}</SelectContent></Select></div>
          <div className="grid gap-1.5"><Label>{t('Default customer')}</Label>
            <SearchSelect value={v.default_customer_id} onChange={set('default_customer_id')} clearable placeholder={t('Walk-in customer (none)')}
              options={(partners.data ?? []).filter((p) => p.is_customer).map((p) => ({ value: p.id, label: p.name, hint: p.code }))} /></div>
          {restaurantOk && <div className="col-span-2 grid gap-1.5"><Label>{t('How this till sells')}</Label>
            <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label={t('How this till sells')}>
              {[{ v: 'retail', l: t('Shop'), h: t('Scan items into one basket and take payment.') }, { v: 'restaurant', l: t('Restaurant or café'), h: t('Tables, orders to the kitchen and bar, pay at the end.') }].map((o) => (
                <button key={o.v} type="button" role="radio" aria-checked={v.mode === o.v} onClick={() => set('mode')(o.v)}
                  className={cn('rounded-lg border-2 p-3 text-left', v.mode === o.v ? 'border-primary bg-primary/5' : 'hover:bg-muted')}>
                  <div className="text-sm font-medium">{o.l}</div><div className="mt-0.5 text-xs text-muted-foreground">{o.h}</div>
                </button>))}
            </div></div>}
          <div className="col-span-2 grid gap-1.5"><Label htmlFor="rg-head">{t('Receipt header')}</Label><Input id="rg-head" value={v.receipt_header} onChange={(e) => set('receipt_header')(e.target.value)} placeholder="Rruga Pjetër Bogdani 12, Tiranë" /></div> {/* i18n-ignore */}
          <div className="col-span-2 grid gap-1.5"><Label htmlFor="rg-foot">{t('Receipt footer')}</Label><Input id="rg-foot" value={v.receipt_footer} onChange={(e) => set('receipt_footer')(e.target.value)} /></div>
          <div className="col-span-2 flex items-center justify-between"><Label htmlFor="rg-active">{t('Till in use')}</Label><Switch id="rg-active" checked={v.is_active} onCheckedChange={set('is_active')} /></div>
        </div>
        <DialogFooter><Button variant="ghost" onClick={onClose}>{t('Cancel')}</Button>
          <Button disabled={!valid} loading={save.isPending} onClick={async () => {
            await save.mutateAsync({ id: register?.id, ...v, code: v.code.trim(), name: v.name.trim(), receipt_header: v.receipt_header || null, receipt_footer: v.receipt_footer || null })
            toast.success(t('Till saved')); onClose()
          }}>{t('Save')}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/* ------------------------------------------------------------------ session / Z-report */
export function PosSessionPage() {
  const { id } = useParams()
  const { company } = useCompany()
  const q = useSessionDetail(id)
  const ctl = useSessionControls(id)
  if (q.isLoading) return <Skeleton className="mx-auto h-96 max-w-5xl" />
  if (q.isError) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />
  if (!q.data) return <EmptyState icon={Store} title={t('Shift not found')} description={t('It may have been deleted.')} action={<Button variant="outline" asChild><Link to="/pos">{t('Point of sale')}</Link></Button>} />
  const { session: s, z, orders } = q.data
  const cur = company?.base_currency ?? 'ALL'
  const pay = (z?.payments_by_method ?? {}) as Record<string, number>
  const taxes = (z?.tax_breakdown ?? []) as { rate: number; base: number; tax: number }[]
  const items = ((z?.items ?? []) as { name: string; quantity: number; total: number }[]).filter((i) => num(i.quantity) !== 0)

  const print = () => z && printZReport({
    company: company?.name ?? '', register: s.register?.name ?? '', number: z.number, session: s.number, opened: s.opened_at, closed: s.closed_at, date: z.report_date, currency: cur,
    orders: z.order_count, refunds: z.refund_count, gross: num(z.gross_sales), refundsTotal: num(z.refunds_total), discounts: num(z.discounts_total), net: num(z.net_sales), tax: num(z.tax_total),
    payments: pay, taxes: taxes.map((t) => ({ rate: num(t.rate), base: num(t.base), tax: num(t.tax) })), opening: num(z.opening_cash), cashIn: num(z.cash_in), cashOut: num(z.cash_out),
    expected: num(z.expected_cash), counted: z.counted_cash, difference: z.cash_difference, items, controls: ctl.data ?? null,
  })
  const c = ctl.data
  const voids = c?.voids
  const reprint = async (orderId: string) => {
    try {
      const o = unwrap(await supabase.from('pos_orders').select('number, device_ref, order_at, is_refund, change_given, partner:business_partners(name), lines:pos_order_lines(description, quantity, unit_price, discount_pct, line_total, tax_rate, line_no), payments:pos_payments(method, amount)')
        .eq('id', orderId).single().returns<{ number: string; device_ref: string | null; order_at: string; is_refund: boolean; change_given: number; partner: { name: string } | null
          lines: { description: string; quantity: number; unit_price: number; discount_pct: number; line_total: number; tax_rate: number; line_no: number }[]; payments: { method: string; amount: number }[] }>())
      const reg = unwrap(await supabase.from('pos_registers').select('code, name, receipt_header, receipt_footer').eq('id', s.register_id).single())
      printReceipt({
        company: { name: company?.name ?? '', legal_name: null, tax_number: null, address: null }, register: reg,
        ref: o.device_ref ?? o.number, number: o.number, date: new Date(o.order_at), cashier: '', customer: o.partner?.name, isRefund: o.is_refund, currency: cur,
        lines: [...o.lines].sort((a, b) => a.line_no - b.line_no).map((l) => ({ name: l.description, qty: num(l.quantity), price: num(l.unit_price), discount: num(l.discount_pct), total: num(l.line_total), rate: num(l.tax_rate) })),
        payments: o.payments.map((p) => ({ method: p.method, amount: num(p.amount) })), change: num(o.change_given),
      })
    } catch (e) { toast.error(describeError(e)) }
  }

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader back={{ href: '/pos', label: t('Point of sale') }} title={`${s.register?.name} · ${s.number}`} meta={<StatusBadge status={s.status} />}
        description={s.closed_at ? t('Opened {a} · closed {b}', { a: formatDate(s.opened_at, true), b: formatDate(s.closed_at, true) }) : t('Opened {a}', { a: formatDate(s.opened_at, true) })}
        actions={<>
          {s.status === 'open' && <Can perm="pos.write"><Button asChild><Link to={`/pos/till/${s.register_id}`}><MonitorSmartphone /> {t('Go to till')}</Link></Button></Can>}
          {z && <Button variant="outline" onClick={print}><Printer /> {t('Print Z-report')}</Button>}
        </>} />
      <Tabs defaultValue={z ? 'z' : 'orders'}>
        <TabsList>{z && <TabsTrigger value="z">{t('Z-report {number}', { number: z.number })}</TabsTrigger>}<TabsTrigger value="orders">{t('Receipts')} ({orders.length})</TabsTrigger>
          <TabsTrigger value="controls">{t('Till controls')}{voids?.count ? ` (${voids.count})` : ''}</TabsTrigger><TabsTrigger value="accounting">{t('Accounting')}</TabsTrigger></TabsList>
        {z && (
          <TabsContent value="z" className="grid gap-4">
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <StatCard label={t('Sales (with VAT)')} value={formatMoney(num(z.gross_sales) - num(z.refunds_total))} hint={t('{a} receipts · {b} refunds', { a: z.order_count, b: z.refund_count })} />
              <StatCard label={t('Sales (without VAT)')} value={formatMoney(z.net_sales)} hint={t('VAT {amount}', { amount: formatMoney(z.tax_total) })} />
              <StatCard label={t('Discounts given (with VAT)')} value={formatMoney(z.discounts_total)} />
              <StatCard label={t('Cash difference')} value={formatMoney(z.cash_difference)} tone={num(z.cash_difference) < 0 ? 'destructive' : num(z.cash_difference) > 0 ? 'warning' : 'default'}
                hint={t('Counted {a} of {b} expected', { a: formatMoney(z.counted_cash), b: formatMoney(z.expected_cash) })} />
            </div>
            <div className="grid gap-4 lg:grid-cols-3">
              <Card><CardHeader className="pb-2"><CardTitle>{t('Payments')}</CardTitle></CardHeader><CardContent className="grid gap-1.5 text-[13px]">
                {Object.entries(pay).filter(([k]) => k !== 'change_given').map(([k, v2]) => <Row key={k} k={humanize(k)} v={formatMoney(v2)} />)}
                <Row k={t('Change given')} v={`${num(pay.change_given) ? '−' : ''}${formatMoney(pay.change_given ?? 0)}`} />
              </CardContent></Card>
              <Card><CardHeader className="pb-2"><CardTitle>{t('Cash drawer')}</CardTitle></CardHeader><CardContent className="grid gap-1.5 text-[13px]">
                <Row k={t('Opening cash')} v={formatMoney(z.opening_cash)} /><Row k={t('Cash in')} v={formatMoney(z.cash_in)} /><Row k={t('Cash out')} v={`${num(z.cash_out) ? '−' : ''}${formatMoney(z.cash_out)}`} />
                <Row k={t('Expected')} v={formatMoney(z.expected_cash)} strong /><Row k={t('Counted')} v={formatMoney(z.counted_cash)} />
              </CardContent></Card>
              <Card><CardHeader className="pb-2"><CardTitle>{t('VAT')}</CardTitle></CardHeader><CardContent className="grid gap-1.5 text-[13px]">
                {taxes.map((x) => <Row key={x.rate} k={t('{rate}% on {base}', { rate: num(x.rate), base: formatMoney(x.base) })} v={formatMoney(x.tax)} />)}
              </CardContent></Card>
            </div>
            <Card><CardHeader className="pb-2"><CardTitle>{t('Best sellers · sales with VAT')}</CardTitle></CardHeader><CardContent className="p-0">
              <Table><TableBody>{items.map((i) => (
                <TableRow key={i.name} className="hover:bg-transparent"><TableCell>{i.name}</TableCell><TableCell className="text-right tabular">{num(i.quantity)}</TableCell><TableCell className="text-right tabular">{formatMoney(i.total)}</TableCell></TableRow>
              ))}</TableBody></Table>
            </CardContent></Card>
          </TabsContent>
        )}
        <TabsContent value="controls" className="grid gap-4">
          {ctl.isError ? <ErrorState error={ctl.error} onRetry={() => void ctl.refetch()} /> : !c ? <Skeleton className="h-40" /> : <>
            <div className="grid gap-3 sm:grid-cols-3">
              <StatCard label={t('Voids')} value={String(c.voids.count)} hint={t('{amount} taken off sales', { amount: formatMoney(c.voids.amount) })} />
              <StatCard label={t('Without a manager')} value={String(c.voids.unconfirmed)} tone={c.voids.unconfirmed ? 'warning' : 'default'}
                hint={t('Offline, or no manager with a PIN')} />
              <StatCard label={t('Age checks')} value={String(c.age.checked)} hint={c.age.refused ? t('{n} refused', { n: c.age.refused }) : undefined} />
            </div>
            {c.count && (
              <Card><CardHeader className="pb-2"><CardTitle>{t('Cash count')}</CardTitle></CardHeader><CardContent className="grid gap-1.5 text-[13px]">
                {Object.entries(c.count.notes_coins ?? {}).sort((a, b) => Number(b[0]) - Number(a[0])).map(([d, n]) => <Row key={d} k={`${n} × ${d}`} v={formatMoney(Number(d) * n)} />)}
                <Row k={t('Counted')} v={formatMoney(c.count.counted)} strong />
                <Row k={t('Counted by')} v={c.count.counted_by ?? '—'} />
                <Row k={t('Confirmed by')} v={c.count.witnessed_by ?? t('Nobody')} />
              </CardContent></Card>
            )}
            <Card><CardHeader className="pb-2"><CardTitle>{t('Voids')}</CardTitle></CardHeader><CardContent className="overflow-x-auto p-0">
              {!c.voids.lines.length ? <EmptyState compact title={t('No voids in this shift')} description={t('Items taken off a sale, quantities lowered and cleared sales show up here.')} /> : (
                <Table>
                  <TableHeader><TableRow className="hover:bg-transparent"><TableHead>{t('Time')}</TableHead><TableHead>{t('What')}</TableHead><TableHead>{t('Item')}</TableHead><TableHead className="text-right">{t('Quantity')}</TableHead>
                    <TableHead className="text-right">{t('Amount (with VAT)')}</TableHead><TableHead>{t('Cashier')}</TableHead><TableHead>{t('Confirmed by')}</TableHead></TableRow></TableHeader>
                  <TableBody>{c.voids.lines.map((l, i) => (
                    <TableRow key={i}>
                      <TableCell className="whitespace-nowrap tabular">{formatDate(l.at, true)}</TableCell>
                      <TableCell>{l.kind === 'void_sale' ? t('Sale cleared') : l.kind === 'void_qty' ? t('Quantity lowered') : t('Item taken off')}</TableCell>
                      <TableCell>{l.description ?? '—'}</TableCell>
                      <TableCell className="text-right tabular">{l.quantity == null ? '—' : num(l.quantity)}</TableCell>
                      <TableCell className="text-right tabular">{formatMoney(l.amount)}</TableCell>
                      <TableCell>{l.cashier ?? '—'}</TableCell>
                      <TableCell>{l.approved_by ?? <span className="text-warning">{l.offline ? t('Nobody (offline)') : t('Nobody')}</span>}</TableCell>
                    </TableRow>
                  ))}</TableBody>
                </Table>
              )}
            </CardContent></Card>
          </>}
        </TabsContent>
        <TabsContent value="orders">
          <Card><CardContent className="overflow-x-auto p-0">
            <Table>
              <TableHeader><TableRow className="hover:bg-transparent"><TableHead>{t('Receipt|pos')}</TableHead><TableHead>{t('Time')}</TableHead><TableHead>{t('Customer')}</TableHead><TableHead>{t('Paid with')}</TableHead><TableHead className="text-right">{t('Total (with VAT)')}</TableHead><TableHead className="w-[1%]" /></TableRow></TableHeader>
              <TableBody>
                {orders.map((o) => (
                  <TableRow key={o.id} className="hover:bg-transparent">
                    <TableCell><span className="font-medium">{o.number}</span> {o.is_refund && <Badge variant="destructive" className="ml-1">{t('Refund')}</Badge>} {o.offline_created && <Badge variant="secondary" className="ml-1">{t('Offline')}</Badge>}
                      {o.device_ref && <div className="text-xs text-muted-foreground">{t('Till ref {ref}', { ref: o.device_ref })}</div>}</TableCell>
                    <TableCell className="text-[13px]">{formatDate(o.order_at, true)}</TableCell>
                    <TableCell className="text-[13px]">{o.partner?.name ?? t('Walk-in customer')}</TableCell>
                    <TableCell className="text-[13px] text-muted-foreground">{o.payments.map((p) => humanize(p.method)).join(', ')}</TableCell>
                    <TableCell className={cn('text-right tabular', o.is_refund && 'text-destructive')}>{formatMoney(o.total)}</TableCell>
                    <TableCell><Button size="sm" variant="ghost" onClick={() => void reprint(o.id)}><Printer /> {t('Reprint')}</Button></TableCell>
                  </TableRow>
                ))}
                {!orders.length && <TableRow><TableCell colSpan={6} className="py-8 text-center text-[13px] text-muted-foreground">{t('No receipts in this shift.')}</TableCell></TableRow>}
              </TableBody>
            </Table>
          </CardContent></Card>
        </TabsContent>
        <TabsContent value="accounting">
          <AccountingTab sourceType="pos_session" sourceId={s.id} emptyHint={t('Sales reach accounting when the shift is closed: one sales entry and one cash entry per shift. Stock and cost of goods sold are booked at each sale.')} />
        </TabsContent>
      </Tabs>
    </div>
  )
}
const Row = ({ k, v, strong }: { k: string; v: string; strong?: boolean }) => (
  <div className={cn('flex justify-between gap-3', strong && 'font-semibold')}><span className="text-muted-foreground">{k}</span><span className="tabular">{v}</span></div>
)
