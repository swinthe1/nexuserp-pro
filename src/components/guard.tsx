import { ChevronDown, ShieldCheck, TriangleAlert } from 'lucide-react'
import * as React from 'react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { msg, t } from '@/i18n'
import { supabase } from '@/lib/supabase'
import { formatDate, formatMoney } from '@/lib/utils'

/*
 * The guard ("Kujdestari"): before an invoice is posted, the server compares it with the company's own
 * history (public.document_checks) and this dialog says, in plain words, what looks unusual and why it
 * matters. It never blocks: the person checks and decides. What they wave through is kept (guard_ack).
 */

export type GuardKind = 'vendor_bill' | 'sales_invoice'
type Finding = { code: string; level: 'warn'; line?: number; params: Record<string, string | number> }

/** what each finding says, and the short lesson behind "Why?" */
const TEXT: Record<string, { title: string; why: string }> = {
  qty_unusual: { title: msg('Line {line}: {qty} of {item}. Usually it is about {usual}.'),
    why: msg('One zero too many is the most common typing mistake. It changes the stock, the cost and the total of the invoice. If the quantity is right, go on.') },
  price_zero: { title: msg('Line {line}: {item} has no price.'),
    why: msg('A line at zero goes into the books at zero: the stock comes in without value, or the goods leave for free. Write the price, or go on if it really is free.') },
  price_jump: { title: msg('Line {line}: {item} at {price} without VAT. Last time it was {last} ({pct}%).'),
    why: msg('A price much higher or lower than the last purchase is often a typing mistake or the price of another unit (a box instead of a piece). The cost of the item will follow this price.') },
  below_cost: { title: msg('Line {line}: {item} is sold at {price} without VAT, but it cost {cost} without VAT.'),
    why: msg('Selling under cost means a loss on every piece. Sometimes it is meant (a promotion, old goods); often a wrong price or a discount too big.') },
  price_differs: { title: msg('Line {line}: {item} at {price} without VAT. Its price is {list} without VAT ({pct}%).'),
    why: msg('The price is far from the item’s own price. Check that it is the price of the right unit and that the discount is right.') },
  vat_differs: { title: msg('Line {line}: {item} has VAT {rate}%. Last time it was {usual}%.'),
    why: msg('The same item usually has the same VAT. A wrong rate goes wrong into the VAT book and the declaration.') },
  date_future: { title: msg('The date of the invoice is in the future: {date}.'),
    why: msg('The date decides the month of the VAT book. A wrong year or month is a common mistake.') },
  vat_declared: { title: msg('The VAT of {date}’s month is already declared.'),
    why: msg('This invoice goes into a month that is already declared to the tax office. The declaration will have to be corrected, or the invoice should get a date in the open month.') },
  vendor_no_nui: { title: msg('{partner} has no NUI.'),
    why: msg('Without the supplier’s NUI the purchase book is incomplete and the VAT may not be deducted. Add it on the supplier’s card (the register finds it by name).') },
  customer_no_nui: { title: msg('{partner} is a business without a NUI.'),
    why: msg('A business customer needs its NUI on the invoice and in the sales book. Add it on the customer’s card (the register finds it by name).') },
  same_total: { title: msg('There is already {number} for the same partner with the same total ({total} with VAT).'),
    why: msg('The same invoice entered twice doubles the debt, the stock and the VAT. If it is a different invoice, go on.') },
}

function render(f: Finding) {
  const p = { ...f.params, line: f.line ?? '' } as Record<string, string | number>
  if (typeof p.date === 'string') p.date = formatDate(p.date)
  for (const k of ['price', 'last', 'cost', 'list', 'total']) if (p[k] != null) p[k] = formatMoney(Number(p[k]))
  const x = TEXT[f.code]
  return { title: x ? t(x.title, p) : f.code, why: x ? t(x.why) : '' }
}

type Pending = { kind: GuardKind; id: string; findings: Finding[]; resolve: (ok: boolean) => void }
// one guard for the whole app: the page that asked may be re-drawn while the dialog is open (its draft was just saved)
let pending: Pending | null = null
const listeners = new Set<() => void>()
const emit = () => { for (const l of listeners) l() }

/** true to go on (nothing found, or the person read and went on), false to stay and fix */
export async function guardCheck(kind: GuardKind, id: string): Promise<boolean> {
  let findings: Finding[] = []
  try {
    const { data, error } = await supabase.rpc('document_checks', { p_kind: kind, p_id: id })
    if (error) return true                      // offline or not saved yet: the posting itself still checks the rules
    findings = (data ?? []) as unknown as Finding[]
  } catch { return true }
  if (!findings.length) return true
  pending?.resolve(false)
  return new Promise<boolean>((resolve) => { pending = { kind, id, findings, resolve }; emit() })
}

export function useGuard() {
  return { check: guardCheck, dialog: null as React.ReactNode }
}

/** mounted once in the app layout */
export function GuardHost() {
  const [, force] = React.useReducer((x: number) => x + 1, 0)
  React.useEffect(() => { listeners.add(force); return () => { listeners.delete(force) } }, [])
  if (!pending) return null
  const p = pending
  const close = (ok: boolean) => {
    if (ok) void supabase.rpc('guard_ack', { p_kind: p.kind, p_id: p.id, p_codes: p.findings.map((f) => f.code) })
    pending = null; emit(); p.resolve(ok)
  }
  return <GuardDialog key={p.id + p.findings.length} findings={p.findings} onClose={close} />
}

function GuardDialog({ findings, onClose }: { findings: Finding[]; onClose: (ok: boolean) => void }) {
  const [open, setOpen] = React.useState<number | null>(findings.length === 1 ? 0 : null)
  return (
    <Dialog open onOpenChange={(o) => !o && onClose(false)}>
      {/* opened from another dialog (the post confirmation): only its own buttons or Esc close it */}
      <DialogContent className="max-w-lg" onInteractOutside={(e) => e.preventDefault()} onFocusOutside={(e) => e.preventDefault()}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><ShieldCheck className="size-5 text-warning" /> {t('Check before posting')}</DialogTitle>
          <DialogDescription>{findings.length === 1 ? t('One thing looks unusual compared with your earlier invoices.') : t('{n} things look unusual compared with your earlier invoices.', { n: findings.length })}</DialogDescription>
        </DialogHeader>
        <ul className="grid gap-2">
          {findings.map((f, i) => {
            const r = render(f)
            return (
              <li key={i} className="rounded-lg border border-warning/30 bg-warning/5">
                <button type="button" onClick={() => setOpen(open === i ? null : i)} aria-expanded={open === i}
                  className="flex w-full items-start gap-2.5 px-3 py-2.5 text-left">
                  <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warning" />
                  <span className="flex-1 text-sm font-medium">{r.title}</span>
                  <span className="flex shrink-0 items-center gap-0.5 text-xs text-muted-foreground">{t('Why?')}<ChevronDown className={open === i ? 'size-3.5 rotate-180' : 'size-3.5'} /></span>
                </button>
                {open === i && r.why && <p className="px-3 pb-3 pl-9 text-[13px] text-muted-foreground">{r.why}</p>}
              </li>
            )
          })}
        </ul>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => onClose(false)}>{t('Go back and fix it')}</Button>
          <Button onClick={() => onClose(true)}>{t('I checked, post it')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
