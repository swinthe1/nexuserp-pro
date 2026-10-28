import { CheckCircle2, CreditCard, Pause, Pencil, Play, Plus, RefreshCw, ScanLine, XCircle } from 'lucide-react'
import * as React from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'
import { Can, useCompany } from '@/app/company-provider'
import { EmptyState } from '@/components/empty-state'
import { PageHeader } from '@/components/page-header'
import { SearchSelect } from '@/components/search-select'
import { StatusBadge } from '@/components/status-badge'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { useCustomers } from '@/features/sales/api'
import { t, tn } from '@/i18n'
import { unwrap } from '@/lib/errors'
import { supabase } from '@/lib/supabase'
import { cn, formatDate, formatMoney, num } from '@/lib/utils'
import { MEMBERSHIP_STATUS, type Plan, useApptAction, useMemberships, usePlans } from './api'

type CheckIn = { ok: boolean; reason?: 'unknown' | 'frozen' | 'expired' | 'not_yet' | 'no_visits'; member?: string; plan?: string; ends_on?: string; starts_on?: string; days_left?: number
  visits?: number | null; visits_used?: number; again_today?: boolean; id?: string; partner_id?: string; code?: string }

const planLength = (p: Plan) => [p.months ? tn(p.months, '{n} month', '{n} months') : '', p.days ? tn(p.days, '{n} day', '{n} days') : ''].filter(Boolean).join(' ')
  + (p.visits ? ` · ${tn(p.visits, '{n} visit', '{n} visits')}` : '')

/** Members, the door and the plans. */
export function MembershipsPage() {
  const [params, setParams] = useSearchParams()
  const filter = params.get('filter') ?? 'active'
  const [search, setSearch] = React.useState('')
  const list = useMemberships(filter, '')
  const plans = usePlans()
  const [sell, setSell] = React.useState<{ partner_id?: string } | null>(null)
  const [plan, setPlan] = React.useState<Plan | 'new' | null>(null)
  const freeze = useApptAction(async (a: { id: string; on: boolean }) => unwrap(await supabase.rpc('membership_freeze', { p_id: a.id, p_freeze: a.on })))
  const rows = (list.data ?? []).filter((m) => !search.trim() || `${m.partner?.name} ${m.partner?.phone} ${m.code} ${m.number}`.toLowerCase().includes(search.trim().toLowerCase()))
  const today = new Date().toISOString().slice(0, 10)
  return (
    <>
      <PageHeader title={t('Memberships')} description={t('Sell a monthly, yearly or 10-visit membership to an invoice, check members in at the door, and see whose ends soon.')}
        actions={<Can perm="sales.write"><Button onClick={() => setSell({})} disabled={!plans.data?.length}><Plus /> {t('Sell a membership')}</Button></Can>} />
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="grid h-fit gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex rounded-md border p-0.5">
              {[['active', t('Active')], ['ending', t('Ending within 7 days')], ['expired', t('Expired, not renewed')], ['frozen', t('Frozen')], ['all', t('All')]].map(([k, l]) => (
                <Button key={k} size="sm" className="h-7" variant={filter === k ? 'secondary' : 'ghost'} onClick={() => setParams({ filter: k! }, { replace: true })}>{l}</Button>
              ))}
            </div>
            <Input className="max-w-xs" value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t('Name, phone or card')} aria-label={t('Search')} />
          </div>
          {list.isLoading ? <Skeleton className="h-64" /> : !rows.length ? <EmptyState icon={CreditCard} title={t('No members here')} description={t('Sell the first membership; the member gets a card number to show at the door.')} /> : (
            <Card><CardContent className="p-0"><ul className="divide-y">
              {rows.map((m) => {
                const left = Math.round((Date.parse(m.ends_on) - Date.parse(today)) / 86_400_000)
                return (
                  <li key={m.id} className="flex flex-wrap items-center gap-3 px-4 py-2.5 text-sm">
                    <span className="min-w-0 flex-1"><span className="font-medium">{m.partner?.name}</span> <span className="text-muted-foreground">· {m.plan?.name}</span>
                      <span className="block text-xs text-muted-foreground">{t('Card {code}', { code: m.code })} · {formatDate(m.starts_on)} – {formatDate(m.ends_on)}
                        {m.visits ? ` · ${t('{used} of {total} visits', { used: m.visits_used, total: m.visits })}` : ''}{m.partner?.phone ? ` · ${m.partner.phone}` : ''}</span></span>
                    {m.status === 'active' && left >= 0 && left <= 7 && <Badge variant="outline" className="border-warning/50 text-warning">{left === 0 ? t('ends today') : tn(left, '{n} day left', '{n} days left')}</Badge>}
                    <StatusBadge status={m.status} label={t(MEMBERSHIP_STATUS[m.status])} />
                    <Can perm="sales.write"><span className="flex gap-1">
                      {m.status === 'active' && <Button size="icon" variant="ghost" className="size-8" aria-label={t('Freeze')} title={t('Freeze: the days are added at the end')} onClick={() => freeze.mutate({ id: m.id, on: true })}><Pause /></Button>}
                      {m.status === 'frozen' && <Button size="icon" variant="ghost" className="size-8" aria-label={t('Continue')} title={t('Continue')} onClick={() => freeze.mutate({ id: m.id, on: false })}><Play /></Button>}
                      {!m.renewed_by && <Button size="sm" variant="ghost" onClick={() => setSell({ partner_id: m.partner_id })}><RefreshCw /> {t('Renew')}</Button>}
                      {m.invoice_id && <Button size="sm" variant="ghost" asChild><Link to={`/sales/invoices/${m.invoice_id}`}>{t('Invoice')}</Link></Button>}
                    </span></Can>
                  </li>
                )
              })}
            </ul></CardContent></Card>
          )}
        </div>
        <div className="grid h-fit gap-4">
          <Door onRenew={(partner) => setSell({ partner_id: partner })} />
          <Card>
            <CardHeader className="flex-row items-center justify-between gap-2 space-y-0"><CardTitle>{t('Plans')} <span className="text-xs font-normal text-muted-foreground">· {t('prices with VAT')}</span></CardTitle>
              <Can perm="sales.write"><Button size="sm" variant="outline" onClick={() => setPlan('new')}><Plus /> {t('Add')}</Button></Can></CardHeader>
            <CardContent className="p-0"><ul className="divide-y">
              {(plans.data ?? []).map((p) => (
                <li key={p.id} className={cn('flex items-center gap-2 px-4 py-2 text-sm', !p.is_active && 'opacity-50')}>
                  <span className="flex-1"><span className="font-medium">{p.name}</span><span className="block text-xs text-muted-foreground">{planLength(p)}</span></span>
                  <span className="tabular">{formatMoney(p.price)}</span>
                  <Can perm="sales.write"><Button size="icon" variant="ghost" className="size-8" aria-label={t('Edit')} onClick={() => setPlan(p)}><Pencil /></Button></Can>
                </li>
              ))}
              {!plans.data?.length && <li className="px-4 py-4 text-[13px] text-muted-foreground">{t('Add the plans you sell: Monthly, Yearly, 10 visits…')}</li>}
            </ul></CardContent>
          </Card>
        </div>
      </div>
      {sell && <SellDialog partnerId={sell.partner_id} plans={(plans.data ?? []).filter((p) => p.is_active)} onClose={() => setSell(null)} />}
      {plan && <PlanDialog plan={plan === 'new' ? null : plan} count={plans.data?.length ?? 0} onClose={() => setPlan(null)} />}
    </>
  )
}

/** At the door: scan or type the card, the phone or the name */
function Door({ onRenew }: { onRenew: (partner: string) => void }) {
  const { companyId, can } = useCompany()
  const [code, setCode] = React.useState('')
  const [res, setRes] = React.useState<CheckIn | null>(null)
  const check = useApptAction(async (c: string) => unwrap(await supabase.rpc('membership_check_in', { p_company: companyId!, p_code: c })) as unknown as CheckIn)
  const why: Record<string, string> = { unknown: t('No member with this card, phone or name'), frozen: t('The membership is frozen'), expired: t('The membership has ended'),
    not_yet: t('The membership has not started yet'), no_visits: t('All visits are used') }
  return (
    <Card>
      <CardHeader><CardTitle className="flex items-center gap-2"><ScanLine className="size-4" /> {t('At the door')}</CardTitle>
        <CardDescription>{t('Scan the card or type its number, the phone or the name.')}</CardDescription></CardHeader>
      <CardContent className="grid gap-3">
        <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); if (code.trim()) check.mutate(code.trim(), { onSuccess: (r) => { setRes(r); setCode('') } }) }}>
          <Input autoFocus value={code} onChange={(e) => setCode(e.target.value)} placeholder={t('Card number')} aria-label={t('Card number')} disabled={!can('sales.write')} />
          <Button type="submit" loading={check.isPending} disabled={!can('sales.write')}>{t('Check in')}</Button>
        </form>
        {res && (
          <div className={cn('grid gap-1 rounded-lg border p-3 text-sm', res.ok ? 'border-success/40 bg-success/5' : 'border-destructive/40 bg-destructive/5')}>
            <div className="flex items-center gap-2 font-semibold">{res.ok ? <CheckCircle2 className="size-5 text-success" /> : <XCircle className="size-5 text-destructive" />}
              {res.member ?? t('Unknown')}</div>
            {res.ok ? <>
              <span>{res.plan} · {t('until {date}', { date: formatDate(res.ends_on!) })}{res.days_left != null && res.days_left <= 7 ? ` · ${tn(res.days_left, '{n} day left', '{n} days left')}` : ''}</span>
              {res.visits != null && <span>{t('{used} of {total} visits', { used: res.visits_used ?? 0, total: res.visits })}</span>}
              {res.again_today && <span className="text-muted-foreground">{t('Already came in today; not counted again.')}</span>}
            </> : <>
              <span>{why[res.reason ?? 'unknown']}{res.ends_on ? ` · ${formatDate(res.ends_on)}` : ''}</span>
              {res.partner_id && (res.reason === 'expired' || res.reason === 'no_visits') && <Button size="sm" className="justify-self-start" onClick={() => onRenew(res.partner_id!)}><RefreshCw /> {t('Renew now')}</Button>}
            </>}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function SellDialog({ partnerId, plans, onClose }: { partnerId?: string; plans: Plan[]; onClose: () => void }) {
  const { companyId } = useCompany()
  const customers = useCustomers()
  const navigate = useNavigate()
  const [partner, setPartner] = React.useState<string | null>(partnerId ?? null)
  const [name, setName] = React.useState('')
  const [phone, setPhone] = React.useState('')
  const [planId, setPlanId] = React.useState<string | null>(plans[0]?.id ?? null)
  const [price, setPrice] = React.useState(num(plans[0]?.price))
  const [code, setCode] = React.useState('')
  const sell = useApptAction(async () => unwrap(await supabase.rpc('membership_sell', { p: { company_id: companyId, plan_id: planId, partner_id: partner, client_name: name, client_phone: phone, price, code } as never })) as unknown as { number: string; code: string; invoice_id: string; ends_on: string })
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>{t('Sell a membership')}</DialogTitle><DialogDescription>{t('A renewal starts the day after the current one ends and keeps the same card.')}</DialogDescription></DialogHeader>
        <div className="grid gap-3">
          <div className="grid gap-1.5"><Label>{t('Member')}</Label>
            <SearchSelect value={partner} onChange={setPartner} clearable placeholder={t('A client on file (or write a new one below)')}
              options={(customers.data ?? []).map((c) => ({ value: c.id, label: c.name, hint: c.phone ?? c.code }))} /></div>
          {!partner && <div className="grid grid-cols-2 gap-2">
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder={t('Name and surname')} aria-label={t('Name and surname')} />
            <Input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder={t('Phone')} aria-label={t('Phone')} />
          </div>}
          <div className="grid gap-1.5"><Label>{t('Plan')}</Label>
            <div className="grid gap-1.5">{plans.map((p) => (
              <button key={p.id} type="button" onClick={() => { setPlanId(p.id); setPrice(num(p.price)) }}
                className={cn('flex items-center justify-between rounded-md border px-3 py-2 text-left text-sm', planId === p.id ? 'border-primary bg-primary/5' : 'hover:bg-muted')}>
                <span><span className="font-medium">{p.name}</span><span className="block text-xs text-muted-foreground">{planLength(p)}</span></span><span className="tabular" title={t('Price with VAT')}>{formatMoney(p.price)}</span>
              </button>))}</div></div>
          <div className="grid grid-cols-2 gap-2">
            <div className="grid gap-1.5"><Label htmlFor="sp">{t('Price with VAT')}</Label><Input id="sp" type="number" step="0.01" value={price} onChange={(e) => setPrice(num(e.target.value))} /></div>
            <div className="grid gap-1.5"><Label htmlFor="sc">{t('Card number (optional)')}</Label><Input id="sc" value={code} onChange={(e) => setCode(e.target.value)} placeholder={t('made by itself')} /></div>
          </div>
        </div>
        <DialogFooter><Button variant="ghost" onClick={onClose}>{t('Cancel')}</Button>
          <Button loading={sell.isPending} disabled={!planId || (!partner && !name.trim())} onClick={() => sell.mutate(undefined, { onSuccess: (r) => {
            toast.success(t('Sold: card {code}, valid until {date}', { code: r.code, date: formatDate(r.ends_on) })); onClose(); navigate(`/sales/invoices/${r.invoice_id}`)
          } })}>{t('Sell, to the invoice')}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function PlanDialog({ plan, count, onClose }: { plan: Plan | null; count: number; onClose: () => void }) {
  const { companyId } = useCompany()
  const [name, setName] = React.useState(plan?.name ?? '')
  const [months, setMonths] = React.useState(plan?.months ?? 1)
  const [days, setDays] = React.useState(plan?.days ?? 0)
  const [visits, setVisits] = React.useState<number | ''>(plan?.visits ?? '')
  const [price, setPrice] = React.useState(num(plan?.price))
  const [active, setActive] = React.useState(plan?.is_active ?? true)
  const save = useApptAction(async () => {
    const row = { name: name.trim(), months, days, visits: visits === '' ? null : visits, price, is_active: active }
    if (plan) return unwrap(await supabase.from('membership_plans').update(row as never).eq('id', plan.id))
    return unwrap(await supabase.from('membership_plans').insert({ ...row, company_id: companyId, sort: count } as never))
  })
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>{plan ? plan.name : t('New plan')}</DialogTitle></DialogHeader>
        <div className="grid gap-3">
          <div className="grid gap-1.5"><Label htmlFor="pn">{t('Name')}</Label><Input id="pn" value={name} onChange={(e) => setName(e.target.value)} placeholder={t('e.g. Monthly, Yearly, 10 visits')} /></div>
          <div className="grid grid-cols-3 gap-2">
            <div className="grid gap-1.5"><Label htmlFor="pm">{t('Months')}</Label><Input id="pm" type="number" min={0} value={months} onChange={(e) => setMonths(num(e.target.value))} /></div>
            <div className="grid gap-1.5"><Label htmlFor="pd">{t('Days')}</Label><Input id="pd" type="number" min={0} value={days} onChange={(e) => setDays(num(e.target.value))} /></div>
            <div className="grid gap-1.5"><Label htmlFor="pv">{t('Visits')}</Label><Input id="pv" type="number" min={1} value={visits} onChange={(e) => setVisits(e.target.value ? num(e.target.value) : '')} placeholder={t('no limit')} /></div>
          </div>
          <div className="grid gap-1.5"><Label htmlFor="pp">{t('Price with VAT')}</Label><Input id="pp" type="number" step="0.01" value={price} onChange={(e) => setPrice(num(e.target.value))} /></div>
          {plan && <label className="flex items-center justify-between text-sm">{t('Active')}<Switch checked={active} onCheckedChange={setActive} /></label>}
        </div>
        <DialogFooter><Button variant="ghost" onClick={onClose}>{t('Cancel')}</Button>
          <Button loading={save.isPending} disabled={!name.trim() || (months <= 0 && days <= 0)} onClick={() => save.mutate(undefined, { onSuccess: () => { toast.success(t('Saved')); onClose() } })}>{t('Save')}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
