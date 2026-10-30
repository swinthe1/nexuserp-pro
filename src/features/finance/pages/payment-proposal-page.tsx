import { BadgePercent, CalendarClock, CircleAlert, Download, Landmark, Send } from 'lucide-react'
import * as React from 'react'
import { Link } from 'react-router-dom'
import { Can, useCompany } from '@/app/company-provider'
import { EmptyState } from '@/components/empty-state'
import { ErrorState } from '@/components/error-state'
import { PageHeader } from '@/components/page-header'
import { StatCard } from '@/components/stat-card'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { msg, t } from '@/i18n'
import { downloadCsv } from '@/lib/export'
import { cn, formatDate, formatMoney, num, todayISO } from '@/lib/utils'
import { parseAmount } from '../bank-formats'
import { useBankAccounts, useBankPosition, usePaymentProposal, usePayVendorBills, type ProposalRow } from '../api'

const GROUPS: { key: ProposalRow['reason']; label: string; hint: string }[] = [
  { key: 'overdue', label: msg('Overdue'), hint: msg('Past the due date. Pay these first, or call the supplier.') },
  { key: 'discount', label: msg('Discount if paid early'), hint: msg('The supplier gives a discount if paid by the date shown.') },
  { key: 'due_soon', label: msg('Due in the next 7 days'), hint: msg('Due this week.') },
  { key: 'later', label: msg('Later'), hint: msg('Not due yet. Paying now only costs cash.') },
]

/** what to pay now: the instalments due this week, or all that is open (less the early-payment discount) */
const suggested = (r: ProposalRow) => r.instalments > 0 && num(r.due_now) > 0 ? num(r.due_now) : num(r.open_amount) - num(r.discount_amount)

type Paid = { payments: { id: string; number: string; vendor: string; amount: number; status: string }[]; count: number; total: number }

export function PaymentProposalPage() {
  const { company } = useCompany()
  const q = usePaymentProposal()
  const banks = useBankAccounts()
  const balances = useBankPosition()
  const pay = usePayVendorBills()
  const rows = React.useMemo(() => q.data ?? [], [q.data])

  const activeBanks = (banks.data ?? []).filter((b) => b.is_active)
  const [bank, setBank] = React.useState('')
  React.useEffect(() => {
    if (!bank && activeBanks.length) setBank((activeBanks.find((b) => b.account_kind === 'bank') ?? activeBanks[0]!).id)
  }, [activeBanks, bank])
  const bankRow = activeBanks.find((b) => b.id === bank)
  // in the account's own currency, as the bills are paid in it
  const bankBalance = bankRow ? num(balances.data?.find((b) => b.id === bankRow.id)?.book_balance) : 0
  const [date, setDate] = React.useState(todayISO())

  // what to pay: selected bills, each with an amount (all that is open, or less)
  const [sel, setSel] = React.useState<Record<string, string>>({})
  const [touched, setTouched] = React.useState(false)
  // first guess: the urgent ones, in order, as far as the money in the chosen account goes
  React.useEffect(() => {
    if (touched || !rows.length || !bankRow || balances.isLoading) return
    let left = bankBalance
    const pick: Record<string, string> = {}
    for (const r of rows) {
      if (r.reason === 'later' || r.currency_code !== bankRow.currency_code) continue
      const amt = suggested(r)
      if (amt > left + 0.005) continue
      left -= amt; pick[r.bill_id] = amt.toFixed(2)
    }
    setSel(pick)
  }, [rows, touched, bankRow, bankBalance, balances.isLoading])
  const toggle = (r: ProposalRow, on: boolean) => {
    setTouched(true)
    setSel((s) => { const n = { ...s }; if (on) n[r.bill_id] = suggested(r).toFixed(2); else delete n[r.bill_id]; return n })
  }
  /** what was typed: 448,40 or 448.40; never more than is open */
  const amountOf = (r: ProposalRow) => { const v = parseAmount(sel[r.bill_id] ?? ''); return Number.isFinite(v) ? Math.min(v, num(r.open_amount)) : 0 }
  const chosen = rows.filter((r) => sel[r.bill_id] != null)
  const total = chosen.reduce((s, r) => s + amountOf(r), 0)
  const wrongCurrency = bankRow ? chosen.filter((r) => r.currency_code !== bankRow.currency_code) : []
  const after = bankBalance - total
  const [done, setDone] = React.useState<Paid | null>(null)

  const sum = (k: ProposalRow['reason']) => rows.filter((r) => r.reason === k).reduce((s, r) => s + num(r.open_base), 0)
  const savings = rows.filter((r) => r.reason === 'discount').reduce((s, r) => s + num(r.discount_amount), 0)

  const exportBank = () => downloadCsv(`${t('payments-for-the-bank')}-${date}`, [
    [t('Vendor'), t('IBAN'), t('Amount'), t('Currency'), t('Reference')],
    ...Object.values(chosen.reduce<Record<string, { name: string; iban: string; amount: number; cur: string; refs: string[] }>>((m, r) => {
      const g = (m[r.vendor_id] ??= { name: r.vendor_name, iban: r.vendor_iban ?? '', amount: 0, cur: r.currency_code, refs: [] })
      g.amount += amountOf(r); g.refs.push(r.vendor_invoice_number || r.number); return m
    }, {})).map((g) => [g.name, g.iban, g.amount.toFixed(2), g.cur, g.refs.join(', ')]),
  ])

  const submit = async () => {
    const r = await pay.mutateAsync({ bank, date, items: chosen.map((x) => ({ bill: x.bill_id, amount: amountOf(x) })) })
    setSel({}); setTouched(true); setDone(r)
  }

  return (
    <>
      <PageHeader title={t('Payment proposal')}
        description={t('Supplier bills that are still open, best first: overdue, then early-payment discounts, then by due date. Tick what to pay and pay it in one go: one payment per supplier.')} />

      {q.isError ? <ErrorState error={q.error} onRetry={() => void q.refetch()} /> : q.isLoading ? <Skeleton className="h-[420px]" /> : !rows.length
        ? <Card><EmptyState icon={Landmark} title={t('No open supplier bills')} description={t('Every supplier bill is paid.')} /></Card> : (
        <>
          <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatCard label={t('Overdue')} icon={CircleAlert} tone={sum('overdue') > 0 ? 'destructive' : 'default'} value={formatMoney(sum('overdue'))}
              hint={t('{n} bills', { n: rows.filter((r) => r.reason === 'overdue').length })} />
            <StatCard label={t('Discount if paid early')} icon={BadgePercent} value={formatMoney(savings)} hint={t('Saved if paid on time')} />
            <StatCard label={t('Due in the next 7 days')} icon={CalendarClock} value={formatMoney(sum('due_soon'))} />
            <StatCard label={t('All open')} value={formatMoney(rows.reduce((s, r) => s + num(r.open_base), 0))} hint={t('{n} bills', { n: rows.length })} />
          </div>

          {/* the pay bar: from which account, on which date, how much is left after */}
          <Card className="sticky top-14 z-10 mb-4">
            <CardContent className="flex flex-wrap items-end gap-3 p-3">
              <div className="grid gap-1"><Label className="text-xs text-muted-foreground">{t('Pay from')}</Label>
                <Select value={bank} onValueChange={setBank}>
                  <SelectTrigger className="w-[240px]"><SelectValue placeholder={t('Choose the account')} /></SelectTrigger>
                  <SelectContent>{activeBanks.map((b) => <SelectItem key={b.id} value={b.id}>{b.name} · {b.currency_code}</SelectItem>)}</SelectContent>
                </Select></div>
              <div className="grid gap-1"><Label htmlFor="pp-date" className="text-xs text-muted-foreground">{t('Payment date')}</Label>
                <Input id="pp-date" type="date" className="w-[150px]" value={date} onChange={(e) => setDate(e.target.value || todayISO())} /></div>
              <div className="grid gap-0.5 text-[13px]">
                <span className="text-xs text-muted-foreground">{t('In the account now')}</span>
                <span className="tabular">{formatMoney(bankBalance, bankRow?.currency_code ?? undefined)}</span></div>
              <div className="grid gap-0.5 text-[13px]">
                <span className="text-xs text-muted-foreground">{t('Left after paying')}</span>
                <span className={cn('tabular font-medium', after < 0 && 'text-destructive')}>{formatMoney(after, bankRow?.currency_code ?? undefined)}</span></div>
              <div className="ml-auto flex flex-wrap gap-2">
                <Button variant="outline" disabled={!chosen.length} onClick={exportBank}><Download /> {t('List for the bank')}</Button>
                <Can perm="invoicing.write">
                  <Button disabled={!chosen.length || !bank || wrongCurrency.length > 0 || chosen.some((r) => amountOf(r) <= 0)} loading={pay.isPending} onClick={submit}>
                    <Send /> {t('Pay {n} bills · {amount}', { n: chosen.length, amount: formatMoney(total, bankRow?.currency_code ?? undefined) })}
                  </Button>
                </Can>
              </div>
              {wrongCurrency.length > 0 && <p className="w-full text-xs text-destructive">{t('{n} of the chosen bills are in another currency than {account}. Choose an account in that currency or untick them.', { n: wrongCurrency.length, account: bankRow?.name ?? '' })}</p>}
            </CardContent>
          </Card>

          <div className="space-y-4">
            {GROUPS.map((g) => {
              const list = rows.filter((r) => r.reason === g.key)
              if (!list.length) return null
              const all = list.every((r) => sel[r.bill_id] != null)
              const some = list.some((r) => sel[r.bill_id] != null)
              return (
                <Card key={g.key}>
                  <div className="flex items-center gap-3 border-b px-4 py-2.5">
                    <Checkbox checked={all ? true : some ? 'indeterminate' : false} aria-label={t('Choose all')}
                      onCheckedChange={(v) => list.forEach((r) => toggle(r, v === true))} />
                    <div className="min-w-0 flex-1">
                      <div className={cn('text-sm font-medium', g.key === 'overdue' && 'text-destructive')}>{t(g.label)} <span className="font-normal text-muted-foreground">· {list.length}</span></div>
                      <div className="text-xs text-muted-foreground">{t(g.hint)}</div>
                    </div>
                    <span className="tabular text-sm">{formatMoney(list.reduce((s, r) => s + num(r.open_base), 0))}</span>
                  </div>
                  <Table className="md:table-fixed">
                    <TableHeader><TableRow>
                      <TableHead className="w-10" /><TableHead>{t('Vendor')}</TableHead><TableHead className="hidden w-[190px] md:table-cell">{t('Bill')}</TableHead>
                      <TableHead className="w-[150px]">{t('Due date')}</TableHead><TableHead className="hidden w-[130px] text-right sm:table-cell">{t('Open|amount')}</TableHead><TableHead className="w-[150px] text-right">{t('To pay')}</TableHead>
                    </TableRow></TableHeader>
                    <TableBody>
                      {list.map((r) => {
                        const on = sel[r.bill_id] != null
                        return (
                          <TableRow key={r.bill_id} data-state={on ? 'selected' : undefined}>
                            <TableCell><Checkbox checked={on} aria-label={r.number} onCheckedChange={(v) => toggle(r, v === true)} /></TableCell>
                            <TableCell className="max-w-[240px]">
                              <Link to={`/partners/${r.vendor_id}`} className="block truncate font-medium hover:underline">{r.vendor_name}</Link>
                              <span className={cn('block truncate text-xs', r.vendor_iban ? 'text-muted-foreground' : 'text-warning')}>{r.vendor_iban || t('No IBAN on the vendor')}</span>
                            </TableCell>
                            <TableCell className="hidden md:table-cell"><Link to={`/procurement/bills/${r.bill_id}`} className="hover:underline">{r.vendor_invoice_number || r.number}</Link>
                              <span className="block text-xs text-muted-foreground">{formatDate(r.bill_date)}</span></TableCell>
                            <TableCell>
                              <span className="tabular">{formatDate(r.due_date)}</span>
                              {r.days_overdue > 0 && <span className="block text-xs text-destructive">{t('{n} days late', { n: r.days_overdue })}</span>}
                              {r.instalments > 0 && <span className="block text-xs text-muted-foreground">{t('{n} instalments · {amount} due now', { n: r.instalments, amount: formatMoney(r.due_now, r.currency_code) })}</span>}
                              {num(r.discount_amount) > 0 && <span className="block text-xs text-success">{t('−{amount} by {date}', { amount: formatMoney(r.discount_amount, r.currency_code), date: formatDate(r.discount_until) })}</span>}
                            </TableCell>
                            <TableCell className="hidden text-right tabular sm:table-cell">{formatMoney(r.open_amount, r.currency_code)}</TableCell>
                            <TableCell className="text-right">
                              {on ? <Input inputMode="decimal" className="ml-auto h-8 w-[130px] text-right tabular" value={sel[r.bill_id]} aria-label={t('To pay')}
                                onChange={(e) => { setTouched(true); setSel((s) => ({ ...s, [r.bill_id]: e.target.value })) }} />
                                : <span className="text-muted-foreground">—</span>}
                            </TableCell>
                          </TableRow>
                        )
                      })}
                    </TableBody>
                  </Table>
                </Card>
              )
            })}
          </div>
          <p className="mt-3 text-xs text-muted-foreground">{t('When you take an early-payment discount, the rest of the bill stays open until the supplier sends the credit note for it.')}</p>
        </>
      )}

      {done && (
        <Dialog open onOpenChange={(o) => !o && setDone(null)}>
          <DialogContent className="max-w-md">
            <DialogHeader><DialogTitle>{t('Paid')}</DialogTitle>
              <DialogDescription>{t('{n} payments made, {amount} in total.', { n: done.count, amount: formatMoney(done.total, bankRow?.currency_code ?? company?.base_currency) })}</DialogDescription></DialogHeader>
            <ul className="divide-y text-[13px]">
              {done.payments.map((p) => (
                <li key={p.id} className="flex items-center justify-between gap-3 py-2">
                  <div className="min-w-0"><Link to={`/finance/payments/${p.id}`} className="font-medium hover:underline">{p.number}</Link>
                    <span className="block truncate text-xs text-muted-foreground">{p.vendor}{p.status === 'pending_approval' && ` · ${t('Waiting for approval')}`}</span></div>
                  <span className="tabular">{formatMoney(p.amount, bankRow?.currency_code ?? undefined)}</span>
                </li>
              ))}
            </ul>
            <DialogFooter><Button onClick={() => setDone(null)}>{t('Close')}</Button></DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </>
  )
}
