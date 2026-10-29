import type { ColumnDef } from '@tanstack/react-table'
import { Plus } from 'lucide-react'
import * as React from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { ColumnHeader, DataTable, inFilter } from '@/components/data-table/data-table'
import { PageHeader } from '@/components/page-header'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { t } from '@/i18n'
import { cn, formatDate } from '@/lib/utils'
import { type PlatformClient, usePlatformClients } from '../api'
import { BUSINESS_TYPES, businessTypeLabel } from '../business-types'
import { licenseState, linkState, PendingAccounts, planLabel, PLANS } from '../dialogs'
import { ClientActions } from './client-actions'
import { useConsoleActions } from './layout'

/** a client's licence, as a key the filters use */
export const STATE_KEY = ['none', 'paused', 'expired', 'ending', 'future', 'active'] as const
export const stateKey = (c: PlatformClient) => STATE_KEY[licenseState(c).rank]!

export function UsersBar({ used, max }: { used: number; max: number | null }) {
  const pct = max ? Math.min(100, (used / max) * 100) : 0
  return (
    <div className="flex min-w-[88px] flex-col items-end gap-1">
      <span className={cn('tabular text-[13px]', max != null && used >= max && 'font-medium text-warning')}>{used} / {max ?? '—'}</span>
      <span className="h-1 w-16 overflow-hidden rounded-full bg-muted"><span className={cn('block h-full rounded-full', pct >= 100 ? 'bg-warning' : 'bg-primary')} style={{ width: `${pct}%` }} /></span>
    </div>
  )
}

export function ClientsPage() {
  const clients = usePlatformClients()
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const { newClient } = useConsoleActions()
  const list = React.useMemo(() => [...(clients.data?.clients ?? [])].sort((a, b) => licenseState(a).rank - licenseState(b).rank || a.name.localeCompare(b.name)), [clients.data])

  const cols = React.useMemo<ColumnDef<PlatformClient>[]>(() => [
    { id: 'client', accessorFn: (c) => [c.name, c.legal_name, c.tax_number, ...c.admins].filter(Boolean).join(' '), enableHiding: false,
      header: ({ column }) => <ColumnHeader column={column} title={t('Client')} />, meta: { label: t('Client'), exportValue: (c) => c.name },
      sortingFn: (a, b) => a.original.name.localeCompare(b.original.name),
      cell: ({ row: { original: c } }) => (
        <div className="min-w-[200px]">
          <div className="font-medium">{c.name}</div>
          <div className="text-xs text-muted-foreground">{c.country_code === 'XK' ? t('Kosovo') : t('Albania')}{c.tax_number ? ` · ${c.tax_number}` : ''} · {t(businessTypeLabel(c.business_type))}</div>
          {(c.is_training || (c.sync ?? []).some((x) => x.is_active)) && (
            <div className="mt-1 flex flex-wrap gap-1">
              {c.is_training && <Badge variant="warning">{t('Training')}</Badge>}
              {(c.sync ?? []).filter((x) => x.is_active).map((x) => <Badge key={x.id} variant={linkState(x).variant}>{linkState(x).label}</Badge>)}
            </div>
          )}
        </div>
      ) },
    { id: 'admin', accessorFn: (c) => c.admins[0] ?? '', header: t('Administrator'), meta: { label: t('Administrator') },
      cell: ({ row: { original: c } }) => <span className="text-[13px]">{c.admins[0] ?? <span className="text-muted-foreground">—</span>}{c.admins.length > 1 && <span className="text-xs text-muted-foreground"> +{c.admins.length - 1}</span>}</span> },
    { id: 'users', accessorFn: (c) => c.users, header: ({ column }) => <ColumnHeader column={column} title={t('Users')} />, meta: { label: t('Users'), align: 'right' },
      cell: ({ row: { original: c } }) => <UsersBar used={c.users} max={c.max_users} /> },
    { id: 'plan', accessorFn: (c) => c.plan ?? '', filterFn: inFilter, header: t('Plan'), meta: { label: t('Plan'), exportValue: (c) => planLabel(c.plan) },
      cell: ({ row: { original: c } }) => <div><div>{planLabel(c.plan)}</div>{c.licence_code && <div className="font-mono text-[11px] text-muted-foreground">{c.licence_code}</div>}</div> },
    { id: 'state', accessorFn: stateKey, filterFn: inFilter, header: ({ column }) => <ColumnHeader column={column} title={t('Licence')} />, meta: { label: t('Licence'), exportValue: (c) => licenseState(c).label },
      sortingFn: (a, b) => licenseState(a.original).rank - licenseState(b.original).rank,
      cell: ({ row: { original: c } }) => { const s = licenseState(c); return <div className="flex flex-col items-start gap-1"><Badge variant={s.variant}>{s.label}</Badge>{c.valid_until && <span className="text-xs text-muted-foreground">{t('until {date}', { date: formatDate(c.valid_until) })}</span>}</div> } },
    { id: 'where', accessorFn: (c) => (c.local_seen_at ? 'local' : 'cloud'), filterFn: inFilter, header: t('Where it runs'), meta: { label: t('Where it runs') },
      cell: ({ row: { original: c } }) => c.local_seen_at
        ? <div className="text-[13px]">{t('Local server')}<div className="text-xs text-muted-foreground">{formatDate(c.local_seen_at, true)}</div></div>
        : <span className="text-[13px] text-muted-foreground">{t('Cloud')}</span> },
    { id: 'country', accessorFn: (c) => c.country_code, filterFn: inFilter, header: t('Country'), meta: { label: t('Country') }, cell: ({ getValue }) => (getValue() === 'XK' ? t('Kosovo') : t('Albania')) },
    { id: 'type', accessorFn: (c) => c.business_type ?? 'general', filterFn: inFilter, header: t('Type of business'), meta: { label: t('Type of business') }, cell: ({ getValue }) => t(businessTypeLabel(getValue() as string)) },
    { id: 'created', accessorFn: (c) => c.created_at, header: ({ column }) => <ColumnHeader column={column} title={t('Client since')} />, meta: { label: t('Client since') },
      cell: ({ getValue }) => <span className="text-[13px] text-muted-foreground">{formatDate(getValue() as string)}</span> },
    { id: 'activity', accessorFn: (c) => c.last_activity ?? '', header: ({ column }) => <ColumnHeader column={column} title={t('Last activity')} />, meta: { label: t('Last activity') },
      cell: ({ row: { original: c } }) => <span className="text-[13px] text-muted-foreground">{c.last_activity ? formatDate(c.last_activity, true) : t('Never')}</span> },
    { id: 'actions', enableHiding: false, header: '', meta: { noExport: true }, cell: ({ row: { original: c } }) => <ClientActions c={c} /> },
  ], [])

  const initial = params.get('state') ? [{ id: 'state', value: params.get('state')!.split(',') }] : undefined
  return (
    <>
      <PageHeader icon={false} title={t('Clients')} description={t('Every company on the platform with its licence. Click a client to see everything about it.')}
        actions={<Button onClick={newClient}><Plus /> {t('New client')}</Button>} />
      <PendingAccounts clients={list} />
      <DataTable tableKey="platform.clients" columns={cols} data={list} isLoading={clients.isLoading} error={clients.error} getRowId={(c) => c.id}
        onRowClick={(c) => navigate(`/platform/clients/${c.id}`)} exportName={t('clients')} searchPlaceholder={t('Name, NUI or email…')}
        initialHidden={['country', 'type', 'created']} initialFilters={initial}
        facets={[
          { columnId: 'state', title: t('Licence'), options: [
            { value: 'active', label: t('Active') }, { value: 'ending', label: t('Ending soon') }, { value: 'expired', label: t('Expired') },
            { value: 'paused', label: t('Paused') }, { value: 'future', label: t('Starts later') }, { value: 'none', label: t('No licence') }] },
          { columnId: 'plan', title: t('Plan'), options: [...PLANS.map((p) => ({ value: p.value, label: t(p.label) })), { value: 'trial', label: t('Trial') }] },
          { columnId: 'where', title: t('Where it runs'), options: [{ value: 'cloud', label: t('Cloud') }, { value: 'local', label: t('Local server') }] },
          { columnId: 'country', title: t('Country'), options: [{ value: 'XK', label: t('Kosovo') }, { value: 'AL', label: t('Albania') }] },
          { columnId: 'type', title: t('Type of business'), options: BUSINESS_TYPES.map((b) => ({ value: b.value, label: t(b.label) })) },
        ]}
        empty={{ title: t('No clients yet'), description: t('Add the first client: their company, the administrator account and the licence period.') }} />
    </>
  )
}
