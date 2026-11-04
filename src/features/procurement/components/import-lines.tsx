import { useMutation } from '@tanstack/react-query'
import { ArrowLeft, Check, ClipboardPaste, FileSpreadsheet, Loader2, PackagePlus, ScanText, TriangleAlert } from 'lucide-react'
import * as React from 'react'
import { toast } from 'sonner'
import { useCompany } from '@/app/company-provider'
import { usePhotoSubmit } from '@/components/photo-reads'
import { SearchSelect, type SearchOption } from '@/components/search-select'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { parseCsv, parseFile } from '@/features/settings/lib/parse-file'
import { t, tn, tServer } from '@/i18n'
import { describeError, unwrap } from '@/lib/errors'
import { ensureScanCatalog } from '@/lib/offline/catalog'
import { supabase } from '@/lib/supabase'
import { cn, formatMoney, formatQty } from '@/lib/utils'
import { columnsSignature, detectRoles, findHeader, netUnitPrice, readLines, ROLES, type FileLine, type Role } from '../lib/line-columns'

/**
 * The lines of a purchase invoice from the supplier's file: copied from Excel and pasted, an Excel or
 * CSV file, or a photo or PDF of the invoice (read by the AI). The columns are found by their names
 * (and remembered for the supplier), each line finds our item the way the invoice reader does, and a
 * line without one is linked by hand — remembered for this supplier — or becomes a new item.
 */
export interface ImportedLine { variant_id: string; sku: string; name: string; qty: number; price: number; discount: number; vat_rate: number | null }
type Matched = { code?: string | null; barcode?: string | null; name: string; variant_id: string | null; matched_by: string | null; variant_name: string | null
  variant_sku: string | null; item_vat_rate: number | null }
type Line = FileLine & { variant_id: string | null; how: string | null; ours: string | null; sku: string | null; itemVat: number | null; use: boolean; touched: boolean }
type ReadLine = { code?: string; barcode?: string; name: string; quantity: number; unit_price?: number; discount_pct?: number; vat_rate?: number; line_total?: number }
type ReadResult = { number?: string; date?: string; vendor_id: string | null; lines: ReadLine[] }

const roleLabel = (r: Role) => ({
  barcode: t('Barcode'), code: t('Supplier’s code'), name: t('Name'), qty: t('Quantity'), price: t('Price without VAT'), price_vat: t('Price with VAT'),
  discount: t('Discount %'), vat: t('VAT %'), total: t('Line value without VAT'), total_vat: t('Line value with VAT'), skip: t('Leave out'),
}[r])
const memoKey = (vendor: string) => `drispro.import-columns.${vendor}`
function remembered(vendor: string | null, sig: string): Role[] | null {
  if (!vendor) return null
  try { const m = JSON.parse(localStorage.getItem(memoKey(vendor)) ?? 'null') as { sig: string; roles: Role[] } | null; return m?.sig === sig ? m.roles : null } catch { return null }
}
function remember(vendor: string | null, sig: string, roles: Role[]) {
  if (!vendor) return
  try { localStorage.setItem(memoKey(vendor), JSON.stringify({ sig, roles })) } catch { /* the next file asks again */ }
}

export function ImportLinesDialog({ open, onOpenChange, vendorId, itemOptions, onAdd, onHeader }: {
  open: boolean; onOpenChange: (o: boolean) => void; vendorId: string | null; itemOptions: SearchOption[]
  onAdd: (lines: ImportedLine[]) => void
  /** what the AI read at the top of the invoice: the number, the date, the supplier */
  onHeader?: (h: { number?: string; date?: string; vendor_id?: string | null }) => void
}) {
  const { companyId, can } = useCompany()
  const [step, setStep] = React.useState<'source' | 'columns' | 'lines'>('source')
  const [text, setText] = React.useState('')
  const [rows, setRows] = React.useState<string[][]>([])
  const [header, setHeader] = React.useState(-1)
  const [roles, setRoles] = React.useState<Role[]>([])
  const [lines, setLines] = React.useState<Line[]>([])
  const [reading, setReading] = React.useState<string | null>(null)
  const reset = () => { setStep('source'); setText(''); setRows([]); setHeader(-1); setLines([]); setReading(null) }
  React.useEffect(() => { if (!open) reset() }, [open])

  const sig = columnsSignature(rows, header)
  const takeRows = (all: string[][]) => {
    const rs = all.filter((r) => r.some((c) => c.trim()))
    if (!rs.length) { toast.error(t('There are no lines in it')); return }
    const h = findHeader(rs)
    setRows(rs); setHeader(h)
    setRoles(remembered(vendorId, columnsSignature(rs, h)) ?? detectRoles(rs, h))
    setStep('columns')
  }
  const fromText = (s: string) => { const p = parseCsv(s); takeRows([p.headers, ...p.rows]) }
  const pickFile = () => {
    const inp = document.createElement('input')
    inp.type = 'file'; inp.accept = '.xlsx,.csv,.txt,.tsv,text/csv'
    inp.onchange = async () => {
      const f = inp.files?.[0]; if (!f) return
      try { const p = await parseFile(f); takeRows([p.headers, ...p.rows]) } catch (e) { toast.error(describeError(e)) }
    }
    inp.click()
  }

  // ------------------------------------------------------------------- finding the items
  const match = useMutation({
    mutationFn: async (file: FileLine[]) => {
      const res = unwrap(await supabase.rpc('purchase_lines_match', { p_company: companyId!, p_vendor: (vendorId || null) as unknown as string,
        p_lines: file.map((l) => ({ code: l.code, barcode: l.barcode, name: l.name })) as never })) as unknown as Matched[]
      return file.map((l, i): Line => {
        const m = res[i]
        return { ...l, variant_id: m?.variant_id ?? null, how: m?.matched_by ?? null, ours: m?.variant_name ?? null, sku: m?.variant_sku ?? null,
          itemVat: m?.item_vat_rate != null ? Number(m.item_vat_rate) : null, use: true, touched: false }
      })
    },
    onSuccess: (ls) => { setLines(ls); setStep('lines') },
    onError: (e) => toast.error(tServer(describeError(e))),
  })
  const toLines = () => {
    const file = readLines(rows, header, roles)
    if (!file.length) { toast.error(t('No line has a name or code and a quantity: check the columns')); return }
    remember(vendorId, sig, roles)
    match.mutate(file)
  }

  // the photo or PDF: the reader reads it, then the same matching
  const photo = usePhotoSubmit({ kind: 'invoice', invalidate: [['doc-reads', companyId], ['ai-usage', companyId]], onOne: (id) => setReading(id) })
  React.useEffect(() => {
    if (!reading) return
    let stop = false
    const tick = async () => {
      while (!stop) {
        const r = unwrap(await supabase.rpc('doc_read_get', { p_id: reading })) as unknown as { status: string; error: string | null; result: ReadResult | null }
        if (stop) return
        if (r.status === 'done' && r.result) {
          onHeader?.({ number: r.result.number, date: r.result.date, vendor_id: r.result.vendor_id })
          setReading(null)
          match.mutate(r.result.lines.filter((l) => l.name || l.code).map((l, i): FileLine => ({
            row: i, barcode: l.barcode ?? null, code: l.code ?? null, name: l.name || l.code || '', qty: Number(l.quantity) || 1,
            price: l.unit_price != null ? Number(l.unit_price) : null, priceVat: null, discount: Number(l.discount_pct) || 0,
            vat: l.vat_rate != null ? Number(l.vat_rate) : null, total: l.line_total != null ? Number(l.line_total) : null, totalVat: null })))
          return
        }
        if (r.status === 'failed') { setReading(null); toast.error(t('The invoice could not be read')); return }
        await new Promise((ok) => setTimeout(ok, 2500))
      }
    }
    void tick().catch((e) => { setReading(null); toast.error(describeError(e)) })
    return () => { stop = true }
  }, [reading]) // eslint-disable-line react-hooks/exhaustive-deps

  // ------------------------------------------------------------------- a new item for a line
  const [making, setMaking] = React.useState<number | null>(null)
  const makeItem = async (row: number) => {
    const l = lines.find((x) => x.row === row); if (!l || !companyId) return
    setMaking(row)
    try {
      const it = unwrap(await supabase.rpc('purchase_line_new_item', { p_company: companyId, p: {
        name: l.name, barcode: l.barcode, code: l.code, vat_rate: l.vat, cost: netUnitPrice(l, l.vat) } as never })) as unknown as { variant_id: string; sku: string; name: string; existed: boolean; bad_barcode: string | null }
      setLines((ls) => ls.map((x) => x.row === row ? { ...x, variant_id: it.variant_id, ours: it.name, sku: it.sku, how: 'new', touched: true, itemVat: l.vat } : x))
      toast.success(it.existed ? t('{name} was there already, with this barcode', { name: it.name }) : t('New item {name} ({code}); set its selling price on the invoice', { name: it.name, code: it.sku }))
      if (it.bad_barcode) toast.warning(t('The barcode {code} has a wrong check digit (copied wrong?): the item was made without it', { code: it.bad_barcode }))
      void ensureScanCatalog(companyId, true)
    } catch (e) { toast.error(tServer(describeError(e))) } finally { setMaking(null) }
  }
  const optionOf = React.useMemo(() => new Map(itemOptions.map((o) => [o.value, o])), [itemOptions])

  const add = useMutation({
    mutationFn: async () => {
      const use = lines.filter((l) => l.use && l.variant_id)
      if (vendorId && companyId) {
        await supabase.rpc('purchase_lines_learn', { p_company: companyId, p_vendor: vendorId,
          p_lines: use.map((l) => ({ code: l.code, barcode: l.barcode, name: l.name, variant_id: l.variant_id, price: netUnitPrice(l, l.itemVat) })) as never })
      }
      return use.map((l): ImportedLine => ({ variant_id: l.variant_id!, sku: l.sku ?? optionOf.get(l.variant_id!)?.hint ?? '', name: l.ours ?? optionOf.get(l.variant_id!)?.label ?? l.name,
        qty: l.qty, price: Math.round((netUnitPrice(l, l.itemVat) ?? 0) * 10000) / 10000, discount: l.discount, vat_rate: l.vat ?? l.itemVat }))
    },
    onSuccess: (ls) => { onAdd(ls); onOpenChange(false); toast.success(tn(ls.length, '{n} line added to the invoice', '{n} lines added to the invoice')) },
    onError: (e) => toast.error(tServer(describeError(e))),
  })

  const how: Record<string, string> = { learned: t('as last time'), vendor_code: t('vendor’s code'), barcode: t('barcode'), code: t('our code'), name: t('by name'),
    new: t('new item'), hand: t('linked by you') }
  const found = lines.filter((l) => l.use && l.variant_id).length
  const missing = lines.filter((l) => l.use && !l.variant_id).length
  const noPrice = lines.filter((l) => l.use && l.variant_id && netUnitPrice(l, l.itemVat) == null).length
  const busy = match.isPending || photo.send.isPending || !!reading

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={cn('max-h-[92dvh] overflow-y-auto', step === 'source' ? 'max-w-xl' : 'max-w-5xl')}>
        <DialogHeader>
          <DialogTitle>{t('Lines from the supplier’s file')}</DialogTitle>
          <DialogDescription>
            {step === 'source' ? t('Copy the lines in Excel and paste them here, or choose the file. Barcode, code, name, quantity and price are found by themselves.')
              : step === 'columns' ? t('Check what each column is. For this supplier it is remembered.')
              : t('Each line found its item, or needs one: link it to one of yours (remembered for this supplier) or make a new item.')}
          </DialogDescription>
        </DialogHeader>

        {step === 'source' && (
          <div className="grid gap-3">
            <Textarea autoFocus rows={7} className="font-mono text-[12px]" value={text} disabled={busy}
              placeholder={t('Select the lines in Excel, Ctrl+C, then click here and Ctrl+V')}
              onChange={(e) => setText(e.target.value)}
              onPaste={(e) => { const s = e.clipboardData.getData('text/plain'); if (s.includes('\t') || s.includes('\n')) { e.preventDefault(); setText(s); fromText(s) } }} />
            <div className="flex flex-wrap items-center gap-2">
              <Button disabled={!text.trim() || busy} onClick={() => fromText(text)}><ClipboardPaste /> {t('Read the pasted lines')}</Button>
              <Button variant="outline" disabled={busy} onClick={pickFile}><FileSpreadsheet /> {t('Choose the file (Excel, CSV)')}</Button>
              <Button variant="outline" disabled={busy} onClick={() => photo.pick(false, false)}><ScanText /> {t('Photo or PDF of the invoice')}</Button>
            </div>
            {busy && <p className="flex items-center gap-2 text-[13px] text-muted-foreground"><Loader2 className="size-4 animate-spin" />
              {reading || photo.send.isPending ? t('Reading the invoice… it takes about half a minute.') : t('Finding the items…')}</p>}
            {!vendorId && <p className="text-[12px] text-muted-foreground">{t('Choose the supplier first, and what you link is remembered for the next invoice.')}</p>}
          </div>
        )}

        {step === 'columns' && (
          <div className="grid gap-3">
            <div className="overflow-x-auto rounded-md border">
              <table className="w-full text-[12px]">
                <thead className="bg-muted/50">
                  <tr>{roles.map((r, c) => (
                    <th key={c} className="min-w-[120px] p-1.5 text-left font-normal">
                      <Select value={r} onValueChange={(v) => setRoles((rs) => rs.map((x, i) => i === c ? v as Role : x !== 'skip' && x === v ? 'skip' : x))}>
                        <SelectTrigger className={cn('h-8 text-[12px]', r === 'skip' && 'text-muted-foreground')} aria-label={t('Column {n}', { n: c + 1 })}><SelectValue /></SelectTrigger>
                        <SelectContent>{ROLES.map((x) => <SelectItem key={x} value={x}>{roleLabel(x)}</SelectItem>)}</SelectContent>
                      </Select>
                    </th>))}</tr>
                </thead>
                <tbody>
                  {rows.slice(0, header + 9).map((row, i) => (
                    <tr key={i} className={cn('border-t', i < header && 'text-muted-foreground/60', i === header && 'bg-muted/30 font-medium')}>
                      {roles.map((r, c) => <td key={c} className={cn('max-w-[260px] truncate px-2 py-1', r === 'skip' && 'text-muted-foreground/60')}>{row[c] ?? ''}</td>)}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-[12px] text-muted-foreground">
              {header >= 0 ? t('Row {n} holds the column names; the rows above it are left out.', { n: header + 1 }) : t('The file has no column names: they were guessed from what is in the columns.')}
              {' '}{tn(Math.max(rows.length - header - 1, 0), '{n} row below.', '{n} rows below.')}
            </p>
            {!roles.includes('name') && !roles.includes('code') && !roles.includes('barcode') && <p className="flex items-center gap-1.5 text-[13px] text-warning"><TriangleAlert className="size-4" />{t('Say which column is the name, the code or the barcode')}</p>}
          </div>
        )}

        {step === 'lines' && (
          <div className="grid gap-2">
            <p className="text-[13px]">
              <span className="font-medium text-success">{tn(found, '{n} line found its item', '{n} lines found their item')}</span>
              {missing > 0 && <> · <span className="font-medium text-warning">{tn(missing, '{n} without an item', '{n} without an item')}</span></>}
              {noPrice > 0 && <> · <span className="text-warning">{tn(noPrice, '{n} without a price (VAT unknown): write it on the invoice', '{n} without a price (VAT unknown): write them on the invoice')}</span></>}
            </p>
            <ul className="divide-y rounded-md border">
              {lines.map((l) => {
                const set = (p: Partial<Line>) => setLines((ls) => ls.map((x) => x.row === l.row ? { ...x, ...p } : x))
                const price = netUnitPrice(l, l.itemVat)
                return (
                  <li key={l.row} className={cn('grid gap-2 p-2.5 text-[13px] md:grid-cols-[auto_minmax(0,1fr)_minmax(240px,1.1fr)_80px_96px] md:items-center', !l.use && 'opacity-50')}>
                    <input type="checkbox" className="size-4" checked={l.use} onChange={(e) => set({ use: e.target.checked })} aria-label={t('Add this line')} />
                    <div className="min-w-0"><div className="truncate font-medium">{l.name}</div>
                      <div className="truncate text-[11px] text-muted-foreground">{[l.barcode, l.code].filter(Boolean).join(' · ') || '—'}</div></div>
                    <div className="grid gap-1">
                      <div className="flex items-center gap-1.5">
                        <div className="min-w-0 flex-1"><SearchSelect value={l.variant_id} options={itemOptions} placeholder={t('Link it to an item…')} aria-invalid={l.use && !l.variant_id}
                          onChange={(v) => { const o = v ? optionOf.get(v) : null; set({ variant_id: v, ours: o?.label ?? null, sku: o?.hint ?? null, how: v ? 'hand' : null, touched: true }) }} /></div>
                        {!l.variant_id && can('inventory.write') && (
                          <Button size="sm" variant="outline" className="h-9 shrink-0" loading={making === l.row} disabled={making != null} onClick={() => void makeItem(l.row)}
                            title={t('Make a new item with this name and barcode')}><PackagePlus /> {t('New item|make')}</Button>)}
                      </div>
                      {l.variant_id && l.how && <span className={cn('flex items-center gap-1 text-[11px]', l.how === 'name' ? 'text-warning' : 'text-success')}>
                        <Check className="size-3" />{l.how === 'name' ? t('found by name: check it') : t('found: {how}', { how: how[l.how] ?? '' })}</span>}
                    </div>
                    <div className="text-right tabular-nums">{formatQty(l.qty)}</div>
                    <div className="text-right tabular-nums">{price == null ? '—' : formatMoney(price, undefined, 4)}
                      {l.discount > 0 && <div className="text-[11px] text-muted-foreground">−{formatQty(l.discount)} %</div>}</div>
                  </li>
                )
              })}
            </ul>
          </div>
        )}

        <DialogFooter className="gap-2 sm:justify-between">
          {step !== 'source' ? <Button variant="ghost" onClick={() => setStep(step === 'lines' && rows.length ? 'columns' : 'source')}><ArrowLeft /> {t('Back')}</Button> : <span />}
          {step === 'columns' && <Button loading={match.isPending} disabled={!roles.some((r) => r === 'name' || r === 'code' || r === 'barcode')} onClick={toLines}>{t('Find the items')}</Button>}
          {step === 'lines' && <Button loading={add.isPending} disabled={!found} onClick={() => add.mutate()}>
            {tn(found, 'Add {n} line to the invoice', 'Add {n} lines to the invoice')}</Button>}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
