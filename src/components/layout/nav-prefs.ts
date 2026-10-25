import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import * as React from 'react'
import { useAuth } from '@/app/auth-provider'
import { useCompany } from '@/app/company-provider'
import type { Json } from '@/lib/database.types'
import { supabase } from '@/lib/supabase'

/** Most items a person can pin to the top of the menu */
export const MAX_FAVOURITES = 8

interface Prefs { nav_favourites?: string[]; nav_open?: string[] }

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
    mutationFn: async ({ key, value }: { key: keyof Prefs; value: string[] }) => {
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
  return (q.data?.hidden_menu_sections ?? []) as string[]
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
