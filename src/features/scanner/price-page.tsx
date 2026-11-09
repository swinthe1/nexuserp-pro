import { useMutation } from '@tanstack/react-query'
import { Check, ExternalLink } from 'lucide-react'
import * as React from 'react'
import { Link } from 'react-router-dom'
import { toast } from 'sonner'
import { useCompany } from '@/app/company-provider'
import { ScanInput, scanFeedback } from '@/components/scan-input'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { describeError, unwrap } from '@/lib/errors'
import { supabase } from '@/lib/supabase'
import { t } from '@/i18n'
import { formatMoney, formatQty } from '@/lib/utils'
import { ScanShell, useScanStatus } from '@/features/wms/components/scan-shell'
import { useFindWhere } from '@/features/inventory/where'
import { scannerUnit } from './scanner-home'
import { formatQtyOf } from '@/lib/units'

type Item = { variant_id: string; sku: string; name: string; price: number; vat_rate: number; cost: number; category: string | null; stock: number }
const r2 = (n: number) => Math.round(n * 100) / 100

/** Scan an item: its selling price with and without VAT; a new price goes onto the levelling a manager posts */
export function ScannerPricePage() {
  const { companyId, can } = useCompany()
  const find = useFindWhere()
  const st = useScanStatus()
  const unit = scannerUnit()
  const [item, setItem] = React.useState<Item | null>(null)
  const [matches, setMatches] = React.useState<{ variant_id: string; sku: string; name: string }[]>([])
  const [price, setPrice] = React.useState('')
  const [level, setLevel] = React.useState<{ id: string; lines: number } | null>(null)
  const canChange = can('inventory.write')

  const load = async (variant: string) => {
    const rows = unwrap(await supabase.rpc('price_level_items', { p_company: companyId!, p_variants: [variant], p_warehouse: unit as string })) as unknown as Item[]
    const x = rows[0]; if (!x) return
    setItem({ ...x, price: Number(x.price), vat_rate: Number(x.vat_rate), cost: Number(x.cost), stock: Number(x.stock) })
    setPrice(''); setMatches([])
  }
  const onScan = async (code: string) => {
    try {
      const r = await find(code, unit)
      if (r.found && r.item) { await load(r.item.variant_id); scanFeedback('ok'); st.ok(`${r.item.sku} · ${r.item.name}`); return }
      if (r.matches?.length) { setMatches(r.matches); setItem(null); scanFeedback('ok'); st.info(t('{n} items match “{q}”: tap one', { n: r.matches.length, q: code })); return }
      scanFeedback('error'); st.error(t('Unknown code “{code}”', { code }))
    } catch (e) { scanFeedback('error'); st.error(describeError(e)) }
  }
  const gross = item ? r2(item.price * (1 + item.vat_rate / 100)) : 0
  const newGross = Number(price.replace(',', '.'))
  const newNet = item && newGross > 0 ? Math.round(newGross / (1 + item.vat_rate / 100) * 10000) / 10000 : 0
  const margin = (net: number) => item && item.cost > 0 && net > 0 ? (net - item.cost) / item.cost * 100 : null

  const add = useMutation({
    mutationFn: async () => unwrap(await supabase.rpc('level_add_line', { p_company: companyId!, p_variant: item!.variant_id, p_new_price: newNet, p_warehouse: unit ?? undefined })) as unknown as { id: string; lines: number },
    onSuccess: (r) => { setLevel(r); scanFeedback('ok'); toast.success(t('{name}: {price} goes onto the levelling', { name: item!.name, price: formatMoney(newGross) })); setPrice('') },
    onError: (e) => { scanFeedback('error'); toast.error(describeError(e)) },
  })

  return (
    <ScanShell title={t('Price|scanner')}>
      <ScanInput onScan={onScan} status={st.status} placeholder={t('Scan the item or type its name')} />
      {!!matches.length && (
        <ul className="divide-y rounded-lg border bg-card">
          {matches.map((m) => (
            <li key={m.variant_id}><button type="button" className="flex w-full items-center gap-3 px-3 py-3 text-left text-[14px] hover:bg-muted" onClick={() => void load(m.variant_id)}>
              <span className="flex-1">{m.name}</span><span className="font-mono text-xs text-muted-foreground">{m.sku}</span></button></li>))}
        </ul>
      )}
      {item && (
        <div className="grid gap-3 rounded-xl border bg-card p-4">
          <div><div className="text-lg font-semibold leading-tight">{item.name}</div><div className="font-mono text-xs text-muted-foreground">{item.sku}</div></div>
          <div className="grid grid-cols-2 gap-3">
            <div><div className="text-xs text-muted-foreground">{t('Price with VAT')}</div><div className="text-3xl font-semibold tabular">{formatMoney(gross)}</div></div>
            <div><div className="text-xs text-muted-foreground">{t('Without VAT ({rate} %)', { rate: item.vat_rate })}</div><div className="text-xl tabular">{formatMoney(r2(item.price))}</div></div>
            <div><div className="text-xs text-muted-foreground">{unit ? t('In stock here') : t('In stock')}</div><div className="text-xl tabular">{formatQtyOf(item.stock, item.variant_id)}</div></div>
            {canChange && <div><div className="text-xs text-muted-foreground">{t('Margin on the cost')}</div>
              <div className="text-xl tabular">{margin(item.price) == null ? '—' : `${formatQty(Math.round(margin(item.price)! * 10) / 10)} %`}</div></div>}
          </div>
          {canChange && (
            <form className="grid gap-2 border-t pt-3" onSubmit={(e) => { e.preventDefault(); if (newGross > 0) add.mutate() }}>
              <Label htmlFor="sc-price">{t('New price with VAT')}</Label>
              <div className="flex gap-2">
                <Input id="sc-price" inputMode="decimal" className="h-12 text-right text-xl tabular" value={price} onChange={(e) => setPrice(e.target.value)} placeholder={formatMoney(gross)} />
                <Button type="submit" className="h-12" disabled={!(newGross > 0)} loading={add.isPending}><Check /> {t('Add')}</Button>
              </div>
              {newGross > 0 && <p className="text-xs text-muted-foreground">{t('Without VAT {net} · margin on the cost {m}', { net: formatMoney(newNet), m: margin(newNet) == null ? '—' : `${formatQty(Math.round(margin(newNet)! * 10) / 10)} %` })}</p>}
              <p className="text-xs text-muted-foreground">{t('The new price goes onto your levelling from the scanner; it changes when a manager posts it.')}</p>
            </form>
          )}
        </div>
      )}
      {level && (
        <Link to={`/inventory/levelling/${level.id}`} className="flex items-center justify-between rounded-xl border border-primary/40 bg-primary/[0.05] p-3 text-[14px]">
          <span>{t('Levelling from the scanner: {n} items', { n: level.lines })}</span><ExternalLink className="size-4 text-primary" />
        </Link>
      )}
    </ScanShell>
  )
}
