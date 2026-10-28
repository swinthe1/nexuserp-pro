import { useQuery } from '@tanstack/react-query'
import { BookOpenText, ListChecks } from 'lucide-react'
import * as React from 'react'
import { Link, useSearchParams } from 'react-router-dom'
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
import { t } from '@/i18n'
import {
  fetchOpenItems, fetchPartnerCard, openItemsStatement, partnerCardStatement, type Side, sideBalance,
} from '@/lib/documents/statements'
import { cn, formatDate, formatMoney, todayISO } from '@/lib/utils'
import { usePartners } from '@/features/sales/api'
import { SOURCE_HREF, sourceLabel } from '../api'

const yearStart = () => `${new Date().getFullYear()}-01-01`

/** Finance › Partner cards: the account card of a customer or supplier and their open items (IOS). */
export function CardsPage() {
  const [params, setParams] = useSearchParams()
  const partners = usePartners()
  const id = params.get('p')
  const p = partners.data?.find((x) => x.id === id)
  return (
    <>
      <PageHeader title={t('Partner cards|menu')} description={t('The account card of a customer or supplier with the running balance, and the statement of open items to confirm balances (IOS).')} />
      <div className="mb-4 max-w-md">
        <SearchSelect value={id} onChange={(v) => { const n = new URLSearchParams(params); if (v) n.set('p', v); else n.delete('p'); setParams(n, { replace: true }) }}
          placeholder={t('Choose a customer or supplier')}
          options={(partners.data ?? []).map((x) => ({ value: x.id, label: x.name, hint: [x.code, x.tax_number].filter(Boolean).join(' · ') }))} />
      </div>
      {!p ? <EmptyState icon={BookOpenText} title={t('Choose a customer or supplier')} description={t('Their card shows every invoice, payment and compensation with the balance after each.')} />
        : <PartnerCards key={p.id} partnerId={p.id} isCustomer={p.is_customer} isVendor={p.is_vendor} />}
    </>
  )
}

/** The card and the open items of one partner (also on the partner's page). */
export function PartnerCards({ partnerId, isCustomer, isVendor }: { partnerId: string; isCustomer: boolean; isVendor: boolean }) {
  const [side, setSide] = React.useState<Side>(isCustomer ? 'customer' : 'vendor')
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
        <TabsList><TabsTrigger value="card">{t('Card')}</TabsTrigger><TabsTrigger value="open">{t('Open items (IOS)')}</TabsTrigger></TabsList>
        <TabsContent value="card"><CardTab partnerId={partnerId} side={side} /></TabsContent>
        <TabsContent value="open"><OpenTab partnerId={partnerId} side={side} /></TabsContent>
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
                    <TableCell>{r.kind === 'advance' ? t('Advance / unallocated payment') : r.kind === 'credit_note' ? t('Credit note') : t('Invoice')}</TableCell>
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
