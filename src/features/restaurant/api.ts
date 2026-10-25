import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { useCompany } from '@/app/company-provider'
import { useAuth } from '@/app/auth-provider'
import { useRealtimeInvalidate } from '@/hooks/use-realtime'
import { t } from '@/i18n'
import { enqueue, hasPending, newId } from '@/lib/offline/outbox'
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

const primedAt = new Map<string, number>()
export function useFloor(registerId: string | undefined) {
  const { companyId } = useCompany()
  const qc = useQueryClient()
  useRealtimeInvalidate('table_orders', companyId, [key(companyId)])
  useRealtimeInvalidate('table_order_lines', companyId, [key(companyId)])
  const floorKey = [...key(companyId), 'floor', registerId] as const
  return useQuery({
    queryKey: floorKey,
    enabled: !!companyId && !!registerId,
    refetchInterval: 20_000,
    queryFn: async () => {
      const fresh = unwrap(await supabase.rpc('restaurant_floor', { p_register: registerId! })) as unknown as Floor
      // orders with steps still waiting on this device keep what the screen shows
      const prev = qc.getQueryData<Floor>(floorKey)
      const mine = (prev?.orders ?? []).filter((o) => hasPending(`tab:${o.id}`))
      const floor = mine.length ? { ...fresh, orders: [...fresh.orders.filter((o) => !mine.some((m) => m.id === o.id)), ...mine] } : fresh
      // every minute, all open orders with their items, so the device has them if the connection drops
      if (Date.now() - (primedAt.get(registerId!) ?? 0) > 60_000) {
        primedAt.set(registerId!, Date.now())
        void supabase.rpc('restaurant_open_tabs', { p_register: registerId! }).then(({ data }) => {
          for (const tab of (data ?? []) as unknown as Tab[]) if (!hasPending(`tab:${tab.id}`)) qc.setQueryData([...key(companyId), 'tab', tab.id], tab)
        })
      }
      return floor
    },
  })
}

export function useTab(tabId: string | null) {
  const { companyId } = useCompany()
  const qc = useQueryClient()
  const tabKey = [...key(companyId), 'tab', tabId] as const
  return useQuery({
    queryKey: tabKey,
    enabled: !!companyId && !!tabId,
    queryFn: async () => {
      const mine = qc.getQueryData<Tab>(tabKey)
      if (mine && hasPending(`tab:${tabId}`)) return mine
      return unwrap(await supabase.rpc('restaurant_tab', { p_tab: tabId! })) as unknown as Tab
    },
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

/* ------------------------------------------------------------------ steps on an order, also without internet
 * Online, each step goes straight to the server. Without internet (or while earlier steps of the same
 * order are still waiting on this device) the step is applied to what the screen shows and kept in the
 * outbox; it is sent, in order, when the connection is back. The ids of new orders and items are made
 * here, so a step that arrives twice is applied once.
 */
const isNetError = (e: unknown) => !navigator.onLine || /failed to fetch|networkerror|load failed|network request failed|fetch failed/i.test(String((e as { message?: string })?.message ?? e))
const chainOf = (tab: string) => `tab:${tab}`
const lineTotal = (l: { quantity: number; unit_price: number }) => Math.round(Number(l.quantity) * Number(l.unit_price) * 100) / 100

function useLocal() {
  const qc = useQueryClient()
  const { companyId } = useCompany()
  const { user } = useAuth()
  const c = companyId ?? ''
  const tabKey = (id: string) => [...key(c), 'tab', id] as const
  const getTab = (id: string) => qc.getQueryData<Tab>(tabKey(id))
  const floors = () => qc.getQueriesData<Floor>({ queryKey: [...key(c), 'floor'] })
  /** the order as the floor shows it, worked out again from its items */
  const toFloor = (tab: Tab) => qc.setQueriesData<Floor>({ queryKey: [...key(c), 'floor'] }, (f) => {
    if (!f) return f
    const rest = f.orders.filter((o) => o.id !== tab.id)
    if (tab.status !== 'open') return { ...f, orders: rest }
    const live = tab.lines.filter((l) => l.status !== 'void' && !l.paid)
    const prev = f.orders.find((o) => o.id === tab.id)
    const order: FloorOrder = {
      id: tab.id, number: tab.number, table_id: tab.table_id, label: tab.label, guests: tab.guests, opened_at: tab.opened_at,
      waiter: prev?.waiter ?? tab.waiter, waiter_id: prev?.waiter_id ?? user?.id ?? '',
      total: live.reduce((s, l) => s + lineTotal(l), 0), new: tab.lines.filter((l) => l.status === 'new').length,
      waiting: tab.lines.filter((l) => l.status === 'sent').length, ready: tab.lines.filter((l) => l.status === 'ready').length,
      last_sent_at: tab.lines.reduce<string | null>((m, l) => (l.sent_at && (!m || l.sent_at > m) ? l.sent_at : m), null),
    }
    return { ...f, orders: [...rest, order] }
  })
  const setTab = (tab: Tab) => { qc.setQueryData(tabKey(tab.id), tab); toFloor(tab) }
  const editTab = (id: string, fn: (t: Tab) => Tab) => { const tb = getTab(id); if (!tb) return undefined; const n = fn(tb); setTab(n); return n }
  const tabOfLine = (line: string) => qc.getQueriesData<Tab>({ queryKey: [...key(c), 'tab'] }).map(([, d]) => d).find((d) => d?.lines.some((l) => l.id === line))
  const tableName = (table: string | null) => (table ? floors().flatMap(([, f]) => f?.areas ?? []).flatMap((a) => a.tables).find((tb) => tb.id === table)?.name ?? null : null)
  const openOn = (table: string | null) => (table ? floors().flatMap(([, f]) => f?.orders ?? []).find((o) => o.table_id === table) : undefined)
  const waiterName = (user?.user_metadata?.full_name as string | undefined) ?? user?.email ?? ''
  return { qc, c, getTab, setTab, editTab, tabOfLine, tableName, openOn, waiterName, refresh: () => void qc.invalidateQueries({ queryKey: key(c) }) }
}

/** One step: straight to the server when possible, otherwise applied here and kept for later. */
function useStep<A, R>(build: (a: A, l: ReturnType<typeof useLocal>) => {
  chain: string; fn: string; args: Record<string, unknown>; label: string
  /** apply the step to the screen (offline) and give what the server would have answered */
  local: () => R
  /** turn the server's answer into the result */
  online?: (data: unknown) => R
}, quiet = false) {
  const l = useLocal()
  return useMutation({
    mutationFn: async (a: A): Promise<R> => {
      const s = build(a, l)
      if (navigator.onLine && !hasPending(s.chain)) {
        const { data, error } = await supabase.rpc(s.fn as never, s.args as never)
        if (!error) { l.refresh(); return s.online ? s.online(data) : (data as R) }
        if (!isNetError(error)) throw error
      }
      await enqueue({ company_id: l.c, fn: s.fn, args: s.args, label: s.label, chain: s.chain, invalidate: [[...key(l.c)]] })
      return s.local()
    },
    onError: quiet ? undefined : (e) => toast.error(describeError(e)),
  })
}

const titleOf = (tb: Tab | undefined, fallback = '') => (tb ? (tb.table ? t('Table {name}', { name: tb.table }) : tb.label || tb.number) : fallback)

export const useOpenTab = () => useStep((a: { register: string; table: string | null; guests?: number; label?: string }, l) => {
  // a table already open on this device's floor: that order
  const existing = !navigator.onLine ? l.openOn(a.table) : undefined
  const id = existing?.id ?? newId()
  return {
    chain: chainOf(id), fn: 'restaurant_open', args: { p_register: a.register, p_table: a.table, p_guests: a.guests ?? 1, p_label: a.label ?? null, p_id: id },
    label: a.table ? t('Table {name}: opened', { name: l.tableName(a.table) ?? '' }) : t('Takeaway {name}: opened', { name: a.label ?? '' }),
    local: () => {
      if (!existing) l.setTab({ id, number: t('new|order'), status: 'open', table_id: a.table, table: l.tableName(a.table), label: a.label ?? null, guests: a.guests ?? 1,
                                opened_at: new Date().toISOString(), waiter: l.waiterName, note: null, lines: [] })
      return id
    },
  }
})

export const useAddItems = () => useStep((a: { tab: string; items: { variant_id: string; quantity: number; note?: string | null; name?: string; price?: number }[] }, l) => {
  const items = a.items.map((x) => ({ ...x, id: newId() }))
  return {
    chain: chainOf(a.tab), fn: 'restaurant_add', args: { p_tab: a.tab, p_items: items.map((x) => ({ id: x.id, variant_id: x.variant_id, quantity: x.quantity, note: x.note ?? null })) },
    label: t('{order}: {n} items added', { order: titleOf(l.getTab(a.tab)), n: items.length }),
    local: () => { l.editTab(a.tab, (tb) => ({ ...tb, lines: [...tb.lines, ...items.map((x): TabLine => ({ id: x.id, variant_id: x.variant_id, name: x.name ?? '', quantity: x.quantity,
      unit_price: x.price ?? 0, note: x.note ?? null, status: 'new', station_id: null, sent_at: null, paid: false }))] })) },
  }
})

export const useChangeLine = () => useStep((a: { line: string; quantity: number; note?: string | null }, l) => {
  const tb = l.tabOfLine(a.line)
  return {
    chain: chainOf(tb?.id ?? a.line), fn: 'restaurant_change_line', args: { p_line: a.line, p_quantity: a.quantity, p_note: a.note ?? null },
    label: t('{order}: item changed', { order: titleOf(tb) }),
    local: () => { if (tb) l.editTab(tb.id, (x) => ({ ...x, lines: a.quantity <= 0 ? x.lines.filter((y) => y.id !== a.line) : x.lines.map((y) => (y.id === a.line ? { ...y, quantity: a.quantity, note: a.note ?? y.note } : y)) })) },
  }
})

export const useVoidLine = () => useStep((a: { line: string; reason: string }, l) => {
  const tb = l.tabOfLine(a.line)
  return {
    chain: chainOf(tb?.id ?? a.line), fn: 'restaurant_void', args: { p_line: a.line, p_reason: a.reason },
    label: t('{order}: item cancelled', { order: titleOf(tb) }),
    local: () => { if (tb) l.editTab(tb.id, (x) => ({ ...x, lines: x.lines.map((y) => (y.id === a.line ? { ...y, status: 'void' as const } : y)) })) },
  }
})

export interface SentTickets { number: string; table: string | null; label: string | null; waiter: string; at: string; tickets: { station: string; lines: { name: string; quantity: number; note: string | null }[] }[] }
export const useSend = () => useStep((tab: string, l) => ({
  chain: chainOf(tab), fn: 'restaurant_send', args: { p_tab: tab }, label: t('{order}: sent to the kitchen', { order: titleOf(l.getTab(tab)) }),
  local: (): SentTickets => {
    const at = new Date().toISOString()
    const before = l.getTab(tab)
    const fresh = (before?.lines ?? []).filter((x) => x.status === 'new')
    l.editTab(tab, (x) => ({ ...x, lines: x.lines.map((y) => (y.status === 'new' ? { ...y, status: 'sent' as const, sent_at: at } : y)) }))
    return { number: before?.number ?? '', table: before?.table ?? null, label: before?.label ?? null, waiter: l.waiterName, at,
             tickets: fresh.length ? [{ station: '', lines: fresh.map((x) => ({ name: x.name, quantity: x.quantity, note: x.note })) }] : [] }
  },
}))

export const useMoveTab = () => useStep((a: { tab: string; table: string }, l) => {
  if (!navigator.onLine && l.openOn(a.table)) throw new Error(t('Joining two tables needs internet'))
  return {
    chain: chainOf(a.tab), fn: 'restaurant_move', args: { p_tab: a.tab, p_table: a.table },
    label: t('{order}: moved to {name}', { order: titleOf(l.getTab(a.tab)), name: l.tableName(a.table) ?? '' }),
    local: () => { l.editTab(a.tab, (x) => ({ ...x, table_id: a.table, table: l.tableName(a.table), label: null })); return a.tab },
  }
})

export const useSetGuests = () => useStep((a: { tab: string; guests: number }, l) => ({
  chain: chainOf(a.tab), fn: 'restaurant_set_guests', args: { p_tab: a.tab, p_guests: a.guests }, label: t('{order}: {n} guests', { order: titleOf(l.getTab(a.tab)), n: a.guests }),
  local: () => { l.editTab(a.tab, (x) => ({ ...x, guests: a.guests })) },
}))

export const useCloseEmpty = () => useStep((tab: string, l) => ({
  chain: chainOf(tab), fn: 'restaurant_close_empty', args: { p_tab: tab }, label: t('{order}: table freed', { order: titleOf(l.getTab(tab)) }),
  local: () => { l.editTab(tab, (x) => ({ ...x, status: 'cancelled' })) },
}))

export const useSetLineStatus = () => {
  const qc = useQueryClient()
  const { companyId } = useCompany()
  return useMutation({
    mutationFn: async (a: { lines: string[]; status: 'sent' | 'ready' | 'served' }) => unwrap(await supabase.rpc('restaurant_set_status', { p_lines: a.lines, p_status: a.status })),
    onSuccess: () => void qc.invalidateQueries({ queryKey: key(companyId) }),
    onError: (e) => toast.error(describeError(e)),
  })
}

export interface PayResult { id: string; number: string; total: number; change: number; closed: boolean; offline?: boolean }
export const usePayTab = () => useStep((p: {
  tab_id: string; session_id: string; client_uuid: string; device_ref?: string; split?: { line_id: string; quantity: number }[]
  payments: { method: string; amount: number }[]
  /** per line: the card's discount, or a discount given by hand (manual_pct) */
  discounts?: { line_id: string; variant_id: string; discount_pct: number; manual_pct: number }[]
  loyalty?: { card_id: string; redeem_points: number } | null
  /** what is paid now, worked out on the screen (for the receipt when offline) */
  total: number
}, l) => {
  const { total, ...rest } = p
  const queued = !navigator.onLine || hasPending(chainOf(p.tab_id))
  const args = { p: { ...rest, order_at: new Date().toISOString(), offline: queued } }
  return {
    chain: chainOf(p.tab_id), fn: 'restaurant_pay', args, label: t('{order}: paid {amount}', { order: titleOf(l.getTab(p.tab_id)), amount: total.toFixed(2) }),
    online: (d) => d as PayResult,
    local: (): PayResult => {
      const tb = l.editTab(p.tab_id, (x) => {
        let lines = x.lines.map((y) => (y.status === 'new' ? { ...y, status: 'sent' as const, sent_at: new Date().toISOString() } : y))
        if (p.split?.length) {
          for (const s of p.split) {
            const y = lines.find((z) => z.id === s.line_id)
            if (!y) continue
            if (s.quantity < y.quantity) lines = [...lines.map((z) => (z.id === y.id ? { ...z, quantity: z.quantity - s.quantity } : z)), { ...y, id: newId(), quantity: s.quantity, paid: true }]
            else lines = lines.map((z) => (z.id === y.id ? { ...z, paid: true } : z))
          }
        } else lines = lines.map((y) => (y.status !== 'void' ? { ...y, paid: true } : y))
        const closed = !lines.some((y) => y.status !== 'void' && !y.paid)
        return { ...x, lines, status: closed ? 'paid' : x.status }
      })
      const paidIn = p.payments.reduce((s, x) => s + Number(x.amount), 0)
      return { id: '', number: p.device_ref ?? '', total, change: Math.max(0, Math.round((paidIn - total) * 100) / 100), closed: tb?.status === 'paid', offline: true }
    },
  }
}, true)

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
