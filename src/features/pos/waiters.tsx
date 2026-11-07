/**
 * The restaurant till: the waiters hand over the cash they took at the tables. The person at the till
 * sees what each one owes, counts what he hands over (by note and coin), and takes it in; a difference
 * stays with the waiter and needs a reason. A waiter sees his own takings on the floor.
 */
import { useQueryClient } from '@tanstack/react-query'
import { HandCoins, Printer, Wallet } from 'lucide-react'
import * as React from 'react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Skeleton } from '@/components/ui/skeleton'
import { Textarea } from '@/components/ui/textarea'
import { t, tn } from '@/i18n'
import { describeError } from '@/lib/errors'
import { cn, formatDate, formatMoney, num } from '@/lib/utils'
import { usePosWaiters, waiterHandover, type TillData, type WaiterOwes } from './api'
import { CashCount, countedOf, countsToNotes, denomsOf, type Counts } from './cash-count'
import { printWaiterSlip } from './receipt'

const owes = (w: WaiterOwes) => Math.abs(num(w.owed)) > 0.004

/** the waiters still owing, for the till's top bar and its close */
export function useWaitersOwing(data: TillData) {
  const restaurant = (data.register as { mode?: string | null }).mode === 'restaurant'
  const q = usePosWaiters(restaurant ? data.session?.id : undefined, true)
  const owing = (q.data?.waiters ?? []).filter(owes)
  return { restaurant, required: !!q.data?.required, owing, loading: q.isLoading, refetch: q.refetch }
}

/** the person at the till takes in the waiters' takings */
export function WaiterHandoverDialog({ data, onClose }: { data: TillData; onClose: () => void }) {
  const session = data.session!
  const q = usePosWaiters(session.id)
  const qc = useQueryClient()
  const cur = data.company.base_currency
  const [pick, setPick] = React.useState<string | null>(null)
  const [counts, setCounts] = React.useState<Counts>({})
  const [direct, setDirect] = React.useState('')
  const [note, setNote] = React.useState('')
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const waiters = q.data?.waiters ?? []
  const w = waiters.find((x) => x.waiter_id === pick) ?? null
  React.useEffect(() => { if (!pick) setPick(waiters.find(owes)?.waiter_id ?? null) }, [waiters, pick])
  const counted = countedOf(cur, counts, direct)
  const touched = direct !== '' || Object.values(counts).some((v) => v !== '')
  const diff = w ? Math.round((counted - num(w.owed)) * 100) / 100 : 0
  const choose = (id: string) => { setPick(id); setCounts({}); setDirect(''); setNote(''); setError(null) }
  const slip = (x: WaiterOwes, extra?: { counted: number; difference: number; note: string | null }) => printWaiterSlip({
    company: data.company.name, register: data.register.name, session: session.number, waiter: x.name, receipts: x.receipts, cash: num(x.cash), card: num(x.card),
    other: num(x.other), owed: num(x.owed), counted: extra?.counted ?? null, difference: extra?.difference ?? null, note: extra?.note ?? null,
    receivedBy: q.data?.holder ?? null, at: new Date(), currency: cur, paper: data.register.paper_mm })
  const take = async () => {
    if (!w) return
    if (!touched) { setError(t('Count the cash the waiter hands over')); return }
    if (diff !== 0 && note.trim().length < 3) { setError(t('Say why the handover differs from what the waiter owes')); return }
    setBusy(true); setError(null)
    try {
      const r = await waiterHandover({ session: session.id, waiter: w.waiter_id, counted, note: note.trim() || null, notesCoins: direct === '' ? countsToNotes(denomsOf(cur), counts) : null })
      toast.success(t('{name} handed over {amount}', { name: w.name, amount: formatMoney(num(r.counted)) }))
      slip(w, { counted: num(r.counted), difference: num(r.difference), note: note.trim() || null })
      await qc.invalidateQueries({ queryKey: ['pos', 'waiters', session.id] })
      setPick(null); setCounts({}); setDirect(''); setNote('')
    } catch (e) { setError(describeError(e)) } finally { setBusy(false) }
  }
  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><HandCoins className="size-5 text-primary" /> {t('The waiters\' takings')}</DialogTitle>
          <DialogDescription>{t('Each waiter hands over the cash he took at his tables. Count it, and take it in: a difference stays with the waiter. The shift closes once everyone has handed over.')}</DialogDescription>
        </DialogHeader>
        {q.isLoading ? <Skeleton className="h-56" /> : !waiters.length ? (
          <p className="rounded-md bg-muted px-3 py-6 text-center text-[13px] text-muted-foreground">{t('No waiter took a payment in this shift.')}</p>
        ) : (
          <div className="grid gap-5 md:grid-cols-[1fr_1fr]">
            <div className="grid content-start gap-1.5">
              {waiters.map((x) => (
                <button key={x.waiter_id} type="button" onClick={() => choose(x.waiter_id)}
                  className={cn('grid gap-0.5 rounded-lg border-2 px-3 py-2 text-left text-[13px]', pick === x.waiter_id ? 'border-primary bg-primary/5' : 'hover:bg-muted')}>
                  <span className="flex items-center justify-between gap-2"><span className="font-medium">{x.name}</span>
                    {owes(x) ? <span className="tabular font-semibold">{formatMoney(num(x.owed))}</span> : <Badge variant="success">{t('Handed over')}</Badge>}</span>
                  <span className="text-[12px] text-muted-foreground">{tn(x.receipts, '{n} receipt', '{n} receipts')} · {t('cash {a} · card {b}', { a: formatMoney(num(x.cash)), b: formatMoney(num(x.card)) })}
                    {num(x.handed) > 0 && ` · ${t('handed {amount}', { amount: formatMoney(num(x.handed)) })}`}</span>
                  {num(x.open_tables) > 0 && <span className="text-[12px] font-medium text-warning">{tn(num(x.open_tables), 'still has {n} open table', 'still has {n} open tables')}</span>}
                </button>
              ))}
              {!!q.data?.handovers.length && (
                <div className="mt-2 grid gap-1 border-t pt-2 text-[12.5px]">
                  <span className="font-medium text-muted-foreground">{t('Handed over in this shift')}</span>
                  {q.data.handovers.map((h) => (
                    <div key={h.id} className="flex justify-between gap-2"><span>{formatDate(h.at, true)} · {h.waiter}{h.note ? ` · “${h.note}”` : ''}</span>
                      <span className="tabular">{formatMoney(num(h.counted))}{num(h.difference) !== 0 && <span className={cn('ml-1.5', num(h.difference) < 0 ? 'text-destructive' : 'text-warning')}>({formatMoney(num(h.difference))})</span>}</span></div>
                  ))}
                </div>
              )}
            </div>
            {w && owes(w) ? (
              <div className="grid content-start gap-3">
                <div className="grid gap-1 rounded-lg border p-3 text-[13px]">
                  <div className="flex justify-between"><span className="text-muted-foreground">{t('Cash taken')}</span><span className="tabular">{formatMoney(num(w.cash))}</span></div>
                  {num(w.handed_owed) > 0 && <div className="flex justify-between"><span className="text-muted-foreground">{t('Handed over earlier')}</span><span className="tabular">− {formatMoney(num(w.handed_owed))}</span></div>}
                  <div className="flex justify-between border-t pt-1 font-semibold"><span>{t('To hand over')}</span><span className="tabular">{formatMoney(num(w.owed))}</span></div>
                </div>
                <CashCount currency={cur} counts={counts} onCounts={setCounts} direct={direct} onDirect={setDirect} byNotes={data.options?.count_notes ?? true} autoFocus />
                {touched && <div className={cn('flex justify-between rounded-md px-3 py-2 text-[13px] font-semibold', diff === 0 ? 'bg-success/10 text-success' : diff < 0 ? 'bg-destructive/10 text-destructive' : 'bg-warning/10 text-warning')}>
                  <span>{diff === 0 ? t('It matches') : diff < 0 ? t('Short|cash') : t('Over|cash')}</span><span className="tabular">{formatMoney(diff)}</span></div>}
                <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} aria-label={t('Note')}
                  placeholder={diff !== 0 && touched ? t('Why it differs (needed)') : t('Note (optional)')} />
                {error && <p className="text-[13px] text-destructive">{error}</p>}
                <div className="flex flex-wrap justify-end gap-2">
                  <Button variant="ghost" onClick={() => slip(w)}><Printer /> {t('Print his takings')}</Button>
                  <Button loading={busy} onClick={() => void take()}><HandCoins /> {t('Take in the handover')}</Button>
                </div>
              </div>
            ) : <p className="self-center text-center text-[13px] text-muted-foreground">{t('Choose a waiter who still owes.')}</p>}
          </div>
        )}
        <DialogFooter><Button variant="outline" onClick={onClose} disabled={busy}>{t('Close')}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** on the floor: a waiter sees the cash he holds, and prints his takings for the handover */
export function MyTakings({ data }: { data: TillData }) {
  const q = usePosWaiters(data.session?.id, true)
  const [open, setOpen] = React.useState(false)
  const me = (q.data?.waiters ?? []).find((w) => w.me)
  if (!me) return null
  const print = () => printWaiterSlip({ company: data.company.name, register: data.register.name, session: data.session!.number, waiter: me.name, receipts: me.receipts,
    cash: num(me.cash), card: num(me.card), other: num(me.other), owed: num(me.owed), at: new Date(), currency: data.company.base_currency, paper: data.register.paper_mm })
  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)} title={t('The cash you hold, to hand over at the till')}
        className={cn('shrink-0', owes(me) && 'border-warning/60 text-warning')}><Wallet /> {formatMoney(num(me.owed))}</Button>
      {open && (
        <Dialog open onOpenChange={setOpen}>
          <DialogContent className="sm:max-w-sm">
            <DialogHeader><DialogTitle>{t('My takings')}</DialogTitle>
              <DialogDescription>{t('The cash you took at your tables in this shift. Hand it over at the till before the shift closes.')}</DialogDescription></DialogHeader>
            <div className="grid gap-1 text-[13px]">
              <div className="flex justify-between"><span className="text-muted-foreground">{t('Receipts')}</span><span className="tabular">{me.receipts}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">{t('Card')}</span><span className="tabular">{formatMoney(num(me.card))}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">{t('Cash taken')}</span><span className="tabular">{formatMoney(num(me.cash))}</span></div>
              {num(me.handed) > 0 && <div className="flex justify-between"><span className="text-muted-foreground">{t('Handed over earlier')}</span><span className="tabular">{formatMoney(num(me.handed))}</span></div>}
              <div className="flex justify-between border-t pt-1 font-semibold"><span>{t('To hand over')}</span><span className="tabular">{formatMoney(num(me.owed))}</span></div>
            </div>
            <DialogFooter><Button variant="outline" onClick={() => setOpen(false)}>{t('Close')}</Button><Button onClick={print}><Printer /> {t('Print my takings')}</Button></DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </>
  )
}
