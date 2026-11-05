import { msg } from '@/i18n'

/** the kind of a supplier (one or more), from the meeting with the staff */
export const VENDOR_KINDS: ['goods' | 'expenses' | 'investments', string][] = [['goods', msg('Goods for sale')], ['expenses', msg('Expenses|supplier kind')], ['investments', msg('Investments')]]
