import { ArrowLeft, Check, CheckCheck, ChefHat, Maximize, Printer } from 'lucide-react'
import * as React from 'react'
import { Link, Navigate, useParams, useSearchParams } from 'react-router-dom'
import { useAuth } from '@/app/auth-provider'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { formatDateWith, t, tn } from '@/i18n'
import { printHtml } from '@/lib/print'
import { cn, num } from '@/lib/utils'
import { type KitchenOrder, useKitchen, useSetLineStatus, useStations } from './api'

const minutes = (iso: string | null) => (iso ? Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 60000)) : 0)

/** The screen in the kitchen or at the bar: what to prepare, oldest first. Tap an item when it is ready. */
export function KitchenPage() {
  const { warehouseId } = useParams()
  const { user, loading } = useAuth()
  const [params, setParams] = useSearchParams()
  const station = params.get('station')
  const stations = useStations(warehouseId)
  const kitchen = useKitchen(warehouseId, station)
  const setStatus = useSetLineStatus()
  const [, tick] = React.useReducer((x: number) => x + 1, 0)
  React.useEffect(() => { const i = setInterval(tick, 20_000); return () => clearInterval(i) }, [])
  // a short sound when a new order arrives
  const seen = React.useRef<Set<string> | null>(null)
  const [autoPrint, setAutoPrint] = React.useState(() => pref('kitchen.print') === '1')
  const stationName = (stations.data ?? []).find((s) => s.id === station)?.name ?? t('Kitchen')
  React.useEffect(() => {
    const orders = kitchen.data ?? []
    const ids = new Set(orders.flatMap((o) => o.lines.map((l) => l.id)))
    if (seen.current && [...ids].some((id) => !seen.current!.has(id))) beep()
    // the printer next to this screen prints each new item once (what was there before printing was switched on is not printed)
    if (autoPrint && seen.current) {
      const printed = printedSet()
      const fresh = orders.map((o) => ({ ...o, lines: o.lines.filter((l) => l.status === 'sent' && !printed.has(l.id) && !seen.current!.has(l.id)) })).filter((o) => o.lines.length)
      if (fresh.length) {
        printTickets(fresh, stationName)
        fresh.forEach((o) => o.lines.forEach((l) => printed.add(l.id)))
        savePrinted(printed)
      }
    }
    seen.current = ids
  }, [kitchen.data]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!loading && !user) return <Navigate to="/login" replace state={{ from: `/pos/kitchen/${warehouseId}` }} />
  const orders = kitchen.data ?? []
  const waiting = orders.reduce((s, o) => s + o.lines.filter((l) => l.status === 'sent').length, 0)

  return (
    <div className="flex min-h-dvh flex-col bg-muted/40">
      <header className="flex min-h-14 shrink-0 flex-wrap items-center gap-x-3 gap-y-2 border-b bg-card px-3 py-2">
        <Button variant="ghost" size="icon" asChild aria-label={t('Back')}><Link to="/pos"><ArrowLeft /></Link></Button>
        <ChefHat className="size-5 text-primary max-sm:hidden" />
        <span className="min-w-0"><span className="block whitespace-nowrap text-sm font-semibold sm:inline">{t('Kitchen screen')}</span>
        <span className="whitespace-nowrap text-[13px] text-muted-foreground sm:ml-3">{tn(waiting, '{n} item to prepare', '{n} items to prepare')}</span></span>
        <nav className="ml-4 flex gap-1 overflow-x-auto max-sm:order-last max-sm:ml-0 max-sm:w-full" aria-label={t('Station')}>
          {[{ id: null as string | null, name: t('All') }, ...(stations.data ?? [])].map((s) => (
            <button key={s.id ?? 'all'} type="button" onClick={() => setParams(s.id ? { station: s.id } : {})}
              className={cn('h-9 shrink-0 rounded-full px-4 text-[13px] font-medium', station === s.id ? 'bg-primary text-primary-foreground' : 'hover:bg-muted')}>{s.name}</button>
          ))}
        </nav>
        <Button variant={autoPrint ? 'default' : 'ghost'} size="sm" className="ml-auto" aria-pressed={autoPrint}
          title={t('Each new order is printed once on this computer\u2019s printer. For printing without the print window, start Chrome with --kiosk-printing.')}
          onClick={() => setAutoPrint((on) => { setPref('kitchen.print', on ? '0' : '1'); return !on })}><Printer /> <span className="max-sm:sr-only">{autoPrint ? t('Printing new orders') : t('Print new orders')}</span></Button>
        <Button variant="ghost" size="sm" className="max-sm:hidden" onClick={() => void document.documentElement.requestFullscreen?.().catch(() => undefined)}><Maximize /> {t('Full screen')}</Button>
      </header>
      {kitchen.isLoading ? (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-3 p-4">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-52" />)}</div>
      ) : !orders.length ? (
        <div className="grid flex-1 place-items-center p-8 text-center">
          <div><CheckCheck className="mx-auto size-10 text-success" /><p className="mt-3 text-lg font-semibold">{t('Nothing to prepare')}</p>
            <p className="text-[13px] text-muted-foreground">{t('New orders appear here as soon as a waiter sends them.')}</p></div>
        </div>
      ) : (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] content-start gap-3 p-3 sm:p-4">
          {orders.map((o) => <Ticket key={o.id} o={o} onLines={(ids, status) => setStatus.mutate({ lines: ids, status })} />)}
        </div>
      )}
    </div>
  )
}

function Ticket({ o, onLines }: { o: KitchenOrder; onLines: (ids: string[], status: 'sent' | 'ready' | 'served') => void }) {
  const m = minutes(o.first_sent_at)
  const allReady = o.lines.every((l) => l.status === 'ready')
  return (
    <article className={cn('flex flex-col overflow-hidden rounded-xl border-2 bg-card shadow-sm', allReady ? 'border-success/60' : m >= 20 ? 'border-destructive/70' : m >= 10 ? 'border-warning/70' : 'border-border')}>
      <header className={cn('flex items-baseline justify-between gap-2 px-3 py-2', allReady ? 'bg-success/10' : m >= 20 ? 'bg-destructive/10' : m >= 10 ? 'bg-warning/10' : 'bg-muted/50')}>
        <span className="text-xl font-bold tracking-[-0.01em]">{o.table ? t('Table {name}', { name: o.table }) : o.label || o.number}</span>
        <span className={cn('text-sm font-semibold tabular', m >= 20 ? 'text-destructive' : m >= 10 ? 'text-warning' : 'text-muted-foreground')}>{t('{m} min', { m })}</span>
      </header>
      <div className="px-3 pb-1 pt-1 text-xs text-muted-foreground">{o.waiter}</div>
      <ul className="flex-1">
        {o.lines.map((l) => (
          <li key={l.id}>
            <button type="button" onClick={() => onLines([l.id], l.status === 'ready' ? 'sent' : 'ready')}
              className={cn('flex w-full items-start gap-2 border-t px-3 py-2 text-left', l.status === 'ready' && 'bg-success/5 text-muted-foreground')}>
              <span className={cn('mt-0.5 grid size-5 shrink-0 place-items-center rounded border', l.status === 'ready' ? 'border-success bg-success text-white' : 'border-input')}>
                {l.status === 'ready' && <Check className="size-3.5" />}</span>
              <span className="min-w-0 flex-1">
                <span className={cn('block text-base font-semibold leading-tight', l.status === 'ready' && 'line-through')}>{num(l.quantity)} × {l.name}</span>
                {l.note && <span className="mt-0.5 block text-sm font-medium text-primary">» {l.note}</span>}
              </span>
            </button>
          </li>
        ))}
      </ul>
      <div className="border-t p-2">
        {allReady
          ? <Button className="w-full" variant="secondary" onClick={() => onLines(o.lines.map((l) => l.id), 'served')}><CheckCheck /> {t('Picked up')}</Button>
          : <Button className="w-full" onClick={() => onLines(o.lines.filter((l) => l.status === 'sent').map((l) => l.id), 'ready')}><Check /> {t('All ready')}</Button>}
      </div>
    </article>
  )
}

function beep() {
  try {
    const ctx = new AudioContext()
    const osc = ctx.createOscillator(); const gain = ctx.createGain()
    osc.frequency.value = 880; gain.gain.value = 0.08
    osc.connect(gain); gain.connect(ctx.destination)
    osc.start(); osc.stop(ctx.currentTime + 0.18)
  } catch { /* no sound */ }
}

const pref = (k: string) => { try { return localStorage.getItem(k) } catch { return null } }
const setPref = (k: string, v: string) => { try { localStorage.setItem(k, v) } catch { /* ignore */ } }
const PRINTED = 'kitchen.printed'
function printedSet() { try { return new Set<string>(JSON.parse(localStorage.getItem(PRINTED) ?? '[]') as string[]) } catch { return new Set<string>() } }
function savePrinted(s: Set<string>) { try { localStorage.setItem(PRINTED, JSON.stringify([...s].slice(-2000))) } catch { /* ignore */ } }
const esc = (v: unknown) => String(v ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)
const TICKET_CSS = `@page{size:80mm auto;margin:3mm 4mm} body{margin:0;font:14px/1.35 ui-monospace,Menlo,Consolas,monospace;color:#000;width:72mm}
  .big{font-size:20px;font-weight:700} .c{text-align:center} hr{border:0;border-top:1px dashed #000;margin:6px 0} .n{font-size:13px;padding-left:4mm} table{width:100%;border-collapse:collapse} td{padding:1px 0;vertical-align:top}`
/** one ticket per order, the way the waiter's device prints it */
function printTickets(orders: KitchenOrder[], station: string) {
  const when = formatDateWith(new Date(), { hour: '2-digit', minute: '2-digit' })
  printHtml(orders.map((o, i) => `${i ? '<div style="page-break-before:always"></div>' : ''}<div class="c big">${esc(station)}</div>
    <div class="c big">${esc(o.table ? t('Table {name}', { name: o.table }) : o.label || o.number)}</div><div class="c">${esc(when)} · ${esc(o.waiter)}</div><hr>
    <table>${o.lines.map((l) => `<tr><td class="big">${esc(num(l.quantity))} ×</td><td class="big">${esc(l.name)}</td></tr>${l.note ? `<tr><td></td><td class="n">» ${esc(l.note)}</td></tr>` : ''}`).join('')}</table>`).join(''), TICKET_CSS, 'kitchen')
}
