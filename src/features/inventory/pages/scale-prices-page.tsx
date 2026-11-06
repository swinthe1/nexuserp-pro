import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Download, FileUp, Save, Weight } from 'lucide-react'
import * as React from 'react'
import { Link } from 'react-router-dom'
import { toast } from 'sonner'
import { useCompany } from '@/app/company-provider'
import { EmptyState } from '@/components/empty-state'
import { ErrorState } from '@/components/error-state'
import { PageHeader } from '@/components/page-header'
import { SearchSelect } from '@/components/search-select'
import { StatCard } from '@/components/stat-card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { t, tn } from '@/i18n'
import { describeError, unwrap } from '@/lib/errors'
import { looksLikeTxp, nameKey, newLine, parseTxp, type TxpLine, withPrice, writeTxp } from '@/lib/rongta-plu'
import { supabase } from '@/lib/supabase'
import { cn, formatDate, formatMoney, num } from '@/lib/utils'
import { useVariantOptions } from '../api'

type ScaleItem = { product_id: string; variant_id: string; sku: string; name: string; plu: string; uom: string | null; price: number; sent_price: number | null; sent_at: string | null }
/** a line of the file and the item of DrisPRO it is: by its PLU, by the same name, or picked by hand */
type Match = { line: TxpLine; index: number; item: { product_id: string; variant_id: string; name: string; price: number | null } | null; how: 'plu' | 'name' | 'picked' | null }

const PIECE = /^(cop|pcs|pc|cope|copë|ad|adet)$/i

function useScaleItems() {
  const { companyId } = useCompany()
  return useQuery({ queryKey: ['inv', companyId, 'scale-items'], enabled: !!companyId,
    queryFn: async () => (unwrap(await supabase.rpc('scale_items', { p_company: companyId! })) ?? []) as unknown as ScaleItem[] })
}

// the file byte for byte as RTPLU wrote it (its own code page): each byte one character, and back
async function readBytes(f: File) {
  const b = new Uint8Array(await f.arrayBuffer())
  let s = ''
  for (let i = 0; i < b.length; i += 8192) s += String.fromCharCode(...b.subarray(i, i + 8192))
  return s
}
function saveFile(text: string, name: string) {
  const bytes = Uint8Array.from(text, (c) => c.charCodeAt(0) & 0xff)
  const url = URL.createObjectURL(new Blob([bytes], { type: 'application/octet-stream' }))
  const a = document.createElement('a')
  a.href = url; a.download = name; a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/**
 * #8: the prices for the Rongta scale. DrisPRO does not talk to the scale: it reads the PLU file of RTPLU,
 * puts today's prices in it and gives the same file back, with the hotkeys and the other settings as they
 * were. RTPLU sends it to the scale with "Download PLU".
 */
export function ScalePricesPage() {
  const { companyId, can } = useCompany()
  const qc = useQueryClient()
  const items = useScaleItems()
  const variants = useVariantOptions()
  const [file, setFile] = React.useState<{ name: string; lines: TxpLine[] } | null>(null)
  const [picked, setPicked] = React.useState<Record<number, string>>({})
  const [names, setNames] = React.useState(false)
  const input = React.useRef<HTMLInputElement>(null)

  const byPlu = React.useMemo(() => new Map((items.data ?? []).map((i) => [i.plu, i])), [items.data])
  const byName = React.useMemo(() => {
    const m = new Map<string, { product_id: string; variant_id: string; name: string }>()
    for (const v of variants.data ?? []) { const k = nameKey(v.name); if (k && !m.has(k)) m.set(k, { product_id: v.product_id, variant_id: v.id, name: v.name }) }
    return m
  }, [variants.data])
  const variantById = React.useMemo(() => new Map((variants.data ?? []).map((v) => [v.id, v])), [variants.data])

  const matches = React.useMemo<Match[]>(() => (file?.lines ?? []).map((line, index) => {
    if (!line.name || line.lf === '0') return { line, index, item: null, how: null }
    const pick = picked[index] ? variantById.get(picked[index]!) : undefined
    if (pick) return { line, index, item: { product_id: pick.product_id, variant_id: pick.id, name: pick.name, price: byPluProduct(pick.product_id) }, how: 'picked' }
    const p = byPlu.get(line.lf)
    if (p) return { line, index, item: { product_id: p.product_id, variant_id: p.variant_id, name: p.name, price: num(p.price) }, how: 'plu' }
    const n = byName.get(nameKey(line.name))
    if (n) return { line, index, item: { ...n, price: null }, how: 'name' }
    return { line, index, item: null, how: null }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [file, picked, byPlu, byName, variantById])
  function byPluProduct(productId: string) { return (items.data ?? []).find((i) => i.product_id === productId)?.price ?? null }

  const used = matches.filter((m) => m.line.name && m.line.lf !== '0')
  const toLink = used.filter((m) => m.how === 'name' || m.how === 'picked')
  const changed = used.filter((m) => m.how === 'plu' && m.item?.price != null && num(m.item.price) > 0 && Math.round(num(m.item.price) * 100) !== Math.round(m.line.price * 100))
  const unknown = used.filter((m) => !m.item)
  const inFile = new Set(used.map((m) => m.line.lf))
  const missing = (items.data ?? []).filter((i) => !inFile.has(i.plu) && num(i.price) > 0)
  const sinceLast = (items.data ?? []).filter((i) => i.sent_price == null || Math.round(num(i.sent_price) * 100) !== Math.round(num(i.price) * 100))

  const load = async (f: File) => {
    const text = await readBytes(f)
    const lines = parseTxp(text)
    if (!looksLikeTxp(lines)) return void toast.error(t('This is not a PLU file of RTPLU. In RTPLU: File → Save as, and load that file here.'))
    setPicked({}); setFile({ name: f.name, lines })
  }

  const link = useMutation({
    mutationFn: async () => unwrap(await supabase.rpc('scale_plu_set', { p_company: companyId!, p: toLink.map((m) => ({ product_id: m.item!.product_id, plu: m.line.lf })) as never })),
    onSuccess: (n) => { toast.success(tn(Number(n) || 0, '{n} item has its PLU now', '{n} items have their PLU now')); setPicked({}); void qc.invalidateQueries({ queryKey: ['inv', companyId, 'scale-items'] }) },
    onError: (e) => toast.error(describeError(e)),
  })

  const markSent = async (list: { product_id: string; price: number }[]) => {
    await supabase.rpc('scale_mark_sent', { p_company: companyId!, p: list as never })
    void qc.invalidateQueries({ queryKey: ['inv', companyId, 'scale-items'] })
  }

  // the file back, with the prices of DrisPRO: same lines, same order, the new PLUs at the end
  const writeBack = async () => {
    if (!file) return
    const out: TxpLine[] = file.lines.map((l, i) => {
      const m = matches[i]!
      if (m.how !== 'plu' || m.item?.price == null || num(m.item.price) <= 0) return l
      return withPrice(l, num(m.item.price), names ? m.item.name : undefined)
    })
    const template = file.lines.find((l) => l.name && l.lf !== '0')
    for (const i of missing) out.push(newLine(template, i.plu, i.name, num(i.price), PIECE.test(i.uom ?? '')))
    saveFile(writeTxp(out), file.name)
    // the screen shows the file as it is now
    setFile({ name: file.name, lines: out }); setPicked({})
    await markSent([...used.filter((m) => m.how === 'plu' && m.item?.price != null).map((m) => ({ product_id: m.item!.product_id, price: num(m.item!.price) })),
      ...missing.map((i) => ({ product_id: i.product_id, price: num(i.price) }))])
    toast.success(t('The file is ready: open it in RTPLU and send it with "Download PLU".'))
  }
  // a whole new file, from DrisPRO alone (no hotkeys)
  const fresh = async () => {
    const list = (items.data ?? []).filter((i) => num(i.price) > 0)
    saveFile(writeTxp(list.map((i) => newLine(undefined, i.plu, i.name, num(i.price), PIECE.test(i.uom ?? '')))), 'drispro-plu.TXP')
    await markSent(list.map((i) => ({ product_id: i.product_id, price: num(i.price) })))
  }

  return (
    <div className="grid gap-4">
      <PageHeader title={t('Prices for the scale')}
        description={t('For the Rongta scales (RTPLU program). Load the PLU file you use today: DrisPRO puts in the prices of DrisPRO and gives you back the same file, with the hotkeys and the other settings as they were. In RTPLU open it and send it to the scale with "Download PLU".')}
        actions={<>
          <input ref={input} type="file" accept=".txp,.TXP,.txt" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) void load(f); e.target.value = '' }} />
          {!!items.data?.length && <Button variant="outline" onClick={() => void fresh()}><Download /> {t('New file from DrisPRO')}</Button>}
          <Button onClick={() => input.current?.click()}><FileUp /> {t('Load the PLU file (.TXP)')}</Button>
        </>} />

      {items.isError ? <ErrorState error={items.error} onRetry={() => void items.refetch()} /> : !items.data ? <Skeleton className="h-64" /> : <>
        <div className="grid gap-3 sm:grid-cols-3">
          <StatCard label={t('Items with a PLU')} value={String(items.data.length)} hint={t('the PLU is on the item card')} />
          <StatCard label={t('Price changed since the last file')} value={String(sinceLast.length)} tone={sinceLast.length ? 'warning' : 'default'} hint={t('the scale still has the old price')} />
          {file ? <StatCard label={t('In the loaded file')} value={String(used.length)} hint={file.name} />
            : <StatCard label={t('In the loaded file')} value="—" hint={t('no file loaded yet')} />}
        </div>

        {!file && (
          <Card><CardContent className="overflow-x-auto p-0">
            {!items.data.length ? <EmptyState icon={Weight} title={t('No item has a PLU yet')}
              description={t('Load the PLU file of RTPLU: the items with the same name get their PLU in one go. Or write the PLU on the item card.')} /> : (
              <Table>
                <TableHeader><TableRow className="hover:bg-transparent">
                  <TableHead className="w-20">PLU</TableHead><TableHead>{t('Item')}</TableHead><TableHead className="text-right">{t('Price with VAT')}</TableHead>
                  <TableHead className="text-right">{t('In the last file')}</TableHead><TableHead />
                </TableRow></TableHeader>
                <TableBody>{items.data.map((i) => {
                  const diff = i.sent_price == null || Math.round(num(i.sent_price) * 100) !== Math.round(num(i.price) * 100)
                  return (
                    <TableRow key={i.product_id}>
                      <TableCell className="tabular">{i.plu}</TableCell>
                      <TableCell><Link to={`/inventory/products/${i.product_id}`} className="font-medium hover:text-primary hover:underline">{i.name}</Link><span className="ml-1.5 text-xs text-muted-foreground">{i.sku}</span></TableCell>
                      <TableCell className="text-right tabular">{formatMoney(i.price)}</TableCell>
                      <TableCell className="text-right tabular text-muted-foreground">{i.sent_price != null ? <>{formatMoney(i.sent_price)}<div className="text-[11px]">{formatDate(i.sent_at!, true)}</div></> : '—'}</TableCell>
                      <TableCell>{diff && <Badge variant="outline" className="border-warning/40 bg-warning/10 text-warning">{i.sent_price == null ? t('Never sent') : t('New price')}</Badge>}</TableCell>
                    </TableRow>
                  )
                })}</TableBody>
              </Table>
            )}
          </CardContent></Card>
        )}

        {file && <>
          <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-card p-3 text-[13px]">
            <span className="min-w-0 flex-1">
              {t('{changed} prices to change, {added} new PLUs to add, {link} items to link, {unknown} lines not in DrisPRO (left as they are).',
                { changed: changed.length, added: missing.length, link: toLink.length, unknown: unknown.length })}
            </span>
            <label className="flex items-center gap-2"><Switch checked={names} onCheckedChange={setNames} />{t('Also the names from DrisPRO')}</label>
            {toLink.length > 0 && can('inventory.write') && <Button variant="outline" loading={link.isPending} onClick={() => link.mutate()}><Save /> {tn(toLink.length, 'Give {n} item its PLU', 'Give {n} items their PLU')}</Button>}
            <Button onClick={() => void writeBack()}><Download /> {t('Download the file with the prices')}</Button>
            <Button variant="ghost" onClick={() => setFile(null)}>{t('Close the file')}</Button>
          </div>
          {toLink.length > 0 && <p className="-mt-2 text-xs text-muted-foreground">{t('Lines found by name or picked by hand get the price once their items have the PLU (the button above); then download the file again.')}</p>}

          <Card><CardContent className="overflow-x-auto p-0">
            <Table>
              <TableHeader><TableRow className="hover:bg-transparent">
                <TableHead className="w-20">PLU</TableHead><TableHead>{t('On the scale')}</TableHead><TableHead className="text-right">{t('Price on the scale')}</TableHead>
                <TableHead>{t('Item in DrisPRO')}</TableHead><TableHead className="text-right">{t('Price in DrisPRO')}</TableHead>
              </TableRow></TableHeader>
              <TableBody>{used.map((m) => {
                const newer = m.how === 'plu' && m.item?.price != null && num(m.item.price) > 0 && Math.round(num(m.item.price) * 100) !== Math.round(m.line.price * 100)
                return (
                  <TableRow key={m.index}>
                    <TableCell className="tabular">{m.line.lf}{m.line.hotkey > 0 && <div className="text-[11px] text-muted-foreground">{t('key {n}', { n: m.line.hotkey })}</div>}</TableCell>
                    <TableCell className="font-medium">{m.line.name}</TableCell>
                    <TableCell className="text-right tabular">{formatMoney(m.line.price)}</TableCell>
                    <TableCell className="min-w-[260px]">
                      {m.how === 'plu' ? <span>{m.item!.name}</span>
                        : <div className="grid gap-1">
                            <SearchSelect value={m.item?.variant_id ?? null} onChange={(v) => setPicked((x) => { const y = { ...x }; if (v) y[m.index] = v; else delete y[m.index]; return y })} placeholder={t('Choose the item')}
                              options={(variants.data ?? []).map((v) => ({ value: v.id, label: v.name, hint: v.sku, keywords: v.codes ? [v.codes] : undefined }))} />
                            {m.how === 'name' && <span className="text-[11px] text-muted-foreground">{t('found by the name: give it the PLU')}</span>}
                            {!m.item && <span className="text-[11px] text-muted-foreground">{t('not in DrisPRO: the line stays as it is')}</span>}
                          </div>}
                    </TableCell>
                    <TableCell className={cn('text-right tabular', newer && 'font-semibold text-primary')}>
                      {m.how === 'plu' && m.item?.price != null ? formatMoney(m.item.price) : '—'}
                      {newer && <div className="text-[11px] font-normal">{t('new price')}</div>}
                    </TableCell>
                  </TableRow>
                )
              })}</TableBody>
            </Table>
          </CardContent></Card>

          {missing.length > 0 && (
            <Card><CardContent className="p-0">
              <p className="border-b px-4 py-2.5 text-[13px] font-medium">{t('Added at the end of the file (they have a PLU in DrisPRO, not in the file)')}</p>
              <Table><TableBody>{missing.map((i) => (
                <TableRow key={i.product_id}><TableCell className="w-20 tabular">{i.plu}</TableCell><TableCell>{i.name}</TableCell><TableCell className="text-right tabular">{formatMoney(i.price)}</TableCell></TableRow>
              ))}</TableBody></Table>
            </CardContent></Card>
          )}
        </>}
      </>}
    </div>
  )
}
