import { MapPin, Pencil, Plus, Trash2, Warehouse as WarehouseIcon } from 'lucide-react'
import * as React from 'react'
import { toast } from 'sonner'
import { z } from 'zod'
import { Can, useCompany } from '@/app/company-provider'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { EmptyState } from '@/components/empty-state'
import { PageHeader } from '@/components/page-header'
import { SimpleFormDialog } from '@/components/simple-form-dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { cn, formatMoney, num } from '@/lib/utils'
import { useLocations, useMasterData, useStockLevels, useWarehouses, type LocationRow } from '../api'
import { msg, t, td, tEnum, tn } from '@/i18n'
import { ErrorState } from '@/components/error-state'

const warehouseSchema = z.object({
  code: z.string().trim().min(1, msg('Enter a code')).max(12),
  name: z.string().trim().min(2, msg('Enter a name')),
  warehouse_type: z.enum(['warehouse', 'store', 'production', 'transit']),
  city: z.string().trim().optional(),
  is_active: z.boolean(),
})
const LOCATION_TYPES = ['internal', 'receiving', 'picking', 'putaway', 'packing', 'shipping', 'quality', 'production', 'view'] as const
const locationSchema = z.object({
  code: z.string().trim().min(1, msg('Enter a code')).max(40),
  name: z.string().trim().min(1, msg('Enter a name')),
  location_type: z.enum(LOCATION_TYPES),
  parent_id: z.string().uuid().nullable().optional(),
  barcode: z.string().trim().optional(),
  is_pickable: z.boolean(),
})

export function WarehousesPage() {
  const { company } = useCompany()
  const warehouses = useWarehouses()
  const locations = useLocations()
  const levels = useStockLevels()
  const wh = useMasterData('warehouses')
  const loc = useMasterData('warehouse_locations')
  const [selected, setSelected] = React.useState<string | null>(null)
  const current = warehouses.data?.find((w) => w.id === selected) ?? warehouses.data?.[0]

  const valueBy = (key: 'warehouse_id' | 'location_id', id: string) => (levels.data ?? []).filter((l) => l[key] === id).reduce((s, l) => s + num(l.stock_value), 0)
  const whLocations = (locations.data ?? []).filter((l) => l.warehouse_id === current?.id)
  // order as a tree: parents first, children indented under them
  const tree = React.useMemo(() => {
    const out: (LocationRow & { depth: number })[] = []
    const walk = (parent: string | null, depth: number) => whLocations.filter((l) => (l.parent_id ?? null) === parent).forEach((l) => { out.push({ ...l, depth }); walk(l.id, depth + 1) })
    walk(null, 0)
    return out
  }, [whLocations])

  const whFields = [
    { name: 'code' as const, label: t('Code'), half: true, uppercase: true, placeholder: t('ST2') },
    { name: 'warehouse_type' as const, label: t('Type'), type: 'select' as const, half: true, options: ['warehouse', 'store', 'production', 'transit'].map((x) => ({ value: x, label: tEnum(`wh_${x}`) })) },
    { name: 'name' as const, label: t('Name'), placeholder: t('Store Prishtina') },
    { name: 'city' as const, label: t('City'), optional: true },
    { name: 'is_active' as const, label: t('Active'), type: 'switch' as const },
  ]
  const locFields = (wid: string) => [
    { name: 'code' as const, label: t('Code'), half: true, uppercase: true, placeholder: t('WH/A-01-02') },
    { name: 'location_type' as const, label: t('Type'), type: 'select' as const, half: true, options: LOCATION_TYPES.map((x) => ({ value: x, label: x === 'view' ? t('Group (no stock)') : tEnum(`loc_${x}`) })) },
    { name: 'name' as const, label: t('Name'), placeholder: t('Aisle A, rack 1, shelf 2') },
    { name: 'parent_id' as const, label: t('Inside'), type: 'select' as const, optional: true, options: [{ value: '__none', label: t('Top level') }, ...(locations.data ?? []).filter((l) => l.warehouse_id === wid).map((l) => ({ value: l.id, label: l.code }))] },
    { name: 'barcode' as const, label: t('Bin barcode'), optional: true, description: t('Scan it during receiving and transfers to pick this bin.') },
    { name: 'is_pickable' as const, label: t('Pick from this bin'), type: 'switch' as const },
  ]

  return (
    <>
      <PageHeader
        title={t('Warehouses')}
        description={t('Warehouses, stores and their bins. Every stock movement goes from one location to another.')}
        actions={<Can perm="inventory.write">
          <SimpleFormDialog trigger={<Button><Plus /> {t('New warehouse')}</Button>} title={t('New warehouse')} schema={warehouseSchema}
            defaultValues={{ code: '', name: '', warehouse_type: 'warehouse', city: '', is_active: true }} fields={whFields} submitLabel={t('Create warehouse')}
            onSubmit={async (v) => {
              const row = await wh.create.mutateAsync(v)
              await loc.create.mutateAsync({ warehouse_id: row.id, code: `${v.code}/STOCK`, name: 'Stock', location_type: 'internal', is_pickable: true })
              toast.success(t('{name} created with a default stock shelf', { name: v.name }))
              setSelected(row.id)
            }} />
        </Can>}
      />
      <div className="grid gap-4 grid-cols-[minmax(0,1fr)] lg:grid-cols-[300px_minmax(0,1fr)]">
        <div className="grid content-start gap-2">
          {warehouses.isLoading && Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-16" />)}
          {warehouses.data?.map((w) => (
            <button key={w.id} onClick={() => setSelected(w.id)}
              className={cn('flex items-center gap-3 rounded-lg border bg-card p-3 text-left transition-colors hover:border-ring/40', current?.id === w.id && 'border-primary ring-1 ring-primary')}>
              <WarehouseIcon className="size-5 text-muted-foreground" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">{td(w.name)}</span>
                <span className="block text-xs text-muted-foreground">{w.code} · {tEnum(`wh_${w.warehouse_type}`)}{w.city ? ` · ${w.city}` : ''}</span>
              </span>
              <span className="text-right">
                <span className="block text-[13px] tabular">{formatMoney(valueBy('warehouse_id', w.id))}</span>
                {!w.is_active && <Badge variant="secondary">{t('Inactive')}</Badge>}
              </span>
            </button>
          ))}
        </div>
        {current ? (
          <Card>
            <CardHeader className="flex-row items-center justify-between gap-2 space-y-0">
              <CardTitle>{td(current.name)} <span className="font-normal text-muted-foreground">· {tn(whLocations.length, '{n} location', '{n} locations')} · {formatMoney(valueBy('warehouse_id', current.id), company?.base_currency)}</span></CardTitle>
              <Can perm="inventory.write">
                <div className="flex gap-2">
                  <SimpleFormDialog trigger={<Button variant="ghost" size="sm"><Pencil /> {t('Edit')}</Button>} title={t('Edit {name}', { name: td(current.name) })} schema={warehouseSchema}
                    defaultValues={{ code: current.code, name: current.name, warehouse_type: current.warehouse_type as 'warehouse', city: current.city ?? '', is_active: current.is_active }}
                    fields={whFields} submitLabel={t('Save')} onSubmit={(v) => wh.update.mutateAsync({ id: current.id, ...v, city: v.city || null })} />
                  <SimpleFormDialog trigger={<Button variant="outline" size="sm"><Plus /> {t('Add location')}</Button>} title={t('New location in {name}', { name: td(current.name) })} schema={locationSchema}
                    defaultValues={{ code: `${current.code}/`, name: '', location_type: 'internal', parent_id: null, barcode: '', is_pickable: true }}
                    fields={locFields(current.id)} submitLabel={t('Add location')}
                    onSubmit={(v) => loc.create.mutateAsync({ ...v, warehouse_id: current.id, barcode: v.barcode || null, parent_id: v.parent_id ?? null })} />
                </div>
              </Can>
            </CardHeader>
            <CardContent className="p-0">
              {tree.length === 0 ? <EmptyState compact icon={MapPin} title={t('No locations')} description={t('Add at least one bin to store stock here.')} /> : (
                <Table>
                  <TableHeader><TableRow className="hover:bg-transparent"><TableHead>{t('Code')}</TableHead><TableHead>{t('Name')}</TableHead><TableHead>{t('Type')}</TableHead><TableHead>{t('Barcode')}</TableHead><TableHead className="text-right">{t('Stock value')}</TableHead><TableHead className="w-20" /></TableRow></TableHeader>
                  <TableBody>
                    {tree.map((l) => (
                      <TableRow key={l.id}>
                        <TableCell className="font-medium" style={{ paddingLeft: `${12 + l.depth * 18}px` }}>{l.code}</TableCell>
                        <TableCell>{td(l.name)}</TableCell>
                        <TableCell>{l.location_type === 'view' ? <Badge variant="secondary">{t('Group')}</Badge> : tEnum(`loc_${l.location_type}`)}{!l.is_pickable && l.location_type !== 'view' && <span className="ml-1 text-xs text-muted-foreground">{t('(no picking)')}</span>}</TableCell>
                        <TableCell className="tabular text-[13px] text-muted-foreground">{l.barcode ?? '—'}</TableCell>
                        <TableCell className="text-right tabular">{formatMoney(valueBy('location_id', l.id))}</TableCell>
                        <TableCell className="whitespace-nowrap text-right">
                          <Can perm="inventory.write">
                            <SimpleFormDialog trigger={<Button variant="ghost" size="icon-sm" aria-label={t('Edit {name}', { name: l.code })}><Pencil /></Button>} title={t('Edit {name}', { name: l.code })} schema={locationSchema}
                              defaultValues={{ code: l.code, name: l.name, location_type: l.location_type as 'internal', parent_id: l.parent_id, barcode: l.barcode ?? '', is_pickable: l.is_pickable }}
                              fields={locFields(current.id)} submitLabel={t('Save')} onSubmit={(v) => loc.update.mutateAsync({ id: l.id, ...v, barcode: v.barcode || null, parent_id: v.parent_id ?? null })} />
                            <ConfirmDialog trigger={<Button variant="ghost" size="icon-sm" aria-label={t('Delete {name}', { name: l.code })} disabled={valueBy('location_id', l.id) !== 0}><Trash2 /></Button>}
                              title={t('Delete {name}?', { name: l.code })} description={t('Only empty locations can be deleted. Its movement history is kept.')} confirmLabel={t('Delete location')} destructive
                              onConfirm={() => loc.remove.mutateAsync(l.id)} />
                          </Can>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        ) : warehouses.isError ? <ErrorState error={warehouses.error} onRetry={() => void warehouses.refetch()} /> : !warehouses.isLoading && <EmptyState title={t('No warehouses')} description={t('Add your first warehouse or store to keep stock in it.')} />}
      </div>
    </>
  )
}
