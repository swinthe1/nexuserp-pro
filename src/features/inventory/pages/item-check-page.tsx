import { Barcode, ExternalLink, PackageSearch } from 'lucide-react'
import * as React from 'react'
import { Link } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { useCompany } from '@/app/company-provider'
import { ScanInput, scanFeedback } from '@/components/scan-input'
import { Card, CardContent } from '@/components/ui/card'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { ErrorState } from '@/components/error-state'
import { describeError } from '@/lib/errors'
import { t, td } from '@/i18n'
import { formatMoney } from '@/lib/utils'
import { ScanShell, useScanStatus } from '@/features/wms/components/scan-shell'
import { useMyWarehouseAccess, useWarehouses } from '../api'
import { useFindWhere, useItemWhere, whereKey, type WhereResult } from '../where'
import { WhereView } from '../components/unit-stock'

const HERE_KEY = 'drispro.check.unit'

/** Scan an item (Zebra, phone camera or keyboard): how much each store and warehouse has, and where to take it from */
export function ItemCheckPage() {
  const { companyId } = useCompany()
  const qc = useQueryClient()
  const find = useFindWhere()
  const st = useScanStatus()
  const warehouses = useWarehouses({ all: true })
  const units = (warehouses.data ?? []).filter((w) => w.is_active && w.warehouse_type !== 'transit')
  const access = useMyWarehouseAccess()
  const [here, setHere] = React.useState<string | null>(() => { try { return localStorage.getItem(HERE_KEY) } catch { return null } })
  // someone who works in one unit only: that is their unit
  React.useEffect(() => { if (!here && access.data?.length === 1) setHere(access.data[0]!) }, [here, access.data])
  const [variant, setVariant] = React.useState<string | null>(null)
  const [matches, setMatches] = React.useState<WhereResult['matches']>([])
  const q = useItemWhere(variant, here)
  const d = q.data

  const pickHere = (v: string) => {
    const x = v === 'all' ? null : v
    setHere(x)
    try { if (x) localStorage.setItem(HERE_KEY, x); else localStorage.removeItem(HERE_KEY) } catch { /* private window */ }
  }

  const onScan = async (code: string) => {
    try {
      const r = await find(code, here)
      if (r.found && r.item) {
        qc.setQueryData(whereKey(companyId, r.item.variant_id, here), r)
        setVariant(r.item.variant_id); setMatches([])
        scanFeedback('ok'); st.ok(`${r.item.sku} · ${r.item.name}`)
        return
      }
      if (r.matches?.length) { setMatches(r.matches); setVariant(null); scanFeedback('ok'); st.info(t('{n} items match “{q}”: tap one', { n: r.matches.length, q: code })); return }
      scanFeedback('error'); st.error(t('Unknown code “{code}”', { code }))
    } catch (e) { scanFeedback('error'); st.error(describeError(e)) }
  }

  return (
    <ScanShell title={t('Check item')}
      actions={(
        <Select value={here ?? 'all'} onValueChange={pickHere}>
          <SelectTrigger className="w-[220px]" aria-label={t('My unit')}><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t('All units')}</SelectItem>
            {units.map((w) => <SelectItem key={w.id} value={w.id}>{t('My unit: {name}', { name: td(w.name) })}</SelectItem>)}
          </SelectContent>
        </Select>
      )}>
      <ScanInput onScan={onScan} status={st.status} placeholder={t('Scan the item or type its name')} />

      {!!matches?.length && !variant && (
        <ul className="divide-y rounded-lg border bg-card">
          {matches.map((m) => (
            <li key={m.variant_id}>
              <button type="button" className="flex w-full items-center gap-3 px-3 py-2.5 text-left hover:bg-muted" onClick={() => { setVariant(m.variant_id); setMatches([]); st.clear() }}>
                <PackageSearch className="size-4 text-muted-foreground" /><span className="flex-1 text-[14px]">{m.name}</span><span className="font-mono text-xs text-muted-foreground">{m.sku}</span>
              </button>
            </li>))}
        </ul>
      )}
      {!!matches?.length && variant && (
        <button type="button" className="justify-self-start text-[13px] text-primary hover:underline" onClick={() => setVariant(null)}>{t('Back to the {n} matches', { n: matches.length })}</button>
      )}

      {!variant && !matches?.length && (
        <Card><CardContent className="grid justify-items-center gap-2 py-10 text-center">
          <Barcode className="size-10 text-muted-foreground" />
          <p className="max-w-sm text-[13px] text-muted-foreground">{t('Scan any item to see how much every store and warehouse has. When your unit is short, it tells you which unit to take it from.')}</p>
        </CardContent></Card>
      )}

      {variant && q.isLoading && <Skeleton className="h-64" />}
      {variant && q.isError && <ErrorState compact error={q.error} onRetry={() => void q.refetch()} />}
      {variant && d?.found && d.item && (
        <>
          <div className="flex flex-wrap items-start justify-between gap-3 rounded-lg border bg-card p-3">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2 text-lg font-semibold leading-tight">{d.item.name}
                {d.item.class && <Link to="/inventory/abc" title={t('ABC classification')} className="rounded-md bg-primary/10 px-1.5 py-0.5 font-mono text-xs font-semibold text-primary">{d.item.class}</Link>}</div>
              <div className="mt-0.5 flex flex-wrap gap-x-3 text-xs text-muted-foreground">
                <span className="font-mono">{d.item.sku}</span>{d.item.barcode && <span className="font-mono">{d.item.barcode}</span>}
                <span>{t('Price {price}', { price: formatMoney(d.item.price) })}</span>
              </div>
            </div>
            <Link to={`/inventory/products/${d.item.product_id}`} className="inline-flex items-center gap-1 text-[13px] text-primary hover:underline">{t('Item page')} <ExternalLink className="size-3.5" /></Link>
          </div>
          <WhereView data={d} />
        </>
      )}
    </ScanShell>
  )
}
