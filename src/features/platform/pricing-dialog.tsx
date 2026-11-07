import { useMutation, useQuery } from '@tanstack/react-query'
import * as React from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { t } from '@/i18n'
import { describeError, unwrap } from '@/lib/errors'
import { supabase } from '@/lib/supabase'
import { planLabel } from './dialogs'

type Row = { plan: string; package?: boolean; price_month: number | null; price_year: number | null; per_user: number | null; users: number; highlight: boolean; note: string | null }
type Contact = { email: string | null; phone: string | null; whatsapp: string | null; currency: string; vat_note: string | null }

/** The prices the public page /cmimet shows. Empty price: "on offer". */
export function PricingDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const q = useQuery({ queryKey: ['public-pricing'], enabled: open, queryFn: async () => unwrap(await supabase.rpc('public_pricing')) as unknown as { plans: Row[]; contact: Contact } })
  const [plans, setPlans] = React.useState<Row[]>([])
  const [contact, setContact] = React.useState<Contact | null>(null)
  React.useEffect(() => { if (q.data) { setPlans(q.data.plans); setContact(q.data.contact) } }, [q.data])
  const save = useMutation({
    mutationFn: async () => unwrap(await supabase.rpc('platform_pricing_save', { p: { plans, contact } as never })),
    onSuccess: () => { toast.success(t('Saved')); void q.refetch(); onOpenChange(false) },
    onError: (e) => toast.error(describeError(e)),
  })
  const set = (i: number, p: Partial<Row>) => setPlans((x) => x.map((r, j) => (j === i ? { ...r, ...p } : r)))
  const n = (v: string) => (v === '' ? null : Number(v))
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader><DialogTitle>{t('Prices')}</DialogTitle>
          <DialogDescription>{t('The price of each package and of the older plans, without VAT. Only you see them; a package without a price counts as on offer.')}</DialogDescription></DialogHeader>
        <div className="grid max-h-[60vh] gap-3 overflow-y-auto pr-1">
          {plans.map((p, i) => (
            <div key={p.plan} className="grid items-end gap-2 rounded-lg border p-3 sm:grid-cols-[90px_repeat(4,minmax(0,1fr))_auto]">
              <div className="text-sm font-semibold">{p.package ? planLabel('package', p.plan) : planLabel(p.plan)}</div>
              <div className="grid gap-1"><Label className="text-xs">{t('A month')}</Label><Input type="number" step="0.01" value={p.price_month ?? ''} onChange={(e) => set(i, { price_month: n(e.target.value) })} /></div>
              <div className="grid gap-1"><Label className="text-xs">{t('A year')}</Label><Input type="number" step="0.01" value={p.price_year ?? ''} onChange={(e) => set(i, { price_year: n(e.target.value) })} /></div>
              <div className="grid gap-1"><Label className="text-xs">{t('Users included')}</Label><Input type="number" min={1} value={p.users} onChange={(e) => set(i, { users: Number(e.target.value) || 1 })} /></div>
              <div className="grid gap-1"><Label className="text-xs">{t('Each more user')}</Label><Input type="number" step="0.01" value={p.per_user ?? ''} onChange={(e) => set(i, { per_user: n(e.target.value) })} /></div>
              <label className="flex items-center gap-2 pb-2 text-xs">{t('Most chosen')}<Switch checked={p.highlight} onCheckedChange={(v) => set(i, { highlight: v })} /></label>
              <Input className="sm:col-span-6" value={p.note ?? ''} onChange={(e) => set(i, { note: e.target.value })} placeholder={t('A line under the plan (optional)')} aria-label={t('Note')} />
            </div>
          ))}
          {contact && <div className="grid gap-2 sm:grid-cols-2">
            <div className="grid gap-1"><Label className="text-xs">{t('Email for offers')}</Label><Input type="email" value={contact.email ?? ''} onChange={(e) => setContact({ ...contact, email: e.target.value })} /></div>
            <div className="grid gap-1"><Label className="text-xs">{t('Phone')}</Label><Input value={contact.phone ?? ''} onChange={(e) => setContact({ ...contact, phone: e.target.value })} /></div>
            <div className="grid gap-1"><Label className="text-xs">WhatsApp</Label>{/* i18n-ignore */}<Input value={contact.whatsapp ?? ''} onChange={(e) => setContact({ ...contact, whatsapp: e.target.value })} placeholder="+383…" /></div>
            <div className="grid gap-1"><Label className="text-xs">{t('A line under the prices')}</Label><Input value={contact.vat_note ?? ''} onChange={(e) => setContact({ ...contact, vat_note: e.target.value })} placeholder={t('e.g. Prices without VAT. Setup and training on offer.')} /></div>
          </div>}
        </div>
        <DialogFooter><Button variant="ghost" onClick={() => onOpenChange(false)}>{t('Cancel')}</Button><Button loading={save.isPending} onClick={() => save.mutate()}>{t('Save')}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
