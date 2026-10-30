import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { CalendarRange, Pencil, Plus, Split, Trash2 } from 'lucide-react'
import * as React from 'react'
import { toast } from 'sonner'
import { Can, useCompany } from '@/app/company-provider'
import { EmptyState } from '@/components/empty-state'
import { ErrorState } from '@/components/error-state'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { t, td } from '@/i18n'
import type { Tables } from '@/lib/database.types'
import { describeError, unwrap } from '@/lib/errors'
import { supabase } from '@/lib/supabase'
import { cn, formatDate, formatMoney, num } from '@/lib/utils'

type Part = { pct: number; days: number }
type Term = Tables<'payment_terms'>

const addDays = (iso: string, n: number) => { const d = new Date(iso + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10) }
const parts = (v: unknown): Part[] | null => Array.isArray(v) && v.length ? (v as Part[]) : null
/** "40% now · 60% in 30 days" */
export function describeInstalments(v: unknown): string {
  const p = parts(v)
  if (!p) return ''
  return p.map((x) => x.days ? t('{pct}% in {n} days', { pct: x.pct, n: x.days }) : t('{pct}% now', { pct: x.pct })).join(' · ')
}

/* ------------------------------------------------------------------ payment terms (Finance setup) */
function useTerms() {
  const { companyId } = useCompany()
  return useQuery({
    queryKey: ['fin', companyId, 'list', 'payment-terms-all'],
    enabled: !!companyId,
    queryFn: async () => unwrap(await supabase.from('payment_terms').select('*').eq('company_id', companyId).is('deleted_at', null).order('due_days')),
  })
}

export function PaymentTerms() {
  const terms = useTerms()
  const [edit, setEdit] = React.useState<Partial<Term> | null>(null)
  if (terms.isLoading) return <Skeleton className="h-48" />
  if (terms.isError) return <Card><ErrorState error={terms.error} onRetry={() => void terms.refetch()} /></Card>
  return (
    <Card>
      <CardHeader className="flex-row flex-wrap items-start justify-between gap-2 space-y-0">
        <div><CardTitle>{t('Payment terms')}</CardTitle>
          <CardDescription>{t('When customers and suppliers pay: in one go after some days, with a discount for paying early, or in instalments.')}</CardDescription></div>
        <Can perm="finance.write"><Button size="sm" onClick={() => setEdit({ due_days: 30, discount_pct: 0, discount_days: 0, is_active: true })}><Plus /> {t('New term')}</Button></Can>
      </CardHeader>
      <CardContent className="p-0">
        {!terms.data?.length ? <EmptyState compact title={t('No payment terms')} /> : (
          <Table>
            <TableHeader><TableRow className="hover:bg-transparent">
              <TableHead>{t('Name')}</TableHead><TableHead>{t('Due')}</TableHead><TableHead className="hidden md:table-cell">{t('Discount if paid early')}</TableHead><TableHead />
            </TableRow></TableHeader>
            <TableBody>
              {terms.data.map((x) => (
                <TableRow key={x.id} className={cn('hover:bg-transparent', !x.is_active && 'opacity-50')}>
                  <TableCell><div className="font-medium">{td(x.name)}</div><div className="font-mono text-xs text-muted-foreground">{x.code}</div></TableCell>
                  <TableCell className="text-[13px]">{parts(x.instalments)
                    ? <span className="flex flex-wrap items-center gap-1.5"><Badge variant="secondary"><Split className="size-3" /> {t('{n} instalments', { n: parts(x.instalments)!.length })}</Badge>
                        <span className="text-muted-foreground">{describeInstalments(x.instalments)}</span></span>
                    : x.due_days ? t('In {n} days', { n: x.due_days }) : t('At once')}</TableCell>
                  <TableCell className="hidden text-[13px] md:table-cell">{num(x.discount_pct) > 0 ? t('{pct}% within {n} days', { pct: num(x.discount_pct), n: x.discount_days }) : '—'}</TableCell>
                  <TableCell className="text-right"><Can perm="finance.write"><Button size="sm" variant="ghost" onClick={() => setEdit(x)}><Pencil className="size-3.5" /> {t('Edit')}</Button></Can></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
      {edit && <TermDialog term={edit} onClose={() => setEdit(null)} />}
    </Card>
  )
}

function TermDialog({ term, onClose }: { term: Partial<Term>; onClose: () => void }) {
  const { companyId } = useCompany()
  const qc = useQueryClient()
  const [v, setV] = React.useState({
    code: term.code ?? '', name: term.name ?? '', due_days: String(term.due_days ?? 30),
    discount_pct: String(num(term.discount_pct)), discount_days: String(term.discount_days ?? 0), is_active: term.is_active ?? true,
  })
  const [split, setSplit] = React.useState<{ pct: string; days: string }[]>(
    parts(term.instalments)?.map((p) => ({ pct: String(p.pct), days: String(p.days) })) ?? [])
  const sumPct = split.reduce((s, p) => s + num(p.pct), 0)
  const daysOk = split.every((p, i) => i === 0 || num(p.days) >= num(split[i - 1]!.days))
  const splitOk = !split.length || (split.length >= 2 && Math.abs(sumPct - 100) < 0.001 && daysOk && split.every((p) => num(p.pct) > 0))
  const ok = v.code.trim() && v.name.trim() && splitOk
  const save = useMutation({
    mutationFn: async () => {
      const row = {
        code: v.code.trim(), name: v.name.trim(), is_active: v.is_active,
        due_days: split.length ? Math.max(...split.map((p) => num(p.days))) : Math.max(0, Math.round(num(v.due_days))),
        discount_pct: num(v.discount_pct), discount_days: Math.round(num(v.discount_days)),
        instalments: split.length ? split.map((p) => ({ pct: num(p.pct), days: Math.round(num(p.days)) })) : null,
      }
      return term.id ? unwrap(await supabase.from('payment_terms').update(row as never).eq('id', term.id))
        : unwrap(await supabase.from('payment_terms').insert({ ...row, company_id: companyId } as never))
    },
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['fin', companyId] }); void qc.invalidateQueries({ queryKey: ['sales', companyId] }); toast.success(t('Saved')); onClose() },
    onError: (e) => toast.error(describeError(e)),
  })
  const even = (n: number) => {
    const base = Math.floor(10000 / n) / 100
    setSplit(Array.from({ length: n }, (_, i) => ({ pct: String(i === n - 1 ? Math.round((100 - base * (n - 1)) * 100) / 100 : base), days: String(i * 30) })))
  }
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle>{term.id ? t('Edit payment term') : t('New term')}</DialogTitle></DialogHeader>
        <div className="grid gap-3">
          <div className="grid grid-cols-[120px_minmax(0,1fr)] gap-3">
            <div className="grid gap-1.5"><Label htmlFor="pt-code">{t('Code')}</Label><Input id="pt-code" value={v.code} onChange={(e) => setV({ ...v, code: e.target.value })} placeholder="K3" /></div>
            <div className="grid gap-1.5"><Label htmlFor="pt-name">{t('Name')}</Label><Input id="pt-name" value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} placeholder={t('e.g. 3 monthly instalments')} /></div>
          </div>
          {!split.length && <div className="grid gap-1.5"><Label htmlFor="pt-days">{t('Pay within (days)')}</Label>
            <Input id="pt-days" inputMode="numeric" className="w-32" value={v.due_days} onChange={(e) => setV({ ...v, due_days: e.target.value })} /></div>}
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5"><Label htmlFor="pt-dp">{t('Discount for paying early (%)')}</Label><Input id="pt-dp" inputMode="decimal" value={v.discount_pct} onChange={(e) => setV({ ...v, discount_pct: e.target.value })} /></div>
            <div className="grid gap-1.5"><Label htmlFor="pt-dd">{t('If paid within (days)')}</Label><Input id="pt-dd" inputMode="numeric" value={v.discount_days} onChange={(e) => setV({ ...v, discount_days: e.target.value })} /></div>
          </div>

          <div className="rounded-md border p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div><div className="text-sm font-medium">{t('Instalments')}</div><div className="text-xs text-muted-foreground">{t('Split the total into parts, each with its own number of days after the document date.')}</div></div>
              {!split.length ? <div className="flex gap-1">{[2, 3, 4, 6].map((n) => <Button key={n} size="sm" variant="outline" onClick={() => even(n)}>{n}×</Button>)}</div>
                : <Button size="sm" variant="ghost" onClick={() => setSplit([])}>{t('In one go')}</Button>}
            </div>
            {!!split.length && (
              <div className="mt-3 grid gap-2">
                {split.map((p, i) => (
                  <div key={i} className="flex items-center gap-2 text-[13px]">
                    <span className="w-14 text-muted-foreground">{t('Part {n}', { n: i + 1 })}</span>
                    <Input inputMode="decimal" className="h-8 w-20 text-right tabular" value={p.pct} aria-label={t('Percent')}
                      onChange={(e) => setSplit(split.map((x, j) => j === i ? { ...x, pct: e.target.value } : x))} /><span>%</span>
                    <span className="text-muted-foreground">{t('after')}</span>
                    <Input inputMode="numeric" className="h-8 w-20 text-right tabular" value={p.days} aria-label={t('Days')}
                      onChange={(e) => setSplit(split.map((x, j) => j === i ? { ...x, days: e.target.value } : x))} /><span>{t('days')}</span>
                    <Button size="icon" variant="ghost" className="ml-auto size-7" aria-label={t('Remove')} onClick={() => setSplit(split.filter((_, j) => j !== i))}><Trash2 className="size-3.5" /></Button>
                  </div>
                ))}
                <div className="flex items-center justify-between">
                  <Button size="sm" variant="ghost" onClick={() => setSplit([...split, { pct: '', days: String(num(split.at(-1)?.days) + 30) }])}><Plus /> {t('Add a part')}</Button>
                  <span className={cn('text-xs tabular', Math.abs(sumPct - 100) < 0.001 ? 'text-muted-foreground' : 'text-destructive')}>{t('Total {pct}%', { pct: Math.round(sumPct * 100) / 100 })}</span>
                </div>
                {!daysOk && <p className="text-xs text-destructive">{t('Each part must come on the same day or later than the one before.')}</p>}
              </div>
            )}
          </div>
          {term.id && <div className="flex items-center gap-2"><Switch id="pt-on" checked={v.is_active} onCheckedChange={(x) => setV({ ...v, is_active: x })} /><Label htmlFor="pt-on">{t('In use')}</Label></div>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{t('Cancel')}</Button>
          <Button disabled={!ok} loading={save.isPending} onClick={() => save.mutate()}>{t('Save')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/* ------------------------------------------------------------------ the schedule on an invoice or a supplier bill */
type Line = { seq: number; due_date: string; amount: number; paid: number; open: number; overdue: boolean }

export function InstalmentsCard({ docType, id, total, date, status, currency }: {
  docType: 'sales_invoice' | 'vendor_bill'; id: string; total: number; date: string; status: string; currency?: string
}) {
  const { companyId } = useCompany()
  const qc = useQueryClient()
  const key = ['fin', companyId, 'instalments', docType, id]
  const q = useQuery({
    queryKey: key, enabled: !!id,
    queryFn: async () => unwrap(await supabase.rpc('document_instalment_list', { p_doc_type: docType, p_id: id })) as unknown as Line[],
  })
  const [open, setOpen] = React.useState(false)
  const lines = q.data ?? []
  const canEdit = status === 'draft' || status === 'posted'
  if (q.isLoading) return null
  if (!lines.length && !canEdit) return null
  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between gap-2 space-y-0 pb-2">
        <div><CardTitle className="flex items-center gap-2"><CalendarRange className="size-4 text-muted-foreground" /> {t('Instalments')}</CardTitle>
          {!lines.length && <CardDescription>{t('Paid in one go. Split it if it is paid in parts.')}</CardDescription>}</div>
        {canEdit && <Can perm="invoicing.write"><Button size="sm" variant="outline" onClick={() => setOpen(true)}>{lines.length ? <><Pencil className="size-3.5" /> {t('Change|edit')}</> : <><Split className="size-3.5" /> {t('Split into instalments')}</>}</Button></Can>}
      </CardHeader>
      {!!lines.length && (
        <CardContent className="p-0">
          <Table>
            <TableHeader><TableRow className="hover:bg-transparent">
              <TableHead className="w-10">#</TableHead><TableHead>{t('Due date')}</TableHead><TableHead className="text-right">{t('Amount')}</TableHead><TableHead className="text-right">{t('Open|amount')}</TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {lines.map((l) => (
                <TableRow key={l.seq} className="hover:bg-transparent">
                  <TableCell className="text-muted-foreground">{l.seq}</TableCell>
                  <TableCell className="whitespace-nowrap">{formatDate(l.due_date)}{l.overdue && <span className="block text-xs text-destructive">{t('Overdue')}</span>}</TableCell>
                  <TableCell className="whitespace-nowrap text-right tabular">{formatMoney(l.amount)}</TableCell>
                  <TableCell className="whitespace-nowrap text-right tabular">{num(l.open) === 0 ? <span className="text-success">{t('Paid')}</span> : formatMoney(l.open)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      )}
      {open && <ScheduleDialog lines={lines} total={total} date={date} currency={currency} posted={status === 'posted'}
        onClose={() => setOpen(false)}
        onSave={async (rows) => {
          try {
            unwrap(await supabase.rpc('set_instalments', { p_doc_type: docType, p_id: id, p_rows: rows as never }))
            await qc.invalidateQueries({ queryKey: ['fin', companyId] })
            toast.success(t('Saved')); setOpen(false)
          } catch (e) { toast.error(describeError(e)) }
        }} />}
    </Card>
  )
}

function ScheduleDialog({ lines, total, date, currency, posted, onClose, onSave }: {
  lines: Line[]; total: number; date: string; currency?: string; posted: boolean; onClose: () => void; onSave: (rows: { due_date: string; amount: number }[]) => Promise<void>
}) {
  const [rows, setRows] = React.useState<{ due_date: string; amount: string }[]>(
    lines.length ? lines.map((l) => ({ due_date: l.due_date, amount: num(l.amount).toFixed(2) })) : [])
  const [busy, setBusy] = React.useState(false)
  const even = (n: number) => {
    const part = Math.floor((total / n) * 100) / 100
    setRows(Array.from({ length: n }, (_, i) => ({ due_date: addDays(date, i * 30), amount: (i === n - 1 ? total - part * (n - 1) : part).toFixed(2) })))
  }
  const sum = rows.reduce((s, r) => s + num(r.amount), 0)
  const diff = Math.round((total - sum) * 100) / 100
  const ok = !rows.length || (rows.length >= 2 && rows.every((r) => r.due_date && r.due_date >= date && num(r.amount) > 0) && (!posted || Math.abs(diff) < 0.005))
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>{t('Instalments')}</DialogTitle>
          <DialogDescription>{t('Total {amount}. The oldest instalment is paid first.', { amount: formatMoney(total, currency) })}</DialogDescription></DialogHeader>
        <div className="flex flex-wrap gap-1"><span className="mr-1 self-center text-xs text-muted-foreground">{t('Equal parts, monthly:')}</span>
          {[2, 3, 4, 6, 12].map((n) => <Button key={n} size="sm" variant="outline" onClick={() => even(n)}>{n}×</Button>)}</div>
        <div className="grid gap-2">
          {rows.map((r, i) => (
            <div key={i} className="flex items-center gap-2">
              <span className="w-5 text-xs text-muted-foreground">{i + 1}</span>
              <Input type="date" className="h-8 w-[150px]" value={r.due_date} aria-label={t('Due date')} onChange={(e) => setRows(rows.map((x, j) => j === i ? { ...x, due_date: e.target.value } : x))} />
              <Input inputMode="decimal" className="h-8 flex-1 text-right tabular" value={r.amount} aria-label={t('Amount')} onChange={(e) => setRows(rows.map((x, j) => j === i ? { ...x, amount: e.target.value } : x))} />
              <Button size="icon" variant="ghost" className="size-7" aria-label={t('Remove')} onClick={() => setRows(rows.filter((_, j) => j !== i))}><Trash2 className="size-3.5" /></Button>
            </div>
          ))}
          <div className="flex items-center justify-between">
            <Button size="sm" variant="ghost" onClick={() => setRows([...rows, { due_date: addDays(rows.at(-1)?.due_date ?? date, 30), amount: Math.max(diff, 0).toFixed(2) }])}><Plus /> {t('Add a part')}</Button>
            {!!rows.length && <span className={cn('text-xs tabular', Math.abs(diff) < 0.005 ? 'text-muted-foreground' : 'text-destructive')}>
              {Math.abs(diff) < 0.005 ? t('Adds up to the total') : t('{amount} left to share out', { amount: formatMoney(diff, currency) })}</span>}
          </div>
          {!rows.length && <p className="text-xs text-muted-foreground">{t('Without instalments the whole amount is due on the due date.')}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{t('Cancel')}</Button>
          <Button disabled={!ok} loading={busy} onClick={async () => { setBusy(true); try { await onSave(rows.map((r) => ({ due_date: r.due_date, amount: num(r.amount) }))) } finally { setBusy(false) } }}>{t('Save')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
