import { ArrowLeftRight, ClipboardCheck, ScanSearch, Hourglass, PackageCheck, PackageOpen, ShoppingBasket, Truck, type LucideIcon } from 'lucide-react'
import * as React from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Can } from '@/app/company-provider'
import { PageHeader } from '@/components/page-header'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { ErrorState } from '@/components/error-state'
import { t, td, tn, tr } from '@/i18n'
import { cn, formatQty } from '@/lib/utils'
import { useLocations, useWarehouses } from '@/features/inventory/api'
import { useCreatePutaway, useWmsOverview } from '../api'

const WH_KEY = 'drispro.wms.warehouse'

export function WmsHomePage() {
  const navigate = useNavigate()
  const warehouses = useWarehouses()
  const locations = useLocations()
  const [wh, setWh] = React.useState<string | null>(() => { try { return localStorage.getItem(WH_KEY) } catch { return null } })
  const ov = useWmsOverview(wh)
  const sweep = useCreatePutaway()
  const d = ov.data
  const pickTotal = (d?.to_pick ?? 0) + (d?.picking ?? 0)
  const tiles: { key: string; href: string; title: string; icon: LucideIcon; count?: number; hint: string; tone?: 'warn' | 'bad' }[] = [
    { key: '1', href: '/wms/receive', title: t('Receive goods'), icon: PackageCheck, count: d?.receipts_open, hint: t('Scan goods in against open receipts') },
    { key: '2', href: '/wms/putaway', title: t('Put away'), icon: PackageOpen, count: d?.putaway_lines, hint: t('Move received goods to their shelves') },
    { key: '3', href: '/wms/picking', title: t('Pick'), icon: ShoppingBasket, count: pickTotal, hint: d?.picking ? tn(d.picking, '{n} pick list in progress', '{n} pick lists in progress') : t('Make pick lists for deliveries') },
    { key: '4', href: '/wms/shipping', title: t('Ship'), icon: Truck, count: d?.to_ship, hint: t('{n} shipped today', { n: d?.shipped_today ?? 0 }) },
    { key: '5', href: '/wms/move', title: t('Move'), icon: ArrowLeftRight, hint: t('Shelf to shelf, or to another warehouse') },
    { key: '6', href: '/wms/counts', title: t('Stock count|tile'), icon: ClipboardCheck, count: d?.counts_open, hint: t('Count stock by shelf or category') },
    { key: '7', href: '/wms/lots', title: t('Lots and expiry'), icon: Hourglass, count: (d?.expired ?? 0) + (d?.expiring_30 ?? 0),
      hint: d?.expired ? tn(d.expired, '{n} expired lot still in stock', '{n} expired lots still in stock') : t('{n} expiring within 30 days', { n: d?.expiring_30 ?? 0 }), tone: d?.expired ? 'bad' : d?.expiring_30 ? 'warn' : undefined },
    { key: '8', href: '/inventory/check', title: t('Check item'), icon: ScanSearch, hint: t('How much every store has, and where to take it from') },
  ]
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement
      if (e.metaKey || e.ctrlKey || e.altKey || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName) || document.querySelector('[role=dialog]')) return
      const href = ['/wms/receive', '/wms/putaway', '/wms/picking', '/wms/shipping', '/wms/move', '/wms/counts', '/wms/lots', '/inventory/check'][Number(e.key) - 1]
      if (href) { e.preventDefault(); navigate(href) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [navigate])
  const receiving = (locations.data ?? []).filter((l) => l.location_type === 'receiving' && (!wh || l.warehouse_id === wh))

  return (
    <>
      <PageHeader title={t('Warehouse floor')} description={t('Scanning screens for the warehouse. Keys 1–8 open a screen; each works with a scanner, a phone camera or the keyboard.')}
        actions={<Select value={wh ?? 'all'} onValueChange={(v) => { const x = v === 'all' ? null : v; setWh(x); try { if (x) localStorage.setItem(WH_KEY, x); else localStorage.removeItem(WH_KEY) } catch { /* ignore */ } }}>
          <SelectTrigger className="w-[220px]" aria-label={t('Warehouse')}><SelectValue /></SelectTrigger>
          <SelectContent><SelectItem value="all">{t('All warehouses')}</SelectItem>{(warehouses.data ?? []).map((w) => <SelectItem key={w.id} value={w.id}>{td(w.name)}</SelectItem>)}</SelectContent>
        </Select>} />
      {ov.isError && <ErrorState compact error={ov.error} onRetry={() => void ov.refetch()} />}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {tiles.map((t) => (
          <Link key={t.href} to={t.href} className="group flex min-h-[132px] flex-col justify-between rounded-xl border bg-card p-4 transition-colors hover:border-primary/50 focus-visible:ring-2 focus-visible:ring-ring">
            <div className="flex items-start justify-between">
              <t.icon className="size-6 text-primary" />
              {ov.isLoading ? <Skeleton className="h-7 w-10" /> : t.count != null && (
                <span className={cn('rounded-md px-2 py-0.5 text-lg font-semibold tabular', t.count ? 'bg-primary/10 text-primary' : 'text-muted-foreground/60',
                  t.tone === 'warn' && t.count && 'bg-warning/15 text-warning', t.tone === 'bad' && 'bg-destructive/10 text-destructive')}>{t.count}</span>
              )}
            </div>
            <div>
              <div className="flex items-baseline gap-2"><span className="text-lg font-semibold">{t.title}</span><kbd className="rounded border px-1 text-[11px] text-muted-foreground">{t.key}</kbd></div>
              <div className="text-[13px] text-muted-foreground">{t.hint}</div>
            </div>
          </Link>
        ))}
      </div>
      {(d?.in_receiving ?? 0) > 0 && (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-warning/40 bg-warning/5 p-4">
          <div><div className="font-medium">{t('{n} units are waiting in the receiving area', { n: formatQty(d!.in_receiving) })}</div>
            <div className="text-[13px] text-muted-foreground">{t('They cannot be picked until they are put away on a shelf.')}</div></div>
          <Can perm="wms.write">
            <div className="flex flex-wrap gap-2">
              {receiving.map((l) => (
                <Button key={l.id} variant="outline" loading={sweep.isPending} onClick={async () => {
                  try { const id = await sweep.mutateAsync(l.id); navigate(`/wms/tasks/${id}`) } catch { /* toast */ }
                }}>{t('Put away {location}', { location: l.code })}</Button>
              ))}
            </div>
          </Can>
        </div>
      )}
      <p className="mt-6 text-[13px] text-muted-foreground">
        {tr('Office views stay where they were: {receipts}, {deliveries}, {transfers} and {stock}.', {
          receipts: <Link className="text-primary hover:underline" to="/inventory/receipts">{t('goods receipts')}</Link>,
          deliveries: <Link className="text-primary hover:underline" to="/sales/deliveries">{t('deliveries')}</Link>,
          transfers: <Link className="text-primary hover:underline" to="/inventory/transfers">{t('transfers')}</Link>,
          stock: <Link className="text-primary hover:underline" to="/inventory/stock">{t('stock levels')}</Link>,
        })}
      </p>
    </>
  )
}
