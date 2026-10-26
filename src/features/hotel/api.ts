import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useCompany } from '@/app/company-provider'
import { msg } from '@/i18n'
import { unwrap } from '@/lib/errors'
import { supabase } from '@/lib/supabase'

export type Housekeeping = 'clean' | 'dirty' | 'inspect' | 'out_of_order'
export type StayStatus = 'booked' | 'checked_in' | 'checked_out' | 'cancelled' | 'no_show'
export type Source = 'direct' | 'phone' | 'email' | 'walk_in' | 'booking' | 'airbnb' | 'agency' | 'other'

export interface RoomType { id: string; name: string; capacity: number; rate: number; tax_code_id: string | null; sort: number }
export interface Room { id: string; number: string; room_type_id: string; floor: string | null; housekeeping: Housekeeping; notes: string | null; is_active: boolean }
export interface Reservation {
  id: string; number: string | null; status: StayStatus; room_id: string; partner_id: string | null
  guest_name: string; guest_phone: string | null; guest_email: string | null; guest_document: string | null
  adults: number; children: number; check_in: string; check_out: string; rate: number; source: Source; notes: string | null
  checked_in_at: string | null; checked_out_at: string | null; invoice_id: string | null
}
export interface Charge { id: string; reservation_id: string; charge_date: string; description: string; variant_id: string | null; quantity: number; unit_price: number }

export interface CalendarRoom { id: string; number: string; floor: string | null; housekeeping: Housekeeping; type_id: string; type: string; rate: number; capacity: number }
export interface CalendarStay { id: string; number: string | null; room_id: string; status: StayStatus; guest: string; check_in: string; check_out: string; adults: number; children: number; source: Source; rate: number }
export interface Today {
  date: string; rooms: number; occupied: number; occupancy: number; in_house: number; dirty: number; revenue_month: number
  arrivals: { id: string; number: string; guest: string; room: string; nights: number; status: StayStatus; housekeeping: Housekeeping }[]
  departures: { id: string; number: string; guest: string; room: string; status: StayStatus }[]
}

export const HOUSEKEEPING: Record<Housekeeping, string> = { clean: msg('Clean'), dirty: msg('To clean'), inspect: msg('To inspect'), out_of_order: msg('Out of order') }
export const STAY_STATUS: Record<StayStatus, string> = {
  booked: msg('Booked'), checked_in: msg('In the hotel'), checked_out: msg('Checked out|stay'), cancelled: msg('Cancelled'), no_show: msg('Did not come'),
}
export const SOURCES: Record<Source, string> = {
  direct: msg('Direct'), phone: msg('Phone'), email: msg('Email'), walk_in: msg('Walked in'), booking: 'Booking.com', airbnb: 'Airbnb', agency: msg('Agency'), other: msg('Other'),
}

const key = (companyId: string | null | undefined, ...rest: unknown[]) => ['hotel', companyId, ...rest]

export function useRoomTypes() {
  const { companyId } = useCompany()
  return useQuery({
    queryKey: key(companyId, 'types'), enabled: !!companyId,
    queryFn: async () => unwrap(await supabase.from('hotel_room_types').select('id, name, capacity, rate, tax_code_id, sort').eq('company_id', companyId!).is('deleted_at', null).order('sort').order('name')) as unknown as RoomType[],
  })
}
export function useRooms() {
  const { companyId } = useCompany()
  return useQuery({
    queryKey: key(companyId, 'rooms'), enabled: !!companyId,
    queryFn: async () => unwrap(await supabase.from('hotel_rooms').select('id, number, room_type_id, floor, housekeeping, notes, is_active').eq('company_id', companyId!).is('deleted_at', null).order('number')) as unknown as Room[],
  })
}
export function useHotelCalendar(from: string, to: string) {
  const { companyId } = useCompany()
  return useQuery({
    queryKey: key(companyId, 'calendar', from, to), enabled: !!companyId,
    queryFn: async () => unwrap(await supabase.rpc('hotel_calendar', { p_company: companyId!, p_from: from, p_to: to })) as unknown as { rooms: CalendarRoom[]; stays: CalendarStay[] },
  })
}
export function useHotelToday() {
  const { companyId } = useCompany()
  return useQuery({
    queryKey: key(companyId, 'today'), enabled: !!companyId, refetchInterval: 60_000,
    queryFn: async () => unwrap(await supabase.rpc('hotel_today', { p_company: companyId! })) as unknown as Today,
  })
}
export function useReservation(id: string | null | undefined) {
  return useQuery({
    queryKey: ['hotel', 'reservation', id], enabled: !!id,
    queryFn: async () => {
      const r = unwrap(await supabase.from('hotel_reservations').select('*').eq('id', id!).single()) as unknown as Reservation
      const charges = unwrap(await supabase.from('hotel_charges').select('id, reservation_id, charge_date, description, variant_id, quantity, unit_price').eq('reservation_id', id!).order('charge_date').order('created_at')) as unknown as Charge[]
      return { ...r, charges }
    },
  })
}
export function useReservations(filter: { status?: string; search?: string }) {
  const { companyId } = useCompany()
  return useQuery({
    queryKey: key(companyId, 'reservations', filter), enabled: !!companyId,
    queryFn: async () => {
      let q = supabase.from('hotel_reservations').select('id, number, status, room_id, guest_name, guest_phone, adults, children, check_in, check_out, rate, source, invoice_id')
        .eq('company_id', companyId!).is('deleted_at', null).order('check_in', { ascending: false }).limit(300)
      if (filter.status && filter.status !== 'all') q = q.eq('status', filter.status)
      if (filter.search?.trim()) { const s = filter.search.trim().replace(/[%,()]/g, ' '); q = q.or(`guest_name.ilike.%${s}%,number.ilike.%${s}%,guest_phone.ilike.%${s}%`) }
      return unwrap(await q) as unknown as Reservation[]
    },
  })
}

/** every hotel query refreshes after a change */
export function useHotelAction<A>(fn: (a: A) => Promise<unknown>) {
  const qc = useQueryClient()
  return useMutation({ mutationFn: fn, onSuccess: () => qc.invalidateQueries({ queryKey: ['hotel'] }) })
}

export const nights = (a: string, b: string) => Math.max(Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000), 0)
export const addDays = (d: string, n: number) => { const x = new Date(`${d}T00:00:00Z`); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10) }
