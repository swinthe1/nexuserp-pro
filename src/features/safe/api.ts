import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { useCompany } from '@/app/company-provider'
import { describeError, unwrap } from '@/lib/errors'
import { supabase } from '@/lib/supabase'
import type { Json } from '@/lib/database.types'

export type SafeKind = 'deposit' | 'withdrawal' | 'expense' | 'transfer' | 'cash_in'

export type Safe = {
  id: string; name: string; is_active: boolean; warehouse_id: string | null; warehouse: string | null
  holder_id: string | null; holder: string | null; approval_limit: number; dual_limit: number | null; tolerance: number; max_balance: number | null
  account_code: string | null; balance: number; today_in: number; today_out: number; tills: string[]
  last_count: { at: string; difference: number; total: number; by: string | null } | null
}
export type Waiting = { id: string; number: string; kind: SafeKind; amount: number; reason: string; safe: string; created_at: string; mine: boolean; by: string | null }
export type Handover = { id: string; safe_id: string; safe: string; from: string | null; to: string | null; created_at: string; to_me: boolean; from_me: boolean }
export type SafePerson = { member_id: string; user_id: string; name: string; has_pin: boolean }
export type OnTheWay = { id: string; number: string; amount: number; reason: string; moved_on: string; reference: string | null; safe: string; bank: string | null }
export type SafesOverview = {
  can: { move: boolean; approve: boolean; setup: boolean }
  cash_box_free: boolean
  safes: Safe[]; waiting: Waiting[]; on_the_way: OnTheWay[]; handovers: Handover[]; people: SafePerson[]
  banks: { id: string; name: string }[]
  expense_accounts: { id: string; code: string; name: string }[]
  tills: { id: string; name: string; safe_id: string | null; warehouse_id: string }[]
  currency: string; pieces: number[]
}
export type BookLine = {
  date: string; reference: string | null; memo: string | null; in: number; out: number; balance: number
  source_type: string | null; source_id: string | null; entry_id: string; kind: SafeKind | 'till' | 'count' | 'other'; by: string | null
}
export type SafeBook = { opening: number; closing: number; lines: BookLine[] }

export const safeKeys = { all: (co: string | null) => ['safe', co] as const }

export function useSafes() {
  const { companyId } = useCompany()
  return useQuery({
    queryKey: [...safeKeys.all(companyId), 'overview'], enabled: !!companyId, refetchInterval: 60_000,
    queryFn: async () => unwrap(await supabase.rpc('safes_overview', { p_company: companyId! })) as unknown as SafesOverview,
  })
}

export function useSafeBook(safe: string | null, from: string, to: string) {
  const { companyId } = useCompany()
  return useQuery({
    queryKey: [...safeKeys.all(companyId), 'book', safe, from, to], enabled: !!safe,
    queryFn: async () => unwrap(await supabase.rpc('safe_book', { p_safe: safe!, p_from: from, p_to: to })) as unknown as SafeBook,
  })
}

/** every safe action refreshes the safe screen; errors are shown where the dialog is */
function useSafeMutation<V, R>(fn: (v: V) => Promise<R>, opts?: { toastErrors?: boolean }) {
  const qc = useQueryClient()
  const { companyId } = useCompany()
  return useMutation({
    mutationFn: fn,
    onSuccess: () => { void qc.invalidateQueries({ queryKey: safeKeys.all(companyId) }) },
    // dialogs show their own error next to the fields
    onError: opts?.toastErrors ? (e) => toast.error(describeError(e)) : () => {},
  })
}

export type MoveInput = { safe_id: string; kind: SafeKind; amount: number; reason: string; to_safe_id?: string; bank_account_id?: string; account_id?: string; reference?: string; witness?: string }
export const useSafeMove = () => useSafeMutation(async (v: MoveInput) =>
  unwrap(await supabase.rpc('safe_move', { p: v as unknown as Json })) as unknown as { id: string; number: string; status: 'pending' | 'posted' | 'in_transit' })

export const useSafeCount = () => useSafeMutation(async (v: { safe: string; counts: Record<string, number>; note?: string }) =>
  unwrap(await supabase.rpc('safe_count', { p_safe: v.safe, p_counts: v.counts as unknown as Json, p_note: v.note ?? null as unknown as string })) as unknown as
    { number: string; total: number; expected: number; difference: number })

export const useSafeDecide = () => useSafeMutation(async (v: { id: string; approve: boolean; note?: string }) =>
  unwrap(await supabase.rpc('safe_decide', { p_id: v.id, p_approve: v.approve, p_note: v.note ?? null as unknown as string })))

export const useSafeCancel = () => useSafeMutation(async (id: string) => unwrap(await supabase.rpc('safe_cancel', { p_id: id })), { toastErrors: true })

export const useDepositArrived = () => useSafeMutation(async (v: { id: string; on?: string }) =>
  unwrap(await supabase.rpc('safe_deposit_arrived', { p_id: v.id, p_on: v.on ?? null as unknown as string })), { toastErrors: true })

export type SafeInput = { company_id: string; id?: string; name: string; warehouse_id: string | null; holder_id: string | null; approval_limit: number; dual_limit: number | null; tolerance: number; max_balance: number | null; is_active?: boolean; main?: boolean }
export const useSafeSave = () => useSafeMutation(async (v: SafeInput) => unwrap(await supabase.rpc('safe_save', { p: v as unknown as Json })) as unknown as string)

export const useTillSafe = () => useSafeMutation(async (v: { register: string; safe: string | null }) =>
  unwrap(await supabase.rpc('pos_register_set_safe', { p_register: v.register, p_safe: v.safe as string })), { toastErrors: true })

/** the second person types their PIN; a wrong PIN comes back as { error } */
export async function safeWitness(company: string, member: string, pin: string) {
  return unwrap(await supabase.rpc('safe_witness', { p_company: company, p_member: member, p_pin: pin })) as unknown as { token?: string; error?: string }
}

export type CountResult = { number: string; total: number; expected: number; difference: number }

export const useHandoverStart = () => useSafeMutation(async (v: { safe: string; to: string; counts: Record<string, number>; note?: string }) =>
  unwrap(await supabase.rpc('safe_handover_start', { p_safe: v.safe, p_to: v.to, p_counts: v.counts as unknown as Json, p_note: v.note ?? null as unknown as string })) as unknown as string)

export const useHandoverAccept = () => useSafeMutation(async (v: { id: string; counts: Record<string, number>; note?: string }) =>
  unwrap(await supabase.rpc('safe_handover_accept', { p_id: v.id, p_counts: v.counts as unknown as Json, p_note: v.note ?? null as unknown as string })) as unknown as
    { given: number; taken: number; difference: number })

export const useHandoverDecline = () => useSafeMutation(async (v: { id: string; note?: string }) =>
  unwrap(await supabase.rpc('safe_handover_decline', { p_id: v.id, p_note: v.note ?? null as unknown as string })), { toastErrors: true })
