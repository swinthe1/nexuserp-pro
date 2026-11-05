import type { ColumnDef } from '@tanstack/react-table'
import { Ban, Printer } from 'lucide-react'
import * as React from 'react'
import { toast } from 'sonner'
import { Can, useCompany } from '@/app/company-provider'
import { ColumnHeader, DataTable, inFilter } from '@/components/data-table/data-table'
import { PageHeader } from '@/components/page-header'
import { StatCard } from '@/components/stat-card'
import { StatusBadge } from '@/components/status-badge'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { msg, t, tEnum } from '@/i18n'
import { formatDate, formatMoney, num, todayISO } from '@/lib/utils'
import { useBlockVoucher, useVouchers, type Voucher } from '../api'
import { printVoucher } from '../receipt'

const STATUS: Record<string, string> = { active: msg('Can be spent'), used: msg('Used up'), void: msg('Blocked'), expired: msg('Expired') }
const statusOf = (v: Voucher) => (v.status === 'active' && v.valid_until && v.valid_until < todayISO() ? 'expired' : v.status)

/**
 * Gift vouchers: sold at the till, spent at any till against their code. What is left on them is owed to
 * whoever holds them (customer advances in the books) until it is spent.
 */
export function VouchersPage() {
  const { company } = useCompany()
  const q = useVouchers()
  const [block, setBlock] = React.useState<Voucher | null>(null)
  const rows = q.data ?? []
  const open = rows.filter((v) => statusOf(v) === 'active')
  const cur = company?.base_currency ?? ''

  const cols = React.useMemo<ColumnDef<Voucher>[]>(() => [
    { accessorKey: 'code', header: ({ column }) => <ColumnHeader column={column} title={t('Code')} />, meta: { label: t('Code') }, cell: ({ getValue }) => <span className="font-mono">{getValue() as string}</span> },
    { id: 'sold', accessorFn: (r) => r.created_at.slice(0, 10), header: ({ column }) => <ColumnHeader column={column} title={t('Sold')} />, meta: { label: t('Sold') },
      cell: ({ row: { original: r } }) => <span>{formatDate(r.created_at)}{r.session ? <span className="ml-1.5 text-xs text-muted-foreground">{r.session.number}</span> : null}</span> },
    { accessorKey: 'amount', header: ({ column }) => <ColumnHeader column={column} title={t('Value')} />, meta: { label: t('Value'), align: 'right' }, cell: ({ getValue }) => <span className="tabular">{formatMoney(num(getValue()))}</span> },
    { accessorKey: 'balance', header: ({ column }) => <ColumnHeader column={column} title={t('Left')} />, meta: { label: t('Left'), align: 'right' }, cell: ({ getValue }) => <span className="tabular font-medium">{formatMoney(num(getValue()))}</span> },
    { id: 'valid', accessorFn: (r) => r.valid_until ?? '', header: ({ column }) => <ColumnHeader column={column} title={t('Valid until')} />, meta: { label: t('Valid until') },
      cell: ({ row: { original: r } }) => (r.valid_until ? formatDate(r.valid_until) : '—') },
    { id: 'status', accessorFn: (r) => statusOf(r), filterFn: inFilter, header: t('Status'), meta: { label: t('Status'), exportValue: (r) => t(STATUS[statusOf(r)]!) },
      cell: ({ row: { original: r } }) => <span title={r.void_reason ?? undefined}><StatusBadge status={statusOf(r) === 'active' ? 'active' : statusOf(r) === 'void' ? 'cancelled' : statusOf(r) === 'expired' ? 'overdue' : 'done'} label={t(STATUS[statusOf(r)]!)} /></span> },
    { id: 'method', accessorFn: (r) => (r.sold_method ? tEnum(r.sold_method) : ''), header: t('Payment method'), meta: { label: t('Payment method') } },
    { accessorKey: 'note', header: t('Note'), meta: { label: t('Note') }, cell: ({ getValue }) => <span className="text-muted-foreground">{(getValue() as string | null) ?? ''}</span> },
    { id: 'act', enableHiding: false, header: '', meta: { label: '' }, cell: ({ row: { original: r } }) => (
      <div className="flex justify-end gap-1" onClick={(e) => e.stopPropagation()}>
        <Button size="icon-sm" variant="ghost" aria-label={t('Print')} onClick={() => printVoucher({ company: company?.name ?? '', register: {}, code: r.code, amount: num(r.amount), currency: cur, validUntil: r.valid_until, date: new Date(r.created_at) })}><Printer /></Button>
        {r.status === 'active' && <Can perm="pos.approve"><Button size="xs" variant="ghost" onClick={() => setBlock(r)}><Ban /> {t('Block')}</Button></Can>}
      </div>
    ) },
  ], [company?.name, cur])

  return (
    <>
      <PageHeader back={{ href: '/pos', label: t('Point of sale') }} title={t('Gift vouchers')}
        description={t('Sold at the till, spent at any till against their code, all at once or in parts. What is left on them is owed to whoever holds them until it is spent.')} />
      <div className="mb-3 grid grid-cols-2 gap-3 lg:grid-cols-3">
        <StatCard label={t('Vouchers that can be spent')} value={String(open.length)} />
        <StatCard label={t('Still owed on them')} value={formatMoney(open.reduce((s, v) => s + num(v.balance), 0))} />
        <StatCard label={t('Sold this year')} value={formatMoney(rows.filter((v) => v.created_at.startsWith(todayISO().slice(0, 4))).reduce((s, v) => s + num(v.amount), 0))} />
      </div>
      <DataTable tableKey="pos.vouchers" columns={cols} data={rows} isLoading={q.isLoading} error={q.error} getRowId={(r) => r.id}
        searchPlaceholder={t('Code, note…')} exportName={t('gift-vouchers')}
        facets={[{ columnId: 'status', title: t('Status'), options: Object.keys(STATUS).map((k) => ({ value: k, label: t(STATUS[k]!) })) }]}
        empty={{ title: t('No gift vouchers yet'), description: t('Sell one at the till: Gift voucher, the value, cash or card. The till prints it with its code.') }} />
      {block && <BlockDialog voucher={block} onClose={() => setBlock(null)} />}
    </>
  )
}

function BlockDialog({ voucher, onClose }: { voucher: Voucher; onClose: () => void }) {
  const [reason, setReason] = React.useState('')
  const run = useBlockVoucher()
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader><DialogTitle>{t('Block voucher {code}', { code: voucher.code })}</DialogTitle>
          <DialogDescription>{t('It can no longer be spent. The {amount} left on it stays owed in the books until you settle it.', { amount: formatMoney(num(voucher.balance)) })}</DialogDescription></DialogHeader>
        <div className="grid gap-1.5"><Label htmlFor="gv-why">{t('Why')}</Label><Textarea id="gv-why" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} placeholder={t('e.g. lost, stolen, sold by mistake')} /></div>
        <DialogFooter><Button variant="ghost" onClick={onClose}>{t('Cancel')}</Button>
          <Button variant="destructive" loading={run.isPending} disabled={reason.trim().length < 3}
            onClick={() => run.mutate({ id: voucher.id, reason: reason.trim() }, { onSuccess: () => { toast.success(t('Voucher blocked')); onClose() } })}>{t('Block')}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
