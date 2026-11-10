import { categoryColumns, categoryFacets, useCategoryParts } from '../components/category-picks'
import type { ColumnDef } from '@tanstack/react-table'
import { ArrowDown, ArrowUp, Check, Settings2, X } from 'lucide-react'
import * as React from 'react'
import { useNavigate } from 'react-router-dom'
import { Can, useCompany } from '@/app/company-provider'
import { ColumnHeader, DataTable, inFilter, selectColumn } from '@/components/data-table/data-table'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { cn, formatDate, formatMoney, formatQty, num } from '@/lib/utils'
import { t, td, tEnum } from '@/i18n'
import { type PriceRules, type PriceSuggestion, useDecidePrices, usePriceRules, usePriceSuggestions, useSavePriceRules } from '../api'
import { MoreMenu } from '@/components/more-menu'

const pctChange = (s: PriceSuggestion) => (s.gross_now ? ((s.gross_new - s.gross_now) / s.gross_now) * 100 : null)

/** The prices worked out from a new cost, waiting for a yes: shown as a tab of Price levelling. */
export function PriceSuggestions() {
  const navigate = useNavigate()
  const { can } = useCompany()
  const [show, setShow] = React.useState<'pending' | 'all'>('pending')
  const list = usePriceSuggestions(show)
  const decide = useDecidePrices()
  const [rules, setRules] = React.useState(false)
  const [edit, setEdit] = React.useState<PriceSuggestion | null>(null)
  const writer = can('inventory.write')

  const parts = useCategoryParts()
  const columns = React.useMemo<ColumnDef<PriceSuggestion>[]>(() => [
    ...(writer && show === 'pending' ? [selectColumn<PriceSuggestion>()] : []),
    {
      id: 'product', accessorFn: (r) => `${r.sku} ${r.name}`, enableHiding: false,
      header: ({ column }) => <ColumnHeader column={column} title={t('Product')} />, meta: { label: t('Product'), exportValue: (r) => r.name },
      cell: ({ row: { original: r } }) => <div><div className="font-medium">{r.name}</div><div className="text-xs text-muted-foreground">{r.sku}</div></div>,
    },
    ...categoryColumns<PriceSuggestion>((r) => r.category, parts),
    {
      id: 'cost', accessorFn: (r) => r.cost_after, header: t('Cost (without VAT)'), meta: { label: t('Cost (without VAT)'), align: 'right' },
      cell: ({ row: { original: r } }) => (
        <span className="tabular">{r.cost_before != null && <span className="text-muted-foreground">{formatMoney(r.cost_before)} → </span>}{formatMoney(r.cost_after)}</span>
      ),
    },
    {
      id: 'rule', accessorFn: (r) => r.margin_pct, header: t('Target'), meta: { label: t('Target') },
      cell: ({ row: { original: r } }) => <span className="whitespace-nowrap">{r.basis === 'margin' ? t('{pct}% margin', { pct: num(r.margin_pct) }) : t('{pct}% over cost', { pct: num(r.margin_pct) })}</span>,
    },
    { id: 'now', accessorFn: (r) => r.gross_now, header: t('Price now (with VAT)'), meta: { label: t('Price now (with VAT)'), align: 'right' }, cell: ({ getValue }) => <span className="tabular text-muted-foreground">{getValue() == null ? '—' : formatMoney(getValue() as number)}</span> },
    {
      id: 'new', accessorFn: (r) => r.gross_new, header: ({ column }) => <ColumnHeader column={column} title={t('New price (with VAT)')} />, meta: { label: t('New price (with VAT)'), align: 'right', mobile: 'amount' },
      cell: ({ row: { original: r } }) => {
        const p = pctChange(r)
        return (
          <span className="whitespace-nowrap font-semibold tabular">
            {p != null && <span className={cn('mr-1.5 inline-flex items-center text-xs font-medium', p >= 0 ? 'text-warning' : 'text-success')}>{p >= 0 ? <ArrowUp className="size-3" /> : <ArrowDown className="size-3" />}{Math.abs(p).toFixed(1)}%</span>}
            {formatMoney(r.gross_new)}
          </span>
        )
      },
    },
    { id: 'on_hand', accessorFn: (r) => r.on_hand ?? 0, header: t('In stock'), meta: { label: t('In stock'), align: 'right' }, cell: ({ getValue }) => <span className="tabular">{formatQty(getValue() as number)}</span> },
    ...(show === 'all' ? [{
      id: 'status', accessorFn: (r: PriceSuggestion) => r.status, filterFn: inFilter, header: t('Status'), meta: { label: t('Status') },
      cell: ({ row: { original: r } }: { row: { original: PriceSuggestion } }) => <div><div>{tEnum(r.status)}</div>{r.decided_at && <div className="text-xs text-muted-foreground">{formatDate(r.decided_at)}{r.decided_by_name ? ` · ${r.decided_by_name}` : ''}</div>}</div>,
    } as ColumnDef<PriceSuggestion>] : [{ id: 'date', accessorFn: (r: PriceSuggestion) => r.created_at, header: t('Since'), meta: { label: t('Since') }, cell: ({ getValue }: { getValue: () => unknown }) => formatDate(getValue() as string) } as ColumnDef<PriceSuggestion>]),
    ...(writer && show === 'pending' ? [{
      id: 'actions', enableHiding: false, meta: { noExport: true },
      cell: ({ row: { original: r } }: { row: { original: PriceSuggestion } }) => (
        <div className="flex justify-end gap-1" onClick={(e) => e.stopPropagation()}>
          <Button size="xs" onClick={() => decide.mutate({ ids: [r.id], accept: true })}><Check /> {t('Accept')}</Button>
          <MoreMenu size="sm" className="h-7" items={[
            { label: t('Other price'), onSelect: () => setEdit(r) },
            { label: t('Reject'), icon: X, onSelect: () => decide.mutate({ ids: [r.id], accept: false }) },
          ]} />
        </div>
      ),
    } as ColumnDef<PriceSuggestion>] : []),
  ], [writer, show, decide, parts])

  return (
    <>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <p className="max-w-2xl text-sm text-muted-foreground">{t('When goods arrive at a new cost, DrisPRO works out the price that keeps the target margin of the category, VAT included and rounded like your shelf prices. Accepted prices are saved as one price levelling; nothing changes by itself.')}</p>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => setShow((s) => (s === 'pending' ? 'all' : 'pending'))}>{show === 'pending' ? t('Show decided ones') : t('Only waiting ones')}</Button>
          <Can perm="inventory.write"><Button variant="outline" onClick={() => setRules(true)}><Settings2 /> {t('Margin rules')}</Button></Can>
        </div>
      </div>
      <DataTable
        tableKey="inventory.price-suggestions"
        columns={columns}
        data={list.data}
        isLoading={list.isLoading}
        error={list.error}
        getRowId={(r) => r.id}
        searchPlaceholder={t('Code or product')}
        exportName="new-prices"
        onRowClick={(r) => navigate(`/inventory/products/${r.product_id}`)}
        facets={categoryFacets(list.data, (r) => r.category, parts)}
        bulkActions={writer && show === 'pending' ? (rows, clear) => (
          <>
            <Button size="xs" loading={decide.isPending} onClick={() => decide.mutate({ ids: rows.map((r) => r.original.id), accept: true }, { onSuccess: clear })}><Check /> {t('Accept')}</Button>
            <Button size="xs" variant="outline" disabled={decide.isPending} onClick={() => decide.mutate({ ids: rows.map((r) => r.original.id), accept: false }, { onSuccess: clear })}><X /> {t('Reject')}</Button>
          </>
        ) : undefined}
        empty={show === 'pending'
          ? { title: t('No new prices to review'), description: t('Give your categories a target margin in "Margin rules"; when the cost of an item changes, its new price waits here.'),
              action: writer ? <Button variant="outline" size="sm" onClick={() => setRules(true)}><Settings2 /> {t('Margin rules')}</Button> : undefined }
          : { title: t('Nothing here yet') }}
      />
      {rules && <RulesDialog onClose={() => setRules(false)} />}
      {edit && <OtherPriceDialog s={edit} onClose={() => setEdit(null)} onSave={(gross) => decide.mutate({ ids: [edit.id], accept: true, gross }, { onSuccess: () => setEdit(null) })} busy={decide.isPending} />}
    </>
  )
}

function OtherPriceDialog({ s, onClose, onSave, busy }: { s: PriceSuggestion; onClose: () => void; onSave: (gross: number) => void; busy: boolean }) {
  const [v, setV] = React.useState(String(s.gross_new))
  const gross = num(v)
  const margin = gross > 0 ? ((gross / (1 + s.tax_rate / 100) - s.cost_after) / s.cost_after) * 100 : 0
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader><DialogTitle>{s.name}</DialogTitle>
          <DialogDescription>{t('Cost {cost} without VAT · suggested {price} with VAT', { cost: formatMoney(s.cost_after), price: formatMoney(s.gross_new) })}</DialogDescription></DialogHeader>
        <form className="grid gap-3" onSubmit={(e) => { e.preventDefault(); if (gross > 0) onSave(gross) }}>
          <div className="grid gap-1.5">
            <Label htmlFor="op">{t('Selling price, VAT included')}</Label>
            <Input id="op" autoFocus type="number" step="any" min="0" value={v} onChange={(e) => setV(e.target.value)} className="text-right text-lg tabular" />
            <p className={cn('text-xs', margin < 0 ? 'text-destructive' : 'text-muted-foreground')}>{t('{pct}% over cost', { pct: margin.toFixed(1) })}</p>
          </div>
          <DialogFooter><Button type="button" variant="ghost" onClick={onClose}>{t('Cancel')}</Button><Button type="submit" loading={busy} disabled={!(gross > 0)}>{t('Save the price')}</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function RulesDialog({ onClose }: { onClose: () => void }) {
  const q = usePriceRules()
  const save = useSavePriceRules()
  const [r, setR] = React.useState<PriceRules | null>(null)
  React.useEffect(() => { if (q.data && !r) setR(q.data) }, [q.data, r])
  const set = (p: Partial<PriceRules>) => setR((x) => (x ? { ...x, ...p } : x))
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle>{t('Margin rules')}</DialogTitle>
          <DialogDescription>{t('A category without a target gets no suggestions.')}</DialogDescription></DialogHeader>
        {!r ? <div className="h-40" /> : (
          <div className="grid gap-4">
            <div className="grid gap-3 sm:grid-cols-[1fr_180px]">
              <div className="grid min-w-0 gap-1.5">
                <Label>{t('The target means')}</Label>
                <Select value={r.basis} onValueChange={(v) => set({ basis: v as 'markup' | 'margin' })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="markup">{t('Over cost (cost 100, 30% → 130)')}</SelectItem>
                    <SelectItem value="margin">{t('Of the price (cost 100, 30% → 142.86)')}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-1.5">
                <Label>{t('Round the shelf price up to')}</Label>
                <Select value={String(r.step)} onValueChange={(v) => set({ step: Number(v) })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {[0, 0.05, 0.1, 0.5, 1, 5, 10].map((s) => <SelectItem key={s} value={String(s)}>{s === 0 ? t('No rounding') : formatMoney(s)}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <label className="flex items-center justify-between gap-3 text-sm">
              <span>{t('Suggest lower prices too when the cost falls')}</span>
              <Switch checked={r.down} onCheckedChange={(v) => set({ down: v })} />
            </label>
            <div className="grid gap-1.5">
              <Label>{t('Target per category (%)')}</Label>
              <div className="grid max-h-[36dvh] gap-1.5 overflow-y-auto rounded-md border p-2">
                {!r.categories.length && <p className="p-2 text-[13px] text-muted-foreground">{t('No categories yet. Add them in Inventory setup.')}</p>}
                {r.categories.map((c) => (
                  <div key={c.id} className="flex items-center justify-between gap-3">
                    <span className="truncate text-sm">{td(c.name)}</span>
                    <Input type="number" step="any" className="w-24 text-right tabular" placeholder="—" aria-label={t('Target for {name}', { name: c.name })}
                      value={c.pct ?? ''} onChange={(e) => set({ categories: r.categories.map((x) => (x.id === c.id ? { ...x, pct: e.target.value === '' ? null : Number(e.target.value) } : x)) })} />
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
        <DialogFooter className="gap-2">
          <Button variant="ghost" onClick={onClose}>{t('Cancel')}</Button>
          <Button variant="outline" disabled={!r} loading={save.isPending} onClick={() => r && save.mutate({ ...r, scan: false }, { onSuccess: onClose })}>{t('Save')}</Button>
          <Button disabled={!r} loading={save.isPending} onClick={() => r && save.mutate({ ...r, scan: true }, { onSuccess: onClose })}>{t('Save and check all items now')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
