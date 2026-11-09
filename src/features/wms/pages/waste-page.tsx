import { useMutation, useQuery } from '@tanstack/react-query'
import { Send, Trash2 } from 'lucide-react'
import * as React from 'react'
import { toast } from 'sonner'
import { useCompany } from '@/app/company-provider'
import { ScanInput, scanFeedback } from '@/components/scan-input'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { describeError, unwrap } from '@/lib/errors'
import { msg, t, td } from '@/i18n'
import { supabase } from '@/lib/supabase'
import { cn, formatQty, num } from '@/lib/utils'
import { useWarehouses } from '@/features/inventory/api'
import { useResolveCode } from '../api'
import { QtyDialog, ScanShell, useScanStatus } from '../components/scan-shell'
import { formatQtyOf } from '@/lib/units'

const WH_KEY = 'drispro.wms.warehouse'
type Reason = 'waste' | 'damage' | 'expiry' | 'internal_use'
const REASONS: [Reason, string][] = [['waste', msg('Thrown away')], ['damage', msg('Damaged')], ['expiry', msg('Expired')], ['internal_use', msg('Used in the company')]]
type Line = { key: string; variantId: string; lotId: string | null; sku: string; name: string; qty: number; uom?: string | null }
type Fresh = { variant_id: string; sku: string; name: string; uom: string | null; plu: string | null; on_hand: number }

/**
 * Goods thrown away (fruit and vegetables, bread…), from the Zebra: scan the item, weigh it, type
 * the kilograms; at the end one press sends the batch. The stock manager's batch goes out of stock at
 * once; anyone else's waits for the stock manager. The director sees it against the sales.
 */
export function WastePage() {
  const { companyId } = useCompany()
  const resolve = useResolveCode()
  const st = useScanStatus()
  const warehouses = useWarehouses()
  const [wh, setWh] = React.useState<string | null>(() => { try { return localStorage.getItem(WH_KEY) } catch { return null } })
  const [reason, setReason] = React.useState<Reason>('waste')
  const [lines, setLines] = React.useState<Line[]>([])
  const [ask, setAsk] = React.useState<{ line: Line; initial: number } | null>(null)
  const [note, setNote] = React.useState('')
  const send = useMutation({
    mutationFn: async () => unwrap(await supabase.rpc('waste_submit', { p: { company_id: companyId, warehouse_id: wh, reason, note,
      lines: lines.map((l) => ({ variant_id: l.variantId, lot_id: l.lotId, quantity: l.qty })) } as never })) as unknown as { number: string; status: string },
    onSuccess: (r) => {
      scanFeedback('ok')
      toast.success(r.status === 'posted' ? t('{number}: out of stock', { number: r.number }) : t('{number}: sent to the stock manager to confirm', { number: r.number }))
      setLines([]); setNote(''); st.ok(t('Sent. Scan the next item.'))
    },
    onError: (e) => { scanFeedback('error'); st.error(describeError(e)) },
  })
  const whs = warehouses.data ?? []
  const unit = wh && whs.some((w) => w.id === wh) ? wh : whs.length === 1 ? whs[0]!.id : null
  // fruit and vegetables often carry no label: the store's fresh items, to find by name or PLU and tap
  const fresh = useQuery({ queryKey: ['wms', companyId, 'waste-items', unit], enabled: !!companyId && !!unit, staleTime: 5 * 60_000,
    queryFn: async () => { const r = await supabase.rpc('waste_items' as never, { p_company: companyId, p_warehouse: unit } as never); return r.error ? [] : (r.data as unknown as Fresh[]) } })
  const [find, setFind] = React.useState('')
  const shown = React.useMemo(() => {
    const q = find.trim().toLowerCase()
    const all = fresh.data ?? []
    const hit = q ? all.filter((f) => f.name.toLowerCase().includes(q) || f.sku.toLowerCase().includes(q) || (f.plu && f.plu === q.replace(/^0+/, ''))) : all.filter((f) => num(f.on_hand) > 0)
    return hit.slice(0, 24)
  }, [fresh.data, find])
  const pick = (f: Fresh) => {
    if (!unit) { st.error(t('Choose the store first')); return }
    const known = lines.find((l) => l.variantId === f.variant_id && !l.lotId)
    setAsk({ line: known ?? { key: `${f.variant_id}:`, variantId: f.variant_id, lotId: null, sku: f.sku, name: f.name, qty: 0, uom: f.uom }, initial: known?.qty || 1 })
  }

  const onScan = async (code: string) => {
    if (!unit) { scanFeedback('error'); st.error(t('Choose the store first')); return }
    const r = await resolve(code)
    if (r.kind === 'variant' || r.kind === 'lot') {
      const variantId = r.variantId
      const known = lines.find((l) => l.variantId === variantId && l.lotId === (r.kind === 'lot' ? r.lotId : null))
      const line = known ?? { key: `${variantId}:${r.kind === 'lot' ? r.lotId : ''}`, variantId, lotId: r.kind === 'lot' ? r.lotId : null,
        sku: r.kind === 'variant' ? r.sku : '', name: r.kind === 'variant' ? r.name : r.lotNumber, qty: 0 }
      scanFeedback('ok')
      // a scale's barcode carries the weight; otherwise ask for it
      setAsk({ line, initial: r.kind === 'variant' && r.qty && r.qty !== 1 ? r.qty : known?.qty || 1 })
      return
    }
    scanFeedback('error'); st.error(t('Unknown code “{code}”', { code }))
  }

  return (
    <ScanShell title={t('Thrown away|scanner')} back={{ href: '/wms', label: t('Warehouse floor') }}>
      <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
        <Select value={unit ?? ''} onValueChange={(v) => { setWh(v); try { localStorage.setItem(WH_KEY, v) } catch { /* this device only */ } }}>
          <SelectTrigger aria-label={t('Store')}><SelectValue placeholder={t('Choose the store')} /></SelectTrigger>
          <SelectContent>{whs.map((w) => <SelectItem key={w.id} value={w.id}>{td(w.name)}</SelectItem>)}</SelectContent>
        </Select>
        <div className="grid grid-cols-4 gap-1 rounded-lg bg-muted p-1">
          {REASONS.map(([k, label]) => (
            <button key={k} type="button" onClick={() => setReason(k)}
              className={cn('h-9 rounded-md px-2 text-[12.5px] font-medium', reason === k ? 'bg-background shadow-sm' : 'text-muted-foreground')}>{t(label)}</button>
          ))}
        </div>
      </div>
      <ScanInput onScan={onScan} status={st.status} placeholder={unit ? t('Scan the item, then type the weight') : t('Choose the store first')} />
      {!!fresh.data?.length && (
        <div className="grid gap-2">
          <Input value={find} onChange={(e) => setFind(e.target.value)} placeholder={t('No label? Find it by name or PLU')} aria-label={t('Find a fresh item')} />
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {shown.map((f) => (
              <button key={f.variant_id} type="button" onClick={() => pick(f)} className="rounded-lg border bg-card px-3 py-2 text-left hover:border-primary/50">
                <div className="truncate text-[13px] font-medium">{f.name}</div>
                <div className="text-xs text-muted-foreground">{[f.plu && `PLU ${f.plu}`, formatQty(num(f.on_hand), f.uom)].filter(Boolean).join(' · ')}</div>
              </button>
            ))}
          </div>
        </div>
      )}
      {lines.length > 0 && (
        <div className="grid gap-2 rounded-xl border bg-card p-3">
          {lines.map((l) => (
            <div key={l.key} className="flex items-center justify-between gap-3 rounded-lg border px-3 py-2">
              <button type="button" className="min-w-0 text-left" onClick={() => setAsk({ line: l, initial: l.qty })}>
                <div className="truncate font-medium">{l.name}</div><div className="text-xs text-muted-foreground">{l.sku}</div></button>
              <div className="flex items-center gap-2">
                <button type="button" className="text-xl font-semibold tabular" onClick={() => setAsk({ line: l, initial: l.qty })}>{formatQtyOf(l.qty, l.variantId)}</button>
                <Button variant="ghost" size="icon" className="size-8" aria-label={t('Remove {sku}', { sku: l.sku || l.name })} onClick={() => setLines((x) => x.filter((y) => y.key !== l.key))}><Trash2 /></Button>
              </div>
            </div>
          ))}
          <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder={t('Note (not required), e.g. rotten, crushed in transport')} aria-label={t('Note')} />
          <Button size="lg" className="h-12" disabled={!unit || send.isPending} loading={send.isPending} onClick={() => send.mutate()}>
            <Send /> {t('Send {n} items', { n: lines.length })}</Button>
        </div>
      )}
      <QtyDialog open={!!ask} title={ask ? t('{name}: how much?', { name: ask.line.name }) : ''} description={ask?.line.uom && /^(kg|kgm)$/i.test(ask.line.uom) ? t('Weigh it and type the kilograms.') : t('Weigh it and type the kilograms, or the pieces.')}
        initial={ask?.initial ?? 1} onClose={() => setAsk(null)} submitLabel={t('Add')}
        onSubmit={(q) => {
          const l = ask!.line
          setLines((x) => q <= 0 ? x.filter((y) => y.key !== l.key) : x.some((y) => y.key === l.key) ? x.map((y) => (y.key === l.key ? { ...y, qty: q } : y)) : [...x, { ...l, qty: q }])
          if (q > 0) st.ok(`${l.name}: ${formatQtyOf(q, l.variantId)}`)
          setAsk(null)
        }} />
    </ScanShell>
  )
}
