import * as React from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { t } from '@/i18n'
import { describeError } from '@/lib/errors'
import { formatMoney, num } from '@/lib/utils'
import { useCarriers, useCreateShipment, useRecordStop, useShipWithCarrier, useUpdateShipment } from '../api'

export const Opt = () => <span className="ml-1 font-normal text-muted-foreground">{t('(optional)')}</span>

function ErrorLine({ error }: { error: string | null }) {
  return error ? <p role="alert" className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-[13px] text-destructive">{error}</p> : null
}

/** Delivery → shipment, optionally with cash to collect */
export function CreateShipmentDialog({ delivery, onClose }: { delivery: { id: string; number: string; partner: string | null } | null; onClose: () => void }) {
  const create = useCreateShipment()
  const [cod, setCod] = React.useState('')
  React.useEffect(() => { if (delivery) setCod('') }, [delivery])
  return (
    <Dialog open={!!delivery} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{t('Create shipment')}</DialogTitle>
          <DialogDescription>{t('{number} for {customer}. Weight and address are taken from the delivery and the customer.', { number: delivery?.number, customer: delivery?.partner })}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-1.5">
          <Label htmlFor="cod">{t('Cash on delivery')}</Label>
          <Input id="cod" type="number" min={0} step="any" inputMode="decimal" placeholder={t('0.00 — leave empty if already paid')} value={cod} onChange={(e) => setCod(e.target.value)} />
          <p className="text-xs text-muted-foreground">{t('The driver must confirm this amount was collected before the stop counts as delivered.')}</p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{t('Cancel')}</Button>
          <Button loading={create.isPending} onClick={async () => {
            await create.mutateAsync({ delivery: delivery!.id, cod: num(cod) || null })
            toast.success(t('Shipment created for {number}', { number: delivery!.number })); onClose()
          }}>{t('Create shipment')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** Hand a shipment to an external carrier with its tracking number */
export function ShipWithCarrierDialog({ shipment, onClose }: { shipment: { id: string; number: string } | null; onClose: () => void }) {
  const carriers = useCarriers()
  const ship = useShipWithCarrier()
  const [carrier, setCarrier] = React.useState('')
  const [tracking, setTracking] = React.useState('')
  const [error, setError] = React.useState<string | null>(null)
  React.useEffect(() => { if (shipment) { setTracking(''); setError(null) } }, [shipment])
  const external = (carriers.data ?? []).filter((c) => c.is_active)
  const chosen = external.find((c) => c.id === carrier)
  return (
    <Dialog open={!!shipment} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{t('Send {number} with a carrier', { number: shipment?.number })}</DialogTitle>
          <DialogDescription>{t('The goods leave stock when the parcel is handed over, if the warehouse has not done it yet.')}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <div className="grid gap-1.5"><Label>{t('Carrier')}</Label>
            <Select value={carrier} onValueChange={setCarrier}><SelectTrigger><SelectValue placeholder={t('Choose a carrier')} /></SelectTrigger>
              <SelectContent>{external.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent></Select></div>
          <div className="grid gap-1.5"><Label htmlFor="trk">{t('Tracking number')}{chosen?.carrier_type === 'own_fleet' && <Opt />}</Label>
            <Input id="trk" value={tracking} onChange={(e) => setTracking(e.target.value.toUpperCase())} placeholder={t('e.g. {example}', { example: 'RR204517865AL' })} autoComplete="off" /></div>
          <ErrorLine error={error} />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{t('Cancel')}</Button>
          <Button disabled={!carrier} loading={ship.isPending} onClick={async () => {
            setError(null)
            try { await ship.mutateAsync({ shipment: shipment!.id, carrier, tracking }); toast.success(t('{number} handed to {carrier}', { number: shipment!.number, carrier: chosen?.name })); onClose() }
            catch (e) { setError(describeError(e)) }
          }}>{t('Hand over')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** Delivered / failed / skipped, from a route stop or from the shipment page */
export function OutcomeDialog({ target, onClose }: {
  target: { kind: 'stop' | 'shipment'; id: string; number: string; outcome: 'delivered' | 'failed' | 'skipped'; cod: number; partner?: string | null } | null
  onClose: () => void
}) {
  const stop = useRecordStop()
  const upd = useUpdateShipment()
  const [note, setNote] = React.useState('')
  const [cash, setCash] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  React.useEffect(() => { if (target) { setNote(''); setCash(false); setError(null) } }, [target])
  if (!target) return null
  const delivered = target.outcome === 'delivered'
  const needsReason = target.outcome === 'failed'
  const title = delivered ? t('Mark delivered') : target.outcome === 'failed' ? t('Delivery failed') : t('Skip this stop')
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{target.number}{target.partner ? ` · ${target.partner}` : ''}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          {delivered && target.cod > 0 && (
            <label className="flex items-center justify-between gap-3 rounded-md border border-warning/40 bg-warning/10 px-3 py-3">
              <span><span className="block text-sm font-medium">{t('Cash collected')}</span>
                <span className="text-[13px] text-muted-foreground">{t('Collect {amount} before handing over the goods.', { amount: formatMoney(target.cod) })}</span></span>
              <Switch checked={cash} onCheckedChange={setCash} aria-label={t('Cash collected')} />
            </label>
          )}
          <div className="grid gap-1.5">
            <Label htmlFor="note">{needsReason ? t('What happened') : t('Note')}{!needsReason && <Opt />}</Label>
            <Textarea id="note" rows={3} value={note} onChange={(e) => setNote(e.target.value)}
              placeholder={needsReason ? t('e.g. Customer not at home, phone off') : delivered ? t('e.g. Signed by the shop manager') : t('Why the stop is skipped')} />
          </div>
          <ErrorLine error={error} />
        </div>
        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" className="h-11 sm:h-9" onClick={onClose}>{t('Cancel')}</Button>
          <Button className="h-11 sm:h-9" variant={delivered ? 'default' : 'destructive'} loading={stop.isPending || upd.isPending}
            disabled={(needsReason && !note.trim()) || (delivered && target.cod > 0 && !cash)}
            onClick={async () => {
              setError(null)
              const done = delivered ? t('{number} delivered', { number: target.number }) : target.outcome === 'failed' ? t('{number} marked as failed', { number: target.number }) : t('{number} skipped', { number: target.number })
              if (target.kind === 'stop') {
                // the stop updates on screen right away; the driver can move on while it saves
                stop.mutate({ stop: target.id, outcome: target.outcome, note: note.trim() || undefined, cod: target.cod > 0 ? cash : undefined },
                  { onSuccess: () => toast.success(done), onError: (e) => toast.error(describeError(e)) })
                onClose()
                return
              }
              try {
                await upd.mutateAsync({ shipment: target.id, status: target.outcome === 'skipped' ? 'failed' : target.outcome, note: note.trim() || undefined, cod: target.cod > 0 ? cash : undefined })
                toast.success(done)
                onClose()
              } catch (e) { setError(describeError(e)) }
            }}>{title}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
