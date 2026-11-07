import { ArrowLeft, ArrowLeftRight, ClipboardCheck, Download, Hourglass, Monitor, PackageCheck, PackageOpen, ScanSearch, ShoppingBasket, Tag, Trash2, Truck, type LucideIcon } from 'lucide-react'
import * as React from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { useCompany } from '@/app/company-provider'
import { NotificationsButton } from '@/components/layout/notifications'
import { UserMenu } from '@/components/layout/user-menu'
import { useInstallApp } from '@/components/pwa-prompts'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { msg, t, td } from '@/i18n'
import { cn } from '@/lib/utils'
import { useMyWarehouseAccess, useWarehouses } from '@/features/inventory/api'
import { useWmsOverview } from '@/features/wms/api'
import { setScannerMode } from './mode'

/** the unit this handheld works in, shared by the scanner screens */
export const UNIT_KEYS = ['drispro.check.unit', 'drispro.wms.warehouse']
export function scannerUnit(): string | null { try { return localStorage.getItem(UNIT_KEYS[0]!) } catch { return null } }
function setScannerUnit(id: string | null) {
  try { UNIT_KEYS.forEach((k) => (id ? localStorage.setItem(k, id) : localStorage.removeItem(k))) } catch { /* private window */ }
}

/** The top bar on the handheld: one large way back to the start, the person's menu */
export function ScannerTopbar() {
  const { pathname } = useLocation()
  const { company } = useCompany()
  const home = pathname === '/skaner'
  return (
    <header className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b bg-background/95 px-2.5 backdrop-blur print:hidden">
      {home ? (
        <div className="flex min-w-0 items-center gap-2">
          <img src="/skaner-192.png" alt="" className="size-8 rounded-lg" />
          <span className="min-w-0"><span className="block truncate text-[15px] font-semibold leading-tight">{t('Scanner')}</span>
            <span className="block truncate text-[11px] text-muted-foreground">{company?.name}</span></span>
        </div>
      ) : (
        <Button asChild size="lg" variant="outline" className="h-11 gap-1.5 rounded-xl px-3 text-base">
          <Link to="/skaner"><ArrowLeft className="size-5" /> {t('Start')}</Link>
        </Button>
      )}
      <div className="ml-auto flex items-center gap-1">
        <NotificationsButton />
        <UserMenu />
      </div>
    </header>
  )
}

type Tile = { href: string; title: string; hint: string; icon: LucideIcon; perm: string; count?: (o: Record<string, number>) => number; tone?: string }
const TILES: Tile[] = [
  { href: '/inventory/check', title: msg('Check item'), hint: msg('How much every unit has'), icon: ScanSearch, perm: 'inventory.read', tone: 'hsl(152 68% 36%)' },
  { href: '/skaner/price', title: msg('Price|scanner'), hint: msg('See it, change it'), icon: Tag, perm: 'inventory.read', tone: 'hsl(330 70% 48%)' },
  { href: '/wms/receive', title: msg('Receive goods'), hint: msg('Scan goods in'), icon: PackageCheck, perm: 'wms.read', count: (o) => o.receipts_open ?? 0, tone: 'hsl(204 82% 44%)' },
  { href: '/wms/putaway', title: msg('Put away'), hint: msg('To their shelves'), icon: PackageOpen, perm: 'wms.read', count: (o) => o.putaway_lines ?? 0, tone: 'hsl(262 60% 52%)' },
  { href: '/wms/picking', title: msg('Pick'), hint: msg('For deliveries'), icon: ShoppingBasket, perm: 'wms.read', count: (o) => (o.to_pick ?? 0) + (o.picking ?? 0), tone: 'hsl(32 90% 42%)' },
  { href: '/wms/shipping', title: msg('Ship'), hint: msg('Out of the door'), icon: Truck, perm: 'wms.read', count: (o) => o.to_ship ?? 0, tone: 'hsl(188 78% 36%)' },
  { href: '/wms/move', title: msg('Move'), hint: msg('Shelf to shelf'), icon: ArrowLeftRight, perm: 'wms.read', tone: 'hsl(210 18% 44%)' },
  { href: '/wms/counts', title: msg('Stock count|tile'), hint: msg('By shelf or by class'), icon: ClipboardCheck, perm: 'wms.read', count: (o) => o.counts_open ?? 0, tone: 'hsl(172 72% 30%)' },
  { href: '/wms/lots', title: msg('Lots and expiry'), hint: msg('What expires soon'), icon: Hourglass, perm: 'inventory.read', count: (o) => (o.expired ?? 0) + (o.expiring_30 ?? 0), tone: 'hsl(350 70% 48%)' },
  { href: '/wms/waste', title: msg('Thrown away|scanner'), hint: msg('Fruit, vegetables, bread: scan, weigh, send'), icon: Trash2, perm: 'wms.read', tone: 'hsl(24 80% 44%)' },
]

/** DrisPRO Skaner: the start screen of the handheld app */
export function ScannerHome() {
  const { can } = useCompany()
  const navigate = useNavigate()
  const warehouses = useWarehouses()
  const access = useMyWarehouseAccess()
  const units = (warehouses.data ?? []).filter((w) => w.is_active && w.warehouse_type !== 'transit')
  const [unit, setUnit] = React.useState<string | null>(scannerUnit)
  const ov = useWmsOverview(unit)
  const install = useInstallApp()
  React.useEffect(() => { setScannerMode(true) }, [])
  React.useEffect(() => { if (!unit && access.data?.length === 1) { setUnit(access.data[0]!); setScannerUnit(access.data[0]!) } }, [unit, access.data])
  const tiles = TILES.filter((x) => can(x.perm))
  // keys 1–9 open a tile (handhelds with a keypad)
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement
      if (e.metaKey || e.ctrlKey || e.altKey || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName) || document.querySelector('[role=dialog]')) return
      const x = tiles[Number(e.key) - 1]
      if (x) { e.preventDefault(); navigate(x.href) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [navigate, tiles])
  const o = (ov.data ?? {}) as unknown as Record<string, number>

  return (
    <div className="mx-auto grid max-w-xl gap-3">
      <Select value={unit ?? 'all'} onValueChange={(v) => { const x = v === 'all' ? null : v; setUnit(x); setScannerUnit(x) }}>
        <SelectTrigger className="h-12 text-base" aria-label={t('My unit')}><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value="all">{t('All units')}</SelectItem>
          {units.map((w) => <SelectItem key={w.id} value={w.id}>{t('My unit: {name}', { name: td(w.name) })}</SelectItem>)}
        </SelectContent>
      </Select>

      <div className="grid grid-cols-2 gap-2.5">
        {tiles.map((x, i) => {
          const n = x.count?.(o) ?? 0
          return (
            <Link key={x.href} to={x.href}
              className="relative grid min-h-[112px] content-between gap-2 rounded-2xl border bg-card p-3.5 transition-colors active:scale-[0.99] hover:border-primary/50 focus-visible:ring-2 focus-visible:ring-ring">
              <span className="flex items-start justify-between">
                <span className="grid size-11 place-items-center rounded-xl" style={{ background: `color-mix(in srgb, ${x.tone} 12%, transparent)` }}><x.icon className="size-6" style={{ color: x.tone }} /></span>
                {n > 0 ? <span className="rounded-full bg-primary px-2 py-0.5 text-xs font-semibold tabular text-primary-foreground">{n}</span>
                  : <span className="font-mono text-xs text-muted-foreground">{i + 1}</span>}
              </span>
              <span><span className="block text-[15px] font-semibold leading-tight">{t(x.title)}</span>
                <span className="block text-xs text-muted-foreground">{t(x.hint)}</span></span>
            </Link>
          )
        })}
      </div>
      {!tiles.length && <p className="rounded-lg border p-4 text-[13px] text-muted-foreground">{t('Your role has no scanner screens. Ask the administrator for the warehouse role.')}</p>}

      {install.canInstall && (
        <Button variant="outline" className="h-12" onClick={() => void install.install()}><Download /> {t('Install DrisPRO Skaner on this device')}</Button>
      )}
      <Button variant="ghost" className={cn('h-11 text-muted-foreground')} onClick={() => { setScannerMode(false); navigate('/') }}>
        <Monitor /> {t('Open the full program')}
      </Button>
    </div>
  )
}
