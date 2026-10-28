import { CalendarRange, LogIn, LogOut } from 'lucide-react'
import * as React from 'react'
import { Link } from 'react-router-dom'
import { toast } from 'sonner'
import { NewReservationButton } from '../components/new-reservation-button'
import { useCompany } from '@/app/company-provider'
import { ErrorState } from '@/components/error-state'
import { PageHeader } from '@/components/page-header'
import { StatusBadge } from '@/components/status-badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { formatDateWith, t, tn } from '@/i18n'
import { describeError, unwrap } from '@/lib/errors'
import { supabase } from '@/lib/supabase'
import { cn, formatMoney, formatQty } from '@/lib/utils'
import { HOUSEKEEPING, STAY_STATUS, useHotelAction, useHotelToday, useRooms } from '../api'
import { type NewStay, ReservationDialog } from '../components/reservation-dialog'
import { HK_DOT } from './calendar-page'

/** Hotel › Front desk: who arrives, who leaves, how full the house is tonight */
export function FrontDeskPage() {
  const { can } = useCompany()
  const q = useHotelToday()
  const rooms = useRooms()
  const [open, setOpen] = React.useState<{ id?: string; initial?: NewStay } | null>(null)
  const checkIn = useHotelAction(async (id: string) => unwrap(await supabase.rpc('hotel_check_in', { p_id: id })))
  const d = q.data

  return (
    <>
      <PageHeader title={t('Front desk')} description={d ? formatDateWith(new Date(`${d.date}T00:00:00`), { weekday: 'long', day: 'numeric', month: 'long' }) : undefined}
        actions={<div className="flex gap-2">
          <Button variant="outline" asChild><Link to="/hotel/calendar"><CalendarRange />{t('Room calendar')}</Link></Button>
          {can('sales.write') && <NewReservationButton onClick={() => setOpen({ initial: {} })} />}
        </div>} />
      {q.isError ? <ErrorState error={q.error} onRetry={() => void q.refetch()} /> : !d ? <Skeleton className="h-80" /> : (
        <div className="grid gap-4">
          {/* how full tonight: one cell per room */}
          <Card>
            <CardContent className="flex flex-wrap items-center gap-x-8 gap-y-4 p-4">
              <div>
                <div className="text-4xl font-semibold tabular leading-none">{formatQty(d.occupancy)}<span className="text-xl text-muted-foreground">%</span></div>
                <div className="mt-1 text-[13px] text-muted-foreground">{t('{n} of {total} rooms taken tonight', { n: d.occupied, total: d.rooms })}</div>
              </div>
              <dl className="grid grid-cols-2 gap-x-8 gap-y-1 text-[13px] sm:grid-cols-4">
                <div><dt className="text-muted-foreground">{t('Arriving')}</dt><dd className="text-lg font-semibold tabular">{d.arrivals.filter((a) => a.status === 'booked').length}</dd></div>
                <div><dt className="text-muted-foreground">{t('Leaving')}</dt><dd className="text-lg font-semibold tabular">{d.departures.filter((a) => a.status === 'checked_in').length}</dd></div>
                <div><dt className="text-muted-foreground">{t('In the hotel')}</dt><dd className="text-lg font-semibold tabular">{d.in_house}</dd></div>
                <div><dt className="text-muted-foreground">{t('Rooms to clean')}</dt><dd className={cn('text-lg font-semibold tabular', d.dirty > 0 && 'text-amber-600')}>{d.dirty}</dd></div>
              </dl>
              <div className="ml-auto text-right text-[13px]"><div className="text-muted-foreground">{t('Invoiced for stays this month, with VAT')}</div><div className="text-lg font-semibold tabular">{formatMoney(d.revenue_month)}</div></div>
            </CardContent>
          </Card>
          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader className="pb-2"><CardTitle className="flex items-center gap-2 text-sm"><LogIn className="size-4" />{t('Arrivals today')}</CardTitle></CardHeader>
              <CardContent className="grid gap-1 p-2 pt-0">
                {!d.arrivals.length && <p className="px-2 py-6 text-center text-[13px] text-muted-foreground">{t('Nobody arrives today')}</p>}
                {d.arrivals.map((a) => (
                  <div key={a.id} className="flex items-center gap-3 rounded-md px-2 py-2 hover:bg-muted/50">
                    <span className="w-12 text-[13px] font-semibold tabular">{a.room}</span>
                    <button type="button" className="min-w-0 flex-1 text-left" onClick={() => setOpen({ id: a.id })}>
                      <span className="block truncate text-[13px] font-medium">{a.guest}</span>
                      <span className="flex items-center gap-1.5 text-xs text-muted-foreground">{a.number} · {tn(a.nights, '{n} night', '{n} nights')} ·
                        <span className={cn('size-1.5 rounded-full', HK_DOT[a.housekeeping])} />{t(HOUSEKEEPING[a.housekeeping])}</span>
                    </button>
                    {a.status === 'booked' && can('sales.write')
                      ? <Button size="sm" loading={checkIn.isPending && checkIn.variables === a.id}
                          onClick={() => void checkIn.mutateAsync(a.id).then(() => toast.success(t('{guest} is in the hotel', { guest: a.guest })), (e) => toast.error(describeError(e)))}>{t('Check in')}</Button>
                      : <StatusBadge status={a.status} label={t(STAY_STATUS[a.status])} />}
                  </div>
                ))}
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2"><CardTitle className="flex items-center gap-2 text-sm"><LogOut className="size-4" />{t('Departures today')}</CardTitle></CardHeader>
              <CardContent className="grid gap-1 p-2 pt-0">
                {!d.departures.length && <p className="px-2 py-6 text-center text-[13px] text-muted-foreground">{t('Nobody leaves today')}</p>}
                {d.departures.map((a) => (
                  <div key={a.id} className="flex items-center gap-3 rounded-md px-2 py-2 hover:bg-muted/50">
                    <span className="w-12 text-[13px] font-semibold tabular">{a.room}</span>
                    <button type="button" className="min-w-0 flex-1 text-left" onClick={() => setOpen({ id: a.id })}>
                      <span className="block truncate text-[13px] font-medium">{a.guest}</span><span className="text-xs text-muted-foreground">{a.number}</span>
                    </button>
                    {a.status === 'checked_in' ? <Button size="sm" variant="outline" onClick={() => setOpen({ id: a.id })}>{t('Check out')}</Button>
                      : <StatusBadge status={a.status} label={t(STAY_STATUS[a.status])} />}
                  </div>
                ))}
              </CardContent>
            </Card>
          </div>
          {rooms.data && rooms.data.some((r) => r.housekeeping !== 'clean') && <HousekeepingCard />}
        </div>
      )}
      <ReservationDialog open={!!open} id={open?.id} initial={open?.initial} onOpenChange={(o) => !o && setOpen(null)} />
    </>
  )
}

/** the rooms waiting for cleaning; one tap when a room is ready */
function HousekeepingCard() {
  const { can } = useCompany()
  const rooms = useRooms()
  const mark = useHotelAction(async (a: { id: string; hk: string }) => unwrap(await supabase.from('hotel_rooms').update({ housekeeping: a.hk }).eq('id', a.id)))
  const list = (rooms.data ?? []).filter((r) => r.housekeeping !== 'clean' && r.is_active)
  return (
    <Card>
      <CardHeader className="pb-2"><CardTitle className="text-sm">{t('Housekeeping')}</CardTitle></CardHeader>
      <CardContent className="flex flex-wrap gap-2 p-3 pt-0">
        {list.map((r) => (
          <div key={r.id} className="flex items-center gap-2 rounded-md border px-2.5 py-1.5">
            <span className={cn('size-2 rounded-full', HK_DOT[r.housekeeping])} />
            <span className="text-[13px] font-semibold tabular">{r.number}</span>
            <span className="text-xs text-muted-foreground">{t(HOUSEKEEPING[r.housekeeping])}</span>
            {can('sales.write') && r.housekeeping !== 'out_of_order' && (
              <Button size="sm" variant="ghost" className="h-6 px-2 text-xs" onClick={() => void mark.mutateAsync({ id: r.id, hk: 'clean' }).catch((e) => toast.error(describeError(e)))}>{t('Ready')}</Button>
            )}
          </div>
        ))}
      </CardContent>
    </Card>
  )
}
