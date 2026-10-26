import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import * as React from 'react'
import { toast } from 'sonner'
import { useCompany } from '@/app/company-provider'
import { describeError, unwrap } from '@/lib/errors'
import { kv } from '@/lib/offline/idb'
import { enqueue, newId, onOutboxDone, useOutbox, type OutboxItem } from '@/lib/offline/outbox'
import { isNetError } from '@/lib/offline/step'
import { supabase } from '@/lib/supabase'
import type { Json } from '@/lib/database.types'

export type OpenInvoice = { id: string; number: string; date: string; due: string | null; currency: string; total: number; open: number }
export type AgentCustomer = {
  id: string; code: string | null; name: string; phone: string | null; tax_number: string | null
  currency: string; price_list_id: string | null; discount: number; credit_limit: number | null; exposure: number; advance: number
  address: { line1: string; city: string; lat: number | null; lng: number | null } | null
  open: OpenInvoice[]
  orders: { id: string; number: string; date: string; status: string; total: number; currency: string }[]
  last_visit: string | null
}
/** [variant, sku, name, base price, tax rate, available here, uom] */
type RawItem = [string, string, string, number, number, number, string | null]
export type AgentItem = { id: string; sku: string; name: string; price: number; tax: number; available: number; uom: string | null }
export type Visit = { id: string; partner_id: string; at: string; outcome: Outcome; note: string | null }
export type AgentDay = {
  visits: Visit[]
  orders: { id: string; number: string; partner_id: string; status: string; total: number; currency: string }[]
  payments: { id: string; number: string; partner_id: string; amount: number; currency: string; status: string }[]
  cash: number | null
}
export type Outcome = 'order' | 'payment' | 'no_order' | 'closed' | 'other'
export type AgentBoot = {
  at: string; today: string; weekday: number; currency: string; max_discount: number
  agent: { id: string; warehouse_id: string | null; warehouse: string | null; safe_id: string | null; safe: string | null; cash: number | null }
  route: [number, string, number][]
  customers: AgentCustomer[]
  items: RawItem[]
  partner_prices: [string, string, number, number | null, number][]
  price_lists: { id: string; currency: string; with_tax: boolean; default: boolean; items: [string, number, number, number][] }[]
  day: AgentDay
}

export const agentKeys = { boot: (co: string | null) => ['agent', co, 'boot'] as const, day: (co: string | null, d: string) => ['agent', co, 'manager', d] as const }
const bootKey = (co: string) => `agent-boot:${co}`

/** Is the person a field agent of this company (for the menu and the start page). */
export function useAmIAgent() {
  const { companyId } = useCompany()
  return useQuery({
    queryKey: ['agent', companyId, 'me'], enabled: !!companyId, staleTime: 10 * 60_000,
    queryFn: async () => unwrap(await supabase.rpc('am_i_agent', { p_company: companyId! })) as boolean,
  })
}

/** Everything the phone needs for the day; kept on the device so it opens without internet. */
export function useAgentBoot() {
  const { companyId } = useCompany()
  return useQuery({
    queryKey: agentKeys.boot(companyId), enabled: !!companyId, refetchInterval: 5 * 60_000, refetchOnWindowFocus: true,
    networkMode: 'always', retry: (n, e) => !isNetError(e) && n < 1,
    queryFn: async () => {
      try {
        const data = unwrap(await supabase.rpc('agent_bootstrap', { p_company: companyId! })) as unknown as AgentBoot
        void kv.set(bootKey(companyId!), data)
        return data
      } catch (e) {
        if (!isNetError(e)) throw e
        const saved = await kv.get<AgentBoot>(bootKey(companyId!))
        if (saved) return saved
        throw e
      }
    },
  })
}

export function useItems(boot: AgentBoot | undefined) {
  return React.useMemo(() => (boot?.items ?? []).map(([id, sku, name, price, tax, available, uom]): AgentItem =>
    ({ id, sku, name, price: Number(price), tax: Number(tax), available: Number(available), uom })), [boot])
}

/**
 * The price the company would give (the server decides; this is what the agent shows the customer
 * before sending). Same order as get_price: the customer's own price, their price list, the list price.
 */
export function estimatePrice(boot: AgentBoot, c: AgentCustomer, item: AgentItem, qty: number): { price: number; discount: number; exact: boolean } {
  const pp = boot.partner_prices.filter(([p, v, min]) => p === c.id && v === item.id && Number(min) <= qty).sort((a, b) => Number(b[2]) - Number(a[2]))[0]
  if (pp) return { price: pp[3] == null ? item.price : Number(pp[3]), discount: Number(pp[4]) > 0 ? Number(pp[4]) : Number(c.discount), exact: c.currency === boot.currency }
  const list = boot.price_lists.find((l) => l.id === c.price_list_id) ?? (c.price_list_id ? undefined : boot.price_lists.find((l) => l.default))
  if (list) {
    const it = list.items.filter(([v, min]) => v === item.id && Number(min) <= qty).sort((a, b) => Number(b[1]) - Number(a[1]))[0]
    if (it) {
      const price = list.with_tax ? Number(it[2]) / (1 + item.tax / 100) : Number(it[2])
      return { price, discount: Number(it[3]) > 0 ? Number(it[3]) : Number(c.discount), exact: list.currency === boot.currency && c.currency === boot.currency }
    }
  }
  return { price: item.price, discount: Number(c.discount), exact: c.currency === boot.currency }
}

export type Fix = { lat: number; lng: number; accuracy: number }
/** Where the phone is (a few seconds at most; nothing when the person said no). */
export function locate(timeout = 8000): Promise<Fix | null> {
  if (typeof navigator === 'undefined' || !navigator.geolocation) return Promise.resolve(null)
  return new Promise((resolve) => {
    const done = (v: Fix | null) => { clearTimeout(timer); resolve(v) }
    const timer = setTimeout(() => resolve(null), timeout + 500)
    navigator.geolocation.getCurrentPosition(
      (p) => done({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy }),
      () => done(null), { enableHighAccuracy: true, timeout, maximumAge: 60_000 })
  })
}

export const AGENT_FNS = ['agent_order_submit', 'agent_payment_submit', 'agent_visit_log'] as const
type AgentFn = typeof AGENT_FNS[number]

/** What is on this phone and not on the server yet (and what the server refused). */
export function useWaiting() {
  const { companyId } = useCompany()
  const ob = useOutbox(companyId)
  return React.useMemo(() => ob.items.filter((i) => (AGENT_FNS as readonly string[]).includes(i.fn)), [ob.items])
}
export const waitingArgs = (i: OutboxItem) => (i.args as { p: Record<string, unknown> }).p

/**
 * Send to the server with the id made here; without internet it waits on the phone and goes on its own.
 * The server answers a repeat with the first answer, so a retry never doubles an order or a collection.
 */
export function useAgentSend<R>(fn: AgentFn, label: (p: Record<string, unknown>) => string) {
  const { companyId } = useCompany()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (p: Record<string, unknown>): Promise<{ offline: true } | (R & { offline?: false })> => {
      const body = { ...p, id: (p.id as string) ?? newId(), company_id: companyId, at: new Date().toISOString() }
      if (navigator.onLine) {
        const { data, error } = await supabase.rpc(fn, { p: body as unknown as Json })
        if (!error) { void qc.invalidateQueries({ queryKey: agentKeys.boot(companyId) }); return data as unknown as R & { offline?: false } }
        if (!isNetError(error)) throw error
      }
      await enqueue({ company_id: companyId ?? '', fn, args: { p: body }, label: label(body), chain: `agent:${body.id}`, invalidate: [[...agentKeys.boot(companyId)]] })
      return { offline: true }
    },
    onError: (e) => toast.error(describeError(e)),
  })
}

/** Refresh the day once the waiting work went through. */
export function useRefreshOnSent() {
  const { companyId } = useCompany()
  const qc = useQueryClient()
  React.useEffect(() => onOutboxDone((it) => {
    if ((AGENT_FNS as readonly string[]).includes(it.fn)) void qc.invalidateQueries({ queryKey: agentKeys.boot(companyId) })
  }), [qc, companyId])
}

// ---------------------------------------------------------------------------------------------
// The manager
// ---------------------------------------------------------------------------------------------
export type ManagedAgent = {
  id: string; user_id: string; name: string; is_active: boolean; warehouse_id: string | null; warehouse: string | null
  safe_id: string | null; safe: string | null; cash: number | null; customers: number
  route: { weekday: number; partner_id: string; name: string; position: number }[]
}
export type AgentsSetup = {
  agents: ManagedAgent[]; members: { user_id: string; name: string }[]
  warehouses: { id: string; name: string }[]; safes: { id: string; name: string; holder_id: string | null }[]; can_make_safe: boolean
}
export type DayAgent = {
  id: string; name: string; is_active: boolean; planned: number; visited: number; planned_visited: number
  orders: number; orders_total: number; held: number; collected: number; cash: number | null
  last: { at: string; lat: number; lng: number; partner: string } | null
}
export type DayVisit = {
  id: string; agent_id: string; partner: string; partner_id: string; at: string; outcome: Outcome; note: string | null
  lat: number | null; lng: number | null; accuracy: number | null; distance_m: number | null
  order: { id: string; number: string; total: number; currency: string; status: string } | null
  payment: { id: string; number: string; amount: number; currency: string } | null
}
export type AgentsDay = { date: string; currency: string; agents: DayAgent[]; visits: DayVisit[] }

export function useAgentsSetup() {
  const { companyId } = useCompany()
  return useQuery({
    queryKey: ['agent', companyId, 'setup'], enabled: !!companyId,
    queryFn: async () => unwrap(await supabase.rpc('agents_list', { p_company: companyId! })) as unknown as AgentsSetup,
  })
}

export function useAgentsDay(date: string) {
  const { companyId } = useCompany()
  return useQuery({
    queryKey: agentKeys.day(companyId, date), enabled: !!companyId, refetchInterval: 60_000,
    queryFn: async () => unwrap(await supabase.rpc('agents_day', { p_company: companyId!, p_date: date })) as unknown as AgentsDay,
  })
}

export function useSaveAgent() {
  const { companyId } = useCompany()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (p: Record<string, unknown>) => unwrap(await supabase.rpc('agent_save', { p: { ...p, company_id: companyId } as unknown as Json })) as string,
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['agent', companyId] }),
  })
}

export function useSaveRoute() {
  const { companyId } = useCompany()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (a: { agent: string; weekday: number; partners: string[] }) =>
      unwrap(await supabase.rpc('agent_route_save', { p_agent: a.agent, p_weekday: a.weekday, p_partners: a.partners })) as number,
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['agent', companyId] }),
    onError: (e) => toast.error(describeError(e)),
  })
}
