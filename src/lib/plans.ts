import { msg } from '@/i18n'

/** What a licence can include (the server decides; see app.plan_features). */
export type Feature = 'transfers' | 'accounting' | 'restaurant' | 'imports' | 'approvals' | 'hr' | 'wms' | 'manufacturing' | 'logistics' | 'ecommerce' | 'livesync'

export const FEATURES: { key: Feature; label: string; plan: 'standard' | 'pro' }[] = [
  { key: 'transfers', label: msg('Transfers between stores'), plan: 'standard' },
  { key: 'accounting', label: msg('Full accounting'), plan: 'standard' },
  { key: 'restaurant', label: msg('Restaurant'), plan: 'standard' },
  { key: 'imports', label: msg('Imports and customs costs'), plan: 'standard' },
  { key: 'approvals', label: msg('Approvals'), plan: 'standard' },
  { key: 'hr', label: msg('People and payroll'), plan: 'standard' },
  { key: 'wms', label: msg('Advanced warehouse'), plan: 'pro' },
  { key: 'manufacturing', label: msg('Production'), plan: 'pro' },
  { key: 'logistics', label: msg('Logistics'), plan: 'pro' },
  { key: 'ecommerce', label: msg('Web shop'), plan: 'pro' },
  { key: 'livesync', label: msg('Live link with the old program'), plan: 'pro' },
]

export const PLAN_FEATURES: Record<string, Feature[]> = {
  basic: [],
  standard: FEATURES.filter((f) => f.plan === 'standard').map((f) => f.key),
  pro: FEATURES.map((f) => f.key),
  trial: FEATURES.map((f) => f.key),
}
export const PLAN_STORES: Record<string, number | null> = { basic: 1, standard: 5, pro: null, trial: null }

/** Pages that belong to a feature (first match wins; any of the listed features opens it). */
const PAGE_FEATURES: [string, Feature[]][] = [
  ['/inventory/transfers', ['transfers']],
  ['/inventory/landed-costs', ['imports']],
  ['/wms/counts', []], ['/wms/lots', []],
  ['/wms', ['wms']],
  ['/oms', ['ecommerce']], ['/ecommerce', ['ecommerce']],
  ['/manufacturing/boms', ['manufacturing', 'restaurant']],
  ['/manufacturing', ['manufacturing']],
  ['/pos/floor', ['restaurant']], ['/pos/kitchen', ['restaurant']], ['/pos/waiters', ['restaurant']],
  ['/logistics', ['logistics']],
  ['/finance/reports', ['accounting']], ['/finance/journal', ['accounting']], ['/finance/accounts', ['accounting']],
  ['/finance/assets', ['accounting']], ['/finance/cost-centers', ['accounting']],
  ['/hr', ['hr']],
  ['/approvals', ['approvals']], ['/settings/workflows', ['approvals']],
  ['/history', ['livesync']],
]
export function pageFeatures(path: string): Feature[] {
  const p = path.split('?')[0]
  for (const [prefix, f] of PAGE_FEATURES) if (p === prefix || p.startsWith(`${prefix}/`)) return f
  return []
}

/** Permission modules that belong to a feature (the server refuses them the same way). */
export function moduleAllowed(features: readonly string[] | null | undefined, module: string) {
  if (!features) return true
  const has = (f: Feature) => features.includes(f)
  switch (module) {
    case 'manufacturing': return has('manufacturing') || has('restaurant')
    case 'logistics': return has('logistics')
    case 'hr': case 'payroll': return has('hr')
    case 'ecommerce': case 'oms': return has('ecommerce')
    default: return true
  }
}
