import { useQuery } from '@tanstack/react-query'
import { Ban, CheckCircle2, FileText, Phone, UserCheck, UserX } from 'lucide-react'
import * as React from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { useCompany } from '@/app/company-provider'
import { SearchSelect } from '@/components/search-select'
import { StatusBadge } from '@/components/status-badge'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { useCustomers } from '@/features/sales/api'
import { t } from '@/i18n'
import { unwrap } from '@/lib/errors'
import { supabase } from '@/lib/supabase'
import { formatMoney, num } from '@/lib/utils'
import { APPT_SOURCES, APPT_STATUS, type Appt, type Board, CARD_KINDS, type CardKind, useApptAction } from './api'

const pad = (n: number) => String(n).padStart(2, '0')
export const localDay = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
export const localTime = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}`
const toIso = (day: string, time: string) => new Date(`${day}T${time}:00`).toISOString()

export type NewAppt = { resource_id?: string; day: string; time?: string }
type Form = { resource_id: string; service_id: string | null; day: string; time: string; duration: number; partner_id: string | null; client_name: string; client_phone: string
  client_email: string; card_id: string | null; price: number; notes: string; source: string }

export function AppointmentDialog({ board, appt, initial, open, onOpenChange }: { board: Board; appt: Appt | null; initial: NewAppt | null; open: boolean; onOpenChange: (o: boolean) => void }) {
  const { companyId, can } = useCompany()
  const navigate = useNavigate()
  const customers = useCustomers()
  const [f, setF] = React.useState<Form | null>(null)
  React.useEffect(() => {
    if (!open) { setF(null); return }
    if (appt) {
      const s = new Date(appt.starts_at), e = new Date(appt.ends_at)
      setF({ resource_id: appt.resource_id, service_id: appt.service_id, day: localDay(s), time: localTime(s), duration: Math.round((e.getTime() - s.getTime()) / 60000),
        partner_id: appt.partner_id, client_name: appt.client_name, client_phone: appt.client_phone ?? '', client_email: appt.client_email ?? '', card_id: appt.card_id,
        price: num(appt.price), notes: appt.notes ?? '', source: appt.source })
    } else {
      const svc = board.services[0]
      setF({ resource_id: initial?.resource_id ?? board.resources[0]?.id ?? '', service_id: svc?.id ?? null, day: initial?.day ?? localDay(new Date()), time: initial?.time ?? '09:00',
        duration: svc?.duration_min ?? 30, partner_id: null, client_name: '', client_phone: '', client_email: '', card_id: null, price: num(svc?.price), notes: '', source: 'phone' })
    }
  }, [open, appt, initial, board.services, board.resources])
  // the client's cards (their car, the patient, the pet)
  const cards = useQuery({ queryKey: ['appointments', 'cards-of', f?.partner_id], enabled: !!f?.partner_id,
    queryFn: async () => unwrap(await supabase.from('client_cards').select('id, kind, title').eq('partner_id', f!.partner_id!).is('deleted_at', null).order('title')) as unknown as { id: string; kind: CardKind; title: string }[] })

  const save = useApptAction(async (x: Form) => unwrap(await supabase.rpc('appt_save', { p: {
    id: appt?.id ?? null, company_id: companyId, resource_id: x.resource_id, service_id: x.service_id, starts_at: toIso(x.day, x.time),
    ends_at: new Date(new Date(`${x.day}T${x.time}:00`).getTime() + x.duration * 60000).toISOString(), partner_id: x.partner_id, client_name: x.client_name,
    client_phone: x.client_phone, client_email: x.client_email, card_id: x.card_id, price: x.price, notes: x.notes, source: x.source,
  } as never })))
  const status = useApptAction(async (s: string) => unwrap(await supabase.rpc('appt_set_status', { p_id: appt!.id, p_status: s })))
  const invoice = useApptAction(async () => unwrap(await supabase.rpc('appt_invoice', { p_id: appt!.id })) as string)

  if (!f) return null
  const set = (p: Partial<Form>) => setF((x) => (x ? { ...x, ...p } : x))
  const locked = !!appt?.invoice_id || appt?.status === 'cancelled' || appt?.status === 'no_show'
  const editable = can('sales.write') && !locked
  const services = board.services.filter((s) => !s.resource_ids.length || s.resource_ids.includes(f.resource_id) || s.id === f.service_id)
  const doStatus = (s: string, msgOk: string) => status.mutate(s, { onSuccess: () => { toast.success(msgOk); onOpenChange(false) } })
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">{appt ? <>{appt.client_name} <StatusBadge status={appt.status} label={t(APPT_STATUS[appt.status])} /></> : t('New appointment')}</DialogTitle>
          <DialogDescription>{appt?.number ?? t('Choose the service and the time; the client can be new.')}</DialogDescription>
        </DialogHeader>
        <fieldset disabled={!editable} className="grid gap-3 sm:grid-cols-2">
          <div className="grid gap-1.5"><Label>{t('Service')}</Label>
            <SearchSelect value={f.service_id} onChange={(v) => { const s = board.services.find((x) => x.id === v); set({ service_id: v, duration: s?.duration_min ?? f.duration, price: s ? num(s.price) : f.price }) }}
              options={services.map((s) => ({ value: s.id, label: s.name, hint: `${s.duration_min} min · ${formatMoney(s.price)}` /* i18n-ignore */ }))} placeholder={t('Choose the service')} /></div>
          <div className="grid gap-1.5"><Label>{t('With')}</Label>
            <Select value={f.resource_id} onValueChange={(v) => set({ resource_id: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{board.resources.map((r) => <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>)}</SelectContent>
            </Select></div>
          <div className="grid grid-cols-[1fr_90px_80px] gap-2 sm:col-span-2">
            <div className="grid gap-1.5"><Label htmlFor="ad">{t('Day')}</Label><Input id="ad" type="date" value={f.day} onChange={(e) => set({ day: e.target.value })} /></div>
            <div className="grid gap-1.5"><Label htmlFor="at">{t('Time')}</Label><Input id="at" type="time" step={300} value={f.time} onChange={(e) => set({ time: e.target.value })} /></div>
            <div className="grid gap-1.5"><Label htmlFor="am">{t('Minutes')}</Label><Input id="am" type="number" min={5} step={5} value={f.duration} onChange={(e) => set({ duration: num(e.target.value) })} /></div>
          </div>
          <div className="grid gap-1.5 sm:col-span-2"><Label>{t('Client')}</Label>
            <SearchSelect value={f.partner_id} clearable placeholder={t('A client on file (or write a new one below)')}
              onChange={(v) => { const c = customers.data?.find((x) => x.id === v); set({ partner_id: v, card_id: null, client_name: c?.name ?? f.client_name, client_phone: c?.phone ?? f.client_phone, client_email: c?.email ?? f.client_email }) }}
              options={(customers.data ?? []).map((c) => ({ value: c.id, label: c.name, hint: c.phone ?? c.code }))} /></div>
          <div className="grid gap-1.5"><Label htmlFor="an">{t('Name')}</Label><Input id="an" value={f.client_name} onChange={(e) => set({ client_name: e.target.value })} /></div>
          <div className="grid gap-1.5"><Label htmlFor="ap">{t('Phone')}</Label><Input id="ap" type="tel" value={f.client_phone} onChange={(e) => set({ client_phone: e.target.value })} /></div>
          <div className="grid gap-1.5"><Label htmlFor="ae">{t('Email (for the reminder)')}</Label><Input id="ae" type="email" value={f.client_email} onChange={(e) => set({ client_email: e.target.value })} /></div>
          {f.partner_id && (cards.data ?? []).length > 0 ? (
            <div className="grid gap-1.5"><Label>{t('Card')}</Label>
              <SearchSelect value={f.card_id} clearable onChange={(v) => set({ card_id: v })} placeholder={t('None')}
                options={(cards.data ?? []).map((c) => ({ value: c.id, label: c.title, hint: t(CARD_KINDS[c.kind].label) }))} /></div>
          ) : <div className="grid gap-1.5"><Label>{t('Came through')}</Label>
              <Select value={f.source} onValueChange={(v) => set({ source: v })}><SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{Object.entries(APPT_SOURCES).map(([k, l]) => <SelectItem key={k} value={k}>{t(l)}</SelectItem>)}</SelectContent></Select></div>}
          <div className="grid gap-1.5"><Label htmlFor="apr">{t('Price with VAT')}</Label><Input id="apr" type="number" step="0.01" value={f.price} onChange={(e) => set({ price: num(e.target.value) })} /></div>
          <div className="grid gap-1.5 sm:col-span-2"><Label htmlFor="ano">{t('Notes')}</Label><Textarea id="ano" rows={2} value={f.notes} onChange={(e) => set({ notes: e.target.value })} /></div>
        </fieldset>
        {appt?.card_id && <p className="text-[13px]"><Link className="text-primary hover:underline" to={`/appointments/cards/${appt.card_id}`}>{t('Open the card: {title}', { title: appt.card ?? '' })}</Link></p>}
        <DialogFooter className="flex-wrap gap-2 sm:justify-between">
          <div className="flex flex-wrap gap-1.5">
            {appt && !locked && can('sales.write') && <>
              {(appt.status === 'booked' || appt.status === 'confirmed') && <Button size="sm" variant="outline" onClick={() => doStatus('arrived', t('Arrived'))}><UserCheck /> {t('Arrived')}</Button>}
              {appt.status === 'booked' && <Button size="sm" variant="ghost" onClick={() => doStatus('confirmed', t('Confirmed'))}><Phone /> {t('Confirmed')}</Button>}
              {(appt.status === 'booked' || appt.status === 'confirmed') && <Button size="sm" variant="ghost" onClick={() => doStatus('no_show', t('Marked: did not come'))}><UserX /> {t('Did not come')}</Button>}
              <Button size="sm" variant="ghost" className="text-destructive" onClick={() => doStatus('cancelled', t('Appointment cancelled'))}><Ban /> {t('Cancel it')}</Button>
            </>}
            {appt?.invoice_id && <Button size="sm" variant="outline" asChild><Link to={`/sales/invoices/${appt.invoice_id}`}><FileText /> {t('Open the invoice')}</Link></Button>}
            {appt && (appt.status === 'cancelled' || appt.status === 'no_show') && can('sales.write') && <Button size="sm" variant="outline" onClick={() => doStatus('booked', t('Booked again'))}>{t('Book again')}</Button>}
          </div>
          <div className="flex gap-2">
            {appt && !locked && can('invoicing.write') && <Button variant="outline" loading={invoice.isPending}
              onClick={() => invoice.mutate(undefined, { onSuccess: (inv) => { toast.success(t('Done: the invoice is ready to check')); onOpenChange(false); navigate(`/sales/invoices/${inv}`) } })}>
              <CheckCircle2 /> {t('Done, to the invoice')}</Button>}
            {editable && <Button loading={save.isPending} disabled={!f.resource_id || !f.client_name.trim() || !f.time}
              onClick={() => save.mutate(f, { onSuccess: () => { toast.success(appt ? t('Saved') : t('Appointment booked')); onOpenChange(false) } })}>{appt ? t('Save') : t('Book')}</Button>}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
