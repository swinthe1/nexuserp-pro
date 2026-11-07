import type { ColumnDef } from '@tanstack/react-table'
import { CheckCheck, ListChecks, Printer, RotateCcw, Undo2 } from 'lucide-react'
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
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import { msg, t, td, tEnum, tn } from '@/i18n'
import { printTable } from '@/lib/print-table'
import { describeError } from '@/lib/errors'
import { cn, formatDate, formatMoney, num } from '@/lib/utils'
import { useCashRules, useReconcile, useReconcileMany, useRecount, useReviewDetail, useReviewList, useReviewReturn, type ReviewDetail, type ReviewRow, type ShiftCount } from '../api'
import { CashCount, countedOf, countsToNotes, denomLabel, denomsOf, type Counts } from '../cash-count'

const STATUS: Record<ReviewRow['review_status'], { label: string; tone: 'warning' | 'secondary' | 'success' }> = {
  pending: { label: msg('Waiting for the manager'), tone: 'warning' },
  returned: { label: msg('Back with the cashier'), tone: 'secondary' },
  reconciled: { label: msg('Reconciled'), tone: 'success' },
}
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
  // the shifts whose count matched (within the company's tolerance) are confirmed at once
  const rules = useCashRules()
  const many = useReconcileMany()
  const matched = pending.filter((r) => r.cashier_counted !== null && r.cashier_difference !== null && Math.abs(num(r.cashier_difference)) <= num(rules.data?.tolerance) + 0.004)
  const [askMany, setAskMany] = React.useState(false)
  const confirmMany = async () => {
    const r = await many.mutateAsync(matched.map((x) => x.id))
    setAskMany(false)
    toast.success(tn(r.reconciled, '{n} shift reconciled', '{n} shifts reconciled'))
    if (r.left.length) toast.warning(t('Left waiting: {list}', { list: r.left.map((x) => x.number).join(', ') }))
  }
  return (
    <>
      <PageHeader back={{ href: '/pos', label: t('Point of sale') }} title={t('Reconciling the tills')}
        description={t('The shifts the cashiers closed. Check the count, count again if you want, return it for a recount or confirm it: then the cash goes to the safe with its difference. Values in {currency}.', { currency: company?.base_currency ?? '' })} />
      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        <StatCard label={t('Waiting for the manager')} value={String(pending.length)} />
        <StatCard label={t('Back with the cashier')} value={String((open.data ?? []).filter((r) => r.review_status === 'returned').length)} />
        <StatCard label={t('Difference waiting, by the cashiers\' count')} value={formatMoney(waitingDiff)} />
      </div>
      {manager && matched.length > 0 && (
        <div className="mb-3 flex flex-wrap items-center gap-3 rounded-lg border border-success/40 bg-success/5 px-4 py-2.5 text-[13px]">
          <ListChecks className="size-4 text-success" />
          <span className="flex-1">{tn(matched.length, '{n} shift counted right (within the tolerance of {amount}): it can be confirmed at once.', '{n} shifts counted right (within the tolerance of {amount}): they can be confirmed at once.', { amount: formatMoney(num(rules.data?.tolerance)) })}</span>
          <Button size="sm" onClick={() => setAskMany(true)}><CheckCheck /> {tn(matched.length, 'Reconcile {n} shift', 'Reconcile {n} shifts')}</Button>
        </div>
      )}
      <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)} className="mb-3">
        <TabsList><TabsTrigger value="pending">{t('Waiting')}</TabsTrigger><TabsTrigger value="returned">{t('Returned')}</TabsTrigger>
          <TabsTrigger value="reconciled">{t('Reconciled')}</TabsTrigger><TabsTrigger value="all">{t('All of the last 60 days')}</TabsTrigger></TabsList>
      </Tabs>
      <DataTable key={tab} tableKey={`pos.review.${tab}`} columns={columns} data={rows} isLoading={q.isLoading} error={q.error} getRowId={(r) => r.id}
        onRowClick={(r) => navigate(`/pos/sessions/${r.id}`)} exportName={t('Reconciling the tills')} searchPlaceholder={t('Shift, till, cashier…')}
        empty={{ title: tab === 'pending' ? t('Nothing waiting') : t('No shifts here'), description: tab === 'pending' ? t('Every shift the cashiers closed is reconciled.') : undefined }} />
      {acting?.kind === 'reconcile' && <ReconcileDialog id={acting.row.id} onClose={() => setActing(null)} onReturn={() => setActing({ row: acting.row, kind: 'return' })} />}
      {askMany && (
        <Dialog open onOpenChange={(o) => !o && !many.isPending && setAskMany(false)}>
          <DialogContent className="sm:max-w-lg">
            <DialogHeader><DialogTitle>{tn(matched.length, 'Reconcile {n} shift', 'Reconcile {n} shifts')}</DialogTitle>
              <DialogDescription>{t('Each is confirmed with the cashier\'s count; the cash goes to the safe, with its difference if there is one. A shift that cannot be confirmed stays waiting.')}</DialogDescription></DialogHeader>
            <ul className="grid max-h-64 gap-1 overflow-y-auto text-[13px]">
              {matched.map((r) => <li key={r.id} className="flex justify-between gap-3 border-b py-1 last:border-0"><span><span className="font-medium">{r.number}</span> · {r.register} · {r.closed_by ?? '—'}</span>
                <span className="tabular">{money(r.cashier_counted)} <Diff v={r.cashier_difference} /></span></li>)}
            </ul>
            <DialogFooter><Button variant="ghost" onClick={() => setAskMany(false)}>{t('Cancel')}</Button>
              <Button loading={many.isPending} onClick={() => void confirmMany().catch(() => undefined)}><CheckCheck /> {t('Confirm and send the cash to the safe')}</Button></DialogFooter>
          </DialogContent>
        </Dialog>
      )}
      {acting?.kind === 'return' && <ReturnDialog row={acting.row} onClose={() => setActing(null)} />}
    </>
  )
}

/* ------------------------------------------------------------------ one shift, as the manager checks it */
const KIND: Record<string, string> = { close: msg('Counted at the close'), recounted: msg('Counted again'), reconciled: msg('Reconciled'), returned: msg('Returned for a recount') }
const MOVE: Record<string, string> = { supplier: msg('Paid to a supplier'), expense: msg('Expense paid'), voucher: msg('Gift voucher sold'), waiter: msg('Waiter\'s handover differs') }
/** the cashier's last count by note (at the close, or her recount) */
const lastCashierNotes = (d: ReviewDetail | undefined) => [...(d?.counts ?? [])].reverse().find((c) => c.kind === 'close' || c.kind === 'recounted')?.notes_coins ?? null

/** where the expected cash comes from, what was sold, and every count of the drawer */
export function ShiftBreakdown({ d }: { d: ReviewDetail }) {
  const c = d.cash
  const line = (k: string, v: number | null | undefined, sign: '' | '+' | '−' = '', strong = false) => (
    <div className={cn('flex justify-between gap-3', strong && 'border-t pt-1 font-semibold')}><span className={strong ? '' : 'text-muted-foreground'}>{k}</span>
      <span className="tabular">{v === null || v === undefined ? '—' : `${sign && num(v) ? `${sign} ` : ''}${formatMoney(num(v))}`}</span></div>)
  return (
    <div className="grid content-start gap-4 text-[13px]">
      {c && (
        <section className="grid gap-1">
          <h3 className="mb-0.5 text-[12px] font-medium text-muted-foreground">{t('Where the expected cash comes from')}</h3>
          {line(t('Opening cash'), c.opening)}
          {line(t('Sales paid in cash'), c.sales, '+')}
          {line(t('Change given'), c.change, '−')}
          {num(c.refunds) !== 0 && line(t('Refunds paid in cash'), c.refunds, '−')}
          {line(t('Cash in'), c.cash_in, '+')}
          {line(t('Cash out'), c.cash_out, '−')}
          {c.movements.length > 0 && (
            <ul className="ml-3 grid gap-0.5 text-[12px] text-muted-foreground">
              {c.movements.map((m, i) => <li key={i} className="flex justify-between gap-3"><span className="truncate">{m.kind && MOVE[m.kind] ? `${t(MOVE[m.kind]!)} · ` : ''}{m.reason ?? ''}</span>
                <span className="shrink-0 tabular">{m.type === 'cash_out' ? '−' : '+'} {formatMoney(num(m.amount))}</span></li>)}
            </ul>)}
          {line(t('Expected in drawer'), d.expected_cash, '', true)}
        </section>
      )}
      {d.payments && Object.keys(d.payments).length > 0 && (
        <section className="grid gap-1">
          <h3 className="mb-0.5 text-[12px] font-medium text-muted-foreground">{t('Payments')}</h3>
          {Object.entries(d.payments).map(([m, v]) => <div key={m} className="flex justify-between gap-3"><span className="text-muted-foreground">{tEnum(m)}</span><span className="tabular">{formatMoney(num(v))}</span></div>)}
        </section>
      )}
      <section className="grid gap-1">
        <h3 className="mb-0.5 text-[12px] font-medium text-muted-foreground">{t('The shift')}</h3>
        <div className="flex justify-between gap-3"><span className="text-muted-foreground">{t('Receipts')}</span><span className="tabular">{t('{a} · {b} refunds', { a: d.sales.orders, b: d.sales.refunds })}</span></div>
        {d.sales.average != null && <div className="flex justify-between gap-3"><span className="text-muted-foreground">{t('Average receipt')}</span><span className="tabular">{formatMoney(num(d.sales.average))}</span></div>}
        {!!num(d.sales.discounts) && <div className="flex justify-between gap-3"><span className="text-muted-foreground">{t('Discounts given')}</span><span className="tabular">{formatMoney(num(d.sales.discounts))}</span></div>}
        <div className="flex justify-between gap-3"><span className="text-muted-foreground">{t('Items taken off sales')}</span>
          <span className={cn('tabular', d.voids.unconfirmed > 0 && 'font-medium text-warning')}>{d.voids.n ? `${d.voids.n} · ${formatMoney(num(d.voids.amount))}` : '—'}
            {d.voids.unconfirmed > 0 && ` · ${tn(d.voids.unconfirmed, '{n} without a manager', '{n} without a manager')}`}</span></div>
        {!!num(d.sales.offline) && <div className="flex justify-between gap-3"><span className="text-muted-foreground">{t('Sold without internet')}</span><span className="tabular">{num(d.sales.offline)}</span></div>}
        {d.moved_in > 0 && <div className="flex justify-between gap-3"><span className="text-muted-foreground">{t('Sales of an earlier shift sent later')}</span><span className="tabular font-medium text-warning">{d.moved_in}</span></div>}
        {d.z && <div className="flex justify-between gap-3"><span className="text-muted-foreground">{t('Z-report')}</span><Link className="font-medium text-primary hover:underline" to={`/pos/sessions/${d.id}`}>{d.z.number}</Link></div>}
      </section>
      <CountsTimeline counts={d.counts} currency={d.currency} />
    </div>
  )
}

/** every count of the drawer, in order, each with its notes and coins */
export function CountsTimeline({ counts, currency }: { counts: ShiftCount[]; currency: string }) {
  const [open, setOpen] = React.useState<number | null>(null)
  if (!counts.length) return null
  const denoms = denomsOf(currency)
  return (
    <section className="grid gap-1">
      <h3 className="mb-0.5 text-[12px] font-medium text-muted-foreground">{t('Counts of the drawer')}</h3>
      <ol className="grid gap-1.5">
        {counts.map((c, i) => (
          <li key={i} className="rounded-md border px-2.5 py-1.5">
            <div className="flex flex-wrap items-baseline justify-between gap-x-3">
              <span><span className="font-medium">{t(KIND[c.kind] ?? c.kind)}</span> <span className="text-muted-foreground">· {c.by ?? '—'} · {formatDate(c.at, true)}</span></span>
              {c.counted !== null && <span className="tabular font-medium">{formatMoney(num(c.counted))}{c.difference !== null && <span className={cn('ml-2 text-[12px]', num(c.difference) === 0 ? 'text-success' : num(c.difference) < 0 ? 'text-destructive' : 'text-warning')}>
                ({num(c.difference) > 0 ? '+' : ''}{formatMoney(num(c.difference))})</span>}</span>}
            </div>
            {(c.note || c.witness) && <div className="text-[12px] text-muted-foreground">{c.witness ? `${t('In front of {name}', { name: c.witness })} ` : ''}{c.note ? `“${c.note}”` : ''}</div>}
            {c.notes_coins && <button type="button" className="text-[12px] font-medium text-primary hover:underline" onClick={() => setOpen(open === i ? null : i)}>
              {open === i ? t('Hide the notes and coins') : t('Show the notes and coins')}</button>}
            {open === i && c.notes_coins && (
              <div className="mt-1 grid grid-cols-2 gap-x-4 text-[12px] tabular sm:grid-cols-3">
                {denoms.filter((x) => Object.keys(c.notes_coins!).some((k) => Math.abs(Number(k) - x) < 1e-9)).map((x) => {
                  const n = num(c.notes_coins![Object.keys(c.notes_coins!).find((k) => Math.abs(Number(k) - x) < 1e-9)!])
                  return <span key={x}>{denomLabel(x)} × {n} = {formatMoney(n * x)}</span>
                })}
              </div>)}
          </li>
        ))}
      </ol>
    </section>
  )
}

/** the reconciliation slip: what was expected, what each counted, signed by both */
export function printReconcileSlip(d: ReviewDetail) {
  const denoms = denomsOf(d.currency)
  const last = [...d.counts].reverse().find((c) => c.counted !== null && (c.kind === 'reconciled' || c.kind === 'recounted' || c.kind === 'close'))
  const rows: (string | number | null)[][] = []
  const marks: ('group' | 'sub' | undefined)[] = []
  const add = (k: string, v: number | null, mark?: 'group' | 'sub') => { rows.push([k, v]); marks.push(mark) }
  add(t('Shift {number}', { number: d.number }), null, 'group')
  add(t('Opened {date} by {name}', { date: formatDate(d.opened_at, true), name: d.opened_by ?? '—' }), null)
  if (d.closed_at) add(t('Closed {date} by {name}', { date: formatDate(d.closed_at, true), name: d.closed_by ?? '—' }), null)
  if (d.cash) {
    add(t('Where the expected cash comes from'), null, 'group')
    add(t('Opening cash'), num(d.cash.opening)); add(t('Sales paid in cash'), num(d.cash.sales)); add(t('Change given'), -num(d.cash.change))
    if (num(d.cash.refunds)) add(t('Refunds paid in cash'), -num(d.cash.refunds))
    add(t('Cash in'), num(d.cash.cash_in)); add(t('Cash out'), -num(d.cash.cash_out))
    add(t('Expected in drawer'), d.expected_cash, 'sub')
  }
  add(t('Counts of the drawer'), null, 'group')
  for (const c of d.counts) if (c.counted !== null) add(`${t(KIND[c.kind] ?? c.kind)} · ${c.by ?? ''} · ${formatDate(c.at, true)}${c.note ? ` · “${c.note}”` : ''}`, num(c.counted))
  if (d.review_status === 'reconciled' && d.difference !== null) add(num(d.difference) === 0 ? t('Drawer balances') : num(d.difference) < 0 ? t('Short|cash') : t('Over|cash'), num(d.difference), 'sub')
  if (last?.notes_coins) {
    add(t('Count by note and coin'), null, 'group')
    for (const x of denoms) {
      const k = Object.keys(last.notes_coins).find((kk) => Math.abs(Number(kk) - x) < 1e-9)
      if (k) add(`${denomLabel(x)} × ${num(last.notes_coins[k])}`, num(last.notes_coins[k]) * x)
    }
  }
  printTable({ title: t('Till reconciliation · {number}', { number: d.number }), subtitle: [d.register, d.unit].filter(Boolean).join(' · '),
    columns: [{ header: t('Description'), format: 'text' }, { header: t('Amount ({currency})', { currency: d.currency }), format: 'money' }],
    rows, marks, signatures: [t('Cashier'), t('Manager')] })
}

/** the manager confirms: the cashier's count, or her own, by note and coin (with a reason when it differs) */
export function ReconcileDialog({ id, onClose, onReturn }: { id: string; onClose: () => void; onReturn?: () => void }) {
  const detail = useReviewDetail(id)
  const rules = useCashRules()
  const save = useReconcile()
  const d = detail.data
  const [mode, setMode] = React.useState<'theirs' | 'mine'>('theirs')
  const [counts, setCounts] = React.useState<Counts>({})
  const [direct, setDirect] = React.useState('')
  const [note, setNote] = React.useState('')
  const [error, setError] = React.useState<string | null>(null)
  const cur = d?.currency ?? 'EUR'
  const byNotes = rules.data?.byNotes ?? true
  const theirs = num(d?.cashier_counted)
  const mineCounted = countedOf(cur, counts, direct)
  const touched = direct !== '' || Object.values(counts).some((v) => v !== '')
  const counted = mode === 'mine' && touched ? mineCounted : theirs
  const expected = num(d?.expected_cash)
  const diff = Math.round((counted - expected) * 100) / 100
  const tol = num(d?.tolerance)
  const differs = mode === 'mine' && touched && Math.abs(counted - theirs) > 0.004
  const submit = async () => {
    if (!d) return
    setError(null)
    if (mode === 'mine' && !touched) { setError(t('Count the drawer, or confirm the cashier\'s count')); return }
    try {
      await save.mutateAsync({ session: id, counted: mode === 'mine' ? counted : null, note: note.trim() || null,
        notesCoins: mode === 'mine' && direct === '' ? countsToNotes(denomsOf(cur), counts) : null })
      toast.success(t('Shift {number} reconciled', { number: d.number }), {
        action: { label: t('Print the slip'), onClick: () => { void detail.refetch().then((r) => r.data && printReconcileSlip(r.data)) } } })
      onClose()
    } catch (e) { setError(describeError(e)) }
  }
  return (
    <Dialog open onOpenChange={(o) => !o && !save.isPending && onClose()}>
      <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-4xl">
        <DialogHeader><DialogTitle>{t('Reconcile shift {number}', { number: d?.number ?? '' })}</DialogTitle>
          <DialogDescription>{d ? t('{till} · counted by {name}', { till: [d.register, d.unit].filter(Boolean).join(' · '), name: d.closed_by ?? '—' }) : ' '}</DialogDescription></DialogHeader>
        {!d ? <Skeleton className="h-72" /> : (
          <div className="grid gap-6 md:grid-cols-[1fr_1.1fr]">
            <ShiftBreakdown d={d} />
            <div className="grid content-start gap-3">
              <div className="grid gap-1 rounded-lg border p-3 text-[13px]">
                <div className="flex justify-between"><span className="text-muted-foreground">{t('Expected in drawer')}</span><span className="tabular font-medium">{money(d.expected_cash)}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">{t('Cashier counted')}</span>
                  <span className="tabular font-medium">{money(d.cashier_counted)} <Diff v={d.cashier_difference} /></span></div>
                {mode === 'mine' && touched && <div className="flex justify-between"><span className="text-muted-foreground">{t('You counted')}</span><span className="tabular font-medium">{formatMoney(mineCounted)}</span></div>}
              </div>
              <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label={t('Your count')}>
                {([['theirs', t('Confirm the cashier\'s count'), formatMoney(theirs)], ['mine', t('I count the drawer myself'), t('by note and coin')]] as const).map(([v, l, h]) => (
                  <button key={v} type="button" role="radio" aria-checked={mode === v} onClick={() => setMode(v)}
                    className={cn('rounded-lg border-2 px-3 py-2 text-left text-[13px]', mode === v ? 'border-primary bg-primary/5' : 'hover:bg-muted')}>
                    <span className="block font-medium">{l}</span><span className="block text-[12px] text-muted-foreground">{h}</span></button>))}
              </div>
              {mode === 'mine' && <CashCount currency={cur} counts={counts} onCounts={setCounts} direct={direct} onDirect={setDirect} byNotes={byNotes}
                compare={lastCashierNotes(d)} compareLabel={t('The cashier counted')} autoFocus />}
              <div className={cn('flex justify-between rounded-md px-3 py-2 text-[13px] font-semibold', diff === 0 ? 'bg-success/10 text-success' : Math.abs(diff) <= tol ? 'bg-warning/10 text-warning' : 'bg-destructive/10 text-destructive')}>
                <span>{diff === 0 ? t('Drawer balances') : diff < 0 ? t('Short|cash') : t('Over|cash')}{diff !== 0 && Math.abs(diff) <= tol ? ` · ${t('within the tolerance of {amount}', { amount: formatMoney(tol) })}` : ''}</span>
                <span className="tabular">{formatMoney(diff)}</span></div>
              <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} aria-label={t('Note')}
                placeholder={differs ? t('Why your count differs (needed)') : diff !== 0 ? t('What happened to the difference (optional)') : t('Note (optional)')} />
              {error && <p className="text-[13px] text-destructive">{error}</p>}
            </div>
          </div>
        )}
        <DialogFooter className="gap-2 sm:justify-between">
          <div className="flex gap-2">
            {onReturn && d?.review_status === 'pending' && <Button variant="outline" onClick={onReturn}><Undo2 /> {t('Return|till')}</Button>}
            {d && <Button variant="ghost" onClick={() => printReconcileSlip(d)}><Printer /> {t('Print')}</Button>}
          </div>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={onClose}>{t('Cancel')}</Button>
            <Button loading={save.isPending} disabled={!d || (differs && note.trim().length < 3)} onClick={() => void submit()}><CheckCheck /> {t('Confirm and send the cash to the safe')}</Button>
          </div>
        </DialogFooter>
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

/** the cashier counts again a shift the manager returned: by note and coin, still blind */
export function RecountDialog({ id, number, onClose }: { id: string; number: string; onClose: () => void }) {
  const save = useRecount()
  const rules = useCashRules()
  const { company } = useCompany()
  const detail = useReviewDetail(id)
  const cur = detail.data?.currency ?? company?.base_currency ?? 'EUR'
  const [counts, setCounts] = React.useState<Counts>({})
  const [direct, setDirect] = React.useState('')
  const [note, setNote] = React.useState('')
  const counted = countedOf(cur, counts, direct)
  const touched = direct !== '' || Object.values(counts).some((v) => v !== '')
  const why = [...(detail.data?.counts ?? [])].reverse().find((c) => c.kind === 'returned')?.note
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader><DialogTitle>{t('Count shift {number} again', { number })}</DialogTitle>
          <DialogDescription>{t('Count what is in the drawer, every note and coin. You do not see what is expected: the manager compares it when reconciling.')}</DialogDescription></DialogHeader>
        {why && <p className="rounded-md border border-warning/50 bg-warning/5 px-3 py-2 text-[13px]"><span className="font-medium">{t('The manager asks')}:</span> “{why}”</p>}
        <CashCount currency={cur} counts={counts} onCounts={setCounts} direct={direct} onDirect={setDirect} byNotes={rules.data?.byNotes ?? true} autoFocus />
        <div className="flex justify-between rounded-md bg-muted px-3 py-2 text-[13px] font-semibold"><span>{t('Counted')}</span><span className="tabular">{formatMoney(counted)}</span></div>
        <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder={t('Note for the manager (optional)')} aria-label={t('Note')} />
        <DialogFooter><Button variant="ghost" onClick={onClose}>{t('Cancel')}</Button>
          <Button loading={save.isPending} disabled={!touched} onClick={async () => {
            await save.mutateAsync({ session: id, counted, note: note.trim() || null, notesCoins: direct === '' ? countsToNotes(denomsOf(cur), counts) : null })
            toast.success(t('Sent to the manager')); onClose()
          }}><RotateCcw /> {t('Send the new count')}</Button></DialogFooter>
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
  const detail = useReviewDetail(session.status === 'closed' ? session.id : undefined)
  if (session.status !== 'closed' || !session.review_status) return null
  const st = session.review_status
  const mine = user?.id === session.closed_by
  const row = { id: session.id, number: session.number, closed_by: detail.data?.closed_by ?? null }
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
        {detail.data && (st === 'reconciled' || can('pos.approve')) && <Button size="sm" variant="ghost" onClick={() => printReconcileSlip(detail.data!)}><Printer /> {t('Print the slip')}</Button>}
      </div>
      {detail.data && detail.data.counts.length > 0 && <div className="w-full border-t pt-2"><CountsTimeline counts={detail.data.counts} currency={detail.data.currency} /></div>}
      {acting === 'reconcile' && <ReconcileDialog id={session.id} onClose={() => { setActing(null); void detail.refetch() }} onReturn={() => setActing('return')} />}
      {acting === 'return' && <ReturnDialog row={row} onClose={() => { setActing(null); void detail.refetch() }} />}
      {acting === 'recount' && <RecountDialog id={session.id} number={session.number} onClose={() => { setActing(null); void detail.refetch() }} />}
    </div>
  )
}
