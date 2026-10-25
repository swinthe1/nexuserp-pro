/**
 * The items of the company kept on this device (code, name, barcodes, lots, price), so a scan or a
 * search works without internet. Refreshed every half hour while online.
 */
import * as React from 'react'
import { useCompany } from '@/app/company-provider'
import { supabase } from '@/lib/supabase'
import { kv } from './idb'

export interface ScanItem { variant_id: string; product_id: string; sku: string; name: string; tracking: string; barcodes: [string, number][]; price: number; cost: number }
export interface ScanLot { id: string; variant_id: string; lot_number: string; expiry_date: string | null }
interface Raw { at: string; items: [string, string, string, string, string, [string, number][], number, number][]; lots: [string, string, string, string | null][] }

const REFRESH = 30 * 60_000
const cache = new Map<string, { at: number; items: ScanItem[]; lots: ScanLot[]; byCode: Map<string, [ScanItem, number]>; bySku: Map<string, ScanItem>; byLot: Map<string, ScanLot> }>()
const loading = new Map<string, Promise<void>>()
const listeners = new Set<() => void>()

function index(raw: Raw) {
  const items: ScanItem[] = raw.items.map(([variant_id, product_id, sku, name, tracking, barcodes, price, cost]) => ({ variant_id, product_id, sku, name, tracking, barcodes, price: Number(price), cost: Number(cost) }))
  const lots: ScanLot[] = raw.lots.map(([id, variant_id, lot_number, expiry_date]) => ({ id, variant_id, lot_number, expiry_date }))
  const byCode = new Map<string, [ScanItem, number]>(); const bySku = new Map<string, ScanItem>(); const byLot = new Map<string, ScanLot>()
  for (const it of items) { bySku.set(it.sku.toUpperCase(), it); for (const [b, q] of it.barcodes) byCode.set(b, [it, Number(q) || 1]) }
  for (const l of lots) byLot.set(l.lot_number, l)
  return { at: new Date(raw.at).getTime(), items, lots, byCode, bySku, byLot }
}

async function load(company: string, force = false) {
  const key = `scan-catalog:${company}`
  if (!cache.has(company)) {
    const saved = await kv.get<Raw>(key)
    if (saved) { cache.set(company, index(saved)); listeners.forEach((l) => l()) }
  }
  const have = cache.get(company)
  if (!navigator.onLine || (!force && have && Date.now() - have.at < REFRESH)) return
  const { data, error } = await supabase.rpc('scan_catalog', { p_company: company })
  if (error || !data) return
  await kv.set(key, data)
  cache.set(company, index(data as unknown as Raw))
  listeners.forEach((l) => l())
}

export function ensureScanCatalog(company: string, force = false) {
  if (!loading.has(company)) loading.set(company, load(company, force).finally(() => loading.delete(company)))
  return loading.get(company)!
}

/** what a scanned code is, from the device's copy */
export function findOffline(company: string, code: string) {
  const c = cache.get(company); if (!c) return null
  const s = code.trim()
  const hit = c.byCode.get(s)
  if (hit) return { kind: 'variant' as const, item: hit[0], qty: hit[1] }
  const bySku = c.bySku.get(s.toUpperCase())
  if (bySku) return { kind: 'variant' as const, item: bySku, qty: 1 }
  const lot = c.byLot.get(s)
  if (lot) return { kind: 'lot' as const, lot, item: c.items.find((i) => i.variant_id === lot.variant_id) ?? null }
  return null
}

export function searchOffline(company: string, q: string, limit = 30) {
  const c = cache.get(company); if (!c) return []
  const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean)
  if (!words.length) return c.items.slice(0, limit)
  const out: ScanItem[] = []
  for (const it of c.items) {
    const hay = `${it.sku} ${it.name}`.toLowerCase()
    if (words.every((w) => hay.includes(w)) || it.barcodes.some(([b]) => b === q.trim())) { out.push(it); if (out.length >= limit) break }
  }
  return out
}
export const itemOffline = (company: string, variantId: string) => cache.get(company)?.items.find((i) => i.variant_id === variantId) ?? null

/** keeps the device's copy fresh while a screen that scans is open; returns when it was taken */
export function useScanCatalog() {
  const { companyId } = useCompany()
  const [, bump] = React.useReducer((x: number) => x + 1, 0)
  React.useEffect(() => { listeners.add(bump); return () => { listeners.delete(bump) } }, [])
  React.useEffect(() => {
    if (!companyId) return
    void ensureScanCatalog(companyId)
    const i = setInterval(() => void ensureScanCatalog(companyId), REFRESH)
    const on = () => void ensureScanCatalog(companyId)
    window.addEventListener('online', on)
    return () => { clearInterval(i); window.removeEventListener('online', on) }
  }, [companyId])
  const c = companyId ? cache.get(companyId) : undefined
  return { ready: !!c, at: c ? new Date(c.at) : null, count: c?.items.length ?? 0 }
}
