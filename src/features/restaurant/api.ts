import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { useCompany } from '@/app/company-provider'
import { useRealtimeInvalidate } from '@/hooks/use-realtime'
import { describeError, unwrap } from '@/lib/errors'
import { supabase } from '@/lib/supabase'

export interface FloorTable { id: string; name: string; seats: number; x?: number | null; y?: number | null; shape?: string | null }
export interface FloorArea { id: string; name: string; tables: FloorTable[] }
export interface FloorOrder {
  id: string; number: string; table_id: string | null; label: string | null; guests: number; opened_at: string; waiter: string; waiter_id: string
  total: number; new: number; waiting: number; ready: number; last_sent_at: string | null
}
export interface Station { id: string; name: string; category_ids: string[]; is_default: boolean }
export interface Floor { areas: FloorArea[]; orders: FloorOrder[]; stations: Station[] }

export type LineStatus = 'new' | 'sent' | 'ready' | 'served' | 'void'
export interface TabLine { id: string; variant_id: string; name: string; quantity: number; unit_price: number; note: string | null; status: LineStatus; station_id: string | null; sent_at: string | null; paid: boolean }
export interface Tab { id: string; number: string; status: string; table_id: string | null; table: string | null; label: string | null; guests: number; opened_at: string; waiter: string; note: string | null; lines: TabLine[] }

export interface KitchenOrder {
  id: string; number: string; table: string | null; label: string | null; waiter: string; first_sent_at: string
  lines: { id: string; name: string; quantity: number; note: string | null; status: 'sent' | 'ready'; sent_at: string; station_id: string | null }[]
}

const key = (c: string) => ['restaurant', c] as const

export function useFloor(registerId: string | undefined) {
  const { companyId } = useCompany()
  useRealtimeInvalidate('table_orders', companyId, [key(companyId)])
  useRealtimeInvalidate('table_order_lines', companyId, [key(companyId)])
  return useQuery({
    queryKey: [...key(companyId), 'floor', registerId],
    enabled: !!companyId && !!registerId,
    refetchInterval: 20_000,
    queryFn: async () => unwrap(await supabase.rpc('restaurant_floor', { p_register: registerId! })) as unknown as Floor,
  })
}

export function useTab(tabId: string | null) {
  const { companyId } = useCompany()
  return useQuery({
    queryKey: [...key(companyId), 'tab', tabId],
    enabled: !!companyId && !!tabId,
    queryFn: async () => unwrap(await supabase.rpc('restaurant_tab', { p_tab: tabId! })) as unknown as Tab,
  })
}

export function useKitchen(warehouseId: string | undefined, stationId: string | null) {
  const { companyId } = useCompany()
  useRealtimeInvalidate('table_order_lines', companyId, [key(companyId)])
  return useQuery({
    queryKey: [...key(companyId), 'kitchen', warehouseId, stationId],
    enabled: !!companyId && !!warehouseId,
    refetchInterval: 15_000,
    queryFn: async () => unwrap(await supabase.rpc('restaurant_kitchen', { p_warehouse: warehouseId!, p_station: stationId ?? undefined })) as unknown as KitchenOrder[],
  })
}

export function useStations(warehouseId: string | undefined) {
  const { companyId } = useCompany()
  return useQuery({
    queryKey: [...key(companyId), 'stations', warehouseId],
    enabled: !!companyId && !!warehouseId,
    queryFn: async () => unwrap(await supabase.from('kitchen_stations').select('id, name, category_ids, is_default').eq('warehouse_id', warehouseId!).is('deleted_at', null).order('sort_order')) as Station[],
  })
}

function useAction<A, R>(fn: (a: A) => Promise<R>, quiet = false) {
  const qc = useQueryClient()
  const { companyId } = useCompany()
  return useMutation({
    mutationFn: fn,
    onSuccess: () => void qc.invalidateQueries({ queryKey: key(companyId) }),
    onError: quiet ? undefined : (e) => toast.error(describeError(e)),
  })
}

export const useOpenTab = () => useAction(async (a: { register: string; table: string | null; guests?: number; label?: string }) =>
  unwrap(await supabase.rpc('restaurant_open', { p_register: a.register, p_table: a.table as string, p_guests: a.guests ?? 1, p_label: a.label })) as unknown as string)
export const useAddItems = () => useAction(async (a: { tab: string; items: { variant_id: string; quantity: number; note?: string | null }[] }) =>
  unwrap(await supabase.rpc('restaurant_add', { p_tab: a.tab, p_items: a.items as never })))
export const useChangeLine = () => useAction(async (a: { line: string; quantity: number; note?: string | null }) =>
  unwrap(await supabase.rpc('restaurant_change_line', { p_line: a.line, p_quantity: a.quantity, p_note: a.note ?? undefined })))
export const useVoidLine = () => useAction(async (a: { line: string; reason: string }) =>
  unwrap(await supabase.rpc('restaurant_void', { p_line: a.line, p_reason: a.reason })))
export interface SentTickets { number: string; table: string | null; label: string | null; waiter: string; at: string; tickets: { station: string; lines: { name: string; quantity: number; note: string | null }[] }[] }
export const useSend = () => useAction(async (tab: string) => unwrap(await supabase.rpc('restaurant_send', { p_tab: tab })) as unknown as SentTickets)
export const useMoveTab = () => useAction(async (a: { tab: string; table: string }) => unwrap(await supabase.rpc('restaurant_move', { p_tab: a.tab, p_table: a.table })) as unknown as string)
export const useSetGuests = () => useAction(async (a: { tab: string; guests: number }) => unwrap(await supabase.rpc('restaurant_set_guests', { p_tab: a.tab, p_guests: a.guests })))
export const useCloseEmpty = () => useAction(async (tab: string) => unwrap(await supabase.rpc('restaurant_close_empty', { p_tab: tab })))
export const useSetLineStatus = () => useAction(async (a: { lines: string[]; status: 'sent' | 'ready' | 'served' }) =>
  unwrap(await supabase.rpc('restaurant_set_status', { p_lines: a.lines, p_status: a.status })))
export const usePayTab = () => useAction(async (p: {
  tab_id: string; session_id: string; client_uuid: string; device_ref?: string; split?: { line_id: string; quantity: number }[]
  payments: { method: string; amount: number }[]
  /** per line: the card's discount, or a discount given by hand (manual_pct) */
  discounts?: { line_id: string; variant_id: string; discount_pct: number; manual_pct: number }[]
  loyalty?: { card_id: string; redeem_points: number } | null
}) => unwrap(await supabase.rpc('restaurant_pay', { p: p as never })) as unknown as { id: string; number: string; total: number; change: number; closed: boolean }, true)

/* ------------------------------------------------------------------ room setup (managers) */
export function useSaveRoom() {
  const qc = useQueryClient()
  const { companyId } = useCompany()
  const done = () => void qc.invalidateQueries({ queryKey: key(companyId) })
  const run = async (q: PromiseLike<{ error: unknown }>) => { const { error } = await q; if (error) throw error }
  return {
    addArea: async (warehouse_id: string, name: string, sort_order: number) => { await run(supabase.from('restaurant_areas').insert({ company_id: companyId, warehouse_id, name, sort_order })); done() },
    renameArea: async (id: string, name: string) => { await run(supabase.from('restaurant_areas').update({ name }).eq('id', id)); done() },
    removeArea: async (id: string) => { await run(supabase.from('restaurant_areas').delete().eq('id', id)); done() },
    addTables: async (area_id: string, names: string[], seats: number, start: number) => {
      await run(supabase.from('restaurant_tables').insert(names.map((name, i) => ({ company_id: companyId, area_id, name, seats, sort_order: start + i })))); done()
    },
    updateTable: async (id: string, v: { name?: string; seats?: number; is_active?: boolean; pos_x?: number | null; pos_y?: number | null; shape?: 'square' | 'round' | 'long' }) => { await run(supabase.from('restaurant_tables').update(v).eq('id', id)); done() },
    removeTable: async (id: string) => { await run(supabase.from('restaurant_tables').delete().eq('id', id)); done() },
    saveStation: async (v: { id?: string; warehouse_id: string; name: string; category_ids: string[]; is_default: boolean }) => {
      if (v.id) await run(supabase.from('kitchen_stations').update({ name: v.name, category_ids: v.category_ids, is_default: v.is_default }).eq('id', v.id))
      else await run(supabase.from('kitchen_stations').insert({ company_id: companyId, warehouse_id: v.warehouse_id, name: v.name, category_ids: v.category_ids, is_default: v.is_default }))
      done()
    },
    removeStation: async (id: string) => { await run(supabase.from('kitchen_stations').delete().eq('id', id)); done() },
  }
}
