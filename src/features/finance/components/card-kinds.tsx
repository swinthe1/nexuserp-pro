import { useQuery } from '@tanstack/react-query'
import { ArrowLeftRight, ChevronDown, ChevronRight, Package, Receipt } from 'lucide-react'
import * as React from 'react'
import { Link } from 'react-router-dom'
import { useCompany } from '@/app/company-provider'
import { DataTable } from '@/components/data-table/data-table'
import { EmptyState } from '@/components/empty-state'
import { ErrorState } from '@/components/error-state'
import { ExportMenu } from '@/components/export-menu'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { t } from '@/i18n'
import { unwrap } from '@/lib/errors'
import { fetchPartnerCard, type Side, sideBalance } from '@/lib/documents/statements'
import { supabase } from '@/lib/supabase'
import { cn, formatDate, formatMoney, formatQty, todayISO } from '@/lib/utils'
import { VENDOR_KINDS } from '@/features/sales/vendor-kinds'

/**
 * The other kinds of partner card: by invoice (each with its payments and notes), by item (what was
 * bought or sold), the reconciliation of a partner who is customer and supplier both, and the
 * balances of everyone by group.
 */
const yearStart = () => `${new Date().getFullYear()}-01-01`
type Kind = 'invoice' | 'credit_note' | 'debit_note'
type InvoiceRow = { id: string; number: string; kind: Kind; reference: string | null; date: string; due: string | null; currency: string; total: number; paid: number
  credited: number; open: number; late: boolean; payments: { id: string; number: string; date: string; amount: number; method: string }[]
  notes: { id: string; number: string; date: string; total: number; kind: Kind }[] }
type ItemRow = { variant_id: string | null; sku: string | null; name: string; uom: string | null; qty: number; net: number; avg_price: number | null; documents: number; last: string }
type BalanceRow = { id: string; name: string; code: string | null; tax_number: string | null; groups: string[]; balance: number; late: number; credit_limit: number | null; kinds?: string[] }

const kindLabel = (k: Kind, side?: Side) => (k === 'credit_note' ? t('Credit note') : k === 'debit_note' ? t('Debit note') : side === 'vendor' ? t('Bill') : t('Invoice'))
const docHref = (side: Side, id: string) => (side === 'vendor' ? `/procurement/bills/${id}` : `/sales/invoices/${id}`)

function Period({ from, to, onFrom, onTo, id }: { from: string; to: string; onFrom: (v: string) => void; onTo: (v: string) => void; id: string }) {
  return (
    <>
      <div className="grid gap-1.5"><Label htmlFor={`${id}-from`}>{t('From')}</Label><Input id={`${id}-from`} type="date" className="w-40" value={from} onChange={(e) => e.target.value && onFrom(e.target.value)} /></div>
      <div className="grid gap-1.5"><Label htmlFor={`${id}-to`}>{t('To')}</Label><Input id={`${id}-to`} type="date" className="w-40" value={to} onChange={(e) => e.target.value && onTo(e.target.value)} /></div>
    </>
  )
}

// ------------------------------------------------------------------ by invoice
export function InvoicesTab({ partnerId, side }: { partnerId: string; side: Side }) {
  const [from, setFrom] = React.useState(yearStart())
  const [to, setTo] = React.useState(todayISO())
  const [open, setOpen] = React.useState<Set<string>>(new Set())
  const [onlyOpen, setOnlyOpen] = React.useState(false)
  const q = useQuery({ queryKey: ['partner-invoices', partnerId, side, from, to], staleTime: 0,
    queryFn: async () => unwrap(await supabase.rpc('partner_invoices_card', { p_partner: partnerId, p_side: side, p_from: from, p_to: to })) as unknown as { rows: InvoiceRow[] } })
  const rows = (q.data?.rows ?? []).filter((r) => !onlyOpen || Math.abs(r.open) > 0.004)
  const sum = (f: (r: InvoiceRow) => number) => rows.reduce((s, r) => s + (r.kind === 'credit_note' ? -1 : 1) * f(r), 0)
  const toggle = (id: string) => setOpen((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n })
  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-end gap-3">
        <Period id="ic" from={from} to={to} onFrom={setFrom} onTo={setTo} />
        <label className="flex h-9 items-center gap-2 text-[13px]"><input type="checkbox" className="size-4" checked={onlyOpen} onChange={(e) => setOnlyOpen(e.target.checked)} /> {t('Only those still open')}</label>
        <div className="ml-auto"><ExportMenu rows={rows} filename={t('Card by invoice')} title={t('Card by invoice')} columns={[
          { header: t('Document'), value: (r) => kindLabel(r.kind, side) }, { header: t('Number'), value: (r) => r.number, format: 'text' }, { header: t('Their number'), value: (r) => r.reference ?? '' },
          { header: t('Date'), value: (r) => r.date, format: 'date' }, { header: t('Due'), value: (r) => r.due ?? '', format: 'date' }, { header: t('Amount with VAT'), value: (r) => r.total, format: 'money' },
          { header: t('Paid'), value: (r) => r.paid, format: 'money' }, { header: t('Credit notes'), value: (r) => r.credited, format: 'money' }, { header: t('Open, with VAT'), value: (r) => r.open, format: 'money' },
          { header: t('Payments'), value: (r) => r.payments.map((p) => `${p.number} ${p.date} ${p.amount}`).join('; ') }]} /></div>
      </div>
      {q.isError ? <ErrorState error={q.error} onRetry={() => void q.refetch()} /> : !q.data ? <Skeleton className="h-48" /> : !rows.length
        ? <EmptyState compact icon={Receipt} title={t('No invoices in this period')} />
        : (
          <div className="overflow-x-auto rounded-lg border">
            <Table>
              <TableHeader><TableRow>
                <TableHead className="w-8" /><TableHead>{t('Document')}</TableHead><TableHead>{t('Number')}</TableHead>{side === 'vendor' && <TableHead>{t('Their number')}</TableHead>}
                <TableHead>{t('Date')}</TableHead><TableHead>{t('Due')}</TableHead><TableHead className="text-right">{t('Amount with VAT')}</TableHead>
                <TableHead className="text-right">{t('Paid')}</TableHead><TableHead className="text-right">{t('Credit notes')}</TableHead><TableHead className="text-right">{t('Open, with VAT')}</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {rows.map((r) => {
                  const more = r.payments.length + r.notes.length > 0
                  const isOpen = open.has(r.id)
                  return (
                    <React.Fragment key={r.id}>
                      <TableRow className={cn(more && 'cursor-pointer')} onClick={() => more && toggle(r.id)}>
                        <TableCell className="w-8 px-2">{more && (isOpen ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />)}</TableCell>
                        <TableCell>{r.kind === 'invoice' ? kindLabel(r.kind, side) : <Badge variant="outline">{kindLabel(r.kind, side)}</Badge>}</TableCell>
                        <TableCell className="whitespace-nowrap"><Link className="text-primary hover:underline" to={docHref(side, r.id)} onClick={(e) => e.stopPropagation()}>{r.number}</Link></TableCell>
                        {side === 'vendor' && <TableCell className="text-muted-foreground">{r.reference}</TableCell>}
                        <TableCell className="whitespace-nowrap">{formatDate(r.date)}</TableCell>
                        <TableCell className="whitespace-nowrap">{r.due ? formatDate(r.due) : ''}{r.late && <Badge variant="destructive" className="ml-2">{t('late')}</Badge>}</TableCell>
                        <TableCell className="text-right tabular-nums">{formatMoney(r.total, r.currency)}</TableCell>
                        <TableCell className="text-right tabular-nums">{r.paid ? formatMoney(r.paid) : ''}</TableCell>
                        <TableCell className="text-right tabular-nums">{r.credited ? formatMoney(r.credited) : ''}</TableCell>
                        <TableCell className={cn('text-right font-medium tabular-nums', r.late && 'text-destructive')}>{formatMoney(r.open)}</TableCell>
                      </TableRow>
                      {isOpen && [...r.payments.map((p) => ({ key: `p${p.id}`, label: t('Payment'), number: p.number, href: `/finance/payments/${p.id}`, date: p.date, amount: -p.amount })),
                        ...r.notes.map((n) => ({ key: `n${n.id}`, label: kindLabel(n.kind, side), number: n.number, href: docHref(side, n.id), date: n.date, amount: n.kind === 'credit_note' ? -n.total : n.total }))]
                        .sort((a, b) => a.date.localeCompare(b.date)).map((x) => (
                          <TableRow key={x.key} className="bg-muted/30 text-[13px]">
                            <TableCell /><TableCell className="pl-6 text-muted-foreground">↳ {x.label}</TableCell>
                            <TableCell><Link className="text-primary hover:underline" to={x.href}>{x.number}</Link></TableCell>
                            {side === 'vendor' && <TableCell />}
                            <TableCell>{formatDate(x.date)}</TableCell><TableCell /><TableCell /><TableCell />
                            <TableCell colSpan={2} className="text-right tabular-nums text-muted-foreground">{formatMoney(x.amount)}</TableCell>
                          </TableRow>
                        ))}
                    </React.Fragment>
                  )
                })}
              </TableBody>
              <TableFooter><TableRow>
                <TableCell colSpan={side === 'vendor' ? 6 : 5}>{t('Total')}</TableCell>
                <TableCell className="text-right tabular-nums">{formatMoney(sum((r) => r.total))}</TableCell>
                <TableCell className="text-right tabular-nums">{formatMoney(rows.reduce((s, r) => s + r.paid, 0))}</TableCell>
                <TableCell className="text-right tabular-nums">{formatMoney(rows.reduce((s, r) => s + r.credited, 0))}</TableCell>
                <TableCell className="text-right tabular-nums">{formatMoney(sum((r) => r.open))}</TableCell>
              </TableRow></TableFooter>
            </Table>
          </div>
        )}
    </div>
  )
}

// ------------------------------------------------------------------ by item
export function ItemsTab({ partnerId, side }: { partnerId: string; side: Side }) {
  const [from, setFrom] = React.useState(yearStart())
  const [to, setTo] = React.useState(todayISO())
  const q = useQuery({ queryKey: ['partner-items', partnerId, side, from, to], staleTime: 0,
    queryFn: async () => unwrap(await supabase.rpc('partner_items_card', { p_partner: partnerId, p_side: side, p_from: from, p_to: to })) as unknown as { rows: ItemRow[]; currency: string } })
  const rows = q.data?.rows ?? []
  const total = rows.reduce((s, r) => s + Number(r.net), 0)
  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-end gap-3">
        <Period id="it" from={from} to={to} onFrom={setFrom} onTo={setTo} />
        <p className="max-w-md text-[13px] text-muted-foreground">{side === 'vendor' ? t('What we bought from this supplier, item by item, credit notes taken off.') : t('What this customer bought from us, item by item, credit notes taken off.')}</p>
        <div className="ml-auto"><ExportMenu rows={rows} filename={t('Card by item')} title={t('Card by item')} columns={[
          { header: t('Code'), value: (r) => r.sku ?? '', format: 'text' }, { header: t('Item'), value: (r) => r.name }, { header: t('Quantity'), value: (r) => Number(r.qty), format: 'qty' },
          { header: t('Unit'), value: (r) => r.uom ?? '' }, { header: t('Value without VAT'), value: (r) => Number(r.net), format: 'money' },
          { header: t('Average price (without VAT)'), value: (r) => Number(r.avg_price ?? 0), format: 'money' }, { header: t('Documents'), value: (r) => r.documents, format: 'int' }, { header: t('Last time'), value: (r) => r.last, format: 'date' }]} /></div>
      </div>
      {q.isError ? <ErrorState error={q.error} onRetry={() => void q.refetch()} /> : !q.data ? <Skeleton className="h-48" /> : !rows.length
        ? <EmptyState compact icon={Package} title={t('Nothing in this period.')} />
        : (
          <div className="overflow-x-auto rounded-lg border">
            <Table>
              <TableHeader><TableRow>
                <TableHead>{t('Code')}</TableHead><TableHead>{t('Item')}</TableHead><TableHead className="text-right">{t('Quantity')}</TableHead><TableHead>{t('Unit')}</TableHead>
                <TableHead className="text-right">{t('Value without VAT')}</TableHead><TableHead className="text-right">{t('Average price (without VAT)')}</TableHead>
                <TableHead className="text-right">{t('Documents')}</TableHead><TableHead>{t('Last time')}</TableHead><TableHead className="text-right">%</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {rows.map((r, i) => (
                  <TableRow key={r.variant_id ?? `x${i}`}>
                    <TableCell className="whitespace-nowrap text-muted-foreground">{r.sku}</TableCell>
                    <TableCell>{r.variant_id ? <Link className="hover:underline" to={`/inventory/item-card?v=${r.variant_id}`}>{r.name}</Link> : r.name}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatQty(Number(r.qty))}</TableCell><TableCell className="text-muted-foreground">{r.uom}</TableCell>
                    <TableCell className="text-right font-medium tabular-nums">{formatMoney(Number(r.net))}</TableCell>
                    <TableCell className="text-right tabular-nums">{r.avg_price == null ? '' : formatMoney(Number(r.avg_price), undefined, 4)}</TableCell>
                    <TableCell className="text-right tabular-nums">{r.documents}</TableCell><TableCell className="whitespace-nowrap">{formatDate(r.last)}</TableCell>
                    <TableCell className="text-right tabular-nums text-muted-foreground">{total ? `${((Number(r.net) / total) * 100).toFixed(1)}` : ''}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
              <TableFooter><TableRow><TableCell colSpan={4}>{t('Total')}</TableCell><TableCell className="text-right tabular-nums">{formatMoney(total, q.data.currency)}</TableCell><TableCell colSpan={4} /></TableRow></TableFooter>
            </Table>
          </div>
        )}
    </div>
  )
}

// ------------------------------------------------------------------ reconciliation: customer and supplier both
export function ReconTab({ partnerId, renderOpen }: { partnerId: string; renderOpen: (side: Side) => React.ReactNode }) {
  const [date, setDate] = React.useState(todayISO())
  const both = useQuery({ queryKey: ['partner-recon', partnerId, date], staleTime: 0,
    queryFn: async () => { const [c, v] = await Promise.all([fetchPartnerCard(partnerId, 'customer', date, date), fetchPartnerCard(partnerId, 'vendor', date, date)]); return { c, v } } })
  const owesUs = both.data ? sideBalance('customer', both.data.c.closing) : 0
  const weOwe = both.data ? sideBalance('vendor', both.data.v.closing) : 0
  const cur = both.data?.c.currency
  const net = owesUs - weOwe
  const can = owesUs > 0.004 && weOwe > 0.004
  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="grid gap-1.5"><Label htmlFor="rc-date">{t('At|date')}</Label><Input id="rc-date" type="date" className="w-40" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} /></div>
        <p className="max-w-xl text-[13px] text-muted-foreground">{t('The partner is customer and supplier both: what they owe us set against what we owe them. The difference is what is left to pay after a compensation.')}</p>
      </div>
      {both.isError ? <ErrorState error={both.error} onRetry={() => void both.refetch()} /> : !both.data ? <Skeleton className="h-24" /> : (
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="rounded-lg border bg-card p-4"><p className="text-[12px] text-muted-foreground">{t('Owes us (as a customer)')}</p><p className="text-xl font-semibold tabular-nums">{formatMoney(owesUs, cur)}</p></div>
          <div className="rounded-lg border bg-card p-4"><p className="text-[12px] text-muted-foreground">{t('We owe (as a supplier)')}</p><p className="text-xl font-semibold tabular-nums">{formatMoney(weOwe, cur)}</p></div>
          <div className={cn('rounded-lg border p-4', net >= 0 ? 'border-primary/40 bg-primary/5' : 'border-amber-500/40 bg-amber-500/5')}>
            <p className="text-[12px] text-muted-foreground">{net >= 0 ? t('After compensation they owe us') : t('After compensation we owe them')}</p>
            <p className="text-xl font-semibold tabular-nums">{formatMoney(Math.abs(net), cur)}</p>
            {can && <Button size="sm" className="mt-2" asChild><Link to={`/finance/compensations?new=${partnerId}`}><ArrowLeftRight /> {t('Compensate {amount}', { amount: formatMoney(Math.min(owesUs, weOwe), cur) })}</Link></Button>}
          </div>
        </div>
      )}
      <div className="grid gap-4 xl:grid-cols-2">
        <div className="grid gap-2"><h3 className="text-sm font-semibold">{t('As a customer')}</h3>{renderOpen('customer')}</div>
        <div className="grid gap-2"><h3 className="text-sm font-semibold">{t('As a supplier')}</h3>{renderOpen('vendor')}</div>
      </div>
    </div>
  )
}

// ------------------------------------------------------------------ balances of everyone, by group
export function BalancesView({ onOpen }: { onOpen: (id: string) => void }) {
  const { companyId } = useCompany()
  const [side, setSide] = React.useState<Side>('customer')
  const [date, setDate] = React.useState(todayISO())
  const [group, setGroup] = React.useState<string>('')
  const q = useQuery({ queryKey: ['partner-balances', companyId, side, date], enabled: !!companyId, staleTime: 0,
    queryFn: async () => unwrap(await supabase.rpc('partner_balances', { p_company: companyId!, p_side: side, p_date: date })) as unknown as { rows: BalanceRow[]; currency: string } })
  const all = q.data?.rows ?? []
  const groups = React.useMemo(() => {
    const m = new Map<string, { n: number; sum: number; late: number }>()
    for (const r of all) for (const g of (r.groups.length ? r.groups : [''])) {
      const x = m.get(g) ?? { n: 0, sum: 0, late: 0 }; x.n++; x.sum += Number(r.balance); x.late += Number(r.late); m.set(g, x)
    }
    return [...m.entries()].sort((a, b) => (a[0] === '' ? 1 : b[0] === '' ? -1 : a[0].localeCompare(b[0])))
  }, [all])
  const [kind, setKind] = React.useState<string>('')
  const byKind = kind === '' || side !== 'vendor' ? all : all.filter((r) => (kind === '—' ? !(r.kinds ?? []).length : (r.kinds ?? []).includes(kind)))
  const rows = group === '' ? byKind : byKind.filter((r) => (group === '—' ? !r.groups.length : r.groups.includes(group)))
  const hasKinds = side === 'vendor' && all.some((r) => (r.kinds ?? []).length)
  const cur = q.data?.currency
  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-end gap-3">
        <div className="inline-flex w-fit rounded-lg bg-muted p-1 text-sm">
          {(['customer', 'vendor'] as const).map((s) => (
            <button key={s} type="button" aria-pressed={side === s} onClick={() => setSide(s)}
              className={cn('rounded-md px-3 py-1.5 font-medium', side === s ? 'bg-background shadow-sm' : 'text-muted-foreground')}>{s === 'customer' ? t('Customers') : t('Suppliers')}</button>
          ))}
        </div>
        <div className="grid gap-1.5"><Label htmlFor="pb-date">{t('At|date')}</Label><Input id="pb-date" type="date" className="w-40" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} /></div>
      </div>
      {hasKinds && (
        <div className="flex flex-wrap items-center gap-1.5 text-[13px]">
          <span className="mr-1 text-muted-foreground">{t('Kind of supplier')}:</span>
          {([['', t('All')], ...VENDOR_KINDS.map(([k, l]) => [k, t(l)]), ['—', t('Not set')]] as [string, string][]).map(([k, l]) => (
            <button key={k || 'all'} type="button" onClick={() => setKind(k)}
              className={cn('h-8 rounded-full border px-3', kind === k ? 'border-primary bg-primary/10 font-medium text-primary' : 'text-muted-foreground hover:bg-muted')}>
              {l}{k !== '' && <span className="ml-1 tabular text-muted-foreground">{formatMoney(all.filter((r) => (k === '—' ? !(r.kinds ?? []).length : (r.kinds ?? []).includes(k))).reduce((s2, r) => s2 + Number(r.balance), 0), cur)}</span>}
            </button>
          ))}
        </div>
      )}
      {groups.length > 1 && (
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => setGroup('')} className={cn('rounded-lg border px-3 py-2 text-left text-[13px]', group === '' && 'border-primary bg-accent')}>
            <span className="block font-medium">{t('All')}</span><span className="tabular-nums text-muted-foreground">{formatMoney(all.reduce((s, r) => s + Number(r.balance), 0), cur)}</span></button>
          {groups.map(([g, x]) => (
            <button key={g || '—'} type="button" onClick={() => setGroup(g || '—')} className={cn('rounded-lg border px-3 py-2 text-left text-[13px]', group === (g || '—') && 'border-primary bg-accent')}>
              <span className="block font-medium">{g || t('Without a group')} <span className="font-normal text-muted-foreground">· {x.n}</span></span>
              <span className="tabular-nums text-muted-foreground">{formatMoney(x.sum, cur)}{x.late > 0.004 && <span className="text-destructive"> · {t('{amount} late', { amount: formatMoney(x.late) })}</span>}</span>
            </button>
          ))}
        </div>
      )}
      <DataTable<BalanceRow> tableKey={`finance.balances.${side}`} data={q.data ? rows : undefined} isLoading={q.isLoading} error={q.error} getRowId={(r) => r.id}
        exportName={side === 'customer' ? t('Customer balances') : t('Supplier balances')} onRowClick={(r) => onOpen(r.id)} searchPlaceholder={t('Name, code or NIPT')}
        initialSorting={[{ id: 'balance', desc: true }]}
        columns={[
          { accessorKey: 'name', header: t('Partner'), enableHiding: false, meta: { label: t('Partner') }, cell: ({ getValue }) => <span className="font-medium">{getValue() as string}</span> },
          { accessorKey: 'code', header: t('Code'), meta: { label: t('Code') } },
          { accessorKey: 'tax_number', header: t('NIPT'), meta: { label: t('NIPT') } },
          { id: 'groups', accessorFn: (r) => r.groups.join(', '), header: t('Group|partner'), meta: { label: t('Group') } },
          ...(side === 'vendor' ? [{ id: 'kinds', accessorFn: (r: BalanceRow) => (r.kinds ?? []).map((k) => t(VENDOR_KINDS.find(([x]) => x === k)?.[1] ?? k)).join(', '), header: t('Kind of supplier'), meta: { label: t('Kind of supplier') } }] : []),
          { accessorKey: 'balance', header: side === 'customer' ? t('Owes us') : t('We owe'), meta: { label: side === 'customer' ? t('Owes us') : t('We owe'), align: 'right' },
            cell: ({ getValue }) => <span className="font-medium tabular-nums">{formatMoney(Number(getValue()))}</span> },
          { accessorKey: 'late', header: t('Of which late'), meta: { label: t('Of which late'), align: 'right' },
            cell: ({ getValue }) => Number(getValue()) > 0.004 ? <span className="tabular-nums text-destructive">{formatMoney(Number(getValue()))}</span> : '' },
          { accessorKey: 'credit_limit', header: t('Credit limit'), meta: { label: t('Credit limit'), align: 'right' }, cell: ({ getValue }) => getValue() == null ? '' : formatMoney(Number(getValue())) },
        ]} />
    </div>
  )
}
