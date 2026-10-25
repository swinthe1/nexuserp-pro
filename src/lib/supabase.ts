import { createClient } from '@supabase/supabase-js'
import type { Database } from './database.types'

// a NexusERP on a local server says at start where its API is (nexus-config.js); the cloud build has it built in
const local = (typeof window !== 'undefined' ? (window as unknown as { __NEXUS__?: { url?: string; anonKey?: string } | null }).__NEXUS__ : null) ?? null
export const supabaseUrl: string = local?.url === 'same-origin' ? window.location.origin : (local?.url || import.meta.env.VITE_SUPABASE_URL)
export const supabaseAnonKey: string = local?.anonKey || import.meta.env.VITE_SUPABASE_ANON_KEY
/** this NexusERP runs on a server of the client (not in the cloud) */
export const isLocalServer = !!local
const url = supabaseUrl
const anonKey = supabaseAnonKey

if (!url || !anonKey) {
  throw new Error('Missing VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY. Copy .env.example to .env.local and fill them in.')
}

export const supabase = createClient<Database>(url, anonKey, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
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

/** `.gt(key, after)` only when there is a previous page. */
export function after<Q extends { gt: (column: string, value: string) => Q }>(q: Q, key: string, value: string | null): Q {
  return value === null ? q : q.gt(key, value)
}

/** Sorts partner-like rows by name, the order the lists show them in. */
export function byName<T extends { name?: string | null }>(rows: T[]): T[] {
  return rows.sort((a, b) => (a.name ?? '').localeCompare(b.name ?? ''))
}
