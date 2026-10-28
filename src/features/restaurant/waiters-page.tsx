import * as React from 'react'
import { useQuery } from '@tanstack/react-query'
import { useCompany } from '@/app/company-provider'
import { EmptyState } from '@/components/empty-state'
import { ErrorState } from '@/components/error-state'
import { PageHeader } from '@/components/page-header'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { msg, t, td } from '@/i18n'
import { unwrap } from '@/lib/errors'
import { supabase } from '@/lib/supabase'
import { formatMoney, formatQty as formatInt, num, todayISO } from '@/lib/utils'
import { useWarehouses } from '@/features/inventory/api'

interface WaiterRow { waiter_id: string; waiter: string; bills: number; tables: number; guests: number; total: number; discount: number; per_guest: number | null; avg_minutes: number | null; voided: number; voided_value: number }

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const RANGES: { key: string; label: string; range: () => [string, string] }[] = [
  { key: 'today', label: msg('Today'), range: () => [todayISO(), todayISO()] },
  { key: 'yesterday', label: msg('Yesterday'), range: () => { const d = new Date(); d.setDate(d.getDate() - 1); return [iso(d), iso(d)] } },
  { key: 'week', label: msg('This week'), range: () => { const d = new Date(); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return [iso(d), todayISO()] } },
  { key: 'month', label: msg('This month'), range: () => { const d = new Date(); return [iso(new Date(d.getFullYear(), d.getMonth(), 1)), todayISO()] } },
]

/** Who served what: bills, tables, guests, takings, discounts and cancelled items per waiter. */
export function WaitersPage() {
  const { companyId } = useCompany()
  const stores = useWarehouses()
  const [[from, to], setRange] = React.useState<[string, string]>(() => RANGES[0].range())
  const [store, setStore] = React.useState('__all')
  const q = useQuery({
    queryKey: ['restaurant', companyId, 'waiters', from, to, store],
    enabled: !!companyId && !!from && !!to,
    queryFn: async () => unwrap(await supabase.rpc('restaurant_waiter_report', { p_company: companyId, p_from: from, p_to: to, p_warehouse: store === '__all' ? undefined : store })) as unknown as WaiterRow[],
  })
  const rows = q.data ?? []
  const sum = (k: keyof WaiterRow) => rows.reduce((s, r) => s + num(r[k] as number), 0)
  const guests = sum('guests')

  return (
    <>
      <PageHeader title={t('Waiters')} description={t('Bills, tables, guests and takings per waiter, with the discounts they gave and the items cancelled after they reached the kitchen.')} />
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <div className="flex gap-1" role="group" aria-label={t('Period')}>
          {RANGES.map((r) => {
            const [a, b] = r.range()
            return <Button key={r.key} size="sm" variant={a === from && b === to ? 'default' : 'outline'} onClick={() => setRange([a, b])}>{t(r.label)}</Button>
          })}
        </div>
        <div className="grid gap-1.5"><Label htmlFor="w-from">{t('From')}</Label><Input id="w-from" type="date" value={from} onChange={(e) => setRange([e.target.value, to])} className="w-40" /></div>
        <div className="grid gap-1.5"><Label htmlFor="w-to">{t('To')}</Label><Input id="w-to" type="date" value={to} onChange={(e) => setRange([from, e.target.value])} className="w-40" /></div>
        <div className="grid gap-1.5"><Label>{t('Store')}</Label>
          <Select value={store} onValueChange={setStore}>
            <SelectTrigger className="w-56"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="__all">{t('All stores')}</SelectItem>
              {(stores.data ?? []).filter((w) => w.is_active && w.warehouse_type !== 'transit').map((w) => <SelectItem key={w.id} value={w.id}>{td(w.name)}</SelectItem>)}
            </SelectContent>
          </Select></div>
      </div>
      {q.isLoading && <div className="grid gap-2">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-10" />)}</div>}
      {q.isError && <ErrorState error={q.error} onRetry={() => void q.refetch()} />}
      {q.data && rows.length === 0 && <EmptyState title={t('No table bills in this period')} description={t('Bills paid at tables on the floor screen show up here.')} />}
      {rows.length > 0 && (
        <div className="overflow-x-auto rounded-lg border bg-card">
          <Table>
            <TableHeader><TableRow>
              <TableHead>{t('Waiter')}</TableHead>
              <TableHead className="text-right">{t('Bills|restaurant')}</TableHead>
              <TableHead className="text-right">{t('Tables')}</TableHead>
              <TableHead className="text-right">{t('Guests')}</TableHead>
              <TableHead className="text-right">{t('Takings (with VAT)')}</TableHead>
              <TableHead className="text-right">{t('Per guest (with VAT)')}</TableHead>
              <TableHead className="text-right">{t('Discounts (with VAT)')}</TableHead>
              <TableHead className="text-right">{t('Average table time')}</TableHead>
              <TableHead className="text-right">{t('Cancelled after sending · value with VAT')}</TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.waiter_id}>
                  <TableCell className="font-medium">{r.waiter}</TableCell>
                  <TableCell className="text-right tabular">{formatInt(r.bills)}</TableCell>
                  <TableCell className="text-right tabular">{formatInt(r.tables)}</TableCell>
                  <TableCell className="text-right tabular">{formatInt(r.guests)}</TableCell>
                  <TableCell className="text-right tabular font-medium">{formatMoney(r.total)}</TableCell>
                  <TableCell className="text-right tabular">{r.per_guest == null ? '—' : formatMoney(r.per_guest)}</TableCell>
                  <TableCell className="text-right tabular">{num(r.discount) ? formatMoney(r.discount) : '—'}</TableCell>
                  <TableCell className="text-right tabular">{r.avg_minutes == null ? '—' : t('{m} min', { m: r.avg_minutes })}</TableCell>
                  <TableCell className={num(r.voided) ? 'text-right tabular text-warning' : 'text-right tabular'}>
                    {num(r.voided) ? `${formatInt(r.voided)} · ${formatMoney(r.voided_value)}` : '—'}</TableCell>
                </TableRow>
              ))}
            </TableBody>
            <TableFooter><TableRow>
              <TableCell>{t('Total')}</TableCell>
              <TableCell className="text-right tabular">{formatInt(sum('bills'))}</TableCell>
              <TableCell className="text-right tabular">{formatInt(sum('tables'))}</TableCell>
              <TableCell className="text-right tabular">{formatInt(guests)}</TableCell>
              <TableCell className="text-right tabular">{formatMoney(sum('total'))}</TableCell>
              <TableCell className="text-right tabular">{guests ? formatMoney(sum('total') / guests) : '—'}</TableCell>
              <TableCell className="text-right tabular">{formatMoney(sum('discount'))}</TableCell>
              <TableCell />
              <TableCell className="text-right tabular">{sum('voided') ? `${formatInt(sum('voided'))} · ${formatMoney(sum('voided_value'))}` : '—'}</TableCell>
            </TableRow></TableFooter>
          </Table>
        </div>
      )}
    </>
  )
}
