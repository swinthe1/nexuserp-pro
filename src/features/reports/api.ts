import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { useCompany } from '@/app/company-provider'
import type { Json } from '@/lib/database.types'
import { unwrap } from '@/lib/errors'
import { supabase } from '@/lib/supabase'

export interface ReportColumn { key: string; label: string; type: 'money' | 'qty' | 'int' | 'pct' }
export type ReportRow = { _n: number; key: string | null; label: string | null; href: string | null } & Record<string, number | string | null>
export interface ReportResult {
  report: string; from: string; to: string; group_by: string; filters: Record<string, string>
  dims: string[]; columns: ReportColumn[]; rows: ReportRow[]; totals: Record<string, number | null> | null
}
export interface ReportParams { from: string; to: string; group_by: string; filters: Record<string, string> }

export function useReport(key: string, p: ReportParams, enabled = true) {
  const { companyId } = useCompany()
  return useQuery({
    queryKey: ['reports', companyId, key, p],
    enabled: !!companyId && enabled,
    placeholderData: keepPreviousData,
    queryFn: async () => unwrap(await supabase.rpc('run_report', { p_company: companyId, p_report: key, p: p as unknown as Json })) as unknown as ReportResult,
  })
}
