import { useQueryClient } from '@tanstack/react-query'
import * as React from 'react'
import { toast } from 'sonner'
import { useCompany } from '@/app/company-provider'
import type { SearchOption } from '@/components/search-select'
import { t } from '@/i18n'
import { describeError, unwrap } from '@/lib/errors'
import { supabase } from '@/lib/supabase'

/** A business as the Kosovo business register (ARBK) has it. */
export type RegistryBusiness = {
  nui: string; name: string; trade_name: string | null; legal_form: string | null; activity: string | null; city: string | null
  status: string | null; active: boolean; phone: string | null; email: string | null; address: string | null; employees: number | null
}

export async function searchRegistry(q: string): Promise<RegistryBusiness[]> {
  return unwrap(await supabase.rpc('registry_search', { p_q: q, p_limit: 8 })) as unknown as RegistryBusiness[]
}

export const registryHint = (b: RegistryBusiness) =>
  [b.nui, b.city, b.active ? null : (b.status ?? '').split('-')[0]].filter(Boolean).join(' · ')

/** the ARBK page where a person can see the phone, e-mail and owners of a business (their own search, in their browser) */
export const arbkUrl = (_nui: string) => 'https://arbk.rks-gov.net/TableSearch'

/**
 * For a customer or supplier picker: businesses from the register appear under their own heading;
 * picking one adds it as a partner of the company (or finds the one with that NUI) and selects it.
 */
export function useRegistryRemote(role: 'vendor' | 'customer', onPicked: (partnerId: string) => void) {
  const { companyId, can } = useCompany()
  const qc = useQueryClient()
  const allowed = can('partners.write') || can('sales.write') || can('invoicing.write') || can('procurement.write')
  const pickedRef = React.useRef(onPicked)
  pickedRef.current = onPicked
  return React.useMemo(() => !allowed ? undefined : {
    heading: t('From the business register (ARBK)'),
    search: async (q: string): Promise<SearchOption[]> => (await searchRegistry(q)).map((b) => ({
      value: b.nui, label: b.trade_name && b.trade_name.toLowerCase() !== b.name.toLowerCase() ? `${b.name} · ${b.trade_name}` : b.name, hint: registryHint(b),
    })),
    onSelect: (o: SearchOption) => {
      void (async () => {
        try {
          const id = unwrap(await supabase.rpc('partner_from_registry', { p_company: companyId!, p_nui: o.value, p_role: role })) as string
          await qc.invalidateQueries({ predicate: (x) => JSON.stringify(x.queryKey).includes(role === 'vendor' ? 'vendors' : 'customers') || JSON.stringify(x.queryKey).includes('partners') })
          setTimeout(() => pickedRef.current(id), 60)   // after the lists have the new partner
          toast.success(t('{name} added from the business register', { name: o.label }))
        } catch (e) { toast.error(describeError(e)) }
      })()
    },
  }, [allowed, companyId, qc, role])
}

/** a remote list for a picker that only fills a form (it does not add the partner) */
export function registryFill(onPick: (b: RegistryBusiness) => void) {
  let last: RegistryBusiness[] = []
  return {
    heading: t('From the business register (ARBK)'),
    search: async (q: string): Promise<SearchOption[]> => {
      last = await searchRegistry(q)
      return last.map((b) => ({ value: b.nui, label: b.trade_name && b.trade_name.toLowerCase() !== b.name.toLowerCase() ? `${b.name} · ${b.trade_name}` : b.name, hint: registryHint(b) }))
    },
    onSelect: (o: SearchOption) => { const b = last.find((x) => x.nui === o.value); if (b) onPick(b) },
  }
}
