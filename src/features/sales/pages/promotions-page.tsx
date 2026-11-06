import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { PageTableExport } from '@/components/page-table-export'
import { BadgePercent, Plus, X } from 'lucide-react'
import * as React from 'react'
import { toast } from 'sonner'
import { useCompany } from '@/app/company-provider'
import { EmptyState } from '@/components/empty-state'
import { ErrorState } from '@/components/error-state'
import { PageHeader } from '@/components/page-header'
import { SearchSelect } from '@/components/search-select'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { msg, t, td } from '@/i18n'
import { describeError, unwrap } from '@/lib/errors'
import { searchOffline, useScanCatalog, itemOffline } from '@/lib/offline/catalog'
import { supabase } from '@/lib/supabase'
import { cn, formatDate, formatMoney, formatQty, num, todayISO } from '@/lib/utils'
import { useCategories, useWarehouses } from '@/features/inventory/api'

type Promo = {
  id: string; name: string; kind: 'percent' | 'fixed_price' | 'buy_get'; value: number | null; buy_qty: number | null; get_qty: number | null; min_qty: number
  variant_ids: string[]; category_ids: string[]; starts_on: string | null; ends_on: string | null; weekdays: number[] | null; time_from: string | null; time_to: string | null
  channels: string[]; warehouse_ids: string[] | null; is_active: boolean
}
const KIND: Record<Promo['kind'], string> = { percent: msg('% off'), fixed_price: msg('A special price'), buy_get: msg('Buy some, get some free') }
const DAYS = [msg('Mon|day'), msg('Tue|day'), msg('Wed|day'), msg('Thu|day'), msg('Fri|day'), msg('Sat|day'), msg('Sun|day')]

export const describePromo = (p: Pick<Promo, 'kind' | 'value' | 'buy_qty' | 'get_qty'>) =>
  p.kind === 'percent' ? t('−{pct}%', { pct: num(p.value) }) : p.kind === 'fixed_price' ? t('for {price} with VAT', { price: formatMoney(p.value) })
    : t('{n} for the price of {m}', { n: num(p.buy_qty) + num(p.get_qty), m: num(p.buy_qty) })

/** Sales › Promotions: % off, a special price, "3 for 2" — on the till and on sales documents, for a time. */
export function PromotionsPage() {
  const { companyId, can } = useCompany()
  const q = useQuery({ queryKey: ['promotions', companyId], enabled: !!companyId,
    queryFn: async () => unwrap(await supabase.from('promotions').select('*').eq('company_id', companyId!).is('deleted_at', null).order('is_active', { ascending: false }).order('created_at', { ascending: false })) as unknown as Promo[] })
  const [edit, setEdit] = React.useState<Partial<Promo> | null>(null)
  const today = todayISO()
  const state = (p: Promo) => !p.is_active ? 'off' : p.ends_on && p.ends_on < today ? 'ended' : p.starts_on && p.starts_on > today ? 'soon' : 'on'
  return (
    <>
      <PageHeader title={t('Promotions')} description={t('Discounts for a time: a percentage, a special price, or "3 for 2". The till applies them by itself, and sales documents take them as the discount.')}
        actions={<><PageTableExport />{can('sales.write') && <Button onClick={() => setEdit({ kind: 'percent', value: 10, min_qty: 1, channels: ['pos', 'sales'], variant_ids: [], category_ids: [], is_active: true, starts_on: today })}><Plus /> {t('New promotion')}</Button>}</>} />
      <Tabs defaultValue="list">
        <TabsList><TabsTrigger value="list">{t('Promotions')}</TabsTrigger><TabsTrigger value="results">{t('Results')}</TabsTrigger></TabsList>
        <TabsContent value="list">
          {q.isError ? <ErrorState error={q.error} onRetry={() => void q.refetch()} /> : !q.data ? <Skeleton className="h-40" /> : q.data.length === 0
            ? <EmptyState icon={BadgePercent} title={t('No promotions yet')} description={t('Make one for a weekend, a season or a slow-moving item.')} />
            : (
              <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                {q.data.map((p) => {
                  const s = state(p)
                  return (
                    <button key={p.id} type="button" onClick={() => can('sales.write') && setEdit(p)} className={cn('rounded-lg border bg-card p-3 text-left hover:border-primary/50', s !== 'on' && 'opacity-70')}>
                      <div className="flex items-start justify-between gap-2">
                        <span className="font-medium">{p.name}</span>
                        <Badge variant={s === 'on' ? 'success' : 'secondary'}>{s === 'on' ? t('Running') : s === 'soon' ? t('Not started') : s === 'ended' ? t('Ended') : t('Off')}</Badge>
                      </div>
                      <p className="mt-1 text-lg font-semibold">{describePromo(p)}</p>
                      <p className="text-xs text-muted-foreground">
                        {p.variant_ids.length + p.category_ids.length === 0 ? t('Every item') : [p.variant_ids.length && t('{n} items', { n: p.variant_ids.length }), p.category_ids.length && t('{n} categories', { n: p.category_ids.length })].filter(Boolean).join(' · ')}
                        {' · '}{p.channels.map((c) => c === 'pos' ? t('till') : t('sales')).join(', ')}
                        {(p.starts_on || p.ends_on) && <> · {p.starts_on ? formatDate(p.starts_on) : '…'} – {p.ends_on ? formatDate(p.ends_on) : '…'}</>}
                        {p.weekdays?.length ? <> · {p.weekdays.map((d) => t(DAYS[d - 1])).join(' ')}</> : null}
                        {p.time_from || p.time_to ? <> · {(p.time_from ?? '00:00').slice(0, 5)}–{(p.time_to ?? '23:59').slice(0, 5)}</> : null}
                      </p>
                    </button>
                  )
                })}
              </div>
            )}
        </TabsContent>
        <TabsContent value="results"><Results /></TabsContent>
      </Tabs>
      {edit && <Editor value={edit} onClose={() => setEdit(null)} />}
    </>
  )
}

function Results() {
  const { companyId, company } = useCompany()
  const [from, setFrom] = React.useState(() => { const d = new Date(); d.setDate(1); return d.toISOString().slice(0, 10) })
  const [to, setTo] = React.useState(todayISO())
  const q = useQuery({ queryKey: ['promo-results', companyId, from, to], enabled: !!companyId,
    queryFn: async () => (unwrap(await supabase.rpc('promotion_results', { p_company: companyId!, p_from: from, p_to: to })) ?? []) as unknown as { id: string; name: string; receipts: number; qty: number; discount: number; sales: number }[] })
  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap gap-3">
        <div className="grid gap-1.5"><Label htmlFor="pr-from">{t('From')}</Label><Input id="pr-from" type="date" className="w-40" value={from} onChange={(e) => e.target.value && setFrom(e.target.value)} /></div>
        <div className="grid gap-1.5"><Label htmlFor="pr-to">{t('To')}</Label><Input id="pr-to" type="date" className="w-40" value={to} onChange={(e) => e.target.value && setTo(e.target.value)} /></div>
      </div>
      {!q.data ? <Skeleton className="h-32" /> : q.data.length === 0 ? <EmptyState compact icon={BadgePercent} title={t('No sale under a promotion in this period')} /> : (
        <div className="overflow-x-auto rounded-lg border bg-card">
          <table className="w-full text-[13px]">
            <thead className="bg-muted/40 text-left text-xs text-muted-foreground"><tr><th className="px-3 py-2 font-medium">{t('Promotion')}</th>
              <th className="px-3 py-2 text-right font-medium">{t('Receipts')}</th><th className="px-3 py-2 text-right font-medium">{t('Pieces')}</th>
              <th className="px-3 py-2 text-right font-medium">{t('Discount given (with VAT)')}</th><th className="px-3 py-2 text-right font-medium">{t('Takings (with VAT)')}</th></tr></thead>
            <tbody>{q.data.map((r) => (
              <tr key={r.id} className="border-t"><td className="px-3 py-2 font-medium">{r.name}</td><td className="px-3 py-2 text-right tabular-nums">{r.receipts}</td>
                <td className="px-3 py-2 text-right tabular-nums">{formatQty(r.qty)}</td><td className="px-3 py-2 text-right tabular-nums">{formatMoney(r.discount)}</td>
                <td className="px-3 py-2 text-right font-medium tabular-nums">{formatMoney(r.sales, company?.base_currency)}</td></tr>))}</tbody>
          </table>
        </div>
      )}
      <p className="text-xs text-muted-foreground">{t('From the till receipts.')}</p>
    </div>
  )
}

function Editor({ value, onClose }: { value: Partial<Promo>; onClose: () => void }) {
  const { companyId } = useCompany()
  const qc = useQueryClient()
  const catalog = useScanCatalog()
  const categories = useCategories()
  const warehouses = useWarehouses({ all: true })
  const [p, setP] = React.useState<Partial<Promo>>(value)
  const set = (x: Partial<Promo>) => setP((o) => ({ ...o, ...x }))
  const options = React.useMemo(() => (companyId && catalog.ready ? searchOffline(companyId, '', 1_000_000) : [])
    .map((i) => ({ value: i.variant_id, label: i.name, hint: i.sku, keywords: i.barcodes.map(([b]) => b) })), [companyId, catalog.ready, catalog.count]) // eslint-disable-line react-hooks/exhaustive-deps
  const save = useMutation({
    mutationFn: async () => {
      const row = { name: (p.name ?? '').trim(), kind: p.kind!, value: p.kind === 'buy_get' ? null : num(p.value), buy_qty: p.kind === 'buy_get' ? num(p.buy_qty) : null,
        get_qty: p.kind === 'buy_get' ? num(p.get_qty) : null, min_qty: num(p.min_qty) || 1, variant_ids: p.variant_ids ?? [], category_ids: p.category_ids ?? [],
        starts_on: p.starts_on || null, ends_on: p.ends_on || null, weekdays: p.weekdays?.length ? p.weekdays : null, time_from: p.time_from || null, time_to: p.time_to || null,
        channels: p.channels ?? ['pos'], warehouse_ids: p.warehouse_ids?.length ? p.warehouse_ids : null, is_active: p.is_active ?? true }
      if (p.id) unwrap(await supabase.from('promotions').update(row).eq('id', p.id))
      else unwrap(await supabase.from('promotions').insert({ ...row, company_id: companyId! }))
    },
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['promotions'] }); toast.success(t('Promotion saved')); onClose() },
    onError: (e) => toast.error(describeError(e)),
  })
  const del = useMutation({
    mutationFn: async () => unwrap(await supabase.from('promotions').delete().eq('id', p.id!)),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['promotions'] }); onClose() },
  })
  const ok = !!p.name?.trim() && (p.kind === 'buy_get' ? num(p.buy_qty) > 0 && num(p.get_qty) > 0 : p.value != null && String(p.value) !== '' && num(p.value) >= 0 && (p.kind !== 'percent' || num(p.value) <= 100))
    && (p.channels?.length ?? 0) > 0
  const toggleIn = <K extends 'weekdays' | 'channels' | 'warehouse_ids'>(k: K, v: NonNullable<Promo[K]>[number]) => {
    const cur = (p[k] ?? []) as unknown[]
    set({ [k]: cur.includes(v) ? cur.filter((x) => x !== v) : [...cur, v] } as Partial<Promo>)
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-xl overflow-y-auto">
        <DialogHeader><DialogTitle>{p.id ? t('Edit the promotion') : t('New promotion')}</DialogTitle></DialogHeader>
        <div className="grid gap-4">
          <div className="grid gap-1.5"><Label htmlFor="pm-name">{t('Name')}</Label><Input id="pm-name" value={p.name ?? ''} onChange={(e) => set({ name: e.target.value })} placeholder={t('e.g. Weekend −10%')} /></div>
          <div className="grid gap-1.5"><Label>{t('Kind|withholding')}</Label>
            <div className="grid gap-1.5 sm:grid-cols-3">{(Object.keys(KIND) as Promo['kind'][]).map((k) => (
              <button key={k} type="button" aria-pressed={p.kind === k} onClick={() => set({ kind: k, ...(k === 'buy_get' ? { buy_qty: p.buy_qty ?? 2, get_qty: p.get_qty ?? 1 } : {}) })}
                className={cn('rounded-md border px-3 py-2 text-left text-[13px]', p.kind === k ? 'border-primary bg-primary/5 font-medium' : 'hover:bg-muted/50')}>{t(KIND[k])}</button>))}</div></div>
          {p.kind === 'buy_get' ? (
            <div className="flex flex-wrap items-end gap-2 text-sm">
              <div className="grid gap-1.5"><Label htmlFor="pm-buy">{t('Buy')}</Label><Input id="pm-buy" type="number" min="1" className="w-20 text-right" value={p.buy_qty ?? ''} onChange={(e) => set({ buy_qty: num(e.target.value) })} /></div>
              <div className="grid gap-1.5"><Label htmlFor="pm-get">{t('get free')}</Label><Input id="pm-get" type="number" min="1" className="w-20 text-right" value={p.get_qty ?? ''} onChange={(e) => set({ get_qty: num(e.target.value) })} /></div>
              <p className="pb-2 text-muted-foreground">{t('= {n} for the price of {m}', { n: num(p.buy_qty) + num(p.get_qty), m: num(p.buy_qty) })}</p>
            </div>
          ) : (
            <div className="flex flex-wrap items-end gap-3">
              <div className="grid gap-1.5"><Label htmlFor="pm-val">{p.kind === 'percent' ? t('% off') : t('Price with VAT')}</Label>
                <Input id="pm-val" type="number" step="any" min="0" className="w-32 text-right" value={p.value ?? ''} onChange={(e) => set({ value: e.target.value as never })} /></div>
              <div className="grid gap-1.5"><Label htmlFor="pm-min">{t('From how many pieces')}</Label>
                <Input id="pm-min" type="number" step="any" min="1" className="w-28 text-right" value={p.min_qty ?? 1} onChange={(e) => set({ min_qty: num(e.target.value) })} /></div>
            </div>
          )}

          <div className="grid gap-1.5">
            <Label>{t('Items')}</Label>
            <SearchSelect value={null} options={options} placeholder={t('Add an item')} onChange={(v) => v && !p.variant_ids?.includes(v) && set({ variant_ids: [...(p.variant_ids ?? []), v] })} />
            <SearchSelect value={null} placeholder={t('Add a category')} options={(categories.data ?? []).map((c) => ({ value: c.id, label: c.name }))}
              onChange={(v) => v && !p.category_ids?.includes(v) && set({ category_ids: [...(p.category_ids ?? []), v] })} />
            <div className="flex flex-wrap gap-1">
              {(p.variant_ids ?? []).map((v) => <Badge key={v} variant="secondary" className="gap-1">{(companyId && itemOffline(companyId, v)?.name) || '…'}
                <button type="button" aria-label={t('Remove')} onClick={() => set({ variant_ids: p.variant_ids!.filter((x) => x !== v) })}><X className="size-3" /></button></Badge>)}
              {(p.category_ids ?? []).map((c) => <Badge key={c} variant="outline" className="gap-1">{categories.data?.find((x) => x.id === c)?.name ?? '…'}
                <button type="button" aria-label={t('Remove')} onClick={() => set({ category_ids: p.category_ids!.filter((x) => x !== c) })}><X className="size-3" /></button></Badge>)}
              {!(p.variant_ids?.length || p.category_ids?.length) && <span className="text-xs text-muted-foreground">{t('None chosen: every item')}</span>}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div className="grid gap-1.5"><Label htmlFor="pm-from">{t('From')}</Label><Input id="pm-from" type="date" value={p.starts_on ?? ''} onChange={(e) => set({ starts_on: e.target.value })} /></div>
            <div className="grid gap-1.5"><Label htmlFor="pm-to">{t('Until')}</Label><Input id="pm-to" type="date" value={p.ends_on ?? ''} onChange={(e) => set({ ends_on: e.target.value })} /></div>
            <div className="grid gap-1.5"><Label htmlFor="pm-tf">{t('From the hour')}</Label><Input id="pm-tf" type="time" value={p.time_from?.slice(0, 5) ?? ''} onChange={(e) => set({ time_from: e.target.value })} /></div>
            <div className="grid gap-1.5"><Label htmlFor="pm-tt">{t('To the hour')}</Label><Input id="pm-tt" type="time" value={p.time_to?.slice(0, 5) ?? ''} onChange={(e) => set({ time_to: e.target.value })} /></div>
          </div>
          <div className="grid gap-1.5"><Label>{t('Days of the week')}</Label>
            <div className="flex flex-wrap gap-1">{DAYS.map((d, i) => (
              <button key={d} type="button" aria-pressed={!!p.weekdays?.includes(i + 1)} onClick={() => toggleIn('weekdays', i + 1)}
                className={cn('rounded-md border px-2.5 py-1 text-xs', p.weekdays?.includes(i + 1) ? 'border-primary bg-primary/10 font-medium' : 'hover:bg-muted/50')}>{t(d)}</button>))}
              {!p.weekdays?.length && <span className="self-center text-xs text-muted-foreground">{t('every day')}</span>}</div></div>
          <div className="grid gap-1.5"><Label>{t('Where')}</Label>
            <div className="flex flex-wrap gap-3 text-sm">
              <label className="flex items-center gap-2"><Checkbox checked={!!p.channels?.includes('pos')} onCheckedChange={() => toggleIn('channels', 'pos')} />{t('On the till')}</label>
              <label className="flex items-center gap-2"><Checkbox checked={!!p.channels?.includes('sales')} onCheckedChange={() => toggleIn('channels', 'sales')} />{t('On sales documents')}</label>
            </div>
            {(warehouses.data?.length ?? 0) > 1 && <div className="flex flex-wrap gap-1">{(warehouses.data ?? []).map((w) => (
              <button key={w.id} type="button" aria-pressed={!!p.warehouse_ids?.includes(w.id)} onClick={() => toggleIn('warehouse_ids', w.id)}
                className={cn('rounded-md border px-2.5 py-1 text-xs', p.warehouse_ids?.includes(w.id) ? 'border-primary bg-primary/10 font-medium' : 'hover:bg-muted/50')}>{td(w.name)}</button>))}
              {!p.warehouse_ids?.length && <span className="self-center text-xs text-muted-foreground">{t('in every shop')}</span>}</div>}
          </div>
          <label className="flex items-center justify-between gap-3 text-sm">{t('Active')}<Switch checked={p.is_active ?? true} onCheckedChange={(on) => set({ is_active: on })} aria-label={t('Active')} /></label>
        </div>
        <DialogFooter className="sm:justify-between">
          {p.id ? <Button variant="ghost" className="text-destructive" loading={del.isPending} onClick={() => del.mutate()}>{t('Delete')}</Button> : <span />}
          <Button disabled={!ok} loading={save.isPending} onClick={() => save.mutate()}>{t('Save')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
