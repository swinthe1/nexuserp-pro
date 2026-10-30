import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { useCompany } from '@/app/company-provider'
import type { Tables } from '@/lib/database.types'
import { describeError, unwrap } from '@/lib/errors'
import { supabase } from '@/lib/supabase'

export type LoyaltyKind = 'discount' | 'points' | 'staff'
export type Program = Tables<'loyalty_programs'>
export type Card = Tables<'loyalty_cards'> & { program: { name: string; kind: string } | null }
export type LedgerRow = Tables<'loyalty_ledger'> & { order: { number: string } | null; warehouse: { name: string } | null }

const key = (c: string) => ['loyalty', c] as const

function useInvalidate() {
  const qc = useQueryClient()
  const { companyId } = useCompany()
  return () => qc.invalidateQueries({ queryKey: key(companyId) })
}
function useAction<A, R>(fn: (a: A) => Promise<R>) {
  const invalidate = useInvalidate()
  return useMutation({ mutationFn: fn, onSuccess: () => void invalidate(), onError: (e) => toast.error(describeError(e)) })
}

export function usePrograms() {
  const { companyId } = useCompany()
  return useQuery({
    queryKey: [...key(companyId), 'programs'],
    enabled: !!companyId,
    queryFn: async () => unwrap(await supabase.from('loyalty_programs').select('*').eq('company_id', companyId).is('deleted_at', null).order('name')),
  })
}

export function useCards() {
  const { companyId } = useCompany()
  return useQuery({
    queryKey: [...key(companyId), 'cards'],
    enabled: !!companyId,
    queryFn: async () => unwrap(await supabase.from('loyalty_cards').select('*, program:loyalty_programs(name, kind)')
      .eq('company_id', companyId).is('deleted_at', null).order('created_at', { ascending: false }).limit(20000).returns<Card[]>()),
  })
}

export function useCardHistory(cardId: string | null) {
  const { companyId } = useCompany()
  return useQuery({
    queryKey: [...key(companyId), 'history', cardId],
    enabled: !!companyId && !!cardId,
    queryFn: async () => unwrap(await supabase.from('loyalty_ledger').select('*, order:pos_orders(number), warehouse:warehouses(name)')
      .eq('card_id', cardId!).order('occurred_at', { ascending: false }).limit(200).returns<LedgerRow[]>()),
  })
}

export interface LoyaltyOverview {
  cards_active: number; cards_used: number; discount: number; points_earned: number; points_redeemed: number
  points_outstanding: number; points_outstanding_value: number; card_sales: number; all_sales: number
  by_store: { name: string; discount: number | null; receipts: number }[]
  by_program: { name: string; discount: number | null; cards: number }[]
  top_customers: { id: string; holder_name: string; card_number: string; spent: number; receipts: number; last_at: string }[]
}
export function useLoyaltyOverview(from: string, to: string) {
  const { companyId } = useCompany()
  return useQuery({
    queryKey: [...key(companyId), 'overview', from, to],
    enabled: !!companyId,
    queryFn: async () => unwrap(await supabase.rpc('loyalty_overview', { p_company: companyId, p_from: from, p_to: to })) as unknown as LoyaltyOverview,
  })
}

export interface ProgramInput {
  id?: string; name: string; kind: LoyaltyKind; discount_pct: number; points_per_unit: number; point_value: number; min_redeem_points: number
  monthly_limit: number | null; excluded_category_ids: string[]; warehouse_ids: string[]; valid_from: string | null; valid_until: string | null
  is_active: boolean; description: string | null
}
export function useSaveProgram() {
  const { companyId } = useCompany()
  return useAction(async (v: ProgramInput) => unwrap(await supabase.rpc('loyalty_save_program', { p: { ...v, company_id: companyId } as never })) as unknown as string)
}

export interface CardInput { program_id: string; holder_name: string; phone?: string; email?: string; card_number?: string; notes?: string }
export function useIssueCard() {
  const { companyId } = useCompany()
  return useAction(async (v: CardInput) => unwrap(await supabase.rpc('loyalty_issue_card', { p: { ...v, company_id: companyId } as never })) as unknown as { id: string; card_number: string })
}
export function useUpdateCard() {
  return useAction(async (v: { id: string; patch: Record<string, string | null> }) => unwrap(await supabase.rpc('loyalty_update_card', { p_card: v.id, p: v.patch as never })))
}
export function useAdjustPoints() {
  return useAction(async (v: { id: string; points: number; note: string }) => unwrap(await supabase.rpc('loyalty_adjust_points', { p_card: v.id, p_points: v.points, p_note: v.note })))
}

/* ------------------------------------------------------------------ the till */
export interface TillProgram {
  id: string; name: string; kind: LoyaltyKind; discount_pct: number; points_per_unit: number; point_value: number; min_redeem_points: number
  monthly_limit: number | null; valid_from: string | null; valid_until: string | null; applies_here: boolean; excluded_categories: string[]
}
/** [id, number, phone key, holder, program id, points, discount used this month] */
export type TillCardRow = [string, string, string | null, string, string, number, number]
export interface TillLoyalty { programs: TillProgram[]; cards: TillCardRow[] }

export interface Quote {
  usable: boolean; reason?: string; card_id: string; program_id: string; kind: LoyaltyKind; program_pct: number; pct: number
  redeem_points: number; redeem_amount: number; lines: { eligible: boolean; pct: number }[]; month_left: number | null
  card_number: string; holder_name: string; points_balance: number; program_name: string; point_value: number; points_per_unit: number; min_redeem_points: number
}
export async function quoteLoyalty(registerId: string, code: string, lines: { variant_id: string; quantity: number; unit_price: number; manual_pct: number }[], redeem = 0) {
  return unwrap(await supabase.rpc('loyalty_quote', { p_register: registerId, p_code: code, p_lines: lines as never, p_redeem: redeem })) as unknown as Quote
}

/** same rule as the server (app.phone_key): +383 44 123 456 = 044 123 456 */
export function phoneKey(v: string) {
  return v.replace(/\D/g, '').replace(/^(00)?(383|355)/, '').replace(/^0+/, '') || null
}

/** Points still owed to customers, and what the books hold for them (account 4191). */
export function useLoyaltyLiability() {
  const { companyId } = useCompany()
  return useQuery({
    queryKey: ['loyalty', companyId, 'liability'],
    enabled: !!companyId,
    queryFn: async () => unwrap(await supabase.rpc('loyalty_liability', { p_company: companyId })) as unknown as { points: number; value: number; booked: number },
  })
}
