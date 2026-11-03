import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, ArrowDown, ArrowUp, Check, ClipboardCheck, Clock, ListPlus, Pencil, PenLine, Plus, Signature, Thermometer, Trash2 } from 'lucide-react'
import * as React from 'react'
import { useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'
import { useCompany } from '@/app/company-provider'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { EmptyState } from '@/components/empty-state'
import { ErrorState } from '@/components/error-state'
import { PageHeader } from '@/components/page-header'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import { useWarehouses } from '@/features/inventory/api'
import { iso } from '@/features/finance/pages/finance-overview-page'
import { formatDateWith, formatNumberWith, msg, t, td, tn } from '@/i18n'
import { describeError, unwrap } from '@/lib/errors'
import { supabase } from '@/lib/supabase'
import { cn, formatDate, num, todayISO } from '@/lib/utils'

type Item = { id: string; label: string; type: 'check' | 'number'; min?: number; max?: number; unit?: string; required?: boolean }
type Problem = { item_id: string; label: string; why: 'not_done' | 'missing' | 'low' | 'high'; value?: number; min?: number; max?: number; unit?: string }
type Answer = { ok?: boolean; value?: number | null; note?: string }
type DayList = { checklist_id: string; name: string; kind: string; due_time: string; items: Item[]; check_id: string | null; status: 'todo' | 'open' | 'done'
  answers: Record<string, Answer>; problems: Problem[]; note: string | null; done_by: string | null; done_at: string | null; signed_by: string | null; signed_at: string | null; late: boolean }
type Day = { date: string; today: string; can: { fill: boolean; sign: boolean; manage: boolean }; lists: DayList[] }
type Template = { id: string; warehouse_id: string | null; name: string; kind: string; weekdays: number[]; due_time: string; items: Item[]; is_active: boolean; position: number }

const KEY = 'store-checks'
const KIND: Record<string, string> = { opening: msg('Opening'), closing: msg('Closing'), hygiene: msg('Hygiene'), temperature: msg('Temperatures'), dates: msg('Dates and prices'), other: msg('Other') }
const WEEKDAYS = [msg('Mon'), msg('Tue'), msg('Wed'), msg('Thu'), msg('Fri'), msg('Sat'), msg('Sun')]
const WHY: Record<Problem['why'], string> = { not_done: msg('not done'), missing: msg('not read'), low: msg('too low'), high: msg('too high') }
const fmt = (v: number | null | undefined) => (v == null ? '' : formatNumberWith(num(v), { maximumFractionDigits: 1 }))
const range = (i: { min?: number; max?: number; unit?: string }) =>
  i.min != null && i.max != null ? `${fmt(i.min)} … ${fmt(i.max)} ${i.unit ?? ''}` : i.max != null ? t('at most {v}', { v: `${fmt(i.max)} ${i.unit ?? ''}` }) : i.min != null ? t('at least {v}', { v: `${fmt(i.min)} ${i.unit ?? ''}` }) : ''
const outOf = (i: Item, v: number | null | undefined) => v != null && ((i.min != null && v < i.min) || (i.max != null && v > i.max))

function useInvalidate() {
  const qc = useQueryClient()
  return () => qc.invalidateQueries({ queryKey: [KEY] })
}

/** The shop's daily checks: opening, dates and prices, hygiene, fridge temperatures, closing */
export function StoreChecksPage() {
  const { companyId } = useCompany()
  const [params, setParams] = useSearchParams()
  const warehouses = useWarehouses()
  const stores = (warehouses.data ?? []).filter((w) => w.is_active)
  const store = params.get('store') ?? stores[0]?.id ?? null
  const date = params.get('date') ?? todayISO()
  const tab = params.get('tab') ?? 'day'
  const set = (k: string, v: string | null) => setParams((p) => { const x = new URLSearchParams(p); if (v) x.set(k, v); else x.delete(k); return x }, { replace: true })
  const day = useQuery({
    queryKey: [KEY, 'day', companyId, store, date], enabled: !!companyId && !!store,
    queryFn: async () => unwrap(await supabase.rpc('store_checks_day', { p_company: companyId!, p_warehouse: store!, p_date: date })) as unknown as Day,
  })
  const d = day.data
  return (
    <>
      <PageHeader title={t('Daily checks')}
        description={t('The shop is checked at fixed times: opening, dates and prices, hygiene, fridge temperatures and closing. A reading out of its range is reported to the managers at once, and the shift leader signs each list.')} />
      <Card className="mb-4"><CardContent className="flex flex-wrap items-end gap-3 p-3">
        <div className="grid gap-1"><Label className="text-xs">{t('Store')}</Label>
          <Select value={store ?? ''} onValueChange={(v) => set('store', v)}><SelectTrigger className="h-8 w-[220px]" aria-label={t('Store')}><SelectValue placeholder={t('Choose a store')} /></SelectTrigger>
            <SelectContent>{stores.map((w) => <SelectItem key={w.id} value={w.id}>{td(w.name)}</SelectItem>)}</SelectContent></Select></div>
        {tab === 'day' && <div className="grid gap-1"><Label htmlFor="ck-date" className="text-xs">{t('Day')}</Label>
          <Input id="ck-date" type="date" className="h-8 w-[160px]" value={date} max={todayISO()} onChange={(e) => set('date', e.target.value || null)} /></div>}
      </CardContent></Card>
      <Tabs value={tab} onValueChange={(v) => set('tab', v === 'day' ? null : v)}>
        <TabsList>
          <TabsTrigger value="day">{t('The day')}</TabsTrigger>
          <TabsTrigger value="history">{t('History')}</TabsTrigger>
          {d?.can.manage && <TabsTrigger value="lists">{t('The lists')}</TabsTrigger>}
        </TabsList>
        <TabsContent value="day">
          {!store ? <EmptyState title={t('Choose a store')} /> : day.isError ? <ErrorState error={day.error} onRetry={() => void day.refetch()} /> : !d ? <Skeleton className="h-64" />
            : <DayView day={d} store={store} onLists={() => set('tab', 'lists')} />}
        </TabsContent>
        <TabsContent value="history">{store && <HistoryView store={store} />}</TabsContent>
        {d?.can.manage && <TabsContent value="lists"><ListsView stores={stores} /></TabsContent>}
      </Tabs>
    </>
  )
}

/* ------------------------------------------------------------------ the day */
function DayView({ day, store, onLists }: { day: Day; store: string; onLists: () => void }) {
  const { companyId } = useCompany()
  const refresh = useInvalidate()
  const [open, setOpen] = React.useState<DayList | null>(null)
  const defaults = useMutation({
    mutationFn: async () => unwrap(await supabase.rpc('store_checklists_defaults', { p_company: companyId! })) as unknown as number,
    onSuccess: (n) => { toast.success(tn(n, '{n} list added', '{n} lists added')); void refresh() },
    onError: (e) => toast.error(describeError(e)),
  })
  const sign = useMutation({
    mutationFn: async (id: string) => unwrap(await supabase.rpc('store_check_sign', { p_check: id })),
    onSuccess: () => { toast.success(t('Signed')); void refresh() },
    onError: (e) => toast.error(describeError(e)),
  })
  if (!day.lists.length) {
    return <Card><EmptyState icon={ClipboardCheck} title={t('No check lists for this store')}
      description={day.can.manage ? t('Start from the lists of the shop handbook (opening, dates and prices, hygiene, fridge temperatures, closing) and change them as you need.') : t('A store manager sets the lists up.')}
      action={day.can.manage && <div className="flex gap-2"><Button loading={defaults.isPending} onClick={() => defaults.mutate()}><ListPlus /> {t('Add the handbook lists')}</Button>
        <Button variant="outline" onClick={onLists}><Plus /> {t('Make my own')}</Button></div>} /></Card>
  }
  const done = day.lists.filter((l) => l.status === 'done').length
  const withProblems = day.lists.filter((l) => l.status === 'done' && l.problems.length).length
  const late = day.lists.filter((l) => l.late).length
  const editableDay = day.date >= iso(new Date(new Date(day.today).getTime() - 86_400_000))
  return (
    <div className="grid gap-3">
      <p className="text-[13px] text-muted-foreground">
        {t('{a} of {b} done', { a: done, b: day.lists.length })}
        {withProblems > 0 && <> · <span className="font-medium text-destructive">{tn(withProblems, '{n} with problems', '{n} with problems')}</span></>}
        {late > 0 && <> · <span className="font-medium text-warning">{tn(late, '{n} late', '{n} late')}</span></>}
      </p>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {day.lists.map((l) => {
          const state = l.signed_at ? 'signed' : l.status === 'done' ? (l.problems.length ? 'problems' : 'done') : l.late ? 'late' : l.status === 'open' ? 'started' : 'todo'
          return (
            <Card key={l.checklist_id} className={cn(state === 'problems' && 'border-destructive/50', state === 'late' && 'border-warning/50')}>
              <CardContent className="grid gap-2 p-4">
                <div className="flex items-start justify-between gap-2">
                  <div><div className="text-[15px] font-semibold">{l.name}</div>
                    <div className="flex items-center gap-1 text-xs text-muted-foreground"><Clock className="size-3" /> {l.due_time} · {t(KIND[l.kind] ?? KIND.other!)} · {tn(l.items.length, '{n} point', '{n} points')}</div></div>
                  <StateBadge state={state} />
                </div>
                {l.status === 'done' && l.problems.length > 0 && (
                  <ul className="grid gap-0.5 rounded-md bg-destructive/5 px-2.5 py-1.5 text-[13px] text-destructive">
                    {l.problems.map((p) => <li key={p.item_id} className="flex items-center gap-1.5"><AlertTriangle className="size-3.5 shrink-0" />{p.label}{p.value != null && <b className="tabular">{fmt(p.value)} {p.unit}</b>} <span className="opacity-80">({t(WHY[p.why])})</span></li>)}
                  </ul>
                )}
                {l.note && <p className="text-[13px] text-muted-foreground">“{l.note}”</p>}
                {l.done_by && l.status === 'done' && <p className="text-xs text-muted-foreground">{t('Done by {name} at {time}', { name: l.done_by, time: l.done_at ? formatDateWith(new Date(l.done_at), { hour: '2-digit', minute: '2-digit' }) : '' })}
                  {l.signed_by && <> · {t('signed by {name}', { name: l.signed_by })}</>}</p>}
                <div className="mt-1 flex flex-wrap gap-2">
                  {day.can.fill && !l.signed_at && editableDay && (
                    <Button size="sm" variant={l.status === 'done' ? 'outline' : 'default'} onClick={() => setOpen(l)}>{l.status === 'done' ? <><Pencil /> {t('Change|edit')}</> : <><PenLine /> {t('Fill in')}</>}</Button>
                  )}
                  {day.can.sign && l.status === 'done' && !l.signed_at && l.check_id && (
                    <Button size="sm" variant="outline" loading={sign.isPending && sign.variables === l.check_id} onClick={() => sign.mutate(l.check_id!)}><Signature /> {t('Sign')}</Button>
                  )}
                </div>
              </CardContent>
            </Card>
          )
        })}
      </div>
      {open && <FillDialog list={open} store={store} date={day.date} onClose={() => setOpen(null)} />}
    </div>
  )
}

function StateBadge({ state }: { state: string }) {
  const map: Record<string, [string, string]> = {
    todo: [msg('To do'), 'text-muted-foreground'], started: [msg('Started'), 'border-primary/40 text-primary'], late: [msg('Late'), 'border-warning/50 bg-warning/10 text-warning'],
    done: [msg('Done'), 'border-success/40 bg-success/10 text-success'], problems: [msg('Problems'), 'border-destructive/40 bg-destructive/10 text-destructive'],
    signed: [msg('Signed'), 'border-success/40 bg-success/10 text-success'],
  }
  const [label, cls] = map[state] ?? map.todo!
  return <Badge variant="outline" className={cn('shrink-0 whitespace-nowrap', cls)}>{t(label)}</Badge>
}

function FillDialog({ list, store, date, onClose }: { list: DayList; store: string; date: string; onClose: () => void }) {
  const refresh = useInvalidate()
  const [answers, setAnswers] = React.useState<Record<string, { ok: boolean; value: string }>>(() =>
    Object.fromEntries(list.items.map((i) => [i.id, { ok: !!list.answers[i.id]?.ok, value: list.answers[i.id]?.value != null ? String(list.answers[i.id]!.value) : '' }])))
  const [note, setNote] = React.useState(list.note ?? '')
  const save = useMutation({
    mutationFn: async (done: boolean) => unwrap(await supabase.rpc('store_check_submit', {
      p_checklist: list.checklist_id, p_warehouse: store, p_date: date, p_note: note || undefined, p_done: done,
      p_answers: Object.fromEntries(list.items.map((i) => [i.id, i.type === 'number'
        ? { value: answers[i.id]?.value.trim() ? num(answers[i.id]!.value.replace(',', '.')) : null } : { ok: !!answers[i.id]?.ok }])) as never,
    })) as unknown as { problems: Problem[] },
    onSuccess: (r, done) => {
      if (!done) toast.success(t('Kept; finish it later'))
      else if (r.problems.length) toast.warning(tn(r.problems.length, 'Done with {n} problem: the managers were told', 'Done with {n} problems: the managers were told'))
      else toast.success(t('Done: everything in order'))
      void refresh(); onClose()
    },
    onError: (e) => toast.error(describeError(e)),
  })
  const val = (i: Item) => (answers[i.id]?.value.trim() ? num(answers[i.id]!.value.replace(',', '.')) : null)
  const pending = list.items.filter((i) => (i.type === 'number' ? val(i) == null : !answers[i.id]?.ok) && i.required !== false).length
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{list.name}</DialogTitle>
          <DialogDescription>{t('Tick what is in order and write the readings. What is not in order: leave it, and say why in the note.')}</DialogDescription>
        </DialogHeader>
        <div className="grid max-h-[55vh] gap-1.5 overflow-y-auto pr-1">
          {list.items.map((i) => i.type === 'number' ? (
            <div key={i.id} className={cn('grid grid-cols-[minmax(0,1fr)_110px] items-center gap-3 rounded-md border p-2.5', outOf(i, val(i)) && 'border-destructive/60 bg-destructive/5')}>
              <Label htmlFor={`ck-${i.id}`} className="grid gap-0.5 text-[14px] font-normal"><span className="flex items-center gap-1.5"><Thermometer className="size-4 text-muted-foreground" />{i.label}</span>
                <span className={cn('text-xs', outOf(i, val(i)) ? 'font-medium text-destructive' : 'text-muted-foreground')}>{outOf(i, val(i)) ? t('Out of range: {r}', { r: range(i) }) : range(i)}</span></Label>
              <div className="flex items-center gap-1"><Input id={`ck-${i.id}`} inputMode="decimal" className="h-10 text-right text-base tabular" value={answers[i.id]?.value ?? ''}
                onChange={(e) => setAnswers((a) => ({ ...a, [i.id]: { ok: false, value: e.target.value } }))} /><span className="text-xs text-muted-foreground">{i.unit}</span></div>
            </div>
          ) : (
            <label key={i.id} className={cn('flex min-h-11 cursor-pointer items-center gap-3 rounded-md border p-2.5 text-[14px]', answers[i.id]?.ok && 'border-success/40 bg-success/5')}>
              <Checkbox className="size-5" checked={!!answers[i.id]?.ok} onCheckedChange={(v) => setAnswers((a) => ({ ...a, [i.id]: { ok: v === true, value: '' } }))} />
              <span className="flex-1">{i.label}</span>{i.required === false && <span className="text-xs text-muted-foreground">{t('(optional)')}</span>}
            </label>
          ))}
        </div>
        <div className="grid gap-1.5"><Label htmlFor="ck-note" optional>{t('Note')}</Label>
          <Textarea id="ck-note" rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder={t('e.g. The dairy fridge was called in for service')} /></div>
        <DialogFooter className="gap-2 sm:justify-between">
          <Button variant="ghost" loading={save.isPending && save.variables === false} onClick={() => save.mutate(false)}>{t('Keep for later')}</Button>
          <Button loading={save.isPending && save.variables === true} onClick={() => save.mutate(true)}>
            <Check /> {pending ? tn(pending, 'Finish ({n} not in order)', 'Finish ({n} not in order)') : t('Finish')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/* ------------------------------------------------------------------ history */
function HistoryView({ store }: { store: string }) {
  const { companyId } = useCompany()
  const to = todayISO()
  const from = iso(new Date(new Date(to).getTime() - 13 * 86_400_000))
  const q = useQuery({
    queryKey: [KEY, 'history', companyId, store, from, to], enabled: !!companyId,
    queryFn: async () => unwrap(await supabase.rpc('store_checks_history', { p_company: companyId!, p_warehouse: store, p_from: from, p_to: to })) as unknown as
      { days: string[]; lists: { checklist_id: string; name: string; cells: Record<string, string> }[] },
  })
  const CELL: Record<string, [string, string]> = {
    signed: ['bg-success', msg('Signed')], done: ['bg-success/50', msg('Done')], problems: ['bg-destructive', msg('Problems')],
    missed: ['bg-warning', msg('Missed')], todo: ['bg-muted-foreground/25', msg('To do')], off: ['bg-transparent border border-dashed border-border', msg('Not that day')],
  }
  if (q.isError) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />
  if (!q.data) return <Skeleton className="h-48" />
  const missed = q.data.lists.reduce((s, l) => s + Object.values(l.cells).filter((c) => c === 'missed').length, 0)
  const problems = q.data.lists.reduce((s, l) => s + Object.values(l.cells).filter((c) => c === 'problems').length, 0)
  return (
    <Card>
      <CardHeader><CardTitle>{t('The last two weeks')}</CardTitle>
        <p className="text-[13px] text-muted-foreground">{t('{a} lists missed, {b} with problems', { a: missed, b: problems })}</p></CardHeader>
      <CardContent className="overflow-x-auto">
        {!q.data.lists.length ? <EmptyState compact title={t('No check lists for this store')} /> : (
          <table className="text-[13px]">
            <thead><tr><th className="pr-3 text-left font-normal text-muted-foreground" />
              {q.data.days.map((d) => <th key={d} className="px-1 pb-1 text-center text-[11px] font-normal text-muted-foreground">{formatDateWith(new Date(d), { day: 'numeric' })}<br />{formatDateWith(new Date(d), { weekday: 'narrow' })}</th>)}</tr></thead>
            <tbody>{q.data.lists.map((l) => (
              <tr key={l.checklist_id}><td className="whitespace-nowrap py-1 pr-3 font-medium">{l.name}</td>
                {q.data.days.map((d) => { const c = l.cells[d] ?? 'off'; return (
                  <td key={d} className="px-1 py-1 text-center"><span title={`${formatDate(d)} · ${t(CELL[c]![1])}`} className={cn('inline-block size-4 rounded', CELL[c]![0])} /></td>
                ) })}</tr>
            ))}</tbody>
          </table>
        )}
        <div className="mt-3 flex flex-wrap gap-3 text-xs text-muted-foreground">
          {(['signed', 'done', 'problems', 'missed', 'off'] as const).map((k) => <span key={k} className="inline-flex items-center gap-1"><span className={cn('inline-block size-3 rounded', CELL[k]![0])} />{t(CELL[k]![1])}</span>)}
        </div>
      </CardContent>
    </Card>
  )
}

/* ------------------------------------------------------------------ the lists */
function ListsView({ stores }: { stores: { id: string; name: string }[] }) {
  const { companyId } = useCompany()
  const refresh = useInvalidate()
  const q = useQuery({
    queryKey: [KEY, 'templates', companyId], enabled: !!companyId,
    queryFn: async () => unwrap(await supabase.from('store_checklists').select('id, warehouse_id, name, kind, weekdays, due_time, items, is_active, position')
      .eq('company_id', companyId!).is('deleted_at', null).order('due_time').order('position')) as unknown as Template[],
  })
  const [edit, setEdit] = React.useState<Template | 'new' | null>(null)
  const del = useMutation({
    mutationFn: async (id: string) => unwrap(await supabase.rpc('store_checklist_delete', { p_id: id })),
    onSuccess: () => { toast.success(t('List removed')); void refresh() },
    onError: (e) => toast.error(describeError(e)),
  })
  const defaults = useMutation({
    mutationFn: async () => unwrap(await supabase.rpc('store_checklists_defaults', { p_company: companyId! })) as unknown as number,
    onSuccess: (n) => { toast.success(n ? tn(n, '{n} list added', '{n} lists added') : t('The handbook lists are already here')); void refresh() },
    onError: (e) => toast.error(describeError(e)),
  })
  const storeName = (id: string | null) => (id ? td(stores.find((s) => s.id === id)?.name ?? '') : t('Every store'))
  return (
    <Card>
      <CardHeader className="flex-row flex-wrap items-center justify-between gap-2 space-y-0">
        <CardTitle>{t('The check lists')}</CardTitle>
        <div className="flex gap-2"><Button variant="outline" size="sm" loading={defaults.isPending} onClick={() => defaults.mutate()}><ListPlus /> {t('Add the handbook lists')}</Button>
          <Button size="sm" onClick={() => setEdit('new')}><Plus /> {t('New list')}</Button></div>
      </CardHeader>
      <CardContent className="p-0">
        {q.isError ? <ErrorState error={q.error} onRetry={() => void q.refetch()} /> : !q.data ? <Skeleton className="h-40" /> : !q.data.length ? <EmptyState compact title={t('No check lists yet')} /> : (
          <Table>
            <TableHeader><TableRow><TableHead>{t('List')}</TableHead><TableHead>{t('Store')}</TableHead><TableHead>{t('When')}</TableHead><TableHead className="text-right">{t('Points')}</TableHead><TableHead /></TableRow></TableHeader>
            <TableBody>{q.data.map((c) => (
              <TableRow key={c.id} className={cn(!c.is_active && 'opacity-60')}>
                <TableCell className="font-medium">{c.name}<span className="block text-xs font-normal text-muted-foreground">{t(KIND[c.kind] ?? KIND.other!)}{!c.is_active && ` · ${t('paused')}`}</span></TableCell>
                <TableCell>{storeName(c.warehouse_id)}</TableCell>
                <TableCell className="whitespace-nowrap">{c.due_time.slice(0, 5)} · {c.weekdays.length === 7 ? t('every day') : c.weekdays.map((d) => t(WEEKDAYS[d - 1]!)).join(', ')}</TableCell>
                <TableCell className="text-right tabular">{c.items.length}</TableCell>
                <TableCell className="whitespace-nowrap text-right">
                  <Button variant="ghost" size="icon-sm" aria-label={t('Edit {name}', { name: c.name })} onClick={() => setEdit(c)}><Pencil /></Button>
                  <ConfirmDialog trigger={<Button variant="ghost" size="icon-sm" aria-label={t('Delete {name}', { name: c.name })}><Trash2 /></Button>} title={t('Delete {name}?', { name: c.name })}
                    description={t('The days already done stay in the history.')} confirmLabel={t('Delete')} destructive onConfirm={() => del.mutateAsync(c.id)} />
                </TableCell>
              </TableRow>
            ))}</TableBody>
          </Table>
        )}
      </CardContent>
      {edit && <ListDialog list={edit === 'new' ? null : edit} stores={stores} onClose={() => setEdit(null)} />}
    </Card>
  )
}

type EditItem = { key: string; id?: string; label: string; type: 'check' | 'number'; min: string; max: string; unit: string; required: boolean }
function ListDialog({ list, stores, onClose }: { list: Template | null; stores: { id: string; name: string }[]; onClose: () => void }) {
  const { companyId } = useCompany()
  const refresh = useInvalidate()
  const [name, setName] = React.useState(list?.name ?? '')
  const [kind, setKind] = React.useState(list?.kind ?? 'other')
  const [store, setStore] = React.useState(list?.warehouse_id ?? '__all')
  const [time, setTime] = React.useState(list?.due_time.slice(0, 5) ?? '09:00')
  const [days, setDays] = React.useState<number[]>(list?.weekdays ?? [1, 2, 3, 4, 5, 6, 7])
  const [active, setActive] = React.useState(list?.is_active ?? true)
  const [items, setItems] = React.useState<EditItem[]>(() => (list?.items ?? [{ id: '', label: '', type: 'check' } as Item]).map((i) => ({
    key: crypto.randomUUID(), id: i.id, label: i.label, type: i.type, min: i.min != null ? String(i.min) : '', max: i.max != null ? String(i.max) : '', unit: i.unit ?? (i.type === 'number' ? '°C' : ''), required: i.required !== false })))
  const upd = (key: string, p: Partial<EditItem>) => setItems((xs) => xs.map((x) => (x.key === key ? { ...x, ...p } : x)))
  const move = (idx: number, by: number) => setItems((xs) => { const a = [...xs]; const [x] = a.splice(idx, 1); a.splice(idx + by, 0, x!); return a })
  const save = useMutation({
    mutationFn: async () => unwrap(await supabase.rpc('store_checklist_save', { p: {
      ...(list ? { id: list.id } : { company_id: companyId }), name, kind, warehouse_id: store === '__all' ? null : store, due_time: time, weekdays: days, is_active: active,
      items: items.map((i) => ({ id: i.id, label: i.label, type: i.type, min: i.type === 'number' ? i.min.replace(',', '.') : '', max: i.type === 'number' ? i.max.replace(',', '.') : '', unit: i.type === 'number' ? i.unit : '', required: i.required })),
    } as never })),
    onSuccess: () => { toast.success(t('List saved')); void refresh(); onClose() },
    onError: (e) => toast.error(describeError(e)),
  })
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader><DialogTitle>{list ? t('Edit {name}', { name: list.name }) : t('New check list')}</DialogTitle>
          <DialogDescription>{t('A tick for what is checked by eye, a reading with its range for temperatures. Changes apply from the next time the list is filled in.')}</DialogDescription></DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="grid gap-1.5"><Label htmlFor="cl-name">{t('Name')}</Label><Input id="cl-name" value={name} onChange={(e) => setName(e.target.value)} /></div>
          <div className="grid gap-1.5"><Label>{t('Kind')}</Label><Select value={kind} onValueChange={setKind}><SelectTrigger aria-label={t('Kind')}><SelectValue /></SelectTrigger>
            <SelectContent>{Object.entries(KIND).map(([k, v]) => <SelectItem key={k} value={k}>{t(v)}</SelectItem>)}</SelectContent></Select></div>
          <div className="grid gap-1.5"><Label>{t('Store')}</Label><Select value={store} onValueChange={setStore}><SelectTrigger aria-label={t('Store')}><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="__all">{t('Every store')}</SelectItem>{stores.map((s) => <SelectItem key={s.id} value={s.id}>{td(s.name)}</SelectItem>)}</SelectContent></Select></div>
          <div className="grid gap-1.5"><Label htmlFor="cl-time">{t('By what time')}</Label><Input id="cl-time" type="time" value={time} onChange={(e) => setTime(e.target.value)} /></div>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {WEEKDAYS.map((w, i) => { const d = i + 1; const on = days.includes(d); return (
            <Button key={w} type="button" size="sm" variant={on ? 'default' : 'outline'} className="h-8 w-11" aria-pressed={on}
              onClick={() => setDays((xs) => (on ? xs.filter((x) => x !== d) : [...xs, d].sort()))}>{t(w)}</Button>
          ) })}
          <label className="ml-auto flex items-center gap-2 text-[13px]"><Checkbox checked={active} onCheckedChange={(v) => setActive(v === true)} /> {t('In use')}</label>
        </div>
        <div className="grid max-h-[40vh] gap-2 overflow-y-auto pr-1">
          {items.map((i, idx) => (
            <div key={i.key} className="grid grid-cols-[minmax(0,1fr)_120px_auto] items-start gap-2 rounded-md border p-2">
              <div className="grid gap-1.5">
                <Input value={i.label} placeholder={t('What is checked')} aria-label={t('Point {n}', { n: idx + 1 })} onChange={(e) => upd(i.key, { label: e.target.value })} />
                {i.type === 'number' && <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                  {t('from')}<Input className="h-8 w-20 text-right" inputMode="decimal" value={i.min} aria-label={t('Lowest')} onChange={(e) => upd(i.key, { min: e.target.value })} />
                  {t('to')}<Input className="h-8 w-20 text-right" inputMode="decimal" value={i.max} aria-label={t('Highest')} onChange={(e) => upd(i.key, { max: e.target.value })} />
                  <Input className="h-8 w-16" value={i.unit} aria-label={t('Unit')} onChange={(e) => upd(i.key, { unit: e.target.value })} /></div>}
                <label className="flex items-center gap-1.5 text-xs text-muted-foreground"><Checkbox checked={i.required} onCheckedChange={(v) => upd(i.key, { required: v === true })} /> {t('Must be done')}</label>
              </div>
              <Select value={i.type} onValueChange={(v) => upd(i.key, { type: v as EditItem['type'], unit: v === 'number' && !i.unit ? '°C' : i.unit })}>
                <SelectTrigger aria-label={t('Type')}><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="check">{t('Tick')}</SelectItem><SelectItem value="number">{t('Reading')}</SelectItem></SelectContent></Select>
              <div className="flex">
                <Button variant="ghost" size="icon-sm" disabled={idx === 0} aria-label={t('Move up')} onClick={() => move(idx, -1)}><ArrowUp /></Button>
                <Button variant="ghost" size="icon-sm" disabled={idx === items.length - 1} aria-label={t('Move down')} onClick={() => move(idx, 1)}><ArrowDown /></Button>
                <Button variant="ghost" size="icon-sm" disabled={items.length === 1} aria-label={t('Remove')} onClick={() => setItems((xs) => xs.filter((x) => x.key !== i.key))}><Trash2 /></Button>
              </div>
            </div>
          ))}
          <Button variant="outline" size="sm" className="justify-self-start" onClick={() => setItems((xs) => [...xs, { key: crypto.randomUUID(), label: '', type: 'check', min: '', max: '', unit: '', required: true }])}><Plus /> {t('Add a point')}</Button>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{t('Cancel')}</Button>
          <Button loading={save.isPending} disabled={name.trim().length < 2 || !days.length || !items.some((i) => i.label.trim())} onClick={() => save.mutate()}><Check /> {t('Save the list')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
