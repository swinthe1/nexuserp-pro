import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { BellRing, Check, TrendingUp } from 'lucide-react'
import * as React from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { formatNumberWith, t, tn } from '@/i18n'
import { describeError, unwrap } from '@/lib/errors'
import { supabase } from '@/lib/supabase'
import { cn, formatDate, formatMoney, num } from '@/lib/utils'

type Rise = { line_no: number; variant_id: string; sku: string; name: string; price: number; before: number; pct: number
  source: 'last_bill' | 'price_list'; ref_date: string | null; ref_number: string | null; accepted: boolean }
type Check = { tolerance: number; rises: Rise[]; can_accept: boolean; accepted_by: string | null; accepted_at: string | null; reason: string | null }

export const PRICE_KEY = 'bill-price'

/** A price rise from the vendor on a draft bill: what went up against the last price paid, and the manager's acceptance */
export function PriceRiseCard({ billId, version, currency }: { billId: string; version?: string | null; currency?: string }) {
  const qc = useQueryClient()
  const q = useQuery({
    queryKey: [PRICE_KEY, billId, version], refetchOnWindowFocus: true,
    queryFn: async () => unwrap(await supabase.rpc('bill_price_check', { p_bill: billId })) as unknown as Check,
  })
  const [open, setOpen] = React.useState(false)
  const ask = useMutation({
    mutationFn: async () => unwrap(await supabase.rpc('bill_ask_price_ok', { p_bill: billId })) as unknown as number,
    onSuccess: (n) => toast.success(n ? tn(n, 'A manager was told', '{n} managers were told') : t('No manager to tell: ask the company admin')),
    onError: (e) => toast.error(describeError(e)),
  })
  const c = q.data
  if (!c || !c.rises.length) return null
  const waiting = c.rises.filter((r) => !r.accepted)
  const pct = (v: number) => `+${formatNumberWith(num(v), { maximumFractionDigits: 1 })}%`
  return (
    <div className={cn('mb-4 rounded-lg border px-4 py-3 text-[13px]', waiting.length ? 'border-warning/50 bg-warning/5' : 'border-border bg-muted/40')}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <span className="flex items-start gap-2">
          <TrendingUp className={cn('mt-0.5 size-4 shrink-0', waiting.length ? 'text-warning' : 'text-muted-foreground')} />
          <span>
            <span className="block font-medium">{waiting.length
              ? tn(waiting.length, 'The vendor raised {n} price: a manager accepts it before the bill is posted', 'The vendor raised {n} prices: a manager accepts them before the bill is posted')
              : t('Price rise accepted by {name}', { name: c.accepted_by ?? '—' })}</span>
            <span className="block text-muted-foreground">{waiting.length
              ? t('Against the last price paid to this vendor, or their price list. Rises up to {pct}% pass on their own.', { pct: formatNumberWith(num(c.tolerance)) })
              : <>{c.accepted_at && formatDate(c.accepted_at, true)} · {c.reason}</>}</span>
          </span>
        </span>
        {waiting.length > 0 && (c.can_accept
          ? <Button size="sm" onClick={() => setOpen(true)}><Check /> {t('Accept the new prices')}</Button>
          : <Button size="sm" variant="outline" loading={ask.isPending} onClick={() => ask.mutate()}><BellRing /> {t('Ask a manager')}</Button>)}
      </div>
      <table className="mt-2 w-full text-[13px]">
        <thead><tr className="text-left text-xs text-muted-foreground">
          <th className="py-1 font-normal">{t('Item')}</th><th className="py-1 text-right font-normal">{t('Before|price')}</th>
          <th className="py-1 text-right font-normal">{t('Now')}</th><th className="py-1 text-right font-normal">{t('Change|difference')}</th>
        </tr></thead>
        <tbody>
          {c.rises.map((r) => (
            <tr key={r.line_no} className="border-t border-border/60">
              <td className="py-1.5 pr-2"><span className="font-medium">{r.name}</span> <span className="text-muted-foreground">{r.sku}</span>
                <span className="block text-xs text-muted-foreground">{r.source === 'last_bill' ? t('Last bill {number}, {date}', { number: r.ref_number ?? '', date: formatDate(r.ref_date) }) : t("The vendor's price list")}</span></td>
              <td className="whitespace-nowrap py-1.5 text-right tabular">{formatMoney(r.before, currency, 4)}</td>
              <td className="whitespace-nowrap py-1.5 text-right tabular">{formatMoney(r.price, currency, 4)}</td>
              <td className={cn('whitespace-nowrap py-1.5 text-right font-medium tabular', r.accepted ? 'text-muted-foreground' : 'text-warning')}>{pct(r.pct)}{r.accepted ? ` · ${t('accepted')}` : ''}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {open && <AcceptDialog billId={billId} rises={waiting} onClose={() => setOpen(false)} onDone={() => void qc.invalidateQueries({ queryKey: [PRICE_KEY, billId] })} />}
    </div>
  )
}

function AcceptDialog({ billId, rises, onClose, onDone }: { billId: string; rises: Rise[]; onClose: () => void; onDone: () => void }) {
  const [reason, setReason] = React.useState('')
  const [list, setList] = React.useState(true)
  const go = useMutation({
    mutationFn: async () => unwrap(await supabase.rpc('bill_accept_prices', { p_bill: billId, p_reason: reason.trim(), p_update_list: list })),
    onSuccess: () => { toast.success(t('The new prices are accepted; the bill can be posted')); onDone(); onClose() },
    onError: (e) => toast.error(describeError(e)),
  })
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t('Accept the new prices?')}</DialogTitle>
          <DialogDescription>{tn(rises.length, '{n} item costs more than before. Your name and the reason are kept on the bill.', '{n} items cost more than before. Your name and the reason are kept on the bill.')}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-1.5">
          <Label htmlFor="pr-reason">{t('Why')}</Label>
          <Textarea id="pr-reason" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} placeholder={t('e.g. The vendor raised prices from 1 November, confirmed by email')} />
        </div>
        <label className="flex items-start gap-2 text-[13px]">
          <Checkbox checked={list} onCheckedChange={(v) => setList(v === true)} className="mt-0.5" />
          <span>{t("Make them the vendor's prices for the next orders")}</span>
        </label>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{t('Cancel')}</Button>
          <Button loading={go.isPending} disabled={reason.trim().length < 5} onClick={() => go.mutate()}><Check /> {t('Accept')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
