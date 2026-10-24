import * as React from 'react'
import { toast } from 'sonner'
import { SearchSelect } from '@/components/search-select'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { t, td, tn } from '@/i18n'
import { formatQty, num, todayISO } from '@/lib/utils'
import { useCreateLeave, useEmployees, useLeaveBalances, useLeaveTypes } from '../api'

/** Counts weekdays in the range (the server also skips public holidays and has the final say) */
function weekdays(from: string, to: string) {
  if (!from || !to || to < from) return 0
  let n = 0
  for (let d = new Date(`${from}T00:00:00`); d <= new Date(`${to}T00:00:00`); d.setDate(d.getDate() + 1)) if (d.getDay() % 6 !== 0) n++
  return n
}

export function NewLeaveDialog({ onClose, employeeId }: { onClose: () => void; employeeId?: string }) {
  const emps = useEmployees()
  const types = useLeaveTypes()
  const create = useCreateLeave()
  const [v, setV] = React.useState({ employee_id: employeeId ?? null as string | null, leave_type_id: null as string | null, start_date: todayISO(), end_date: todayISO(), reason: '' })
  const set = <K extends keyof typeof v>(k: K) => (x: (typeof v)[K]) => setV((s) => ({ ...s, [k]: x }))
  const bal = useLeaveBalances(new Date(`${v.start_date || todayISO()}T00:00:00`).getFullYear(), v.employee_id)
  const b = bal.data?.find((x) => x.leave_type_id === v.leave_type_id)
  const days = weekdays(v.start_date, v.end_date)
  const type = types.data?.find((x) => x.id === v.leave_type_id)
  const valid = v.employee_id && v.leave_type_id && v.start_date && v.end_date >= v.start_date && days > 0
  const go = async (submit: boolean) => {
    const r = await create.mutateAsync({ employee_id: v.employee_id!, leave_type_id: v.leave_type_id!, start_date: v.start_date, end_date: v.end_date, reason: v.reason, submit })
    toast.success(submit ? tn(num(r.days), 'Leave requested: {n} working day', 'Leave requested: {n} working days') : tn(num(r.days), 'Draft saved: {n} working day', 'Draft saved: {n} working days'))
    onClose()
  }
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>{t('Ask for leave')}</DialogTitle>
          <DialogDescription>{t('Only working days count; weekends and public holidays are skipped.')}</DialogDescription></DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          {!employeeId && <div className="col-span-2 grid gap-1.5"><Label>{t('Employee')}</Label>
            <SearchSelect value={v.employee_id} onChange={set('employee_id')} placeholder={t('Choose a person')}
              options={(emps.data ?? []).filter((e) => e.employment_status !== 'terminated').map((e) => ({ value: e.id, label: e.full_name, hint: e.number }))} /></div>}
          <div className="col-span-2 grid gap-1.5"><Label>{t('Type of leave')}</Label>
            <Select value={v.leave_type_id ?? ''} onValueChange={set('leave_type_id')}><SelectTrigger><SelectValue placeholder={t('Choose')} /></SelectTrigger>
              <SelectContent>{(types.data ?? []).filter((x) => x.is_active).map((x) => <SelectItem key={x.id} value={x.id}>{td(x.name)}{x.is_paid ? '' : ` ${t('(unpaid)')}`}</SelectItem>)}</SelectContent></Select></div>
          <div className="grid gap-1.5"><Label htmlFor="lv-from">{t('From')}</Label><Input id="lv-from" type="date" value={v.start_date} onChange={(e) => setV((s) => ({ ...s, start_date: e.target.value, end_date: s.end_date < e.target.value ? e.target.value : s.end_date }))} /></div>
          <div className="grid gap-1.5"><Label htmlFor="lv-to">{t('To')}</Label><Input id="lv-to" type="date" min={v.start_date} value={v.end_date} onChange={(e) => set('end_date')(e.target.value)} /></div>
          <div className="col-span-2 grid gap-1.5"><Label htmlFor="lv-why">{t('Reason')} <span className="font-normal text-muted-foreground">{t('(optional)')}</span></Label>
            <Textarea id="lv-why" rows={2} value={v.reason} onChange={(e) => set('reason')(e.target.value)} /></div>
        </div>
        <div className="rounded-md bg-muted/50 px-3 py-2 text-[13px]">
          {tn(days, 'About {n} working day', 'About {n} working days')}
          {b ? <> · <span className={num(b.remaining) < days ? 'font-medium text-destructive' : ''}>{t('{left} of {total} left', { left: formatQty(b.remaining), total: formatQty(b.entitlement) })}</span></> : null}
          {type?.requires_document ? ` · ${t('a document is needed')}` : ''}
        </div>
        <DialogFooter><Button variant="outline" onClick={onClose}>{t('Cancel')}</Button>
          <Button variant="outline" disabled={!valid} loading={create.isPending} onClick={() => void go(false)}>{t('Save draft')}</Button>
          <Button disabled={!valid} loading={create.isPending} onClick={() => void go(true)}>{t('Send request')}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
