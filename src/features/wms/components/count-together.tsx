/**
 * Counting together with the shop open (the owner's model): a session of the unit, a list for each person.
 * The first list that counts an item owns it; the others ADD to it, and every entry is kept: who, how many,
 * where, when. Each person corrects their own entries; a manager any.
 */
import { ClipboardList, Pencil, Play, Trash2, Users } from 'lucide-react'
import * as React from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { toast } from 'sonner'
import { Can, useCompany } from '@/app/company-provider'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { EmptyState } from '@/components/empty-state'
import { ErrorState } from '@/components/error-state'
import { StatusBadge } from '@/components/status-badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { t, td, tn } from '@/i18n'
import { cn, formatDate, formatQty, num } from '@/lib/utils'
import { useWarehouses } from '@/features/inventory/api'
import { useChangeEntry, useCloseSession, useCountSession, useCountSessions, useJoinSession, useLineEntries, usePostSession, useStartSession, type ListExtra } from '../api'
import { ScanShell } from './scan-shell'

const time = (iso: string) => new Date(iso).toLocaleTimeString('sq-AL', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })

/* ------------------------------------------------------------------ on the counts page */
export function SessionsCard() {
  const sessions = useCountSessions()
  const join = useJoinSession()
  const navigate = useNavigate()
  const [starting, setStarting] = React.useState(false)
  const open = (sessions.data ?? []).filter((s) => s.status === 'open')
  return (
    <section className="grid gap-3 rounded-xl border bg-card p-4" aria-labelledby="together">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 max-w-2xl">
          <h2 id="together" className="flex items-center gap-2 font-semibold"><Users className="size-4 text-primary" /> {t('Counting together')}</h2>
          <p className="mt-0.5 text-[13px] text-muted-foreground">{t('The whole unit, with the shop open: each person counts into a list of their own. Whoever counts an item first has it on their list; the others add their quantity to it, and every entry is kept.')}</p>
        </div>
        <Can perm="inventory.write"><Button size="sm" variant="outline" onClick={() => setStarting(true)}><Play /> {t('Start counting together')}</Button></Can>
      </div>
      {sessions.isLoading ? <Skeleton className="h-12" /> : open.length > 0 ? (
        <div className="grid gap-1.5">
          {open.map((s) => (
            <div key={s.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-primary/30 bg-primary/5 px-3 py-2">
              <span className="min-w-[10rem] flex-1"><span className="block text-[14px] font-medium">{s.name}</span>
                <span className="text-[12px] text-muted-foreground">{td(s.warehouse?.name)} · {t('since {time}', { time: formatDate(s.created_at, true) })}</span></span>
              <Can perm="inventory.read"><Button size="sm" variant="ghost" asChild><Link to={`/wms/sessions/${s.id}`}>{t('Follow it')}</Link></Button></Can>
              <Can perm="wms.write"><Button size="sm" loading={join.isPending && join.variables === s.id}
                onClick={async () => { try { navigate(`/wms/counts/${await join.mutateAsync(s.id)}`) } catch { /* toast */ } }}><ClipboardList /> {t('Count')}</Button></Can>
            </div>
          ))}
        </div>
      ) : <p className="text-[12.5px] text-muted-foreground">{t('No counting session is open.')}</p>}
      {starting && <StartDialog onClose={() => setStarting(false)} />}
    </section>
  )
}

function StartDialog({ onClose }: { onClose: () => void }) {
  const warehouses = useWarehouses()
  const start = useStartSession()
  const navigate = useNavigate()
  const units = (warehouses.data ?? []).filter((w) => ['store', 'warehouse'].includes(String((w as { warehouse_type?: string }).warehouse_type ?? 'store')))
  const [wh, setWh] = React.useState<string | null>(null)
  const [name, setName] = React.useState('')
  const [cart, setCart] = React.useState('20')
  React.useEffect(() => { if (!wh && units.length) setWh(units[0]!.id) }, [units, wh])
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>{t('Start counting together')}</DialogTitle>
          <DialogDescription>{t('The shop stays open. Each person joins from their phone and counts; the expected quantity is never shown to them.')}</DialogDescription></DialogHeader>
        <div className="grid gap-3">
          <div className="grid gap-1.5"><Label>{t('Unit')}</Label>
            <Select value={wh ?? ''} onValueChange={setWh}><SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{units.map((w) => <SelectItem key={w.id} value={w.id}>{td(w.name)}</SelectItem>)}</SelectContent></Select></div>
          <div className="grid gap-1.5"><Label htmlFor="cs-name" optional>{t('Name')}</Label><Input id="cs-name" value={name} onChange={(e) => setName(e.target.value)} placeholder={t('e.g. Inventory of November')} /></div>
          <div className="grid gap-1.5"><Label htmlFor="cs-cart">{t('Minutes a customer may keep goods in the cart')}</Label>
            <Input id="cs-cart" inputMode="numeric" className="w-24" value={cart} onChange={(e) => setCart(e.target.value.replace(/\D/g, '').slice(0, 3))} />
            <p className="text-[12px] text-muted-foreground">{t('An item sold within these minutes after it was counted may have been in a cart: the review shows it beside a shortage.')}</p></div>
        </div>
        <DialogFooter><Button variant="ghost" onClick={onClose}>{t('Cancel')}</Button>
          <Button disabled={!wh} loading={start.isPending} onClick={async () => {
            try { const id = await start.mutateAsync({ warehouse: wh!, name, cart: Math.min(120, num(cart)) }); navigate(`/wms/sessions/${id}`) } catch { /* toast */ }
          }}>{t('Start')}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/* ------------------------------------------------------------------ the manager follows the session */
export function CountSessionPage() {
  const { id } = useParams()
  const { can } = useCompany()
  const q = useCountSession(id)
  const join = useJoinSession()
  const close = useCloseSession()
  const post = usePostSession()
  const navigate = useNavigate()
  const [zero, setZero] = React.useState(false)
  if (q.isError) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />
  if (q.isLoading || !q.data) return <Skeleton className="mx-auto h-96 max-w-3xl" />
  const s = q.data
  const open = s.status === 'open'
  const review = s.lists.filter((l) => l.status === 'review').length
  const pct = s.in_stock ? Math.min(100, Math.round((s.items / s.in_stock) * 100)) : null
  return (
    <ScanShell title={s.name} back={{ href: '/wms/counts', label: t('Stock counts') }}
      meta={<><StatusBadge status={s.status} /><span className="text-[13px] text-muted-foreground">{td(s.warehouse)} · {t('since {time}', { time: formatDate(s.started_at, true) })}</span></>}
      actions={<>
        {open && can('wms.write') && <Button variant="outline" loading={join.isPending} onClick={async () => { try { navigate(`/wms/counts/${await join.mutateAsync(s.id)}`) } catch { /* toast */ } }}>
          <ClipboardList /> {s.mine ? t('My list') : t('Count')}</Button>}
        {open && can('inventory.write') && <ConfirmDialog trigger={<Button>{t('Close the counting')}</Button>} title={t('Close the counting?')}
          description={<span className="grid gap-3"><span>{t('Nobody can add after this. Every list goes to review, where the differences are confirmed.')}</span>
            <label className="flex items-start gap-2"><Checkbox className="mt-0.5" checked={zero} onCheckedChange={(v) => setZero(!!v)} />
              <span>{t('Count as zero the items with stock that nobody found (the whole unit was counted)')}</span></label></span>}
          confirmLabel={t('Close')} onConfirm={async () => {
            const r = await close.mutateAsync({ session: s.id, zero })
            toast.success(tn(r.lists, '{n} list goes to review', '{n} lists go to review'), { description: r.zero_lines ? tn(r.zero_lines, '{n} item counted as zero', '{n} items counted as zero') : undefined })
          }} />}
        {!open && review > 0 && can('inventory.write') && <ConfirmDialog trigger={<Button>{t('Confirm all differences')}</Button>} title={t('Confirm all differences?')}
          description={t('Each list becomes its stock adjustment (reason: count). Look at the lists first: the shortages that may have been in a cart are marked.')}
          confirmLabel={t('Confirm')} onConfirm={async () => { const r = await post.mutateAsync(s.id); toast.success(tn(r.posted, '{n} list confirmed', '{n} lists confirmed')) }} />}
      </>}>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        <Stat label={t('People counting')} value={String(s.lists.length)} />
        <Stat label={t('Items counted')} value={formatQty(s.items)} hint={pct != null ? t('{pct}% of the items with stock', { pct }) : undefined} />
        <Stat label={t('Cart time')} value={t('{n} min', { n: s.cart_minutes })} />
      </div>
      {pct != null && <div className="h-2 overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}><div className="h-full bg-primary transition-all" style={{ width: `${pct}%` }} /></div>}
      {!s.lists.length ? <EmptyState compact icon={Users} title={t('Nobody has joined yet')} description={t('Each person opens Stock counts on the phone and presses Count.')} /> : (
        <div className="grid gap-1.5">
          {s.lists.map((l) => (
            <Link key={l.id} to={`/wms/counts/${l.id}`} className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-xl border bg-card px-4 py-3 hover:border-primary/50">
              <span className="min-w-[9rem] flex-1"><span className="block font-medium">{l.person ?? '—'}</span><span className="text-[12px] text-muted-foreground">{l.number}</span></span>
              <StatusBadge status={l.status} />
              <span className="text-[13px] tabular">{tn(l.items, '{n} item', '{n} items')} · {tn(l.entries, '{n} entry', '{n} entries')}</span>
              <span className="w-20 text-right text-[12px] text-muted-foreground">{l.last_at ? time(l.last_at) : '—'}</span>
            </Link>
          ))}
        </div>
      )}
    </ScanShell>
  )
}
function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return <div className="rounded-xl border bg-card p-3"><div className="text-[12px] text-muted-foreground">{label}</div><div className="text-xl font-semibold tabular">{value}</div>{hint && <div className="text-[11.5px] text-muted-foreground">{hint}</div>}</div>
}

/* ------------------------------------------------------------------ one item: everybody's entries, add one's own */
export function EntriesDialog({ line, title, onClose, onAdd, canAdd }: { line: string; title: string; onClose: () => void; onAdd: (qty: number) => Promise<void>; canAdd: boolean }) {
  const q = useLineEntries(line)
  const change = useChangeEntry()
  const { can } = useCompany()
  const [qty, setQty] = React.useState('')
  const [editing, setEditing] = React.useState<{ id: string; qty: string } | null>(null)
  const d = q.data
  const add = num(qty.replace(',', '.'))
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader><DialogTitle className="truncate pr-6">{title}</DialogTitle>
          <DialogDescription>{d?.owner ? t('On the list of {name}', { name: d.owner }) : t('Counted so far')}</DialogDescription></DialogHeader>
        {q.isLoading ? <Skeleton className="h-24" /> : (
          <div className="grid gap-2">
            <div className="flex items-baseline justify-between rounded-lg bg-muted/50 px-3 py-2"><span className="text-[13px] text-muted-foreground">{t('Counted so far')}</span>
              <span className="text-2xl font-semibold tabular">{d?.counted_qty == null ? '—' : formatQty(d.counted_qty)}</span></div>
            <ul className="grid gap-1">
              {(d?.entries ?? []).map((e) => (
                <li key={e.id} className="flex items-center gap-2 rounded-md border px-2.5 py-1.5 text-[13px]">
                  <span className="min-w-0 flex-1"><span className="font-medium">{e.name ?? '—'}</span>
                    <span className="text-muted-foreground"> · {time(e.at)}{e.location ? ` · ${e.location}` : ''}</span></span>
                  {editing?.id === e.id ? (
                    <form className="flex items-center gap-1" onSubmit={async (ev) => { ev.preventDefault(); await change.mutateAsync({ entry: e.id, qty: num(editing.qty.replace(',', '.')) }); setEditing(null) }}>
                      <Input autoFocus inputMode="decimal" className="h-8 w-20 text-right" value={editing.qty} onChange={(x) => setEditing({ id: e.id, qty: x.target.value })} />
                      <Button size="sm" type="submit" loading={change.isPending}>{t('Save')}</Button>
                    </form>
                  ) : <>
                    <span className="font-semibold tabular">{formatQty(e.qty)}</span>
                    {(e.mine || can('inventory.write')) && <>
                      <Button size="icon" variant="ghost" className="size-7" aria-label={t('Correct')} onClick={() => setEditing({ id: e.id, qty: String(e.qty) })}><Pencil className="size-3.5" /></Button>
                      <Button size="icon" variant="ghost" className="size-7 text-destructive" aria-label={t('Remove')} onClick={() => change.mutate({ entry: e.id, qty: null })}><Trash2 className="size-3.5" /></Button>
                    </>}
                  </>}
                </li>
              ))}
              {!d?.entries.length && <li className="text-[13px] text-muted-foreground">{t('Nobody has counted it yet.')}</li>}
            </ul>
            {canAdd && (
              <form className="mt-1 grid gap-1.5" onSubmit={async (e) => { e.preventDefault(); if (add > 0) { await onAdd(add); setQty(''); void q.refetch() } }}>
                <Label htmlFor="ent-add">{t('Add what you counted')}</Label>
                <div className="flex gap-2">
                  <Input id="ent-add" autoFocus inputMode="decimal" className="h-12 text-right text-lg tabular" value={qty} onChange={(e) => setQty(e.target.value)} placeholder="0" />
                  <Button type="submit" className="h-12" disabled={!(add > 0)}>{t('Add')}</Button>
                </div>
                {add > 0 && d?.counted_qty != null && <p className="text-[12.5px] text-muted-foreground">{t('{a} + {b} = {c}', { a: formatQty(d.counted_qty), b: formatQty(add), c: formatQty(num(d.counted_qty) + add) })}</p>}
              </form>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

/* ------------------------------------------------------------------ what this person added to other people's lists */
export function ExtrasList({ rows, onOpen }: { rows: ListExtra[]; onOpen: (r: ListExtra) => void }) {
  if (!rows.length) return null
  return (
    <div className="rounded-xl border bg-card">
      <div className="border-b px-3 py-2 text-[13px] font-semibold">{t('Added to other people\'s lists')}</div>
      {rows.map((r) => (
        <button key={r.line_id} type="button" onClick={() => onOpen(r)} className="grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border-b px-3 py-2 text-left text-[13px] last:border-0 hover:bg-muted/50">
          <span className="min-w-0"><span className="block truncate font-medium">{r.name}</span>
            <span className="text-muted-foreground">{r.sku} · {t('on the list of {name}', { name: r.owner ?? '—' })}</span></span>
          <span className={cn('text-right tabular')}><span className="block text-lg font-semibold">{formatQty(r.counted_qty)}</span>
            <span className="text-[11.5px] text-muted-foreground">{t('yours {n}', { n: formatQty(r.mine_qty) })}</span></span>
        </button>
      ))}
    </div>
  )
}
