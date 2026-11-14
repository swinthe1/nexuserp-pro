import { createClient } from '@supabase/supabase-js'
import type { Database } from './database.types'
import { deviceHeaders } from './device-licence'

// a DrisPRO on a local server says at start where its API is (drispro-config.js); the cloud build has it built in
const local = (typeof window !== 'undefined' ? (window as unknown as { __DRISPRO__?: { url?: string; anonKey?: string } | null }).__DRISPRO__ : null) ?? null
export const supabaseUrl: string = local?.url === 'same-origin' ? window.location.origin : (local?.url || import.meta.env.VITE_SUPABASE_URL)
export const supabaseAnonKey: string = local?.anonKey || import.meta.env.VITE_SUPABASE_ANON_KEY
/** this DrisPRO runs on a server of the client (not in the cloud) */
export const isLocalServer = !!local
const url = supabaseUrl
const anonKey = supabaseAnonKey

if (!url || !anonKey) {
  throw new Error('Missing VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY. Copy .env.example to .env.local and fill them in.')
}

export const supabase = createClient<Database>(url, anonKey, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
  // every request carries this device's licence (when it has one): a client may let only licensed devices work
  global: {
    fetch: (input: RequestInfo | URL, init?: RequestInit) => {
      const extra = deviceHeaders()
      if (!extra['x-drispro-device']) return fetch(input, init)
      const headers = new Headers(init?.headers)
      for (const [k, v] of Object.entries(extra)) headers.set(k, v)
      return fetch(input, { ...init, headers })
    },
  },
})

export type Supabase = typeof supabase

/**
 * Reads every row of a list, 1,000 at a time. The API returns at most 1,000 rows per call,
 * so a company with 20,000 products would otherwise see only the first 1,000.
 * Pages follow a unique column (`key`, e.g. sku or id) rather than an offset, so each page
 * costs the same however far into the list it is. `page(after)` adds `.gt(key, after)` when
 * after is set, and must order by `key` and limit to `size`.
 */
export async function fetchAll<T>(key: string, page: (after: string | null) => PromiseLike<{ data: T[] | null; error: unknown }>, size = 1000): Promise<T[]> {
  const out: T[] = []
  let after: string | null = null
  for (;;) {
    const { data, error } = await page(after)
    if (error) throw error
    const rows = data ?? []
    out.push(...rows)
    if (rows.length < size) return out
    after = String((rows[rows.length - 1] as Record<string, unknown>)[key])
  }
}

/**
 * Reads a list page by page, in the order the query sets (newest first for documents): the server gives at
 * most 1,000 rows a call, so a busy company's older invoices would otherwise not be in the list at all.
 * Stops at `max` rows; `page(from, to)` adds `.range(from, to)` to its query.
 */
export async function fetchPages<T>(page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>, max = 30000, size = 1000): Promise<T[]> {
  const out: T[] = []
  for (let from = 0; from < max; from += size) {
    const { data, error } = await page(from, from + size - 1)
    if (error) throw error
    const rows = data ?? []
    out.push(...rows)
    if (rows.length < size) break
  }
  return out
}

/** `.gt(key, after)` only when there is a previous page. */
export function after<Q extends { gt: (column: string, value: string) => Q }>(q: Q, key: string, value: string | null): Q {
  return value === null ? q : q.gt(key, value)
}

/** Sorts partner-like rows by name, the order the lists show them in. */
export function byName<T extends { name?: string | null }>(rows: T[]): T[] {
  return rows.sort((a, b) => (a.name ?? '').localeCompare(b.name ?? ''))
}
