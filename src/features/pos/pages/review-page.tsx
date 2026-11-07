import type { ColumnDef } from '@tanstack/react-table'
import { CheckCheck, RotateCcw, Undo2 } from 'lucide-react'
import * as React from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { useAuth } from '@/app/auth-provider'
import { useCompany } from '@/app/company-provider'
import { ColumnHeader, DataTable } from '@/components/data-table/data-table'
import { PageHeader } from '@/components/page-header'
import { StatCard } from '@/components/stat-card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import { msg, t, td } from '@/i18n'
import { describeError } from '@/lib/errors'
import { cn, formatDate, formatMoney, num } from '@/lib/utils'
import { useReconcile, useRecount, useReviewList, useReviewReturn, useSessionReviews, type ReviewRow } from '../api'

const STATUS: Record<ReviewRow['review_status'], { label: string; tone: 'warning' | 'secondary' | 'success' }> = {
  pending: { label: msg('Waiting for the manager'), tone: 'warning' },
  returned: { label: msg('Back with the cashier'), tone: 'secondary' },
  reconciled: { label: msg('Reconciled'), tone: 'success' },
}
const STEP: Record<string, string> = { returned: msg('Returned for a recount'), recounted: msg('Counted again'), reconciled: msg('Reconciled') }
export const reviewStatusLabel = (s: string) => t(STATUS[s as ReviewRow['review_status']]?.label ?? s)
export const reviewStatusTone = (s: string) => STATUS[s as ReviewRow['review_status']]?.tone ?? 'secondary'

const money = (v: number | null | undefined) => (v === null || v === undefined ? '—' : formatMoney(num(v)))
const Diff = ({ v }: { v: number | null | undefined }) => v === null || v === undefined ? <span className="text-muted-foreground">—</span>
  : <span className={cn('tabular font-medium', num(v) === 0 ? 'text-success' : num(v) < 0 ? 'text-destructive' : 'text-warning')}>{formatMoney(num(v))}</span>

/** "Barazimi i arkave": the shifts the cashiers closed, for the manager to check and confirm. */
export function PosReviewPage() {
  const { company, can } = useCompany()
  const navigate = useNavigate()
  const [tab, setTab] = React.useState<'pending' | 'returned' | 'reconciled' | 'all'>('pending')
  const q = useReviewList(tab === 'reconciled' || tab === 'all' ? tab : 'open')
  const rows = React.useMemo(() => (q.data ?? []).filter((r) => tab === 'all' || tab === 'reconciled' || r.review_status === tab), [q.data, tab])
  const open = useReviewList('open')
  const pending = (open.data ?? []).filter((r) => r.review_status === 'pending')
  const [acting, setActing] = React.useState<{ row: ReviewRow; kind: 'reconcile' | 'return' } | null>(null)
  const manager = can('pos.approve')

  const columns = React.useMemo<ColumnDef<ReviewRow>[]>(() => [
    { accessorKey: 'number', meta: { label: t('Shift') }, header: ({ column }) => <ColumnHeader column={column} title={t('Shift')} />,
      cell: ({ row }) => <Link className="font-medium text-primary hover:underline" to={`/pos/sessions/${row.original.id}`} onClick={(e) => e.stopPropagation()}>{row.original.number}</Link> },
    { accessorKey: 'register', meta: { label: t('Till') }, header: ({ column }) => <ColumnHeader column={column} title={t('Till')} />, cell: ({ row }) => <span>{row.original.register}<span className="block text-[11px] text-muted-foreground">{td(row.original.unit)}</span></span> },
    { accessorKey: 'closed_by', meta: { label: t('Cashier') }, header: ({ column }) => <ColumnHeader column={column} title={t('Cashier')} />, cell: ({ row }) => row.original.closed_by ?? row.original.opened_by ?? '—' },
    { accessorKey: 'closed_at', meta: { label: t('Closed') }, header: ({ column }) => <ColumnHeader column={column} title={t('Closed')} />,
      cell: ({ row }) => <span>{formatDate(row.original.closed_at, true)}{row.original.review_status !== 'reconciled' && <span className={cn('block text-[11px]', row.original.hours_waiting > 24 ? 'text-destructive' : 'text-muted-foreground')}>{t('{n} h waiting', { n: Math.round(row.original.hours_waiting) })}</span>}</span> },
    { accessorKey: 'sales', meta: { label: t('Sales'), align: 'right' }, header: ({ column }) => <ColumnHeader column={column} title={t('Sales')} />, cell: ({ row }) => money(row.original.sales) },
    { accessorKey: 'expected', meta: { label: t('Expected in drawer'), align: 'right' }, header: ({ column }) => <ColumnHeader column={column} title={t('Expected in drawer')} />, cell: ({ row }) => money(row.original.expected) },
    { accessorKey: 'cashier_counted', meta: { label: t('Cashier counted'), align: 'right' }, header: ({ column }) => <ColumnHeader column={column} title={t('Cashier counted')} />, cell: ({ row }) => money(row.original.cashier_counted) },
    { accessorKey: 'cashier_difference', meta: { label: t('Difference by the cashier'), align: 'right' }, header: ({ column }) => <ColumnHeader column={column} title={t('Difference by the cashier')} />, cell: ({ row }) => <Diff v={row.original.cashier_difference} /> },
    { accessorKey: 'difference', meta: { label: t('Final difference'), align: 'right' }, header: ({ column }) => <ColumnHeader column={column} title={t('Final difference')} />,
      cell: ({ row }) => row.original.review_status === 'reconciled' ? <Diff v={row.original.difference} /> : <span className="text-muted-foreground">—</span> },
    { accessorKey: 'review_status', meta: { label: t('State') }, header: ({ column }) => <ColumnHeader column={column} title={t('State')} />,
      cell: ({ row }) => <span><Badge variant={reviewStatusTone(row.original.review_status)}>{reviewStatusLabel(row.original.review_status)}</Badge>
        {row.original.reviewed_by && <span className="block text-[11px] text-muted-foreground">{row.original.reviewed_by}</span>}
        {row.original.last_note && row.original.review_status === 'returned' && <span className="block max-w-56 truncate text-[11px] text-muted-foreground" title={row.original.last_note}>{row.original.last_note}</span>}</span> },
    { id: 'actions', meta: { label: '', noExport: true }, header: () => null, enableSorting: false,
      cell: ({ row }) => manager && row.original.review_status === 'pending' ? (
        <div className="flex justify-end gap-1.5" onClick={(e) => e.stopPropagation()}>
          <Button size="sm" variant="outline" onClick={() => setActing({ row: row.original, kind: 'return' })}><Undo2 /> {t('Return|till')}</Button>
          <Button size="sm" onClick={() => setActing({ row: row.original, kind: 'reconcile' })}><CheckCheck /> {t('Reconcile|till')}</Button>
        </div>) : null },
  ], [manager])

  const waitingDiff = pending.reduce((s, r) => s + num(r.cashier_difference), 0)
  return (
    <>
      <PageHeader back={{ href: '/pos', label: t('Point of sale') }} title={t('Reconciling the tills')}
        description={t('The shifts the cashiers closed. Check the count, count again if you want, return it for a recount or confirm it: then the cash goes to the safe with its difference. Values in {currency}.', { currency: company?.base_currency ?? '' })} />
      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        <StatCard label={t('Waiting for the manager')} value={String(pending.length)} />
        <StatCard label={t('Back with the cashier')} value={String((open.data ?? []).filter((r) => r.review_status === 'returned').length)} />
        <StatCard label={t('Difference waiting, by the cashiers\' count')} value={formatMoney(waitingDiff)} />
      </div>
      <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)} className="mb-3">
        <TabsList><TabsTrigger value="pending">{t('Waiting')}</TabsTrigger><TabsTrigger value="returned">{t('Returned')}</TabsTrigger>
          <TabsTrigger value="reconciled">{t('Reconciled')}</TabsTrigger><TabsTrigger value="all">{t('All of the last 60 days')}</TabsTrigger></TabsList>
      </Tabs>
      <DataTable key={tab} tableKey={`pos.review.${tab}`} columns={columns} data={rows} isLoading={q.isLoading} error={q.error} getRowId={(r) => r.id}
        onRowClick={(r) => navigate(`/pos/sessions/${r.id}`)} exportName={t('Reconciling the tills')} searchPlaceholder={t('Shift, till, cashier…')}
        empty={{ title: tab === 'pending' ? t('Nothing waiting') : t('No shifts here'), description: tab === 'pending' ? t('Every shift the cashiers closed is reconciled.') : undefined }} />
      {acting?.kind === 'reconcile' && <ReconcileDialog row={acting.row} onClose={() => setActing(null)} />}
      {acting?.kind === 'return' && <ReturnDialog row={acting.row} onClose={() => setActing(null)} />}
    </>
  )
}

/** the manager confirms: the cashier's count, or her own (with a reason when it differs) */
export function ReconcileDialog({ row, onClose }: { row: Pick<ReviewRow, 'id' | 'number' | 'register' | 'expected' | 'cashier_counted' | 'closed_by'>; onClose: () => void }) {
  const save = useReconcile()
  const [own, setOwn] = React.useState('')
  const [note, setNote] = React.useState('')
  const [error, setError] = React.useState<string | null>(null)
  const counted = own.trim() === '' ? num(row.cashier_counted) : num(own.replace(',', '.'))
  const diff = Math.round((counted - num(row.expected)) * 100) / 100
  const differs = own.trim() !== '' && counted !== num(row.cashier_counted)
  const submit = async () => {
    setError(null)
    try {
      await save.mutateAsync({ session: row.id, counted: own.trim() === '' ? null : counted, note: note.trim() || null })
      toast.success(t('Shift {number} reconciled', { number: row.number }))
      onClose()
    } catch (e) { setError(describeError(e)) }
  }
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader><DialogTitle>{t('Reconcile shift {number}', { number: row.number })}</DialogTitle>
          <DialogDescription>{t('{till} · counted by {name}', { till: row.register, name: row.closed_by ?? '—' })}</DialogDescription></DialogHeader>
        <div className="grid gap-1.5 text-[13px]">
          <div className="flex justify-between"><span className="text-muted-foreground">{t('Expected in drawer')}</span><span className="tabular font-medium">{money(row.expected)}</span></div>
          <div className="flex justify-between"><span className="text-muted-foreground">{t('Cashier counted')}</span><span className="tabular font-medium">{money(row.cashier_counted)}</span></div>
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="rc-own">{t('Your count (leave empty to confirm the cashier\'s)')}</Label>
          <Input id="rc-own" inputMode="decimal" className="h-11 text-right text-lg tabular" value={own} onChange={(e) => setOwn(e.target.value.replace(/[^\d.,]/g, ''))} placeholder={money(row.cashier_counted)} />
        </div>
        <div className={cn('flex justify-between rounded-md px-3 py-2 text-[13px] font-semibold', diff === 0 ? 'bg-success/10 text-success' : diff < 0 ? 'bg-destructive/10 text-destructive' : 'bg-warning/10 text-warning')}>
          <span>{diff === 0 ? t('Drawer balances') : diff < 0 ? t('Short|cash') : t('Over|cash')}</span><span className="tabular">{formatMoney(diff)}</span></div>
        <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder={differs ? t('Why your count differs (needed)') : t('Note (optional)')} aria-label={t('Note')} />
        {error && <p className="text-[13px] text-destructive">{error}</p>}
        <DialogFooter><Button variant="ghost" onClick={onClose}>{t('Cancel')}</Button>
          <Button loading={save.isPending} disabled={differs && note.trim().length < 3} onClick={() => void submit()}><CheckCheck /> {t('Confirm and send the cash to the safe')}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** the manager returns the shift: the cashier counts again */
export function ReturnDialog({ row, onClose }: { row: Pick<ReviewRow, 'id' | 'number' | 'closed_by'>; onClose: () => void }) {
  const save = useReviewReturn()
  const [note, setNote] = React.useState('')
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader><DialogTitle>{t('Return shift {number} for a recount', { number: row.number })}</DialogTitle>
          <DialogDescription>{t('{name} gets a notice and counts the drawer again.', { name: row.closed_by ?? '—' })}</DialogDescription></DialogHeader>
        <Textarea rows={3} autoFocus value={note} onChange={(e) => setNote(e.target.value)} placeholder={t('What should she check?')} aria-label={t('Note')} />
        <DialogFooter><Button variant="ghost" onClick={onClose}>{t('Cancel')}</Button>
          <Button loading={save.isPending} disabled={note.trim().length < 3} onClick={async () => { await save.mutateAsync({ session: row.id, note: note.trim() }); toast.success(t('Returned to the cashier')); onClose() }}><Undo2 /> {t('Return|till')}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** the cashier counts again a shift the manager returned */
export function RecountDialog({ id, number, onClose }: { id: string; number: string; onClose: () => void }) {
  const save = useRecount()
  const [counted, setCounted] = React.useState('')
  const [note, setNote] = React.useState('')
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader><DialogTitle>{t('Count shift {number} again', { number })}</DialogTitle>
          <DialogDescription>{t('Count what is in the drawer, every note and coin. You do not see what is expected: the manager compares it when reconciling.')}</DialogDescription></DialogHeader>
        <Input autoFocus inputMode="decimal" className="h-12 text-right text-xl tabular" value={counted} onChange={(e) => setCounted(e.target.value.replace(/[^\d.,]/g, ''))} placeholder="0.00" aria-label={t('Counted')} />
        <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder={t('Note for the manager (optional)')} aria-label={t('Note')} />
        <DialogFooter><Button variant="ghost" onClick={onClose}>{t('Cancel')}</Button>
          <Button loading={save.isPending} disabled={counted.trim() === ''} onClick={async () => { await save.mutateAsync({ session: id, counted: num(counted.replace(',', '.')), note: note.trim() || null }); toast.success(t('Sent to the manager')); onClose() }}><RotateCcw /> {t('Send the new count')}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** on the session page: where the shift is in the three steps, every step kept, and what the person may do next */
export function ShiftReviewCard({ session }: { session: { id: string; number: string; status: string; review_status?: string | null; closed_by?: string | null; opened_by?: string | null
  expected_cash: number | null; cashier_counted?: number | null; closing_cash_counted: number | null; register?: { name: string } | null } }) {
  const { can } = useCompany()
  const { user } = useAuth()
  const [acting, setActing] = React.useState<'reconcile' | 'return' | 'recount' | null>(null)
  const log = useSessionReviews(session.status === 'closed' ? session.id : undefined)
  if (session.status !== 'closed' || !session.review_status) return null
  const st = session.review_status
  const mine = user?.id === session.closed_by
  const row = { id: session.id, number: session.number, register: session.register?.name ?? '', expected: num(session.expected_cash),
    cashier_counted: session.cashier_counted ?? session.closing_cash_counted, closed_by: null }
  return (
    <div className="mb-4 flex flex-wrap items-center gap-3 rounded-lg border bg-card px-4 py-3 text-[13px]">
      <Badge variant={reviewStatusTone(st)}>{reviewStatusLabel(st)}</Badge>
      <span className="text-muted-foreground">{st === 'pending' ? t('The cashier closed it; the manager checks the count and confirms.')
        : st === 'returned' ? t('The manager returned it: the cashier counts the drawer again.') : t('The manager confirmed the count; the cash is in the safe.')}</span>
      <div className="ml-auto flex gap-2">
        {st === 'pending' && can('pos.approve') && <>
          <Button size="sm" variant="outline" onClick={() => setActing('return')}><Undo2 /> {t('Return|till')}</Button>
          <Button size="sm" onClick={() => setActing('reconcile')}><CheckCheck /> {t('Reconcile|till')}</Button></>}
        {st === 'returned' && (mine || can('pos.approve')) && <Button size="sm" onClick={() => setActing('recount')}><RotateCcw /> {t('Count again')}</Button>}
      </div>
      {!!log.data?.length && (
        <ol className="grid w-full gap-1 border-t pt-2 text-[12.5px]">
          {log.data.map((l) => (
            <li key={l.id} className="flex flex-wrap gap-x-2 text-muted-foreground">
              <span className="tabular">{formatDate(l.at, true)}</span>
              <span className="font-medium text-foreground">{t(STEP[l.action] ?? l.action)}</span>
              <span>{l.by?.full_name ?? l.by?.email ?? ''}</span>
              {l.counted !== null && <span>· {t('counted {amount}', { amount: formatMoney(num(l.counted)) })}</span>}
              {l.difference !== null && l.action !== 'returned' && <span>· {t('difference {amount}', { amount: formatMoney(num(l.difference)) })}</span>}
              {l.note && <span>· “{l.note}”</span>}
            </li>
          ))}
        </ol>)}
      {acting === 'reconcile' && <ReconcileDialog row={row} onClose={() => setActing(null)} />}
      {acting === 'return' && <ReturnDialog row={row} onClose={() => setActing(null)} />}
      {acting === 'recount' && <RecountDialog id={session.id} number={session.number} onClose={() => setActing(null)} />}
    </div>
  )
}
