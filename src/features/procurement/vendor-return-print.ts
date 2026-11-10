import { toast } from 'sonner'
import { t } from '@/i18n'
import { describeError, unwrap } from '@/lib/errors'
import { printHtml } from '@/lib/print'
import { supabase } from '@/lib/supabase'
import { formatDate, formatMoney, formatQty } from '@/lib/utils'

type Doc = {
  number: string; date: string; reason: string; total_cost: number; warehouse: string | null; receipt: string | null; delivery_note: string | null; made_by: string | null
  company: { name: string; tax_number: string | null; address: string | null } | null
  vendor: { name: string; tax_number: string | null } | null
  lines: { sku: string; name: string; uom: string | null; quantity: number; unit_cost: number; lot: string | null; value: number }[]
}

const esc = (v: unknown) => String(v ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)

/** The return note (fletëkthimi): what goes back to the supplier, signed by who hands it over and who takes it */
export async function printVendorReturn(id: string) {
  try {
    const d = unwrap(await supabase.rpc('vendor_return_doc', { p_return: id })) as unknown as Doc
    const rows = d.lines.map((l, i) => `<tr><td>${i + 1}</td><td>${esc(l.sku)}</td><td>${esc(l.name)}${l.lot ? `<br><small>${esc(t('Lot'))} ${esc(l.lot)}</small>` : ''}</td>
      <td class="r">${esc(formatQty(l.quantity, l.uom ?? undefined))}</td><td class="r">${esc(formatMoney(l.unit_cost, undefined, 4))}</td><td class="r">${esc(formatMoney(l.value))}</td></tr>`).join('')
    const kv = (k: string, v: unknown) => (v ? `<div><span>${esc(k)}</span> ${esc(v)}</div>` : '')
    printHtml(`
      <h1>${esc(t('Return note'))} ${esc(d.number)}</h1>
      <p class="sub">${esc(t('Goods returned to the supplier on {date}', { date: formatDate(d.date) }))}</p>
      <div class="meta">
        ${kv(t('From:'), d.company?.name)}${kv(t('To the supplier:'), d.vendor?.name)}
        ${kv(t('Fiscal number:'), d.company?.tax_number)}${kv(t('Supplier fiscal number:'), d.vendor?.tax_number)}
        ${kv(t('Address:'), d.company?.address)}${kv(t('Store:'), d.warehouse)}
        ${kv(t('Goods receipt:'), d.receipt)}${kv(t('Delivery note:'), d.delivery_note)}
      </div>
      <p><b>${esc(t('Why'))}:</b> ${esc(d.reason)}</p>
      <table><thead><tr><th>#</th><th>${esc(t('Code'))}</th><th>${esc(t('Item'))}</th><th class="r">${esc(t('Quantity'))}</th>
        <th class="r">${esc(t('Cost per unit, without VAT'))}</th><th class="r">${esc(t('Value, without VAT'))}</th></tr></thead>
        <tbody>${rows}</tbody><tfoot><tr><td colspan="5" class="r"><b>${esc(t('Total'))}</b></td><td class="r"><b>${esc(formatMoney(d.total_cost))}</b></td></tr></tfoot></table>
      <p class="note">${esc(t('The supplier confirms the goods were taken back and sends a credit note for them.'))}</p>
      <div class="sign"><div>${esc(t('Handed over by'))}<br><b>${esc(d.made_by ?? '')}</b></div><div>${esc(t('Taken by (driver / supplier)'))}<br><b></b></div><div>${esc(t('Date and stamp'))}</div></div>`,
    `@page{size:A4;margin:16mm} body{font:12px/1.45 system-ui,Arial,sans-serif;color:#111} h1{font-size:19px;margin:0} .sub{margin:2px 0 14px;color:#555}
     .meta{display:grid;grid-template-columns:1fr 1fr;gap:3px 24px;margin-bottom:12px} .meta span{color:#666}
     table{width:100%;border-collapse:collapse;margin-top:8px} th,td{border-bottom:1px solid #ccc;padding:5px 6px;text-align:left;vertical-align:top} th{font-size:11px;color:#555;border-bottom:1.5px solid #333}
     tfoot td{border-bottom:none;padding-top:8px} .r{text-align:right} small{color:#666} .note{margin-top:14px;color:#333}
     .sign{display:grid;grid-template-columns:1fr 1fr 1fr;gap:24px;margin-top:56px} .sign div{border-top:1px solid #333;padding-top:6px;color:#555}`, 'document')
  } catch (e) { toast.error(describeError(e)) }
}
