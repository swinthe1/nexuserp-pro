import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useCompany } from '@/app/company-provider'
import type { Json } from '@/lib/database.types'
import { unwrap } from '@/lib/errors'
import { supabase } from '@/lib/supabase'

export interface ReportColumn { key: string; label: string; type: 'money' | 'qty' | 'int' | 'pct' }
export type ReportRow = { _n: number; key: string | null; label: string | null; href: string | null } & Record<string, number | string | null>
export interface ReportResult {
  report: string; from: string; to: string; group_by: string; filters: Record<string, string>
  dims: string[]; columns: ReportColumn[]; rows: ReportRow[]; totals: Record<string, number | null> | null
  pivot_by?: string | null
  /** one cell per row key and column key, when a second grouping was asked */
  pivot?: ({ key: string | null; col: string | null; col_label: string | null } & Record<string, number | string | null>)[] | null
}
export interface ReportParams { from: string; to: string; group_by: string; pivot_by?: string; filters: Record<string, string> }

/** a report as someone set it up; the period is kept relative ("this month") when it was one */
export interface SavedReport {
  id: string; name: string; report: string; is_shared: boolean; owner_id: string
  params: { period?: string; from?: string; to?: string; group_by?: string; pivot_by?: string; measure?: string; trail?: { dim: string; key: string; label: string }[] }
}
export function useSavedReports() {
  const { companyId } = useCompany()
  return useQuery({
    queryKey: ['saved-reports', companyId],
    enabled: !!companyId,
    queryFn: async () => unwrap(await supabase.from('saved_reports').select('id, name, report, params, is_shared, owner_id').eq('company_id', companyId!).order('name')) as unknown as SavedReport[],
  })
}
export function useSaveReport() {
  const { companyId } = useCompany()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (v: { id?: string; name: string; report: string; params: SavedReport['params']; is_shared: boolean }) => v.id
      ? unwrap(await supabase.from('saved_reports').update({ name: v.name, params: v.params as unknown as Json, is_shared: v.is_shared }).eq('id', v.id))
      : unwrap(await supabase.from('saved_reports').insert({ company_id: companyId!, name: v.name, report: v.report, params: v.params as unknown as Json, is_shared: v.is_shared })),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['saved-reports'] }),
  })
}
export function useDeleteReport() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => unwrap(await supabase.from('saved_reports').delete().eq('id', id)),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['saved-reports'] }),
  })
}

export function useReport(key: string, p: ReportParams, enabled = true) {
  const { companyId } = useCompany()
  return useQuery({
    queryKey: ['reports', companyId, key, p],
    enabled: !!companyId && enabled,
    placeholderData: keepPreviousData,
    queryFn: async () => unwrap(await supabase.rpc('run_report', { p_company: companyId, p_report: key, p: p as unknown as Json })) as unknown as ReportResult,
  })
}
