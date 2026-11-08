import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { useCompany } from '@/app/company-provider'
import { msg } from '@/i18n'
import { describeError, unwrap } from '@/lib/errors'
import { supabase } from '@/lib/supabase'
import { todayISO } from '@/lib/utils'

export type ApptStatus = 'booked' | 'confirmed' | 'arrived' | 'done' | 'no_show' | 'cancelled'
export type Resource = { id: string; name: string; kind: string; color: string; hours: Record<string, [string, string][]> }
export type Service = { id: string; name: string; duration_min: number; price: number; color: string | null; resource_ids: string[] }
export type Appt = {
  id: string; number: string | null; status: ApptStatus; starts_at: string; ends_at: string; resource_id: string; service_id: string | null; service: string | null
  color: string; partner_id: string | null; client_name: string; client_phone: string | null; client_email: string | null; card_id: string | null; card: string | null
  card_kind: CardKind | null; price: number; notes: string | null; source: string; invoice_id: string | null; reminded_at: string | null
  /** paid at the till: the sale's reference */
  pos_client_uuid?: string | null
}
export type Board = { timezone: string; resources: Resource[]; services: Service[]; appointments: Appt[] }

export const APPT_STATUS: Record<ApptStatus, string> = {
  booked: msg('Booked'), confirmed: msg('Confirmed'), arrived: msg('Arrived'), done: msg('Done'), no_show: msg('Did not come'), cancelled: msg('Cancelled'),
}
export const APPT_SOURCES: Record<string, string> = { phone: msg('Phone'), walk_in: msg('Walked in'), online: msg('Online'), whatsapp: 'WhatsApp', social: msg('Social media'), other: msg('Other') }
export const RESOURCE_KINDS: Record<string, string> = { person: msg('Person'), chair: msg('Chair'), room: msg('Room'), bay: msg('Lift or bay'), device: msg('Device') }

/* ---------------------------------------------------------------- cards */
export type CardKind = 'vehicle' | 'patient' | 'pet' | 'client' | 'device'
export type Field = { key: string; label: string; type?: 'text' | 'date' | 'number' | 'textarea'; wide?: boolean }
export const CARD_KINDS: Record<CardKind, { label: string; plural: string; title: string; fields: Field[]; entry: Field[] }> = {
  vehicle: {
    label: msg('Vehicle'), plural: msg('Vehicles'), title: msg('Plate'),
    fields: [{ key: 'make', label: msg('Make') }, { key: 'model', label: msg('Model') }, { key: 'year', label: msg('Year'), type: 'number' }, { key: 'vin', label: msg('VIN (chassis)') },
      { key: 'fuel', label: msg('Fuel') }, { key: 'engine', label: msg('Engine') }, { key: 'color', label: msg('Colour') }, { key: 'km', label: msg('Kilometres'), type: 'number' }],
    entry: [{ key: 'km', label: msg('Kilometres'), type: 'number' }, { key: 'next_service', label: msg('Next service'), type: 'date' }],
  },
  patient: {
    label: msg('Patient'), plural: msg('Patients'), title: msg('Name and surname'),
    fields: [{ key: 'birth_date', label: msg('Date of birth'), type: 'date' }, { key: 'gender', label: msg('Gender') }, { key: 'phone', label: msg('Phone') },
      { key: 'personal_no', label: msg('Personal number') }, { key: 'blood_type', label: msg('Blood type') },
      { key: 'allergies', label: msg('Allergies'), type: 'textarea', wide: true }, { key: 'conditions', label: msg('Chronic conditions'), type: 'textarea', wide: true },
      { key: 'medications', label: msg('Medications'), type: 'textarea', wide: true }],
    entry: [{ key: 'diagnosis', label: msg('Diagnosis'), wide: true }, { key: 'treatment', label: msg('Treatment'), type: 'textarea', wide: true }, { key: 'next_visit', label: msg('Next visit'), type: 'date' }],
  },
  pet: {
    label: msg('Pet'), plural: msg('Pets'), title: msg('Name'),
    fields: [{ key: 'species', label: msg('Species') }, { key: 'breed', label: msg('Breed') }, { key: 'birth_date', label: msg('Date of birth'), type: 'date' }, { key: 'sex', label: msg('Sex') },
      { key: 'chip', label: msg('Microchip') }, { key: 'weight', label: msg('Weight (kg)'), type: 'number' }, { key: 'allergies', label: msg('Allergies'), type: 'textarea', wide: true }],
    entry: [{ key: 'weight', label: msg('Weight (kg)'), type: 'number' }, { key: 'vaccine', label: msg('Vaccine') }, { key: 'next_visit', label: msg('Next visit'), type: 'date' }],
  },
  client: {
    label: msg('Client card'), plural: msg('Client cards'), title: msg('Name and surname'),
    fields: [{ key: 'phone', label: msg('Phone') }, { key: 'birth_date', label: msg('Date of birth'), type: 'date' },
      { key: 'preferences', label: msg('Preferences'), type: 'textarea', wide: true }, { key: 'allergies', label: msg('Allergies'), type: 'textarea', wide: true }],
    entry: [{ key: 'used', label: msg('Products and formula used'), type: 'textarea', wide: true }],
  },
  device: {
    label: msg('Device'), plural: msg('Devices'), title: msg('Device'),
    fields: [{ key: 'brand', label: msg('Brand') }, { key: 'model', label: msg('Model') }, { key: 'serial', label: msg('Serial number') }, { key: 'warranty_until', label: msg('Warranty until'), type: 'date' }],
    entry: [{ key: 'fault', label: msg('Fault'), wide: true }],
  },
}
export function defaultCardKind(businessType: string | undefined): CardKind {
  return businessType === 'auto_service' ? 'vehicle' : businessType === 'clinic' ? 'patient' : 'client'
}
export type Card = { id: string; kind: CardKind; partner_id: string | null; title: string; attrs: Record<string, string>; notes: string | null; is_active: boolean; created_at: string
  partner?: { name: string; phone: string | null } | null }
export type Entry = { id: string; card_id: string; entry_date: string; title: string; body: string | null; attrs: Record<string, string>; appointment_id: string | null; invoice_id: string | null; created_at: string }

/* ---------------------------------------------------------------- memberships */
export type Plan = { id: string; name: string; months: number; days: number; visits: number | null; price: number; tax_code_id: string | null; sort: number; is_active: boolean }
export type Membership = { id: string; number: string | null; status: 'active' | 'frozen' | 'expired' | 'cancelled'; partner_id: string; plan_id: string; code: string; starts_on: string; ends_on: string
  visits: number | null; visits_used: number; price: number; invoice_id: string | null; renewed_by: string | null; notes: string | null
  partner?: { name: string; phone: string | null } | null; plan?: { name: string } | null }
export const MEMBERSHIP_STATUS: Record<Membership['status'], string> = { active: msg('Active'), frozen: msg('Frozen'), expired: msg('Expired'), cancelled: msg('Cancelled') }

/* ---------------------------------------------------------------- queries */
const key = (companyId: string | null | undefined, ...rest: unknown[]) => ['appointments', companyId, ...rest]

export function useBoard(from: string, to: string) {
  const { companyId } = useCompany()
  return useQuery({ queryKey: key(companyId, 'board', from, to), enabled: !!companyId, refetchInterval: 60_000,
    queryFn: async () => unwrap(await supabase.rpc('appt_board', { p_company: companyId!, p_from: from, p_to: to })) as unknown as Board })
}
export function useResources() {
  const { companyId } = useCompany()
  return useQuery({ queryKey: key(companyId, 'resources'), enabled: !!companyId,
    queryFn: async () => unwrap(await supabase.from('appt_resources').select('id, name, kind, color, hours, sort, is_active, user_id').eq('company_id', companyId!).is('deleted_at', null).order('sort').order('name')) as unknown as (Resource & { sort: number; is_active: boolean; user_id: string | null })[] })
}
export function useServices() {
  const { companyId } = useCompany()
  return useQuery({ queryKey: key(companyId, 'services'), enabled: !!companyId,
    queryFn: async () => unwrap(await supabase.from('appt_services').select('id, name, duration_min, price, color, resource_ids, tax_code_id, sort, is_active').eq('company_id', companyId!).is('deleted_at', null).order('sort').order('name')) as unknown as (Service & { tax_code_id: string | null; sort: number; is_active: boolean })[] })
}
export function useCards(kind: CardKind | 'all', search: string) {
  const { companyId } = useCompany()
  return useQuery({ queryKey: key(companyId, 'cards', kind, search), enabled: !!companyId,
    queryFn: async () => {
      let q = supabase.from('client_cards').select('id, kind, partner_id, title, attrs, notes, is_active, created_at, partner:business_partners(name, phone)')
        .eq('company_id', companyId!).is('deleted_at', null).order('title').limit(300)
      if (kind !== 'all') q = q.eq('kind', kind)
      if (search.trim()) { const s = search.trim().replace(/[%,()]/g, ' '); q = q.or(`title.ilike.%${s}%,attrs->>vin.ilike.%${s}%,attrs->>phone.ilike.%${s}%`) }
      return unwrap(await q) as unknown as Card[]
    } })
}
export function useCard(id: string | undefined) {
  return useQuery({ queryKey: ['appointments', 'card', id], enabled: !!id,
    queryFn: async () => {
      const card = unwrap(await supabase.from('client_cards').select('id, kind, partner_id, title, attrs, notes, is_active, created_at, partner:business_partners(name, phone)').eq('id', id!).single()) as unknown as Card
      const entries = unwrap(await supabase.from('card_entries').select('id, card_id, entry_date, title, body, attrs, appointment_id, invoice_id, created_at').eq('card_id', id!).order('entry_date', { ascending: false }).order('created_at', { ascending: false })) as unknown as Entry[]
      const appts = unwrap(await supabase.from('appointments').select('id, number, status, starts_at, invoice_id, service:appt_services(name)').eq('card_id', id!).is('deleted_at', null).order('starts_at', { ascending: false }).limit(50)) as unknown as { id: string; number: string; status: ApptStatus; starts_at: string; invoice_id: string | null; service: { name: string } | null }[]
      return { card, entries, appts }
    } })
}
export function usePlans() {
  const { companyId } = useCompany()
  return useQuery({ queryKey: key(companyId, 'plans'), enabled: !!companyId,
    queryFn: async () => unwrap(await supabase.from('membership_plans').select('id, name, months, days, visits, price, tax_code_id, sort, is_active').eq('company_id', companyId!).is('deleted_at', null).order('sort').order('price')) as unknown as Plan[] })
}
export function useMemberships(filter: string, search: string) {
  const { companyId } = useCompany()
  return useQuery({ queryKey: key(companyId, 'memberships', filter, search), enabled: !!companyId,
    queryFn: async () => {
      let q = supabase.from('memberships').select('id, number, status, partner_id, plan_id, code, starts_on, ends_on, visits, visits_used, price, invoice_id, renewed_by, notes, partner:business_partners(name, phone), plan:membership_plans(name)')
        .eq('company_id', companyId!).is('deleted_at', null).order('ends_on', { ascending: filter === 'ending' }).limit(500)
      const today = todayISO()
      if (filter === 'active') q = q.eq('status', 'active')
      if (filter === 'ending') { const d = new Date(); d.setDate(d.getDate() + 7); q = q.eq('status', 'active').gte('ends_on', today).lte('ends_on', d.toISOString().slice(0, 10)).is('renewed_by', null) }
      if (filter === 'expired') q = q.eq('status', 'expired').is('renewed_by', null)
      if (filter === 'frozen') q = q.eq('status', 'frozen')
      if (search.trim()) { const s = search.trim().replace(/[%,()]/g, ' '); q = q.or(`code.ilike.%${s}%,number.ilike.%${s}%`) }
      return unwrap(await q) as unknown as Membership[]
    } })
}

/** every query of this part refreshes after a change */
export function useApptAction<A, R = unknown>(fn: (a: A) => Promise<R>) {
  const qc = useQueryClient()
  return useMutation({ mutationFn: fn, onSuccess: () => qc.invalidateQueries({ queryKey: ['appointments'] }), onError: (e) => toast.error(describeError(e)) })
}
