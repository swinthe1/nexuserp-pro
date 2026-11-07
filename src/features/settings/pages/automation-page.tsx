import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { CalendarClock, Coins, PackagePlus, Repeat, Tags, TrendingUp, Wallet } from 'lucide-react'
import * as React from 'react'
import type { ScaleSetup } from '@/lib/scale-barcode'
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
import { formatMoney } from '@/lib/utils'
import { t } from '@/i18n'
import { MessagingSettings } from '../components/messaging'
import { AutomationCard } from '../components/automation-card'
import { ErrorState } from '@/components/error-state'
import { Skeleton } from '@/components/ui/skeleton'

type Settings = { pos_cash_tolerance: number; pos_count_notes: boolean; pos_void_approval: boolean; pos_close_witness: 'never' | 'difference' | 'always'
  payroll_auto_day: number | null; payroll_auto_for: 'previous' | 'current'; payroll_deduct_absence: boolean
  payroll_night_pct: number | null; payroll_holiday_pct: number | null; purchase_price_tolerance: number
  new_items_from_bills: 'anyone' | 'approval'
  /** a server not updated yet has none of these */
  pos_review?: 'off' | 'manager'; pos_review_hours?: number; pos_blind_count?: boolean; pos_lock_minutes?: number; pos_waiter_handover?: boolean
  pos_payouts?: 'off' | 'manager' | 'anyone'; pos_receipt_max?: number | null; scale_barcode?: ScaleSetup; pos_void_notify?: boolean; pos_void_notify_over?: number; pos_void_whatsapp?: string[]; min_shelf_days?: number | null }

export function usePayrollTillSettings() {
  const { companyId } = useCompany()
  return useQuery({
    queryKey: ['automation-settings', companyId],
    enabled: !!companyId,
    queryFn: async () => unwrap(await supabase.from('company_settings')
      .select('*').eq('company_id', companyId!).single()) as unknown as Settings,
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
  const [over, setOver] = React.useState('')
  const [phones, setPhones] = React.useState('')
  const [rmax, setRmax] = React.useState('')
  React.useEffect(() => { if (s) setRmax(s.pos_receipt_max == null ? '' : String(s.pos_receipt_max)) }, [s])
  React.useEffect(() => { if (s) { setOver(String(s.pos_void_notify_over ?? 0)); setPhones((s.pos_void_whatsapp ?? []).join(', ')) } }, [s])
  const [shelf, setShelf] = React.useState('')
  React.useEffect(() => { if (s) setShelf(s.min_shelf_days == null ? '' : String(s.min_shelf_days)) }, [s])
  const [rise, setRise] = React.useState('')
  React.useEffect(() => { if (s) setRise(String(s.purchase_price_tolerance ?? 1)) }, [s])

  return (
    <div className="mx-auto grid max-w-3xl gap-3">
      <PageHeader title={t('Automations')} description={t('What DrisPRO does by itself, and when. Each one prepares the work; whatever touches money, the law or goods in the shop still waits for a person to confirm.')} />
      {q.isLoading && <Skeleton className="h-40" />}
      {q.isError && <ErrorState error={q.error} onRetry={() => void q.refetch()} />}

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
          {s.pos_review !== undefined && <>
            <div className="flex flex-wrap items-start justify-between gap-3 rounded-md border p-3 text-[13px]">
              <span className="min-w-0 flex-1"><span className="font-medium">{t('The manager reconciles every shift')}</span>
                <span className="block text-muted-foreground">{t('The cashier closes with her count and the sales are booked; the cash goes to the safe, with its difference, when a manager checks and confirms it (Point of sale → Reconciling the tills). Off: the cashier\'s close is final.')}</span></span>
              <div className="flex items-center gap-2">
                {s.pos_review === 'manager' && <Select value={String(s.pos_review_hours ?? 24)} disabled={!can('pos.approve') || save.isPending} onValueChange={(v) => save.mutate({ pos_review_hours: Number(v) })}>
                  <SelectTrigger className="w-40" aria-label={t('Remind after')}><SelectValue /></SelectTrigger>
                  <SelectContent>{[4, 8, 12, 24, 48, 72].map((h) => <SelectItem key={h} value={String(h)}>{t('Remind after {n} h', { n: h })}</SelectItem>)}</SelectContent>
                </Select>}
                <Switch checked={s.pos_review === 'manager'} disabled={!can('pos.approve') || save.isPending} aria-label={t('The manager reconciles every shift')}
                  onCheckedChange={(on) => save.mutate({ pos_review: on ? 'manager' : 'off' })} />
              </div>
            </div>
            <label className="flex items-start justify-between gap-3 rounded-md border p-3 text-[13px]">
              <span><span className="font-medium">{t('Blind count at closing')}</span>
                <span className="block text-muted-foreground">{t('The cashier counts the drawer without seeing what is expected or the difference; a manager sees both.')}</span></span>
              <Switch checked={s.pos_blind_count ?? true} disabled={!can('pos.approve') || save.isPending} aria-label={t('Blind count at closing')}
                onCheckedChange={(on) => save.mutate({ pos_blind_count: on })} />
            </label>
          </>}
          {s.pos_waiter_handover !== undefined && (
            <label className="flex items-start justify-between gap-3 rounded-md border p-3 text-[13px]">
              <span><span className="font-medium">{t('Waiters hand over their takings')}</span>
                <span className="block text-muted-foreground">{t('On a restaurant or café till, a waiter who takes the payment at the table keeps the cash and hands it over at the till; the shift does not close until every waiter has. A difference stays with the waiter.')}</span></span>
              <Switch checked={s.pos_waiter_handover} disabled={!can('pos.approve') || save.isPending} aria-label={t('Waiters hand over their takings')}
                onCheckedChange={(on) => save.mutate({ pos_waiter_handover: on })} />
            </label>
          )}
          {s.pos_lock_minutes !== undefined && (
            <div className="flex flex-wrap items-start justify-between gap-3 rounded-md border p-3 text-[13px]">
              <span className="min-w-0 flex-1"><span className="font-medium">{t('The till locks by itself')}</span>
                <span className="block text-muted-foreground">{t('After these minutes without a touch or a key the till locks; the sale on the screen stays. The cashier opens it with her PIN, or a manager with theirs. The Lock button works either way.')}</span></span>
              <Select value={String(s.pos_lock_minutes ?? 0)} disabled={!can('pos.approve') || save.isPending} onValueChange={(v) => save.mutate({ pos_lock_minutes: Number(v) })}>
                <SelectTrigger className="w-44" aria-label={t('The till locks by itself')}><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="0">{t('Never by itself')}</SelectItem>
                  {[2, 5, 10, 15, 30].map((m) => <SelectItem key={m} value={String(m)}>{t('After {n} min', { n: m })}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          )}
          <label className="flex items-start justify-between gap-3 rounded-md border p-3 text-[13px]">
            <span><span className="font-medium">{t('Voids need a manager')}</span>
              <span className="block text-muted-foreground">{t('Taking an item off a sale, lowering its quantity or clearing a sale asks for a manager\'s PIN (once per sale). Every void is kept with the shift either way.')}</span></span>
            <Switch checked={s.pos_void_approval} disabled={!can('pos.approve') || save.isPending} aria-label={t('Voids need a manager')}
              onCheckedChange={(on) => save.mutate({ pos_void_approval: on })} />
          </label>
          {s.pos_void_notify !== undefined && (
            <div className="grid gap-3 rounded-md border p-3 text-[13px]">
              <label className="flex items-start justify-between gap-3">
                <span><span className="font-medium">{t('Tell the managers of every item taken off')}</span>
                  <span className="block text-muted-foreground">{t('At once, in DrisPRO and on the phone: the item, quantity, amount, date and time, the till and the cashier. With this on, the PIN above can be switched off so the cashier does not wait.')}</span></span>
                <Switch checked={!!s.pos_void_notify} disabled={!can('pos.approve') || save.isPending} aria-label={t('Tell the managers of every item taken off')}
                  onCheckedChange={(on) => save.mutate({ pos_void_notify: on })} />
              </label>
              {s.pos_void_notify && (
                <div className="grid gap-3 sm:grid-cols-[180px_1fr]">
                  <div className="grid gap-1.5"><Label htmlFor="void-over">{t('Only from this amount')}</Label>
                    <Input id="void-over" type="number" min="0" step="any" className="text-right tabular" value={over} disabled={!can('pos.approve')}
                      onChange={(e) => setOver(e.target.value)} onBlur={() => { if (over !== '' && Number(over) !== Number(s.pos_void_notify_over ?? 0)) save.mutate({ pos_void_notify_over: Number(over) }) }} /></div>
                  <div className="grid gap-1.5"><Label htmlFor="void-wa">{t('Also on WhatsApp, to these numbers')}</Label>
                    <Input id="void-wa" value={phones} disabled={!can('pos.approve')} placeholder="044 123 456, 049 765 432" onChange={(e) => setPhones(e.target.value)}
                      onBlur={() => { const list = phones.split(/[,;\n]/).map((x) => x.trim()).filter(Boolean); if (list.join(',') !== (s.pos_void_whatsapp ?? []).join(',')) save.mutate({ pos_void_whatsapp: list }) }} />
                    <span className="text-[12px] text-muted-foreground">{t('Needs WhatsApp set up under Messages, with the template drispro_fshirje_arke approved.')}</span></div>
                </div>
              )}
            </div>
          )}
          {s.pos_receipt_max !== undefined && (
            <div className="flex flex-wrap items-start justify-between gap-3 rounded-md border p-3 text-[13px]">
              <span className="min-w-0 flex-1"><span className="font-medium">{t('The highest value of one receipt')}</span>
                <span className="block text-muted-foreground">{t('For every unit without a limit of its own. A sale above it is not made at the till: the cashier splits it or asks. Empty: no limit.')}</span></span>
              <div className="flex items-center gap-2">
                <Input type="number" min="0" step="any" className="w-32 text-right tabular" value={rmax} placeholder={t('No limit')} disabled={!can('pos.approve')}
                  onChange={(e) => setRmax(e.target.value)} aria-label={t('The highest value of one receipt')} />
                {can('pos.approve') && <Button variant="outline" size="sm" disabled={rmax === (s.pos_receipt_max == null ? '' : String(s.pos_receipt_max)) || save.isPending}
                  onClick={() => save.mutate({ pos_receipt_max: rmax.trim() === '' ? '' : Number(rmax) })}>{t('Save')}</Button>}
              </div>
              <ReceiptMaxUnits companyMax={s.pos_receipt_max ?? null} disabled={!can('pos.approve')} />
            </div>
          )}
          {s.scale_barcode !== undefined && <ScaleRow value={s.scale_barcode} disabled={!can('pos.approve') || save.isPending} onSave={(v) => save.mutate({ scale_barcode: v })} />}
          {s.pos_payouts !== undefined && (
            <div className="flex flex-wrap items-start justify-between gap-3 rounded-md border p-3 text-[13px]">
              <span className="min-w-0 flex-1"><span className="font-medium">{t('Paying suppliers and expenses from the till')}</span>
                <span className="block text-muted-foreground">{t('Cash from the drawer to a supplier goes onto their card at once; an expense goes into the books with the shop. Both come off the cash expected at closing.')}</span></span>
              <Select value={s.pos_payouts} disabled={!can('pos.approve') || save.isPending} onValueChange={(v) => save.mutate({ pos_payouts: v })}>
                <SelectTrigger className="w-64" aria-label={t('Paying suppliers and expenses from the till')}><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="manager">{t('A manager, or with their PIN')}</SelectItem>
                  <SelectItem value="anyone">{t('Every cashier')}</SelectItem>
                  <SelectItem value="off">{t('Nobody (only in Finance)')}</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}
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

      {can('procurement.read') && s && s.min_shelf_days !== undefined && (
        <AutomationCard icon={CalendarClock} title={t('Shortest shelf life at receiving')}>
          <p className="text-[13px] text-muted-foreground">{t('Goods that expire sooner than this are refused when they come in (a lot scanned in the warehouse, a purchase invoice with expiry dates); a manager can still accept them. An item can ask for more or fewer days on its own card.')}</p>
          <div className="flex flex-wrap items-end gap-2">
            <div className="grid gap-1.5"><Label htmlFor="shelf">{t('Days it must still have')}</Label>
              <Input id="shelf" type="number" min="1" max="3650" step="1" className="w-36 text-right tabular" placeholder={t('No check')} value={shelf} onChange={(e) => setShelf(e.target.value)} disabled={!can('procurement.approve')} /></div>
            {can('procurement.approve') && <Button variant="outline" disabled={shelf === (s.min_shelf_days == null ? '' : String(s.min_shelf_days)) || (shelf !== '' && (Number(shelf) < 1 || Number(shelf) > 3650))} loading={save.isPending}
              onClick={() => save.mutate({ min_shelf_days: shelf === '' ? '' : Math.round(Number(shelf)) })}>{t('Save')}</Button>}
          </div>
        </AutomationCard>
      )}

      {can('inventory.read') && s && <NewItemsCard mode={s.new_items_from_bills} />}

      {can('inventory.read') && (
        <AutomationCard icon={Coins} title={t('Replenishment')} aside={<Button variant="outline" size="sm" asChild><Link to="/procurement/replenishment">{t('Open')}</Link></Button>}>
          <p className="text-[13px] text-muted-foreground">{t('Every morning: what to order from whom, from stock levels and open orders, as suggestions or draft purchase orders.')}</p>
        </AutomationCard>
      )}
    </div>
  )
}

/** who makes the new items that come on supplier invoices */
function NewItemsCard({ mode }: { mode: 'anyone' | 'approval' }) {
  const { companyId, can } = useCompany()
  const qc = useQueryClient()
  const save = useMutation({
    mutationFn: async (m: string) => unwrap(await supabase.rpc('new_items_setting_save', { p_company: companyId!, p_mode: m })),
    onSuccess: () => { toast.success(t('Saved')); void qc.invalidateQueries({ queryKey: ['automation-settings', companyId] }) },
    onError: (e) => toast.error(describeError(e)),
  })
  const may = can('admin.write') || can('inventory.approve')
  return (
    <AutomationCard icon={PackagePlus} title={t('New items from supplier invoices')}
      aside={<Switch checked={mode === 'approval'} disabled={!may || save.isPending} aria-label={t('New items need approval')} onCheckedChange={(on) => save.mutate(on ? 'approval' : 'anyone')} />}>
      <p className="text-[13px] text-muted-foreground">{mode === 'approval'
        ? t('On: an item that is not in DrisPRO yet is not made from an invoice by whoever enters it. The line waits, and the people who approve items make it or refuse it under Products → New items to approve.')
        : t('Off: whoever enters a supplier invoice may make a new item from its line. Turn it on so that new items wait for someone who approves items.')}</p>
    </AutomationCard>
  )
}

/** how the scales print their barcodes: the prefixes, the PLU's length, the weight or the price inside */
function ScaleRow({ value, disabled, onSave }: { value: ScaleSetup; disabled: boolean; onSave: (v: ScaleSetup) => void }) {
  const [v, setV] = React.useState<ScaleSetup>(value)
  const [prefixes, setPrefixes] = React.useState((value.prefixes ?? []).join(', '))
  React.useEffect(() => { setV(value); setPrefixes((value.prefixes ?? []).join(', ')) }, [value])
  const next: ScaleSetup = { ...v, prefixes: prefixes.split(/[\s,;]+/).filter((x) => /^\d{1,2}$/.test(x)) }
  const changed = JSON.stringify(next) !== JSON.stringify({ ...value, prefixes: value.prefixes ?? [] })
  return (
    <div className="grid gap-2 rounded-md border p-3 text-[13px]">
      <div className="flex items-start justify-between gap-3">
        <span className="min-w-0 flex-1"><span className="font-medium">{t('The scales\' barcodes')}</span>
          <span className="block text-muted-foreground">{t('The till reads the label of the scale: the item by its PLU (on the item\'s card) and the weight or the price inside the barcode.')}</span></span>
        <Switch checked={!!v.on} disabled={disabled} onCheckedChange={(on) => setV({ ...v, on })} aria-label={t('The scales\' barcodes')} />
      </div>
      {v.on && (
        <div className="flex flex-wrap items-end gap-2">
          <label className="grid gap-1"><span className="text-xs text-muted-foreground">{t('Begin with')}</span>
            <Input className="h-8 w-48" value={prefixes} disabled={disabled} onChange={(e) => setPrefixes(e.target.value)} placeholder="27, 28, 29" /></label>
          <label className="grid gap-1"><span className="text-xs text-muted-foreground">{t('PLU digits')}</span>
            <Select value={String(v.plu_digits ?? 5)} disabled={disabled} onValueChange={(x) => setV({ ...v, plu_digits: Number(x) })}>
              <SelectTrigger className="h-8 w-20"><SelectValue /></SelectTrigger>
              <SelectContent>{[4, 5, 6].map((n) => <SelectItem key={n} value={String(n)}>{n}</SelectItem>)}</SelectContent></Select></label>
          <label className="grid gap-1"><span className="text-xs text-muted-foreground">{t('Inside the barcode')}</span>
            <Select value={v.value ?? 'weight'} disabled={disabled} onValueChange={(x) => setV({ ...v, value: x as 'weight' | 'price' })}>
              <SelectTrigger className="h-8 w-40"><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="weight">{t('The weight (grams)')}</SelectItem><SelectItem value="price">{t('The price (cents)')}</SelectItem></SelectContent></Select></label>
        </div>
      )}
      {changed && !disabled && <div className="flex justify-end"><Button size="sm" variant="outline" onClick={() => onSave(next)}>{t('Save')}</Button></div>}
    </div>
  )
}

type UnitMax = { warehouse_id: string; code: string; name: string; receipt_max: number | null; registers: number }

/** #17: each unit can have its own limit; empty follows the company's */
function ReceiptMaxUnits({ companyMax, disabled }: { companyMax: number | null; disabled: boolean }) {
  const { companyId } = useCompany()
  const qc = useQueryClient()
  const q = useQuery({
    queryKey: ['receipt-max-units', companyId],
    enabled: !!companyId,
    // a server not updated yet has no such function: the list is simply not shown
    queryFn: async () => { const r = await supabase.rpc('pos_receipt_max_units', { p_company: companyId! }); return r.error ? null : (r.data as unknown as UnitMax[]) },
  })
  const [vals, setVals] = React.useState<Record<string, string>>({})
  React.useEffect(() => { if (q.data) setVals(Object.fromEntries(q.data.map((u) => [u.warehouse_id, u.receipt_max == null ? '' : String(u.receipt_max)]))) }, [q.data])
  const save = useMutation({
    mutationFn: async (u: { id: string; value: string }) => unwrap(await supabase.rpc('pos_receipt_max_unit_save',
      { p_company: companyId!, p_warehouse: u.id, p_value: (u.value.trim() === '' ? null : Number(u.value)) as never })),
    onSuccess: () => { toast.success(t('Saved')); void qc.invalidateQueries({ queryKey: ['receipt-max-units', companyId] }) },
    onError: (e) => toast.error(describeError(e)),
  })
  if (!q.data?.length) return null
  return (
    <div className="grid w-full basis-full gap-2 border-t pt-3">
      <span className="font-medium">{t('By unit')}</span>
      {q.data.map((u) => {
        const v = vals[u.warehouse_id] ?? ''
        const saved = u.receipt_max == null ? '' : String(u.receipt_max)
        return (
          <div key={u.warehouse_id} className="flex flex-wrap items-center justify-between gap-2">
            <span className="min-w-0 flex-1">{u.name} <span className="text-muted-foreground">({u.code})</span>
              {v.trim() === '' && <span className="block text-[12px] text-muted-foreground">{companyMax == null ? t('No limit, as the company') : t('As the company: {n}', { n: formatMoney(companyMax) })}</span>}</span>
            <div className="flex items-center gap-2">
              <Input type="number" min="0" step="any" className="w-32 text-right tabular" value={v} placeholder={t('As the company')} disabled={disabled}
                onChange={(e) => setVals((x) => ({ ...x, [u.warehouse_id]: e.target.value }))} aria-label={`${t('The highest value of one receipt')} · ${u.name}`} />
              {!disabled && <Button variant="outline" size="sm" disabled={v === saved || save.isPending}
                onClick={() => save.mutate({ id: u.warehouse_id, value: v })}>{t('Save')}</Button>}
            </div>
          </div>
        )
      })}
    </div>
  )
}
