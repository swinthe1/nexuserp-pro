import { Search } from 'lucide-react'
import { PageTableExport } from '@/components/page-table-export'
import * as React from 'react'
import { Link } from 'react-router-dom'
import { NewReservationButton } from '../components/new-reservation-button'
import { useCompany } from '@/app/company-provider'
import { EmptyState } from '@/components/empty-state'
import { ErrorState } from '@/components/error-state'
import { PageHeader } from '@/components/page-header'
import { StatusBadge } from '@/components/status-badge'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { t } from '@/i18n'
import { formatDate, formatMoney } from '@/lib/utils'
import { SOURCES, STAY_STATUS, type StayStatus, nights, useReservations, useRooms } from '../api'
import { ReservationDialog } from '../components/reservation-dialog'

/** Hotel › Reservations: every stay, to find one by guest, number or phone */
export function ReservationsPage() {
  const { can } = useCompany()
  const [status, setStatus] = React.useState('all')
  const [search, setSearch] = React.useState('')
  const [q, setQ] = React.useState('')
  React.useEffect(() => { const h = setTimeout(() => setQ(search), 250); return () => clearTimeout(h) }, [search])
  const list = useReservations({ status, search: q })
  const rooms = useRooms()
  const [open, setOpen] = React.useState<{ id?: string } | null>(null)
  const roomNo = (id: string) => rooms.data?.find((r) => r.id === id)?.number ?? ''
  return (
    <>
      <PageHeader title={t('Reservations')} description={t('Every stay, booked, in the hotel or gone. Search by guest, number or phone.')}
        actions={<><PageTableExport />{can('sales.write') && <NewReservationButton onClick={() => setOpen({})} />}</>} />
      <div className="mb-3 flex flex-wrap gap-2">
        <div className="relative min-w-[220px] flex-1 sm:max-w-xs">
          <Search className="absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
          <Input className="pl-8" value={search} placeholder={t('Guest, number or phone')} onChange={(e) => setSearch(e.target.value)} aria-label={t('Search')} />
        </div>
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger className="w-[170px]"><SelectValue /></SelectTrigger>
          <SelectContent><SelectItem value="all">{t('All')}</SelectItem>
            {(Object.keys(STAY_STATUS) as StayStatus[]).map((s) => <SelectItem key={s} value={s}>{t(STAY_STATUS[s])}</SelectItem>)}</SelectContent>
        </Select>
      </div>
      {list.isError ? <ErrorState error={list.error} onRetry={() => void list.refetch()} /> : !list.data ? <Skeleton className="h-80" /> : (
        <Card>
          <CardContent className="overflow-x-auto p-0">
            {!list.data.length ? <EmptyState title={t('No reservations')} description={q || status !== 'all' ? t('Nothing matches; try another search.') : t('Book a room from the calendar or with New reservation.')} /> : (
              <Table className="min-w-[760px]">
                <TableHeader><TableRow className="hover:bg-transparent">
                  <TableHead>{t('Number')}</TableHead><TableHead>{t('Guest')}</TableHead><TableHead>{t('Room')}</TableHead><TableHead>{t('Arrives')}</TableHead><TableHead>{t('Leaves')}</TableHead>
                  <TableHead>{t('Booked through')}</TableHead><TableHead className="text-right">{t('Amount (with VAT)')}</TableHead><TableHead>{t('Status')}</TableHead>
                </TableRow></TableHeader>
                <TableBody>
                  {list.data.map((r) => (
                    <TableRow key={r.id} className="cursor-pointer" onClick={() => setOpen({ id: r.id })} tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && setOpen({ id: r.id })}>
                      <TableCell className="font-mono text-[13px] text-primary">{r.number}</TableCell>
                      <TableCell><span className="text-[13px] font-medium">{r.guest_name}</span>{r.guest_phone && <span className="block text-xs text-muted-foreground">{r.guest_phone}</span>}</TableCell>
                      <TableCell className="text-[13px] font-semibold tabular">{roomNo(r.room_id)}</TableCell>
                      <TableCell className="text-[13px]">{formatDate(r.check_in)}</TableCell>
                      <TableCell className="text-[13px]">{formatDate(r.check_out)}</TableCell>
                      <TableCell className="text-[13px]">{t(SOURCES[r.source])}</TableCell>
                      {/* the nights and the extras on the room, as the check-out invoice will have them */}
                      <TableCell className="text-right tabular">{(() => {
                        const extras = ((r as { charges?: { quantity: number; unit_price: number }[] }).charges ?? []).reduce((a, c) => a + Number(c.quantity) * Number(c.unit_price), 0)
                        return <>{formatMoney(nights(r.check_in, r.check_out) * r.rate + extras)}{extras > 0 && <span className="block text-xs text-muted-foreground">{t('incl. extras {amount}', { amount: formatMoney(extras) })}</span>}</>
                      })()}</TableCell>
                      <TableCell><StatusBadge status={r.status} label={t(STAY_STATUS[r.status])} />
                        {r.invoice_id && <Link to={`/sales/invoices/${r.invoice_id}`} className="ml-2 text-xs text-primary hover:underline" onClick={(e) => e.stopPropagation()}>{t('Invoice')}</Link>}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      )}
      <ReservationDialog open={!!open} id={open?.id} onOpenChange={(o) => !o && setOpen(null)} />
    </>
  )
}
