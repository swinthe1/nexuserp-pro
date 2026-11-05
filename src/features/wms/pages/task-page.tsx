import { ArrowRight, Check, MapPin, PackageOpen, ShoppingBasket, X } from 'lucide-react'
import * as React from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { toast } from 'sonner'
import { Can } from '@/app/company-provider'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { EmptyState } from '@/components/empty-state'
import { ScanInput, scanFeedback } from '@/components/scan-input'
import { StatusBadge } from '@/components/status-badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { describeError } from '@/lib/errors'
import { ErrorState } from '@/components/error-state'
import { t, tEnum, tn, tServer } from '@/i18n'
import { cn, formatDate, formatQty } from '@/lib/utils'
import { useCancelTask, useCompletePickList, useConfirmPick, useConfirmTaskLine, useResolveCode, useSuggestPutaway, useTask, type TaskDetail, type TaskLine } from '../api'
import { Progress, QtyDialog, ScanShell, useScanStatus } from '../components/scan-shell'

export function TaskPage() {
  const { id } = useParams()
  const task = useTask(id)
  if (task.isError) return <ErrorState error={task.error} onRetry={() => void task.refetch()} />
  if (task.isLoading) return <Skeleton className="mx-auto h-96 max-w-3xl" />
  if (!task.data) return <EmptyState title={t('Task not found')} action={<Button asChild variant="outline"><Link to="/wms">{t('Back to the warehouse floor')}</Link></Button>} />
  return task.data.task_type === 'pick' ? <PickScreen task={task.data} /> : <PutawayScreen task={task.data} />
}

function taskHeader({ task, back }: { task: TaskDetail; back: { href: string; label: string } }) {
  return { title: task.number, back, meta: <><StatusBadge status={task.status} /><span className="text-[13px] text-muted-foreground">{[task.reference, task.warehouse?.code].filter(Boolean).join(' · ')}</span></> }
}

/* ------------------------------------------------------------------ putaway / move */
function PutawayScreen({ task }: { task: TaskDetail }) {
  const navigate = useNavigate()
  const resolve = useResolveCode()
  const confirm = useConfirmTaskLine()
  const cancel = useCancelTask()
  const st = useScanStatus()
  const open = task.lines.filter((l) => l.quantity_done < l.quantity)
  const [currentId, setCurrentId] = React.useState<string | null>(open[0]?.id ?? null)
  const current = task.lines.find((l) => l.id === currentId && l.quantity_done < l.quantity) ?? open[0]
  const [qty, setQty] = React.useState<string>('')
  const remaining = current ? current.quantity - current.quantity_done : 0
  React.useEffect(() => { setQty(current ? String(current.quantity - current.quantity_done) : '') }, [current?.id, current?.quantity_done]) // eslint-disable-line react-hooks/exhaustive-deps
  const suggestions = useSuggestPutaway(current?.variant_id, task.warehouse_id)
  const active = task.status === 'open' || task.status === 'in_progress'
  const done = task.lines.reduce((s, l) => s + Number(l.quantity_done), 0)
  const total = task.lines.reduce((s, l) => s + Number(l.quantity), 0)

  const putTo = async (locationId: string, code: string) => {
    if (!current) return
    const q = Number(qty)
    if (!(q > 0) || q > remaining) { scanFeedback('error'); st.error(t('Enter a quantity up to {n}', { n: formatQty(remaining) })); return }
    try {
      const r = await confirm.mutateAsync({ line: current.id, qty: q, to: locationId })
      scanFeedback('ok'); st.ok(`${formatQty(q)} × ${current.variant?.sku} → ${code}`)
      if (r.task_status === 'done') { toast.success(t('{number} finished', { number: task.number })); navigate('/wms/putaway') }
    } catch (e) { scanFeedback('error'); st.error(describeError(e)) }
  }

  const onScan = async (code: string) => {
    if (!active) return
    const r = await resolve(code)
    if (r.kind === 'location') {
      if (r.location.warehouse_id !== task.warehouse_id) { scanFeedback('error'); st.error(t('{code} is in another warehouse', { code: r.location.code })); return }
      await putTo(r.location.id, r.location.code); return
    }
    if (r.kind === 'variant' || r.kind === 'lot') {
      const line = open.find((l) => l.variant_id === r.variantId && (r.kind !== 'lot' || l.lot_id === r.lotId)) ?? open.find((l) => l.variant_id === r.variantId)
      if (!line) { scanFeedback('error'); st.error(t('That item is not on this task')); return }
      scanFeedback('ok'); setCurrentId(line.id); st.info(t('{sku}: now scan the shelf', { sku: line.variant?.sku ?? '' })); return
    }
    scanFeedback('error'); st.error(t('Unknown code “{code}”', { code }))
  }

  const h = taskHeader({ task, back: { href: '/wms/putaway', label: t('Put away') } })
  return (
    <ScanShell {...h} actions={task.status === 'open' && <Can perm="wms.write"><ConfirmDialog trigger={<Button variant="ghost" size="sm"><X /> {t('Cancel task')}</Button>}
      title={t('Cancel {number}?', { number: task.number })} description={t('The goods stay where they are. You can collect them into a new task later.')} confirmLabel={t('Cancel task')} destructive
      onConfirm={async () => { await cancel.mutateAsync(task.id); navigate('/wms/putaway') }} /></Can>}>
      {active && <ScanInput onScan={onScan} placeholder={t('Scan the shelf you put it on (or another item to switch)')} status={st.status} />}
      <Progress done={done} total={total} />
      {current && active ? (
        <div className="grid gap-3 rounded-xl border-2 border-primary/40 bg-card p-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0"><div className="font-mono text-[13px] text-muted-foreground">{current.variant?.sku}</div>
              <div className="text-lg font-semibold">{current.variant?.name}</div>
              {current.lot && <div className="text-[13px] text-muted-foreground">{t('Lot {lot}', { lot: current.lot.lot_number })}{current.lot.expiry_date ? ` · ${t('expires {date}', { date: formatDate(current.lot.expiry_date) })}` : ''}</div>}</div>
            <div className="text-right"><div className="text-xs text-muted-foreground">{t('From')}</div><div className="font-mono font-medium">{current.from?.code}</div></div>
          </div>
          <div className="flex items-center gap-3">
            <label className="text-[13px] text-muted-foreground" htmlFor="pa-qty">{t('Quantity')}</label>
            <Input id="pa-qty" inputMode="decimal" className="h-11 w-28 text-center text-lg font-semibold tabular" value={qty} onChange={(e) => setQty(e.target.value.replace(',', '.'))} />
            <span className="text-[13px] text-muted-foreground">{t('of {n} left', { n: formatQty(remaining) })}</span>
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            {(suggestions.data ?? []).map((s, i) => (
              <Button key={s.location_id} variant={i === 0 ? 'default' : 'outline'} className="h-auto justify-between gap-3 py-3 text-left" onClick={() => putTo(s.location_id!, s.code ?? "")} loading={confirm.isPending && i === 0}>
                <span><span className="flex items-center gap-1.5 font-mono text-base font-semibold"><MapPin className="size-4" />{s.code}</span>
                  <span className={cn('block text-xs font-normal', i === 0 ? 'text-primary-foreground/80' : 'text-muted-foreground')}>{tServer(s.reason)}{s.on_hand ? ` · ${t('{n} there', { n: formatQty(s.on_hand) })}` : ''}</span></span>
                <ArrowRight className="size-4" />
              </Button>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">{t('Scanning any shelf label puts the quantity there; the suggestions are only the fastest choices.')}</p>
        </div>
      ) : (
        <EmptyState icon={PackageOpen} title={task.status === 'done' ? t('All put away') : t('Task is {status}', { status: tEnum(task.status).toLowerCase() })} description={task.completed_at ? t('Finished {date}', { date: formatDate(task.completed_at, true) }) : undefined} compact />
      )}
      <TaskLines lines={task.lines} currentId={current?.id} onPick={active ? setCurrentId : undefined} kind="putaway" />
    </ScanShell>
  )
}

function TaskLines({ lines, currentId, onPick, kind, picked }: { lines: TaskLine[]; currentId?: string; onPick?: (id: string) => void; kind: 'putaway' | 'pick'; picked?: Record<string, number> }) {
  return (
    <div className="grid gap-1.5">
      {lines.map((l) => {
        const doneQty = kind === 'pick' ? (l.done_at ? Number(l.quantity_done) : picked?.[l.id] ?? 0) : Number(l.quantity_done)
        const finished = kind === 'pick' ? !!l.done_at : doneQty >= l.quantity
        return (
          <button key={l.id} type="button" disabled={!onPick} onClick={() => onPick?.(l.id)}
            className={cn('grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 rounded-lg border bg-card px-3 py-2 text-left text-[13px]',
              currentId === l.id && 'border-primary ring-1 ring-primary/40', finished && 'opacity-60')}>
            <span className="w-16 font-mono font-medium">{kind === 'pick' ? (l.done_loc ?? l.from)?.code : l.from?.code}</span>
            <span className="min-w-0"><span className="block truncate font-medium">{l.variant?.name}</span>
              <span className="text-muted-foreground">{l.variant?.sku}{l.lot ? ` · ${l.lot.lot_number}` : ''}{kind === 'putaway' && (l.done_loc ?? l.to) ? ` → ${(l.done_loc ?? l.to)!.code}` : ''}</span></span>
            <span className="flex items-center gap-1.5 tabular">{finished && <Check className={cn('size-4', doneQty < l.quantity ? 'text-warning' : 'text-success')} />}{formatQty(doneQty)} / {formatQty(l.quantity)}</span>
          </button>
        )
      })}
    </div>
  )
}

/* ------------------------------------------------------------------ picking */
function PickScreen({ task }: { task: TaskDetail }) {
  const navigate = useNavigate()
  const resolve = useResolveCode()
  const confirmPick = useConfirmPick()
  const complete = useCompletePickList()
  const st = useScanStatus()
  const active = task.status === 'open' || task.status === 'in_progress'
  const storeKey = `drispro.pick.${task.id}`
  const [picked, setPicked] = React.useState<Record<string, number>>(() => { try { return JSON.parse(localStorage.getItem(storeKey) ?? '{}') } catch { return {} } })
  const [override, setOverride] = React.useState<Record<string, { location?: string; locationCode?: string; lot?: string }>>({})
  React.useEffect(() => { try { localStorage.setItem(storeKey, JSON.stringify(picked)) } catch { /* ignore */ } }, [picked, storeKey])
  const todo = task.lines.filter((l) => !l.done_at)
  const [currentId, setCurrentId] = React.useState<string | null>(null)
  const current = todo.find((l) => l.id === currentId) ?? todo[0]
  const [qtyOpen, setQtyOpen] = React.useState(false)
  const totalQty = task.lines.reduce((s, l) => s + Number(l.quantity), 0)
  const doneQty = task.lines.reduce((s, l) => s + (l.done_at ? Number(l.quantity_done) : picked[l.id] ?? 0), 0)

  const confirmLine = async (line: TaskLine, qty: number) => {
    try {
      const o = override[line.id]
      await confirmPick.mutateAsync({ line: line.id, qty, location: o?.location, lot: o?.lot })
      scanFeedback('ok'); st.ok(qty < line.quantity ? t('{sku}: {done} of {total} picked (short)', { sku: line.variant?.sku ?? '', done: formatQty(qty), total: formatQty(line.quantity) }) : t('{sku} picked', { sku: line.variant?.sku ?? '' }))
      setCurrentId(null)
    } catch (e) { scanFeedback('error'); st.error(describeError(e)) }
  }

  const onScan = async (code: string) => {
    if (!active || !current) return
    const r = await resolve(code)
    if (r.kind === 'location') {
      if (r.location.id === current.from_location_id) { scanFeedback('ok'); st.info(t('At {code} — scan {sku}', { code: r.location.code, sku: current.variant?.sku ?? '' })); return }
      if (r.location.warehouse_id !== task.warehouse_id) { scanFeedback('error'); st.error(t('{code} is in another warehouse', { code: r.location.code })); return }
      setOverride((o) => ({ ...o, [current.id]: { ...o[current.id], location: r.location.id, locationCode: r.location.code } }))
      scanFeedback('ok'); st.info(t('Picking {sku} from {code} instead of {from}', { sku: current.variant?.sku ?? '', code: r.location.code, from: current.from?.code ?? '' })); return
    }
    if (r.kind === 'variant' || r.kind === 'lot') {
      const line = current.variant_id === r.variantId ? current : todo.find((l) => l.variant_id === r.variantId)
      if (!line) { scanFeedback('error'); st.error(t('That item is not on this pick list')); return }
      if (line.id !== current.id) setCurrentId(line.id)
      if (r.kind === 'lot' && r.lotId !== line.lot_id) setOverride((o) => ({ ...o, [line.id]: { ...o[line.id], lot: r.lotId } }))
      const inc = r.kind === 'variant' ? r.qty : 1
      const next = (picked[line.id] ?? 0) + inc
      if (next > line.quantity) { scanFeedback('error'); st.error(t('Only {n} × {sku} needed', { n: formatQty(line.quantity), sku: line.variant?.sku ?? '' })); return }
      setPicked((p) => ({ ...p, [line.id]: next }))
      if (next === Number(line.quantity)) await confirmLine(line, next)
      else { scanFeedback('ok'); st.ok(t('{sku}: {done} of {total}', { sku: line.variant?.sku ?? '', done: formatQty(next), total: formatQty(line.quantity) })) }
      return
    }
    scanFeedback('error'); st.error(t('Unknown code “{code}”', { code }))
  }

  const h = taskHeader({ task, back: { href: '/wms/picking', label: t('Pick') } })
  const loc = current ? override[current.id]?.locationCode ?? current.from?.code : null
  return (
    <ScanShell {...h}>
      {active && <ScanInput onScan={onScan} placeholder={t('Scan the shelf, then each item')} status={st.status} />}
      <Progress done={doneQty} total={totalQty} />
      {current && active ? (
        <div className="grid gap-3 rounded-xl border-2 border-primary/40 bg-card p-4">
          <div className="flex items-center justify-between gap-3">
            <div><div className="text-xs text-muted-foreground">{t('Go to')}</div><div className="flex items-center gap-2 font-mono text-3xl font-bold tracking-tight"><MapPin className="size-6 text-primary" />{loc}</div></div>
            <div className="text-right"><div className="text-xs text-muted-foreground">{t('Pick')}</div><div className="text-3xl font-bold tabular">{formatQty(picked[current.id] ?? 0)}<span className="text-lg font-medium text-muted-foreground"> / {formatQty(current.quantity)}</span></div></div>
          </div>
          <div><div className="font-mono text-[13px] text-muted-foreground">{current.variant?.sku}</div><div className="text-lg font-semibold">{current.variant?.name}</div>
            {current.lot && <div className="text-[13px] text-muted-foreground">{t('Lot {lot}', { lot: current.lot.lot_number })}{current.lot.expiry_date ? ` · ${t('expires {date}', { date: formatDate(current.lot.expiry_date) })}` : ''}{override[current.id]?.lot ? ` ${t('(a different lot was scanned)')}` : ''}</div>}</div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => setQtyOpen(true)}>{t('Enter quantity')}</Button>
            <Button variant="outline" className="text-warning" loading={confirmPick.isPending} onClick={() => confirmLine(current, picked[current.id] ?? 0)}>
              {t('Short — {n} found', { n: formatQty(picked[current.id] ?? 0) })}</Button>
            {todo.length > 1 && <Button variant="ghost" onClick={() => setCurrentId(todo[(todo.indexOf(current) + 1) % todo.length]!.id)}>{t('Skip for now')}</Button>}
          </div>
        </div>
      ) : active ? (
        <div className="grid gap-3 rounded-xl border-2 border-success/40 bg-success/5 p-4">
          <div className="text-lg font-semibold">{t('Everything is picked')}</div>
          <p className="text-[13px] text-muted-foreground">{t('Finish the list to mark the deliveries ready. Missing items are taken off the deliveries; the order keeps them to send later.')}</p>
          <Can perm="wms.write"><Button size="lg" loading={complete.isPending} onClick={async () => {
            try {
              const r = await complete.mutateAsync(task.id)
              try { localStorage.removeItem(storeKey) } catch { /* ignore */ }
              const short = r.short_lines ? tn(r.short_lines, '{n} line short', '{n} lines short') : undefined
              // the shops' transfers: picked, they leave from the transfer's own page
              if (r.transfers && !r.ready) { toast.success(tn(r.transfers, '{n} transfer picked: send it from its page', '{n} transfers picked: send them from their pages'), { description: short }); navigate('/inventory/transfers'); return }
              toast.success(tn(r.ready, '{n} delivery ready to ship', '{n} deliveries ready to ship'), { description: short })
              navigate('/wms/shipping')
            } catch { /* toast */ }
          }}><ShoppingBasket /> {t('Finish pick list')}</Button></Can>
        </div>
      ) : <EmptyState icon={ShoppingBasket} title={t('Pick list: {status}', { status: tEnum(task.status).toLowerCase() })} description={task.completed_at ? t('Finished {date}', { date: formatDate(task.completed_at, true) }) : undefined} compact
            action={<Button variant="outline" asChild><Link to="/wms/shipping">{t('Go to shipping')}</Link></Button>} />}
      <TaskLines lines={task.lines} currentId={current?.id} onPick={active ? (id) => { if (todo.some((l) => l.id === id)) setCurrentId(id) } : undefined} kind="pick" picked={picked} />
      {current && <QtyDialog open={qtyOpen} title={t('{sku} picked', { sku: current.variant?.sku ?? '' })} initial={picked[current.id] ?? 0} max={Number(current.quantity)} submitLabel={t('Confirm pick')}
        onClose={() => setQtyOpen(false)} onSubmit={async (q) => { setQtyOpen(false); setPicked((p) => ({ ...p, [current.id]: q })); await confirmLine(current, q) }} />}
    </ScanShell>
  )
}

