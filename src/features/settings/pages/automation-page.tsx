import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { CalendarClock, Coins, Repeat, Tags, TrendingUp, Wallet } from 'lucide-react'
import * as React from 'react'
import { Link } from 'react-router-dom'
import { toast } from 'sonner'
import { useCompany } from '@/app/company-provider'
import { PageHeader } from '@/components/page-header'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { describeError, unwrap } from '@/lib/errors'
import { supabase } from '@/lib/supabase'
import { t } from '@/i18n'
import { MessagingSettings } from '../components/messaging'
import { AutomationCard } from '../components/automation-card'

type Settings = { pos_cash_tolerance: number; pos_count_notes: boolean; pos_void_approval: boolean; pos_close_witness: 'never' | 'difference' | 'always'
  payroll_auto_day: number | null; payroll_auto_for: 'previous' | 'current'; payroll_deduct_absence: boolean
  payroll_night_pct: number | null; payroll_holiday_pct: number | null; purchase_price_tolerance: number }

export function usePayrollTillSettings() {
  const { companyId } = useCompany()
  return useQuery({
    queryKey: ['automation-settings', companyId],
    enabled: !!companyId,
    queryFn: async () => unwrap(await supabase.from('company_settings')
      .select('pos_cash_tolerance, pos_count_notes, pos_void_approval, pos_close_witness, payroll_auto_day, payroll_auto_for, payroll_deduct_absence, payroll_night_pct, payroll_holiday_pct, purchase_price_tolerance').eq('company_id', companyId!).single()) as unknown as Settings,
  })
}
export function useSavePayrollTillSettings() {
  const { companyId } = useCompany()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (patch: Record<string, unknown>) => unwrap(await supabase.rpc('automation_settings_save', { p_company: companyId!, p_patch: patch as never })),
    onSuccess: () => { toast.success(t('Saved')); void qc.invalidateQueries({ queryKey: ['automation-settings', companyId] }) },
    onError: (e) => toast.error(describeError(e)),
  })
}

export function AutomationPage() {
  const { can, company } = useCompany()
  const q = usePayrollTillSettings()
  const save = useSavePayrollTillSettings()
  const s = q.data
  const [tol, setTol] = React.useState('')
  React.useEffect(() => { if (s) setTol(String(s.pos_cash_tolerance)) }, [s])
  const [rise, setRise] = React.useState('')
  React.useEffect(() => { if (s) setRise(String(s.purchase_price_tolerance ?? 1)) }, [s])

  return (
    <div className="mx-auto grid max-w-3xl gap-3">
      <PageHeader title={t('Automations')} description={t('What DrisPRO does by itself, and when. Each one prepares the work; whatever touches money, the law or goods in the shop still waits for a person to confirm.')} />

      {can('inventory.read') && (
        <AutomationCard icon={Tags} title={t('New selling prices from the cost')} aside={<Button variant="outline" size="sm" asChild><Link to="/inventory/levelling?tab=suggestions">{t('Open')}</Link></Button>}>
          <p className="text-[13px] text-muted-foreground">{t('When goods arrive at a new cost, the price that keeps the category margin waits for you to accept it. The margins are set on that page.')}</p>
        </AutomationCard>
      )}

      {can('invoicing.read') && (
        <AutomationCard icon={Repeat} title={t('Recurring invoices')} aside={<Button variant="outline" size="sm" asChild><Link to="/sales/recurring">{t('Open')}</Link></Button>}>
          <p className="text-[13px] text-muted-foreground">{t('Rent, subscriptions and maintenance: made every morning on their day. Start one from an invoice with "Repeat".')}</p>
        </AutomationCard>
      )}

      {can('pos.read') && s && (
        <AutomationCard icon={Wallet} title={t('End of the day at the till')}>
          <p className="text-[13px] text-muted-foreground">{t('When a till closes with a cash difference, the managers are told at once. Every morning, tills left open since yesterday are reported.')}</p>
          <div className="flex flex-wrap items-end gap-2">
            <div className="grid gap-1.5"><Label htmlFor="tol">{t('Tell me when the difference is more than')}</Label>
              <Input id="tol" type="number" min="0" step="any" className="w-36 text-right tabular" value={tol} onChange={(e) => setTol(e.target.value)} disabled={!can('pos.approve')} /></div>
            {can('pos.approve') && <Button variant="outline" disabled={tol === String(s.pos_cash_tolerance) || tol === ''} loading={save.isPending}
              onClick={() => save.mutate({ pos_cash_tolerance: Number(tol) })}>{t('Save')}</Button>}
          </div>
          <label className="flex items-start justify-between gap-3 rounded-md border p-3 text-[13px]">
            <span><span className="font-medium">{t('Count by note and coin when closing')}</span>
              <span className="block text-muted-foreground">{t('The cashier types how many of each note and coin; the program adds them up. Off: only the total counted is typed.')}</span></span>
            <Switch checked={s.pos_count_notes} disabled={!can('pos.approve') || save.isPending} aria-label={t('Count by note and coin when closing')}
              onCheckedChange={(on) => save.mutate({ pos_count_notes: on })} />
          </label>
          <div className="flex flex-wrap items-start justify-between gap-3 rounded-md border p-3 text-[13px]">
            <span className="min-w-0 flex-1"><span className="font-medium">{t('The manager confirms the count')}</span>
              <span className="block text-muted-foreground">{t('The manager picks their name and types their PIN on the till. A manager closing their own till, or a shop where no manager has a PIN, closes without it.')}</span></span>
            <Select value={s.pos_close_witness} disabled={!can('pos.approve') || save.isPending} onValueChange={(v) => save.mutate({ pos_close_witness: v })}>
              <SelectTrigger className="w-56" aria-label={t('The manager confirms the count')}><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="difference">{t('When the drawer is off')}</SelectItem>
                <SelectItem value="always">{t('Always')}</SelectItem>
                <SelectItem value="never">{t('Never')}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <label className="flex items-start justify-between gap-3 rounded-md border p-3 text-[13px]">
            <span><span className="font-medium">{t('Voids need a manager')}</span>
              <span className="block text-muted-foreground">{t('Taking an item off a sale, lowering its quantity or clearing a sale asks for a manager\'s PIN (once per sale). Every void is kept with the shift either way.')}</span></span>
            <Switch checked={s.pos_void_approval} disabled={!can('pos.approve') || save.isPending} aria-label={t('Voids need a manager')}
              onCheckedChange={(on) => save.mutate({ pos_void_approval: on })} />
          </label>
        </AutomationCard>
      )}

      {can('payroll.read') && s && (
        <AutomationCard icon={CalendarClock} title={t('Monthly payroll')}
          aside={<Switch checked={s.payroll_auto_day != null} disabled={!can('payroll.write') || save.isPending} aria-label={t('Monthly payroll')}
            onCheckedChange={(on) => save.mutate({ payroll_auto_day: on ? '1' : '' })} />}>
          <p className="text-[13px] text-muted-foreground">{t('On the chosen day the payroll is made and calculated from contracts, overtime in attendance and leave, as a draft. Payroll is told to check it; approving and paying stay with you.')}</p>
          {s.payroll_auto_day != null && (
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="grid gap-1.5"><Label>{t('Prepare it on day')}</Label>
                <Select value={String(s.payroll_auto_day)} disabled={!can('payroll.write')} onValueChange={(v) => save.mutate({ payroll_auto_day: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{Array.from({ length: 28 }, (_, i) => i + 1).map((d) => <SelectItem key={d} value={String(d)}>{d}</SelectItem>)}</SelectContent>
                </Select></div>
              <div className="grid gap-1.5"><Label>{t('For')}</Label>
                <Select value={s.payroll_auto_for} disabled={!can('payroll.write')} onValueChange={(v) => save.mutate({ payroll_auto_for: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="previous">{t('The month before')}</SelectItem>
                    <SelectItem value="current">{t('The same month')}</SelectItem>
                  </SelectContent>
                </Select></div>
              <label className="flex items-start justify-between gap-3 text-sm sm:col-span-2">
                <span><span className="block">{t('Count days absent without leave as unpaid')}</span>
                  <span className="text-xs text-muted-foreground">{t('Only for people whose attendance is kept: a working day with no attendance and no approved leave.')}</span></span>
                <Switch checked={s.payroll_deduct_absence} disabled={!can('payroll.write')} onCheckedChange={(v) => save.mutate({ payroll_deduct_absence: v })} />
              </label>
              <div className="grid gap-1.5"><Label htmlFor="pr-night">{t('Night work premium %')}</Label>
                <Input id="pr-night" type="number" step="1" min="0" max="200" className="w-28 text-right" defaultValue={s.payroll_night_pct ?? ''} placeholder="20" disabled={!can('payroll.write')}
                  onBlur={(e) => { if (e.target.value !== String(s.payroll_night_pct ?? '')) save.mutate({ payroll_night_pct: e.target.value }) }} /></div>
              <div className="grid gap-1.5"><Label htmlFor="pr-hol">{t('Holiday and rest-day premium %')}</Label>
                <Input id="pr-hol" type="number" step="1" min="0" max="200" className="w-28 text-right" defaultValue={s.payroll_holiday_pct ?? ''} placeholder={company?.country_code === 'XK' ? '50' : '25'} disabled={!can('payroll.write')}
                  onBlur={(e) => { if (e.target.value !== String(s.payroll_holiday_pct ?? '')) save.mutate({ payroll_holiday_pct: e.target.value }) }} /></div>
              <p className="text-xs text-muted-foreground sm:col-span-2">{t('Hours worked between 22:00 and 06:00, and on public holidays or rest days, come from attendance and are paid this much extra. Empty: the usual rate of the law (night 20 %; holidays 25 % in Albania, 50 % in Kosovo).')}</p>
            </div>
          )}
        </AutomationCard>
      )}

      {can('admin.read') && <MessagingSettings />}

      {can('procurement.read') && s && (
        <AutomationCard icon={TrendingUp} title={t('Price rises from vendors')}>
          <p className="text-[13px] text-muted-foreground">{t('A bill priced above what was paid to that vendor before (or their price list) waits for a procurement or finance manager to accept the new price, with a reason. Small changes pass on their own.')}</p>
          <div className="flex flex-wrap items-end gap-2">
            <div className="grid gap-1.5"><Label htmlFor="rise">{t('Rises up to this % pass on their own')}</Label>
              <Input id="rise" type="number" min="0" max="50" step="0.5" className="w-36 text-right tabular" value={rise} onChange={(e) => setRise(e.target.value)} disabled={!can('procurement.approve')} /></div>
            {can('procurement.approve') && <Button variant="outline" disabled={rise === String(s.purchase_price_tolerance) || rise === '' || Number(rise) < 0 || Number(rise) > 50} loading={save.isPending}
              onClick={() => save.mutate({ purchase_price_tolerance: Number(rise) })}>{t('Save')}</Button>}
          </div>
        </AutomationCard>
      )}

      {can('inventory.read') && (
        <AutomationCard icon={Coins} title={t('Replenishment')} aside={<Button variant="outline" size="sm" asChild><Link to="/procurement/replenishment">{t('Open')}</Link></Button>}>
          <p className="text-[13px] text-muted-foreground">{t('Every morning: what to order from whom, from stock levels and open orders, as suggestions or draft purchase orders.')}</p>
        </AutomationCard>
      )}
    </div>
  )
}
