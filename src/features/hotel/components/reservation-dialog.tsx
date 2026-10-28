import { useQueryClient } from '@tanstack/react-query'
import { BedDouble, FileText, LogIn, LogOut, Plus, Trash2 } from 'lucide-react'
import * as React from 'react'
import { Link } from 'react-router-dom'
import { toast } from 'sonner'
import { useCompany } from '@/app/company-provider'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { SearchSelect } from '@/components/search-select'
import { StatusBadge } from '@/components/status-badge'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import { Skeleton } from '@/components/ui/skeleton'
import { Textarea } from '@/components/ui/textarea'
import { t, tn } from '@/i18n'
import { describeError, unwrap } from '@/lib/errors'
import { supabase } from '@/lib/supabase'
import { formatDate, formatMoney, num, todayISO } from '@/lib/utils'
import { useCustomers } from '@/features/sales/api'
import { type Reservation, SOURCES, STAY_STATUS, type Source, addDays, nights, useHotelAction, useReservation, useRoomTypes, useRooms } from '../api'

export type NewStay = { room_id?: string; check_in?: string; check_out?: string }

type Form = Omit<Reservation, 'id' | 'number' | 'status' | 'checked_in_at' | 'checked_out_at' | 'invoice_id'>

const blank = (n: NewStay, rate: number): Form => ({
  room_id: n.room_id ?? '', partner_id: null, guest_name: '', guest_phone: null, guest_email: null, guest_document: null, adults: 2, children: 0,
  check_in: n.check_in ?? todayISO(), check_out: n.check_out ?? addDays(n.check_in ?? todayISO(), 1), rate, source: 'direct', notes: null,
})

/** one stay: book it, change it, check the guest in and out, add extras */
export function ReservationDialog({ id, initial, open, onOpenChange }: { id?: string | null; initial?: NewStay; open: boolean; onOpenChange: (o: boolean) => void }) {
  const { companyId, can } = useCompany()
  const existing = useReservation(open ? id : null)
  const rooms = useRooms()
  const types = useRoomTypes()
  const customers = useCustomers()
  const [v, setV] = React.useState<Form | null>(null)
  const rateOf = React.useCallback((roomId: string | undefined) => {
    const r = rooms.data?.find((x) => x.id === roomId)
    return num(types.data?.find((x) => x.id === r?.room_type_id)?.rate)
  }, [rooms.data, types.data])

  React.useEffect(() => {
    if (!open) { setV(null); return }
    if (id) { if (existing.data) { const { charges: _c, id: _i, number: _n, status: _s, checked_in_at: _a, checked_out_at: _b, invoice_id: _inv, ...rest } = existing.data; setV(rest) } }
    else if (rooms.data && types.data) setV(blank(initial ?? {}, rateOf(initial?.room_id)))
  }, [open, id, existing.data, rooms.data, types.data, initial, rateOf])

  const r = existing.data
  const editable = can('sales.write') && (!r || r.status === 'booked' || r.status === 'checked_in')
  const set = <K extends keyof Form>(k: K, val: Form[K]) => setV((p) => p && { ...p, [k]: val })
  const n = v ? nights(v.check_in, v.check_out) : 0

  const save = useHotelAction(async (f: Form) => {
    const row = { ...f, guest_name: f.guest_name.trim(), partner_id: f.partner_id || null }
    if (id) return unwrap(await supabase.from('hotel_reservations').update(row).eq('id', id))
    return unwrap(await supabase.from('hotel_reservations').insert({ ...row, company_id: companyId! }).select('id').single())
  })
  const status = useHotelAction(async (s: 'cancelled' | 'no_show' | 'booked') => unwrap(await supabase.from('hotel_reservations').update({ status: s }).eq('id', id!)))
  const checkIn = useHotelAction(async () => unwrap(await supabase.rpc('hotel_check_in', { p_id: id! })))
  const qc = useQueryClient()
  // check-out may add the guest as a customer: everything that lists customers or invoices refreshes
  const checkOut = useHotelAction(async () => { const inv = unwrap(await supabase.rpc('hotel_check_out', { p_id: id! })) as unknown as string; await qc.invalidateQueries(); return inv })

  const submit = async () => {
    if (!v) return
    if (!v.guest_name.trim()) return toast.error(t('Write the guest\'s name.'))
    if (!v.room_id) return toast.error(t('Choose a room.'))
    if (n < 1) return toast.error(t('The stay leaves at least one day after it arrives.'))
    try {
      await save.mutateAsync(v)
      toast.success(id ? t('Reservation saved') : t('Room booked'))
      onOpenChange(false)
    } catch (e) { toast.error(describeError(e)) }
  }
  const run = async (fn: () => Promise<unknown>, ok: string) => { try { await fn(); toast.success(ok) } catch (e) { toast.error(describeError(e)); throw e } }

  const roomOptions = (rooms.data ?? []).filter((x) => x.is_active).map((x) => {
    const tp = types.data?.find((y) => y.id === x.room_type_id)
    return { value: x.id, label: t('Room {n}', { n: x.number }), hint: tp ? `${tp.name} · ${t('{amount} a night, with VAT', { amount: formatMoney(tp.rate) })}` : undefined }
  })
  const customerOptions = (customers.data ?? []).map((c) => ({ value: c.id, label: c.name, hint: c.tax_number ?? c.code }))

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <BedDouble className="size-4" />{r ? `${r.number ?? ''} · ${r.guest_name}` : t('New reservation')}
            {r && <StatusBadge status={r.status} label={t(STAY_STATUS[r.status])} />}
          </DialogTitle>
          {r && <DialogDescription>{t('{from} – {to}', { from: formatDate(r.check_in), to: formatDate(r.check_out) })} · {tn(nights(r.check_in, r.check_out), '{n} night', '{n} nights')}</DialogDescription>}
        </DialogHeader>
        {!v ? <Skeleton className="h-72" /> : (
          <div className="grid gap-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="grid gap-1.5 sm:col-span-2"><Label htmlFor="rs-guest">{t('Guest')}</Label>
                <Input id="rs-guest" value={v.guest_name} disabled={!editable} autoFocus={!id} placeholder={t('Name and surname')} onChange={(e) => set('guest_name', e.target.value)} /></div>
              <div className="grid gap-1.5"><Label htmlFor="rs-phone">{t('Phone')}</Label>
                <Input id="rs-phone" value={v.guest_phone ?? ''} disabled={!editable} onChange={(e) => set('guest_phone', e.target.value || null)} /></div>
              <div className="grid gap-1.5"><Label htmlFor="rs-email">{t('Email')}</Label>
                <Input id="rs-email" type="email" value={v.guest_email ?? ''} disabled={!editable} onChange={(e) => set('guest_email', e.target.value || null)} /></div>
              <div className="grid gap-1.5"><Label htmlFor="rs-doc">{t('Passport or ID number')}</Label>
                <Input id="rs-doc" value={v.guest_document ?? ''} disabled={!editable} onChange={(e) => set('guest_document', e.target.value || null)} /></div>
              <div className="grid grid-cols-2 gap-3">
                <div className="grid gap-1.5"><Label htmlFor="rs-ad">{t('Adults')}</Label>
                  <Input id="rs-ad" type="number" min={1} className="tabular" value={v.adults} disabled={!editable} onChange={(e) => set('adults', Math.max(1, Number(e.target.value) || 1))} /></div>
                <div className="grid gap-1.5"><Label htmlFor="rs-ch">{t('Children')}</Label>
                  <Input id="rs-ch" type="number" min={0} className="tabular" value={v.children} disabled={!editable} onChange={(e) => set('children', Math.max(0, Number(e.target.value) || 0))} /></div>
              </div>
            </div>
            <Separator />
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="grid gap-1.5"><Label>{t('Room')}</Label>
                <SearchSelect value={v.room_id} options={roomOptions} placeholder={t('Choose a room')} disabled={!editable || r?.status === 'checked_in'}
                  onChange={(x) => setV((p) => p && { ...p, room_id: x ?? '', rate: id ? p.rate : rateOf(x ?? undefined) })} /></div>
              <div className="grid gap-1.5"><Label>{t('Booked through')}</Label>
                <Select value={v.source} onValueChange={(x) => set('source', x as Source)} disabled={!editable}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{(Object.keys(SOURCES) as Source[]).map((s) => <SelectItem key={s} value={s}>{t(SOURCES[s])}</SelectItem>)}</SelectContent>
                </Select></div>
              <div className="grid gap-1.5"><Label htmlFor="rs-in">{t('Arrives')}</Label>
                <Input id="rs-in" type="date" value={v.check_in} disabled={!editable || r?.status === 'checked_in'}
                  onChange={(e) => e.target.value && setV((p) => p && { ...p, check_in: e.target.value, check_out: p.check_out <= e.target.value ? addDays(e.target.value, 1) : p.check_out })} /></div>
              <div className="grid gap-1.5"><Label htmlFor="rs-out">{t('Leaves')}</Label>
                <Input id="rs-out" type="date" value={v.check_out} min={addDays(v.check_in, 1)} disabled={!editable} onChange={(e) => e.target.value && set('check_out', e.target.value)} /></div>
              <div className="grid gap-1.5"><Label htmlFor="rs-rate">{t('Price a night, with VAT')}</Label>
                <Input id="rs-rate" type="number" min={0} step="0.01" className="tabular" value={v.rate} disabled={!editable} onChange={(e) => set('rate', Number(e.target.value) || 0)} /></div>
              <div className="grid gap-1.5"><Label>{t('Invoice to (optional)')}</Label>
                <SearchSelect value={v.partner_id} options={customerOptions} placeholder={t('The guest')} clearable disabled={!editable} onChange={(x) => set('partner_id', x)} /></div>
              <div className="grid gap-1.5 sm:col-span-2"><Label htmlFor="rs-notes">{t('Notes')}</Label>
                <Textarea id="rs-notes" rows={2} value={v.notes ?? ''} disabled={!editable} placeholder={t('Late arrival, extra bed, breakfast…')} onChange={(e) => set('notes', e.target.value || null)} /></div>
            </div>
            <div className="flex items-baseline justify-between rounded-md bg-muted/50 px-3 py-2 text-[13px]">
              <span className="text-muted-foreground">{tn(n, '{n} night', '{n} nights')} × {formatMoney(v.rate)} · {t('with VAT|short')}</span>
              <span className="text-base font-semibold tabular">{formatMoney(n * v.rate)}</span>
            </div>
            {r && <Charges reservation={r} editable={can('sales.write') && r.status === 'checked_in'} />}
          </div>
        )}
        <DialogFooter className="flex-wrap gap-2 sm:justify-between">
          <div className="flex flex-wrap gap-2">
            {r?.status === 'booked' && can('sales.write') && (
              <>
                <Button onClick={() => void run(() => checkIn.mutateAsync(), t('{guest} is in the hotel', { guest: r.guest_name }))} loading={checkIn.isPending} disabled={r.check_in > todayISO()}
                  title={r.check_in > todayISO() ? t('The stay starts on {date}', { date: formatDate(r.check_in) }) : undefined}><LogIn />{t('Check in')}</Button>
                <ConfirmDialog trigger={<Button variant="outline">{t('Cancel the reservation')}</Button>} title={t('Cancel this reservation?')}
                  description={t('The room becomes free for those nights. It can be booked again later.')} confirmLabel={t('Cancel the reservation')} destructive
                  onConfirm={() => run(() => status.mutateAsync('cancelled'), t('Reservation cancelled'))} />
                {r.check_in <= todayISO() && <Button variant="ghost" onClick={() => void run(() => status.mutateAsync('no_show'), t('Marked as did not come'))}>{t('Did not come')}</Button>}
              </>
            )}
            {r?.status === 'checked_in' && can('invoicing.write') && (
              <ConfirmDialog trigger={<Button><LogOut />{t('Check out')}</Button>} title={t('Check {guest} out?', { guest: r.guest_name })}
                description={t('A draft invoice is made with the nights stayed and the extras; you confirm it and take the payment there. The room goes to cleaning.')}
                confirmLabel={t('Check out')} onConfirm={() => run(() => checkOut.mutateAsync(), t('Checked out; the invoice is ready'))} />
            )}
            {(r?.status === 'cancelled' || r?.status === 'no_show') && can('sales.write') && (
              <Button variant="outline" onClick={() => void run(() => status.mutateAsync('booked'), t('Booked again'))} loading={status.isPending}>{t('Book again')}</Button>
            )}
            {r?.invoice_id && <Button variant="outline" asChild><Link to={`/sales/invoices/${r.invoice_id}`}><FileText />{t('Open the invoice')}</Link></Button>}
          </div>
          {editable && <Button onClick={() => void submit()} loading={save.isPending} disabled={!v}>{id ? t('Save') : t('Book the room')}</Button>}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** extras charged to the room: minibar, breakfast, laundry… They go on the invoice at check-out */
function Charges({ reservation, editable }: { reservation: Reservation & { charges: { id: string; charge_date: string; description: string; quantity: number; unit_price: number }[] }; editable: boolean }) {
  const { companyId } = useCompany()
  const [d, setD] = React.useState({ description: '', quantity: 1, unit_price: 0 })
  const add = useHotelAction(async () => unwrap(await supabase.from('hotel_charges').insert({ company_id: companyId!, reservation_id: reservation.id, description: d.description.trim(), quantity: d.quantity, unit_price: d.unit_price })))
  const del = useHotelAction(async (cid: string) => unwrap(await supabase.from('hotel_charges').delete().eq('id', cid)))
  const total = reservation.charges.reduce((s, c) => s + num(c.quantity) * num(c.unit_price), 0)
  if (!editable && !reservation.charges.length) return null
  return (
    <div className="grid gap-2">
      <div className="flex items-baseline justify-between"><h3 className="text-[13px] font-semibold">{t('Extras on the room')}</h3>
        {reservation.charges.length > 0 && <span className="text-[13px] tabular text-muted-foreground">{formatMoney(total)} {t('with VAT|short')}</span>}</div>
      {reservation.charges.map((c) => (
        <div key={c.id} className="flex items-center gap-2 text-[13px]">
          <span className="w-20 text-muted-foreground">{formatDate(c.charge_date)}</span>
          <span className="flex-1">{c.description}</span>
          <span className="tabular text-muted-foreground">{num(c.quantity)} × {formatMoney(c.unit_price)}</span>
          <span className="w-24 text-right tabular">{formatMoney(num(c.quantity) * num(c.unit_price))}</span>
          {editable && <Button variant="ghost" size="icon" className="size-7" aria-label={t('Remove')} onClick={() => void del.mutateAsync(c.id)}><Trash2 className="size-3.5" /></Button>}
        </div>
      ))}
      {editable && (
        <div className="flex flex-wrap items-end gap-2">
          <Input className="h-8 min-w-[160px] flex-1" placeholder={t('e.g. Minibar, breakfast, laundry')} value={d.description} onChange={(e) => setD({ ...d, description: e.target.value })} aria-label={t('Description')} />
          <Input className="h-8 w-16 tabular" type="number" min={1} value={d.quantity} onChange={(e) => setD({ ...d, quantity: Math.max(1, Number(e.target.value) || 1) })} aria-label={t('Quantity')} />
          <Input className="h-8 w-24 tabular" type="number" min={0} step="0.01" value={d.unit_price} onChange={(e) => setD({ ...d, unit_price: Number(e.target.value) || 0 })} aria-label={t('Price with VAT')} />
          <Button size="sm" variant="outline" disabled={!d.description.trim() || d.unit_price <= 0} loading={add.isPending}
            onClick={() => void add.mutateAsync().then(() => setD({ description: '', quantity: 1, unit_price: 0 }), (e) => toast.error(describeError(e)))}><Plus />{t('Add')}</Button>
        </div>
      )}
    </div>
  )
}
