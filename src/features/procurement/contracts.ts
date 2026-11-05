import { t } from '@/i18n'
import { formatMoney, num } from '@/lib/utils'

export type Contract = { id: string; vendor_id: string; number: string; title: string | null; start_date: string; end_date: string | null
  payment_days: number | null; rebate_pct: number | null; rebate_terms: string | null; delivery_days: number | null; min_order: number | null
  returns_expired: boolean; returns_terms: string | null; other_terms: string | null; file_path: string | null; file_name: string | null
  remind_days: number; status: 'draft' | 'active' | 'ended'; notes: string | null }

/** the terms of a contract in one line (the contracts list and the purchase invoice) */
export function contractTerms(c: Pick<Contract, 'payment_days' | 'rebate_pct' | 'delivery_days' | 'returns_expired' | 'min_order'>) {
  return [c.payment_days != null && t('payment in {n} days', { n: c.payment_days }), c.rebate_pct != null && t('rebate {pct}%', { pct: num(c.rebate_pct) }),
    c.delivery_days != null && t('delivery in {n} days', { n: c.delivery_days }), c.min_order != null && t('minimum order {amount}', { amount: formatMoney(num(c.min_order)) }),
    c.returns_expired && t('takes back expired goods')].filter(Boolean).join(' · ')
}

