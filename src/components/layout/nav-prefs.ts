import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import * as React from 'react'
import { useAuth } from '@/app/auth-provider'
import { useCompany } from '@/app/company-provider'
import type { Json } from '@/lib/database.types'
import { supabase } from '@/lib/supabase'

/** Most items a person can pin to the top of the menu */
export const MAX_FAVOURITES = 8

interface Prefs { [key: string]: unknown; nav_favourites?: string[]; nav_open?: string[]; dashboard_cards?: Record<string, string[]>; table_columns?: Record<string, TableColumns> }
/** the columns a person hid on a table of lines, and their order */
export interface TableColumns { order: string[]; hidden: string[] }

function useMyPrefs() {
  const { user } = useAuth()
  return useQuery({
    queryKey: ['my-prefs', user?.id],
    enabled: !!user,
    staleTime: 10 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.from('profiles').select('preferences').eq('id', user!.id).maybeSingle()
      if (error) throw error
      return ((data?.preferences ?? {}) as Prefs)
    },
  })
}

function useSavePref() {
  const { user } = useAuth()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ key, value }: { key: string; value: unknown }) => {
      const { error } = await supabase.rpc('save_my_preference', { p_key: key, p_value: value as unknown as Json })
      if (error) throw error
    },
    // the menu changes at once; the server copy follows
    onMutate: ({ key, value }) => {
      qc.setQueryData<Prefs>(['my-prefs', user?.id], (old) => ({ ...(old ?? {}), [key]: value }))
    },
  })
}

/** Menu items the person pinned to the top (hrefs), kept on their profile so every device shows the same. */
export function useFavourites() {
  const prefs = useMyPrefs()
  const save = useSavePref()
  const favourites = prefs.data?.nav_favourites ?? []
  const toggle = React.useCallback((href: string) => {
    const next = favourites.includes(href) ? favourites.filter((h) => h !== href) : [...favourites, href].slice(-MAX_FAVOURITES)
    save.mutate({ key: 'nav_favourites', value: next })
  }, [favourites, save])
  return { favourites, toggle, loaded: prefs.isSuccess }
}

/** Menu parts the person opened; null until loaded (then the part of the current page opens by itself). */
export function useOpenSections() {
  const prefs = useMyPrefs()
  const save = useSavePref()
  const open = prefs.data?.nav_open ?? null
  const set = React.useCallback((next: string[]) => save.mutate({ key: 'nav_open', value: next }), [save])
  return { open, set }
}

/** The dashboard cards a person chose for this company, in their order; null = the usual set. */
export function useDashboardCards() {
  const { companyId } = useCompany()
  const prefs = useMyPrefs()
  const save = useSavePref()
  const all = prefs.data?.dashboard_cards ?? {}
  const cards = companyId ? all[companyId] ?? null : null
  const set = React.useCallback((next: string[] | null) => {
    if (!companyId) return
    const copy = { ...all }
    if (next) copy[companyId] = next; else delete copy[companyId]
    save.mutate({ key: 'dashboard_cards', value: copy })
  }, [all, companyId, save])
  return { cards, set, loaded: prefs.isSuccess }
}

/** The shortcuts a person put in the top bar for this company, in their order (links of pages or of "+"). */
export const MAX_SHORTCUTS = 10
export function useTopShortcuts() {
  const { companyId } = useCompany()
  const prefs = useMyPrefs()
  const save = useSavePref()
  const all = (prefs.data?.top_shortcuts ?? {}) as Record<string, string[]>
  const list = companyId ? all[companyId] ?? [] : []
  const set = React.useCallback((next: string[]) => {
    if (!companyId) return
    save.mutate({ key: 'top_shortcuts', value: { ...all, [companyId]: next.slice(0, MAX_SHORTCUTS) } })
  }, [all, companyId, save])
  return { list, set, loaded: prefs.isSuccess }
}

/** Parts of the menu the company's admin switched off for everyone. */
export function useHiddenSections() {
  const { companyId } = useCompany()
  const q = useQuery({
    queryKey: ['admin', companyId, 'settings'],   // same key as the settings page, so saving there updates the menu
    enabled: !!companyId,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.from('company_settings').select('*').eq('company_id', companyId).single()
      if (error) throw error
      return data
    },
  })
  const { company } = useCompany()
  const saved = (q.data?.hidden_menu_sections ?? []) as string[]
  return React.useMemo(() => {
    // only the tax regime that applies: VAT returns with a VAT number, the small business tax (Kosovo) without one;
    // the Kosovo small business rules are not Albania's, so that page is not shown there
    const regime = company?.vat_registered === undefined ? []
      : company.vat_registered ? ['/tax/small-business']
      : company.country_code === 'XK' ? ['/tax/declarations'] : ['/tax/small-business', '/tax/declarations']
    return [...saved, ...regime]
  }, [saved, company?.vat_registered, company?.country_code])
}

/* ---------------------------------------------- pages used most on this device */

const USAGE_KEY = 'drispro.nav.usage'

export function recordVisit(href: string) {
  try {
    const raw = JSON.parse(localStorage.getItem(USAGE_KEY) ?? '{}') as Record<string, number>
    raw[href] = (raw[href] ?? 0) + 1
    localStorage.setItem(USAGE_KEY, JSON.stringify(raw))
  } catch { /* storage unavailable */ }
}

export function mostUsed(limit: number, allowed: (href: string) => boolean) {
  try {
    const raw = JSON.parse(localStorage.getItem(USAGE_KEY) ?? '{}') as Record<string, number>
    return Object.entries(raw)
      .filter(([href, n]) => n >= 3 && href !== '/' && allowed(href))
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit)
      .map(([href]) => href)
  } catch { return [] }
}

/** How a person arranged the columns of a table of lines (which they hide, in which order), kept on their profile. */
export function useTableColumns(table: string) {
  const prefs = useMyPrefs()
  const save = useSavePref()
  const all = prefs.data?.table_columns ?? {}
  const cols = all[table] ?? null
  const set = React.useCallback((next: TableColumns | null) => {
    const copy = { ...all }
    if (next) copy[table] = next; else delete copy[table]
    save.mutate({ key: 'table_columns', value: copy })
  }, [all, table, save])
  return { cols, set, loaded: prefs.isSuccess }
}

/**
 * One preference of the person's own, on their profile (every device the same). The key is letters and
 * underscores; undefined until the profile has loaded.
 */
export function useProfilePref<T>(key: string | null) {
  const prefs = useMyPrefs()
  const save = useSavePref()
  const value = key ? (prefs.data?.[key] as T | undefined) ?? null : null
  const set = React.useCallback((next: T | null) => { if (key) save.mutate({ key, value: next }) }, [key, save])
  return { value, set, loaded: prefs.isSuccess }
}
/** the profile key for a list's own layout */
export const tableLayoutKey = (tableKey: string) => `tl_${tableKey.toLowerCase().replace(/[^a-z]+/g, '_')}`.slice(0, 40)
