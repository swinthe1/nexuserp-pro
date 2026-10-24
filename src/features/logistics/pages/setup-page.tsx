import { Plus, Truck } from 'lucide-react'
import * as React from 'react'
import { toast } from 'sonner'
import { z } from 'zod'
import { Can } from '@/app/company-provider'
import { EmptyState } from '@/components/empty-state'
import { PageHeader } from '@/components/page-header'
import { SimpleFormDialog } from '@/components/simple-form-dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { ErrorState } from '@/components/error-state'
import { t } from '@/i18n'
import { formatQty, humanize, num } from '@/lib/utils'
import { useCarriers, useDrivers, useSaveCarrier, useSaveVehicle, useVehicles, type Carrier, type Vehicle } from '../api'

const carrierSchema = z.object({
  code: z.string().trim().min(1, 'Enter a code').max(12),
  name: z.string().trim().min(1, 'Enter a name'),
  carrier_type: z.enum(['own_fleet', 'external']),
  tracking_url_template: z.string().trim().nullable().refine((v) => !v || (/^https?:\/\//.test(v) && v.includes('{tracking}')), 'A web address containing {tracking}'),
  phone: z.string().trim().nullable(),
  email: z.string().trim().email('Enter a valid email').nullable().or(z.literal('')),
  is_active: z.boolean(),
})
type CarrierValues = z.infer<typeof carrierSchema>
const vehicleSchema = z.object({
  plate_number: z.string().trim().min(1, 'Enter the plate number'),
  name: z.string().trim().min(1, 'Enter a name'),
  vehicle_type: z.enum(['van', 'truck', 'car', 'motorbike', 'other']),
  capacity_kg: z.coerce.number().min(0).nullable(),
  capacity_m3: z.coerce.number().min(0).nullable(),
  driver_employee_id: z.string().nullable(),
  is_active: z.boolean(),
})
type VehicleValues = z.infer<typeof vehicleSchema>
const blank = (v: string | null | undefined) => (v === '' || v === undefined ? null : v)

export function LogisticsSetupPage() {
  const carriers = useCarriers()
  const vehicles = useVehicles()
  const drivers = useDrivers()
  const saveCarrier = useSaveCarrier()
  const saveVehicle = useSaveVehicle()
  const [carrier, setCarrier] = React.useState<Carrier | 'new' | null>(null)
  const [vehicle, setVehicle] = React.useState<Vehicle | 'new' | null>(null)
  const c = carrier === 'new' ? null : carrier
  const v = vehicle === 'new' ? null : vehicle
  return (
    <>
      <PageHeader title={t('Carriers and fleet')} description={t('Who carries our parcels: our own vans and drivers, and the courier companies we hand parcels to.')} />
      <div className="grid gap-4 xl:grid-cols-2">
        <Card className="self-start">
          <CardHeader className="flex-row items-start justify-between gap-2 space-y-0 pb-2">
            <div><CardTitle>{t('Carriers')}</CardTitle><CardDescription>{t("The tracking link turns a tracking number into the carrier's tracking page.")}</CardDescription></div>
            <Can perm="logistics.write"><Button size="sm" onClick={() => setCarrier('new')}><Plus /> {t('Add carrier')}</Button></Can>
          </CardHeader>
          <CardContent className="overflow-x-auto p-0">
            {carriers.isLoading ? <Skeleton className="m-4 h-24" /> : carriers.isError ? <ErrorState compact error={carriers.error} onRetry={() => void carriers.refetch()} /> : !carriers.data?.length ? <EmptyState compact icon={Truck} title={t('No carriers yet')} description={t('Add your own fleet and the courier companies you use.')} /> : (
              <Table>
                <TableHeader><TableRow className="hover:bg-transparent"><TableHead>{t('Carrier')}</TableHead><TableHead>{t('Type')}</TableHead><TableHead>{t('Contact')}</TableHead><TableHead /><TableHead className="w-[1%]" /></TableRow></TableHeader>
                <TableBody>{carriers.data.map((x) => (
                  <TableRow key={x.id} className="hover:bg-transparent">
                    <TableCell><span className="font-mono text-xs text-muted-foreground">{x.code}</span> <span className="font-medium">{x.name}</span>
                      {x.tracking_url_template && <div className="max-w-64 truncate text-xs text-muted-foreground">{x.tracking_url_template}</div>}</TableCell>
                    <TableCell className="whitespace-nowrap">{x.carrier_type === 'own_fleet' ? t('Own fleet') : t('Courier')}</TableCell>
                    <TableCell className="whitespace-nowrap text-[13px] text-muted-foreground">{[x.phone, x.email].filter(Boolean).join(' · ') || '—'}</TableCell>
                    <TableCell>{!x.is_active && <Badge variant="secondary">{t('Inactive')}</Badge>}</TableCell>
                    <TableCell><Can perm="logistics.write"><Button size="sm" variant="ghost" onClick={() => setCarrier(x)}>{t('Edit')}</Button></Can></TableCell>
                  </TableRow>
                ))}</TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
        <Card className="self-start">
          <CardHeader className="flex-row items-start justify-between gap-2 space-y-0 pb-2">
            <div><CardTitle>{t('Vehicles')}</CardTitle><CardDescription>{t('Capacity is checked when shipments are put on a route; the usual driver is suggested.')}</CardDescription></div>
            <Can perm="logistics.write"><Button size="sm" onClick={() => setVehicle('new')}><Plus /> {t('Add vehicle')}</Button></Can>
          </CardHeader>
          <CardContent className="overflow-x-auto p-0">
            {vehicles.isLoading ? <Skeleton className="m-4 h-24" /> : vehicles.isError ? <ErrorState compact error={vehicles.error} onRetry={() => void vehicles.refetch()} /> : !vehicles.data?.length ? <EmptyState compact icon={Truck} title={t('No vehicles yet')} description={t('Add your vans to plan routes for them.')} /> : (
              <Table>
                <TableHeader><TableRow className="hover:bg-transparent"><TableHead>{t('Vehicle')}</TableHead><TableHead className="text-right">{t('Capacity')}</TableHead><TableHead>{t('Driver')}</TableHead><TableHead /><TableHead className="w-[1%]" /></TableRow></TableHeader>
                <TableBody>{vehicles.data.map((x) => (
                  <TableRow key={x.id} className="hover:bg-transparent">
                    <TableCell><span className="font-medium">{x.name}</span> <span className="text-xs text-muted-foreground">{x.plate_number} · {humanize(x.vehicle_type)}</span></TableCell>
                    <TableCell className="text-right tabular">{x.capacity_kg ? `${formatQty(x.capacity_kg)} kg` : '—'}{x.capacity_m3 ? ` · ${formatQty(x.capacity_m3)} m³` : ''}</TableCell>
                    <TableCell>{x.driver?.full_name ?? '—'}</TableCell>
                    <TableCell>{!x.is_active && <Badge variant="secondary">{t('Inactive')}</Badge>}</TableCell>
                    <TableCell><Can perm="logistics.write"><Button size="sm" variant="ghost" onClick={() => setVehicle(x)}>{t('Edit')}</Button></Can></TableCell>
                  </TableRow>
                ))}</TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>
      <SimpleFormDialog<CarrierValues> open={!!carrier} onOpenChange={(o) => !o && setCarrier(null)} title={c ? t('Edit {name}', { name: c.name }) : t('New carrier')} schema={carrierSchema}
        defaultValues={c ? { code: c.code, name: c.name, carrier_type: c.carrier_type as CarrierValues['carrier_type'], tracking_url_template: c.tracking_url_template, phone: c.phone, email: c.email ?? '', is_active: c.is_active }
                         : { code: '', name: '', carrier_type: 'external', tracking_url_template: null, phone: null, email: '', is_active: true }}
        fields={[
          { name: 'code', label: t('Code'), half: true, uppercase: true, placeholder: 'DHL' }, // i18n-ignore
          { name: 'name', label: t('Name'), half: true, placeholder: 'DHL Express' }, // i18n-ignore
          { name: 'carrier_type', label: t('Type'), type: 'select', options: [{ value: 'external', label: t('Courier company') }, { value: 'own_fleet', label: t('Our own vehicles') }] },
          { name: 'tracking_url_template', label: t('Tracking link'), optional: true, placeholder: 'https://track.example.com/?id={tracking}', description: t('{tracking} is replaced by the tracking number', { tracking: '{tracking}' }) },
          { name: 'phone', label: t('Phone'), half: true, optional: true },
          { name: 'email', label: t('Email'), half: true, optional: true },
          { name: 'is_active', label: t('Active'), type: 'switch' },
        ]}
        submitLabel={t('Save')} onSubmit={async (x) => {
          await saveCarrier.mutateAsync({ id: c?.id, ...x, tracking_url_template: blank(x.tracking_url_template), phone: blank(x.phone), email: blank(x.email) })
          toast.success(t('Carrier saved'))
        }} />
      <SimpleFormDialog<VehicleValues> open={!!vehicle} onOpenChange={(o) => !o && setVehicle(null)} title={v ? t('Edit {name}', { name: v.name }) : t('New vehicle')} schema={vehicleSchema}
        defaultValues={v ? { plate_number: v.plate_number, name: v.name, vehicle_type: v.vehicle_type as VehicleValues['vehicle_type'], capacity_kg: v.capacity_kg ? num(v.capacity_kg) : null,
                             capacity_m3: v.capacity_m3 ? num(v.capacity_m3) : null, driver_employee_id: v.driver_employee_id, is_active: v.is_active }
                         : { plate_number: '', name: '', vehicle_type: 'van', capacity_kg: null, capacity_m3: null, driver_employee_id: null, is_active: true }}
        fields={[
          { name: 'name', label: t('Name'), half: true, placeholder: 'Fiat Ducato' }, // i18n-ignore
          { name: 'plate_number', label: t('Plate number'), half: true, uppercase: true, placeholder: 'AA 123 BB' }, // i18n-ignore
          { name: 'vehicle_type', label: t('Type'), type: 'select', options: ['van', 'truck', 'car', 'motorbike', 'other'].map((k) => ({ value: k, label: humanize(k) })) },
          { name: 'capacity_kg', label: t('Load capacity (kg)'), type: 'number', half: true, optional: true },
          { name: 'capacity_m3', label: t('Volume (m³)'), type: 'number', half: true, optional: true },
          { name: 'driver_employee_id', label: t('Usual driver'), type: 'select', optional: true, options: (drivers.data ?? []).map((d) => ({ value: d.id, label: d.full_name ?? '' })) },
          { name: 'is_active', label: t('Active'), type: 'switch' },
        ]}
        submitLabel={t('Save')} onSubmit={async (x) => {
          await saveVehicle.mutateAsync({ id: v?.id, ...x, capacity_kg: x.capacity_kg || null, capacity_m3: x.capacity_m3 || null })
          toast.success(t('Vehicle saved'))
        }} />
    </>
  )
}
