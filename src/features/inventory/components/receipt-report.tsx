import { formatQtyOf } from '@/lib/units'
import { useQuery } from '@tanstack/react-query'
import { FileWarning, Printer, Thermometer } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { formatDateWith, formatNumberWith, msg, t } from '@/i18n'
import { unwrap } from '@/lib/errors'
import { printHtml } from '@/lib/print'
import { supabase } from '@/lib/supabase'
import { cn, formatDate } from '@/lib/utils'

type Issue = 'short' | 'over' | 'refused' | 'warm' | 'not_measured'
type Line = { variant_id?: string | null; sku: string; name: string; expected: number | null; accepted: number; refused: number; reason: string | null
  temperature: number | null; max_temperature: number | null; issues: Issue[] }
export type ReceiptReport = { id: string; number: string; status: string; date: string; done_at: string | null; vendor: string | null; vendor_tax: string | null
  order: string | null; delivery_note: string | null; driver_name: string | null; warehouse: string | null; received_by: string | null; company: string
  lines: Line[]; issues: number }

const ISSUE: Record<Issue, string> = {
  short: msg('Less than expected'), over: msg('More than expected'), refused: msg('Refused'), warm: msg('Too warm'), not_measured: msg('Temperature not taken'),
}
const issueText = (i: Issue) => t(ISSUE[i])
const temp = (v: number | null) => (v == null ? '—' : `${formatNumberWith(v, { maximumFractionDigits: 1 })} °C`)
const esc = (s: unknown) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!))

export function useReceiptReport(id?: string, version?: string | null) {
  return useQuery({
    queryKey: ['receipt-report', id, version], enabled: !!id,
    queryFn: async () => unwrap(await supabase.rpc('receipt_report', { p_receipt: id! })) as unknown as ReceiptReport,
  })
}

/** The discrepancy report (procesverbal) of a receipt: what differs from the order, refused or too warm, for the vendor to sign */
export function ReceiptReportCard({ receiptId, version }: { receiptId: string; version?: string | null }) {
  const q = useReceiptReport(receiptId, version)
  const r = q.data
  if (!r || r.status !== 'done' || !r.issues) return null
  const bad = r.lines.filter((l) => l.issues.length)
  return (
    <div className="mb-4 rounded-lg border border-warning/50 bg-warning/5 px-4 py-3 text-[13px]">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <span className="flex items-start gap-2"><FileWarning className="mt-0.5 size-4 shrink-0 text-warning" />
          <span><span className="block font-medium">{t('{n} lines differ from what was expected', { n: bad.length })}</span>
            <span className="block text-muted-foreground">{t('Print the discrepancy report (procesverbal), sign it with the driver and send it to the vendor. Keep it with the delivery note.')}</span></span></span>
        <Button size="sm" variant="outline" onClick={() => printReceiptReport(r)}><Printer /> {t('Print the report')}</Button>
      </div>
      <ul className="mt-2 grid gap-1">
        {bad.map((l) => (
          <li key={l.sku} className="flex flex-wrap items-center gap-x-2 gap-y-1 border-t border-border/60 pt-1">
            <span className="font-medium">{l.name}</span>
            <span className="text-muted-foreground">{l.expected != null ? t('{a} of {b} accepted', { a: formatQtyOf(l.accepted, l.variant_id), b: formatQtyOf(l.expected, l.variant_id) }) : t('{a} accepted', { a: formatQtyOf(l.accepted, l.variant_id) })}</span>
            {l.temperature != null && <span className={cn('inline-flex items-center gap-0.5', l.issues.includes('warm') && 'text-destructive')}><Thermometer className="size-3.5" />{temp(l.temperature)}</span>}
            {l.issues.map((i) => <Badge key={i} variant="outline" className={cn('font-normal', i === 'warm' || i === 'refused' ? 'border-destructive/40 text-destructive' : 'border-warning/40 text-warning')}>{issueText(i)}</Badge>)}
            {l.reason && <span className="text-muted-foreground">· {l.reason}</span>}
          </li>
        ))}
      </ul>
    </div>
  )
}

export function printReceiptReport(r: ReceiptReport) {
  const rows = r.lines.map((l, i) => `<tr class="${l.issues.length ? 'bad' : ''}"><td>${i + 1}</td><td>${esc(l.sku)}</td><td>${esc(l.name)}</td>
    <td class="r">${l.expected == null ? '—' : esc(formatQtyOf(l.expected, l.variant_id))}</td><td class="r">${esc(formatQtyOf(l.accepted, l.variant_id))}</td><td class="r">${l.refused ? esc(formatQtyOf(l.refused, l.variant_id)) : ''}</td>
    <td class="r">${l.temperature == null ? '' : esc(temp(l.temperature))}${l.max_temperature != null ? `<br><small>${esc(t('max {v}', { v: temp(l.max_temperature) }))}</small>` : ''}</td>
    <td>${esc(l.issues.map(issueText).join(', '))}${l.reason ? `<br><small>${esc(l.reason)}</small>` : ''}</td></tr>`).join('')
  const kv = (k: string, v: unknown) => (v ? `<div><span>${esc(k)}</span> ${esc(v)}</div>` : '')
  printHtml(`
    <h1>${esc(t('Discrepancy report (procesverbal)'))}</h1>
    <p class="sub">${esc(t('for goods receipt {number} of {date}', { number: r.number, date: formatDate(r.date) }))}</p>
    <div class="meta">
      ${kv(t('Company:'), r.company)}${kv(t('Store:'), r.warehouse)}${kv(t('Vendor:'), r.vendor)}${kv(t('Fiscal number:'), r.vendor_tax)}
      ${kv(t('Purchase order:'), r.order)}${kv(t('Delivery note:'), r.delivery_note)}${kv(t('Driver:'), r.driver_name)}
      ${kv(t('Received at:'), r.done_at ? formatDateWith(new Date(r.done_at), { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : null)}
    </div>
    <table><thead><tr><th>#</th><th>${esc(t('Code'))}</th><th>${esc(t('Item'))}</th><th class="r">${esc(t('Expected'))}</th><th class="r">${esc(t('Accepted'))}</th>
      <th class="r">${esc(t('Refused'))}</th><th class="r">${esc(t('Temperature'))}</th><th>${esc(t('Remarks'))}</th></tr></thead><tbody>${rows}</tbody></table>
    <p class="note">${esc(t('The goods marked above were not accepted as delivered. The vendor sends a credit note or the missing goods.'))}</p>
    <div class="sign"><div>${esc(t('Received by'))}<br><b>${esc(r.received_by ?? '')}</b></div><div>${esc(t('Driver / vendor'))}<br><b>${esc(r.driver_name ?? '')}</b></div><div>${esc(t('Store manager'))}<br><b>&nbsp;</b></div></div>`,
  `@page{size:A4;margin:16mm} body{font:12px/1.45 system-ui,Arial,sans-serif;color:#111} h1{font-size:19px;margin:0} .sub{margin:2px 0 14px;color:#555}
   .meta{display:grid;grid-template-columns:1fr 1fr;gap:3px 24px;margin-bottom:14px} .meta span{color:#666}
   table{width:100%;border-collapse:collapse} th,td{border-bottom:1px solid #ccc;padding:5px 6px;text-align:left;vertical-align:top} th{font-size:11px;color:#555;border-bottom:1.5px solid #333}
   .r{text-align:right} tr.bad td{background:#fff6e5} small{color:#666} .note{margin-top:14px;color:#333}
   .sign{display:grid;grid-template-columns:1fr 1fr 1fr;gap:24px;margin-top:48px} .sign div{border-top:1px solid #333;padding-top:6px;color:#555}`, 'document')
}
