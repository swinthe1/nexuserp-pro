import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus } from 'lucide-react'
import * as React from 'react'
import { ensureScanCatalog, findOffline } from '@/lib/offline/catalog'
import { toast } from 'sonner'
import { useCompany } from '@/app/company-provider'
import { SearchSelect } from '@/components/search-select'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { unwrap } from '@/lib/errors'
import { supabase } from '@/lib/supabase'
import { formatDate } from '@/lib/utils'
import { useLocations, useLots, useVariantOptions, useVendors, useWarehouses } from '../api'
import { t, td } from '@/i18n'

const STORAGE_TYPES = new Set(['internal', 'receiving', 'putaway', 'picking', 'packing', 'shipping', 'quality', 'production'])

/** Product variant picker; Enter on an unknown query is treated as a scanned barcode */
export const VariantPicker = React.forwardRef<HTMLButtonElement, { value: string | null | undefined; onChange: (id: string | null) => void; disabled?: boolean; 'aria-invalid'?: boolean }>(
  function VariantPicker({ value, onChange, ...rest }, ref) {
    const { companyId } = useCompany()
    const { data = [] } = useVariantOptions()
    const options = React.useMemo(() => data.map((v) => ({ value: v.id, label: v.sku, hint: v.name, keywords: [v.name] })), [data])
    return (
      <SearchSelect
        ref={ref}
        value={value}
        onChange={onChange}
        options={options}
        placeholder={t('Product')}
        searchPlaceholder={t('Code, name or scan a barcode')}
        onUnmatchedEnter={async (code) => {
          const { data: hit, error } = navigator.onLine ? await supabase.rpc('find_variant_by_code', { p_company: companyId, p_code: code }) : { data: null, error: new Error('offline') }
          // without internet: the device's copy of the items
          const local = error ? (await ensureScanCatalog(companyId!), findOffline(companyId!, code)) : null
          if (local?.kind === 'variant') onChange(local.item.variant_id)
          else if (hit?.[0]?.variant_id) onChange(hit[0].variant_id)
          else toast.error(t('No product with barcode or code “{code}”', { code }))
        }}
        {...rest}
      />
    )
  },
)

export function LocationPicker({ warehouseId, value, onChange, disabled, ...rest }: {
  warehouseId?: string | null; value: string | null | undefined; onChange: (id: string | null) => void; disabled?: boolean; 'aria-invalid'?: boolean
}) {
  const { data = [] } = useLocations()
  const options = React.useMemo(
    () => data.filter((l) => l.warehouse_id && (!warehouseId || l.warehouse_id === warehouseId) && STORAGE_TYPES.has(l.location_type) && l.is_active)
      .map((l) => ({ value: l.id, label: l.code, hint: td(l.name), keywords: l.barcode ? [l.barcode] : [] })),
    [data, warehouseId],
  )
  return <SearchSelect value={value} onChange={onChange} options={options} placeholder={t('Location')} searchPlaceholder={t('Shelf code or scan')} disabled={disabled || !warehouseId} {...rest} />
}

export function WarehousePicker({ value, onChange, disabled, all, ...rest }: { value: string | null | undefined; onChange: (id: string | null) => void; disabled?: boolean; all?: boolean; 'aria-invalid'?: boolean }) {
  const { data = [] } = useWarehouses({ all })
  const options = data.filter((w) => w.is_active).map((w) => ({ value: w.id, label: td(w.name), hint: w.code }))
  return <SearchSelect value={value} onChange={onChange} options={options} placeholder={t('Warehouse')} disabled={disabled} {...rest} />
}

export function VendorPicker({ value, onChange, disabled, ...rest }: { value: string | null | undefined; onChange: (id: string | null) => void; disabled?: boolean; 'aria-invalid'?: boolean }) {
  const { data = [] } = useVendors()
  const options = data.map((v) => ({ value: v.id, label: v.name, hint: v.tax_number ?? v.code }))
  return <SearchSelect value={value} onChange={onChange} options={options} placeholder={t('Vendor')} clearable disabled={disabled} {...rest} />
}

export function LotPicker({ variantId, value, onChange, disabled, allowCreate }: {
  variantId?: string | null; value: string | null | undefined; onChange: (id: string | null) => void; disabled?: boolean; allowCreate?: boolean
}) {
  const { companyId } = useCompany()
  const qc = useQueryClient()
  const { data = [] } = useLots(variantId ?? undefined)
  const [open, setOpen] = React.useState(false)
  const [lotNumber, setLotNumber] = React.useState('')
  const [expiry, setExpiry] = React.useState('')
  const options = data.map((l) => ({ value: l.id, label: l.lot_number, hint: l.expiry_date ? t('expires {date}', { date: formatDate(l.expiry_date) }) : undefined }))
  const create = useMutation({
    mutationFn: async () => unwrap(await supabase.from('lots').insert({
      company_id: companyId, variant_id: variantId!, lot_number: lotNumber.trim(), expiry_date: expiry || null,
    }).select('id').single()),
    onSuccess: (row) => {
      void qc.invalidateQueries({ queryKey: ['inv', companyId, 'lots', variantId] })
      onChange(row.id)
      setOpen(false); setLotNumber(''); setExpiry('')
    },
  })
  return (
    <div className="flex gap-1">
      <SearchSelect value={value} onChange={onChange} options={options} placeholder={t('Lot')} clearable disabled={disabled || !variantId}
        emptyText={t('No lots for this product yet.')} onUnmatchedEnter={allowCreate ? (q) => { setLotNumber(q); setOpen(true) } : undefined} />
      {allowCreate && !disabled && (
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button type="button" variant="outline" size="icon" disabled={!variantId} aria-label={t('New lot')}><Plus /></Button>
          </DialogTrigger>
          <DialogContent className="max-w-sm">
            <DialogHeader><DialogTitle>{t('New lot')}</DialogTitle></DialogHeader>
            <form className="grid gap-3" onSubmit={(e) => { e.preventDefault(); if (lotNumber.trim()) create.mutate() }}>
              <div className="grid gap-1.5"><Label htmlFor="lot-no">{t('Lot or serial number')}</Label><Input id="lot-no" autoFocus value={lotNumber} onChange={(e) => setLotNumber(e.target.value)} /></div>
              <div className="grid gap-1.5"><Label htmlFor="lot-exp">{t('Expiry date')}</Label><Input id="lot-exp" type="date" value={expiry} onChange={(e) => setExpiry(e.target.value)} /></div>
              <DialogFooter><Button type="submit" loading={create.isPending} disabled={!lotNumber.trim()}>{t('Create lot')}</Button></DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      )}
    </div>
  )
}
