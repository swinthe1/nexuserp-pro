import { Badge } from '@/components/ui/badge'
import { msg, t } from '@/i18n'

/** a goods receipt and its supplier's invoice (from the meeting with the staff, #4) */
export type FiscalStatus = 'pending_invoice' | 'tax_invoice_received' | 'other_document' | 'internal_movement'
export const FISCAL_STATUS: Record<FiscalStatus, string> = {
  pending_invoice: msg('Waiting for the invoice'),
  tax_invoice_received: msg('Tax invoice received'),
  other_document: msg('Billed outside the VAT book'),
  internal_movement: msg('Internal movement'),
}
const TONE: Record<FiscalStatus, 'warning' | 'success' | 'secondary' | 'outline'> = {
  pending_invoice: 'warning', tax_invoice_received: 'success', other_document: 'secondary', internal_movement: 'outline',
}

export function FiscalBadge({ status }: { status: string | null | undefined }) {
  if (!status || !(status in FISCAL_STATUS)) return <span className="text-muted-foreground">—</span>
  return <Badge variant={TONE[status as FiscalStatus]}>{t(FISCAL_STATUS[status as FiscalStatus])}</Badge>
}
