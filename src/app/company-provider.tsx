import { useQuery, useQueryClient } from '@tanstack/react-query'
import * as React from 'react'
import { useAuth } from '@/app/auth-provider'
import { supabase } from '@/lib/supabase'

export interface CompanySummary {
  id: string
  name: string
  country_code: string
  base_currency: string
  logo_path: string | null
  roles: string[]
  permissions: string[]
}

interface MyContext {
  user_id: string
  is_super_admin: boolean
  last_company_id: string | null
  companies: CompanySummary[]
}

interface CompanyCtx {
  loading: boolean
  companies: CompanySummary[]
  company: CompanySummary | null
  companyId: string
  isSuperAdmin: boolean
  switchCompany: (id: string) => Promise<void>
  /** permission check with the same pattern rules as the database: exact, module.*, *.action, * */
  can: (perm: string) => boolean
  refresh: () => Promise<unknown>
}

const CompanyContext = React.createContext<CompanyCtx | null>(null)
const KEY = 'nexus.company'

export function matchesPermission(granted: string[], perm: string, superAdmin = false) {
  if (superAdmin) return true
  const [module, action] = perm.split('.')
  return granted.some((g) => g === perm || g === '*' || g === `${module}.*` || g === `*.${action}`)
}

export function CompanyProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth()
  const qc = useQueryClient()
  const ctxQuery = useQuery({
    queryKey: ['my-context', user?.id],
    enabled: !!user,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('get_my_context')
      if (error) throw error
      // kept on the device so offline screens (the POS till) still know the company and permissions
      try { localStorage.setItem(`nexus.ctx.${user!.id}`, JSON.stringify(data)) } catch { /* ignore */ }
      return data as unknown as MyContext
    },
    initialData: () => {
      if (!user || navigator.onLine) return undefined
      try { const raw = localStorage.getItem(`nexus.ctx.${user.id}`); return raw ? (JSON.parse(raw) as MyContext) : undefined } catch { return undefined }
    },
  })

  const [selected, setSelected] = React.useState<string | null>(() => {
    try { return localStorage.getItem(KEY) } catch { return null }
  })

  const companies = ctxQuery.data?.companies ?? []
  const company =
    companies.find((c) => c.id === selected) ??
    companies.find((c) => c.id === ctxQuery.data?.last_company_id) ??
    companies[0] ??
    null

  const switchCompany = React.useCallback(async (id: string) => {
    setSelected(id)
    try { localStorage.setItem(KEY, id) } catch { /* ignore */ }
    // drop everything cached for the previous company; keys are company-scoped anyway
    qc.removeQueries({ predicate: (q) => q.queryKey[0] !== 'my-context' })
    await supabase.rpc('switch_company', { p_company: id })
  }, [qc])

  const can = React.useCallback(
    (perm: string) => matchesPermission(company?.permissions ?? [], perm, ctxQuery.data?.is_super_admin),
    [company, ctxQuery.data?.is_super_admin],
  )

  const value: CompanyCtx = {
    loading: ctxQuery.isLoading,
    companies,
    company,
    companyId: company?.id ?? '',
    isSuperAdmin: !!ctxQuery.data?.is_super_admin,
    switchCompany,
    can,
    refresh: () => ctxQuery.refetch(),
  }
  return <CompanyContext.Provider value={value}>{children}</CompanyContext.Provider>
}

export function useCompany() {
  const ctx = React.useContext(CompanyContext)
  if (!ctx) throw new Error('useCompany must be used inside CompanyProvider')
  return ctx
}

/** Renders children only when the current user holds the permission */
export function Can({ perm, children, fallback = null }: { perm: string; children: React.ReactNode; fallback?: React.ReactNode }) {
  const { can } = useCompany()
  return <>{can(perm) ? children : fallback}</>
}
