import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ImageUp, Save, Trash2 } from 'lucide-react'
import * as React from 'react'
import { toast } from 'sonner'
import { useCompany } from '@/app/company-provider'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { msg, t } from '@/i18n'
import { PRINT_DEFAULTS, type PrintDoc, type PrintSettings } from '@/lib/documents/model'
import { renderDocHtml } from '@/lib/documents/render-html'
import { describeError, unwrap } from '@/lib/errors'
import { supabase } from '@/lib/supabase'
import { cn, todayISO } from '@/lib/utils'
import type { Json } from '@/lib/database.types'

const COLOURS = ['#1f3a8a', '#0f766e', '#7c2d12', '#6d28d9', '#be123c', '#111827']
const TEXTS: { key: string; label: string; hint: string }[] = [
  { key: 'sales_invoice', label: msg('Invoice'), hint: msg('e.g. Payment within 15 days to the account below. Thank you!') },
  { key: 'sales_quote', label: msg('Offer'), hint: msg('e.g. Prices are valid 15 days; delivery within 3 working days.') },
  { key: 'proforma', label: msg('Pro forma invoice'), hint: msg('e.g. The goods are delivered once the payment arrives.') },
  { key: 'delivery', label: msg('Delivery note'), hint: msg('e.g. Check the goods when you receive them; complaints within 24 hours.') },
  { key: 'purchase_order', label: msg('Purchase order'), hint: msg('e.g. Please confirm the order and the delivery date.') },
  { key: 'payment', label: msg('Cash receipt / payment voucher'), hint: '' },
]

type Company = PrintDoc['company']

/** How printed documents look: logo, colour, what they show and a text for each kind; with a live preview. */
export function PrintSettingsCard() {
  const { companyId, can } = useCompany()
  const qc = useQueryClient()
  const ro = !can('admin.write')
  const co = useQuery({
    queryKey: ['print-company', companyId], enabled: !!companyId,
    queryFn: async () => unwrap(await supabase.rpc('print_company_preview', { p_company: companyId! })) as unknown as Company,
  })
  const [s, setS] = React.useState<PrintSettings | null>(null)
  const [logo, setLogo] = React.useState<string | null | undefined>(undefined)   // undefined = unchanged
  const [stamp, setStamp] = React.useState<string | null | undefined>(undefined)
  React.useEffect(() => { if (co.data && !s) setS({ ...PRINT_DEFAULTS, ...(co.data.settings ?? {}) }) }, [co.data]) // eslint-disable-line react-hooks/exhaustive-deps
  const save = useMutation({
    mutationFn: async () => {
      unwrap(await supabase.rpc('print_settings_save', { p_company: companyId!, p_settings: s as unknown as Json, p_logo: logo ?? undefined, p_clear_logo: logo === null }))
      if (stamp !== undefined) unwrap(await supabase.rpc('print_stamp_save', { p_company: companyId!, p_stamp: (stamp ?? null) as string, p_clear: stamp === null }))
    },
    onSuccess: () => { setLogo(undefined); setStamp(undefined); void qc.invalidateQueries({ queryKey: ['print-company', companyId] }); toast.success(t('Saved')) },
    onError: (e) => toast.error(describeError(e)),
  })
  const fileRef = React.useRef<HTMLInputElement>(null)
  const stampRef = React.useRef<HTMLInputElement>(null)
  const pickStamp = async (f: File | undefined) => {
    if (!f) return
    try { setStamp(await shrinkImage(f)) } catch { toast.error(t('This file is not a picture')) }
  }
  const pick = async (f: File | undefined) => {
    if (!f) return
    try { setLogo(await shrinkImage(f)) } catch { toast.error(t('This file is not a picture')) }
  }
  if (!co.data || !s) return null
  const set = (patch: Partial<PrintSettings>) => setS((x) => ({ ...x!, ...patch }))
  const curStamp = stamp === undefined ? co.data.stamp ?? null : stamp
  const sample = sampleDoc({ ...co.data, logo: logo === undefined ? co.data.logo : logo, stamp: curStamp, settings: s })
  const { body, css } = renderDocHtml(sample)
  const dirty = logo !== undefined || stamp !== undefined || JSON.stringify(s) !== JSON.stringify({ ...PRINT_DEFAULTS, ...(co.data.settings ?? {}) })

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_540px]">
      <Card>
        <CardHeader><CardTitle>{t('Printed documents')}</CardTitle>
          <CardDescription>{t('Invoices, offers, pro formas, delivery notes, purchase orders, receipts and payment vouchers are printed, saved as PDF and emailed with this look.')}</CardDescription></CardHeader>
        <CardContent className="grid gap-5">
          <div className="grid gap-2">
            <Label>{t('Logo')}</Label>
            <div className="flex flex-wrap items-center gap-3">
              <div className="grid h-16 w-40 place-items-center overflow-hidden rounded-md border bg-white">
                {(logo === undefined ? co.data.logo : logo) ? <img src={(logo === undefined ? co.data.logo : logo)!} alt="" className="max-h-14 max-w-36 object-contain" />
                  : <span className="text-[12px] text-muted-foreground">{t('No logo')}</span>}
              </div>
              <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" className="hidden" onChange={(e) => void pick(e.target.files?.[0])} />
              <Button variant="outline" size="sm" disabled={ro} onClick={() => fileRef.current?.click()}><ImageUp /> {t('Choose a picture')}</Button>
              {(logo === undefined ? co.data.logo : logo) && <Button variant="ghost" size="sm" disabled={ro} onClick={() => setLogo(null)}><Trash2 /> {t('Remove')}</Button>}
            </div>
            <div className="flex items-center gap-2 text-sm">
              <Label className="font-normal text-muted-foreground">{t('Logo on the')}</Label>
              <Select value={s.logo_position ?? 'left'} onValueChange={(v) => set({ logo_position: v as 'left' | 'right' })} disabled={ro}>
                <SelectTrigger className="h-8 w-32" aria-label={t('Logo on the')}><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="left">{t('left')}</SelectItem><SelectItem value="right">{t('right')}</SelectItem></SelectContent>
              </Select>
              <Label className="ml-2 font-normal text-muted-foreground">{t('Size')}</Label>
              <div className="flex rounded-md border p-0.5" role="radiogroup" aria-label={t('Size of the logo')}>
                {(['s', 'm', 'l'] as const).map((z) => (
                  <button key={z} type="button" role="radio" aria-checked={(s.logo_size ?? 'm') === z} disabled={ro} onClick={() => set({ logo_size: z })}
                    className={cn('h-7 w-8 rounded text-xs font-medium uppercase', (s.logo_size ?? 'm') === z ? 'bg-secondary text-foreground' : 'text-muted-foreground')}>{z}</button>
                ))}
              </div>
            </div>
          </div>
          <div className="grid gap-2">
            <Label>{t('Stamp and signature')}</Label>
            <div className="flex flex-wrap items-center gap-3">
              <div className="grid h-16 w-40 place-items-center overflow-hidden rounded-md border bg-white">
                {curStamp ? <img src={curStamp} alt="" className="max-h-14 max-w-36 object-contain" /> : <span className="text-[12px] text-muted-foreground">{t('No stamp')}</span>}
              </div>
              <input ref={stampRef} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={(e) => void pickStamp(e.target.files?.[0])} />
              <Button variant="outline" size="sm" disabled={ro} onClick={() => stampRef.current?.click()}><ImageUp /> {t('Choose a picture')}</Button>
              {curStamp && <Button variant="ghost" size="sm" disabled={ro} onClick={() => setStamp(null)}><Trash2 /> {t('Remove')}</Button>}
            </div>
            <p className="text-[12px] text-muted-foreground">{t('A photo or scan of the stamp with the signature, on a white background. It is printed over the line of the issuer.')}</p>
          </div>
          <div className="grid gap-2">
            <Label>{t('Colour')}</Label>
            <div className="flex flex-wrap items-center gap-2">
              {COLOURS.map((c) => (
                <button key={c} type="button" disabled={ro} onClick={() => set({ accent: c })} aria-label={c} aria-pressed={s.accent === c}
                  className={cn('size-8 rounded-full border-2', s.accent === c ? 'border-foreground' : 'border-transparent')} style={{ background: c }} />
              ))}
              <input type="color" disabled={ro} value={s.accent ?? PRINT_DEFAULTS.accent} onChange={(e) => set({ accent: e.target.value })} className="size-8 cursor-pointer rounded border" aria-label={t('Another colour')} />
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            {([
              ['show_codes', t('Item codes')], ['show_discount', t('Discount column')], ['show_banks', t('Bank accounts (on invoices and offers)')],
              ['show_signatures', t('Places to sign')], ['show_words', t('Amount in words')], ['delivery_prices', t('Prices on delivery notes')],
              ['show_stamp', t('Stamp and signature')], ['show_swift', t('SWIFT with the bank accounts')],
            ] as [keyof PrintSettings, string][]).map(([k, label]) => (
              <label key={k} className="flex items-center justify-between gap-3 rounded-md border px-3 py-2 text-sm">
                <span>{label}</span><Switch disabled={ro} checked={!!s[k]} onCheckedChange={(v) => set({ [k]: v })} />
              </label>
            ))}
          </div>
          {s.show_banks && <div className="flex flex-wrap items-center gap-2 text-sm">
            <Label className="font-normal text-muted-foreground">{t('Bank accounts')}</Label>
            <Select value={s.banks_layout ?? 'list'} onValueChange={(v) => set({ banks_layout: v as 'list' | 'row' })} disabled={ro}>
              <SelectTrigger className="h-8 w-56" aria-label={t('Bank accounts')}><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="list">{t('One under the other')}</SelectItem><SelectItem value="row">{t('Side by side on one line')}</SelectItem></SelectContent>
            </Select>
          </div>}
          <div className="grid gap-3">
            <Label>{t('Text under each document')}</Label>
            {TEXTS.map((x) => (
              <div key={x.key} className="grid gap-1">
                <span className="text-[13px] text-muted-foreground">{t(x.label)}</span>
                <Textarea rows={2} disabled={ro} value={s.texts?.[x.key] ?? ''} placeholder={x.hint ? t(x.hint) : undefined}
                  onChange={(e) => set({ texts: { ...(s.texts ?? {}), [x.key]: e.target.value } })} aria-label={t(x.label)} />
              </div>
            ))}
            <p className="text-[12px] text-muted-foreground">{t('The footer of every page is set under “Defaults and rules”.')}</p>
          </div>
          {!ro && <div><Button disabled={!dirty} loading={save.isPending} onClick={() => save.mutate()}><Save /> {t('Save')}</Button></div>}
        </CardContent>
      </Card>
      <div className="xl:sticky xl:top-4 xl:self-start">
        <p className="mb-2 text-[13px] text-muted-foreground">{t('Preview (an example invoice)')}</p>
        <div className="h-[764px] w-[540px] max-w-full overflow-hidden rounded-lg border bg-white shadow-sm">
          <iframe title={t('Preview')} className="h-[1123px] w-[794px] origin-top-left border-0" style={{ transform: 'scale(0.68)' }}
            srcDoc={`<!doctype html><html><head><meta charset="utf-8"><style>${css} body{padding:40px 46px}</style></head><body>${body}</body></html>`} />
        </div>
      </div>
    </div>
  )
}

/** a picture made small enough for documents (PNG, at most 600 px) */
async function shrinkImage(f: File): Promise<string> {
  const url = URL.createObjectURL(f)
  try {
    const img = new Image(); img.src = url; await img.decode()
    const k = Math.min(1, 600 / Math.max(img.naturalWidth, img.naturalHeight))
    const c = document.createElement('canvas')
    c.width = Math.max(1, Math.round(img.naturalWidth * k)); c.height = Math.max(1, Math.round(img.naturalHeight * k))
    c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height)
    return c.toDataURL('image/png')
  } finally { URL.revokeObjectURL(url) }
}

function sampleDoc(company: Company): PrintDoc {
  const lines = [
    { code: 'A-1001', description: t('Example item one'), uom: 'copë', qty: 12, price: 4.5, discount: 0, tax_rate: 18, net: 54, tax: 9.72, total: 63.72 },
    { code: 'A-1002', description: t('Example item two'), uom: 'kg', qty: 3.5, price: 12, discount: 10, tax_rate: 18, net: 37.8, tax: 6.8, total: 44.6 },
    { code: 'S-01', description: t('Transport'), uom: 'shërb.', qty: 1, price: 15, discount: 0, tax_rate: 8, net: 15, tax: 1.2, total: 16.2 },
  ]
  return {
    kind: 'sales_invoice', number: 'INV-2026-00123', date: todayISO(), due_date: todayISO(), currency: company.base_currency, rate: 1,
    payment_term: t('15 days'), salesperson: null, notes: null, subtotal: 106.8, discount_total: 4.2, tax_total: 17.72, total: 124.52, paid: 0, due: 124.52,
    partner: { name: t('Example customer'), tax_number: '810000011', address: 'Rr. Nëna Terezë 10, Prishtinë', phone: '044 123 456', email: 'blerje@shembull.com', code: 'K-001' },
    lines, vat: [{ rate: 18, base: 91.8, tax: 16.52 }, { rate: 8, base: 15, tax: 1.2 }],
    company, printed_by: null, printed_at: new Date().toISOString(),
  }
}
