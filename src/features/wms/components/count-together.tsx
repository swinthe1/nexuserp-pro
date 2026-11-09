/**
 * Counting together with the shop open (the owner's model): a session of the unit, a list for each person.
 * The first list that counts an item owns it; the others ADD to it, and every entry is kept: who, how many,
 * where, when. Each person corrects their own entries; a manager any.
 */
import { Check, ClipboardList, FileText, MapPin, Pencil, Play, Trash2, Users, X } from 'lucide-react'
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
import { useChangeEntry, useCloseSession, useCountSession, useCountSessions, useJoinSession, useLineEntries, usePostSession, useSessionPeople, useStartSession, useAssignShelves, useSessionChecks, useCheckCompare, useStartCheck, useCountRecount, type CheckLine, type CountSessionView, type ElsewhereRow, type ListExtra } from '../api'
import { ScanShell } from './scan-shell'
import { CountRecordDialog } from './count-record'

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
  const [doneOnly, setDoneOnly] = React.useState(true)
  const [record, setRecord] = React.useState(false)
  if (q.isError) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />
  if (q.isLoading || !q.data) return <Skeleton className="mx-auto h-96 max-w-3xl" />
  const s = q.data
  const open = s.status === 'open'
  const review = s.lists.filter((l) => l.status === 'review').length
  const pct = s.in_stock ? Math.min(100, Math.round((s.items / s.in_stock) * 100)) : null
  const doneShelves = (s.shelves ?? []).filter((x) => x.done).length
  return (
    <ScanShell title={s.name} back={{ href: '/wms/counts', label: t('Stock counts') }}
      meta={<><StatusBadge status={s.status} /><span className="text-[13px] text-muted-foreground">{td(s.warehouse)} · {t('since {time}', { time: formatDate(s.started_at, true) })}</span></>}
      actions={<>
        {open && can('wms.write') && <Button variant="outline" loading={join.isPending} onClick={async () => { try { navigate(`/wms/counts/${await join.mutateAsync(s.id)}`) } catch { /* toast */ } }}>
          <ClipboardList /> {s.mine ? t('My list') : t('Count')}</Button>}
        {open && can('inventory.write') && <ConfirmDialog trigger={<Button>{t('Close the counting')}</Button>} title={t('Close the counting?')}
          description={<span className="grid gap-3"><span>{t('Nobody can add after this. Every list goes to review, where the differences are confirmed.')}</span>
            <label className="flex items-start gap-2"><Checkbox className="mt-0.5" checked={zero} onCheckedChange={(v) => setZero(!!v)} />
              <span>{t('Count as zero the items with stock that nobody found')}</span></label>
            {zero && <label className="ml-6 flex items-start gap-2"><Checkbox className="mt-0.5" checked={doneOnly} onCheckedChange={(v) => setDoneOnly(!!v)} />
              <span>{doneShelves ? tn(doneShelves, 'Only on the {n} shelf marked done', 'Only on the {n} shelves marked done') : t('Only on the shelves marked done (none is marked yet)')}</span></label>}</span>}
          confirmLabel={t('Close')} onConfirm={async () => {
            const r = await close.mutateAsync({ session: s.id, zero, doneOnly: zero && doneOnly })
            toast.success(tn(r.lists, '{n} list goes to review', '{n} lists go to review'), { description: [r.zero_lines ? tn(r.zero_lines, '{n} item counted as zero', '{n} items counted as zero') : '',
              r.shelves_not_done ? tn(r.shelves_not_done, '{n} shelf with stock was not marked done', '{n} shelves with stock were not marked done') : ''].filter(Boolean).join(' · ') || undefined })
          }} />}
        {!open && s.status !== 'cancelled' && can('inventory.write') && <Button variant="outline" onClick={() => setRecord(true)}><FileText /> {t('Count record')}</Button>}
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
      {record && <CountRecordDialog target={{ session: s.id }} onClose={() => setRecord(false)} />}
      {!!s.shelves?.length && <ShelvesCard s={s} manage={open && can('inventory.write')} />}
      {can('inventory.write') && <ChecksCard session={s.id} closed={!open} />}
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
/* ------------------------------------------------------------------ the blind checks: a second person, compared */
function ChecksCard({ session, closed }: { session: string; closed: boolean }) {
  const q = useSessionChecks(session, true)
  const [open, setOpen] = React.useState<string | null>(null)
  if (!q.data?.length) return null
  return (
    <div className="grid gap-2 rounded-xl border bg-card p-3">
      <span className="font-medium">{t('Check counts')}</span>
      <p className="text-[12.5px] text-muted-foreground">{t('A second person counted these shelves blind. The two counts are compared by their difference to the stock at the second each was made, so sales between them do not matter.')}</p>
      {q.data.map((k) => (
        <button key={k.id} type="button" onClick={() => setOpen(k.id)} className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg border px-3 py-2 text-left text-[13px] hover:border-primary/50">
          <span className="min-w-[9rem] flex-1"><span className="block font-medium">{k.person ?? '—'}</span>
            <span className="text-[12px] text-muted-foreground">{k.number} · {(k.locations ?? []).join(', ')}</span></span>
          <StatusBadge status={k.status} />
          <span className="tabular"><span className="text-success">{tn(k.agree, '{n} the same', '{n} the same')}</span>
            {k.differ > 0 && <span className="ml-2 font-medium text-destructive">{tn(k.differ, '{n} different', '{n} different')}</span>}
            {k.only_one > 0 && <span className="ml-2 text-muted-foreground">{tn(k.only_one, '{n} counted by one only', '{n} counted by one only')}</span>}</span>
        </button>
      ))}
      {open && <CheckDialog id={open} closed={closed} onClose={() => setOpen(null)} />}
    </div>
  )
}
function CheckDialog({ id, closed, onClose }: { id: string; closed: boolean; onClose: () => void }) {
  const q = useCheckCompare(id)
  const recount = useCountRecount()
  const lines = q.data?.lines ?? []
  const back = lines.filter((l) => l.agree === false && l.line_id && l.count_id && l.count_status === 'review')
  const send = async () => {
    const byCount = new Map<string, string[]>()
    for (const l of back) byCount.set(l.count_id!, [...(byCount.get(l.count_id!) ?? []), l.line_id!])
    let n = 0
    for (const [count, ids] of byCount) n += await recount.mutateAsync({ id: count, lines: ids, other: true })
    toast.success(tn(n, '{n} line goes back to be counted again', '{n} lines go back to be counted again'))
    onClose()
  }
  const verdict = (l: CheckLine) => l.agree === true ? <span className="text-success">{t('the same')}</span>
    : l.agree === false ? <span className="font-medium text-destructive">{t('different')}</span>
    : <span className="text-muted-foreground">{l.main_counted == null ? t('only the check found it') : t('the check did not count it')}</span>
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader><DialogTitle>{t('Check count')} {q.data?.number ?? ''}</DialogTitle>
          <DialogDescription>{q.data ? t('{name} counted {shelves} again, blind.', { name: q.data.person ?? '—', shelves: (q.data.locations ?? []).join(', ') }) : ''}</DialogDescription></DialogHeader>
        {q.isLoading ? <Skeleton className="h-40" /> : (
          <div className="max-h-[60vh] overflow-y-auto rounded-md border">
            <table className="w-full text-[13px]">
              <thead className="sticky top-0 bg-muted/60 text-left text-[11.5px] text-muted-foreground"><tr>
                <th className="px-2 py-1.5">{t('Item')}</th><th className="px-2 py-1.5">{t('Shelf')}</th>
                <th className="px-2 py-1.5 text-right">{t('Counted together')}</th><th className="px-2 py-1.5 text-right">{t('Check|column')}</th><th className="px-2 py-1.5">{t('Result')}</th></tr></thead>
              <tbody className="divide-y">
                {lines.map((l, i) => (
                  <tr key={i}>
                    <td className="px-2 py-1.5"><span className="block font-medium">{l.name}</span><span className="text-[12px] text-muted-foreground">{l.sku}{l.lot ? ` · ${l.lot}` : ''}</span></td>
                    <td className="px-2 py-1.5 font-mono text-[12px]">{l.location}</td>
                    <td className="px-2 py-1.5 text-right tabular">{l.main_counted == null ? '—' : formatQty(l.main_counted)}{l.main_by && <span className="block text-[11px] text-muted-foreground">{l.main_by}</span>}</td>
                    <td className="px-2 py-1.5 text-right tabular">{l.check_counted == null ? '—' : formatQty(l.check_counted)}</td>
                    <td className="px-2 py-1.5">{verdict(l)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <DialogFooter className="items-center gap-2">
          {!closed && lines.some((l) => l.agree === false) && <span className="mr-auto text-[12.5px] text-muted-foreground">{t('Close the counting to send the different lines back.')}</span>}
          <Button variant="outline" onClick={onClose}>{t('Close')}</Button>
          {closed && back.length > 0 && <Button loading={recount.isPending} onClick={() => void send()}>{tn(back.length, 'Count the {n} different line again', 'Count the {n} different lines again')}</Button>}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/* ------------------------------------------------------------------ the unit shelf by shelf: whose, how far, done */
function ShelvesCard({ s, manage }: { s: CountSessionView; manage: boolean }) {
  const people = useSessionPeople(s.id, manage)
  const assign = useAssignShelves()
  const startCheck = useStartCheck()
  const [picked, setPicked] = React.useState<string[]>([])
  const [person, setPerson] = React.useState('')
  const shelves = s.shelves ?? []
  const done = shelves.filter((x) => x.done).length
  const give = async (to: string | null) => {
    const n = await assign.mutateAsync({ session: s.id, locations: picked, person: to })
    toast.success(to ? tn(n, '{n} shelf given', '{n} shelves given') : tn(n, '{n} shelf taken back', '{n} shelves taken back'))
    setPicked([])
  }
  return (
    <div className="grid gap-2 rounded-xl border bg-card p-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="font-medium">{t('Shelves')}</span>
        <span className="text-[12.5px] text-muted-foreground">{t('{done} of {total} done', { done, total: shelves.length })}</span>
      </div>
      <ul className="max-h-72 divide-y overflow-y-auto rounded-md border text-[13px]">
        {shelves.map((x) => (
          <li key={x.location_id}><label className={cn('flex items-center gap-2 px-2.5 py-1.5', manage && 'cursor-pointer hover:bg-muted/40')}>
            {manage && <Checkbox checked={picked.includes(x.location_id)} aria-label={x.code}
              onCheckedChange={(v) => setPicked((p) => v === true ? [...p, x.location_id] : p.filter((y) => y !== x.location_id))} />}
            <span className="w-28 shrink-0 font-mono font-semibold">{x.code}</span>
            <span className="min-w-0 flex-1 truncate text-muted-foreground">{x.person ?? t('nobody yet')}</span>
            <span className="shrink-0 tabular text-muted-foreground">{x.with_stock != null ? `${x.counted}/${x.with_stock}` : tn(x.counted, '{n} item', '{n} items')}</span>
            <span className={cn('flex w-24 shrink-0 items-center justify-end gap-1 text-[12px]', x.done ? 'font-medium text-success' : 'text-muted-foreground')}
              title={x.done && x.done_by ? t('Done by {name}', { name: x.done_by }) : undefined}>
              {x.done ? <><Check className="size-3.5" />{t('done')}</> : t('not done')}</span>
          </label></li>
        ))}
      </ul>
      {manage && (
        <div className="flex flex-wrap items-center gap-2 text-[13px]">
          <span className="text-muted-foreground">{picked.length ? tn(picked.length, '{n} shelf chosen: give it to', '{n} shelves chosen: give them to') : t('Choose shelves to give them to a person')}</span>
          <Select value={person} onValueChange={setPerson} disabled={!picked.length}>
            <SelectTrigger className="h-8 w-auto min-w-44"><SelectValue placeholder={t('Choose a person')} /></SelectTrigger>
            <SelectContent>{(people.data ?? []).map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}</SelectContent>
          </Select>
          <Button size="sm" disabled={!picked.length || !person} loading={assign.isPending} onClick={() => void give(person)}>{t('Give')}</Button>
          {!!picked.length && <Button size="sm" variant="ghost" onClick={() => void give(null)}>{t('Take back')}</Button>}
          <Button size="sm" variant="outline" disabled={!picked.length || !person} loading={startCheck.isPending} title={t('Another person counts the chosen shelves again, blind; the two counts are compared')}
            onClick={async () => {
              await startCheck.mutateAsync({ session: s.id, locations: picked, person })
              toast.success(t('Check count given to {name}', { name: people.data?.find((p) => p.id === person)?.name ?? '' })); setPicked([])
            }}>{t('Check count')}</Button>
        </div>
      )}
    </div>
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

/** After an item is counted: the other shelves of the unit where it is kept, and whether each was counted (no expected quantity). */
export function ElsewhereCard({ title, rows, onClose }: { title: string; rows: ElsewhereRow[]; onClose: () => void }) {
  const open = rows.filter((r) => !r.counted).length
  return (
    <div className={cn('rounded-lg border px-3 py-2', open ? 'border-primary/40 bg-primary/5' : 'bg-muted/40')}>
      <div className="flex items-start gap-2">
        <MapPin className="mt-0.5 size-4 shrink-0 text-primary" />
        <div className="min-w-0 flex-1 text-[13px]">
          <div className="font-medium">{title}</div>
          <div className="text-muted-foreground">{t('This item is also kept at:')}</div>
          <ul className="mt-1 grid gap-0.5">
            {rows.map((r) => (
              <li key={r.location_id} className="flex flex-wrap items-baseline gap-x-2">
                <span className="font-mono font-semibold">{r.code}</span>
                <span className={r.counted ? 'text-muted-foreground' : 'font-medium text-primary'}>
                  {!r.counted ? t('not counted yet') : r.by ? t('counted by {name}: {n}', { name: r.by, n: formatQty(r.counted_qty) }) : t('counted: {n}', { n: formatQty(r.counted_qty) })}
                </span>
              </li>
            ))}
          </ul>
          {open > 0 && <div className="mt-1 text-muted-foreground">{t('Count it there too, so nothing is left out.')}</div>}
        </div>
        <Button size="icon" variant="ghost" className="size-7 shrink-0" onClick={onClose} aria-label={t('Close')}><X className="size-4" /></Button>
      </div>
    </div>
  )
}

/** On a goods receipt: a count is open in this unit, so the goods must reach the shelf together with the receipt. */
export function OpenCountBanner({ warehouseId, className }: { warehouseId: string | null | undefined; className?: string }) {
  const sessions = useCountSessions()
  const open = (sessions.data ?? []).find((s) => s.status === 'open' && !!warehouseId && s.warehouse_id === warehouseId)
  if (!open) return null
  return (
    <div role="status" className={cn('flex items-start gap-2 rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-[13px]', className)}>
      <ClipboardList className="mt-0.5 size-4 shrink-0" />
      <span><span className="block font-medium">{t('A stock count is open in this unit ({name}).', { name: open.name })}</span>
        {t('Post the receipt and put the goods on the shelf at the same time. If you cannot, keep the goods aside until the count is closed, so they are not counted twice or missed.')}</span>
    </div>
  )
}
