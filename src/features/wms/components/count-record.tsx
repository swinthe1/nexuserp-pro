import { FileText, Plus, Trash2 } from 'lucide-react'
import * as React from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { Textarea } from '@/components/ui/textarea'
import { t, td, tn } from '@/i18n'
import { describeError } from '@/lib/errors'
import { printHtml } from '@/lib/print'
import { supabase } from '@/lib/supabase'
import { formatDate, formatMoney, formatQty, num } from '@/lib/utils'

/* The stock count record (procesverbali i inventarizimit): the commission, who counted, and the differences. */
type Member = { name: string; role: string }
type RecordLine = { sku: string; name: string; unit: string | null; location: string; lot: string | null; expected: number; counted: number; delta: number
  unit_cost: number | null; value: number | null; counted_value: number | null; unit_price: number; sale_value: number }
export type CountRecord = {
  company: { name: string; trade_name: string; business_number: string | null; vat_number: string | null; tax_number: string | null; address: string; currency: string }
  warehouse: { code: string; name: string } | null; kind: 'session' | 'count'; name: string; numbers: string[] | null
  started_at: string; first_count_at: string | null; last_count_at: string | null; closed_at: string | null; posted: boolean
  adjustments: { number: string; status: string }[] | null; blind: boolean; cart_minutes: number | null
  record: { commission?: Member[]; keeper?: string | null; notes?: string | null }
  counters: { name: string; items: number }[]
  totals: { lines: number; items: number; differences: number; shortages: number; surpluses: number; counted_value: number | null
    shortage_value: number | null; surplus_value: number | null; net: number | null; shortage_sale: number; surplus_sale: number }
  lines: RecordLine[]; made_at: string; made_by: string | null
  checks?: { number: string; person: string | null; locations: string[] | null; compared: number; agree: number; differ: number }[]
}
type Target = { session?: string; count?: string }

async function fetchRecord(a: Target) {
  const { data, error } = await supabase.rpc('count_record', { p_session: a.session ?? undefined, p_count: a.count ?? undefined })
  if (error) throw error
  return data as unknown as CountRecord
}

export function CountRecordDialog({ target, onClose }: { target: Target; onClose: () => void }) {
  const qc = useQueryClient()
  const [rec, setRec] = React.useState<CountRecord | null>(null)
  const [members, setMembers] = React.useState<Member[]>([])
  const [keeper, setKeeper] = React.useState('')
  const [notes, setNotes] = React.useState('')
  const [annex, setAnnex] = React.useState(false)
  const [failed, setFailed] = React.useState<unknown>(null)
  React.useEffect(() => {
    fetchRecord(target).then((r) => {
      setRec(r)
      const c = r.record.commission ?? []
      setMembers(c.length ? c : [{ name: '', role: t('Chair|commission') }, { name: '', role: t('Member') }, { name: '', role: t('Member') }])
      setKeeper(r.record.keeper ?? ''); setNotes(r.record.notes ?? '')
    }).catch(setFailed)
  }, [target.session, target.count]) // eslint-disable-line react-hooks/exhaustive-deps
  const save = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc('count_record_save', { p_session: (target.session ?? null) as unknown as string, p_count: (target.count ?? null) as unknown as string,
        p_record: { commission: members, keeper, notes } as never })
      if (error) throw error
      return fetchRecord(target)
    },
    onSuccess: (r) => { void qc.invalidateQueries(); printCountRecord(r, annex); onClose() },
    onError: (e) => toast.error(describeError(e)),
  })
  const setMember = (i: number, m: Partial<Member>) => setMembers((ms) => ms.map((x, j) => (j === i ? { ...x, ...m } : x)))
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle>{t('Stock count record')}</DialogTitle>
          <DialogDescription>{t('The commission signs the record. Write who was on it and who is responsible for the goods; the counts and differences come from the program.')}</DialogDescription></DialogHeader>
        {failed ? <p className="text-[13px] text-destructive">{describeError(failed)}</p> : !rec ? <Skeleton className="h-48" /> : (
          <div className="grid gap-3">
            {!rec.posted && <p className="rounded-md bg-warning/10 px-3 py-2 text-[12.5px] text-warning">{t('The differences are not confirmed yet: the record is printed as a draft.')}</p>}
            <div className="grid gap-1.5">
              <Label>{t('Commission')}</Label>
              {members.map((m, i) => (
                <div key={i} className="flex gap-2">
                  <Input className="flex-1" value={m.name} placeholder={t('Name and surname')} aria-label={t('Name and surname')} onChange={(e) => setMember(i, { name: e.target.value })} />
                  <Input className="w-32" value={m.role} placeholder={t('Role')} aria-label={t('Role')} onChange={(e) => setMember(i, { role: e.target.value })} />
                  <Button variant="ghost" size="icon" aria-label={t('Remove')} onClick={() => setMembers((ms) => ms.filter((_, j) => j !== i))}><Trash2 /></Button>
                </div>
              ))}
              {members.length < 12 && <Button variant="ghost" size="sm" className="justify-self-start" onClick={() => setMembers((ms) => [...ms, { name: '', role: t('Member') }])}><Plus /> {t('Add a member')}</Button>}
            </div>
            <div className="grid gap-1.5"><Label htmlFor="keeper">{t('Responsible for the goods')}</Label>
              <Input id="keeper" value={keeper} onChange={(e) => setKeeper(e.target.value)} placeholder={t('The person who keeps the goods of this unit')} /></div>
            <div className="grid gap-1.5"><Label htmlFor="rnotes">{t('Notes of the commission')}</Label>
              <Textarea id="rnotes" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} /></div>
            <label className="flex items-center gap-2 text-[13px]"><Checkbox checked={annex} onCheckedChange={(v) => setAnnex(!!v)} />
              {t('Add the full list of counted items ({n} lines)', { n: rec.totals.lines })}</label>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{t('Cancel')}</Button>
          <Button disabled={!rec} loading={save.isPending} onClick={() => save.mutate()}><FileText /> {t('Save and print')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

const esc = (s: unknown) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!))
const money = (v: number | null | undefined, cur: string) => (v == null ? '—' : formatMoney(v, cur))

export function printCountRecord(r: CountRecord, annex: boolean) {
  const cur = r.company.currency
  const diffs = r.lines.filter((l) => num(l.delta) !== 0)
    .sort((a, b) => Math.sign(num(a.delta)) - Math.sign(num(b.delta)) || num(a.sale_value) - num(b.sale_value))
  const commission = (r.record.commission ?? []).filter((m) => m.name)
  const ids = [r.company.business_number && `${t('Business no.')} ${r.company.business_number}`, r.company.vat_number && `${t('VAT no.')} ${r.company.vat_number}`]
    .filter(Boolean).join(' · ')
  const lineRow = (l: RecordLine, i: number, withDiff: boolean) => `<tr><td class="n">${i + 1}</td><td class="mono">${esc(l.sku)}</td><td>${esc(l.name)}${l.lot ? ` <span class="muted">· ${esc(l.lot)}</span>` : ''}</td>
    <td class="mono">${esc(l.location)}</td><td class="r">${esc(formatQty(l.expected, l.unit))}</td><td class="r">${esc(formatQty(l.counted, l.unit))}</td>
    ${withDiff ? `<td class="r b ${num(l.delta) < 0 ? 'neg' : 'pos'}">${num(l.delta) > 0 ? '+' : ''}${esc(formatQty(l.delta, l.unit))}</td><td class="r">${esc(money(l.value, cur))}</td><td class="r">${esc(money(l.sale_value, cur))}</td>`
                : `<td class="r">${esc(money(l.counted_value, cur))}</td>`}</tr>`
  const method = [
    r.kind === 'session' ? t('The goods were counted with the shop open, without stopping sales. Each item was compared with the stock the program had at the second it was counted; sales and receipts after that second do not change the result.') : '',
    r.blind ? t('The counting was blind: the counters did not see the quantity the program expected.') : '',
    r.cart_minutes ? t('Shortages of goods sold within {n} minutes after the shelf was counted were marked for checking (they may have been in a shopping cart).', { n: r.cart_minutes }) : '',
    ...(r.checks ?? []).map((k) => t('{name} counted {shelves} a second time, blind: {agree} of {compared} lines the same as the first count.',
      { name: k.person ?? '—', shelves: (k.locations ?? []).join(', '), agree: k.agree, compared: k.compared })),
  ].filter(Boolean)
  const body = `
    ${r.posted ? '' : `<div class="draft">${esc(t('DRAFT: the differences are not confirmed yet'))}</div>`}
    <header><div class="co"><b>${esc(r.company.name)}</b>${r.company.trade_name !== r.company.name ? ` <span class="muted">(${esc(r.company.trade_name)})</span>` : ''}<br>
      <span class="muted">${esc(ids)}${r.company.address ? ` · ${esc(r.company.address)}` : ''}</span></div></header>
    <h1>${esc(t('Stock count record'))}</h1>
    <table class="info"><tbody>
      <tr><th>${esc(t('Unit|store'))}</th><td>${esc(td(r.warehouse?.name ?? ''))} (${esc(r.warehouse?.code ?? '')})</td><th>${esc(t('Count|record'))}</th><td>${esc(r.name)}${r.numbers?.length ? ` · ${esc(r.numbers.join(', '))}` : ''}</td></tr>
      <tr><th>${esc(t('Counting began'))}</th><td>${esc(formatDate(r.first_count_at ?? r.started_at, true))}</td><th>${esc(t('Last item counted'))}</th><td>${esc(formatDate(r.last_count_at, true))}</td></tr>
      <tr><th>${esc(t('Stock adjustment'))}</th><td>${esc((r.adjustments ?? []).map((a) => a.number).join(', ') || '—')}</td><th>${esc(t('Responsible for the goods'))}</th><td>${esc(r.record.keeper ?? '')}</td></tr>
    </tbody></table>
    ${method.length ? `<h2>${esc(t('How it was counted'))}</h2>${method.map((m) => `<p>${esc(m)}</p>`).join('')}` : ''}
    ${commission.length ? `<h2>${esc(t('Commission'))}</h2><p>${commission.map((m) => `${esc(m.name)}${m.role ? ` <span class="muted">(${esc(m.role)})</span>` : ''}`).join(', ')}</p>` : ''}
    ${r.counters.length ? `<h2>${esc(t('Counted by'))}</h2><p>${r.counters.map((c) => `${esc(c.name)} <span class="muted">(${esc(tn(c.items, '{n} line', '{n} lines'))})</span>`).join(', ')}</p>` : ''}
    <h2>${esc(t('Summary'))}</h2>
    <table class="sum"><thead><tr><th></th><th class="r">${esc(t('Lines'))}</th><th class="r">${esc(t('At cost'))}</th><th class="r">${esc(t('At the selling price with VAT'))}</th></tr></thead><tbody>
      <tr><td>${esc(t('Counted'))}</td><td class="r">${r.totals.lines}</td><td class="r">${esc(money(r.totals.counted_value, cur))}</td><td></td></tr>
      <tr><td>${esc(t('Shortages'))}</td><td class="r">${r.totals.shortages}</td><td class="r neg">${esc(money(r.totals.shortage_value, cur))}</td><td class="r neg">${esc(money(r.totals.shortage_sale, cur))}</td></tr>
      <tr><td>${esc(t('Surpluses'))}</td><td class="r">${r.totals.surpluses}</td><td class="r pos">${esc(money(r.totals.surplus_value, cur))}</td><td class="r pos">${esc(money(r.totals.surplus_sale, cur))}</td></tr>
      <tr class="tot"><td>${esc(t('Net effect'))}</td><td class="r">${r.totals.differences}</td><td class="r">${esc(money(r.totals.net, cur))}</td><td class="r">${esc(money(num(r.totals.shortage_sale) + num(r.totals.surplus_sale), cur))}</td></tr>
    </tbody></table>
    <h2>${esc(t('Differences'))}</h2>
    ${diffs.length ? `<table class="lines"><thead><tr><th class="n">#</th><th>${esc(t('Code'))}</th><th>${esc(t('Item'))}</th><th>${esc(t('Shelf'))}</th>
      <th class="r">${esc(t('In the program'))}</th><th class="r">${esc(t('Counted'))}</th><th class="r">${esc(t('Difference'))}</th><th class="r">${esc(t('At cost'))}</th><th class="r">${esc(t('At the selling price with VAT'))}</th></tr></thead>
      <tbody>${diffs.map((l, i) => lineRow(l, i, true)).join('')}</tbody></table>` : `<p>${esc(t('No differences: the stock in the program was right.'))}</p>`}
    ${r.record.notes ? `<h2>${esc(t('Notes of the commission'))}</h2><p class="pre">${esc(r.record.notes)}</p>` : ''}
    <p class="stmt">${esc(t('The commission confirms that the goods were counted as written in this record, and that the differences above are what was found.'))}</p>
    <div class="sign">${[...commission.map((m) => `${esc(m.name)}${m.role ? `<br><span class="muted">${esc(m.role)}</span>` : ''}`),
      `${esc(r.record.keeper ?? '')}<br><span class="muted">${esc(t('Responsible for the goods'))}</span>`,
      `<br><span class="muted">${esc(t('Approved by (director)'))}</span>`].map((s) => `<div>${s}</div>`).join('')}</div>
    <p class="foot muted">${esc(t('Made by DrisPRO on {date} by {name}', { date: formatDate(r.made_at, true), name: r.made_by ?? '' }))}</p>
    ${annex ? `<div class="annex"><h2>${esc(t('Annex: the counted items'))}</h2>
      <table class="lines"><thead><tr><th class="n">#</th><th>${esc(t('Code'))}</th><th>${esc(t('Item'))}</th><th>${esc(t('Shelf'))}</th>
      <th class="r">${esc(t('In the program'))}</th><th class="r">${esc(t('Counted'))}</th><th class="r">${esc(t('Value at cost'))}</th></tr></thead>
      <tbody>${r.lines.map((l, i) => lineRow(l, i, false)).join('')}</tbody></table></div>` : ''}`
  const css = `@page { size: A4; margin: 14mm } body { font: 10.5px/1.4 system-ui, sans-serif; color: #111 } h1 { font-size: 17px; margin: 10px 0 8px; text-align: center }
    h2 { font-size: 12px; margin: 14px 0 4px } p { margin: 3px 0 } .muted { color: #666 } .co { font-size: 11.5px }
    table { width: 100%; border-collapse: collapse; font-size: inherit } th { text-align: left; font-size: 9.5px; color: #555; padding: 3px 4px } td { padding: 3px 4px; vertical-align: top }
    .info th { width: 18%; border-bottom: 1px solid #ddd } .info td { width: 32%; border-bottom: 1px solid #ddd }
    .sum { width: 70% } .sum th { border-bottom: 1.5px solid #222 } .sum td { border-bottom: 1px solid #ddd } .sum tr.tot td { font-weight: 700; border-top: 1.5px solid #222 }
    .lines th { border-bottom: 1.5px solid #222 } .lines td { border-bottom: 1px solid #e3e3e3 } tr { break-inside: avoid }
    .n { width: 20px; color: #888 } .r { text-align: right; white-space: nowrap } .b { font-weight: 700 } .mono { font-family: ui-monospace, monospace; white-space: nowrap }
    .neg { color: #b42318 } .pos { color: #1b7a43 } .pre { white-space: pre-wrap } .stmt { margin-top: 14px }
    .sign { display: grid; grid-template-columns: repeat(3, 1fr); gap: 26px 24px; margin-top: 30px } .sign div { border-top: 1px solid #222; padding-top: 4px; min-height: 30px; break-inside: avoid }
    .foot { margin-top: 18px; font-size: 9px } .annex { break-before: page }
    .draft { text-align: center; font-weight: 700; color: #b42318; border: 1.5px solid #b42318; padding: 4px; margin-bottom: 8px; letter-spacing: .5px }`
  printHtml(body, css)
}
