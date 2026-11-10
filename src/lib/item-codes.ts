import { t } from '@/i18n'

/** how an item is told apart after its name, always in this order: its number (shifra), its barcode, its code */
export function itemCodes(v: { item_no?: number | null; barcode?: string | null; sku?: string | null }) {
  return [v.item_no != null ? t('No. {n}|item', { n: v.item_no }) : null, v.barcode || null, v.sku || null].filter(Boolean).join(' · ')
}
