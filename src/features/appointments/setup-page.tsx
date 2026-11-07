import { Pencil, Plus } from 'lucide-react'
import * as React from 'react'
import { toast } from 'sonner'
import { Can, useCompany } from '@/app/company-provider'
import { PageHeader } from '@/components/page-header'
import { SearchSelect } from '@/components/search-select'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { useTaxCodes } from '@/features/tax/api'
import { msg, t, td } from '@/i18n'
import { unwrap } from '@/lib/errors'
import { supabase } from '@/lib/supabase'
import { formatMoney, num } from '@/lib/utils'
import { RESOURCE_KINDS, type Resource, type Service, useApptAction, useResources, useServices } from './api'
import { ErrorState } from '@/components/error-state'

const DAYS = [msg('Mon'), msg('Tue'), msg('Wed'), msg('Thu'), msg('Fri'), msg('Sat'), msg('Sun')]
const COLORS = ['#0E8A5F', '#1E88E5', '#8E24AA', '#E53935', '#F4511E', '#F6BF26', '#00897B', '#5E35B1', '#6D4C41', '#546E7A']

/** Who works (people, chairs, rooms, lifts) and what they do, with length and price. */
export function AppointmentsSetupPage() {
  const resources = useResources()
  const services = useServices()
  const [res, setRes] = React.useState<(Resource & { is_active: boolean; sort: number }) | 'new' | null>(null)
  const [svc, setSvc] = React.useState<(Service & { tax_code_id: string | null; is_active: boolean; sort: number }) | 'new' | null>(null)
  return (
    <>
      <PageHeader title={t('Services and staff')} back={{ href: '/appointments', label: t('Appointments') }}
        description={t('Who takes appointments and what they do. A service has its length and its price with VAT; it becomes a line of the invoice.')} />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="flex-row items-center justify-between gap-2 space-y-0">
            <div><CardTitle>{t('Who works')}</CardTitle><CardDescription>{t('A person, a chair, a room or a lift: each one is a column of the calendar.')}</CardDescription></div>
            <Can perm="sales.write"><Button size="sm" onClick={() => setRes('new')}><Plus /> {t('Add')}</Button></Can>
          </CardHeader>
          <CardContent className="p-0">
            <ul className="divide-y">
              {(resources.data ?? []).map((r) => (
                <li key={r.id} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                  <span className="size-3 rounded-full" style={{ background: r.color }} />
                  <span className="flex-1"><span className="font-medium">{r.name}</span> <span className="text-muted-foreground">· {t(RESOURCE_KINDS[r.kind] ?? r.kind)}</span>
                    <span className="block text-xs text-muted-foreground">{hoursText(r.hours)}</span></span>
                  {!r.is_active && <Badge variant="secondary">{t('Not active')}</Badge>}
                  <Can perm="sales.write"><Button variant="ghost" size="icon" aria-label={t('Edit')} onClick={() => setRes(r)}><Pencil /></Button></Can>
                </li>
              ))}
              {resources.isLoading ? <li className="px-4 py-6 text-center text-[13px] text-muted-foreground">{t('Loading…')}</li>
                : resources.isError ? <li className="px-4 py-3"><ErrorState compact error={resources.error} onRetry={() => void resources.refetch()} /></li>
                : !resources.data?.length && <li className="px-4 py-6 text-center text-[13px] text-muted-foreground">{t('Nobody yet')}</li>}
            </ul>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex-row items-center justify-between gap-2 space-y-0">
            <div><CardTitle>{t('Services')}</CardTitle><CardDescription>{t('What a client books: a haircut, a check-up, an oil change.')} {t('Prices with VAT.')}</CardDescription></div>
            <Can perm="sales.write"><Button size="sm" onClick={() => setSvc('new')}><Plus /> {t('Add')}</Button></Can>
          </CardHeader>
          <CardContent className="p-0">
            <ul className="divide-y">
              {(services.data ?? []).map((s) => (
                <li key={s.id} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                  <span className="size-3 rounded-full" style={{ background: s.color ?? '#94a3b8' }} />
                  <span className="flex-1"><span className="font-medium">{s.name}</span>
                    <span className="block text-xs text-muted-foreground">{s.duration_min} min{s.resource_ids.length ? ` · ${s.resource_ids.map((id) => resources.data?.find((r) => r.id === id)?.name).filter(Boolean).join(', ')}` : ''}</span></span>
                  <span className="tabular" title={t('Price with VAT')}>{formatMoney(s.price)}</span>
                  {!s.is_active && <Badge variant="secondary">{t('Not active')}</Badge>}
                  <Can perm="sales.write"><Button variant="ghost" size="icon" aria-label={t('Edit')} onClick={() => setSvc(s)}><Pencil /></Button></Can>
                </li>
              ))}
              {services.isLoading ? <li className="px-4 py-6 text-center text-[13px] text-muted-foreground">{t('Loading…')}</li>
                : services.isError ? <li className="px-4 py-3"><ErrorState compact error={services.error} onRetry={() => void services.refetch()} /></li>
                : !services.data?.length && <li className="px-4 py-6 text-center text-[13px] text-muted-foreground">{t('No service yet')}</li>}
            </ul>
          </CardContent>
        </Card>
      </div>
      {res && <ResourceDialog value={res === 'new' ? null : res} count={resources.data?.length ?? 0} onClose={() => setRes(null)} />}
      {svc && <ServiceDialog value={svc === 'new' ? null : svc} resources={resources.data ?? []} count={services.data?.length ?? 0} onClose={() => setSvc(null)} />}
    </>
  )
}

function hoursText(h: Record<string, [string, string][]>) {
  // consecutive days with the same hours together: "Mon–Fri 08:00–17:00 · Sat 08:00–14:00"
  const parts: string[] = []
  let d = 1
  while (d <= 7) {
    const x = h[String(d)]
    if (!x?.length) { d++; continue }
    const txt = x.map((i) => `${i[0]}–${i[1]}`).join(', ')
    let e = d
    while (e < 7 && (h[String(e + 1)] ?? []).map((i) => `${i[0]}–${i[1]}`).join(', ') === txt) e++
    parts.push(`${t(DAYS[d - 1]!)}${e > d ? `–${t(DAYS[e - 1]!)}` : ''} ${txt}`)
    d = e + 1
  }
  return parts.join(' · ') || t('No hours')
}

function ResourceDialog({ value, count, onClose }: { value: (Resource & { is_active: boolean }) | null; count: number; onClose: () => void }) {
  const { companyId } = useCompany()
  const [name, setName] = React.useState(value?.name ?? '')
  const [kind, setKind] = React.useState(value?.kind ?? 'person')
  const [color, setColor] = React.useState(value?.color ?? COLORS[count % COLORS.length]!)
  const [active, setActive] = React.useState(value?.is_active ?? true)
  const [hours, setHours] = React.useState<Record<string, [string, string][]>>(value?.hours ?? { 1: [['08:00', '17:00']], 2: [['08:00', '17:00']], 3: [['08:00', '17:00']], 4: [['08:00', '17:00']], 5: [['08:00', '17:00']], 6: [['08:00', '14:00']] })
  const save = useApptAction(async () => {
    const row = { name: name.trim(), kind, color, hours, is_active: active }
    if (value) return unwrap(await supabase.from('appt_resources').update(row as never).eq('id', value.id))
    return unwrap(await supabase.from('appt_resources').insert({ ...row, company_id: companyId, sort: count } as never))
  })
  const setDay = (d: number, p: [string, string] | null) => setHours((h) => { const n = { ...h }; if (p) n[String(d)] = [p]; else delete n[String(d)]; return n })
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>{value ? value.name : t('Who works')}</DialogTitle></DialogHeader>
        <div className="grid gap-3">
          <div className="grid grid-cols-[1fr_150px] gap-2">
            <div className="grid gap-1.5"><Label htmlFor="rn">{t('Name')}</Label><Input id="rn" value={name} onChange={(e) => setName(e.target.value)} placeholder={t('e.g. Arta, Chair 2, Lift 1')} /></div>
            <div className="grid gap-1.5"><Label>{t('Kind')}</Label><Select value={kind} onValueChange={setKind}><SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{Object.entries(RESOURCE_KINDS).map(([k, l]) => <SelectItem key={k} value={k}>{t(l)}</SelectItem>)}</SelectContent></Select></div>
          </div>
          <div className="flex flex-wrap gap-1.5">{COLORS.map((c) => <button key={c} type="button" aria-label={c} onClick={() => setColor(c)} className="size-6 rounded-full ring-offset-2" style={{ background: c, boxShadow: color === c ? `0 0 0 2px hsl(var(--background)), 0 0 0 4px ${c}` : undefined }} />)}</div>
          <div className="grid gap-1.5"><Label>{t('Working hours')}</Label>
            {DAYS.map((d, i) => {
              const x = hours[String(i + 1)]?.[0]
              return (
                <div key={d} className="grid grid-cols-[70px_1fr_1fr] items-center gap-2 text-sm">
                  <label className="flex items-center gap-2"><Checkbox checked={!!x} onCheckedChange={(v) => setDay(i + 1, v ? ['08:00', '17:00'] : null)} />{t(d)}</label>
                  <Input type="time" disabled={!x} value={x?.[0] ?? ''} onChange={(e) => x && setDay(i + 1, [e.target.value, x[1]])} aria-label={t('From')} />
                  <Input type="time" disabled={!x} value={x?.[1] ?? ''} onChange={(e) => x && setDay(i + 1, [x[0], e.target.value])} aria-label={t('To')} />
                </div>
              )
            })}
          </div>
          {value && <label className="flex items-center justify-between text-sm">{t('Active')}<Switch checked={active} onCheckedChange={setActive} /></label>}
        </div>
        <DialogFooter><Button variant="ghost" onClick={onClose}>{t('Cancel')}</Button>
          <Button loading={save.isPending} disabled={!name.trim()} onClick={() => save.mutate(undefined, { onSuccess: () => { toast.success(t('Saved')); onClose() } })}>{t('Save')}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function ServiceDialog({ value, resources, count, onClose }: { value: (Service & { tax_code_id: string | null; is_active: boolean }) | null; resources: Resource[]; count: number; onClose: () => void }) {
  const { companyId } = useCompany()
  const taxes = useTaxCodes()
  const [name, setName] = React.useState(value?.name ?? '')
  const [duration, setDuration] = React.useState(value?.duration_min ?? 30)
  const [price, setPrice] = React.useState(num(value?.price))
  const [tax, setTax] = React.useState<string | null>(value?.tax_code_id ?? null)
  const [color, setColor] = React.useState<string | null>(value?.color ?? null)
  const [who, setWho] = React.useState<string[]>(value?.resource_ids ?? [])
  const [active, setActive] = React.useState(value?.is_active ?? true)
  const save = useApptAction(async () => {
    const row = { name: name.trim(), duration_min: duration, price, tax_code_id: tax, color, resource_ids: who, is_active: active }
    if (value) return unwrap(await supabase.from('appt_services').update(row as never).eq('id', value.id))
    return unwrap(await supabase.from('appt_services').insert({ ...row, company_id: companyId, sort: count } as never))
  })
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>{value ? value.name : t('New service')}</DialogTitle></DialogHeader>
        <div className="grid gap-3">
          <div className="grid gap-1.5"><Label htmlFor="sn">{t('Name')}</Label><Input id="sn" value={name} onChange={(e) => setName(e.target.value)} placeholder={t('e.g. Haircut, Check-up, Oil change')} /></div>
          <div className="grid grid-cols-2 gap-2">
            <div className="grid gap-1.5"><Label htmlFor="sd">{t('Minutes')}</Label><Input id="sd" type="number" min={5} step={5} value={duration} onChange={(e) => setDuration(num(e.target.value))} /></div>
            <div className="grid gap-1.5"><Label htmlFor="sp">{t('Price with VAT')}</Label><Input id="sp" type="number" step="0.01" value={price} onChange={(e) => setPrice(num(e.target.value))} /></div>
          </div>
          <div className="grid gap-1.5"><Label>{t('VAT')}</Label>
            <SearchSelect value={tax} onChange={setTax} clearable placeholder={t('The company’s usual VAT')}
              options={(taxes.data ?? []).filter((x) => x.is_active && (x.scope === 'both' || x.scope === 'sales')).map((x) => ({ value: x.id, label: td(x.name) }))} /></div>
          <div className="grid gap-1.5"><Label>{t('Who does it')}</Label>
            <div className="flex flex-wrap gap-1.5">{resources.map((r) => (
              <button key={r.id} type="button" onClick={() => setWho((w) => (w.includes(r.id) ? w.filter((x) => x !== r.id) : [...w, r.id]))}
                className={`rounded-full border px-3 py-1 text-[13px] ${who.includes(r.id) ? 'border-primary bg-primary text-primary-foreground' : 'hover:bg-muted'}`}>{r.name}</button>
            ))}</div>
            <span className="text-xs text-muted-foreground">{who.length ? '' : t('Nobody chosen: everyone can do it.')}</span></div>
          <div className="flex flex-wrap gap-1.5">{COLORS.map((c) => <button key={c} type="button" aria-label={c} onClick={() => setColor(c)} className="size-6 rounded-full" style={{ background: c, boxShadow: color === c ? `0 0 0 2px hsl(var(--background)), 0 0 0 4px ${c}` : undefined }} />)}</div>
          {value && <label className="flex items-center justify-between text-sm">{t('Active')}<Switch checked={active} onCheckedChange={setActive} /></label>}
        </div>
        <DialogFooter><Button variant="ghost" onClick={onClose}>{t('Cancel')}</Button>
          <Button loading={save.isPending} disabled={!name.trim() || duration < 5} onClick={() => save.mutate(undefined, { onSuccess: () => { toast.success(t('Saved')); onClose() } })}>{t('Save')}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
