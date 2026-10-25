import { useQuery, useQueryClient } from '@tanstack/react-query'
import * as React from 'react'
import { useAuth } from '@/app/auth-provider'
import { moduleAllowed, pageFeatures } from '@/lib/plans'
import { supabase } from '@/lib/supabase'

export interface CompanySummary {
  id: string
  name: string
  country_code: string
  base_currency: string
  logo_path: string | null
  roles: string[]
  permissions: string[]
  license?: { plan: string; max_users: number; valid_until: string; features?: string[]; max_warehouses?: number | null } | null
  /** practice company: data comes live from the old program, nothing is fiscalized */
  is_training?: boolean
  business_type?: string
  /** this person starts in the simple view (a few large buttons, no menus) */
  simple_view?: boolean
}

/** A company the person belongs to that is on hold because of its licence */
export interface BlockedCompany {
  id: string
  name: string
  reason: 'expired' | 'suspended' | 'not_started' | 'missing'
  valid_until: string | null
}

interface MyContext {
  user_id: string
  is_super_admin: boolean
  self_service?: boolean
  last_company_id: string | null
  companies: CompanySummary[]
  blocked?: BlockedCompany[]
}

interface CompanyCtx {
  loading: boolean
  companies: CompanySummary[]
  company: CompanySummary | null
  companyId: string
  isSuperAdmin: boolean
  /** anyone may open a company (otherwise only the platform owner creates clients) */
  selfService: boolean
  blocked: BlockedCompany[]
  switchCompany: (id: string) => Promise<void>
  /** permission check with the same pattern rules as the database: exact, module.*, *.action, * */
  can: (perm: string) => boolean
  /** the company's plan includes this feature */
  hasFeature: (feature: string) => boolean
  /** the page is in the plan (pages of a feature outside it are closed) */
  pageAllowed: (path: string) => boolean
  /** the simple view is on (the company's setting for this person, or their own choice on this device) */
  simple: boolean
  setSimple: (on: boolean) => void
  refresh: () => Promise<unknown>
}

const CompanyContext = React.createContext<CompanyCtx | null>(null)
const KEY = 'drispro.company'

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
      try { localStorage.setItem(`drispro.ctx.${user!.id}`, JSON.stringify(data)) } catch { /* ignore */ }
      return data as unknown as MyContext
    },
    initialData: () => {
      if (!user || navigator.onLine) return undefined
      try { const raw = localStorage.getItem(`drispro.ctx.${user.id}`); return raw ? (JSON.parse(raw) as MyContext) : undefined } catch { return undefined }
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

  const features = company?.license?.features
  const can = React.useCallback(
    (perm: string) => matchesPermission(company?.permissions ?? [], perm, ctxQuery.data?.is_super_admin) && moduleAllowed(features, perm.split('.')[0]),
    [company, ctxQuery.data?.is_super_admin, features],
  )
  const hasFeature = React.useCallback((f: string) => !features || features.includes(f), [features])
  const pageAllowed = React.useCallback((path: string) => {
    const need = pageFeatures(path)
    return !need.length || need.some((f) => hasFeature(f))
  }, [hasFeature])

  const viewKey = company && user ? `drispro.view.${user.id}.${company.id}` : null
  const [viewChoice, setViewChoice] = React.useState<string | null>(null)
  React.useEffect(() => { try { setViewChoice(viewKey ? localStorage.getItem(viewKey) : null) } catch { setViewChoice(null) } }, [viewKey])
  const simple = viewChoice === 'simple' ? true : viewChoice === 'full' ? false : !!company?.simple_view
  const setSimple = React.useCallback((on: boolean) => {
    const v = on === !!company?.simple_view ? null : on ? 'simple' : 'full'
    setViewChoice(v)
    try { if (viewKey) { if (v) localStorage.setItem(viewKey, v); else localStorage.removeItem(viewKey) } } catch { /* private window */ }
  }, [company?.simple_view, viewKey])

  const value: CompanyCtx = {
    loading: ctxQuery.isLoading,
    companies,
    company,
    companyId: company?.id ?? '',
    isSuperAdmin: !!ctxQuery.data?.is_super_admin,
    selfService: !!ctxQuery.data?.self_service,
    blocked: ctxQuery.data?.blocked ?? [],
    switchCompany,
    can,
    hasFeature,
    pageAllowed,
    simple,
    setSimple,
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
