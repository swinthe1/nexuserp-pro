import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowRight, Shuffle } from 'lucide-react'
import * as React from 'react'
import { Link } from 'react-router-dom'
import { toast } from 'sonner'
import { useCompany } from '@/app/company-provider'
import { EmptyState } from '@/components/empty-state'
import { ErrorState } from '@/components/error-state'
import { GridExportMenu } from '@/components/export-menu'
import { MultiPick } from '@/components/multi-pick'
import { PageHeader } from '@/components/page-header'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { t, td } from '@/i18n'
import { describeError, unwrap } from '@/lib/errors'
import { supabase } from '@/lib/supabase'
import { cn, formatQty, num } from '@/lib/utils'
import { useCategories, useWarehouses } from '../api'

type Row = { variant_id: string; sku: string; name: string; uom: string | null; group: string | null; quantity: number
  from_id: string; from: string; from_on_hand: number; from_daily: number; from_days: number | null
  to_id: string; to: string; to_on_hand: number; to_daily: number; to_days: number | null }
const key = (r: Row) => `${r.variant_id}:${r.from_id}:${r.to_id}`

/**
 * Balancing the stock between the units (from the meeting with the staff): where a unit will run
 * out within the days chosen and another holds more than it needs, a transfer is proposed. Pick the
 * lines, change the quantities, and a draft transfer is made for each pair of units, to print,
 * ship and receive as usual.
 */
export function BalancingPage() {
  const { companyId, can } = useCompany()
  const qc = useQueryClient()
  const whs = useWarehouses()
  const cats = useCategories()
  const [days, setDays] = React.useState(30)
  const [cover, setCover] = React.useState(14)
  const [units, setUnits] = React.useState<string[]>([])
  const [groups, setGroups] = React.useState<string[]>([])
  const [picked, setPicked] = React.useState<Record<string, number>>({})
  const [made, setMade] = React.useState<{ id: string; number: string; from: string; to: string; lines: number }[] | null>(null)
  const q = useQuery({
    queryKey: ['inv', companyId, 'balance', days, cover, units, groups], enabled: !!companyId,
    queryFn: async () => unwrap(await supabase.rpc('stock_balance', { p_company: companyId!, p: { days, cover, units, groups } as never })) as unknown as { rows: Row[] },
  })
  React.useEffect(() => { setPicked({}) }, [q.data])
  const rows = q.data?.rows ?? []
  const create = useMutation({
    mutationFn: async () => unwrap(await supabase.rpc('stock_balance_create', { p_company: companyId!, p: {
      lines: rows.filter((r) => picked[key(r)] != null).map((r) => ({ variant_id: r.variant_id, from_id: r.from_id, to_id: r.to_id, quantity: picked[key(r)] })) } as never })) as unknown as NonNullable<typeof made>,
    onSuccess: (r) => { setMade(r); setPicked({}); toast.success(t('{n} draft transfers made', { n: r.length })); void qc.invalidateQueries({ queryKey: ['inv', companyId] }) },
    onError: (e) => toast.error(describeError(e)),
  })
  const catOptions = React.useMemo(() => {
    const all = cats.data ?? []
    return all.filter((c) => !c.parent_id).flatMap((r) => [{ value: r.id, label: td(r.name) }, ...all.filter((c) => c.parent_id === r.id).map((c) => ({ value: c.id, label: td(c.name), indent: true }))])
  }, [cats.data])
  const n = Object.keys(picked).length
  const allOn = rows.length > 0 && n === rows.length
  const toggle = (r: Row) => setPicked((p) => { const x = { ...p }; if (x[key(r)] != null) delete x[key(r)]; else x[key(r)] = num(r.quantity); return x })
  const daysText = (d: number | null) => (d == null ? '—' : t('{n} days', { n: formatQty(num(d)) }))

  return (
    <>
      <PageHeader back={{ href: '/inventory/transfers', label: t('Transfers') }} title={t('Stock balancing')}
        description={t('Where a unit will run out within the days chosen and another holds more than it needs, at the sales of each unit. Pick the lines and a draft transfer is made for each pair of units.')}
        actions={rows.length > 0 && <GridExportMenu name={t('stock-balancing')} title={t('Stock balancing')}
          grid={() => [[t('Code'), t('Item'), t('From'), t('Stock there'), t('Lasts there'), t('To|unit'), t('Stock there'), t('Sold a day'), t('Lasts there'), t('Quantity')],
            ...rows.map((r) => [r.sku, r.name, td(r.from), num(r.from_on_hand), r.from_days, td(r.to), num(r.to_on_hand), num(r.to_daily), r.to_days, num(r.quantity)])]} />} />
      <div className="mb-3 flex flex-wrap items-end gap-2">
        <div className="grid gap-1"><Label className="text-xs">{t('Sales of the last days')}</Label>
          <Input type="number" min={7} max={180} className="h-9 w-28 text-right tabular" value={days} onChange={(e) => setDays(Number(e.target.value) || 30)} /></div>
        <div className="grid gap-1"><Label className="text-xs">{t('Stock for how many days')}</Label>
          <Input type="number" min={1} max={90} className="h-9 w-28 text-right tabular" value={cover} onChange={(e) => setCover(Number(e.target.value) || 14)} /></div>
        <MultiPick label={t('Units|stores')} value={units} onChange={setUnits} options={(whs.data ?? []).map((w) => ({ value: w.id, label: td(w.name), hint: w.code }))} />
        <MultiPick label={t('Groups')} value={groups} onChange={setGroups} options={catOptions} />
        {(can('inventory.write') || can('wms.write')) && (
          <Button className="ml-auto" disabled={!n || create.isPending} loading={create.isPending} onClick={() => create.mutate()}><Shuffle /> {t('Make the transfers ({n} lines)', { n })}</Button>
        )}
      </div>
      {made && made.length > 0 && (
        <div className="mb-3 grid gap-1.5 rounded-lg border border-success/40 bg-success/5 p-3 text-[13px]">
          <span className="font-medium">{t('Draft transfers made. Open each to check, print and ship:')}</span>
          {made.map((m) => <Link key={m.id} to={`/inventory/transfers/${m.id}`} className="inline-flex items-center gap-1.5 text-primary hover:underline">{m.number}: {td(m.from)} <ArrowRight className="size-3.5" /> {td(m.to)} · {t('{n} lines', { n: m.lines })}</Link>)}
        </div>
      )}
      {q.isLoading ? <Skeleton className="h-80" /> : q.isError ? <ErrorState error={q.error} onRetry={() => void q.refetch()} /> : !rows.length ? (
        <Card><EmptyState icon={Shuffle} title={t('The units are in balance')} description={t('No unit runs out within these days while another has more than it needs. Change the days or the filters.')} /></Card>
      ) : (
        <Card className="overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead><tr className="border-b bg-muted/40 text-[12px] text-muted-foreground">
              <th className="w-9 px-2 py-2"><input type="checkbox" className="size-4 accent-primary" aria-label={t('All')} checked={allOn}
                onChange={() => setPicked(allOn ? {} : Object.fromEntries(rows.map((r) => [key(r), num(r.quantity)])))} /></th>
              <th className="px-2 py-2 text-left font-medium">{t('Item')}</th>
              <th className="px-2 py-2 text-left font-medium">{t('From')}</th>
              <th className="px-2 py-2 text-left font-medium">{t('To|unit')}</th>
              <th className="px-2 py-2 text-right font-medium">{t('Sold a day there')}</th>
              <th className="w-32 px-2 py-2 text-right font-medium">{t('Quantity')}</th>
            </tr></thead>
            <tbody>
              {rows.map((r) => {
                const on = picked[key(r)] != null
                return (
                  <tr key={key(r)} className={cn('border-b last:border-0', on && 'bg-primary/5')}>
                    <td className="px-2 py-1.5 text-center"><input type="checkbox" className="size-4 accent-primary" checked={on} onChange={() => toggle(r)} aria-label={r.name} /></td>
                    <td className="px-2 py-1.5"><span className="font-medium">{r.name}</span><span className="block text-[12px] text-muted-foreground">{r.sku}{r.group ? ` · ${td(r.group)}` : ''}</span></td>
                    <td className="px-2 py-1.5">{td(r.from)}<span className="block text-[12px] text-muted-foreground">{t('{qty} in stock · lasts {days}', { qty: formatQty(num(r.from_on_hand), r.uom), days: r.from_days == null ? t('not sold there') : daysText(r.from_days) })}</span></td>
                    <td className="px-2 py-1.5">{td(r.to)}<span className={cn('block text-[12px]', num(r.to_on_hand) <= 0 ? 'font-medium text-destructive' : 'text-muted-foreground')}>
                      {t('{qty} in stock · lasts {days}', { qty: formatQty(num(r.to_on_hand), r.uom), days: daysText(r.to_days) })}</span></td>
                    <td className="px-2 py-1.5 text-right tabular">{formatQty(num(r.to_daily))}</td>
                    <td className="px-2 py-1.5 text-right">
                      <span className="inline-flex items-center gap-1"><Input inputMode="decimal" className="h-8 w-20 text-right tabular" value={on ? String(picked[key(r)]) : String(num(r.quantity))}
                        onChange={(e) => { const v = Number(e.target.value.replace(',', '.')); setPicked((p) => ({ ...p, [key(r)]: Number.isFinite(v) ? v : 0 })) }} />
                        {r.uom && <span className="w-6 text-left text-[11px] text-muted-foreground">{td(r.uom)}</span>}</span>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </Card>
      )}
    </>
  )
}
