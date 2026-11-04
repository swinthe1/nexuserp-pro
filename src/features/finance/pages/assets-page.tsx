import type { ColumnDef } from '@tanstack/react-table'
import { CalendarClock, Camera, Plus, Trash2 } from 'lucide-react'
import * as React from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { toast } from 'sonner'
import { Can, useCompany } from '@/app/company-provider'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { ColumnHeader, DataTable, inFilter } from '@/components/data-table/data-table'
import { EmptyState } from '@/components/empty-state'
import { PageHeader } from '@/components/page-header'
import { SearchSelect } from '@/components/search-select'
import { StatCard } from '@/components/stat-card'
import { StatusBadge } from '@/components/status-badge'
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
import { supabase } from '@/lib/supabase'
import { ErrorState } from '@/components/error-state'
import { msg, t, td, tn } from '@/i18n'
import { cn, formatDate, formatMoney, formatMonth, humanize, num, todayISO } from '@/lib/utils'
import { usePartners } from '@/features/sales/api'
import {
  useAccounts, useActivateAsset, useAsset, useAssetCategories, useAssets, useBankAccounts, useCostCenters, useDepreciationAuto, useDisposeAsset, useRunDepreciation, useSaveAsset,
  type AssetRow,
} from '../api'
import { AccountingTab } from '../components/t-accounts'

const monthEnd = (d = new Date()) => { const e = new Date(d.getFullYear(), d.getMonth() + 1, 0); return `${e.getFullYear()}-${String(e.getMonth() + 1).padStart(2, '0')}-${String(e.getDate()).padStart(2, '0')}` }

export function AssetsPage() {
  const navigate = useNavigate()
  const assets = useAssets()
  const run = useRunDepreciation()
  const auto = useDepreciationAuto()
  const [runOpen, setRunOpen] = React.useState(false)
  const [through, setThrough] = React.useState(monthEnd())
  const live = (assets.data ?? []).filter((a) => a.status === 'active' || a.status === 'fully_depreciated')
  const cost = live.reduce((s, a) => s + num(a.acquisition_cost), 0)
  const accum = live.reduce((s, a) => s + num(a.accumulated_depreciation), 0)
  const cols = React.useMemo<ColumnDef<AssetRow>[]>(() => [
    { accessorKey: 'number', enableHiding: false, header: ({ column }) => <ColumnHeader column={column} title={t('Number')} />, meta: { label: t('Number') }, cell: ({ getValue }) => <span className="whitespace-nowrap font-medium">{getValue() as string}</span> },
    { accessorKey: 'name', header: ({ column }) => <ColumnHeader column={column} title={t('Asset')} />, meta: { label: t('Asset') } },
    { id: 'category', accessorFn: (r) => td(r.category?.name ?? ''), filterFn: inFilter, header: t('Category'), meta: { label: t('Category') } },
    { id: 'cc', accessorFn: (r) => r.cost_center?.code ?? '', header: t('Cost center'), meta: { label: t('Cost center') } },
    { accessorKey: 'in_service_date', header: t('In service since'), meta: { label: t('In service since') }, cell: ({ getValue }) => <span className="whitespace-nowrap">{formatDate(getValue() as string)}</span> },
    { accessorKey: 'status', filterFn: inFilter, header: t('Status'), meta: { label: t('Status') }, cell: ({ getValue }) => <StatusBadge status={getValue() as string} /> },
    { accessorKey: 'acquisition_cost', header: t('Cost (without VAT)'), meta: { label: t('Cost (without VAT)'), align: 'right' }, cell: ({ getValue }) => <span className="tabular">{formatMoney(getValue() as number)}</span> },
    { accessorKey: 'accumulated_depreciation', header: t('Depreciated'), meta: { label: t('Depreciated'), align: 'right' }, cell: ({ getValue }) => <span className="tabular text-muted-foreground">{formatMoney(getValue() as number)}</span> },
    { accessorKey: 'book_value', header: ({ column }) => <ColumnHeader column={column} title={t('Book value')} />, meta: { label: t('Book value'), align: 'right' },
      cell: ({ row: { original: r } }) => r.status === 'disposed' ? <span className="text-[13px] text-muted-foreground">{t('Disposed on {date}', { date: formatDate(r.disposal_date) })}</span> : <span className="tabular font-medium">{formatMoney(r.book_value)}</span> },
  ], [])
  const cats = [...new Set((assets.data ?? []).map((a) => td(a.category?.name)).filter(Boolean))] as string[]
  return (
    <>
      <PageHeader title={t('Fixed assets|menu')} description={t('Equipment, vehicles and furniture the company owns. Depreciation is recorded every month; each asset shows its schedule.')}
        actions={<Can perm="finance.write">
          <Button variant="outline" onClick={() => setRunOpen(true)}><CalendarClock /> {t('Run depreciation')}</Button>
          <Button variant="outline" asChild><Link to="/finance/asset-invoices"><Camera /> {t('From an invoice photo')}</Link></Button>
          <Button asChild><Link to="/finance/assets/new"><Plus /> {t('New asset')}</Link></Button>
        </Can>} />
      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        <StatCard label={t('Cost of assets in use (without VAT)')} value={formatMoney(cost)} loading={assets.isLoading} hint={tn(live.length, '{n} asset', '{n} assets')} />
        <StatCard label={t('Accumulated depreciation')} value={formatMoney(accum)} loading={assets.isLoading} hint={cost ? t('{pct}% written off', { pct: ((accum / cost) * 100).toFixed(0) }) : undefined} />
        <StatCard label={t('Net book value')} value={formatMoney(cost - accum)} loading={assets.isLoading} />
      </div>
      <DataTable tableKey="finance.assets" columns={cols} data={assets.data} isLoading={assets.isLoading} error={assets.error} getRowId={(r) => r.id} exportName={t('fixed-assets')}
        searchPlaceholder={t('Number, name, serial…')} onRowClick={(r) => navigate(`/finance/assets/${r.id}`)}
        facets={[
          { columnId: 'status', title: t('Status'), options: ['draft', 'active', 'fully_depreciated', 'disposed'].map((s) => ({ value: s, label: humanize(s) })) },
          { columnId: 'category', title: t('Category'), options: cats.map((c) => ({ value: c, label: c })) },
        ]}
        empty={{ title: t('No fixed assets yet'), description: t('Register a purchase as an asset to depreciate it over its useful life.') }} />
      <Dialog open={runOpen} onOpenChange={setRunOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>{t('Run depreciation')}</DialogTitle><DialogDescription>{t('Records every planned month up to the date below, one entry per month. Months already recorded are skipped.')}</DialogDescription></DialogHeader>
          <div className="grid gap-1.5"><Label htmlFor="dep-through">{t('Up to and including')}</Label><Input id="dep-through" type="date" value={through} onChange={(e) => setThrough(e.target.value)} /></div>
          <div className="flex items-start gap-3 rounded-lg border p-3">
            <Switch id="dep-auto" checked={auto.on} disabled={auto.loading || auto.set.isPending} onCheckedChange={(v) => auto.set.mutate(v)} />
            <Label htmlFor="dep-auto" className="grid gap-0.5 font-normal">
              <span className="font-medium">{t('Record it by itself every month')}</span>
              <span className="text-xs text-muted-foreground">{t('On the first day of each month the previous month is recorded, and finance gets a notification.')}</span>
            </Label>
          </div>
          <DialogFooter><Button variant="ghost" onClick={() => setRunOpen(false)}>{t('Cancel')}</Button>
            <Button loading={run.isPending} onClick={async () => {
              const r = await run.mutateAsync(through)
              toast.success(r.lines ? tn(r.months, 'Recorded {amount} for {n} month', 'Recorded {amount} for {n} months', { amount: formatMoney(r.amount) }) : t('Nothing to record. Depreciation is up to date.'))
              setRunOpen(false)
            }}>{t('Record depreciation')}</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

export function AssetPage() {
  const { id } = useParams()
  const a = useAsset(id)
  if (id && a.isLoading) return <Skeleton className="mx-auto h-96 max-w-5xl" />
  if (id && a.isError) return <ErrorState error={a.error} onRetry={() => void a.refetch()} />
  if (id && !a.data) return <EmptyState title={t('Asset not found')} action={<Button variant="outline" asChild><Link to="/finance/assets">{t('Back to fixed assets')}</Link></Button>} />
  return <AssetForm key={`${a.data?.id ?? 'new'}-${a.data?.status ?? ''}-${a.data?.accumulated_depreciation ?? ''}`} asset={a.data} />
}

type AssetDetail = NonNullable<ReturnType<typeof useAsset>['data']>

function AssetForm({ asset }: { asset?: AssetDetail }) {
  const navigate = useNavigate()
  const { can } = useCompany()
  const cats = useAssetCategories()
  const ccs = useCostCenters()
  const partners = usePartners()
  const save = useSaveAsset()
  const editable = (!asset || asset.status === 'draft') && can('finance.write')
  const [v, setV] = React.useState(() => ({
    name: asset?.name ?? '', category_id: asset?.category_id ?? null as string | null, acquisition_date: asset?.acquisition_date ?? todayISO(),
    in_service_date: asset?.in_service_date ?? todayISO(), acquisition_cost: asset ? String(asset.acquisition_cost) : '', salvage_value: asset ? String(asset.salvage_value) : '0',
    useful_life_months: asset ? String(asset.useful_life_months) : '', depreciation_method: asset?.depreciation_method ?? 'straight_line',
    declining_rate_pct: asset?.declining_rate_pct != null ? String(asset.declining_rate_pct) : '', cost_center_id: asset?.cost_center_id ?? null as string | null,
    vendor_id: asset?.vendor_id ?? null as string | null, serial_number: asset?.serial_number ?? '', location_note: asset?.location_note ?? '',
  }))
  const set = <K extends keyof typeof v>(k: K) => (x: (typeof v)[K]) => setV((s) => ({ ...s, [k]: x }))
  const [activateOpen, setActivateOpen] = React.useState(false)
  const [disposeOpen, setDisposeOpen] = React.useState(false)
  const pickCategory = (cid: string | null) => {
    const c = cats.data?.find((x) => x.id === cid)
    setV((s) => ({ ...s, category_id: cid, ...(c && !s.useful_life_months ? { useful_life_months: String(c.useful_life_months), depreciation_method: c.depreciation_method, declining_rate_pct: c.declining_rate_pct != null ? String(c.declining_rate_pct) : '' } : {}) }))
  }
  const valid = v.name.trim() && v.category_id && num(v.acquisition_cost) > 0 && num(v.useful_life_months) > 0 && num(v.salvage_value) < num(v.acquisition_cost) && v.in_service_date >= v.acquisition_date
  const persist = async () => save.mutateAsync({
    id: asset?.id, name: v.name.trim(), category_id: v.category_id, acquisition_date: v.acquisition_date, in_service_date: v.in_service_date,
    acquisition_cost: num(v.acquisition_cost), salvage_value: num(v.salvage_value), useful_life_months: Math.round(num(v.useful_life_months)),
    depreciation_method: v.depreciation_method, declining_rate_pct: v.depreciation_method === 'declining_balance' ? num(v.declining_rate_pct) || 20 : null,
    cost_center_id: v.cost_center_id, vendor_id: v.vendor_id, serial_number: v.serial_number || null, location_note: v.location_note || null,
  })
  const schedule = [...(asset?.schedule ?? [])].sort((x, y) => x.period_date.localeCompare(y.period_date))
  const monthly = num(v.useful_life_months) ? (num(v.acquisition_cost) - num(v.salvage_value)) / num(v.useful_life_months) : 0

  const details = (
    <Card>
      <CardContent className="grid gap-4 p-4 sm:grid-cols-3">
        <div className="grid gap-1.5 sm:col-span-2"><Label htmlFor="as-name">{t('Name')}</Label><Input id="as-name" value={v.name} disabled={!editable} onChange={(e) => set('name')(e.target.value)} placeholder={t('e.g. Delivery van Fiat Ducato')} /></div>
        <div className="grid gap-1.5"><Label>{t('Category')}</Label>
          <Select value={v.category_id ?? ''} onValueChange={pickCategory} disabled={!editable}><SelectTrigger><SelectValue placeholder={t('Choose')} /></SelectTrigger>
            <SelectContent>{(cats.data ?? []).map((c) => <SelectItem key={c.id} value={c.id}>{td(c.name)}</SelectItem>)}</SelectContent></Select></div>
        <div className="grid gap-1.5"><Label htmlFor="as-acq">{t('Bought on')}</Label><Input id="as-acq" type="date" value={v.acquisition_date} disabled={!editable} onChange={(e) => set('acquisition_date')(e.target.value)} /></div>
        <div className="grid gap-1.5"><Label htmlFor="as-svc">{t('In service from')}</Label><Input id="as-svc" type="date" value={v.in_service_date} disabled={!editable} onChange={(e) => set('in_service_date')(e.target.value)} /></div>
        <div className="grid gap-1.5"><Label>{t('Vendor')}</Label><SearchSelect value={v.vendor_id} onChange={set('vendor_id')} disabled={!editable} clearable placeholder={t('Optional')}
          options={(partners.data ?? []).filter((p) => p.is_vendor).map((p) => ({ value: p.id, label: p.name, hint: p.code }))} /></div>
        <div className="grid gap-1.5"><Label htmlFor="as-cost">{t('Cost (without VAT)')}</Label><Input id="as-cost" type="number" step="any" className="text-right tabular" value={v.acquisition_cost} disabled={!editable} onChange={(e) => set('acquisition_cost')(e.target.value)} /></div>
        <div className="grid gap-1.5"><Label htmlFor="as-salv">{t('Residual value')}</Label><Input id="as-salv" type="number" step="any" className="text-right tabular" value={v.salvage_value} disabled={!editable} onChange={(e) => set('salvage_value')(e.target.value)} /></div>
        <div className="grid gap-1.5"><Label htmlFor="as-life">{t('Useful life (months)')}</Label><Input id="as-life" type="number" className="text-right tabular" value={v.useful_life_months} disabled={!editable} onChange={(e) => set('useful_life_months')(e.target.value)} /></div>
        <div className="grid gap-1.5"><Label>{t('Method')}</Label>
          <Select value={v.depreciation_method} onValueChange={set('depreciation_method')} disabled={!editable}><SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="straight_line">{t('Straight line')}</SelectItem><SelectItem value="declining_balance">{t('Declining balance')}</SelectItem></SelectContent></Select></div>
        {v.depreciation_method === 'declining_balance'
          ? <div className="grid gap-1.5"><Label htmlFor="as-rate">{t('Annual rate %')}</Label><Input id="as-rate" type="number" step="any" className="text-right tabular" value={v.declining_rate_pct} disabled={!editable} onChange={(e) => set('declining_rate_pct')(e.target.value)} placeholder="20" /></div>
          : <div className="grid gap-1.5"><Label>{t('Per month')}</Label><div className="flex h-9 items-center justify-end rounded-md border bg-muted/40 px-3 tabular text-[13px]">{formatMoney(monthly)}</div></div>}
        <div className="grid gap-1.5"><Label>{t('Cost center')}</Label><SearchSelect value={v.cost_center_id} onChange={set('cost_center_id')} disabled={!editable} clearable placeholder={t('Optional')}
          options={(ccs.data ?? []).map((c) => ({ value: c.id, label: `${c.code} ${c.name}` }))} /></div>
        <div className="grid gap-1.5"><Label htmlFor="as-serial">{t('Serial number')}</Label><Input id="as-serial" value={v.serial_number} disabled={!editable} onChange={(e) => set('serial_number')(e.target.value)} /></div>
        <div className="grid gap-1.5 sm:col-span-2"><Label htmlFor="as-loc">{t('Location')}</Label><Input id="as-loc" value={v.location_note} disabled={!editable} onChange={(e) => set('location_note')(e.target.value)} /></div>
      </CardContent>
    </Card>
  )

  return (
    <div className="w-full">
      <PageHeader back={{ href: '/finance/assets', label: t('Fixed assets') }} title={asset ? `${asset.number} · ${asset.name}` : t('New fixed asset')}
        meta={asset && <StatusBadge status={asset.status} />}
        description={asset && asset.status !== 'draft' ? t('Book value {value} of {cost}', { value: formatMoney(asset.book_value), cost: formatMoney(asset.acquisition_cost) }) : undefined}
        actions={<Can perm="finance.write">
          {asset && editable && <ConfirmDialog trigger={<Button variant="ghost" className="text-destructive"><Trash2 /> {t('Delete')}</Button>} title={t('Delete {doc}?', { doc: asset.number })} description={t('The draft asset is removed.')} confirmLabel={t('Delete')} destructive
            onConfirm={async () => { const { error } = await supabase.from('fixed_assets').delete().eq('id', asset.id); if (error) throw error; navigate('/finance/assets') }} />}
          {editable && <Button variant={asset ? 'outline' : 'default'} loading={save.isPending} disabled={!valid} onClick={async () => { const id = await persist(); toast.success(t('Asset saved')); if (!asset) navigate(`/finance/assets/${id}`, { replace: true }) }}>{t('Save')}</Button>}
          {asset && editable && <Button disabled={!valid} onClick={async () => { await persist(); setActivateOpen(true) }}>{t('Put in service')}</Button>}
          {asset && (asset.status === 'active' || asset.status === 'fully_depreciated') && <Button variant="outline" onClick={() => setDisposeOpen(true)}>{t('Sell or scrap')}</Button>}
        </Can>} />
      {asset && asset.status !== 'draft' ? (
        <Tabs defaultValue="schedule">
          <TabsList><TabsTrigger value="schedule">{t('Depreciation')}</TabsTrigger><TabsTrigger value="details">{t('Details')}</TabsTrigger><TabsTrigger value="accounting">{t('Accounting')}</TabsTrigger></TabsList>
          <TabsContent value="schedule">
            <div className="mb-4 grid gap-3 sm:grid-cols-4">
              <StatCard label={t('Cost (without VAT)')} value={formatMoney(asset.acquisition_cost)} />
              <StatCard label={t('Depreciated')} value={formatMoney(asset.accumulated_depreciation)} hint={t('{done} of {total} months recorded', { done: schedule.filter((s) => s.status === 'posted').length, total: schedule.length })} />
              <StatCard label={t('Book value')} value={formatMoney(asset.book_value)} />
              <StatCard label={asset.status === 'disposed' ? t('Disposed') : t('Ends')} value={asset.status === 'disposed' ? formatDate(asset.disposal_date) : formatDate(schedule.at(-1)?.period_date)}
                hint={asset.status === 'disposed' ? t('Proceeds {amount}, without VAT', { amount: formatMoney(asset.disposal_amount) }) : humanize(asset.depreciation_method)} />
            </div>
            <Card>
              <CardHeader className="py-3"><CardTitle>{t('Schedule')}</CardTitle></CardHeader>
              <CardContent className="max-h-[480px] overflow-auto p-0">
                <Table>
                  <TableHeader className="sticky top-0 bg-card"><TableRow className="hover:bg-transparent"><TableHead>{t('Month')}</TableHead><TableHead className="text-right">{t('Depreciation')}</TableHead><TableHead className="text-right">{t('Accumulated')}</TableHead><TableHead className="text-right">{t('Book value')}</TableHead><TableHead>{t('Status')}</TableHead></TableRow></TableHeader>
                  <TableBody>
                    {schedule.map((s) => (
                      <TableRow key={s.id} className={cn('hover:bg-transparent', s.status === 'planned' && 'text-muted-foreground')}>
                        <TableCell className="text-[13px]">{formatMonth(s.period_date)}</TableCell>
                        <TableCell className="text-right tabular">{formatMoney(s.amount)}</TableCell>
                        <TableCell className="text-right tabular">{formatMoney(s.accumulated_after)}</TableCell>
                        <TableCell className="text-right tabular">{formatMoney(num(asset.acquisition_cost) - num(s.accumulated_after))}</TableCell>
                        <TableCell>{s.journal_entry_id ? <Link to={`/finance/journal/${s.journal_entry_id}`} className="text-[13px] text-primary hover:underline">{humanize('posted')}</Link> : <StatusBadge status={s.status} />}</TableCell>
                      </TableRow>
                    ))}
                    {!schedule.length && <TableRow><TableCell colSpan={5} className="py-6 text-center text-[13px] text-muted-foreground">{t('No depreciation left to plan.')}</TableCell></TableRow>}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>
          <TabsContent value="details">{details}</TabsContent>
          <TabsContent value="accounting"><AccountingTab sourceType="fixed_asset" sourceId={asset.id} emptyHint={t('This asset was put in service without a purchase entry (it was bought through a vendor bill). Depreciation entries are listed on the schedule.')} /></TabsContent>
        </Tabs>
      ) : details}
      {asset && <ActivateDialog open={activateOpen} onOpenChange={setActivateOpen} assetId={asset.id} hasBill={!!asset.vendor_bill_id} />}
      {asset && <DisposeDialog open={disposeOpen} onOpenChange={setDisposeOpen} asset={asset} />}
    </div>
  )
}

function ActivateDialog({ open, onOpenChange, assetId, hasBill }: { open: boolean; onOpenChange: (o: boolean) => void; assetId: string; hasBill: boolean }) {
  const accounts = useAccounts()
  const activate = useActivateAsset()
  const [mode, setMode] = React.useState<'post' | 'none'>(hasBill ? 'none' : 'post')
  const [counter, setCounter] = React.useState<string | null>(null)
  React.useEffect(() => { if (!counter && accounts.data) setCounter(accounts.data.find((a) => a.code === '401')?.id ?? null) }, [accounts.data]) // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>{t('Put the asset in service')}</DialogTitle><DialogDescription>{t('The depreciation schedule starts from the in-service month. Choose how the purchase is recorded in the accounts.')}</DialogDescription></DialogHeader>
        <div className="grid gap-2">
          {([['post', msg('Record the purchase now'), msg('Debit the asset account and credit a vendor, bank or opening balance account.')],
             ['none', msg('Already in the accounts'), msg('The vendor bill was recorded to the asset account, or the asset is in the opening balances.')]] as const).map(([k, label, d]) => (
            <label key={k} className={cn('flex cursor-pointer gap-3 rounded-md border p-3 text-[13px]', mode === k && 'border-primary bg-primary/5')}>
              <input type="radio" name="activate-mode" className="mt-0.5 accent-[hsl(var(--primary))]" checked={mode === k} onChange={() => setMode(k)} />
              <span><span className="font-medium">{t(label)}</span><span className="block text-muted-foreground">{t(d)}</span></span>
            </label>
          ))}
          {mode === 'post' && <div className="grid gap-1.5"><Label>{t('Credit account')}</Label>
            <SearchSelect value={counter} onChange={setCounter} options={(accounts.data ?? []).filter((a) => a.is_postable).map((a) => ({ value: a.id, label: `${a.code} ${td(a.name)}`, keywords: [a.name] }))} /></div>}
        </div>
        <DialogFooter><Button variant="ghost" onClick={() => onOpenChange(false)}>{t('Cancel')}</Button>
          <Button loading={activate.isPending} disabled={mode === 'post' && !counter} onClick={async () => { await activate.mutateAsync({ id: assetId, counter: mode === 'post' ? counter : null }); toast.success(t('Asset in service')); onOpenChange(false) }}>{t('Put in service')}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function DisposeDialog({ open, onOpenChange, asset }: { open: boolean; onOpenChange: (o: boolean) => void; asset: AssetDetail }) {
  const banks = useBankAccounts()
  const accounts = useAccounts()
  const dispose = useDisposeAsset()
  const [date, setDate] = React.useState(todayISO())
  const [proceeds, setProceeds] = React.useState('0')
  const [account, setAccount] = React.useState<string | null>(null)
  React.useEffect(() => { if (!account && banks.data?.length) setAccount(banks.data[0]!.account_id) }, [banks.data]) // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>{t('Sell or scrap {name}', { name: asset.name })}</DialogTitle>
          <DialogDescription>{t('Depreciation is brought up to the date, then the cost and accumulated depreciation are removed and the gain or loss is recorded.')}</DialogDescription></DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          <div className="grid gap-1.5"><Label htmlFor="ds-date">{t('Date')}</Label><Input id="ds-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></div>
          <div className="grid gap-1.5"><Label htmlFor="ds-amt">{t('Sale amount without VAT (0 if scrapped)')}</Label><Input id="ds-amt" type="number" step="any" className="text-right tabular" value={proceeds} onChange={(e) => setProceeds(e.target.value)} /></div>
          {num(proceeds) > 0 && <div className="col-span-2 grid gap-1.5"><Label>{t('Received into')}</Label>
            <SearchSelect value={account} onChange={setAccount} options={(accounts.data ?? []).filter((a) => a.is_postable).map((a) => ({ value: a.id, label: `${a.code} ${td(a.name)}`, keywords: [a.name] }))} /></div>}
        </div>
        <p className="text-[13px] text-muted-foreground">{num(proceeds) - num(asset.book_value) >= 0
          ? t("Current book value {value}. Selling for {price} gives an estimated gain of about {diff} before this month's depreciation.", { value: formatMoney(asset.book_value), price: formatMoney(num(proceeds)), diff: formatMoney(Math.abs(num(proceeds) - num(asset.book_value))) })
          : t("Current book value {value}. Selling for {price} gives an estimated loss of about {diff} before this month's depreciation.", { value: formatMoney(asset.book_value), price: formatMoney(num(proceeds)), diff: formatMoney(Math.abs(num(proceeds) - num(asset.book_value))) })}</p>
        <DialogFooter><Button variant="ghost" onClick={() => onOpenChange(false)}>{t('Cancel')}</Button>
          <Button variant="destructive" loading={dispose.isPending} disabled={num(proceeds) > 0 && !account} onClick={async () => {
            const r = await dispose.mutateAsync({ id: asset.id, date, proceeds: num(proceeds), account: num(proceeds) > 0 ? account : null })
            toast.success(r.gain >= 0 ? t('Disposed with a gain of {amount}', { amount: formatMoney(r.gain) }) : t('Disposed with a loss of {amount}', { amount: formatMoney(-r.gain) })); onOpenChange(false)
          }}>{t('Dispose')}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
