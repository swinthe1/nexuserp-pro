import type { ColumnDef } from '@tanstack/react-table'
import { ExternalLink, Play } from 'lucide-react'
import * as React from 'react'
import { Link } from 'react-router-dom'
import { Can, useCompany } from '@/app/company-provider'
import { ColumnHeader, DataTable, inFilter } from '@/components/data-table/data-table'
import { PageHeader } from '@/components/page-header'
import { StatCard } from '@/components/stat-card'
import { StatusBadge } from '@/components/status-badge'
import { Button } from '@/components/ui/button'
import { useRealtimeInvalidate } from '@/hooks/use-realtime'
import { msg, t, tServer } from '@/i18n'
import { formatDate, humanize } from '@/lib/utils'
import { type FiscalRecord, useFiscalOverview, useFiscalRecords, useProcessQueue } from '../api'

const DOC_LABEL: Record<string, string> = { sales_invoice: msg('Invoice'), credit_note: msg('Credit note'), pos_order: msg('Till receipt') }

export function FiscalMonitorPage() {
  const { company, companyId } = useCompany()
  useRealtimeInvalidate('fiscalization_records', companyId, [['tax', companyId, 'fiscal-records'], ['tax', companyId, 'fiscal-overview']])
  const ov = useFiscalOverview()
  const recs = useFiscalRecords()
  const process = useProcessQueue()
  const xk = company?.country_code === 'XK'
  const env = ov.data?.environment
  const cols = React.useMemo<ColumnDef<FiscalRecord>[]>(() => [
    { accessorKey: 'created_at', header: ({ column }) => <ColumnHeader column={column} title={t('Queued')} />, meta: { label: t('Queued') },
      cell: ({ getValue }) => <span className="whitespace-nowrap tabular">{formatDate(getValue() as string, true)}</span> },
    { id: 'document', accessorFn: (r) => r.doc_number ?? '', enableHiding: false, header: t('Document'), meta: { label: t('Document') },
      cell: ({ row: { original: r } }) => r.href ? <Link to={r.href} onClick={(e) => e.stopPropagation()} className="whitespace-nowrap font-medium text-primary hover:underline">{r.doc_number ?? '—'}</Link> : (r.doc_number ?? '—') },
    { accessorKey: 'source_doc_type', filterFn: inFilter, header: t('Type'), meta: { label: t('Type') }, cell: ({ getValue }) => { const k = DOC_LABEL[getValue() as string]; return k ? t(k) : humanize(getValue() as string) } },
    { accessorKey: 'status', filterFn: inFilter, header: t('Status'), meta: { label: t('Status') },
      cell: ({ row: { original: r } }) => <span className="flex items-center gap-1.5"><StatusBadge status={r.status} />{r.is_subsequent && <span className="text-xs text-muted-foreground">{t('offline')}</span>}</span> },
    { accessorKey: 'iic', header: xk ? t('Device code') : t('IIC (NSLF)'), meta: { label: t('IIC') },
      cell: ({ getValue }) => <span className="whitespace-nowrap font-mono text-xs text-muted-foreground" title={(getValue() as string) ?? ''}>{getValue() ? `${(getValue() as string).slice(0, 12)}…` : '—'}</span> },
    { id: 'code', accessorFn: (r) => r.fic ?? r.verification_code ?? '', header: xk ? t('Verification code') : t('FIC (NIVF)'), meta: { label: t('FIC / verification') },
      cell: ({ getValue }) => <span className="whitespace-nowrap font-mono text-xs" title={getValue() as string}>{getValue() ? `${(getValue() as string).slice(0, 13)}${(getValue() as string).length > 13 ? '…' : ''}` : '—'}</span> },
    { accessorKey: 'tcr_code', header: xk ? t('Device') : t('TCR'), meta: { label: t('TCR') }, cell: ({ getValue }) => <span className="font-mono text-xs">{(getValue() as string) ?? '—'}</span> },
    { accessorKey: 'attempt_count', header: t('Attempts'), meta: { label: t('Attempts'), align: 'right' }, cell: ({ getValue }) => <span className="tabular">{getValue() as number}</span> },
    { accessorKey: 'error_message', header: t('Error'), meta: { label: t('Error') },
      cell: ({ row: { original: r } }) => r.error_message ? <span className="text-destructive" title={tServer(r.error_message)}>{r.error_code ? `${r.error_code} · ` : ''}{tServer(r.error_message)}</span> : '' },
    { accessorKey: 'fiscalized_at', header: t('Fiscalized'), meta: { label: t('Fiscalized') },
      cell: ({ getValue }) => <span className="whitespace-nowrap tabular">{getValue() ? formatDate(getValue() as string, true) : '—'}</span> },
    { id: 'verify', header: '', enableHiding: false, meta: { noExport: true },
      cell: ({ row: { original: r } }) => r.qr_url ? <a href={r.qr_url} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}
        className="inline-flex items-center gap-1 whitespace-nowrap text-xs text-primary hover:underline">{t('Verify')} <ExternalLink className="size-3" /></a> : null },
  ], [xk]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <>
      <PageHeader title={t('Fiscalization')}
        description={xk
          ? t('Invoices and receipts registered with the ATK through the fiscal devices. Failed ones are sent again when you process the queue.')
          : t('Every invoice and receipt sent to the tax office (CIS) to get its NIVF. Failed ones are sent again when you process the queue.')}
        actions={<Can perm="tax.write"><Button loading={process.isPending} onClick={() => process.mutate()} disabled={!ov.data?.enabled}><Play /> {t('Send waiting documents')}</Button></Can>} />
      <p className="-mt-2 mb-4 text-[13px] text-muted-foreground">
        {!ov.data ? '' : !ov.data.enabled ? t('Fiscalization is turned off for this company in its settings.')
          : env === 'production' ? t('Live mode: documents are sent with the company certificate. Until the fiscalization connector is installed, sending marks them as failed.')
          : t('Test mode: the tax office’s answer is simulated, so codes and QR links are for testing only. Live mode needs the fiscalization connector and the company certificate.')}
      </p>
      <div className="mb-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label={t('Waiting to be sent')} value={ov.data?.pending ?? 0} loading={ov.isLoading} tone={ov.data?.pending ? 'warning' : 'default'} />
        <StatCard label={t('Failed')} value={ov.data?.failed ?? 0} loading={ov.isLoading} tone={ov.data?.failed ? 'destructive' : 'default'} hint={t('Sent again next time')} />
        <StatCard label={t('Fiscalized today')} value={ov.data?.fiscalized_today ?? 0} loading={ov.isLoading} />
        <StatCard label={t('Issued offline')} value={ov.data?.subsequent ?? 0} loading={ov.isLoading} hint={t('Sent afterwards, as later fiscalization')} />
      </div>
      <DataTable tableKey="tax.fiscalization" columns={cols} data={recs.data} isLoading={recs.isLoading} error={recs.error} getRowId={(r) => r.id}
        exportName="fiscalization" searchPlaceholder={t('Document, IIC, FIC…')}
        initialSorting={[{ id: 'created_at', desc: true }]}
        facets={[
          { columnId: 'status', title: t('Status'), options: ['pending', 'sent', 'fiscalized', 'failed', 'cancelled'].map((s) => ({ value: s, label: humanize(s) })) },
          { columnId: 'source_doc_type', title: t('Type'), options: Object.entries(DOC_LABEL).map(([value, label]) => ({ value, label: t(label) })) },
        ]}
        empty={{ title: t('Nothing to fiscalize yet'), description: t('Final invoices and paid till receipts appear here.') }} />
    </>
  )
}
