import { useQuery } from '@tanstack/react-query'
import { PageTableExport } from '@/components/page-table-export'
import { BookOpenText, ListChecks } from 'lucide-react'
import * as React from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { Can } from '@/app/company-provider'
import { StatCard } from '@/components/stat-card'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { EmptyState } from '@/components/empty-state'
import { ErrorState } from '@/components/error-state'
import { PageHeader } from '@/components/page-header'
import { SearchSelect } from '@/components/search-select'
import { StatementActions } from '@/components/statement-actions'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { t, tn } from '@/i18n'
import {
  fetchOpenItems, fetchPartnerCard, openItemsStatement, partnerCardStatement, type Side, sideBalance,
} from '@/lib/documents/statements'
import { cn, formatDate, formatMoney, num, todayISO } from '@/lib/utils'
import { usePartners } from '@/features/sales/api'
import { SOURCE_HREF, sourceLabel, useAging, type AgingRow } from '../api'
import { AgingBody } from './aging-page'
import { BalancesView, InvoicesTab, ItemsTab, ReconTab } from '../components/card-kinds'

const yearStart = () => `${new Date().getFullYear()}-01-01`

type Show = 'all' | 'ar' | 'ap'
const SHOW_HREF: Record<Show, string> = { all: '/finance/cards', ar: '/finance/receivables', ap: '/finance/payables' }

/**
 * Finance › Partner cards: the debts and the cards in one place (the owner's decision, 11.11.2026).
 * Three buttons: all the cards (what is to collect and what is to pay as two windows side by side, and the net of the two
 * for a partner who is both a customer and a supplier), only the receivables, only the payables. One partner can be chosen
 * at any time: everything then narrows to that partner, and their card opens underneath.
 */
export function CardsPage({ show = 'all' }: { show?: Show }) {
  const [params, setParams] = useSearchParams()
  const navigate = useNavigate()
  const partners = usePartners()
  const id = params.get('p')
  const p = partners.data?.find((x) => x.id === id)
  const [asOf, setAsOf] = React.useState(todayISO())
  const balances = show === 'all' && params.get('view') === 'balances' && !id
  const pick = (v: string | null) => { const n = new URLSearchParams(params); if (v) { n.set('p', v); n.delete('view') } else n.delete('p'); setParams(n, { replace: true }) }
  const go = (s: Show) => navigate({ pathname: SHOW_HREF[s], search: id ? `?p=${id}` : '' }, { replace: true })
  const setBalances = (on: boolean) => { const n = new URLSearchParams(params); if (on) n.set('view', 'balances'); else n.delete('view'); setParams(n, { replace: true }) }
  const ar = useAging('ar', asOf), ap = useAging('ap', asOf)
  const only = <T extends { partner_id: string }>(rows: T[] | undefined) => (rows ?? []).filter((r) => !id || r.partner_id === id)
  const arRows = React.useMemo(() => only(ar.data).sort((a, b) => num(b.total) - num(a.total)), [ar.data, id]) // eslint-disable-line react-hooks/exhaustive-deps
  const apRows = React.useMemo(() => only(ap.data).sort((a, b) => num(b.total) - num(a.total)), [ap.data, id]) // eslint-disable-line react-hooks/exhaustive-deps
  const arTotal = arRows.reduce((s, r) => s + num(r.total), 0), apTotal = apRows.reduce((s, r) => s + num(r.total), 0)
  const net = arTotal - apTotal
  const apBy = React.useMemo(() => new Map((ap.data ?? []).map((r) => [r.partner_id, num(r.total)])), [ap.data])
  const arBy = React.useMemo(() => new Map((ar.data ?? []).map((r) => [r.partner_id, num(r.total)])), [ar.data])
  // a partner on both sides: we sell to them and buy from them
  const both = React.useMemo(() => arRows.filter((r) => apBy.has(r.partner_id)).map((r) => ({ id: r.partner_id, name: r.partner_name, ar: num(r.total), ap: apBy.get(r.partner_id) ?? 0 }))
    .sort((a, b) => Math.abs(b.ar - b.ap) - Math.abs(a.ar - a.ap)), [arRows, apBy])
  const loading = ar.isLoading || ap.isLoading
  return (
    <>
      <PageHeader title={t('Partner cards|menu')} description={t('What customers owe you and what you owe suppliers, side by side, with each partner’s card and the statement of open items (IOS).')}
        actions={<>
          <div className="flex items-center gap-2"><Label htmlFor="asof" className="text-[13px] text-muted-foreground">{t('On date')}</Label>
            <Input id="asof" type="date" className="w-[150px]" value={asOf} onChange={(e) => setAsOf(e.target.value || todayISO())} /></div>
          <PageTableExport />
          <Can perm="invoicing.write">
            {show !== 'ap' && <Button variant={show === 'ar' ? 'default' : 'outline'} asChild><Link to={`/finance/payments/new?type=customer_payment${id ? `&partner=${id}` : ''}`}>{t('Receive a payment')}</Link></Button>}
            {show !== 'ar' && <Button variant={show === 'ap' ? 'default' : 'outline'} asChild><Link to={`/finance/payments/new?type=vendor_payment${id ? `&partner=${id}` : ''}`}>{t('Pay a vendor')}</Link></Button>}
          </Can>
        </>} />
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="inline-flex w-fit rounded-lg bg-muted p-1 text-sm" role="tablist" aria-label={t('Partner cards|menu')}>
          {([['all', t('All cards')], ['ar', t('Receivable|cards')], ['ap', t('Payable|cards')]] as [Show, string][]).map(([k, label]) => (
            <button key={k} type="button" role="tab" aria-selected={show === k} onClick={() => go(k)}
              className={cn('rounded-md px-3.5 py-1.5 font-medium', show === k ? 'bg-background shadow-sm' : 'text-muted-foreground hover:text-foreground')}>{label}</button>
          ))}
        </div>
        <div className="w-full max-w-sm">
          <SearchSelect value={id} onChange={pick} clearable placeholder={t('All partners: choose one to see only theirs')}
            options={(partners.data ?? []).map((x) => ({ value: x.id, label: x.name, hint: [x.code, x.tax_number].filter(Boolean).join(' · ') }))} />
        </div>
        {show === 'all' && !id && (
          <button type="button" className="ml-auto text-[13px] text-primary hover:underline" onClick={() => setBalances(!balances)}>
            {balances ? t('Back to the two windows') : t('Balances of all, by group')}</button>
        )}
      </div>

      {/* the three figures: to collect, to pay, and what is left of the two */}
      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        <StatCard compact label={t('To collect (with VAT)')} value={formatMoney(arTotal)} loading={loading} href={show === 'ar' ? undefined : `${SHOW_HREF.ar}${id ? `?p=${id}` : ''}`}
          hint={id ? p?.name : tn(arRows.length, '{n} customer', '{n} customers')} />
        <StatCard compact label={t('To pay (with VAT)')} value={formatMoney(apTotal)} loading={loading} href={show === 'ap' ? undefined : `${SHOW_HREF.ap}${id ? `?p=${id}` : ''}`}
          hint={id ? p?.name : tn(apRows.length, '{n} vendor', '{n} vendors')} />
        <StatCard compact label={net >= 0 ? t('Net: they owe us (with VAT)') : t('Net: we owe (with VAT)')} value={formatMoney(Math.abs(net))} loading={loading} tone={net < 0 ? 'warning' : 'default'}
          hint={t('To collect minus to pay')} />
      </div>

      {balances ? <BalancesView onOpen={(pid) => pick(pid)} /> : show === 'ar' ? <AgingBody kind="ar" asOf={asOf} partnerId={id} /> : show === 'ap' ? <AgingBody kind="ap" asOf={asOf} partnerId={id} /> : (
        <div className="grid gap-4">
          <div className="grid items-start gap-4 lg:grid-cols-2">
            <DebtWindow kind="ar" rows={arRows} other={apBy} total={arTotal} asOf={asOf} loading={ar.isLoading} error={ar.error} onPick={pick} chosen={id} />
            <DebtWindow kind="ap" rows={apRows} other={arBy} total={apTotal} asOf={asOf} loading={ap.isLoading} error={ap.error} onPick={pick} chosen={id} />
          </div>
          {!id && both.length > 0 && (
            <Card>
              <CardHeader className="pb-2"><CardTitle>{t('Customers who are also suppliers')}</CardTitle>
                <CardDescription>{t('You sell to them and buy from them: what is left when one debt is set against the other.')}</CardDescription></CardHeader>
              <CardContent className="overflow-x-auto p-0">
                <Table>
                  <TableHeader><TableRow className="hover:bg-transparent"><TableHead>{t('Partner')}</TableHead><TableHead className="text-right">{t('To collect (with VAT)')}</TableHead>
                    <TableHead className="text-right">{t('To pay (with VAT)')}</TableHead><TableHead className="text-right">{t('Net')}</TableHead><TableHead /></TableRow></TableHeader>
                  <TableBody>{both.map((b) => (
                    <TableRow key={b.id} className="cursor-pointer" onClick={() => pick(b.id)}>
                      <TableCell className="font-medium">{b.name}</TableCell>
                      <TableCell className="text-right tabular">{formatMoney(b.ar)}</TableCell><TableCell className="text-right tabular">{formatMoney(b.ap)}</TableCell>
                      <TableCell className={cn('text-right tabular font-semibold', b.ar - b.ap < 0 && 'text-warning')}>{formatMoney(Math.abs(b.ar - b.ap))}</TableCell>
                      <TableCell className="whitespace-nowrap text-[12.5px] text-muted-foreground">{b.ar - b.ap >= 0 ? t('they owe us') : t('we owe them')}</TableCell>
                    </TableRow>
                  ))}</TableBody>
                </Table>
              </CardContent>
            </Card>
          )}
        </div>
      )}

      {/* one partner chosen: their card underneath, whichever button is on */}
      {id && !balances && (
        <div className="mt-6">
          {!p ? (partners.isLoading ? <Skeleton className="h-48" /> : <EmptyState icon={BookOpenText} title={t('Choose a customer or supplier')} description={t('Their card shows every invoice, payment and compensation with the balance after each.')} />)
            : <><h2 className="mb-3 text-base font-semibold">{t('Card of {name}', { name: p.name })}</h2>
              <PartnerCards key={`${p.id}-${show}`} partnerId={p.id} isCustomer={p.is_customer} isVendor={p.is_vendor} start={show === 'ap' && p.is_vendor ? 'vendor' : undefined} /></>}
        </div>
      )}
    </>
  )
}

/** the same page opened on one side (the old addresses of the debts keep working) */
export const ReceivablesPage = () => <CardsPage show="ar" />
export const PayablesPage = () => <CardsPage show="ap" />

/** one window of the two: who owes (or is owed), how much of it is late, the total */
function DebtWindow({ kind, rows, other, total, asOf, loading, error, onPick, chosen }: {
  kind: 'ar' | 'ap'; rows: AgingRow[]; other: Map<string, number>; total: number; asOf: string; loading: boolean; error: unknown; onPick: (id: string) => void; chosen: string | null }) {
  const isAR = kind === 'ar'
  const late = (r: AgingRow) => num(r.d1_30) + num(r.d31_60) + num(r.d61_90) + num(r.d90_plus)
  const lateTotal = rows.reduce((s, r) => s + late(r), 0)
  return (
    <Card className="overflow-hidden">
      <CardHeader className="flex-row items-baseline justify-between gap-3 space-y-0 border-b bg-muted/40 py-3">
        <div><CardTitle>{isAR ? t('Receivable|cards') : t('Payable|cards')}</CardTitle>
          <CardDescription>{isAR ? t('What customers owe you') : t('What you owe suppliers')}</CardDescription></div>
        <span className="text-lg font-semibold tabular">{formatMoney(total)}</span>
      </CardHeader>
      <CardContent className="overflow-x-auto p-0">
        {loading ? <Skeleton className="m-4 h-40" /> : error ? <ErrorState compact error={error} /> : !rows.length ? (
          <EmptyState compact title={isAR ? t('No customer owes you anything') : t('Nothing to pay')} description={isAR ? t('On {date} every invoice is paid.', { date: formatDate(asOf) }) : t('On {date} every vendor bill is paid.', { date: formatDate(asOf) })} />
        ) : (
          <Table>
            <TableHeader><TableRow className="hover:bg-transparent"><TableHead>{isAR ? t('Customer') : t('Vendor')}</TableHead><TableHead className="text-right">{t('Late')}</TableHead>
              <TableHead className="text-right">{t('Total with VAT')}</TableHead><TableHead>{t('Oldest due date')}</TableHead></TableRow></TableHeader>
            <TableBody>{rows.map((r) => (
              <TableRow key={r.partner_id} className={cn('cursor-pointer', chosen === r.partner_id && 'bg-primary/5')} onClick={() => onPick(r.partner_id)}>
                <TableCell><span className="font-medium">{r.partner_name}</span>
                  {other.has(r.partner_id) && <span className="ml-2 whitespace-nowrap rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">
                    {isAR ? t('also a supplier: we owe {amount}', { amount: formatMoney(other.get(r.partner_id)) }) : t('also a customer: owes us {amount}', { amount: formatMoney(other.get(r.partner_id)) })}</span>}</TableCell>
                <TableCell className={cn('text-right tabular', late(r) > 0 ? 'text-destructive' : 'text-muted-foreground/50')}>{late(r) > 0 ? formatMoney(late(r)) : '—'}</TableCell>
                <TableCell className="text-right tabular font-medium">{formatMoney(r.total)}</TableCell>
                <TableCell className={cn('whitespace-nowrap text-[13px]', r.oldest_due && r.oldest_due < asOf && 'text-destructive')}>{formatDate(r.oldest_due)}</TableCell>
              </TableRow>
            ))}</TableBody>
            <TableFooter><TableRow className="hover:bg-transparent"><TableCell className="font-medium">{t('Total')}</TableCell>
              <TableCell className="text-right tabular">{lateTotal > 0 ? formatMoney(lateTotal) : '—'}</TableCell><TableCell className="text-right tabular font-semibold">{formatMoney(total)}</TableCell><TableCell /></TableRow></TableFooter>
          </Table>
        )}
      </CardContent>
    </Card>
  )
}

/** The card and the open items of one partner (also on the partner's page). */
export function PartnerCards({ partnerId, isCustomer, isVendor, start }: { partnerId: string; isCustomer: boolean; isVendor: boolean; start?: Side }) {
  const [side, setSide] = React.useState<Side>(start ?? (isCustomer ? 'customer' : 'vendor'))
  return (
    <div className="grid gap-3">
      {isCustomer && isVendor && (
        <div className="inline-flex w-fit rounded-lg bg-muted p-1 text-sm">
          {(['customer', 'vendor'] as const).map((s) => (
            <button key={s} type="button" aria-pressed={side === s} onClick={() => setSide(s)}
              className={cn('rounded-md px-3 py-1.5 font-medium', side === s ? 'bg-background shadow-sm' : 'text-muted-foreground')}>
              {s === 'customer' ? t('As a customer') : t('As a supplier')}
            </button>
          ))}
        </div>
      )}
      <Tabs defaultValue="card">
        <TabsList className="h-auto flex-wrap">
          <TabsTrigger value="card">{t('Card')}</TabsTrigger><TabsTrigger value="open">{t('Open items (IOS)')}</TabsTrigger>
          <TabsTrigger value="invoices">{t('By invoice')}</TabsTrigger><TabsTrigger value="items">{t('By item|card')}</TabsTrigger>
          {isCustomer && isVendor && <TabsTrigger value="recon">{t('Reconciliation')}</TabsTrigger>}
        </TabsList>
        <TabsContent value="card"><CardTab partnerId={partnerId} side={side} /></TabsContent>
        <TabsContent value="open"><OpenTab partnerId={partnerId} side={side} /></TabsContent>
        <TabsContent value="invoices"><InvoicesTab key={side} partnerId={partnerId} side={side} /></TabsContent>
        <TabsContent value="items"><ItemsTab key={side} partnerId={partnerId} side={side} /></TabsContent>
        {isCustomer && isVendor && <TabsContent value="recon"><ReconTab partnerId={partnerId} renderOpen={(s) => <OpenTab partnerId={partnerId} side={s} />} /></TabsContent>}
      </Tabs>
    </div>
  )
}

function CardTab({ partnerId, side }: { partnerId: string; side: Side }) {
  const [from, setFrom] = React.useState(yearStart())
  const [to, setTo] = React.useState(todayISO())
  const q = useQuery({ queryKey: ['partner-card', partnerId, side, from, to], staleTime: 0, queryFn: () => fetchPartnerCard(partnerId, side, from, to) })
  const c = q.data
  const cur = c?.currency
  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-end gap-3">
        <div className="grid gap-1.5"><Label htmlFor="pc-from">{t('From')}</Label><Input id="pc-from" type="date" className="w-40" value={from} onChange={(e) => e.target.value && setFrom(e.target.value)} /></div>
        <div className="grid gap-1.5"><Label htmlFor="pc-to">{t('To')}</Label><Input id="pc-to" type="date" className="w-40" value={to} onChange={(e) => e.target.value && setTo(e.target.value)} /></div>
        <div className="ml-auto"><StatementActions disabled={!c} build={async () => partnerCardStatement(c ?? await fetchPartnerCard(partnerId, side, from, to))}
          email={{ entityType: 'business_partners', entityId: partnerId }} /></div>
      </div>
      {q.isError ? <ErrorState error={q.error} onRetry={() => void q.refetch()} /> : !c ? <Skeleton className="h-64" /> : (
        <div className="overflow-x-auto rounded-lg border">
          <Table>
            <TableHeader><TableRow>
              <TableHead>{t('Date')}</TableHead><TableHead>{t('Document')}</TableHead><TableHead>{t('Number')}</TableHead><TableHead>{t('Reference')}</TableHead>
              <TableHead>{t('Due')}</TableHead><TableHead className="text-right">{t('Debit')}</TableHead><TableHead className="text-right">{t('Credit')}</TableHead>
              <TableHead className="text-right">{side === 'vendor' ? t('We owe') : t('Owes us')}</TableHead>
            </TableRow></TableHeader>
            <TableBody>
              <TableRow className="bg-muted/40 font-medium"><TableCell>{formatDate(c.from)}</TableCell><TableCell colSpan={6}>{t('Opening balance')}</TableCell>
                <TableCell className="text-right tabular-nums">{formatMoney(sideBalance(side, c.opening), cur)}</TableCell></TableRow>
              {c.rows.length === 0 && <TableRow><TableCell colSpan={8} className="py-8 text-center text-muted-foreground">{t('Nothing in this period.')}</TableCell></TableRow>}
              {c.rows.map((r, i) => {
                const href = r.source_type && r.source_id && SOURCE_HREF[r.source_type] ? SOURCE_HREF[r.source_type] + r.source_id : null
                return (
                  <TableRow key={i}>
                    <TableCell className="whitespace-nowrap">{formatDate(r.date)}</TableCell>
                    <TableCell>{r.source_type ? sourceLabel(r.source_type) : r.memo}</TableCell>
                    <TableCell className="whitespace-nowrap">{href ? <Link className="text-primary hover:underline" to={href}>{r.document}</Link> : r.document}</TableCell>
                    <TableCell className="text-muted-foreground">{r.reference}</TableCell>
                    <TableCell className="whitespace-nowrap text-muted-foreground">{r.due ? formatDate(r.due) : ''}</TableCell>
                    <TableCell className="text-right tabular-nums">{r.debit ? formatMoney(r.debit) : ''}</TableCell>
                    <TableCell className="text-right tabular-nums">{r.credit ? formatMoney(r.credit) : ''}</TableCell>
                    <TableCell className="text-right font-medium tabular-nums">{formatMoney(sideBalance(side, r.balance))}</TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
            <TableFooter><TableRow>
              <TableCell colSpan={5}>{t('Closing balance')} · {formatDate(c.to)}</TableCell>
              <TableCell className="text-right tabular-nums">{formatMoney(c.debit)}</TableCell><TableCell className="text-right tabular-nums">{formatMoney(c.credit)}</TableCell>
              <TableCell className="text-right tabular-nums">{formatMoney(sideBalance(side, c.closing), cur)}</TableCell>
            </TableRow></TableFooter>
          </Table>
        </div>
      )}
    </div>
  )
}

function OpenTab({ partnerId, side }: { partnerId: string; side: Side }) {
  const [date, setDate] = React.useState(todayISO())
  const q = useQuery({ queryKey: ['open-items', partnerId, side, date], staleTime: 0, queryFn: () => fetchOpenItems(partnerId, side, date) })
  const o = q.data
  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-end gap-3">
        <div className="grid gap-1.5"><Label htmlFor="oi-date">{t('At|date')}</Label><Input id="oi-date" type="date" className="w-40" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} /></div>
        <p className="max-w-xl text-[13px] text-muted-foreground">{t('The statement to send for confirmation of the balance: every open document at that date, with a place to confirm and sign.')}</p>
        <div className="ml-auto"><StatementActions disabled={!o} build={async () => openItemsStatement(o ?? await fetchOpenItems(partnerId, side, date))}
          email={{ entityType: 'business_partners', entityId: partnerId }} /></div>
      </div>
      {q.isError ? <ErrorState error={q.error} onRetry={() => void q.refetch()} /> : !o ? <Skeleton className="h-48" /> : o.rows.length === 0
        ? <EmptyState compact icon={ListChecks} title={t('Nothing open at this date')} />
        : (
          <div className="overflow-x-auto rounded-lg border">
            <Table>
              <TableHeader><TableRow>
                <TableHead>{t('Document')}</TableHead><TableHead>{t('Number')}</TableHead><TableHead>{t('Their number')}</TableHead><TableHead>{t('Date')}</TableHead>
                <TableHead>{t('Due')}</TableHead><TableHead className="text-right">{t('Amount with VAT')}</TableHead><TableHead className="text-right">{t('Open, with VAT')}</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {o.rows.map((r) => (
                  <TableRow key={`${r.kind}-${r.id}`}>
                    <TableCell>{r.kind === 'advance' ? t('Advance / unallocated payment') : r.kind === 'credit_note' ? t('Credit note') : r.kind === 'debit_note' ? t('Debit note') : t('Invoice')}</TableCell>
                    <TableCell className="whitespace-nowrap">{r.number}</TableCell>
                    <TableCell className="text-muted-foreground">{r.reference}</TableCell>
                    <TableCell className="whitespace-nowrap">{formatDate(r.date)}</TableCell>
                    <TableCell className="whitespace-nowrap">{r.due ? formatDate(r.due) : ''}{r.late && r.open > 0 && <Badge variant="destructive" className="ml-2">{t('late')}</Badge>}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatMoney(r.total, r.currency)}</TableCell>
                    <TableCell className="text-right font-medium tabular-nums">{formatMoney(r.open, r.currency)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
              <TableFooter>{Object.entries(o.totals).map(([cur, v]) => (
                <TableRow key={cur}><TableCell colSpan={6}>{t('Total open, with VAT')}</TableCell><TableCell className="text-right tabular-nums">{formatMoney(v, cur)}</TableCell></TableRow>
              ))}</TableFooter>
            </Table>
          </div>
        )}
    </div>
  )
}
