import { BedDouble, Plus } from 'lucide-react'
import * as React from 'react'
import { toast } from 'sonner'
import { useCompany } from '@/app/company-provider'
import { EmptyState } from '@/components/empty-state'
import { ErrorState } from '@/components/error-state'
import { PageHeader } from '@/components/page-header'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { t, td } from '@/i18n'
import { describeError, unwrap } from '@/lib/errors'
import { supabase } from '@/lib/supabase'
import { cn, formatMoney } from '@/lib/utils'
import { useLookups } from '@/features/settings/api'
import { HOUSEKEEPING, type Housekeeping, type Room, type RoomType, useHotelAction, useRoomTypes, useRooms } from '../api'
import { HK_DOT } from './calendar-page'

const DEFAULT_TAX = '__default'

/** Hotel › Rooms: the kinds of room with their price, and each room with its cleaning state */
export function HotelRoomsPage() {
  const { can } = useCompany()
  const types = useRoomTypes()
  const rooms = useRooms()
  const [type, setType] = React.useState<Partial<RoomType> | null>(null)
  const [room, setRoom] = React.useState<Partial<Room> | null>(null)
  const w = can('sales.write')
  const markHk = useHotelAction(async (a: { id: string; hk: Housekeeping }) => unwrap(await supabase.from('hotel_rooms').update({ housekeeping: a.hk }).eq('id', a.id)))

  if (types.isError || rooms.isError) return <ErrorState error={types.error ?? rooms.error} onRetry={() => { void types.refetch(); void rooms.refetch() }} />
  if (!types.data || !rooms.data) return <Skeleton className="h-96" />
  return (
    <>
      <PageHeader title={t('Rooms')} description={t('The kinds of room with their price a night, and every room with its cleaning state.')} />
      <div className="grid gap-4 grid-cols-[minmax(0,1fr)] lg:grid-cols-[360px_minmax(0,1fr)]">
        <Card className="self-start">
          <CardHeader className="flex-row items-start justify-between gap-2 space-y-0">
            <div><CardTitle>{t('Room types')}</CardTitle><CardDescription>{t('Price a night with VAT; a reservation starts from it.')}</CardDescription></div>
            {w && <Button size="sm" variant="outline" onClick={() => setType({ capacity: 2, rate: 0, sort: types.data.length })}><Plus />{t('Add')}</Button>}
          </CardHeader>
          <CardContent className="grid gap-1 p-2 pt-0">
            {!types.data.length && <p className="px-2 py-6 text-center text-[13px] text-muted-foreground">{t('Start with a type: single, double, suite…')}</p>}
            {types.data.map((k) => (
              <button key={k.id} type="button" disabled={!w} onClick={() => setType(k)} className="flex items-center justify-between rounded-md px-2 py-2 text-left enabled:hover:bg-muted/60">
                <span><span className="block text-[13px] font-medium">{k.name}</span>
                  <span className="text-xs text-muted-foreground">{t('{n} people', { n: k.capacity })} · {t('{n} rooms', { n: rooms.data.filter((r) => r.room_type_id === k.id).length })}</span></span>
                <span className="text-[13px] tabular">{formatMoney(k.rate)}</span>
              </button>
            ))}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex-row items-start justify-between gap-2 space-y-0">
            <div><CardTitle>{t('Rooms')}</CardTitle><CardDescription>{t('A room out of order cannot be booked or checked into.')}</CardDescription></div>
            {w && types.data.length > 0 && <Button size="sm" onClick={() => setRoom({ room_type_id: types.data[0].id, housekeeping: 'clean', is_active: true })}><Plus />{t('Add a room')}</Button>}
          </CardHeader>
          <CardContent className="p-0">
            {!rooms.data.length ? <EmptyState compact icon={BedDouble} title={t('No rooms yet')} description={types.data.length ? t('Add each room with its number.') : t('Add a room type first.')} /> : (
              <Table>
                <TableHeader><TableRow className="hover:bg-transparent">
                  <TableHead>{t('Room')}</TableHead><TableHead>{t('Type')}</TableHead><TableHead>{t('Floor')}</TableHead><TableHead className="w-[190px]">{t('Cleaning')}</TableHead>
                </TableRow></TableHeader>
                <TableBody>
                  {rooms.data.map((r) => (
                    <TableRow key={r.id} className={cn(!r.is_active && 'opacity-60')}>
                      <TableCell><button type="button" disabled={!w} className="font-semibold tabular enabled:text-primary enabled:hover:underline" onClick={() => setRoom(r)}>{r.number}</button>
                        {r.notes && <span className="ml-2 text-xs text-muted-foreground">{r.notes}</span>}</TableCell>
                      <TableCell className="text-[13px]">{types.data.find((k) => k.id === r.room_type_id)?.name}</TableCell>
                      <TableCell className="text-[13px]">{r.floor ?? '—'}</TableCell>
                      <TableCell>
                        <Select value={r.housekeeping} disabled={!w} onValueChange={(hk) => void markHk.mutateAsync({ id: r.id, hk: hk as Housekeeping }).catch((e) => toast.error(describeError(e)))}>
                          <SelectTrigger className="h-8" aria-label={t('Cleaning')}><SelectValue /></SelectTrigger>
                          <SelectContent>{(Object.keys(HOUSEKEEPING) as Housekeeping[]).map((h) => (
                            <SelectItem key={h} value={h}><span className="flex items-center gap-2"><span className={cn('size-2 rounded-full', HK_DOT[h])} />{t(HOUSEKEEPING[h])}</span></SelectItem>
                          ))}</SelectContent>
                        </Select>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>
      {type && <TypeDialog value={type} onClose={() => setType(null)} />}
      {room && <RoomDialog value={room} types={types.data} onClose={() => setRoom(null)} />}
    </>
  )
}

function TypeDialog({ value, onClose }: { value: Partial<RoomType>; onClose: () => void }) {
  const { companyId } = useCompany()
  const lookups = useLookups()
  const [v, setV] = React.useState(value)
  const save = useHotelAction(async () => {
    const row = { name: v.name!.trim(), capacity: v.capacity ?? 2, rate: v.rate ?? 0, tax_code_id: v.tax_code_id ?? null, sort: v.sort ?? 0 }
    return v.id ? unwrap(await supabase.from('hotel_room_types').update(row).eq('id', v.id)) : unwrap(await supabase.from('hotel_room_types').insert({ ...row, company_id: companyId! }))
  })
  const submit = async () => {
    if (!v.name?.trim()) return toast.error(t('Give the type a name.'))
    try { await save.mutateAsync(undefined); toast.success(t('Room type saved')); onClose() } catch (e) { toast.error(describeError(e)) }
  }
  const taxes = (lookups.data?.taxCodes ?? []).filter((c) => c.scope !== 'purchase')
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader><DialogTitle>{v.id ? t('Edit the room type') : t('New room type')}</DialogTitle></DialogHeader>
        <div className="grid gap-3">
          <div className="grid gap-1.5"><Label htmlFor="rt-name">{t('Name')}</Label><Input id="rt-name" autoFocus value={v.name ?? ''} placeholder={t('e.g. Double with sea view')} onChange={(e) => setV({ ...v, name: e.target.value })} /></div>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5"><Label htmlFor="rt-cap">{t('People')}</Label><Input id="rt-cap" type="number" min={1} className="tabular" value={v.capacity ?? 2} onChange={(e) => setV({ ...v, capacity: Math.max(1, Number(e.target.value) || 1) })} /></div>
            <div className="grid gap-1.5"><Label htmlFor="rt-rate">{t('Price a night, with VAT')}</Label><Input id="rt-rate" type="number" min={0} step="0.01" className="tabular" value={v.rate ?? 0} onChange={(e) => setV({ ...v, rate: Number(e.target.value) || 0 })} /></div>
          </div>
          <div className="grid gap-1.5"><Label>{t('VAT')}</Label>
            <Select value={v.tax_code_id ?? DEFAULT_TAX} onValueChange={(x) => setV({ ...v, tax_code_id: x === DEFAULT_TAX ? null : x })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value={DEFAULT_TAX}>{t('The company\'s usual VAT on sales')}</SelectItem>
                {taxes.map((c) => <SelectItem key={c.id} value={c.id}>{c.code} · {td(c.name)}</SelectItem>)}</SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">{t('Accommodation often has a reduced rate; check with your accountant.')}</p></div>
        </div>
        <DialogFooter><Button variant="outline" onClick={onClose}>{t('Cancel')}</Button><Button onClick={() => void submit()} loading={save.isPending}>{t('Save')}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function RoomDialog({ value, types, onClose }: { value: Partial<Room>; types: RoomType[]; onClose: () => void }) {
  const { companyId } = useCompany()
  const [v, setV] = React.useState(value)
  const save = useHotelAction(async () => {
    const row = { number: v.number!.trim(), room_type_id: v.room_type_id!, floor: v.floor || null, notes: v.notes || null, is_active: v.is_active ?? true }
    return v.id ? unwrap(await supabase.from('hotel_rooms').update(row).eq('id', v.id)) : unwrap(await supabase.from('hotel_rooms').insert({ ...row, company_id: companyId! }))
  })
  const submit = async () => {
    if (!v.number?.trim()) return toast.error(t('Write the room number.'))
    try { await save.mutateAsync(undefined); toast.success(t('Room saved')); onClose() } catch (e) { toast.error(describeError(e)) }
  }
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader><DialogTitle>{v.id ? t('Room {n}', { n: value.number }) : t('New room|hotel')}</DialogTitle></DialogHeader>
        <div className="grid gap-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5"><Label htmlFor="rm-no">{t('Number')}</Label><Input id="rm-no" autoFocus value={v.number ?? ''} placeholder="101" onChange={(e) => setV({ ...v, number: e.target.value })} /></div>
            <div className="grid gap-1.5"><Label htmlFor="rm-fl">{t('Floor')}</Label><Input id="rm-fl" value={v.floor ?? ''} onChange={(e) => setV({ ...v, floor: e.target.value })} /></div>
          </div>
          <div className="grid gap-1.5"><Label>{t('Type')}</Label>
            <Select value={v.room_type_id} onValueChange={(x) => setV({ ...v, room_type_id: x })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{types.map((k) => <SelectItem key={k.id} value={k.id}>{k.name} · {t('{amount} a night, with VAT', { amount: formatMoney(k.rate) })}</SelectItem>)}</SelectContent>
            </Select></div>
          <div className="grid gap-1.5"><Label htmlFor="rm-notes">{t('Notes')}</Label><Input id="rm-notes" value={v.notes ?? ''} placeholder={t('e.g. Balcony, accessible')} onChange={(e) => setV({ ...v, notes: e.target.value })} /></div>
          {v.id && <label className="flex items-center justify-between text-[13px]">{t('In use')}<Switch checked={v.is_active ?? true} onCheckedChange={(c) => setV({ ...v, is_active: c })} /></label>}
        </div>
        <DialogFooter><Button variant="outline" onClick={onClose}>{t('Cancel')}</Button><Button onClick={() => void submit()} loading={save.isPending}>{t('Save')}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
