import { Link } from 'react-router-dom'
import { useCompany } from '@/app/company-provider'
import { StatusBadge } from '@/components/status-badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { ErrorState } from '@/components/error-state'
import { t, tn } from '@/i18n'
import { formatDate, formatMoney, num, todayISO } from '@/lib/utils'
import { useVendorActivity } from '../api'

/** Vendor tab on the partner page: open orders, bills and what is owed */
export function VendorPurchasing({ vendorId }: { vendorId: string }) {
  const { company, can } = useCompany()
  const act = useVendorActivity(vendorId)
  const base = company?.base_currency ?? 'ALL'
  if (act.isLoading) return <Skeleton className="h-64" />
  if (act.isError) return <ErrorState error={act.error} onRetry={() => void act.refetch()} />
  const orders = act.data?.orders ?? []
  const bills = act.data?.bills ?? []
  const open = orders.filter((o) => ['approved', 'sent', 'partially_received'].includes(o.status))
  const late = open.filter((o) => o.expected_date && o.expected_date < todayISO())
  const sign = (b: { document_type: string }) => (b.document_type === 'vendor_credit' ? -1 : 1)
  const owed = bills.filter((b) => b.status === 'posted').reduce((s, b) => s + sign(b) * num(b.amount_due), 0)
  const overdue = bills.filter((b) => b.status === 'posted' && b.document_type === 'vendor_bill' && b.payment_status !== 'paid' && b.due_date < todayISO())
    .reduce((s, b) => s + num(b.amount_due), 0)

  return (
    <div className="grid gap-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <Metric label={t('Open orders')} value={open.length} hint={late.length ? <span className="text-destructive">{tn(late.length, '{n} late', '{n} late')}</span> : t('None late')} />
        <Metric label={t('On order (with VAT)')} value={`${formatMoney(open.reduce((s, o) => s + num(o.total), 0))}`} hint={t('Order totals with VAT, in the order currency')} />
        {can('invoicing.read') && <Metric label={t('We owe (with VAT)')} value={`${formatMoney(owed)} ${base}`} hint={overdue > 0 ? <span className="text-destructive">{t('{amount} overdue', { amount: formatMoney(overdue) })}</span> : t('Nothing overdue')} />}
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <List title={t('Purchase orders')} empty={t('No purchase orders yet.')} rows={orders.map((o) => ({
          id: o.id, href: `/procurement/orders/${o.id}`, number: o.number, date: o.order_date, status: o.status, amount: `${formatMoney(o.total)} ${o.currency_code}`,
        }))} />
        {can('invoicing.read') && <List title={t('Bills')} empty={t('No bills yet.')} rows={bills.map((b) => ({
          id: b.id, href: `/procurement/bills/${b.id}`, number: `${b.number} · ${b.vendor_invoice_number}`, date: b.bill_date,
          status: b.status === 'posted' ? b.payment_status : b.status, amount: `${formatMoney(sign(b) * num(b.total))} ${b.currency_code}`,
        }))} />}
      </div>
    </div>
  )
}

function Metric({ label, value, hint }: { label: string; value: React.ReactNode; hint?: React.ReactNode }) {
  return <div className="rounded-lg border bg-card p-4"><div className="text-[13px] text-muted-foreground">{label}</div><div className="tabular mt-1 text-xl font-semibold">{value}</div>{hint && <div className="mt-0.5 text-xs text-muted-foreground">{hint}</div>}</div>
}

function List({ title, rows, empty }: { title: string; empty: string; rows: { id: string; href: string; number: string; date: string; status: string; amount: string }[] }) {
  return (
    <Card>
      <CardHeader className="py-3"><CardTitle>{title}</CardTitle></CardHeader>
      <CardContent className="p-0">
        {rows.length ? (
          <ul className="divide-y">
            {rows.map((r) => (
              <li key={r.id}><Link to={r.href} className="grid grid-cols-[1fr_auto_auto] items-center gap-3 px-4 py-2 text-[13px] hover:bg-secondary/60">
                <span className="min-w-0 truncate"><span className="font-medium">{r.number}</span><span className="ml-2 text-muted-foreground">{formatDate(r.date)}</span></span>
                <StatusBadge status={r.status} /><span className="tabular w-32 text-right">{r.amount}</span>
              </Link></li>
            ))}
          </ul>
        ) : <p className="px-4 pb-4 text-[13px] text-muted-foreground">{empty}</p>}
      </CardContent>
    </Card>
  )
}
