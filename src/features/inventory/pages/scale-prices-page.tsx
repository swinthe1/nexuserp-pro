import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { CircleAlert, CircleCheck, Clock, Download, FileUp, Link2, Pencil, Plus, Save, Weight } from 'lucide-react'
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
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { t, td, tn, tServer } from '@/i18n'
import { describeError, unwrap } from '@/lib/errors'
import { looksLikeTxp, nameKey, newLine, parseTxp, type TxpLine, withPrice, writeTxp } from '@/lib/rongta-plu'
import { supabase, supabaseAnonKey, supabaseUrl } from '@/lib/supabase'
import { scaleInstaller } from '@/lib/rongta-agent'
import { cn, formatDate, formatMoney, num } from '@/lib/utils'
import { useVariantOptions, useWarehouses } from '../api'

type ScaleItem = { product_id: string; variant_id: string; sku: string; name: string; plu: string; uom: string | null; price: number; sent_price: number | null; sent_at: string | null }
/** a line of the file and the item of DrisPRO it is: by its PLU, by the same name, or picked by hand */
type Match = { line: TxpLine; index: number; item: { product_id: string; variant_id: string; name: string; price: number | null } | null; how: 'plu' | 'name' | 'picked' | null }

const PATH_EXAMPLE = String.raw`C:\RLS1000\rtplu_EN.txp`
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
        description={t('The Rongta scales take the items with a PLU and their prices from DrisPRO. With the automatic link it happens by itself; without it, load here the PLU file of RTPLU and DrisPRO gives it back with its prices, the hotkeys and the other settings as they were.')}
        actions={<>
          <input ref={input} type="file" accept=".txp,.TXP,.txt" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) void load(f); e.target.value = '' }} />
          {!!items.data?.length && <Button variant="outline" onClick={() => void fresh()}><Download /> {t('New file from DrisPRO')}</Button>}
          <Button onClick={() => input.current?.click()}><FileUp /> {t('Load the PLU file (.TXP)')}</Button>
        </>} />

      <ScalesCard />

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

type Scale = { id: string; name: string; warehouse_id: string | null; warehouse: string | null; ip: string; port: number; is_active: boolean; agent: string | null
  has_key?: boolean; file_path?: string | null
  last_seen_at: string | null; last_sync_at: string | null; last_error: string | null; items: number; pending: number }
type Scales = { auto_plu: boolean; next_plu: string; scales: Scale[] }

/**
 * The scales of the company: each one with the computer of the store that keeps it in sync (the DrisPRO program
 * for Windows sends every new item and price within seconds) and how it stands now.
 */
function ScalesCard() {
  const { companyId, can } = useCompany()
  const qc = useQueryClient()
  const q = useQuery({ queryKey: ['inv', companyId, 'scales'], enabled: !!companyId, refetchInterval: 15_000,
    // a server not updated yet has no scales: the card is simply not shown
    queryFn: async () => { const r = await supabase.rpc('scales_list', { p_company: companyId! }); return r.error ? null : (r.data as unknown as Scales) } })
  const [edit, setEdit] = React.useState<Partial<Scale> | null>(null)
  const [link, setLink] = React.useState<Scale | null>(null)
  const auto = useMutation({
    mutationFn: async (v: boolean) => unwrap(await supabase.rpc('scale_settings_save', { p_company: companyId!, p_auto_plu: v })),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['inv', companyId, 'scales'] }),
    onError: (e) => toast.error(describeError(e)),
  })
  const d = q.data
  if (!d) return null
  const state = (s: Scale) => {
    if (!s.is_active) return { icon: Clock, tone: 'text-muted-foreground', text: t('Turned off') }
    if (!s.has_key) return { icon: Clock, tone: 'text-warning', text: t('Not linked yet: install the automatic link on the computer where RLS1000 runs') }
    if (!s.last_seen_at) return { icon: Clock, tone: 'text-warning', text: t('Waiting for the computer of the store: run the installer there') }
    if (s.last_error) return { icon: CircleAlert, tone: 'text-destructive', text: tServer(s.last_error) }
    if (Date.now() - new Date(s.last_seen_at).getTime() > 10 * 60_000)
      return { icon: CircleAlert, tone: 'text-destructive', text: t('The computer of the store has not answered since {time}: is it on, with internet?', { time: formatDate(s.last_seen_at, true) }) }
    if (s.pending > 0) return { icon: Clock, tone: 'text-warning', text: tn(s.pending, '{n} change on its way (within a minute)', '{n} changes on their way (within a minute)') }
    return { icon: CircleCheck, tone: 'text-primary', text: t('In sync · {time}', { time: s.last_sync_at ? formatDate(s.last_sync_at, true) : '—' }) }
  }
  return (
    <Card><CardContent className="grid gap-3 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1"><div className="font-medium">{t('Scales')}</div>
          <p className="text-[13px] text-muted-foreground">{t('Every item with a PLU and every new price goes to the scale by itself, within a minute or two: a small DrisPRO service on the computer where RLS1000 runs writes it into the PLU file, and RLS1000 sends it to the scale.')}</p></div>
        {can('inventory.write') && <Button variant="outline" onClick={() => setEdit({ port: 5001, is_active: true })}><Plus /> {t('Add a scale')}</Button>}
      </div>
      {d.scales.length > 0 && (
        <div className="grid gap-2">{d.scales.map((s) => {
          const st = state(s)
          return (
            <div key={s.id} className="flex flex-wrap items-center gap-3 rounded-md border px-3 py-2 text-[13px]">
              <Weight className="size-4 text-muted-foreground" />
              <div className="min-w-0 flex-1"><span className="font-medium">{s.name}</span>
                <span className="ml-1.5 text-muted-foreground">{s.warehouse ? `${td(s.warehouse)} · ` : ''}{s.ip}{s.agent ? ` · ${s.agent}` : ''}</span>
                <div className={cn('flex items-center gap-1.5 text-xs', st.tone)}><st.icon className="size-3.5" />{st.text}</div></div>
              <span className="text-xs text-muted-foreground">{tn(s.items, '{n} item on it', '{n} items on it')}</span>
              {can('inventory.write') && <Button size="sm" variant={s.has_key ? 'ghost' : 'default'} onClick={() => setLink(s)}><Link2 /> {s.has_key ? t('Link again') : t('Automatic link')}</Button>}
              {can('inventory.write') && <Button size="sm" variant="ghost" onClick={() => setEdit(s)} aria-label={t('Edit')}><Pencil /></Button>}
            </div>
          )
        })}</div>
      )}
      <label className="flex items-center justify-between gap-3 rounded-md border p-3 text-[13px]">
        <span><span className="font-medium">{t('Items by the kilogram get a PLU by themselves')}</span>
          <span className="block text-muted-foreground">{t('A new item sold by the kilogram gets the next free PLU (now {n}) and goes to the scales. Needs at least one scale.', { n: d.next_plu })}</span></span>
        <Switch checked={d.auto_plu} disabled={!can('inventory.write') || auto.isPending} onCheckedChange={(v) => auto.mutate(v)} />
      </label>
      {edit && <ScaleDialog scale={edit} onClose={() => setEdit(null)} />}
      {link && <LinkDialog scale={link} onClose={() => setLink(null)} />}
    </CardContent></Card>
  )
}

function ScaleDialog({ scale, onClose }: { scale: Partial<Scale>; onClose: () => void }) {
  const { companyId } = useCompany()
  const qc = useQueryClient()
  const warehouses = useWarehouses()
  const [name, setName] = React.useState(scale.name ?? '')
  const [wh, setWh] = React.useState(scale.warehouse_id ?? '')
  const [ip, setIp] = React.useState(scale.ip ?? '')
  const [port, setPort] = React.useState(String(scale.port ?? 5001))
  const [active, setActive] = React.useState(scale.is_active ?? true)
  const ipOk = /^\d{1,3}(\.\d{1,3}){3}$/.test(ip.trim())
  const save = useMutation({
    mutationFn: async () => unwrap(await supabase.rpc('scale_save', { p: { company_id: companyId, id: scale.id ?? null, name, warehouse_id: wh || null, ip: ip.trim(), port: Number(port) || 5001, is_active: active } as never })),
    onSuccess: () => { toast.success(t('Saved')); void qc.invalidateQueries({ queryKey: ['inv', companyId, 'scales'] }); onClose() },
    onError: (e) => toast.error(describeError(e)),
  })
  return (
    <Dialog open onOpenChange={(o) => !o && !save.isPending && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>{scale.id ? scale.name : t('Add a scale')}</DialogTitle>
          <DialogDescription>{t('The address of the scale in the network of the store: on the scale, or in RLS1000 under "Scale No./IP".')}</DialogDescription></DialogHeader>
        <form className="grid gap-3" onSubmit={(e) => { e.preventDefault(); if (name.trim() && ipOk) save.mutate() }}>
          <div className="grid gap-1.5"><Label htmlFor="sc-name">{t('Name')}</Label><Input id="sc-name" value={name} onChange={(e) => setName(e.target.value)} placeholder={t('e.g. Fruit and vegetables scale')} /></div>
          <div className="grid gap-1.5"><Label>{t('Unit|store')}</Label>
            <Select value={wh} onValueChange={setWh}><SelectTrigger><SelectValue placeholder={t('Choose')} /></SelectTrigger>
              <SelectContent>{(warehouses.data ?? []).map((w) => <SelectItem key={w.id} value={w.id}>{td(w.name)}</SelectItem>)}</SelectContent></Select></div>
          <div className="grid grid-cols-[1fr_110px] gap-3">
            <div className="grid gap-1.5"><Label htmlFor="sc-ip">{t('IP address')}</Label><Input id="sc-ip" inputMode="decimal" value={ip} onChange={(e) => setIp(e.target.value)} placeholder="192.168.1.150" /></div>
            <div className="grid gap-1.5"><Label htmlFor="sc-port">{t('Port')}</Label><Input id="sc-port" inputMode="numeric" value={port} onChange={(e) => setPort(e.target.value)} /></div>
          </div>
          <label className="flex items-center justify-between gap-3 rounded-md border p-3 text-[13px]"><span>{t('Active')}</span><Switch checked={active} onCheckedChange={setActive} /></label>
          <DialogFooter><Button type="button" variant="ghost" onClick={onClose}>{t('Cancel')}</Button>
            <Button type="submit" loading={save.isPending} disabled={!name.trim() || !ipOk}>{t('Save')}</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

/** the installer of the automatic link for one scale: a new key, the path of the PLU file of RLS1000, the steps */
function LinkDialog({ scale, onClose }: { scale: Scale; onClose: () => void }) {
  const qc = useQueryClient()
  const { companyId } = useCompany()
  const [path, setPath] = React.useState(scale.file_path ?? '')
  const ok = /^[a-z]:\\.+\.txp$/i.test(path.trim())
  const make = useMutation({
    mutationFn: async () => {
      const key = unwrap(await supabase.rpc('scale_agent_key', { p_scale: scale.id, p_file_path: path.trim() })) as unknown as string
      const text = scaleInstaller({ api: supabaseUrl, anon: supabaseAnonKey, key, file: path.trim(), scaleId: scale.id, scaleName: scale.name })
      saveFile(text, `DrisPRO-peshorja-${scale.name.normalize('NFD').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'rongta'}.bat`)
    },
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['inv', companyId, 'scales'] }); toast.success(t('The installer is downloaded: run it on the computer where RLS1000 runs.')) },
    onError: (e) => toast.error(describeError(e)),
  })
  return (
    <Dialog open onOpenChange={(o) => !o && !make.isPending && onClose()}>
      <DialogContent className="max-h-[92vh] max-w-xl overflow-y-auto">
        <DialogHeader><DialogTitle>{t('Automatic link: {name}', { name: scale.name })}</DialogTitle>
          <DialogDescription>{t('Once, on the computer of the store where RLS1000 runs. Then every item with a PLU and every new price reaches the scale by itself.')}</DialogDescription></DialogHeader>
        <div className="grid gap-1.5">
          <Label htmlFor="lk-path">{t('The PLU file of RLS1000 on that computer')}</Label>
          <Input id="lk-path" value={path} onChange={(e) => setPath(e.target.value)} placeholder={PATH_EXAMPLE} className="font-mono text-[13px]" />
          <span className="text-xs text-muted-foreground">{t('In RLS1000 it is the file that opens with the program (File → Save as shows where it is), usually rtplu_EN.txp in the RLS1000 folder.')}</span>
        </div>
        <ol className="grid list-decimal gap-1.5 pl-5 text-[13px]">
          <li>{t('Download the installer and run it on that computer (if Windows warns: More info → Run anyway). It installs a small service that runs every minute.')}</li>
          <li>{t('In RLS1000: Set auto upload & download time → Update PLU → Cycle, every 30 seconds. Leave RLS1000 open (put it in Startup so it opens with Windows).')}</li>
          <li>{t('Here the scale shows “In sync” within a minute. From then on nobody needs RTPLU for the prices.')}</li>
        </ol>
        {scale.has_key && <p className="rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-[13px] text-warning">{t('A new installer makes a new key: the one installed before stops working, so run the new one on that computer.')}</p>}
        <DialogFooter><Button variant="ghost" onClick={onClose}>{t('Close')}</Button>
          <Button loading={make.isPending} disabled={!ok} onClick={() => make.mutate()}><Download /> {t('Download the installer')}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
