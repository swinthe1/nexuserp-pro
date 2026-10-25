import { ArrowDown, MapPin, Trash2 } from 'lucide-react'
import * as React from 'react'
import { toast } from 'sonner'
import { ScanInput, scanFeedback } from '@/components/scan-input'
import { Button } from '@/components/ui/button'
import { describeError } from '@/lib/errors'
import { msg, t, tn } from '@/i18n'
import { cn, formatDate, formatQty } from '@/lib/utils'
import type { LocationRow } from '@/features/inventory/api'
import { useBinStock, useMoveStock, useResolveCode, type BinStock } from '../api'
import { QtyDialog, ScanShell, useScanStatus } from '../components/scan-shell'

type Item = { key: string; variantId: string; lotId: string | null; sku: string; name: string; lot: string | null; qty: number; free: number }

/** Three scans: source bin → items → destination bin */
export function MovePage() {
  const resolve = useResolveCode()
  const move = useMoveStock()
  const st = useScanStatus()
  const [from, setFrom] = React.useState<LocationRow | null>(null)
  const [items, setItems] = React.useState<Item[]>([])
  const [edit, setEdit] = React.useState<Item | null>(null)
  const bin = useBinStock(from?.id)
  const free = (s: BinStock) => Number(s.on_hand) - Number(s.reserved)

  const addItem = (variantId: string, lotId: string | null, inc: number) => {
    const rows = (bin.data ?? []).filter((s) => s.variant_id === variantId && (lotId == null || s.lot_id === lotId) && free(s) > 0)
      .sort((a, b) => (a.lot?.expiry_date ?? '9999').localeCompare(b.lot?.expiry_date ?? '9999'))
    const row = rows[0]
    if (!row) { scanFeedback('error'); st.error(t('Nothing free of that item at {code}', { code: from!.code })); return }
    const key = `${variantId}:${row.lot_id ?? ''}`
    const cur = items.find((i) => i.key === key)
    const next = (cur?.qty ?? 0) + inc
    if (next > free(row)) { scanFeedback('error'); st.error(t('Only {n} free at {code}', { n: formatQty(free(row)), code: from!.code })); return }
    setItems((l) => cur ? l.map((i) => (i.key === key ? { ...i, qty: next } : i))
      : [...l, { key, variantId, lotId: row.lot_id, sku: row.variant?.sku ?? '', name: row.variant?.name ?? '', lot: row.lot?.lot_number ?? null, qty: next, free: free(row) }])
    scanFeedback('ok'); st.ok(`${row.variant?.sku}: ${formatQty(next)}`)
  }

  const onScan = async (code: string) => {
    const r = await resolve(code)
    if (r.kind === 'location') {
      if (!from || !items.length) { setFrom(r.location); setItems([]); scanFeedback('ok'); st.info(t('From {code}: scan the items to move', { code: r.location.code })); return }
      if (r.location.id === from.id) { scanFeedback('error'); st.error(t('Scan a different shelf as the destination')); return }
      try {
        await move.mutateAsync({ from: from.id, to: r.location.id, items: items.map((i) => ({ variant_id: i.variantId, lot_id: i.lotId, quantity: i.qty })) })
        scanFeedback('ok'); toast.success(tn(items.length, 'Moved {n} item {from} → {to}', 'Moved {n} items {from} → {to}', { from: from.code, to: r.location.code }))
        st.ok(t('Done. Scan the next shelf to move from.')); setItems([]); setFrom(null)
      } catch (e) { scanFeedback('error'); st.error(describeError(e)) }
      return
    }
    if (!from) { scanFeedback('error'); st.error(t('Start by scanning the shelf the goods are on')); return }
    if (r.kind === 'variant') { addItem(r.variantId, null, r.qty); return }
    if (r.kind === 'lot') { addItem(r.variantId, r.lotId, 1); return }
    scanFeedback('error'); st.error(t('Unknown code “{code}”', { code }))
  }

  const step = !from ? 1 : !items.length ? 2 : 3
  return (
    <ScanShell title={t('Move stock')} back={{ href: '/wms', label: t('Warehouse floor') }}>
      <ScanInput onScan={onScan} status={st.status}
        placeholder={step === 1 ? t('Scan the shelf to move from') : step === 2 ? t('Scan the items to move') : t('Scan more items, or the shelf to move to')} />
      <ol className="grid grid-cols-3 gap-2 text-[13px]">
        {[msg('From shelf'), msg('Items'), msg('To shelf')].map((s, i) => (
          <li key={s} className={cn('rounded-lg border px-3 py-2', step === i + 1 ? 'border-primary bg-primary/5 font-medium text-primary' : step > i + 1 ? 'text-muted-foreground' : 'text-muted-foreground/70')}>
            <span className="tabular">{i + 1}.</span> {t(s)}</li>
        ))}
      </ol>
      {from && (
        <div className="grid gap-2 rounded-xl border bg-card p-4">
          <div className="flex items-center justify-between"><div className="flex items-center gap-2 font-mono text-xl font-semibold"><MapPin className="size-5 text-primary" />{from.code}</div>
            <Button variant="ghost" size="sm" onClick={() => { setFrom(null); setItems([]); st.clear() }}>{t('Change|choice')}</Button></div>
          {items.length > 0 && <div className="grid gap-1.5">
            {items.map((i) => (
              <div key={i.key} className="flex items-center justify-between gap-3 rounded-lg border px-3 py-2">
                <button type="button" className="min-w-0 text-left" onClick={() => setEdit(i)}><div className="truncate font-medium">{i.name}</div>
                  <div className="text-xs text-muted-foreground">{i.sku}{i.lot ? ` · ${t('Lot {lot}', { lot: i.lot })}` : ''} · {t('{n} free', { n: formatQty(i.free) })}</div></button>
                <div className="flex items-center gap-2"><button type="button" className="text-xl font-semibold tabular" onClick={() => setEdit(i)}>{formatQty(i.qty)}</button>
                  <Button variant="ghost" size="icon" className="size-8" aria-label={t('Remove {sku}', { sku: i.sku })} onClick={() => setItems((l) => l.filter((x) => x.key !== i.key))}><Trash2 /></Button></div>
              </div>
            ))}
            <div className="flex items-center justify-center gap-2 py-1 text-[13px] text-muted-foreground"><ArrowDown className="size-4" /> {t('scan the shelf to move to')}</div>
          </div>}
          {!items.length && <div className="grid gap-1 text-[13px]">
            <div className="text-muted-foreground">{t('On this shelf')}</div>
            {(bin.data ?? []).map((s) => (
              <button key={s.id} type="button" className="flex justify-between rounded px-2 py-1 text-left hover:bg-muted" disabled={free(s) <= 0} onClick={() => addItem(s.variant_id, s.lot_id, 1)}>
                <span>{s.variant?.sku} · {s.variant?.name}{s.lot ? ` · ${s.lot.lot_number}${s.lot.expiry_date ? ` (${formatDate(s.lot.expiry_date)})` : ''}` : ''}</span>
                <span className="tabular">{formatQty(s.on_hand)}{Number(s.reserved) ? ` · ${t('{n} reserved', { n: formatQty(s.reserved) })}` : ''}</span>
              </button>
            ))}
            {!bin.isLoading && !bin.data?.length && <div className="text-muted-foreground">{t('Empty')}</div>}
          </div>}
        </div>
      )}
            <QtyDialog open={!!edit} title={edit ? t('{sku} to move', { sku: edit.sku }) : ''} initial={edit?.qty ?? 0} max={edit?.free} onClose={() => setEdit(null)}
        onSubmit={(q) => { setItems((l) => q ? l.map((i) => (i.key === edit!.key ? { ...i, qty: q } : i)) : l.filter((i) => i.key !== edit!.key)); setEdit(null) }} />
    </ScanShell>
  )
}
