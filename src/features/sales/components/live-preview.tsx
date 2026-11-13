import { useQuery } from '@tanstack/react-query'
import * as React from 'react'
import { useWatch, type UseFormReturn } from 'react-hook-form'
import { useCompany } from '@/app/company-provider'
import { Card, CardContent } from '@/components/ui/card'
import { useTaxCodes } from '@/features/inventory/api'
import { t } from '@/i18n'
import type { PrintDoc } from '@/lib/documents/model'
import { renderDocHtml } from '@/lib/documents/render-html'
import { supabase } from '@/lib/supabase'
import { num } from '@/lib/utils'
import type { SalesDocValues } from '../schemas'
import { lineAmounts } from './sales-lines-editor'

type Party = { id: string; name: string; code: string | null; tax_number: string | null; email: string | null; phone: string | null }

/**
 * The document as it will print, next to the form, while it is written: every line, discount and VAT rate
 * shows at once. Built from what is on the screen; the printed one comes from the saved document.
 */
export function LivePreview({ form, kind, number, customers }: {
  form: UseFormReturn<SalesDocValues>; kind: 'quotes' | 'orders' | 'invoices'; number: string | null; customers: Party[] | undefined
}) {
  const { companyId } = useCompany()
  const taxes = useTaxCodes()
  const co = useQuery({
    queryKey: ['print-company-header', companyId], enabled: !!companyId, staleTime: 5 * 60_000,
    queryFn: async () => {
      const r = await supabase.rpc('print_company_header' as never, { p_company: companyId } as never)
      return r.error ? null : (r.data as unknown as PrintDoc['company'])
    },
  })
  const v = useWatch({ control: form.control }) as Partial<SalesDocValues>
  // the frame is redrawn a moment after typing stops, not on every key
  const [html, setHtml] = React.useState('')
  React.useEffect(() => {
    const company = co.data
    if (!company) return
    const h = setTimeout(() => {
      const rate = (id?: string | null) => num(taxes.data?.find((x) => x.id === id)?.rate)
      const vat = new Map<number, { rate: number; base: number; tax: number }>()
      let gross = 0, sub = 0, tax = 0
      const lines = (v.lines ?? []).filter((l) => l && (l.variant_id || l.description)).map((l) => {
        const r = rate(l!.tax_code_id), a = lineAmounts(l!, r)
        gross += a.gross; sub += a.sub; tax += a.tax
        const g = vat.get(r) ?? { rate: r, base: 0, tax: 0 }; g.base += a.sub; g.tax += a.tax; vat.set(r, g)
        return { code: null, description: l!.description ?? '', uom: null, qty: num(l!.quantity), price: num(l!.unit_price), discount: num(l!.discount_pct) || null,
          tax_rate: r, net: a.sub, tax: a.tax, total: a.total }
      })
      const p = customers?.find((c) => c.id === v.partner_id)
      const doc: PrintDoc = {
        kind: kind === 'quotes' ? 'sales_quote' : kind === 'orders' ? 'sales_order' : 'sales_invoice',
        number: number ?? t('Draft'), date: v.doc_date || new Date().toISOString().slice(0, 10),
        due_date: kind === 'invoices' ? v.second_date || null : null, valid_until: kind === 'quotes' ? v.second_date || null : null,
        currency: v.currency_code || company.base_currency, notes: v.notes || null, terms: v.terms || null,
        subtotal: Math.round(sub * 100) / 100, discount_total: Math.round((gross - sub) * 100) / 100, tax_total: Math.round(tax * 100) / 100,
        total: Math.round((sub + tax) * 100) / 100,
        partner: p ? { name: p.name, code: p.code, tax_number: p.tax_number, email: p.email, phone: p.phone } : null,
        lines, vat: [...vat.values()].sort((a, b) => b.rate - a.rate), company, printed_by: null, printed_at: new Date().toISOString(),
      }
      const { body, css } = renderDocHtml(doc)
      setHtml(`<!doctype html><html><head><meta charset="utf-8"><style>${css} body{margin:0;padding:24px;background:#fff}</style></head><body>${body}</body></html>`)
    }, 350)
    return () => clearTimeout(h)
  }, [v, co.data, taxes.data, customers, kind, number])

  if (co.data === null) return null   // a server not updated yet: no preview
  return (
    <Card className="overflow-hidden">
      <div className="flex items-center justify-between border-b px-3 py-2 text-[12.5px] text-muted-foreground">
        <span className="font-medium text-foreground">{t('Preview')}</span><span>{t('As it will print; the PDF is made from the saved document.')}</span>
      </div>
      <CardContent className="bg-muted/40 p-3">
        <iframe title={t('Preview')} srcDoc={html} sandbox="" className="h-[calc(100dvh-220px)] min-h-[480px] w-full rounded-md border bg-white shadow-sm" />
      </CardContent>
    </Card>
  )
}
