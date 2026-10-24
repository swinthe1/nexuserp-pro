import { ChevronDown, ChevronRight, History } from 'lucide-react'
import * as React from 'react'
import { useSearchParams } from 'react-router-dom'
import { EmptyState } from '@/components/empty-state'
import { ExportMenu } from '@/components/export-menu'
import { PageHeader } from '@/components/page-header'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { ErrorState } from '@/components/error-state'
import { msg, t, tn } from '@/i18n'
import { formatDate, humanize } from '@/lib/utils'
import { AUDIT_PAGE, type AuditRow, useAuditFeed, useAuditPeople } from '../api'

/** Readable names for the records people look up most */
const AREAS: Record<string, string> = {
  sales_invoices: msg('Customer invoices'), vendor_bills: msg('Vendor bills'), payments: msg('Payments'), journal_entries: msg('Journal entries'),
  sales_orders: msg('Sales orders'), purchase_orders: msg('Purchase orders'), deliveries: msg('Deliveries'), goods_receipts: msg('Goods receipts'),
  stock_adjustments: msg('Stock adjustments'), products: msg('Products'), product_variants: msg('Product variants'), business_partners: msg('Customers and vendors'),
  accounts: msg('Chart of accounts'), employees: msg('Employees'), employment_contracts: msg('Contracts'), payroll_runs: msg('Payroll runs'),
  leave_requests: msg('Leave requests'), vat_declarations: msg('VAT declarations'), tax_codes: msg('Tax codes'), work_orders: msg('Work orders'),
  boms: msg('Bills of materials'), shipments: msg('Shipments'), delivery_routes: msg('Delivery routes'), company_settings: msg('Company settings'),
  companies: msg('Company profile'), company_members: msg('Members'), member_roles: msg('Role assignments'), approval_workflows: msg('Approval workflows'),
  document_sequences: msg('Numbering'), company_account_defaults: msg('Accounts used for postings'), fiscal_periods: msg('Accounting periods'),
  pos_orders: msg('Till receipts'), price_lists: msg('Price lists'), warehouses: msg('Warehouses'), fixed_assets: msg('Fixed assets'),
  sales_channels: msg('Web shop channels'),
}
const ACTION: Record<string, { label: string; variant: 'success' | 'default' | 'destructive' }> = {
  INSERT: { label: msg('Created'), variant: 'success' }, UPDATE: { label: msg('Changed'), variant: 'default' }, DELETE: { label: msg('Deleted'), variant: 'destructive' },
}
const ANY = '__any'
/** Readable names for the fields that change most often; others fall back to a readable version of the column name */
const FIELDS: Record<string, string> = {
  status: msg('Status'), name: msg('Name'), code: msg('Code'), quantity: msg('Quantity'), unit_price: msg('Unit price'), total: msg('Total'),
  amount: msg('Amount'), notes: msg('Notes'), description: msg('Description'), due_date: msg('Due date'), partner_id: msg('Customer or vendor'),
  warehouse_id: msg('Warehouse'), discount_pct: msg('Discount %'), tax_code_id: msg('VAT code'), email: msg('Email'), phone: msg('Phone'),
  is_active: msg('Active'), deleted_at: msg('Deleted'), payment_status: msg('Payment status'), amount_paid: msg('Amount paid'),
  credit_limit: msg('Credit limit'), sales_price: msg('Sales price'), cost_price: msg('Cost price'), reorder_point: msg('Reorder point'),
  approved_by: msg('Approved by'), approved_at: msg('Approved at'), posted_at: msg('Confirmed at'), invoice_date: msg('Invoice date'),
  order_date: msg('Order date'), expected_date: msg('Expected date'), reference: msg('Reference'), currency_code: msg('Currency'),
  exchange_rate: msg('Exchange rate'), vendor_id: msg('Vendor'), customer_id: msg('Customer'), first_name: msg('First name'), last_name: msg('Last name'),
  gross_salary: msg('Gross salary'), start_date: msg('Start date'), end_date: msg('End date'), role_id: msg('Role'), prefix: msg('Prefix'),
}
const fieldLabel = (k: string) => (FIELDS[k] ? t(FIELDS[k]!) : humanize(k))
const areaLabel = (k: string) => (AREAS[k] ? t(AREAS[k]!) : humanize(k))
const actionLabel = (k: string) => (ACTION[k] ? t(ACTION[k]!.label) : k)

const HIDDEN = new Set(['updated_at', 'updated_by', 'created_at', 'created_by', 'company_id', 'id'])

const show = (v: unknown) => v === null || v === undefined || v === '' ? '—' : typeof v === 'object' ? JSON.stringify(v) : String(v)

export function AuditPage() {
  const [params, setParams] = useSearchParams()
  const f = {
    table: params.get('table') ?? '', actor: params.get('actor') ?? '', action: params.get('action') ?? '',
    from: params.get('from') ?? '', to: params.get('to') ?? '', record: params.get('record') ?? '', page: Number(params.get('page') ?? 0),
  }
  const set = (k: string, v: string) => {
    const p = new URLSearchParams(params)
    if (v) p.set(k, v); else p.delete(k)
    if (k !== 'page') p.delete('page')
    setParams(p, { replace: true })
  }
  const feed = useAuditFeed(f)
  const people = useAuditPeople()
  const [open, setOpen] = React.useState<number | null>(null)
  const total = feed.data?.[0]?.total ?? 0
  const pages = Math.max(1, Math.ceil(total / AUDIT_PAGE))

  return (
    <>
      <PageHeader title={t('Change history')} description={t('Every change to the company’s records: who, when, and the values before and after. Entries cannot be edited or deleted.')}
        actions={<ExportMenu rows={feed.data ?? []} filename={t('change-history')} title={t('Change history')}
          subtitle={[f.table && areaLabel(f.table), f.from && t('from {date}', { date: formatDate(f.from) }), f.to && t('to {date}', { date: formatDate(f.to) })].filter(Boolean).join(' · ') || undefined}
          columns={[
            { header: t('When'), value: (r: AuditRow) => formatDate(r.occurred_at, true) }, { header: t('Person'), value: (r) => r.actor },
            { header: t('Action'), value: (r) => actionLabel(r.action) }, { header: t('Area'), value: (r) => areaLabel(r.table_name) },
            { header: t('Record|noun'), value: (r) => r.record_label, format: 'text' }, { header: t('Fields'), value: (r) => (r.changed_fields ?? []).map(fieldLabel).join(', ') },
          ]} />} />
      <Card className="mb-4 grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-5">
        <div className="grid gap-1.5"><Label className="text-xs">{t('Area')}</Label>
          <Select value={f.table || ANY} onValueChange={(v) => set('table', v === ANY ? '' : v)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value={ANY}>{t('Everything')}</SelectItem>
              {Object.keys(AREAS).map((k) => [k, areaLabel(k)] as const).sort((a, b) => a[1].localeCompare(b[1])).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}</SelectContent>
          </Select></div>
        <div className="grid gap-1.5"><Label className="text-xs">{t('Person')}</Label>
          <Select value={f.actor || ANY} onValueChange={(v) => set('actor', v === ANY ? '' : v)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value={ANY}>{t('Anyone')}</SelectItem>{people.data?.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}</SelectContent>
          </Select></div>
        <div className="grid gap-1.5"><Label className="text-xs">{t('Action')}</Label>
          <Select value={f.action || ANY} onValueChange={(v) => set('action', v === ANY ? '' : v)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value={ANY}>{t('Any')}</SelectItem>{Object.keys(ACTION).map((k) => <SelectItem key={k} value={k}>{actionLabel(k)}</SelectItem>)}</SelectContent>
          </Select></div>
        <div className="grid gap-1.5"><Label htmlFor="au-from" className="text-xs">{t('From')}</Label><Input id="au-from" type="date" value={f.from} onChange={(e) => set('from', e.target.value)} /></div>
        <div className="grid gap-1.5"><Label htmlFor="au-to" className="text-xs">{t('To')}</Label><Input id="au-to" type="date" value={f.to} onChange={(e) => set('to', e.target.value)} /></div>
      </Card>
      {f.record && (
        <p className="mb-3 flex items-center gap-2 text-[13px]">{t('Showing the history of one record.')}
          <Button variant="link" size="sm" className="h-auto p-0" onClick={() => set('record', '')}>{t('Show everything')}</Button></p>
      )}
      {feed.isError ? <ErrorState error={feed.error} onRetry={() => void feed.refetch()} /> : feed.isLoading ? <Skeleton className="h-96" /> : !feed.data?.length ? (
        <EmptyState icon={History} title={t('Nothing matches')} description={t('No changes were recorded for these filters.')}
          action={(f.table || f.actor || f.action || f.from || f.to || f.record) ? <Button variant="outline" onClick={() => setParams({}, { replace: true })}>{t('Clear filters')}</Button> : undefined} />
      ) : (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow><TableHead className="w-8" /><TableHead>{t('When')}</TableHead><TableHead>{t('Person')}</TableHead><TableHead>{t('Action')}</TableHead><TableHead>{t('Record|noun')}</TableHead><TableHead>{t('What changed')}</TableHead></TableRow>
              </TableHeader>
              <TableBody>
                {feed.data.map((r) => {
                  const isOpen = open === r.id
                  const fields = (r.changed_fields ?? []).filter((x) => !HIDDEN.has(x))
                  return (
                    <React.Fragment key={r.id}>
                      <TableRow className="cursor-pointer" onClick={() => setOpen(isOpen ? null : r.id)} aria-expanded={isOpen}>
                        <TableCell className="text-muted-foreground">{isOpen ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}</TableCell>
                        <TableCell className="whitespace-nowrap tabular text-muted-foreground">{formatDate(r.occurred_at, true)}</TableCell>
                        <TableCell className="whitespace-nowrap">{r.actor}</TableCell>
                        <TableCell><Badge variant={ACTION[r.action]?.variant ?? 'secondary'}>{actionLabel(r.action)}</Badge></TableCell>
                        <TableCell><span className="font-medium">{r.record_label}</span><span className="block text-xs text-muted-foreground">{areaLabel(r.table_name)}</span></TableCell>
                        <TableCell className="max-w-[320px] truncate text-xs text-muted-foreground">
                          {r.action === 'UPDATE' ? fields.map(fieldLabel).join(', ') || t('Only technical fields') : r.action === 'INSERT' ? t('New record') : t('Record removed')}
                        </TableCell>
                      </TableRow>
                      {isOpen && (
                        <TableRow className="hover:bg-transparent">
                          <TableCell colSpan={6} className="bg-muted/30 p-0">
                            <Diff row={r} />
                            <div className="px-6 pb-3">
                              <Button variant="link" size="sm" className="h-auto p-0" onClick={() => { set('record', r.record_id); setOpen(null) }}>{t('Full history of this record')}</Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      )}
                    </React.Fragment>
                  )
                })}
              </TableBody>
            </Table>
          </div>
          <div className="flex items-center justify-between border-t px-4 py-2 text-[13px] text-muted-foreground">
            <span>{tn(total, '{n} change', '{n} changes')}</span>
            <span className="flex items-center gap-2">
              <Button variant="outline" size="sm" disabled={f.page === 0} onClick={() => set('page', String(f.page - 1))}>{t('Newer')}</Button>
              {t('Page {page} of {pages}', { page: f.page + 1, pages })}
              <Button variant="outline" size="sm" disabled={f.page + 1 >= pages} onClick={() => set('page', String(f.page + 1))}>{t('Older')}</Button>
            </span>
          </div>
        </Card>
      )}
    </>
  )
}

function Diff({ row }: { row: AuditRow }) {
  const keys = row.action === 'UPDATE'
    ? (row.changed_fields ?? []).filter((k) => !HIDDEN.has(k))
    : Object.keys((row.action === 'INSERT' ? row.new_data : row.old_data) ?? {}).filter((k) => !HIDDEN.has(k) && !k.endsWith('_at'))
  if (!keys.length) return <p className="px-6 py-3 text-[13px] text-muted-foreground">{t('Only the time stamps changed.')}</p>
  return (
    <div className="overflow-x-auto px-6 py-3">
      <table className="w-full text-[13px]">
        <thead><tr className="text-left text-xs text-muted-foreground"><th className="py-1 pr-4 font-medium">{t('Field')}</th>
          {row.action !== 'INSERT' && <th className="py-1 pr-4 font-medium">{t('Before')}</th>}{row.action !== 'DELETE' && <th className="py-1 font-medium">{t('After')}</th>}</tr></thead>
        <tbody>
          {keys.map((k) => (
            <tr key={k} className="align-top">
              <td className="py-1 pr-4 text-muted-foreground">{fieldLabel(k)}</td>
              {row.action !== 'INSERT' && <td className="max-w-[360px] break-words py-1 pr-4 font-mono text-xs line-through decoration-destructive/50">{show(row.old_data?.[k])}</td>}
              {row.action !== 'DELETE' && <td className="max-w-[360px] break-words py-1 font-mono text-xs">{show(row.new_data?.[k])}</td>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
