import { Archive, Download } from 'lucide-react'
import * as React from 'react'
import { toast } from 'sonner'
import { useCompany } from '@/app/company-provider'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { msg, t, tServer } from '@/i18n'
import { fetchPrintDoc, fileName, type DocKind } from '@/lib/documents/model'
import { renderDocPdf } from '@/lib/documents/render-pdf'
import { describeError, unwrap } from '@/lib/errors'
import { supabase } from '@/lib/supabase'
import { todayISO } from '@/lib/utils'

const MAX = 400
type Kind = { key: string; label: string; doc: DocKind; table: string; date: string; status: string[] }
const KINDS: Kind[] = [
  { key: 'sales', label: msg('Sales invoices and credit notes'), doc: 'sales_invoice', table: 'sales_invoices', date: 'invoice_date', status: ['posted'] },
  { key: 'payments', label: msg('Payments received and made'), doc: 'payment', table: 'payments', date: 'payment_date', status: ['posted'] },
  { key: 'receipts', label: msg('Goods receipts|archive'), doc: 'goods_receipt', table: 'goods_receipts', date: 'receipt_date', status: ['done'] },
]
const monthStart = () => todayISO().slice(0, 8) + '01'
const lastMonth = () => { const d = new Date(); d.setDate(0); return [`${d.toISOString().slice(0, 8)}01`, d.toISOString().slice(0, 10)] as const }

/**
 * The month's documents as PDFs in one ZIP, for the accountant or an inspection: each document is printed
 * from what is saved, exactly as its own Print would make it, so nothing is kept twice.
 */
export function DocumentArchive() {
  const { companyId, company } = useCompany()
  const [from, setFrom] = React.useState<string>(lastMonth()[0])
  const [to, setTo] = React.useState(lastMonth()[1])
  const [chosen, setChosen] = React.useState<string[]>(['sales', 'payments'])
  const [busy, setBusy] = React.useState<{ done: number; of: number } | null>(null)
  const make = async () => {
    try {
      const kinds = KINDS.filter((k) => chosen.includes(k.key))
      const rows: { k: Kind; id: string; number: string }[] = []
      for (const k of kinds) {
        const r = unwrap(await supabase.from(k.table as never).select('id, number').eq('company_id', companyId!).in('status', k.status)
          .gte(k.date, from).lte(k.date, to).order(k.date).limit(MAX + 1)) as unknown as { id: string; number: string }[]
        rows.push(...r.map((x) => ({ k, id: x.id, number: x.number })))
      }
      if (!rows.length) { toast.info(t('No documents in this period.')); return }
      if (rows.length > MAX) { toast.error(t('More than {n} documents: choose a shorter period.', { n: MAX })); return }
      setBusy({ done: 0, of: rows.length })
      const files: Record<string, Uint8Array> = {}
      let i = 0
      for (const r of rows) {
        const d = await fetchPrintDoc(r.k.doc, r.id)
        const pdf = await renderDocPdf(d)
        files[`${t(r.k.label).replace(/[\\/:*?"<>|]+/g, '-')}/${fileName(d)}`] = new Uint8Array(pdf.output('arraybuffer') as ArrayBuffer)
        setBusy({ done: ++i, of: rows.length })
      }
      const { zipSync } = await import('fflate')
      const blob = new Blob([zipSync(files, { level: 0 })], { type: 'application/zip' })
      const a = document.createElement('a')
      a.href = URL.createObjectURL(blob)
      a.download = `${(company?.name ?? 'DrisPRO').replace(/[\\/:*?"<>|]+/g, '-')} ${from} ${to}.zip`
      a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 10_000)
      toast.success(t('{n} documents in one ZIP.', { n: rows.length }))
    } catch (e) { toast.error(tServer(describeError(e))) } finally { setBusy(null) }
  }
  return (
    <Card className="mb-4">
      <CardHeader><CardTitle className="flex items-center gap-2"><Archive className="size-4" /> {t('Documents of a period as PDF')}</CardTitle>
        <CardDescription>{t('Every chosen document of the period, printed as it is saved, in one ZIP: for the accountant, the bank or an inspection.')}</CardDescription></CardHeader>
      <CardContent className="grid gap-3">
        <div className="flex flex-wrap items-end gap-2">
          <div className="grid gap-1.5"><Label htmlFor="ar-from">{t('From')}</Label><Input id="ar-from" type="date" className="w-[150px]" value={from} onChange={(e) => e.target.value && setFrom(e.target.value)} /></div>
          <div className="grid gap-1.5"><Label htmlFor="ar-to">{t('To')}</Label><Input id="ar-to" type="date" className="w-[150px]" value={to} min={from} onChange={(e) => e.target.value && setTo(e.target.value)} /></div>
          <Button variant="ghost" size="sm" onClick={() => { const [f, tt] = lastMonth(); setFrom(f); setTo(tt) }}>{t('Last month')}</Button>
          <Button variant="ghost" size="sm" onClick={() => { setFrom(monthStart()); setTo(todayISO()) }}>{t('This month')}</Button>
        </div>
        <div className="flex flex-wrap gap-x-5 gap-y-2">
          {KINDS.map((k) => <label key={k.key} className="flex items-center gap-2 text-[13px]">
            <Checkbox checked={chosen.includes(k.key)} onCheckedChange={(v) => setChosen((c) => (v === true ? [...c, k.key] : c.filter((x) => x !== k.key)))} /> {t(k.label)}</label>)}
        </div>
        <div className="flex items-center gap-3">
          <Button onClick={() => void make()} disabled={!chosen.length || !!busy} loading={!!busy}><Download /> {t('Download the ZIP')}</Button>
          {busy && <span className="text-[13px] text-muted-foreground tabular">{t('{done} of {of} documents ready', busy)}</span>}
        </div>
      </CardContent>
    </Card>
  )
}
