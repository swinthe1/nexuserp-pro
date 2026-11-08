import { Hint } from '@/components/help'
import { FileSpreadsheet, RotateCcw, TrendingDown, TrendingUp } from 'lucide-react'
import * as React from 'react'
import { toast } from 'sonner'
import { Can, useCompany } from '@/app/company-provider'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { Textarea } from '@/components/ui/textarea'
import { msg, t, td } from '@/i18n'
import { printHtml } from '@/lib/print'
import { cn, formatDate, formatMoney, formatQty, num } from '@/lib/utils'
import { parseCsv, parseFile } from '@/features/settings/lib/parse-file'
import { useCountImport, useCountRecount, useCountReview, type CountImportResult, type CountLine } from '../api'

const esc = (s: unknown) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!))

/** The paper the counters take to the shelves: by shelf, with an empty box for what they count */
export function printCountSheet(c: { number: string; count_date: string; blind_count: boolean; warehouse: { code: string; name: string } | null; lines: CountLine[] }, company: string) {
  const groups = new Map<string, CountLine[]>()
  for (const l of c.lines) groups.set(l.location?.code ?? '', [...(groups.get(l.location?.code ?? '') ?? []), l])
  const showExpected = !c.blind_count
  const rows = [...groups.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([code, lines]) => `
    <tr class="shelf"><td colspan="${showExpected ? 6 : 5}">${esc(t('Shelf'))} ${esc(code)}</td></tr>
    ${lines.map((l, i) => `<tr><td class="n">${i + 1}</td><td class="mono">${esc(l.variant?.sku)}</td><td>${esc(l.variant?.name)}${l.lot ? ` <span class="muted">· ${esc(l.lot.lot_number)}</span>` : ''}</td>
      ${showExpected ? `<td class="r">${esc(formatQty(l.system_qty))}</td>` : ''}<td class="box"></td><td class="box note"></td></tr>`).join('')}`).join('')
  const body = `
    <header><div><h1>${esc(t('Stock count sheet'))} ${esc(c.number)}</h1>
      <div class="muted">${esc(company)} · ${esc(td(c.warehouse?.name ?? ''))} · ${esc(formatDate(c.count_date))}${c.blind_count ? ` · ${esc(t('blind count: the quantities in the system are not shown'))}` : ''}</div></div></header>
    <table><thead><tr><th class="n">#</th><th>${esc(t('Code'))}</th><th>${esc(t('Item'))}</th>${showExpected ? `<th class="r">${esc(t('Expected'))}</th>` : ''}<th>${esc(t('Counted'))}</th><th>${esc(t('Note'))}</th></tr></thead>
    <tbody>${rows}</tbody></table>
    <p class="muted">${esc(t('Items found on a shelf but not on this sheet: write them on the back with code, shelf and quantity.'))}</p>
    <div class="sign"><div>${esc(t('Counted by'))}</div><div>${esc(t('Checked by'))}</div><div>${esc(t('Date and time'))}</div></div>`
  const css = `@page { size: A4; margin: 14mm } body { font: 11px/1.35 system-ui, sans-serif; color: #111 } h1 { font-size: 16px; margin: 0 0 2px }
    .muted { color: #666 } header { margin-bottom: 10px } table { width: 100%; border-collapse: collapse } th { text-align: left; font-size: 10px; color: #555; border-bottom: 1.5px solid #222; padding: 4px }
    td { border-bottom: 1px solid #ddd; padding: 5px 4px; vertical-align: middle } .n { width: 22px; color: #888 } .r { text-align: right } .mono { font-family: ui-monospace, monospace; white-space: nowrap }
    .box { width: 70px; border: 1px solid #999 } .note { width: 110px } tr.shelf td { background: #f1f3f1; font-weight: 700; border-bottom: 1px solid #bbb; padding-top: 8px }
    tr { break-inside: avoid } .sign { display: flex; gap: 24px; margin-top: 28px } .sign div { flex: 1; border-top: 1px solid #222; padding-top: 4px; color: #555 }`
  printHtml(body, css)
}

/* ------------------------------------------------------------------ counted quantities from a spreadsheet */
const COL = {
  code: ['code', 'kodi', 'kod', 'sku', 'barcode', 'barkodi', 'barkod', 'shifra', 'artikulli'],
  location: ['location', 'shelf', 'bin', 'rafti', 'raft', 'lokacioni', 'pozicioni'],
  qty: ['qty', 'quantity', 'counted', 'sasia', 'sasi', 'numeruar', 'numëruar', 'gjendja'],
  lot: ['lot', 'loti', 'batch', 'seria'],
}
const pick = (headers: string[], names: string[]) => headers.findIndex((h) => names.includes(h.trim().toLowerCase()))
const REASON: Record<string, string> = {
  no_quantity: msg('no quantity'), unknown_code: msg('code not found'), unknown_lot: msg('lot not found'), needs_lot: msg('the item needs a lot'),
  unknown_shelf: msg('shelf not found in this unit'), needs_shelf: msg('write the shelf: the item is on more than one'),
}

export function CountImportDialog({ countId, onClose }: { countId: string; onClose: () => void }) {
  const imp = useCountImport()
  const [rows, setRows] = React.useState<{ code: string; location?: string; qty: string; lot?: string }[]>([])
  const [problem, setProblem] = React.useState<string | null>(null)
  const [text, setText] = React.useState('')
  const [add, setAdd] = React.useState(false)
  const [done, setDone] = React.useState<CountImportResult | null>(null)
  const read = (headers: string[], data: string[][]) => {
    const c = pick(headers, COL.code), q = pick(headers, COL.qty), l = pick(headers, COL.location), lo = pick(headers, COL.lot)
    if (c < 0 || q < 0) { setRows([]); setProblem(t('The first row must name the columns: Kodi (or Barkodi) and Sasia; Rafti and Loti if you have them.')); return }
    setProblem(null)
    setRows(data.filter((r) => (r[c] ?? '').trim()).map((r) => ({ code: String(r[c] ?? '').trim(), qty: String(r[q] ?? '').trim(),
      location: l >= 0 ? String(r[l] ?? '').trim() || undefined : undefined, lot: lo >= 0 ? String(r[lo] ?? '').trim() || undefined : undefined })))
  }
  const onFile = async (f: File) => { try { const p = await parseFile(f); read(p.headers, p.rows) } catch (e) { setProblem(t(String((e as Error).message))) } }
  const onText = (v: string) => { setText(v); if (v.trim()) { const p = parseCsv(v); read(p.headers, p.rows) } else setRows([]) }
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle>{t('Counted quantities from Excel')}</DialogTitle>
          <DialogDescription>{t('A sheet with the columns Kodi (or Barkodi), Sasia, and if needed Rafti and Loti. Each row sets what was counted.')}</DialogDescription></DialogHeader>
        {done ? (
          <div className="grid gap-2 text-[13px]">
            <p>{t('{ok} of {rows} rows counted.', { ok: done.ok, rows: done.rows })}</p>
            {!!done.errors.length && <ul className="max-h-56 divide-y overflow-y-auto rounded-md border text-xs">
              {done.errors.map((e) => <li key={e.row} className="flex gap-2 px-2.5 py-1.5"><span className="w-14 shrink-0 text-muted-foreground">{t('Row {n}', { n: e.row + 1 })}</span>
                <span className="font-mono">{e.code}</span><span className="text-destructive">{t(REASON[e.reason] ?? e.reason)}</span></li>)}
            </ul>}
          </div>
        ) : (
          <div className="grid gap-3">
            <Input type="file" accept=".xlsx,.csv,.txt" aria-label={t('Choose the file')} onChange={(e) => { const f = e.target.files?.[0]; if (f) void onFile(f) }} />
            <div className="grid gap-1.5"><Label htmlFor="ci-text" className="text-xs text-muted-foreground">{t('…or paste the rows from Excel')}</Label>
              <Textarea id="ci-text" rows={5} className="font-mono text-xs" value={text} onChange={(e) => onText(e.target.value)} placeholder={'Kodi\tRafti\tSasia\n3801234567890\tA-01\t12'} /></div>{/* i18n-ignore */}
            <label className="flex items-center gap-2 text-[13px]"><Checkbox checked={add} onCheckedChange={(v) => setAdd(v === true)} />
              {t('Add to what is already counted (several people counted the same item)')}</label>
            {problem && <p className="text-xs text-destructive">{problem}</p>}
            {!!rows.length && <p className="text-xs text-muted-foreground">{t('{n} rows ready.', { n: rows.length })}</p>}
          </div>
        )}
        <DialogFooter>
          {done ? <Button onClick={onClose}>{t('Close')}</Button> : <>
            <Button variant="outline" onClick={onClose}>{t('Cancel')}</Button>
            <Button disabled={!rows.length} loading={imp.isPending} onClick={async () => setDone(await imp.mutateAsync({ id: countId, rows, add }))}><FileSpreadsheet /> {t('Count {n} rows', { n: rows.length })}</Button>
          </>}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/* ------------------------------------------------------------------ before confirming: what the differences are worth */
export function CountReviewPanel({ countId }: { countId: string }) {
  const { company } = useCompany()
  const q = useCountReview(countId, true)
  const recount = useCountRecount()
  const [minValue, setMinValue] = React.useState('20')
  const [minPct, setMinPct] = React.useState('10')
  const [picked, setPicked] = React.useState<string[]>([])
  if (q.isLoading) return <Skeleton className="h-40" />
  const d = q.data
  if (!d) return null
  const cur = company?.base_currency
  const send = async (a: { minValue?: number | null; minPct?: number | null; lines?: string[] }) => {
    const n = await recount.mutateAsync({ id: countId, ...a })
    toast.success(n ? t('{n} lines go back to be counted again', { n }) : t('No line is that big'))
    setPicked([])
  }
  return (
    <div className="grid gap-3 rounded-xl border bg-card p-3">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Tile label={t('Differences')} value={String(d.differences)} hint={t('of {n} lines counted', { n: d.counted })} />
        <Tile label={t('Found more')} value={formatMoney(d.gains, cur)} tone="good" icon={TrendingUp}
          hint={d.gains_sale != null ? t('{amount} at the selling price with VAT', { amount: formatMoney(d.gains_sale, cur) }) : undefined} />
        <Tile label={t('Missing')} value={formatMoney(d.losses, cur)} tone="bad" icon={TrendingDown}
          hint={d.losses_sale != null ? t('{amount} at the selling price with VAT', { amount: formatMoney(d.losses_sale, cur) }) : undefined} />
        <Tile label={t('Net effect on stock value')} value={formatMoney(d.net, cur)} tone={num(d.net) < 0 ? 'bad' : 'good'} hint={t('Counted stock is worth {amount}', { amount: formatMoney(d.counted_value, cur) })} />
      </div>
      {!!d.lines.length && (
        <>
          <ul className="max-h-80 divide-y overflow-y-auto rounded-md border text-[13px]">
            {d.lines.map((l) => (
              <li key={l.id} className="flex items-center gap-2 px-2.5 py-1.5">
                <Can perm="wms.write"><Checkbox checked={picked.includes(l.id)} aria-label={l.sku}
                  onCheckedChange={(v) => setPicked((p) => v === true ? [...p, l.id] : p.filter((x) => x !== l.id))} /></Can>
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium">{l.name} {l.recount && <Badge variant="secondary" className="ml-1">{t('recounted')}</Badge>}</div>
                  <div className="truncate text-xs text-muted-foreground">{l.sku} · {l.location}{l.lot ? ` · ${l.lot}` : ''} · {t('expected {e}, counted {c}', { e: formatQty(l.expected), c: formatQty(l.counted) })}
                    {l.first_counted != null && ` · ${t('first count {n}', { n: formatQty(l.first_counted) })}`}</div>
                </div>
                <span className={cn('w-20 shrink-0 text-right tabular', num(l.delta) < 0 ? 'text-destructive' : 'text-warning')}>{num(l.delta) > 0 ? '+' : ''}{formatQty(l.delta)}{l.pct != null && <span className="block text-2xs text-muted-foreground">{l.pct > 0 ? '+' : ''}{l.pct}%</span>}</span>
                <span className={cn('w-24 shrink-0 text-right font-medium tabular', num(l.value) < 0 ? 'text-destructive' : 'text-success')}>{formatMoney(l.value, cur)}</span>
              </li>
            ))}
          </ul>
          <Can perm="wms.write">
            <div className="flex flex-wrap items-end gap-2 text-[13px]">
              <span className="self-center text-muted-foreground">{t('Count again the lines over')}<Hint id="recount" /></span>
              <Input inputMode="decimal" className="h-8 w-20 text-right" value={minValue} aria-label={t('Value')} onChange={(e) => setMinValue(e.target.value)} /><span className="self-center">{cur}</span>
              <span className="self-center text-muted-foreground">{t('or')}</span>
              <Input inputMode="decimal" className="h-8 w-16 text-right" value={minPct} aria-label={t('Percent')} onChange={(e) => setMinPct(e.target.value)} /><span className="self-center">%</span>
              <Button size="sm" variant="outline" loading={recount.isPending && !picked.length} onClick={() => void send({ minValue: minValue ? num(minValue.replace(',', '.')) : null, minPct: minPct ? num(minPct.replace(',', '.')) : null })}><RotateCcw /> {t('Send back to count')}</Button>
              {!!picked.length && <Button size="sm" variant="outline" loading={recount.isPending} onClick={() => void send({ lines: picked })}><RotateCcw /> {t('Count the {n} chosen again', { n: picked.length })}</Button>}
            </div>
          </Can>
        </>
      )}
    </div>
  )
}

function Tile({ label, value, hint, tone, icon: Icon }: { label: string; value: string; hint?: string; tone?: 'good' | 'bad'; icon?: typeof TrendingUp }) {
  return (
    <div className="rounded-lg border px-3 py-2">
      <div className="flex items-center gap-1 text-xs text-muted-foreground">{Icon && <Icon className="size-3.5" />}{label}</div>
      <div className={cn('text-base font-semibold tabular', tone === 'good' && 'text-success', tone === 'bad' && 'text-destructive')}>{value}</div>
      {hint && <div className="text-2xs text-muted-foreground">{hint}</div>}
    </div>
  )
}
