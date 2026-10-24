import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import * as React from 'react'
import { toast } from 'sonner'
import { useCompany } from '@/app/company-provider'
import type { Json, Tables } from '@/lib/database.types'
import { describeError, unwrap } from '@/lib/errors'
import { supabase } from '@/lib/supabase'

export const logKeys = { all: (c: string) => ['log', c] as const }
function useInvalidate() {
  const qc = useQueryClient()
  const { companyId } = useCompany()
  return React.useCallback(() => Promise.all([
    qc.invalidateQueries({ queryKey: logKeys.all(companyId) }),
    qc.invalidateQueries({ queryKey: ['inv', companyId] }),
    qc.invalidateQueries({ queryKey: ['sales', companyId] }),
    qc.invalidateQueries({ queryKey: ['fin', companyId] }),
  ]), [qc, companyId])
}
function useAction<A, R>(fn: (a: A) => Promise<R>, opts: { silent?: boolean } = {}) {
  const invalidate = useInvalidate()
  return useMutation({ mutationFn: fn, onSuccess: () => void invalidate(), onError: (e) => { if (!opts.silent) toast.error(describeError(e)) } })
}

/* ------------------------------------------------------------------ overview */
export interface LogisticsOverview {
  to_dispatch: number; in_transit: number; routes_today: number; delivered: number; failed: number
  on_time_pct: number | null; first_attempt_pct: number | null; cod_to_settle: number; cod_outstanding: number
  by_carrier: { carrier: string; shipments: number; delivered: number; failed: number; avg_days: number | null }[]
  by_day: { day: string; delivered: number; failed: number }[]
}
export function useLogisticsOverview(from: string, to: string) {
  const { companyId } = useCompany()
  return useQuery({
    queryKey: [...logKeys.all(companyId), 'overview', from, to],
    enabled: !!companyId,
    queryFn: async () => unwrap(await supabase.rpc('logistics_overview', { p_company: companyId, p_from: from, p_to: to })) as unknown as LogisticsOverview,
  })
}

/* ------------------------------------------------------------------ setup */
export type Carrier = Tables<'carriers'>
export type Vehicle = Tables<'vehicles'> & { driver: { id: string; full_name: string } | null }
export function useCarriers() {
  const { companyId } = useCompany()
  return useQuery({
    queryKey: [...logKeys.all(companyId), 'carriers'],
    enabled: !!companyId,
    queryFn: async () => unwrap(await supabase.from('carriers').select('*').eq('company_id', companyId).is('deleted_at', null).order('name')),
  })
}
export function useVehicles() {
  const { companyId } = useCompany()
  return useQuery({
    queryKey: [...logKeys.all(companyId), 'vehicles'],
    enabled: !!companyId,
    queryFn: async () => unwrap(await supabase.from('vehicles').select('*, driver:employees(id, full_name)').eq('company_id', companyId).is('deleted_at', null)
      .order('name').returns<Vehicle[]>()),
  })
}
export function useDrivers() {
  const { companyId } = useCompany()
  return useQuery({
    queryKey: [...logKeys.all(companyId), 'drivers'],
    enabled: !!companyId,
    staleTime: 60_000,
    queryFn: async () => unwrap(await supabase.from('employees').select('id, full_name, number').eq('company_id', companyId).is('deleted_at', null)
      .neq('employment_status', 'terminated').order('full_name')),
  })
}
const saver = (table: 'carriers' | 'vehicles') => () => {
  const { companyId } = useCompany()
  return useAction(async ({ id, ...v }: Record<string, unknown> & { id?: string }) => id
    ? unwrap(await supabase.from(table).update(v as never).eq('id', id))
    : unwrap(await supabase.from(table).insert({ ...v, company_id: companyId } as never)), { silent: true })
}
export const useSaveCarrier = saver('carriers')
export const useSaveVehicle = saver('vehicles')

/* ------------------------------------------------------------------ dispatch queue and routes */
export type QueueRow = { kind: string | null; id: string | null; number: string | null; delivery_id: string | null; delivery_number: string | null; partner: string | null
  city: string | null; address: string | null; scheduled_date: string | null; status: string | null; weight_kg: number | null; packages: number | null; cod_amount: number | null }
export function useDispatchQueue(warehouse?: string | null) {
  const { companyId } = useCompany()
  return useQuery({
    queryKey: [...logKeys.all(companyId), 'queue', warehouse ?? null],
    enabled: !!companyId,
    queryFn: async () => unwrap(await supabase.rpc('dispatch_queue', { p_company: companyId, ...(warehouse ? { p_warehouse: warehouse } : {}) })) as QueueRow[],
  })
}

export type ShipmentLite = Pick<Tables<'shipments'>, 'id' | 'number' | 'status' | 'weight_kg' | 'packages' | 'cod_amount' | 'cod_collected' | 'city' | 'address_text' | 'tracking_number'>
  & { partner: { name: string } | null }
export type StopRow = Tables<'route_stops'> & { shipment: ShipmentLite | null }
export type RouteRow = Tables<'delivery_routes'> & {
  vehicle: { id: string; name: string; plate_number: string; capacity_kg: number | null } | null
  driver: { id: string; full_name: string } | null
  warehouse: { code: string; name: string } | null
  stops: StopRow[]
}
const ROUTE_SELECT = '*, vehicle:vehicles(id, name, plate_number, capacity_kg), driver:employees(id, full_name), warehouse:warehouses(code, name), '
  + 'stops:route_stops(*, shipment:shipments(id, number, status, weight_kg, packages, cod_amount, cod_collected, city, address_text, tracking_number, partner:business_partners(name)))'
export function useRoutes(from: string, to: string = from) {
  const { companyId } = useCompany()
  return useQuery({
    queryKey: [...logKeys.all(companyId), 'routes', from, to],
    enabled: !!companyId,
    queryFn: async () => unwrap(await supabase.from('delivery_routes').select(ROUTE_SELECT).eq('company_id', companyId).is('deleted_at', null)
      .gte('route_date', from).lte('route_date', to).neq('status', 'cancelled').order('route_date').order('number').returns<RouteRow[]>())
      .map((r) => ({ ...r, stops: [...r.stops].sort((a, b) => a.sequence - b.sequence) })),
  })
}
export function useRoute(id: string | undefined) {
  const { companyId } = useCompany()
  return useQuery({
    queryKey: [...logKeys.all(companyId), 'route', id],
    enabled: !!companyId && !!id,
    queryFn: async () => {
      const r = unwrap(await supabase.from('delivery_routes').select(ROUTE_SELECT).eq('id', id!).single().returns<RouteRow>())
      return { ...r, stops: [...r.stops].sort((a, b) => a.sequence - b.sequence) }
    },
  })
}

export const useCreateShipment = () => useAction(async (a: { delivery: string; cod?: number | null; carrier?: string | null }) =>
  unwrap(await supabase.rpc('create_shipment', { p_delivery: a.delivery, p: { ...(a.cod ? { cod_amount: a.cod } : {}), ...(a.carrier ? { carrier_id: a.carrier } : {}) } as Json })) as string)
export const useCreateRoute = () => {
  const { companyId } = useCompany()
  return useAction(async (a: { date: string; warehouse: string; vehicle?: string | null; driver?: string | null; shipments: string[] }) =>
    unwrap(await supabase.rpc('create_route', { p_company: companyId, p_date: a.date, p_warehouse: a.warehouse, ...(a.vehicle ? { p_vehicle: a.vehicle } : {}),
      ...(a.driver ? { p_driver: a.driver } : {}), p_shipments: a.shipments })) as string, { silent: true })
}
export const useAssignToRoute = () => useAction(async (a: { route: string; shipments: string[] }) =>
  unwrap(await supabase.rpc('assign_to_route', { p_route: a.route, p_shipments: a.shipments })) as number, { silent: true })
export const useRemoveFromRoute = () => useAction(async (shipment: string) => unwrap(await supabase.rpc('remove_from_route', { p_shipment: shipment })))
/** Reorders stops; the new order shows at once and is rolled back if the server refuses it. */
export function useReorderRoute() {
  const qc = useQueryClient()
  const { companyId } = useCompany()
  const invalidate = useInvalidate()
  return useMutation({
    mutationFn: async (a: { route: string; stops: string[] }) => unwrap(await supabase.rpc('reorder_route', { p_route: a.route, p_stop_ids: a.stops })),
    onMutate: async (a) => {
      const key = [...logKeys.all(companyId), 'route', a.route]
      await qc.cancelQueries({ queryKey: key })
      const prev = qc.getQueryData<RouteRow>(key)
      if (prev) {
        const byId = new Map(prev.stops.map((st) => [st.id, st]))
        const stops = a.stops.map((id, i) => ({ ...byId.get(id)!, sequence: i + 1 })).filter((st) => st.id)
        qc.setQueryData<RouteRow>(key, { ...prev, stops })
      }
      return { key, prev }
    },
    onError: (e, _a, ctx) => { if (ctx?.prev) qc.setQueryData(ctx.key, ctx.prev); toast.error(describeError(e)) },
    onSettled: () => void invalidate(),
  })
}
export const useStartRoute = () => useAction(async (route: string) => unwrap(await supabase.rpc('start_route', { p_route: route })) as number)
/** Records a stop outcome; the stop shows its new state at once (the driver keeps moving), rolled back if the server refuses. */
export function useRecordStop() {
  const qc = useQueryClient()
  const { companyId } = useCompany()
  const invalidate = useInvalidate()
  return useMutation({
    mutationFn: async (a: { stop: string; outcome: 'delivered' | 'failed' | 'skipped'; note?: string; cod?: boolean }) =>
      unwrap(await supabase.rpc('record_stop', { p_stop: a.stop, p_outcome: a.outcome, ...(a.note ? { p_note: a.note } : {}), ...(a.cod !== undefined ? { p_cod_collected: a.cod } : {}) })) as string,
    onMutate: async (a) => {
      const prefix = [...logKeys.all(companyId), 'route']
      await qc.cancelQueries({ queryKey: prefix })
      const snapshots = qc.getQueriesData<RouteRow>({ queryKey: prefix })
      const shipStatus = a.outcome === 'delivered' ? 'delivered' : 'failed'
      for (const [key, r] of snapshots) {
        if (!r?.stops?.some((st) => st.id === a.stop)) continue
        qc.setQueryData<RouteRow>(key, { ...r, stops: r.stops.map((st) => st.id === a.stop
          ? { ...st, status: a.outcome, outcome_note: a.note ?? st.outcome_note, shipment: st.shipment ? { ...st.shipment, status: shipStatus, cod_collected: a.cod ?? st.shipment.cod_collected } : null }
          : st) })
      }
      return { snapshots }
    },
    onError: (_e, _a, ctx) => { ctx?.snapshots.forEach(([key, data]) => qc.setQueryData(key, data)) },
    onSettled: () => void invalidate(),
  })
}
export const useCompleteRoute = () => useAction(async (a: { route: string; km?: number | null }) =>
  unwrap(await supabase.rpc('complete_route', { p_route: a.route, ...(a.km ? { p_km: a.km } : {}) })) as string)
export const useUpdateRoute = () => useAction(async ({ id, ...v }: { id: string } & Record<string, unknown>) =>
  unwrap(await supabase.from('delivery_routes').update(v as never).eq('id', id)))

/* ------------------------------------------------------------------ shipments */
export type ShipmentRow = Tables<'shipments'> & {
  partner: { name: string } | null
  carrier: { name: string; carrier_type: string; tracking_url_template: string | null } | null
  delivery: { id: string; number: string; sales_order_id: string | null } | null
  route: { id: string; number: string; route_date: string } | null
}
const SHIP_SELECT = '*, partner:business_partners(name), carrier:carriers(name, carrier_type, tracking_url_template), delivery:deliveries(id, number, sales_order_id), route:delivery_routes(id, number, route_date)'
export function useShipments() {
  const { companyId } = useCompany()
  return useQuery({
    queryKey: [...logKeys.all(companyId), 'shipments'],
    enabled: !!companyId,
    queryFn: async () => unwrap(await supabase.from('shipments').select(SHIP_SELECT).eq('company_id', companyId).is('deleted_at', null)
      .order('created_at', { ascending: false }).limit(1000).returns<ShipmentRow[]>()),
  })
}
export type ShipmentDetail = ShipmentRow & { events: Tables<'shipment_events'>[]; order: { id: string; number: string } | null; payment: { id: string; number: string } | null }
export function useShipment(id: string | undefined) {
  const { companyId } = useCompany()
  return useQuery({
    queryKey: [...logKeys.all(companyId), 'shipment', id],
    enabled: !!companyId && !!id,
    queryFn: async () => {
      const s = unwrap(await supabase.from('shipments').select(SHIP_SELECT + ', events:shipment_events(*)').eq('id', id!).single()
        .returns<ShipmentRow & { events: Tables<'shipment_events'>[] }>())
      const [order, payment] = await Promise.all([
        s.delivery?.sales_order_id ? supabase.from('sales_orders').select('id, number').eq('id', s.delivery.sales_order_id).maybeSingle() : Promise.resolve({ data: null }),
        s.cod_payment_id ? supabase.from('payments').select('id, number').eq('id', s.cod_payment_id).maybeSingle() : Promise.resolve({ data: null }),
      ])
      return { ...s, events: [...s.events].sort((a, b) => a.event_at.localeCompare(b.event_at)), order: order.data ?? null, payment: payment.data ?? null } as ShipmentDetail
    },
  })
}
export const useShipWithCarrier = () => useAction(async (a: { shipment: string; carrier: string; tracking: string }) =>
  unwrap(await supabase.rpc('ship_with_carrier', { p_shipment: a.shipment, p_carrier: a.carrier, p_tracking: a.tracking })) as string, { silent: true })
export const useUpdateShipment = () => useAction(async (a: { shipment: string; status: string; note?: string; location?: string; cod?: boolean }) =>
  unwrap(await supabase.rpc('update_shipment', { p_shipment: a.shipment, p_status: a.status, ...(a.note ? { p_note: a.note } : {}),
    ...(a.location ? { p_location: a.location } : {}), ...(a.cod !== undefined ? { p_cod_collected: a.cod } : {}) })) as string, { silent: true })
export const useSettleCod = () => useAction(async (a: { shipments: string[]; bank: string }) =>
  unwrap(await supabase.rpc('settle_cod', { p_shipments: a.shipments, p_bank_account: a.bank })) as unknown as { shipment: string; unallocated: number }[], { silent: true })

export const trackingUrl = (template: string | null | undefined, tracking: string | null | undefined) =>
  template && tracking ? template.replace('{tracking}', encodeURIComponent(tracking)) : null
